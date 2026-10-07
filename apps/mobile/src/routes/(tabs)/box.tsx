import type { GrabView, PacketView } from '@bao/sdk'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { router } from 'expo-router'
import { memo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, View, type ListRenderItemInfo } from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { refreshNow } from '@/features/bao/data-access/use-bao-api'
import { useHistory } from '@/features/bao/data-access/use-bao-data'
import { displayName, formatAmount, plural, sharesLeft, timeAgo } from '@/features/bao/format'
import { toneFor } from '@/features/bao/ui/packet-envelope'
import { Backdrop } from '@/ui/backdrop'
import { EnvelopeThumb } from '@/ui/envelope/envelope'
import { buzz } from '@/ui/feedback'
import { Icon } from '@/ui/icon'
import { Note, Skeleton, StateBlock } from '@/ui/kit'
import { T } from '@/ui/text'
import { color, font, radius, space } from '@/ui/tokens'

type Tab = 'received' | 'sent'

type BoxRow =
  | { kind: 'received'; key: string; grab: GrabView; packet: PacketView | null }
  | { kind: 'sent'; key: string; packet: PacketView }

const rowKey = (r: BoxRow) => r.key
const RowGap = () => <View style={{ height: 10 }} />
const renderRow = ({ item, index }: ListRenderItemInfo<BoxRow>) =>
  item.kind === 'received' ? (
    <ReceivedRow grab={item.grab} packet={item.packet} i={index} />
  ) : (
    <SentRow packet={item.packet} i={index} />
  )

export default function BoxScreen() {
  const insets = useSafeAreaInsets()
  const { account } = useMobileWallet()
  const history = useHistory(account?.address)
  const [tab, setTab] = useState<Tab>('received')
  const [refreshing, setRefreshing] = useState(false)
  const data = history.data

  const received = data?.grabs ?? []
  const sent = data?.sent ?? []
  const receivedTotal = received.reduce((s, g) => s + BigInt(g.grab.amount ?? '0'), 0n)
  const sentTotal = sent.reduce((s, p) => s + BigInt(p.total), 0n)

  const rows: BoxRow[] =
    !account || !data
      ? []
      : tab === 'received'
        ? received.map(({ grab, packet }) => ({
            kind: 'received' as const,
            key: `${grab.packet}-${grab.index}`,
            grab,
            packet,
          }))
        : sent.map((packet) => ({ kind: 'sent' as const, key: packet.address, packet }))

  const header = (
    <View style={{ gap: space[5], marginBottom: account ? space[5] : 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View style={{ gap: 4 }}>
          <T variant="caps">Opened and sent</T>
          <T variant="title" style={{ fontSize: 34, lineHeight: 40 }} accessibilityRole="header">
            My box
          </T>
        </View>
        <T style={{ fontFamily: font.cjk, fontSize: 30, color: 'rgba(221,187,122,0.35)' }}>漆盒</T>
      </View>

      {!account ? (
        <StateBlock
          icon="box"
          title="Your box is empty"
          body="Connect your Seeker to keep every packet you open or send, with its proof."
          action="Connect your Seeker"
          onAction={() => router.navigate('/seeker')}
        />
      ) : (
        <>
          <View style={styles.stats}>
            <Stat label="Grabbed" value={formatAmount(receivedTotal, 6)} sub={plural(received.length, 'packet')} />
            <View style={styles.vr} />
            <Stat label="Given" value={formatAmount(sentTotal, 6)} sub={plural(sent.length, 'packet')} />
            <View style={styles.vr} />
            <Stat label="Crowns" value={data ? String(data.crowns) : '–'} sub="運氣王" cjk />
          </View>

          <View style={styles.seg} accessibilityRole="tablist">
            {(['received', 'sent'] as Tab[]).map((t) => (
              <Pressable
                key={t}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t }}
                onPress={() => {
                  buzz('select')
                  setTab(t)
                }}
                style={[styles.segItem, tab === t && styles.segOn]}
              >
                <T
                  style={{
                    fontFamily: font.textMedium,
                    fontSize: 15,
                    color: tab === t ? color.gofun : color.gofun44,
                  }}
                >
                  {t === 'received' ? 'Received' : 'Sent'}
                </T>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </View>
  )

  const empty = !account ? null : history.isLoading && !data ? (
    <View style={{ gap: 12 }}>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} width="100%" height={72} radius={14} />
      ))}
    </View>
  ) : history.isError && !data ? (
    <StateBlock
      icon="refresh"
      title="Could not open the box"
      body="Solana devnet did not answer."
      action="Try again"
      onAction={() => void refreshNow(() => history.refetch())}
    />
  ) : tab === 'received' ? (
    <StateBlock
      icon="envelope"
      title="Nothing opened yet"
      body="Shake one open from the feed and it lands here."
      action="Go to the feed"
      onAction={() => router.navigate('/')}
    />
  ) : (
    <StateBlock
      icon="envelope"
      title="No packets sent yet"
      body="Drop one into a circle or the public feed."
      action="Send a packet"
      onAction={() => router.push('/send')}
    />
  )

  return (
    <View style={{ flex: 1 }}>
      <Backdrop glowY={0.12} />
      {/* rows are virtualized, keyed by packet and drawn without a canvas, so a long history stays cheap */}
      <FlatList
        data={rows}
        keyExtractor={rowKey}
        renderItem={renderRow}
        ItemSeparatorComponent={RowGap}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={
          account && data?.source === 'chain' ? (
            <Note icon="link" style={{ marginTop: space[5] }}>
              Read straight from Solana devnet. Names return when the Bao server is reachable.
            </Note>
          ) : null
        }
        initialNumToRender={10}
        windowSize={7}
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          paddingHorizontal: space[5],
          paddingBottom: space[6],
        }}
        refreshControl={
          account ? (
            <RefreshControl
              refreshing={refreshing}
              tintColor={color.kin300}
              colors={[color.kin300]}
              progressBackgroundColor={color.kuro800}
              onRefresh={async () => {
                setRefreshing(true)
                try {
                  await refreshNow(() => history.refetch())
                } finally {
                  setRefreshing(false)
                }
              }}
            />
          ) : undefined
        }
      />
    </View>
  )
}

