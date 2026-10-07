import type { PacketView } from '@bao/sdk'
import { useStore } from '@nanostores/react'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, {
  FadeIn,
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle, Path } from 'react-native-svg'

import { createCarouselFocus } from '@/features/bao/carousel-focus'
import { $onboarded } from '@/features/bao/data-access/prefs'
import { refreshNow, useCircles } from '@/features/bao/data-access/use-bao-api'
import { useChainStarter, useFeedData, useMyClaims } from '@/features/bao/data-access/use-bao-data'
import { useGenesisToken } from '@/features/bao/data-access/use-genesis-token'
import { chainPlace, displayName, formatAmount, plural, sharesLeft } from '@/features/bao/format'
import { PacketEnvelope } from '@/features/bao/ui/packet-envelope'
import { RainStrip } from '@/features/bao/ui/rain-strip'
import { Backdrop } from '@/ui/backdrop'
import { Countdown, useNow } from '@/ui/countdown'
import { ENVELOPE_RATIO } from '@/ui/envelope/envelope'
import { buzz } from '@/ui/feedback'
import { Icon } from '@/ui/icon'
import { Avatar, FoilButton, Note, SgtBadge, Skeleton, StateBlock } from '@/ui/kit'
import { useTiltGleam } from '@/ui/motion'
import { T } from '@/ui/text'
import { color, font, space } from '@/ui/tokens'

function liveLabel(packets: PacketView[], now: number) {
  const soon = packets.filter((p) => p.startsAt > now).length
  const live = packets.length - soon
  return soon ? `${live} live · ${soon} soon` : `${live} live`
}

type Filter = { kind: 'all' } | { kind: 'public' } | { kind: 'circle'; id: string; name: string }

export default function FeedScreen() {
  const onboarded = useStore($onboarded)
  const insets = useSafeAreaInsets()
  const { width: screenW, height: screenH } = useWindowDimensions()
  const { account } = useMobileWallet()
  const genesis = useGenesisToken(account?.address)
  const feed = useFeedData()
  const circles = useCircles()
  const params = useLocalSearchParams<{ focus?: string }>()
  const [filter, setFilter] = useState<Filter>({ kind: 'all' })
  const [refreshing, setRefreshing] = useState(false)

  const packets = useMemo(() => {
    const all = feed.data?.packets ?? []
    if (filter.kind === 'public') return all.filter((p) => p.audience === 'open')
    if (filter.kind === 'circle') return all.filter((p) => p.circleId === filter.id)
    return all
  }, [feed.data, filter])
  const rains = feed.data?.rains ?? []
  const now = useNow(10_000)
  const claims = useMyClaims(packets)

  // Size the hero so header → button fits one screen; rains sit just below the fold.
  const envW = Math.min(screenW * 0.6, Math.max(180, (screenH - insets.top - 470) / ENVELOPE_RATIO))
  const envH = envW * ENVELOPE_RATIO

  if (!onboarded) return <Redirect href="/onboarding" />

  const filterLabel = filter.kind === 'all' ? 'All packets' : filter.kind === 'public' ? 'Public' : filter.name
  const onChain = feed.data?.source === 'chain'

  return (
    <View style={{ flex: 1 }}>
      <Backdrop glowY={0.42} />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: space[6] }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={color.kin300}
            colors={[color.kin300]}
            progressBackgroundColor={color.kuro800}
            onRefresh={async () => {
              setRefreshing(true)
              try {
                await refreshNow(() => feed.refetch())
              } finally {
                setRefreshing(false)
              }
            }}
          />
        }
      >
        <Header verified={!!genesis.data} connected={!!account} />
        <Chips
          filter={filter}
          onChange={setFilter}
          circles={(circles.data ?? []).map((c) => ({ id: c.id, name: c.name }))}
        />
        <View style={styles.section}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <T variant="caps">
              {filterLabel} ·{' '}
              <T variant="caps" style={{ color: color.kin400 }}>
                {feed.isLoading ? '…' : liveLabel(packets, now)}
              </T>
            </T>
            {onChain ? <OnChainTag /> : null}
          </View>
          <FocusCounter total={packets.length} />
        </View>
        {rains.length ? <RainStrip rains={rains} /> : null}

        {feed.isLoading && !feed.data ? (
          <CarouselSkeleton envW={envW} envH={envH} screenW={screenW} />
        ) : feed.isError && !feed.data ? (
          <StateBlock
            icon="refresh"
            title="The feed did not load"
            body="Solana devnet did not answer. Check the connection and try again."
            action="Try again"
            onAction={() => void refreshNow(() => feed.refetch())}
          />
        ) : packets.length === 0 ? (
          <EmptyFeed hasRains={rains.length > 0} filter={filter} />
        ) : (
          <Carousel
            key={`${filter.kind}-${filter.kind === 'circle' ? filter.id : ''}`}
            packets={packets}
            envW={envW}
            envH={envH}
            screenW={screenW}
            claims={claims.data ?? {}}
            focus={params.focus}
          />
        )}

        {packets.length ? (
          <FoilButton
            label="Send a packet"
            icon="envelope"
            onPress={() => router.push('/send')}
            style={{ marginHorizontal: space[5], marginTop: space[4] }}
          />
        ) : null}

        {onChain ? (
          <Note style={{ marginHorizontal: space[5], marginTop: space[5] }} icon="link">
            Read straight from Solana devnet. Names, messages and circles come back when the Bao server is reachable.
          </Note>
        ) : null}
      </ScrollView>
    </View>
  )
}

