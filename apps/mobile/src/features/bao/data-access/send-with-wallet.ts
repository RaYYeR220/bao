import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getAddressDecoder,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  isAddress,
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
  BAO_ERROR__BAD_EXPIRY,
  BAO_ERROR__BAD_SHARES,
  BAO_ERROR__BAD_START,
  BAO_ERROR__CROWN_ACTIVE,
  BAO_ERROR__EXPIRED,
  BAO_ERROR__NOT_LUCK_KING,
  BAO_ERROR__OPEN_MUST_BE_SEEKER_ONLY,
  BAO_ERROR__TOTAL_TOO_SMALL,
  BAO_ERROR__UNSAFE_MINT,
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

import { untilActive } from './app-state'
import { BAO_CHAIN } from './bao-config'
import { describeProgramErrorName } from './program-errors'

type Wallet = ReturnType<typeof useMobileWallet>

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The user closed or declined the wallet: a quiet state, never an error on screen. */
export class WalletRejectedError extends Error {}

/** The wallet authorized an account other than the one the transaction was built for. */
export class WalletAccountMismatchError extends Error {
  constructor() {
    super('The wallet approved a different account than the one connected. Connect again and retry.')
  }
}

/** Sent, but not confirmed in time: the signature is still worth showing (it may yet land). */
export class ConfirmTimeoutError extends Error {
  constructor(readonly signature: Signature) {
    super('The network did not confirm the transaction in time.')
  }
}

// MWA protocol codes: authorization declined (-1) and signing declined (-3)
const MWA_DECLINED = new Set<number | string>([-1, -3, 'ERROR_SESSION_CLOSED', 'ERROR_ASSOCIATION_CANCELLED'])

/**
 * The MWA JSON-RPC error code of a wallet refusal, if it is one. The native bridge also puts
 * it in front of the wallet's own text ("-2/payloads invalid for signing").
 */
export function walletErrorCode(error: unknown): number | null {
  const e = error as { name?: string; code?: unknown; message?: string } | null
  if (e?.name === 'SolanaMobileWalletAdapterProtocolError' && typeof e.code === 'number') return e.code
  const m = /^(-\d+)\//.exec(e?.message ?? '')
  return m ? Number(m[1]) : null
}

/**
 * A wallet refusal in words (MWA codes: -1 not authorized, -2 invalid payloads, -3 not signed,
 * -4 not submitted, -5 too many payloads; wallets also use -5 and below for an unsupported
 * chain, so that one is read from the text). Null when the error is not a wallet refusal.
 */
export function describeWalletError(error: unknown): string | null {
  const code = walletErrorCode(error)
  if (code === null) return null
  const text = (error as { message?: string } | null)?.message ?? ''
  if (/chain|cluster/i.test(text))
    return 'The wallet does not support Solana devnet. Switch it to devnet and try again.'
  switch (code) {
    case -1:
      return 'The wallet did not authorize Bao. Connect again and approve Bao in the wallet.'
    case -2:
      return 'The wallet could not send this transaction. Give it a few seconds and try again.'
    case -3:
      return 'The wallet did not sign it.'
    case -4:
      return 'The wallet signed it but could not get it to Solana. Check the connection and try again.'
    case -100:
      return 'The wallet could not verify that this is the real Bao app. Update the wallet and try again.'
    default:
      return 'The wallet turned the request down. Check that it is set to Solana devnet and try again.'
  }
}

/** Whether an error means the user declined or closed the wallet (authorize, sign or SIWS). */
export function isWalletCancel(error: unknown): boolean {
  if (error instanceof WalletRejectedError) return true
  const e = error as { name?: string; code?: number | string; message?: string } | null
  if (e && /^SolanaMobileWalletAdapter(Protocol)?Error$/.test(e.name ?? '') && MWA_DECLINED.has(e.code ?? ''))
    return true
  return /declin|reject|cancel/i.test(e?.message ?? String(error))
}

const b64 = getBase64Encoder()
const addressDecoder = getAddressDecoder()

/** Base58 addresses of an MWA authorization (the protocol sends them base64-encoded). */
function authorizedAddresses(accounts: readonly { address: string }[]): string[] {
  return accounts.map(({ address: a }) =>
    !a.endsWith('=') && isAddress(a) ? a : addressDecoder.decode(b64.encode(a)).toString(),
  )
}

/**
 * Runs the transaction against the cluster before the wallet opens. A program refusal (not a
 * Seeker, already grabbed, sold out…) comes back with its error code and logs, without asking
 * the user to sign something that cannot land.
 */
