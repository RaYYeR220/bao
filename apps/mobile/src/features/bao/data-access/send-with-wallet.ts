import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase58Decoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
  type Signature,
} from '@solana/kit'
import { getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget'
import { transact, type useMobileWallet } from '@wallet-ui/react-native-kit'
import {
  BAO_ERROR__ALREADY_GRABBED_ON_THIS_DEVICE,
  BAO_ERROR__EXPIRED,
  BAO_ERROR__NOT_A_SEEKER,
  BAO_ERROR__NOT_IN_CIRCLE,
  BAO_ERROR__NOT_STARTED,
  BAO_ERROR__PAUSED,
  BAO_ERROR__SGT_NOT_OWNED,
  BAO_ERROR__SOLD_OUT,
  BAO_ERROR__WRONG_CODE,
  BAO_ERROR__WRONG_SGT_GROUP,
} from '@bao/sdk'

import type { SolanaClient } from '@/features/cluster/data-access/create-solana-client'

type Wallet = ReturnType<typeof useMobileWallet>

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class WalletRejectedError extends Error {}

/**
 * Signs and sends `instructions` through the Mobile Wallet Adapter (Seed Vault on a Seeker).
 * The blockhash is fetched inside the wallet session, after (re)authorization, so a slow
 * biometric confirmation cannot outlive it.
 */
export async function sendWithWallet(
  wallet: Wallet,
  client: SolanaClient,
  feePayer: Address,
  instructions: Instruction[],
): Promise<Signature> {
  try {
    const signature = await transact(async (mw) => {
      const { chain, identity } = wallet
      const cached = await wallet.store.fetch()
      let auth
      try {
        auth = await mw.authorize({ auth_token: wallet.store.$authToken.get(), chain, identity })
      } catch {
        auth = await mw.authorize({ chain, identity })
      }
      if (cached) await wallet.store.persist({ ...cached, authToken: auth.auth_token })

      const {
        context: { slot },
        value: latestBlockhash,
      } = await client.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayer(feePayer, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
        (m) => appendTransactionMessageInstructions([getSetComputeUnitPriceInstruction({ microLamports: 10_000n }), ...instructions], m),
      )
      const [signatureBytes] = await mw.signAndSendTransactions({ minContextSlot: Number(slot), transactions: [message] })
      return getBase58Decoder().decode(signatureBytes) as Signature
    })
    return signature
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    if (/declin|reject|cancel/i.test(text)) throw new WalletRejectedError('You closed the wallet before signing.')
    throw error
  }
}

/** Polls until the signature is confirmed; throws with the program error if it failed. */
export async function confirmSignature(client: SolanaClient, signature: Signature, timeoutMs = 60_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const {
        value: [status],
      } = await client.rpc.getSignatureStatuses([signature]).send()
      if (status?.err) throw new TransactionFailedError(signature, status.err)
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return
    } catch (e) {
      if (e instanceof TransactionFailedError) throw e
    }
    await sleep(800)
  }
  throw new Error('The network did not confirm the transaction in time.')
}

export class TransactionFailedError extends Error {
  constructor(
    readonly signature: Signature,
    readonly detail: unknown,
  ) {
    super(describeProgramError(detail))
  }

  /** Bao program error code (6000+) if the program refused the transaction. */
  get code(): number | null {
    const custom = (this.detail as { InstructionError?: [number, { Custom?: number }] })?.InstructionError?.[1]?.Custom
    return typeof custom === 'number' ? custom : null
  }
}

const BAO_ERRORS: Record<number, string> = {
  [BAO_ERROR__PAUSED]: 'Bao is paused for maintenance.',
  [BAO_ERROR__EXPIRED]: 'This packet has expired.',
  [BAO_ERROR__SOLD_OUT]: 'Every share is already taken.',
  [BAO_ERROR__NOT_IN_CIRCLE]: 'This packet is for a circle you are not in.',
  [BAO_ERROR__WRONG_CODE]: 'That is not the code word.',
  [BAO_ERROR__NOT_A_SEEKER]: 'Only real Seekers can grab this packet. This wallet has no Seeker Genesis Token.',
  [BAO_ERROR__SGT_NOT_OWNED]: 'That Seeker Genesis Token belongs to another wallet.',
  [BAO_ERROR__WRONG_SGT_GROUP]: 'That token is not a Seeker Genesis Token.',
  [BAO_ERROR__ALREADY_GRABBED_ON_THIS_DEVICE]: 'This Seeker already grabbed this packet.',
  [BAO_ERROR__NOT_STARTED]: 'This rain has not started yet.',
}

export function describeProgramError(detail: unknown): string {
  const custom = (detail as { InstructionError?: [number, { Custom?: number }] })?.InstructionError?.[1]?.Custom
  if (typeof custom === 'number' && BAO_ERRORS[custom]) return BAO_ERRORS[custom]
  return `Transaction failed: ${JSON.stringify(detail)}`
}