function Header({ verified, connected }: { verified: boolean; connected: boolean }) {
  return (
    <View style={styles.header}>
      <View style={styles.word} accessible accessibilityRole="header" accessibilityLabel="Bao, red packets">
        <T variant="wordmark">Bao</T>
        <View style={styles.wordRule} />
        <T variant="cjk" style={{ fontSize: 14 }}>
          紅包
        </T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scan a packet or invite QR code"
          onPress={() => router.push('/scan')}
          hitSlop={8}
          style={styles.iconBtn}
        >
          <Icon name="scan" size={22} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={verified ? 'Your Seeker, verified' : connected ? 'Your wallet' : 'Connect your Seeker'}
          onPress={() => router.navigate('/seeker')}
          hitSlop={6}
        >
          <MeBadge verified={verified} connected={connected} />
        </Pressable>
      </View>
    </View>
  )
}

function MeBadge({ verified, connected }: { verified: boolean; connected: boolean }) {
  return (
    <Svg width={40} height={40} viewBox="0 0 38 38">
      <Circle cx="19" cy="19" r="18" fill="none" stroke={verified ? color.jade500 : color.kuro600} strokeWidth={1} />
      <Circle cx="19" cy="19" r="14.5" fill={color.kuro800} />
      <Circle cx="19" cy="16" r="5" fill="none" stroke={color.kin300} strokeWidth={1.1} />
      <Path d="M10.5 28.5 c2-5 15-5 17 0" fill="none" stroke={color.kin300} strokeWidth={1.1} />
      {!connected ? (
        <Circle cx="31" cy="7" r="3.2" fill={color.shu400} stroke={color.kuro950} strokeWidth={1.5} />
      ) : null}
    </Svg>
  )
}

