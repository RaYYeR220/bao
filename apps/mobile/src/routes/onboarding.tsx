import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { FlatList, StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { $onboarded } from '@/features/bao/data-access/prefs'
import { humanError, WalletRejectedError } from '@/features/bao/data-access/send-with-wallet'
import { ApiUnavailableError } from '@/features/bao/data-access/use-bao-api'
import { useBaoSignIn, useFaucet } from '@/features/bao/data-access/use-bao-sign-in'
import { shortAddress } from '@/features/bao/format'
import { ShakeLines } from '@/features/bao/ui/shake-lines'
import { Backdrop } from '@/ui/backdrop'
import { EnvelopeFace } from '@/ui/envelope/envelope'
import { buzz, play } from '@/ui/feedback'
import { FoilButton, Note, SgtBadge, TextButton } from '@/ui/kit'
import { useReducedMotion, useTiltGleam } from '@/ui/motion'
import { T } from '@/ui/text'
import { color, font, space } from '@/ui/tokens'

const PANELS = [
  {
    kicker: '紅包 · red packets',
    title: 'Lucky money,\nfor Seekers',
    body: 'Drop a packet of SKR into your circle or the public feed. Friends get a nudge and shake their phone to grab a share.',
  },
  {
    kicker: 'One Seeker, one grab',
    title: 'Bots are refused\nby the program',
    body: 'Every grab is bound on-chain to the phone’s Seeker Genesis Token. A second wallet, an emulator farm, a script: the program says no.',
  },
  {
    kicker: 'Shake to open',
    title: 'Three shakes\ncrack the seal',
    body: 'Lucky packets draw your share with provable randomness. The biggest grab is crowned Luck King, and by custom sends the next one.',
  },
]

function finish() {
  $onboarded.set(true)
  router.replace('/')
}

export default function Onboarding() {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [page, setPage] = useState(0)
  const list = useRef<FlatList>(null)
  const steps = PANELS.length + 1

  const go = (i: number) => {
    list.current?.scrollToIndex({ index: i, animated: true })
    setPage(i)
  }

  return (
    <View style={{ flex: 1 }}>
      <Backdrop glowY={0.36} variant="stage" />
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <View style={styles.progress} accessibilityLabel={`Step ${page + 1} of ${steps}`}>
          {Array.from({ length: steps }, (_, i) => (
            <View key={i} style={[styles.bar, { backgroundColor: i <= page ? color.kin300 : color.kuro600, width: i === page ? 26 : 12 }]} />
          ))}
        </View>
        <TextButton label="Skip" tone="muted" onPress={finish} />
      </View>
      <FlatList
        ref={list}
        data={[...PANELS.map((_, i) => ({ key: `p${i}`, i })), { key: 'connect', i: PANELS.length }]}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / width)
          if (i !== page) buzz('select')
          setPage(i)
        }}
        renderItem={({ item }) =>
          item.i < PANELS.length ? (
            <Panel index={item.i} width={width} active={page === item.i} />
          ) : (
            <ConnectStep width={width} active={page === item.i} />
          )
        }
      />
      {page < PANELS.length ? (
        <View style={[styles.bottom, { paddingBottom: insets.bottom + space[5] }]}>
          <FoilButton label={page === PANELS.length - 1 ? 'Connect your Seeker' : 'Next'} onPress={() => go(page + 1)} />
        </View>
      ) : null}
    </View>
  )
}

function Panel({ index, width, active }: { index: number; width: number; active: boolean }) {
  const p = PANELS[index]
  const { height } = useWindowDimensions()
  const envW = Math.min(width * 0.5, (height * 0.4) / 1.748)
  return (
    <View style={[styles.panel, { width }]}>
      <View style={styles.art}>
        {index === 0 ? <Hero envW={envW} /> : index === 1 ? <Bound envW={envW} /> : <Shake envW={envW} active={active} />}
      </View>
      <View style={styles.copy}>
        <T variant="caps" style={{ color: color.kin400 }}>
          {p.kicker}
        </T>
        <T style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
          {p.title}
        </T>
        <T variant="body" style={{ fontSize: 16, lineHeight: 23 }}>
          {p.body}
        </T>
      </View>
    </View>
  )
}

function Hero({ envW }: { envW: number }) {
  const gleam = useTiltGleam(0.5)
  return (
    <Animated.View entering={FadeInDown.duration(700)}>
      <EnvelopeFace width={envW} tone="shu" gleam={gleam} ticks={{ total: 12, left: 12 }} />
    </Animated.View>
  )
}

function Bound({ envW }: { envW: number }) {
  const gleam = useTiltGleam(0.45)
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: envW * 1.5, height: envW * 1.748, alignItems: 'center' }}>
        <View style={{ position: 'absolute', left: 0, top: envW * 0.12, transform: [{ rotate: '-7deg' }], opacity: 0.5 }}>
          <EnvelopeFace width={envW * 0.82} tone="kuro" gleam={gleam} sealState="cracked" />
        </View>
        <View style={{ position: 'absolute', right: 0 }}>
          <EnvelopeFace width={envW} tone="jade" gleam={gleam} ticks={{ total: 8, left: 5 }} />
        </View>
      </View>
      <View style={styles.postmark}>
        <SgtBadge label="Bound to one Seeker" />
      </View>
    </View>
  )
}

