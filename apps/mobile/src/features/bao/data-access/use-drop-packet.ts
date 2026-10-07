import { address, createNoopSigner, type Address } from '@solana/kit'
import { buildCreatePacket, fetchMaybeCrown, findCrownPda, hexToBytes, type AudienceInput } from '@bao/sdk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'

import { useAppCluster } from '@/features/cluster/data-access/cluster-provider'

import { afterWallet } from './app-state'
import { TREASURY, TSKR_DECIMALS, TSKR_MINT } from './bao-config'
import { fetchBalances } from './chain'
import { rememberPacketMeta } from './prefs'
import { confirmSignature, sendWithWallet } from './send-with-wallet'
import { ApiUnavailableError, baoApi } from './use-bao-api'

/** Share bounds of the program (programs/bao/src/constants.rs: 1..=MAX_SHARES). */
export const MIN_SHARES = 1
export const MAX_SHARES = 200

export interface DropInput {
  amountUi: string
  shares: number
  mode: 'lucky' | 'equal'
  audience: { kind: 'open' } | { kind: 'circle'; circleId: string } | { kind: 'code'; code: string; hint?: string }
  seekerOnly: boolean
  expiresInHours: number
  /** Unix seconds for a scheduled rain; omit to open now. */
  startsAt?: number
  message?: string
  skin?: string
  /** Continue a Luck-King chain from this packet (the sender must hold its crown). */
  parentPacket?: string
  parentRefundTo?: string
  mint?: Address
  decimals?: number
}

/** Largest amount a packet holds: the program stores amounts as u64. */
const U64_MAX = 2n ** 64n - 1n

/**
 * Parses "12.5" (or "12,5") into base units with string math, never floating point:
 * "0.1" at 6 decimals is exactly 100000n. More decimals than the token has is an error,
 * not a silent rounding.
 */
export function toBaseUnits(amountUi: string, decimals: number): bigint {
  const m = /^(\d*)(?:[.,](\d*))?$/.exec(amountUi.trim())
  if (!m || (!m[1] && !m[2])) throw new Error('Enter a number')
  const [, whole, frac = ''] = m
  if (frac.length > decimals) throw new Error(`At most ${decimals} decimals`)
  const units = BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0')
  if (units > U64_MAX) throw new Error('That amount is too large')
  return units
}

export function useDropPacket() {
  const wallet = useMobileWallet()
  const { client } = useAppCluster()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: DropInput) => {
      const account = wallet.account ?? (await afterWallet(wallet.connect()))
      const mint = input.mint ?? TSKR_MINT
      const total = toBaseUnits(input.amountUi, input.decimals ?? TSKR_DECIMALS)
      if (!Number.isInteger(input.shares) || input.shares < MIN_SHARES || input.shares > MAX_SHARES)
        throw new Error(`Shares must be between ${MIN_SHARES} and ${MAX_SHARES}.`)
      if (total < BigInt(input.shares)) throw new Error('Put in at least one unit per share')
      if (mint === TSKR_MINT) {
        // read the balance fresh: never ask the wallet to sign a packet it cannot fund
        const { tskr } = await fetchBalances(client.rpc as never, account.address)
        if (total > tskr) throw new Error('This wallet holds less tSKR than the packet. Get test tokens first.')
      }

      let audience: AudienceInput
      let snapshotRoot: string | undefined
      if (input.audience.kind === 'circle') {
        const snap = await baoApi
          .call('POST /api/circles/:id/snapshot', { params: { id: input.audience.circleId } }, { force: true })
          .catch((e) => {
            throw e instanceof ApiUnavailableError
              ? new Error(
                  'Circle packets need the Bao server, which is unreachable right now. Try a public or code-word packet.',
                )
              : e
          })
        snapshotRoot = snap.root
        audience = { kind: 'circle', root: hexToBytes(snap.root) }
      } else if (input.audience.kind === 'code') {
        audience = { kind: 'code', code: input.audience.code }
      } else {
        audience = { kind: 'open' }
      }

      // Continuing a Luck King chain closes the parent's crown; its rent goes back where the crown says.
      let parentRefund = input.parentRefundTo ? address(input.parentRefundTo) : undefined
      if (input.parentPacket) {
        const [crownPda] = await findCrownPda({ packet: address(input.parentPacket) })
        const crown = await fetchMaybeCrown(client.rpc as never, crownPda)
        if (!crown.exists) throw new Error('That crown has already been passed on.')
        if (crown.data.king !== account.address)
          throw new Error('Only the Luck King of that packet can send the next one.')
        parentRefund = crown.data.refundTo
      }

      const { packet, instructions } = await buildCreatePacket({
        sender: createNoopSigner(account.address),
        mint,
        treasury: TREASURY,
        total,
        shares: input.shares,
        mode: input.mode,
        audience,
        seekerOnly: input.audience.kind === 'open' ? true : input.seekerOnly,
        expiresIn: BigInt(Math.round(input.expiresInHours * 3600)),
        startsAt: input.startsAt ? BigInt(input.startsAt) : 0n,
        message: input.message,
        parentPacket: input.parentPacket ? address(input.parentPacket) : undefined,
        parentCrownRefund: parentRefund,
      })
      const signature = await sendWithWallet(wallet, client, account.address, instructions)
      await confirmSignature(client, signature)
      rememberPacketMeta(packet, { message: input.message, skin: input.skin })
      // The packet is live on-chain now; the API only adds the message, skin and circle to it.
      const view = await baoApi
        .call('POST /api/packets', {
          body: {
            address: packet,
            message: input.message,
            skin: input.skin,
            circleId: input.audience.kind === 'circle' ? input.audience.circleId : undefined,
            snapshotRoot,
            codeHint: input.audience.kind === 'code' ? input.audience.hint : undefined,
          },
        })
        .catch(() => null)
      await queryClient.invalidateQueries({ queryKey: ['feed'] })
      await queryClient.invalidateQueries({ queryKey: ['balances'] })
      await queryClient.invalidateQueries({ queryKey: ['history'] })
      return { packet, signature, view }
    },
  })
}