export async function preflight(client: SolanaClient, feePayer: Address, instructions: Instruction[]) {
  const { value: latestBlockhash } = await client.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [getSetComputeUnitPriceInstruction({ microLamports: 10_000n }), ...instructions],
        m,
      ),
  )
  const wire = getBase64EncodedWireTransaction(compileTransaction(message))
  const { value } = await client.rpc
    .simulateTransaction(wire, {
      encoding: 'base64',
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: 'confirmed',
    })
    .send()
  if (value.err) {
    if (__DEV__)
      console.log('preflight refused: %s | %s', safeJson(value.err), (value.logs ?? []).slice(-12).join(' | '))
    throw new TransactionFailedError(null, value.err, value.logs ?? [])
  }
}

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
  // the wallet must sign for the same cluster the RPC client talks to (devnet)
  if (wallet.chain !== BAO_CHAIN) throw new Error(`Bao runs on ${BAO_CHAIN}; the wallet is set to ${wallet.chain}.`)
  await preflight(client, feePayer, instructions)
  try {
    const signature = await transact(async (mw) => {
      // 1. authorize (reusing the stored token when the wallet still accepts it)…
      const { identity } = wallet
      const cached = await wallet.store.fetch()
      let auth
      try {
        auth = await mw.authorize({ auth_token: wallet.store.$authToken.get(), chain: BAO_CHAIN, identity })
      } catch {
        // a stale token is refused with the same code as a decline: ask afresh
        auth = await mw.authorize({ chain: BAO_CHAIN, identity })
      }
      if (cached) await wallet.store.persist({ ...cached, authToken: auth.auth_token })
      // 2. …and only sign as the account this transaction was built for
      if (!authorizedAddresses(auth.accounts).includes(feePayer)) throw new WalletAccountMismatchError()

      // A finalized blockhash: every RPC node knows it, whatever commitment the wallet's node
      // checks against ("Blockhash not found" otherwise).
      const {
        context: { slot },
        value: latestBlockhash,
      } = await client.rpc.getLatestBlockhash({ commitment: 'finalized' }).send()
      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayer(feePayer, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
        (m) =>
          appendTransactionMessageInstructions(
            [getSetComputeUnitPriceInstruction({ microLamports: 10_000n }), ...instructions],
            m,
          ),
      )
      // The wallet sends through its own RPC and preflights there, by default against finalized
      // state, ~13 s behind the confirmed state Bao just simulated. Tokens from the faucet, a crown
      // or an account made seconds ago are not there yet, the wallet's preflight fails and it
      // answers -2 ("payloads invalid"). Bao ran these exact instructions through
      // simulateTransaction a moment ago (preflight above), so skip the wallet's second, staler
      // preflight, and where a wallet still runs one, ask for the confirmed state Bao saw.
      const [signatureBytes] = await mw.signAndSendTransactions({
        minContextSlot: Number(slot),
        commitment: 'confirmed',
        skipPreflight: true,
        transactions: [message],
      })
      const sent = getBase58Decoder().decode(signatureBytes) as Signature
      lifetimes.set(sent, latestBlockhash.lastValidBlockHeight)
      return sent
    })
    // the confirmation polls and API calls that follow need Bao back in front (network unblocked)
    await untilActive()
    return signature
  } catch (error) {
    if (error instanceof WalletAccountMismatchError) throw error
    const text = error instanceof Error ? error.message : String(error)
    if (isWalletCancel(error)) throw new WalletRejectedError('You closed the wallet before signing.')
    // the wallet simulated the transaction and the program refused it before sending
    const code = programErrorCodeFromText(text)
    if (code !== null) throw new TransactionFailedError(null, { InstructionError: [1, { Custom: code }] })
    if (/insufficient|0x1|debit an account/i.test(text))
      throw new Error('Not enough SOL or tSKR in this wallet for that.')
    throw error
  }
}

/** Last block height at which a transaction sent through the wallet can still land. */
const lifetimes = new Map<Signature, bigint>()

/** Sent, never seen, and its blockhash ran out (signed too late): it can no longer land. */
export class TransactionExpiredError extends Error {
  constructor(readonly signature: Signature) {
    super('The transaction expired before it reached Solana.')
  }
}

/**
 * Polls until the signature is confirmed; throws with the program error if it failed, and
 * stops early once a transaction Solana never saw has outlived its blockhash.
 */
