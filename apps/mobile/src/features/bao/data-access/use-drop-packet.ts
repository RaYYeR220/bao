import { address, createNoopSigner, type Address } from '@solana/kit'
import { buildCreatePacket, hexToBytes, type AudienceInput } from '@bao/sdk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'

import { useAppCluster } from '@/features/cluster/data-access/cluster-provider'

import { TREASURY, TSKR_DECIMALS, TSKR_MINT } from './bao-config'
import { confirmSignature, sendWithWallet } from './send-with-wallet'
import { baoApi } from './use-bao-api'

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

/** Parses "12.5" into base units without floating point. */
export function toBaseUnits(amountUi: string, decimals: number): bigint {
  const [whole, frac = ''] = amountUi.trim().split('.')
  if (!/^\d+$/.test(whole || '0') || !/^\d*$/.test(frac)) throw new Error('Enter a number')
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0')
}

export function useDropPacket() {
  const wallet = useMobileWallet()
  const { client } = useAppCluster()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: DropInput) => {
      const account = wallet.account ?? (await wallet.connect())
      const mint = input.mint ?? TSKR_MINT
      const total = toBaseUnits(input.amountUi, input.decimals ?? TSKR_DECIMALS)
      if (total < BigInt(input.shares)) throw new Error('Put in at least one unit per share')

      let audience: AudienceInput
      let snapshotRoot: string | undefined
      if (input.audience.kind === 'circle') {
        const snap = await baoApi.call('POST /api/circles/:id/snapshot', { params: { id: input.audience.circleId } })
        snapshotRoot = snap.root
        audience = { kind: 'circle', root: hexToBytes(snap.root) }
      } else if (input.audience.kind === 'code') {
        audience = { kind: 'code', code: input.audience.code }
      } else {
        audience = { kind: 'open' }
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
        parentCrownRefund: input.parentRefundTo ? address(input.parentRefundTo) : undefined,
      })
      const signature = await sendWithWallet(wallet, client, account.address, instructions)
      await confirmSignature(client, signature)
      const view = await baoApi.call('POST /api/packets', {
        body: {
          address: packet,
          message: input.message,
          skin: input.skin,
          circleId: input.audience.kind === 'circle' ? input.audience.circleId : undefined,
          snapshotRoot,
          codeHint: input.audience.kind === 'code' ? input.audience.hint : undefined,
        },
      })
      await queryClient.invalidateQueries({ queryKey: ['feed'] })
      return { packet, signature, view }
    },
  })
}