function Chips({
  filter,
  onChange,
  circles,
}: {
  filter: Filter
  onChange: (f: Filter) => void
  circles: { id: string; name: string }[]
}) {
  const items: { key: string; label: string; f: Filter }[] = [
    { key: 'all', label: 'All', f: { kind: 'all' } },
    ...circles.map((c) => ({ key: c.id, label: c.name, f: { kind: 'circle', id: c.id, name: c.name } as Filter })),
    { key: 'public', label: 'Public', f: { kind: 'public' } },
  ]
  const active = filter.kind === 'circle' ? filter.id : filter.kind
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {items.map((it) => {
        const on = it.key === active
        return (
          <Pressable
            key={it.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => {
              buzz('select')
              onChange(it.f)
            }}
            style={styles.chip}
          >
            <T style={{ fontFamily: font.textMedium, fontSize: 15, color: on ? color.gofun : color.gofun44 }}>
              {it.label}
            </T>
            <View style={[styles.chipLine, { backgroundColor: on ? color.kin300 : 'transparent' }]} />
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

function OnChainTag() {
  return (
    <View style={styles.onchain} accessible accessibilityLabel="Showing packets read directly from Solana">
      <View style={styles.onchainDot} />
      <T variant="capsSmall" style={{ color: color.jade300 }}>
        on-chain
      </T>
    </View>
  )
}

// The carousel publishes its focused index here so the header counter can show "1 / 3".
const focusListeners = new Set<(i: number) => void>()
function FocusCounter({ total }: { total: number }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    focusListeners.add(setI)
    return () => {
      focusListeners.delete(setI)
    }
  }, [])
  if (!total) return null
  return <T variant="caps">{`${Math.min(i + 1, total)} / ${total}`}</T>
}

function Carousel({
  packets,
  envW,
  envH,
  screenW,
  claims,
  focus,
}: {
  packets: PacketView[]
  envW: number
  envH: number
  screenW: number
  claims: Record<string, string | null>
  focus?: string
}) {
  const gap = 12
  const itemW = envW + gap
  const side = (screenW - itemW) / 2
  const x = useSharedValue(0)
  const tilt = useTiltGleam(0.52)
  // The card at the centre, as the scroll offset reports it. The counter and the caption read
  // this and nothing else moves it, so the three always describe the same card.
  const [index, setIndex] = useState(0)
  const shown = useRef(0)
  const [centre] = useState(createCarouselFocus)
  const listRef = useRef<Animated.FlatList<PacketView>>(null)
  const gestureTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Carries out what `centre` asks for: a card to scroll to, or nothing. */
  const scrollToCard = (i: number | null, animated = false) => {
    if (i !== null) listRef.current?.scrollToOffset({ offset: i * itemW, animated })
  }
  const onOffset = (at: number) => {
    const i = centre.onOffset(at)
    if (i === shown.current) return
    shown.current = i
    setIndex(i)
    if (centre.gesturing) buzz('select')
  }
  const onScroll = useAnimatedScrollHandler((e) => {
    x.value = e.contentOffset.x
  })
  useAnimatedReaction(
    () => Math.round(x.value / itemW),
    (at, prev) => {
      if (at !== prev) runOnJS(onOffset)(at)
    },
  )
  useEffect(() => {
    focusListeners.forEach((l) => l(index))
  }, [index])

  // The list changed under the carousel (a packet came or went, the feed fell back to the chain
  // and its other order): keep the focused packet centred, or its slot if it left. The scroll is
  // only asked for here. A longer list is not laid out yet when it is, so the scroll is clamped
  // to the old width, and onContentSizeChange asks again.
  useEffect(() => {
    scrollToCard(centre.setKeys(packets.map((p) => p.address)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centre, packets, itemW])

  // jump to a just-dropped packet once; later refetches must not yank the carousel back
  const jumped = useRef<string | null>(null)
  useEffect(() => {
    if (!focus || jumped.current === focus || !packets.some((p) => p.address === focus)) return
    jumped.current = focus
    setTimeout(() => scrollToCard(centre.focusOn(focus), true), 300)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centre, focus, packets])

  // A drag and the fling after it belong to the user: nothing is scrolled under them, and the
  // card they land on becomes the one to keep.
  const endGesture = () => {
    if (gestureTimer.current) clearTimeout(gestureTimer.current)
    gestureTimer.current = null
    scrollToCard(centre.endGesture())
  }
  const endGestureIn = (ms: number) => {
    if (gestureTimer.current) clearTimeout(gestureTimer.current)
    gestureTimer.current = setTimeout(endGesture, ms)
  }
  useEffect(
    () => () => {
      if (gestureTimer.current) clearTimeout(gestureTimer.current)
    },
    [],
  )

  const current = packets[Math.min(index, packets.length - 1)]

  return (
    <Animated.View entering={FadeIn.duration(400)}>
      <Animated.FlatList
        ref={listRef}
        data={packets}
        keyExtractor={(p) => p.address}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={itemW}
        decelerationRate="fast"
        disableIntervalMomentum
        onScroll={onScroll}
        scrollEventThrottle={16}
        // every card is one itemW wide: the list is as wide as its data from the first layout
        getItemLayout={(_, i) => ({ length: itemW, offset: side + i * itemW, index: i })}
        onContentSizeChange={() => scrollToCard(centre.owed())}
        onScrollBeginDrag={() => {
          if (gestureTimer.current) clearTimeout(gestureTimer.current)
          centre.beginGesture()
        }}
        // a fling begins at once where there is one; if none does, the gesture ends here
        onScrollEndDrag={() => endGestureIn(400)}
        onMomentumScrollBegin={() => endGestureIn(3000)}
        onMomentumScrollEnd={endGesture}
        contentContainerStyle={{ paddingHorizontal: side, paddingTop: 18, paddingBottom: 26 }}
        style={{ height: envH + 44 }}
        renderItem={({ item, index: i }) => (
          <CarouselItem
            packet={item}
            i={i}
            x={x}
            itemW={itemW}
            envW={envW}
            tilt={tilt}
            grabbed={claims[item.address]}
          />
        )}
      />
      {current ? <Meta packet={current} grabbed={claims[current.address]} /> : null}
      <Dots count={packets.length} x={x} itemW={itemW} />
    </Animated.View>
  )
}

function CarouselItem({
  packet,
  i,
  x,
  itemW,
  envW,
  tilt,
  grabbed,
}: {
  packet: PacketView
  i: number
  x: SharedValue<number>
  itemW: number
  envW: number
  tilt: SharedValue<number>
  grabbed?: string | null
}) {
  const gleam = useDerivedValue(() => tilt.value + (x.value / itemW - i) * -0.35)
  const style = useAnimatedStyle(() => {
    const d = Math.min(1, Math.abs(x.value / itemW - i))
    return {
      opacity: 1 - d * 0.42,
      transform: [{ translateY: d * 14 }, { scale: 1 - d * 0.055 }],
    }
  })
  const name = displayName(packet.senderSkr, packet.sender)
  return (
    <Pressable
      onPress={() => {
        buzz('light')
        router.push(`/grab/${packet.address}`)
      }}
      accessibilityRole="button"
      accessibilityLabel={`${packet.mode === 'lucky' ? 'Lucky' : 'Equal'} packet from ${name}, ${formatAmount(packet.total, packet.token.decimals)} ${packet.token.symbol}, ${sharesLeft(packet)} of ${plural(packet.shares, 'share')} left${grabbed ? ', you already grabbed this one' : ''}`}
      accessibilityHint="Opens the packet"
      style={{ width: itemW, alignItems: 'center' }}
    >
      <Animated.View style={style}>
        <PacketEnvelope packet={packet} width={envW} gleam={gleam} grabbed={grabbed} />
      </Animated.View>
    </Pressable>
  )
}

function Meta({ packet, grabbed }: { packet: PacketView; grabbed?: string | null }) {
  const name = displayName(packet.senderSkr, packet.sender)
  const left = sharesLeft(packet)
  const now = useNow(5_000)
  const opensLater = packet.startsAt > now
  // a packet sent by a Luck King continues a chain: its place, and whose chain once that is known
  const inChain = packet.chainDepth >= 1
  const starter = useChainStarter(inChain ? packet.chainRoot : undefined).data
  const chain = inChain
    ? chainPlace(packet.chainDepth + 1, starter ? displayName(starter.senderSkr, starter.sender) : null)
    : null
  return (
    <Pressable
      onPress={() => router.push(`/packet/${packet.address}`)}
      accessibilityRole="button"
      accessibilityLabel={`Details of ${name}'s packet${chain ? `, ${chain}` : ''}`}
      style={styles.meta}
    >
      <View style={styles.metaRow}>
        <View style={styles.who}>
          <Avatar name={name} size={32} />
          <T
            style={{
              fontFamily: packet.senderSkr ? font.textMedium : font.textMedium,
              fontSize: 16,
              color: color.gofun,
            }}
            numberOfLines={1}
          >
            {name}
          </T>
          {packet.seekerOnly ? <SgtBadge /> : null}
        </View>
        <Countdown to={opensLater ? packet.startsAt : packet.expiresAt} style={{ fontSize: 30, lineHeight: 34 }} />
      </View>
      <View style={[styles.metaRow, { marginTop: 8 }]}>
        <T variant="meta" style={{ flexShrink: 1 }} numberOfLines={1}>
          {grabbed ? (
            <T variant="meta" style={{ color: color.jade300 }}>
              You grabbed {formatAmount(grabbed, packet.token.decimals)} {packet.token.symbol} ·{' '}
            </T>
          ) : null}
          <T variant="meta" style={{ fontFamily: font.textSemi, color: color.gofun }}>
            {left} of {packet.shares}
          </T>{' '}
          shares left · {packet.mode === 'lucky' ? 'Lucky split' : 'Equal split'}
        </T>
        <T variant="meta" style={opensLater ? { color: color.kin300 } : undefined}>
          {opensLater ? 'until it rains' : 'until it closes'}
        </T>
      </View>
      {chain ? (
        <View style={styles.chain}>
          <Icon name="crown" size={14} />
          <T variant="capsSmall" style={{ color: color.kin300, flexShrink: 1 }} numberOfLines={1}>
            {chain}
          </T>
        </View>
      ) : null}
      {packet.message ? (
        <T
          style={{ fontFamily: font.displayItalic, fontSize: 15, lineHeight: 20, color: color.gofun64, marginTop: 8 }}
          numberOfLines={2}
        >
          “{packet.message}”
        </T>
      ) : null}
    </Pressable>
  )
}

function Dots({ count, x, itemW }: { count: number; x: SharedValue<number>; itemW: number }) {
  if (count < 2) return null
  const shown = Math.min(count, 7)
  return (
    <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: shown }, (_, i) => (
        <Dot key={i} i={i} x={x} itemW={itemW} />
      ))}
    </View>
  )
}

function Dot({ i, x, itemW }: { i: number; x: SharedValue<number>; itemW: number }) {
  const style = useAnimatedStyle(() => {
    const d = Math.min(1, Math.abs(x.value / itemW - i))
    return { width: 26 - d * 16, backgroundColor: d < 0.5 ? color.kin300 : color.kuro600 }
  })
  return <Animated.View style={[styles.dot, style]} />
}

function CarouselSkeleton({ envW, envH, screenW }: { envW: number; envH: number; screenW: number }) {
  return (
    <View style={{ height: envH + 44 + 96, paddingTop: 18 }} accessibilityLabel="Loading packets">
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12 }}>
        <Skeleton
          width={envW * 0.94}
          height={envH * 0.94}
          style={{ marginTop: 14, marginLeft: -(envW * 0.94) + (screenW - envW) / 2 - 12 }}
        />
        <Skeleton width={envW} height={envH} />
        <Skeleton width={envW * 0.94} height={envH * 0.94} style={{ marginTop: 14 }} />
      </View>
      <View style={{ paddingHorizontal: space[5], marginTop: 30, gap: 10 }}>
        <Skeleton width="60%" height={18} />
        <Skeleton width="80%" height={12} />
      </View>
    </View>
  )
}

