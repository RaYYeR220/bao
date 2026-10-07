import { address, createNoopSigner, type Address, type Signature } from '@solana/kit'
import {
  ClaimStatus,
  SplitMode,
  buildGrab,
  buildPayout,
  fetchMaybeClaimRecord,
  fetchPacket,
  findGenesisToken,
  hexToBytes,
} from '@bao/sdk'
import { useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useCallback, useRef, useState } from 'react'

import { useAppCluster } from '@/features/cluster/data-access/cluster-provider'

import { GENESIS_GROUP } from './bao-config'
import {
  confirmSignature,
  humanError,
  sendWithWallet,
  TransactionFailedError,
  WalletRejectedError,
} from './send-with-wallet'
import { baoApi } from './use-bao-api'

export type PayoutState = 'paid' | 'paying' | 'unpaid' | 'collecting'

export type GrabPhase =
  | { kind: 'idle' }
  /** Reading the packet and the Genesis token before the wallet opens. */
  | { kind: 'preparing' }
  | { kind: 'signing' }
  | { kind: 'confirming'; signature: Signature }
  /** Lucky only: the share is reserved, the VRF proof is on its way. */
  | { kind: 'unsealing'; signature: Signature }
  | {
      kind: 'revealed'
      amount: bigint
      index: number
      signature: Signature
      isLuckKingSoFar: boolean
      claim: Address
      mode: 'lucky' | 'equal'
      payout: PayoutState
      payoutSignature: string | null
    }
  | { kind: 'refused'; message: string; code: number | null; signature?: Signature | null }
  | { kind: 'error'; message: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * The grab: Seed Vault signature → device-bound reservation on-chain → (Lucky) VRF-proven
 * share → reveal. A Lucky share is paid out by the API so there is no second wallet prompt;
 * the instruction is permissionless, so if the API is unreachable the grabber can collect it.
 */
export function useGrab(packetAddress: string, code?: string) {
  const wallet = useMobileWallet()
  const { client } = useAppCluster()
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<GrabPhase>({ kind: 'idle' })
  const busy = useRef(false)
  const meta = useRef<{ mint: Address; tokenProgram: Address } | null>(null)

  const grab = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setPhase({ kind: 'preparing' })
    try {
      const account = wallet.account ?? (await wallet.connect())
      // MWA signs the compiled message; the builder only needs the signer's address.
      const claimer = createNoopSigner(account.address)
      const packetKey = address(packetAddress)
      const packet = await fetchPacket(client.rpc as never, packetKey)
      meta.current = { mint: packet.data.mint, tokenProgram: packet.data.tokenProgram }
      const seekerOnly = packet.data.seekerOnly
      const genesis = seekerOnly ? await findGenesisToken(client.rpc as never, account.address, GENESIS_GROUP) : null
      let proof: Uint8Array[] | undefined
      if (packet.data.audience.__kind === 'Circle') {
        const res = await baoApi.call('GET /api/packets/:address/proof', {
          params: { address: packetAddress },
          query: { wallet: account.address },
        })
        proof = res.proof.map(hexToBytes)
      }
      if (seekerOnly && !genesis) {
        setPhase({
          kind: 'refused',
          code: null,
          message: 'Only real Seekers can grab this packet. This wallet holds no Seeker Genesis Token.',
        })
        return
      }
      const mode = packet.data.mode === SplitMode.Lucky ? 'lucky' : 'equal'
      const { instruction, claim } = await buildGrab({
        claimer,
        packet: {
          address: packetKey,
          mint: packet.data.mint,
          tokenProgram: packet.data.tokenProgram,
          mode,
          seekerOnly,
        },
        genesis,
        proof,
        code,
      })

      setPhase({ kind: 'signing' })
      const signature = await sendWithWallet(wallet, client, account.address, [instruction])
      setPhase({ kind: 'confirming', signature })
      await confirmSignature(client, signature)

      const unsealedAt = Date.now()
      if (mode === 'lucky') setPhase({ kind: 'unsealing', signature })
      let record = await fetchMaybeClaimRecord(client.rpc as never, claim)
      for (let i = 0; i < 90 && (!record.exists || record.data.status === ClaimStatus.Pending); i++) {
        await sleep(500)
        record = await fetchMaybeClaimRecord(client.rpc as never, claim)
      }
      if (!record.exists || record.data.status === ClaimStatus.Pending) {
        setPhase({
          kind: 'error',
          message: 'The randomness is taking longer than usual. Your place is reserved; check back in a minute.',
        })
        return
      }
      const after = await fetchPacket(client.rpc as never, packetKey)
      // let the unsealing breathe: the proof can land in under a second on a quiet devnet
      if (mode === 'lucky') await sleep(Math.max(0, 2200 - (Date.now() - unsealedAt)))
      const king = after.data.luckKing
      const won = record.data.status === ClaimStatus.Won
      setPhase({
        kind: 'revealed',
        amount: record.data.amount,
        index: record.data.index,
        signature,
        claim,
        mode,
        isLuckKingSoFar: king.__option === 'Some' && king.value === account.address,
        payout: won ? 'paying' : 'paid',
        payoutSignature: null,
      })
      void queryClient.invalidateQueries({ queryKey: ['feed'] })
      void queryClient.invalidateQueries({ queryKey: ['packet', packetAddress] })
      void queryClient.invalidateQueries({ queryKey: ['balances'] })
      void queryClient.invalidateQueries({ queryKey: ['my-claim'] })
      void queryClient.invalidateQueries({ queryKey: ['my-claims'] })
      void queryClient.invalidateQueries({ queryKey: ['history'] })
      if (won) {
        try {
          const res = await baoApi.call(
            'POST /api/claims/:address/payout',
            { params: { address: claim } },
            { timeoutMs: 20_000 },
          )
          setPhase((p) => (p.kind === 'revealed' ? { ...p, payout: 'paid', payoutSignature: res.signature } : p))
          void queryClient.invalidateQueries({ queryKey: ['balances'] })
        } catch {
          setPhase((p) => (p.kind === 'revealed' ? { ...p, payout: 'unpaid' } : p))
        }
      }
    } catch (error) {
      if (error instanceof TransactionFailedError) {
        setPhase({ kind: 'refused', message: error.message, code: error.code, signature: error.signature })
      } else if (error instanceof WalletRejectedError) {
        setPhase({ kind: 'idle' })
      } else {
        setPhase({ kind: 'error', message: humanError(error) })
      }
    } finally {
      busy.current = false
    }
  }, [client, code, packetAddress, queryClient, wallet])

  /** Pays a won Lucky share to the grabber with their own signature (API unreachable). */
  const collect = useCallback(async () => {
    if (busy.current || phase.kind !== 'revealed' || !meta.current) return
    busy.current = true
    const claim = phase.claim
    setPhase((p) => (p.kind === 'revealed' ? { ...p, payout: 'collecting' } : p))
    try {
      const account = wallet.account ?? (await wallet.connect())
      const ix = await buildPayout({
        payer: createNoopSigner(account.address),
        packet: address(packetAddress),
        claim,
        claimer: account.address,
        mint: meta.current.mint,
        tokenProgram: meta.current.tokenProgram,
      })
      const sig = await sendWithWallet(wallet, client, account.address, [ix])
      await confirmSignature(client, sig)
      setPhase((p) => (p.kind === 'revealed' ? { ...p, payout: 'paid', payoutSignature: sig } : p))
      void queryClient.invalidateQueries({ queryKey: ['balances'] })
    } catch {
      setPhase((p) => (p.kind === 'revealed' ? { ...p, payout: 'unpaid' } : p))
    } finally {
      busy.current = false
    }
  }, [client, packetAddress, phase, queryClient, wallet])

  return { phase, grab, collect, reset: () => setPhase({ kind: 'idle' }) }
}
