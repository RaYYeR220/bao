import type { GrabView, PacketDetail } from '@bao/sdk'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { usePacketData } from '@/features/bao/data-access/use-bao-data'
import { useGenesisToken } from '@/features/bao/data-access/use-genesis-token'
import { clockTime, countdown, displayName, explorerAddress, explorerTx, formatAmount, sharesLeft, shortAddress } from '@/features/bao/format'
import { PacketEnvelope } from '@/features/bao/ui/packet-envelope'
import { Backdrop } from '@/ui/backdrop'
import { useNow } from '@/ui/countdown'
import { buzz } from '@/ui/feedback'
import { Icon } from '@/ui/icon'
import { Avatar, ExplorerLink, FoilButton, Note, RoundButton, SgtBadge, Skeleton, StateBlock } from '@/ui/kit'
import { useTiltGleam } from '@/ui/motion'
import { T } from '@/ui/text'
import { color, font, radius, space } from '@/ui/tokens'

export default function PacketScreen() {
  const { address } = useLocalSearchParams<{ address: string }>()
  const insets = useSafeAreaInsets()
  const q = usePacketData(address)
  const detail = q.data?.detail ?? null
  const [refreshing, setRefreshing] = useState(false)
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'))

  return (
    <View style={{ flex: 1 }}>
      <Backdrop glowY={0.15} />
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <RoundButton icon="back" label="Back" onPress={back} />
        <T variant="caps" style={{ flex: 1, textAlign: 'center' }}>
          Packet ledger
        </T>
        <RoundButton icon="share" label="Share" onPress={() => router.push(`/share/${address}`)} />
      </View>
      {q.isLoading && !q.data ? (
        <View style={{ padding: space[5], gap: space[4] }}>
          <View style={{ flexDirection: 'row', gap: space[4] }}>
            <Skeleton width={96} height={168} />
            <View style={{ flex: 1, gap: 10, paddingTop: 10 }}>
              <Skeleton width="70%" height={34} />
              <Skeleton width="50%" height={14} />
              <Skeleton width="80%" height={14} />
            </View>
          </View>
          <Skeleton width="100%" height={280} radius={14} />
        </View>
      ) : !detail ? (
        <StateBlock
          icon="envelope"
          title={q.isError ? 'Could not reach Solana' : 'This packet is closed'}
          body={q.isError ? 'Check the connection and try again.' : 'Its account was swept: every share was settled and the rest returned to the sender.'}
          action={q.isError ? 'Try again' : 'Back'}
          onAction={q.isError ? () => void q.refetch() : back}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: space[5], paddingBottom: insets.bottom + space[6], gap: space[5] }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={color.kin300}
              colors={[color.kin300]}
              progressBackgroundColor={color.kuro800}
              onRefresh={async () => {
                setRefreshing(true)
                await q.refetch()
                setRefreshing(false)
              }}
            />
          }
        >
          <Summary detail={detail} />
          {detail.luckKing && detail.mode === 'lucky' ? <KingRow detail={detail} /> : null}
          <Ledger detail={detail} />
          {q.data?.source === 'chain' ? (
            <Note icon="link">Read straight from Solana devnet. Names come back when the Bao server is reachable.</Note>
          ) : null}
          {detail.status === 'live' ? <FoilButton label="Open the packet" icon="envelope" onPress={() => router.push(`/grab/${detail.address}`)} /> : null}
          <ExplorerLink label="Packet account on the explorer" url={explorerAddress(detail.address)} tone="muted" />
        </ScrollView>
      )}
    </View>
  )
}