function Stat({ label, value, sub, cjk }: { label: string; value: string; sub: string; cjk?: boolean }) {
  return (
    <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`${label}: ${value}`}>
      <T variant="caps">{label}</T>
      <T
        style={{
          fontFamily: font.numerals,
          fontSize: 26,
          lineHeight: 32,
          color: color.gofun,
          fontVariant: ['tabular-nums'],
        }}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </T>
      <T
        style={{
          fontFamily: cjk ? font.cjk : font.textNarrow,
          fontSize: cjk ? 12 : 12,
          color: cjk ? color.kin400 : color.gofun44,
        }}
      >
        {sub}
      </T>
    </View>
  )
}

/** A tiny lacquer envelope for list rows (a still image); opened ones show the cracked seal. */
function MiniEnvelope({ tone, open }: { tone: ReturnType<typeof toneFor>; open: boolean }) {
  return <EnvelopeThumb width={32} tone={tone} sealState={open ? 'cracked' : 'closed'} />
}

/** Only the first screenful slides in; rows recycled in while scrolling just appear. */
const rowEntering = (i: number) => (i < 8 ? FadeInDown.delay(i * 40).duration(300) : undefined)

const ReceivedRow = memo(function ReceivedRow({
  grab,
  packet,
  i,
}: {
  grab: GrabView
  packet: PacketView | null
  i: number
}) {
  const from = packet ? displayName(packet.senderSkr, packet.sender) : 'a packet'
  const king = packet?.mode === 'lucky' && packet.luckKing === grab.claimer
  return (
    <Animated.View entering={rowEntering(i)}>
      <Pressable
        onPress={() => router.push(`/packet/${grab.packet}`)}
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={`Grabbed from ${from}`}
      >
        <MiniEnvelope
          tone={packet ? (packet.skin === 'kuro' || packet.skin === 'jade' ? packet.skin : 'shu') : 'shu'}
          open
        />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <T style={{ fontFamily: font.displayItalic, fontSize: 17, color: color.gofun }} numberOfLines={1}>
              from {from}
            </T>
            {king ? <Icon name="crown" size={14} /> : null}
          </View>
          <T variant="meta" numberOfLines={1}>
            {packet ? (packet.mode === 'lucky' ? 'Lucky' : 'Equal') : ''}
            {grab.status === 'won' ? ' · paying out' : grab.status === 'pending' ? ' · drawing' : ''}
            {grab.at ? ` · ${timeAgo(grab.at)}` : ''}
          </T>
        </View>
        <T style={styles.amt}>{grab.amount ? `+${formatAmount(grab.amount, packet?.token.decimals ?? 6)}` : '···'}</T>
      </Pressable>
    </Animated.View>
  )
})

const SentRow = memo(function SentRow({ packet, i }: { packet: PacketView; i: number }) {
  const left = sharesLeft(packet)
  const status =
    packet.status === 'live'
      ? `${left} of ${packet.shares} left`
      : packet.status === 'scheduled'
        ? 'Rain scheduled'
        : packet.status === 'emptied'
          ? 'All grabbed'
          : packet.status === 'expired'
            ? 'Expired · returning'
            : 'Closed'
  return (
    <Animated.View entering={rowEntering(i)}>
      <Pressable
        onPress={() => router.push(`/packet/${packet.address}`)}
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={`Packet of ${formatAmount(packet.total)} tSKR, ${status}`}
      >
        <MiniEnvelope tone={toneFor(packet)} open={packet.status !== 'live' && packet.status !== 'scheduled'} />
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="bodyStrong" numberOfLines={1}>
            {packet.audience === 'open' ? 'Public' : packet.audience === 'circle' ? 'Circle' : 'Code word'} ·{' '}
            {packet.mode === 'lucky' ? 'Lucky' : 'Equal'}
          </T>
          <T
            variant="meta"
            style={{ color: packet.status === 'live' ? color.jade300 : color.gofun64 }}
            numberOfLines={1}
          >
            {status} · {timeAgo(packet.createdAt)}
          </T>
        </View>
        <T style={styles.amt}>{formatAmount(packet.total, packet.token.decimals)}</T>
      </Pressable>
    </Animated.View>
  )
})

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: space[3], alignItems: 'stretch' },
  vr: { width: StyleSheet.hairlineWidth, backgroundColor: color.kuro600 },
  seg: { flexDirection: 'row', gap: 22, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.kuro600 },
  segItem: {
    paddingVertical: 12,
    minHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
    marginBottom: -1,
  },
  segOn: { borderBottomColor: color.kin300 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    padding: space[3],
    paddingRight: space[4],
    borderRadius: radius.card,
    backgroundColor: 'rgba(23,17,18,0.85)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.kuro600,
    minHeight: 72,
  },
  amt: { fontFamily: font.numerals, fontSize: 24, color: color.gofun, fontVariant: ['tabular-nums', 'lining-nums'] },
})