function Shake({ envW, active }: { envW: number; active: boolean }) {
  const gleam = useTiltGleam(0.55)
  const ring = useSharedValue(0)
  const tilt = useSharedValue(0)
  const reduced = useReducedMotion()
  useEffect(() => {
    if (!active) return
    const third = (n: number) => withTiming(n / 3, { duration: 260, easing: Easing.out(Easing.cubic) })
    ring.value = withRepeat(
      withSequence(withDelay(500, third(1)), withDelay(500, third(2)), withDelay(500, third(3)), withDelay(1100, withTiming(0, { duration: 400 }))),
      -1,
    )
    if (!reduced) {
      const kick = (deg: number) =>
        withSequence(withTiming(deg, { duration: 60 }), withTiming(-deg, { duration: 80 }), withTiming(deg * 0.5, { duration: 70 }), withTiming(0, { duration: 90 }))
      tilt.value = withRepeat(
        withSequence(withDelay(440, kick(2)), withDelay(200, kick(3.5)), withDelay(200, kick(5)), withDelay(1240, withTiming(0, { duration: 10 }))),
        -1,
      )
    }
  }, [active, reduced, ring, tilt])
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${tilt.value}deg` }] }))
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <ShakeLines side="left" envW={envW} />
      <Animated.View style={style}>
        <EnvelopeFace width={envW} tone="shu" gleam={gleam} ring={ring} ticks={{ total: 12, left: 8 }} />
      </Animated.View>
      <ShakeLines side="right" envW={envW} />
    </View>
  )
}

function ConnectStep({ width, active }: { width: number; active: boolean }) {
  const insets = useSafeAreaInsets()
  const wallet = useMobileWallet()
  const signIn = useBaoSignIn()
  const faucet = useFaucet()
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const connected = !!wallet.account
  const gleam = useTiltGleam(0.5)
  const { height } = useWindowDimensions()
  const envW = Math.min(width * 0.34, (height * 0.24) / 1.748)

  const connect = async () => {
    setError(null)
    try {
      const res = await signIn.mutateAsync()
      setOffline(!res.serverReachable)
      buzz('success')
      play('soft')
    } catch (e) {
      if (e instanceof WalletRejectedError || /reject|declin|cancel/i.test(String(e))) setError('No problem. Connect whenever you are ready.')
      else setError(humanError(e))
    }
  }

  const getTokens = async () => {
    setError(null)
    try {
      await faucet.mutateAsync()
      buzz('success')
      play('shimmer')
    } catch (e) {
      if (e instanceof ApiUnavailableError) setOffline(true)
      else setError(e instanceof Error ? e.message : 'The faucet did not answer.')
    }
  }

  return (
    <View style={[styles.panel, { width, paddingBottom: insets.bottom + space[5] }]}>
      <View style={[styles.art, { flex: 0.75 }]}>
        {active ? (
          <Animated.View entering={FadeIn.duration(500)}>
            <EnvelopeFace width={envW} tone={connected ? 'jade' : 'shu'} gleam={gleam} />
          </Animated.View>
        ) : null}
      </View>
      <View style={[styles.copy, { flex: 1.25 }]}>
        {!connected ? (
          <>
            <T variant="caps" style={{ color: color.kin400 }}>
              Connect
            </T>
            <T style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
              Sign in with{'\n'}your Seeker
            </T>
            <T variant="body" style={{ fontSize: 16, lineHeight: 23 }}>
              One approval in your wallet connects Bao and proves the phone is yours. Nothing moves until you grab or drop.
            </T>
            <View style={{ flex: 1 }} />
            {error ? <Note tone="shu">{error}</Note> : null}
            <FoilButton label="Connect your Seeker" icon="wallet" busy={signIn.isPending} onPress={() => void connect()} />
            <TextButton label="Look around first" tone="muted" onPress={finish} />
          </>
        ) : (
          <>
            <T variant="caps" style={{ color: color.jade300 }}>
              Connected · {shortAddress(wallet.account?.address)}
            </T>
            <T style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
              Get test{'\n'}tokens
            </T>
            <T variant="body" style={{ fontSize: 16, lineHeight: 23 }}>
              Bao runs on Solana devnet. The playground faucet sends test SOL, tSKR and a test Genesis token, so you can grab and drop for free.
            </T>
            <View style={{ flex: 1 }} />
            {faucet.isSuccess ? (
              <Note tone="jade" icon="check">
                {[faucet.data.sol && 'Test SOL', faucet.data.tskr && 'tSKR', faucet.data.genesis && 'a test Genesis token'].filter(Boolean).join(', ') ||
                  'Tokens'}{' '}
                on the way to your wallet.
              </Note>
            ) : null}
            {offline ? (
              <Note>The faucet lives on the Bao server, which is unreachable right now. Everything on-chain still works; try it later from the Seeker tab.</Note>
            ) : null}
            {error ? <Note tone="shu">{error}</Note> : null}
            {faucet.isSuccess ? (
              <FoilButton label="Open the feed" onPress={finish} />
            ) : (
              <FoilButton label="Get test tokens" icon="drop" busy={faucet.isPending} onPress={() => void getTokens()} />
            )}
            {!faucet.isSuccess ? <TextButton label={offline ? 'Continue to the feed' : 'Skip for now'} tone="muted" onPress={finish} /> : null}
          </>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[5],
  },
  progress: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  bar: { height: 1.5, borderRadius: 1 },
  panel: { flex: 1, paddingHorizontal: space[5] },
  art: { flex: 1.15, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: space[5], paddingTop: 90 },
  copy: { flex: 1, gap: space[3], paddingTop: space[2] },
  title: { fontFamily: font.display, fontSize: 38, lineHeight: 44, color: color.gofun, letterSpacing: -0.5 },
  bottom: { paddingHorizontal: space[5] },
  postmark: { marginTop: space[4] },
})