function EmptyFeed({ hasRains, filter }: { hasRains: boolean; filter: Filter }) {
  return (
    <Animated.View entering={FadeIn.duration(400)} style={{ paddingTop: space[4] }}>
      <StateBlock
        icon="envelope"
        title={
          hasRains
            ? 'Nothing open right now'
            : filter.kind === 'circle'
              ? `Quiet in ${filter.name}`
              : 'No packets in the air'
        }
        body={
          hasRains
            ? 'A rain is on its way. Set a reminder above, or drop a packet of your own.'
            : 'Be the one who starts it. Drop a packet and the first Seeker to shake gets lucky.'
        }
        action="Send the first packet"
        onAction={() => router.push('/send')}
        secondary="Get test tokens"
        onSecondary={() => router.navigate('/seeker')}
      />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[5],
    paddingTop: 6,
  },
  word: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  wordRule: { width: 1, height: 16, backgroundColor: 'rgba(221,187,122,0.35)', marginTop: 6 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  chips: { paddingHorizontal: space[5], gap: 22, paddingTop: 14 },
  chip: { minHeight: 44, justifyContent: 'center', paddingTop: 4 },
  chipLine: { height: 1, marginTop: 8 },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[5],
    marginTop: 12,
  },
  onchain: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  onchainDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: color.jade300 },
  meta: { paddingHorizontal: space[5] },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  chain: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 18 },
  dot: { height: 1, width: 10 },
})