export async function confirmSignature(client: SolanaClient, signature: Signature, timeoutMs = 60_000) {
  const started = Date.now()
  const lastValid = lifetimes.get(signature)
  try {
    for (let poll = 1; Date.now() - started < timeoutMs; poll++) {
      try {
        const {
          value: [status],
        } = await client.rpc.getSignatureStatuses([signature]).send()
        if (status?.err) throw new TransactionFailedError(signature, status.err)
        if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return
        if (!status && lastValid !== undefined && poll % 4 === 0) {
          const height = await client.rpc.getBlockHeight({ commitment: 'confirmed' }).send()
          if (height > lastValid) throw new TransactionExpiredError(signature)
        }
      } catch (e) {
        if (e instanceof TransactionFailedError || e instanceof TransactionExpiredError) throw e
      }
      await sleep(800)
    }
    throw new ConfirmTimeoutError(signature)
  } finally {
    lifetimes.delete(signature)
  }
}

export class TransactionFailedError extends Error {
  constructor(
    readonly signature: Signature | null,
    readonly detail: unknown,
    readonly logs: readonly string[] = [],
  ) {
    super(describeProgramError(detail))
  }

  /** Bao program error code (6000+) if the program refused the transaction. */
  get code(): number | null {
    return customCode(this.detail)
  }
}

/** Reads `custom program error: 0x1780` out of a wallet or RPC error message. */
export function programErrorCodeFromText(text: string): number | null {
  const m = /custom program error: (0x[0-9a-f]+|\d+)/i.exec(text)
  if (!m) return null
  const code = m[1].startsWith('0x') ? parseInt(m[1], 16) : Number(m[1])
  return code >= 6000 ? code : null
}

const BAO_ERRORS: Record<number, string> = {
  [BAO_ERROR__PAUSED]: 'Bao is paused for maintenance.',
  [BAO_ERROR__BAD_SHARES]: 'Shares must be between 1 and 200.',
  [BAO_ERROR__TOTAL_TOO_SMALL]: 'Put in at least one unit per share.',
  [BAO_ERROR__BAD_EXPIRY]: 'Pick an expiry between one hour and seven days.',
  [BAO_ERROR__OPEN_MUST_BE_SEEKER_ONLY]: 'Public packets are always Seeker-only.',
  [BAO_ERROR__UNSAFE_MINT]: 'That token cannot go in a packet.',
  [BAO_ERROR__NOT_LUCK_KING]: 'Only the Luck King of that packet can send the next one in its chain.',
  [BAO_ERROR__CROWN_ACTIVE]: 'That crown is still being worn.',
  [BAO_ERROR__BAD_START]: 'Pick a rain time in the future, within the next week.',
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

/** RPC errors arrive with bigint fields from @solana/kit; JSON.stringify cannot take those. */
export const safeJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x))

function customCode(detail: unknown): number | null {
  const custom = (detail as { InstructionError?: [unknown, { Custom?: number | bigint }] })?.InstructionError?.[1]
    ?.Custom
  return typeof custom === 'number' || typeof custom === 'bigint' ? Number(custom) : null
}

export function describeProgramError(detail: unknown): string {
  const custom = customCode(detail)
  if (custom !== null && BAO_ERRORS[custom]) return BAO_ERRORS[custom]
  // custom error 1 is the token (or system) program's insufficient funds
  if (custom === 1) return 'Not enough SOL or tSKR in this wallet.'
  if (custom !== null && custom >= 6000) return `The Bao program refused it (${describeProgramErrorName(custom)}).`
  if (typeof detail === 'string') return `The network refused the transaction (${detail}).`
  return `The network refused the transaction (${safeJson(detail)}).`
}

/** Turns wallet, network and RPC failures into one calm sentence for the screen. */
export function humanError(error: unknown): string {
  const wallet = describeWalletError(error)
  if (wallet) return wallet
  const text = error instanceof Error ? error.message : String(error)
  if (/TimeoutException|timed out waiting/i.test(text))
    return 'The wallet took too long to answer. Open it and try again.'
  if (
    /no installed wallet|ActivityNotFound|wallet app not found|SolanaMobileWalletAdapterWalletNotInstalledError/i.test(
      text,
    )
  )
    return 'No Solana wallet on this phone yet. Install one (Seed Vault on a Seeker) and try again.'
  if (/network request failed|failed to fetch|ENOTFOUND|ECONN/i.test(text))
    return 'Solana devnet did not answer. Check the connection and try again.'
  if (error instanceof TransactionExpiredError || /blockhash not found|BlockhashNotFound/i.test(text))
    return 'The transaction took too long to sign. Try again.'
  if (/did not confirm the transaction in time/i.test(text))
    return 'Solana is slow right now; the grab may still land. Check back in a minute.'
  return text.length > 160 ? `${text.slice(0, 157)}…` : text
}