function Summary({ detail }: { detail: PacketDetail }) {
  const gleam = useTiltGleam(0.5)
  const now = useNow()
  const name = displayName(detail.senderSkr, detail.sender)
  const left = sharesLeft(detail)
  const status =
    detail.status === 'scheduled'
      ? `Rain opens in ${countdown(detail.startsAt - now)}`
      : detail.status === 'live'
        ? `Live · ${left} of ${detail.shares} left · closes in ${countdown(detail.expiresAt - now)}`
        : detail.status === 'emptied'
          ? `All ${detail.shares} shares grabbed`
          : detail.status === 'expired'
            ? `Expired · ${formatAmount(detail.remaining, detail.token.decimals)} ${detail.token.symbol} goes back to ${name}`
            : 'Closed and swept'
  return (
    <Animated.View entering={FadeInDown.duration(450)} style={styles.summary}>
      <PacketEnvelope packet={detail} width={96} gleam={gleam} />
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <T style={{ fontFamily: font.display, fontSize: 40, lineHeight: 46, color: color.gofun }}>{formatAmount(detail.total, detail.token.decimals)}</T>
          <T variant="capsSmall" style={{ color: color.kin300 }}>
            {detail.token.symbol}
          </T>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <T style={{ fontFamily: font.displayItalic, fontSize: 17, color: color.gofun }}>from {name}</T>
          {detail.seekerOnly ? <SgtBadge /> : null}
        </View>
        <T variant="meta">
          {detail.mode === 'lucky' ? 'Lucky split' : 'Equal split'} ·{' '}
          {detail.audience === 'open' ? 'Public' : detail.audience === 'circle' ? 'Circle' : 'Code word'}
        </T>
        <T variant="meta" style={{ color: detail.status === 'live' ? color.jade300 : color.gofun64 }}>
          {status}
        </T>
        {detail.chainDepth > 0 ? (
          <Pressable onPress={() => router.push(`/packet/${detail.chainRoot}`)} accessibilityRole="link" style={styles.chain}>
            <Icon name="crown" size={14} />
            <T variant="capsSmall" style={{ color: color.kin300 }}>
              #{detail.chainDepth + 1} in a Luck King chain · see the first
            </T>
          </Pressable>
        ) : null}
        {detail.message ? (
          <T style={{ fontFamily: font.displayItalic, fontSize: 15, color: color.gofun64, marginTop: 4 }}>“{detail.message}”</T>
        ) : null}
      </View>
    </Animated.View>
  )
}

function KingRow({ detail }: { detail: PacketDetail }) {
  const name = displayName(detail.luckKingSkr, detail.luckKing)
  return (
    <Animated.View entering={FadeIn.duration(500)} style={styles.king}>
      <View style={styles.kingSeal}>
        <T style={{ fontFamily: font.cjkBlack, fontSize: 13, color: color.gofun, letterSpacing: -0.5 }}>運氣王</T>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="caps" style={{ color: color.kin300 }}>
          Luck King {detail.status === 'live' ? 'so far' : ''}
        </T>
        <T style={{ fontFamily: font.displayItalic, fontSize: 19, color: color.gofun }}>{name}</T>
      </View>
      {detail.luckKingAmount ? (
        <T style={{ fontFamily: font.display, fontSize: 24, color: color.gofun, fontVariant: ['tabular-nums'] }}>
          {formatAmount(detail.luckKingAmount, detail.token.decimals)}
        </T>
      ) : null}
    </Animated.View>
  )
}

function Ledger({ detail }: { detail: PacketDetail }) {
  const { account } = useMobileWallet()
  const genesis = useGenesisToken(account?.address)
  const [open, setOpen] = useState<number | null>(null)
  const grabs = [...detail.grabs].sort((a, b) => a.index - b.index)
  return (
    <View style={styles.ledger}>
      <View style={styles.ledgerFrame} pointerEvents="none" />
      <View style={styles.ledgerHead}>
        <T variant="caps" style={{ color: color.paperInk3 }}>
          Every grab
        </T>
        <T variant="caps" style={{ color: color.paperInk3 }}>
          {detail.reserved} / {detail.shares}
        </T>
      </View>
      {grabs.length === 0 ? (
        <T style={{ fontFamily: font.displayItalic, fontSize: 17, color: color.paperInk2, paddingVertical: space[4], textAlign: 'center' }}>
          Nobody has grabbed yet. Be the first.
        </T>
      ) : (
        grabs.map((g) => (
          <GrabRow
            key={`${g.deviceKey}-${g.index}`}
            g={g}
            detail={detail}
            mine={g.claimer === account?.address || g.deviceKey === genesis.data?.mint}
            open={open === g.index}
            onToggle={() => {
              buzz('select')
              setOpen((o) => (o === g.index ? null : g.index))
            }}
          />
        ))
      )}
    </View>
  )
}

