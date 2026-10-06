import { address, createNoopSigner, type Address, type Signature } from '@solana/kit'
import {
  ClaimStatus,
  SplitMode,
  buildGrab,
  fetchMaybeClaimRecord,
  fetchPacket,
  findGenesisToken,
  hexToBytes,
} from '@bao/sdk'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useCallback, useRef, useState } from 'react'

import { useAppCluster } from '@/features/cluster/data-access/cluster-provider'

import { GENESIS_GROUP } from './bao-config'
import { confirmSignature, sendWithWallet, TransactionFailedError, WalletRejectedError } from './send-with-wallet'
import { baoApi } from './use-bao-api'

export type GrabPhase =
  | { kind: 'idle' }
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
    }
  | { kind: 'refused'; message: string; code: number | null; signature?: Signature }
  | { kind: 'error'; message: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * The grab: Seed Vault signature → device-bound reservation on-chain → (Lucky) VRF-proven
 * share → reveal. Payout of a Lucky share is requested from the API so there is no second
 * wallet prompt; the program makes it permissionless.
 */
export function useGrab(packetAddress: string, code?: string) {
  const wallet = useMobileWallet()
  const { client } = useAppCluster()
  const [phase, setPhase] = useState<GrabPhase>({ kind: 'idle' })
  const busy = useRef(false)

  const grab = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      const account = wallet.account ?? (await wallet.connect())
      // MWA signs the compiled message; the builder only needs the signer's address.
      const claimer = createNoopSigner(account.address)
      const packetKey = address(packetAddress)
      const packet = await fetchPacket(client.rpc as never, packetKey)
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
        setPhase({ kind: 'refused', code: null, message: 'Only real Seekers can grab this packet. This wallet has no Seeker Genesis Token.' })
        return
      }
      const mode = packet.data.mode === SplitMode.Lucky ? 'lucky' : 'equal'
      const { instruction, claim } = await buildGrab({
        claimer,
        packet: { address: packetKey, mint: packet.data.mint, tokenProgram: packet.data.tokenProgram, mode, seekerOnly },
        genesis,
        proof,
        code,
      })

      setPhase({ kind: 'signing' })
      const signature = await sendWithWallet(wallet, client, account.address, [instruction])
      setPhase({ kind: 'confirming', signature })
      await confirmSignature(client, signature)

      if (mode === 'lucky') setPhase({ kind: 'unsealing', signature })
      let record = await fetchMaybeClaimRecord(client.rpc as never, claim)
      for (let i = 0; i < 60 && (!record.exists || record.data.status === ClaimStatus.Pending); i++) {
        await sleep(500)
        record = await fetchMaybeClaimRecord(client.rpc as never, claim)
      }
      if (!record.exists || record.data.status === ClaimStatus.Pending) {
        setPhase({ kind: 'error', message: 'The randomness is taking longer than usual. Your place is reserved; check back in a minute.' })
        return
      }
      if (record.data.status === ClaimStatus.Won) {
        void baoApi.call('POST /api/claims/:address/payout', { params: { address: claim } }).catch(() => undefined)
      }
      const after = await fetchPacket(client.rpc as never, packetKey)
      const king = after.data.luckKing
      setPhase({
        kind: 'revealed',
        amount: record.data.amount,
        index: record.data.index,
        signature,
        claim,
        isLuckKingSoFar: king.__option === 'Some' && king.value === account.address,
      })
    } catch (error) {
      if (error instanceof TransactionFailedError) {
        setPhase({ kind: 'refused', message: error.message, code: error.code, signature: error.signature })
      } else if (error instanceof WalletRejectedError) {
        setPhase({ kind: 'idle' })
      } else {
        setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      busy.current = false
    }
  }, [client, code, packetAddress, wallet])

  return { phase, grab, reset: () => setPhase({ kind: 'idle' }) }
}