function GrabRow({ g, detail, mine, open, onToggle }: { g: GrabView; detail: PacketDetail; mine: boolean; open: boolean; onToggle: () => void }) {
  const name = displayName(g.claimerSkr, g.claimer)
  const king = detail.mode === 'lucky' && detail.luckKing === g.claimer && g.amount !== null
  return (
    <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.row}>
      <View style={styles.rowMain}>
        <T style={styles.idx}>{String(g.index + 1).padStart(2, '0')}</T>
        <Avatar name={name} size={28} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <T style={{ fontFamily: font.textMedium, fontSize: 15, color: color.kuro900 }} numberOfLines={1}>
              {name}
            </T>
            {mine ? (
              <T variant="capsSmall" style={{ color: color.jade500 }}>
                you
              </T>
            ) : null}
            {king ? <Icon name="crown" size={14} tone={color.shu500} /> : null}
          </View>
          <T variant="capsSmall" style={{ color: color.paperInk3, fontSize: 9.5 }}>
            {g.status === 'pending' ? 'drawing…' : g.status === 'won' ? 'won · paying out' : 'paid'}
            {g.at ? ` · ${clockTime(g.at)}` : ''} · device {shortAddress(g.deviceKey, 3)}
          </T>
        </View>
        <T style={{ fontFamily: font.display, fontSize: 22, color: g.amount ? color.kuro950 : color.paperInk3, fontVariant: ['tabular-nums'] }}>
          {g.amount ? formatAmount(g.amount, detail.token.decimals) : '···'}
        </T>
      </View>
      {open ? (
        <Animated.View entering={FadeIn.duration(250)} style={styles.links}>
          {g.grabSignature ? <ExplorerLink label="Grab tx" url={explorerTx(g.grabSignature)} tone="ink" /> : null}
          {g.callbackSignature ? <ExplorerLink label="Verify randomness" url={explorerTx(g.callbackSignature)} tone="ink" /> : null}
          {g.payoutSignature ? <ExplorerLink label="Payout" url={explorerTx(g.payoutSignature)} tone="ink" /> : null}
          {!g.grabSignature && !g.callbackSignature ? (
            <T variant="meta" style={{ color: color.paperInk2 }}>
              Transactions are still being indexed.
            </T>
          ) : null}
        </Animated.View>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space[4], gap: 8 },
  summary: { flexDirection: 'row', gap: space[5], alignItems: 'flex-start' },
  chain: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  king: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    padding: space[4],
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(221,187,122,0.35)',
    backgroundColor: 'rgba(80,7,15,0.25)',
  },
  kingSeal: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: color.shu500,
    borderWidth: 1,
    borderColor: color.kin300,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-9deg' }],
  },
  ledger: { backgroundColor: color.paper, borderRadius: 4, paddingHorizontal: space[4], paddingVertical: space[4] },
  ledgerFrame: {
    position: 'absolute',
    left: 6,
    top: 6,
    right: 6,
    bottom: 6,
    borderWidth: 1,
    borderColor: 'rgba(127,95,44,0.45)',
    borderRadius: 2,
  },
  ledgerHead: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: space[2], paddingHorizontal: 4 },
  row: { paddingVertical: 10, paddingHorizontal: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(127,95,44,0.35)', minHeight: 52 },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  idx: { fontFamily: font.caps, fontSize: 11, letterSpacing: 1, color: color.paperInk3, width: 20 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingTop: 8, paddingLeft: 58 },
})
