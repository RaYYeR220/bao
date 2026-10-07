import {
  BAO_ERROR__ALREADY_GRABBED_ON_THIS_DEVICE,
  BAO_ERROR__NOT_A_SEEKER,
  BAO_ERROR__WRONG_CODE,
  BAO_ERROR__WRONG_SGT_GROUP,
  type GrabView,
  type PacketDetail,
} from '@bao/sdk'
import { useStore } from '@nanostores/react'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import * as Notifications from 'expo-notifications'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, Share, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native'
import Animated, { FadeIn, FadeInDown, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { packetLink } from '@/features/bao/data-access/bao-config'
import { $reminders } from '@/features/bao/data-access/prefs'
import { maybeAskForPush } from '@/features/bao/data-access/push'
import { refreshNow, useCircles } from '@/features/bao/data-access/use-bao-api'
import { useMyClaim, usePacketData } from '@/features/bao/data-access/use-bao-data'
import { useGenesisToken } from '@/features/bao/data-access/use-genesis-token'
import { useGrab, type GrabPhase } from '@/features/bao/data-access/use-grab'
import { useShakeSteps } from '@/features/bao/data-access/use-shake'
import {
  clockTime,
  displayName,
  explorerTx,
  formatAmount,
  ordinal,
  plural,
  sharesLeft,
  shortAddress,
} from '@/features/bao/format'
import { isPacketAddress } from '@/features/bao/links'
import { BadLink } from '@/features/bao/ui/bad-link'
import { GoldLeafBurst } from '@/features/bao/ui/gold-leaf'
import { GrabStage, stageGeometry, type StageMode } from '@/features/bao/ui/grab-stage'
import { toneFor } from '@/features/bao/ui/packet-envelope'
import { ResultCard, SealedCard } from '@/features/bao/ui/result-card'
import { Backdrop } from '@/ui/backdrop'
import { Countdown } from '@/ui/countdown'
import { buzz, play } from '@/ui/feedback'
import { Icon } from '@/ui/icon'
import { ExplorerLink, FoilButton, Note, RoundButton, SgtBadge, Skeleton, StateBlock, TextButton } from '@/ui/kit'
import { useLoop, useTiltGleam } from '@/ui/motion'
import { Sheet } from '@/ui/sheet'
import { T } from '@/ui/text'
import { color, font, radius, space } from '@/ui/tokens'
import { describeProgramErrorName } from '@/features/bao/data-access/program-errors'

const close = () => (router.canGoBack() ? router.back() : router.replace('/'))
/** How long a partly shaken packet keeps its progress: long enough for a pause or a slow frame. */
const SHAKE_KEEP_MS = 5000

export default function GrabScreen() {
  const { address, code: codeParam } = useLocalSearchParams<{ address: string; code?: string }>()
  const valid = isPacketAddress(address)
  const packetQ = usePacketData(valid ? address : undefined)
  const detail = packetQ.data?.detail ?? null

  if (!valid) return <BadLink kind="packet" />
  if (packetQ.isLoading && !packetQ.data) return <Loading />
  if (packetQ.isError && !packetQ.data)
    return (
      <Shell>
        <StateBlock
          icon="refresh"
          title="Could not reach Solana"
          body="The packet could not be read just now. Check the connection and try again."
          action="Try again"
          onAction={() => void refreshNow(() => packetQ.refetch())}
          secondary="Close"
          onSecondary={close}
        />
      </Shell>
    )
  if (!detail)
    return (
      <Shell>
        <StateBlock
          icon="envelope"
          title="This packet is closed"
          body="Every share was taken or it expired, and its sender has already swept it up."
          action="Back to the feed"
          onAction={close}
        />
      </Shell>
    )
  return <Grab key={address} detail={detail} initialCode={codeParam} />
}

function Grab({ detail, initialCode }: { detail: PacketDetail; initialCode?: string }) {
  const insets = useSafeAreaInsets()
  const { width: screenW, height: screenH } = useWindowDimensions()
  const wallet = useMobileWallet()
  const headerBottom = insets.top + 76
  const geo = useMemo(() => stageGeometry(screenW, screenH, headerBottom), [screenW, screenH, headerBottom])

  const [code, setCode] = useState<string | undefined>(initialCode)
  const [codeOpen, setCodeOpen] = useState(false)
  const { phase, grab, collect, reset } = useGrab(detail.address, code)
  const mine = useMyClaim(detail.address, detail.seekerOnly)

  const [mountedAt] = useState(() => Math.floor(Date.now() / 1000))
  const [opened, setOpened] = useState(() => detail.startsAt <= mountedAt)
  useEffect(() => {
    if (opened) return
    const t = setTimeout(() => setOpened(true), Math.max(0, detail.startsAt * 1000 - Date.now()) + 300)
    return () => clearTimeout(t)
  }, [detail.startsAt, opened])
  const scheduled = !opened
  const spent = detail.status === 'emptied' || detail.status === 'expired'
  const alreadyMine =
    !!mine.data &&
    mine.data.data.status !== 0 &&
    (phase.kind === 'idle' || (phase.kind === 'refused' && phase.code === BAO_ERROR__ALREADY_GRABBED_ON_THIS_DEVICE))
  const needsCode = detail.audience === 'code' && !code

  // shake progress: thirds of the foil ring, drained if the shaking stops for a while
  const ring = useSharedValue(0)
  const [steps, setSteps] = useState(0)
  const [trembleKey, setTrembleKey] = useState(0)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // only once we know whether this phone already grabbed (unknowable until a wallet is connected).
  // A wallet with no Genesis Token has no claim to look up on a Seeker-only packet: it may try,
  // and the program refuses it.
  const genesis = useGenesisToken(wallet.account?.address)
  const noDeviceKey = detail.seekerOnly && genesis.isFetched && !genesis.data
  const claimKnown = !wallet.account || mine.isFetched || noDeviceKey
  const canShake = phase.kind === 'idle' && !scheduled && !spent && !alreadyMine && claimKnown

  const step = useCallback(() => {
    if (!canShake) return
    if (needsCode) {
      setCodeOpen(true)
      return
    }
    setSteps((n) => Math.min(3, n + 1))
    setTrembleKey((k) => k + 1)
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setSteps((n) => (n >= 3 ? n : 0)), SHAKE_KEEP_MS)
  }, [canShake, needsCode])

  // each step fills a third of the foil ring; the third one opens the wallet
  useEffect(() => {
    if (steps === 0) return
    if (steps < 3) {
      play('tick')
      buzz(steps === 1 ? 'light' : 'medium')
      return
    }
    buzz('heavy')
    AccessibilityInfo.announceForAccessibility('Opening. Confirm in your wallet.')
    const t = setTimeout(() => {
      void grab()
      setSteps(0)
    }, 240)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps])
  useShakeSteps(canShake && !codeOpen, step)

  // the ring: shake progress while idle, full while the grab is in flight, empty after a refusal
  const ringSteps = phase.kind === 'idle' ? steps : phase.kind === 'refused' || phase.kind === 'error' ? 0 : 3
  useEffect(() => {
    ring.value = withTiming(ringSteps / 3, { duration: ringSteps ? 260 : 600 })
  }, [ring, ringSteps])
  useEffect(() => {
    if (phase.kind === 'refused') buzz('error')
  }, [phase.kind])

  const gleam = useTiltGleam(0.42)
  const unsealing = phase.kind === 'unsealing'
  const time = useLoop(unsealing || phase.kind === 'confirming', 2800)
  const shimmer = useSharedValue(0)
  useEffect(() => {
    shimmer.value = withTiming(unsealing ? 1 : phase.kind === 'confirming' ? 0.45 : 0, { duration: 500 })
  }, [phase.kind, shimmer, unsealing])

  const mode: StageMode =
    phase.kind === 'unsealing'
      ? 'peek'
      : phase.kind === 'revealed'
        ? 'out'
        : alreadyMine
          ? 'static-out'
          : phase.kind === 'refused'
            ? 'refused'
            : 'sealed'

  const [landed, setLanded] = useState(false)
  const [burst, setBurst] = useState(0)
  const onSettled = useCallback(() => {
    setLanded(true)
    if (phase.kind === 'revealed') {
      setBurst((b) => b + 1)
      play('shimmer')
      buzz('success')
      // ask for notifications once the moment has landed, not on top of it
      setTimeout(() => void maybeAskForPush(), 4500)
    }
  }, [phase.kind])

  const name = displayName(detail.senderSkr, detail.sender)
  const symbol = detail.token.symbol
  const decimals = detail.token.decimals

  // the result, either fresh from this grab or the one this phone made earlier
  const result = useMemo(() => {
    if (phase.kind === 'revealed')
      return { amount: phase.amount, isKing: phase.isLuckKingSoFar, signature: phase.signature as string }
    if (alreadyMine && mine.data) {
      const king = detail.luckKing === wallet.account?.address
      const g = detail.grabs.find((x) => x.deviceKey === mine.data!.data.deviceKey)
      return { amount: mine.data.data.amount, isKing: king, signature: g?.grabSignature ?? null }
    }
    return null
  }, [alreadyMine, detail, mine.data, phase, wallet.account?.address])

  const myGrab: GrabView | undefined = useMemo(() => {
    const sig = result?.signature
    return detail.grabs.find(
      (g) => (sig && g.grabSignature === sig) || (mine.data && g.deviceKey === mine.data.data.deviceKey),
    )
  }, [detail.grabs, mine.data, result?.signature])

  // the envelope keeps its lacquer for whoever opened it; spectators of a spent packet see ash
  const tone = spent && !result ? 'ash' : toneFor({ skin: detail.skin, status: 'live' })

  const rankLine = useMemo(() => {
    if (!result) return ''
    const resolved = detail.grabs.filter((g) => g.amount !== null)
    const count = Math.max(resolved.length, 1)
    const bigger = resolved.filter((g) => BigInt(g.amount!) > result.amount).length
    const packetLine = `${name}’s ${formatAmount(detail.total, decimals)} ${symbol} packet`
    const finished = detail.resolved >= detail.shares || detail.status === 'closed'
    const soFar = finished ? '' : ' so far'
    if (detail.mode === 'equal') return `an equal share of ${packetLine}`
    if (detail.shares === 1) return `all of ${packetLine}`
    if (bigger === 0) return `biggest of ${plural(count, 'grab')}${soFar} in ${packetLine}`
    return `${ordinal(bigger + 1)} of ${count}${soFar} in ${packetLine}`
  }, [decimals, detail, name, result, symbol])

  const sendNext = () =>
    router.push({ pathname: '/send', params: { parent: detail.address, parentRefund: detail.sender } })

  const renderCard = (where: 'inside' | 'front') =>
    result ? (
      <ResultCard
        width={geo.card.width}
        height={geo.card.height}
        amount={result.amount}
        decimals={decimals}
        symbol={symbol}
        landed={landed && where === 'front'}
        isKing={result.isKing && detail.mode === 'lucky'}
        kicker={alreadyMine ? 'You grabbed earlier' : 'You grabbed'}
        headline={
          result.isKing && detail.mode === 'lucky'
            ? detail.resolved >= detail.shares
              ? 'Luck King'
              : 'Luck King so far'
            : detail.mode === 'lucky'
              ? 'Lucky share'
              : 'Equal share'
        }
        detail={rankLine}
        postmark={[
          detail.seekerOnly ? 'Seeker-bound' : 'Grabbed',
          clockTime(myGrab?.at || mountedAt),
          result.signature ? `tx ${shortAddress(result.signature, 3)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')
          .toUpperCase()}
        rightAction={
          result.isKing && detail.mode === 'lucky' ? { label: 'Send the next', onPress: sendNext } : undefined
        }
      />
    ) : (
      <SealedCard width={geo.card.width} height={geo.card.height} />
    )

  const face = (
    <PocketFace
      envW={geo.envW}
      kicker={
        scheduled
          ? 'Opens in'
          : spent
            ? detail.status === 'expired'
              ? 'Expired'
              : 'All grabbed'
            : needsCode
              ? 'Code word needed'
              : `Shake to open · ${steps} / 3`
      }
      name={name}
      line={`${formatAmount(detail.total, decimals)} ${symbol} · ${sharesLeft(detail)} of ${detail.shares} left`}
      startsAt={scheduled ? detail.startsAt : undefined}
      tone={tone}
    />
  )

  return (
    <View style={{ flex: 1 }}>
      <Backdrop glowY={0.32} variant="stage" />
      <Header detail={detail} name={name} top={insets.top} />
      <GrabStage
        geo={geo}
        tone={tone}
        gleam={gleam}
        ring={ring}
        ticks={{ total: detail.shares, left: sharesLeft(detail) }}
        mode={mode}
        face={face}
        renderCard={renderCard}
        shimmer={shimmer}
        time={time}
        trembleKey={trembleKey}
        onSealPress={canShake ? step : undefined}
        sealLabel={canShake ? `Open the packet, ${steps} of 3` : 'The seal'}
        onSettled={onSettled}
      />
      {burst ? <GoldLeafBurst fire={burst} origin={{ x: screenW / 2, y: geo.card.top + 10 }} /> : null}

      <Bottom
        phase={phase}
        geo={geo}
        insetsBottom={insets.bottom}
        detail={detail}
        scheduled={scheduled}
        spent={spent}
        needsCode={needsCode}
        alreadyMine={alreadyMine}
        landed={landed}
        myGrab={myGrab}
        resultSignature={result?.signature ?? null}
        isKing={!!result?.isKing && detail.mode === 'lucky'}
        onTap={step}
        onCode={() => setCodeOpen(true)}
        onRetry={() => {
          reset()
          setSteps(0)
        }}
        onCollect={() => void collect()}
        onSendNext={sendNext}
      />

      <CodeSheet
        key={codeOpen ? 'open' : 'closed'}
        visible={codeOpen}
        hint={detail.codeHint}
        onClose={() => setCodeOpen(false)}
        onSubmit={(c) => {
          setCode(c)
          setCodeOpen(false)
          if (phase.kind === 'refused') reset()
          buzz('select')
        }}
      />
    </View>
  )
}

function Header({ detail, name, top }: { detail: PacketDetail; name: string; top: number }) {
  const circles = useCircles()
  const circleName = circles.data?.find((c) => c.id === detail.circleId)?.name
  const where =
    detail.audience === 'open'
      ? detail.startsAt > detail.createdAt + 5
        ? 'Public rain'
        : 'Public'
      : detail.audience === 'code'
        ? 'Code word'
        : (circleName ?? 'Circle')
  return (
    <View style={[styles.header, { paddingTop: top + 10 }]}>
      <RoundButton icon="close" label="Close" onPress={close} />
      <View style={{ alignItems: 'center', flex: 1, gap: 3 }}>
        <T variant="caps" numberOfLines={1}>
          {where} · {detail.mode === 'lucky' ? 'Lucky split' : 'Equal split'}
        </T>
        <T
          style={{ fontFamily: font.displayItalic, fontSize: 18, lineHeight: 22, color: color.gofun }}
          numberOfLines={1}
        >
          from {name}
        </T>
      </View>
      <View style={{ width: 64, alignItems: 'flex-end' }}>{detail.seekerOnly ? <SgtBadge /> : null}</View>
    </View>
  )
}

function PocketFace({
  envW,
  kicker,
  name,
  line,
  startsAt,
  tone,
}: {
  envW: number
  kicker: string
  name: string
  line: string
  startsAt?: number
  tone: string
}) {
  const s = envW / 230
  const muted = tone === 'ash'
  return (
    <View style={{ position: 'absolute', left: 12, right: 12, top: 222 * s, alignItems: 'center' }}>
      <T
        variant="capsSmall"
        style={{ color: muted ? '#B5ACA8' : color.kin300, fontSize: 10 * Math.max(1, s * 0.95), letterSpacing: 3 }}
      >
        {kicker}
      </T>
      {startsAt ? (
        <Countdown
          to={startsAt}
          style={{ fontFamily: font.numerals, fontSize: 40 * s, lineHeight: 46 * s, color: color.gofun, marginTop: 4 }}
        />
      ) : (
        <T
          style={{
            fontFamily: font.displayItalic,
            fontSize: 30 * s,
            lineHeight: 38 * s,
            color: muted ? '#C9C1BC' : color.gofun,
            marginTop: 6,
          }}
          numberOfLines={1}
          adjustsFontSizeToFit
          maxFontSizeMultiplier={1.1}
        >
          {name}
        </T>
      )}
      <T
        style={{ fontFamily: font.textNarrow, fontSize: 12 * s, color: 'rgba(244,239,230,0.7)', marginTop: 2 }}
        numberOfLines={1}
      >
        {line}
      </T>
    </View>
  )
}

function Bottom({
  phase,
  geo,
  insetsBottom,
  detail,
  scheduled,
  spent,
  needsCode,
  alreadyMine,
  landed,
  myGrab,
  resultSignature,
  isKing,
  onTap,
  onCode,
  onRetry,
  onCollect,
  onSendNext,
}: {
  phase: GrabPhase
  geo: ReturnType<typeof stageGeometry>
  insetsBottom: number
  detail: PacketDetail
  scheduled: boolean
  spent: boolean
  needsCode: boolean
  alreadyMine: boolean
  landed: boolean
  myGrab?: GrabView
  resultSignature: string | null
  isKing: boolean
  onTap: () => void
  onCode: () => void
  onRetry: () => void
  onCollect: () => void
  onSendNext: () => void
}) {
  const reminders = useStore($reminders)
  const showResult = (phase.kind === 'revealed' || alreadyMine) && landed
  const sealedBottom = geo.sealedTop + geo.envW * 1.748 + 18
  const top = showResult ? geo.card.top + geo.card.height + 18 : sealedBottom

  let content: React.ReactNode = null
  if (showResult) {
    const payout = phase.kind === 'revealed' ? phase.payout : 'paid'
    content = (
      <Animated.View entering={FadeInDown.duration(500)} style={{ gap: space[3] }}>
        <View style={styles.links}>
          {resultSignature ? <ExplorerLink label="Grab tx" url={explorerTx(resultSignature)} /> : null}
          {myGrab?.callbackSignature ? (
            <ExplorerLink label="Randomness proof" url={explorerTx(myGrab.callbackSignature)} />
          ) : null}
          {phase.kind === 'revealed' && phase.payoutSignature ? (
            <ExplorerLink label="Payout" url={explorerTx(phase.payoutSignature)} />
          ) : null}
        </View>
        {payout === 'unpaid' || payout === 'collecting' ? (
          <Note
            icon="wallet"
            action={payout === 'collecting' ? undefined : 'Collect to my wallet'}
            onAction={onCollect}
          >
            {payout === 'collecting'
              ? 'Confirm the payout in your wallet…'
              : 'Your share is won and reserved. The Bao server usually sends it; it is unreachable, so collect it yourself with one signature.'}
          </Note>
        ) : payout === 'paying' ? (
          <Note icon="clock">Paying your share into your wallet…</Note>
        ) : null}
        {phase.kind === 'revealed' && phase.payout === 'unpaid' && phase.payoutError ? (
          <Note tone="shu" icon="info">
            {phase.payoutError}
          </Note>
        ) : null}
        <View style={{ flexDirection: 'row', gap: space[3] }}>
          {isKing ? (
            <FoilButton label="Send the next one" icon="envelope" tone="shu" onPress={onSendNext} style={{ flex: 1 }} />
          ) : (
            <FoilButton
              label="Details"
              icon="info"
              onPress={() => router.push(`/packet/${detail.address}`)}
              style={{ flex: 1 }}
            />
          )}
          <FoilButton
            label="Share"
            icon="share"
            onPress={() =>
              void Share.share({ message: `I grabbed a red packet on Bao 紅包 ${packetLink(detail.address)}` })
            }
            style={{ flex: isKing ? 0.7 : 1 }}
          />
        </View>
        {isKing ? (
          <TextButton label="Packet details" tone="muted" onPress={() => router.push(`/packet/${detail.address}`)} />
        ) : null}
      </Animated.View>
    )
  } else if (phase.kind === 'revealed' || alreadyMine) {
    content = null
  } else if (phase.kind === 'refused') {
    content = <Refusal phase={phase} detail={detail} onRetry={onRetry} onCode={onCode} />
  } else if (phase.kind === 'error') {
    content = (
      <Animated.View entering={FadeIn} style={{ gap: space[3] }}>
        <Note icon="info" tone="shu">
          {phase.message}
        </Note>
        {phase.signature ? (
          <View style={styles.links}>
            <ExplorerLink label="Grab tx" url={explorerTx(phase.signature)} />
          </View>
        ) : null}
        <FoilButton label="Try again" icon="refresh" onPress={onRetry} />
      </Animated.View>
    )
  } else if (phase.kind !== 'idle') {
    const copy =
      phase.kind === 'preparing'
        ? ['Checking your Seeker…', 'Reading the packet and your Genesis token']
        : phase.kind === 'signing'
          ? ['Confirm in your wallet', 'One signature reserves your share on Solana']
          : phase.kind === 'confirming'
            ? ['Sealing your place…', 'Solana is confirming your grab']
            : ['The proof is on its way…', 'Your share is drawn by verifiable randomness, on-chain']
    content = (
      <Animated.View key={phase.kind} entering={FadeIn.duration(350)} style={styles.status}>
        <T style={styles.statusTitle}>{copy[0]}</T>
        <T variant="meta" style={{ textAlign: 'center' }}>
          {copy[1]}
        </T>
      </Animated.View>
    )
  } else if (scheduled) {
    const on = !!reminders[detail.address]
    content = (
      <View style={{ gap: space[3] }}>
        <T variant="body" style={{ textAlign: 'center' }}>
          A public rain for {plural(detail.shares, 'Seeker')}. Shaking opens the moment it starts.
        </T>
        <FoilButton
          label={on ? 'Reminder set' : 'Remind me when it opens'}
          icon={on ? 'check' : 'bell'}
          onPress={() => void toggleReminder(detail.address, detail.startsAt, on)}
        />
      </View>
    )
  } else if (spent) {
    content = (
      <View style={{ gap: space[3] }}>
        <T variant="body" style={{ textAlign: 'center' }}>
          {detail.status === 'expired'
            ? 'This packet expired before every share was taken.'
            : 'Every share of this packet is taken.'}
          {detail.luckKing ? ` ${displayName(detail.luckKingSkr, detail.luckKing)} is Luck King.` : ''}
        </T>
        <FoilButton label="See who grabbed" icon="crown" onPress={() => router.replace(`/packet/${detail.address}`)} />
      </View>
    )
  } else if (needsCode) {
    content = (
      <View style={{ gap: space[3] }}>
        <T variant="body" style={{ textAlign: 'center' }}>
          This packet opens with a code word{detail.codeHint ? `. Hint: “${detail.codeHint}”` : ''}.
        </T>
        <FoilButton label="Enter the code word" icon="lock" onPress={onCode} />
      </View>
    )
  } else {
    content = (
      <View style={{ alignItems: 'center', gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="shake" size={18} />
          <T variant="bodyStrong" style={{ color: color.gofun }}>
            Shake your phone to open
          </T>
        </View>
        <TextButton label="or tap the seal" tone="muted" onPress={onTap} />
      </View>
    )
  }

  return (
    <View style={[styles.bottom, { top, paddingBottom: insetsBottom + space[4] }]} pointerEvents="box-none">
      {content}
    </View>
  )
}

function Refusal({
  phase,
  detail,
  onRetry,
  onCode,
}: {
  phase: Extract<GrabPhase, { kind: 'refused' }>
  detail: PacketDetail
  onRetry: () => void
  onCode: () => void
}) {
  const info = describeProgramErrorName(phase.code)
  const notSeeker =
    phase.code === null || phase.code === BAO_ERROR__NOT_A_SEEKER || phase.code === BAO_ERROR__WRONG_SGT_GROUP
  const wrongCode = phase.code === BAO_ERROR__WRONG_CODE
  const already = phase.code === BAO_ERROR__ALREADY_GRABBED_ON_THIS_DEVICE
  return (
    <Animated.View entering={FadeInDown.duration(450)} style={styles.refusal} accessibilityLiveRegion="polite">
      <View style={styles.refusalRule} />
      <T variant="caps" style={{ color: color.shu300 }}>
        {phase.code === null ? 'Seeker-only packet' : 'Refused by the program'}
      </T>
      <T style={{ fontFamily: font.display, fontSize: 22, lineHeight: 28, color: color.gofun }}>
        {notSeeker
          ? 'Only real Seekers can open this'
          : wrongCode
            ? 'That is not the word'
            : already
              ? 'This Seeker already grabbed'
              : 'The seal stays shut'}
      </T>
      <T variant="body" style={{ fontSize: 14, lineHeight: 20 }}>
        {wrongCode
          ? 'The program hashed your word with this packet and it did not match. Ask whoever shared it, then try again.'
          : already
            ? 'One Seeker, one grab: this phone’s Genesis token already holds a claim on this packet.'
            : notSeeker
              ? 'This packet is Seeker-only. Before anything moves, the program looks for a Seeker Genesis Token in the grabbing wallet, and this one has none.'
              : phase.message}
      </T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <T variant="capsSmall" style={{ color: color.gofun44 }}>
          {phase.code ? `Error ${phase.code} · ${info}` : 'Checked before signing · no Genesis token'}
        </T>
        {phase.signature ? (
          <ExplorerLink label="View on explorer" url={explorerTx(phase.signature)} tone="muted" />
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
        {wrongCode ? (
          <FoilButton label="Try another word" icon="lock" onPress={onCode} style={{ flex: 1 }} />
        ) : notSeeker ? (
          <FoilButton
            label="Get a test token"
            icon="drop"
            onPress={() => router.navigate('/seeker')}
            style={{ flex: 1 }}
          />
        ) : (
          <FoilButton
            label="Packet details"
            icon="info"
            onPress={() => router.replace(`/packet/${detail.address}`)}
            style={{ flex: 1 }}
          />
        )}
        <FoilButton label="Again" icon="refresh" onPress={onRetry} style={{ flex: 0.55 }} />
      </View>
    </Animated.View>
  )
}

function CodeSheet({
  visible,
  hint,
  onClose,
  onSubmit,
}: {
  visible: boolean
  hint: string | null
  onClose: () => void
  onSubmit: (code: string) => void
}) {
  const [value, setValue] = useState('')
  return (
    <Sheet visible={visible} onClose={onClose} kicker="Code word" title="Say the word">
      {hint ? (
        <T variant="body">
          Hint: <T style={{ fontFamily: font.displayItalic, color: color.gofun }}>“{hint}”</T>
        </T>
      ) : (
        <T variant="body">Whoever shared this packet told you the word. Capital letters do not matter.</T>
      )}
      <TextInput
        value={value}
        onChangeText={setValue}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="the code word"
        placeholderTextColor={color.gofun44}
        style={styles.input}
        returnKeyType="done"
        onSubmitEditing={() => value.trim() && onSubmit(value.trim())}
        accessibilityLabel="Code word"
      />
      <FoilButton label="Use this word" disabled={!value.trim()} onPress={() => onSubmit(value.trim())} />
    </Sheet>
  )
}

async function toggleReminder(packet: string, startsAt: number, on: boolean) {
  const all = { ...$reminders.get() }
  if (on) {
    delete all[packet]
    $reminders.set(all)
    await Notifications.cancelScheduledNotificationAsync(`rain-${packet}`).catch(() => undefined)
    return
  }
  const perm = await Notifications.requestPermissionsAsync().catch(() => null)
  if (!perm?.granted) return
  await Notifications.scheduleNotificationAsync({
    identifier: `rain-${packet}`,
    content: {
      title: 'The rain is starting',
      body: 'Shake to grab before the shares run out.',
      data: { url: `bao://packet/${packet}` },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(startsAt * 1000),
      channelId: 'rains',
    },
  }).catch(() => undefined)
  $reminders.set({ ...all, [packet]: startsAt })
  buzz('success')
  play('soft')
}

function Shell({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <View style={{ flex: 1, paddingTop: insets.top + 10 }}>
      <Backdrop variant="stage" />
      <View style={{ paddingHorizontal: space[4] }}>
        <RoundButton icon="close" label="Close" onPress={close} />
      </View>
      <View style={{ flex: 1, justifyContent: 'center' }}>{children}</View>
    </View>
  )
}

function Loading() {
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const geo = stageGeometry(width, height, insets.top + 76)
  return (
    <View style={{ flex: 1 }} accessibilityLabel="Opening the packet">
      <Backdrop variant="stage" />
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <RoundButton icon="close" label="Close" onPress={close} />
        <View style={{ alignItems: 'center', gap: 6, flex: 1 }}>
          <Skeleton width={140} height={10} />
          <Skeleton width={110} height={16} />
        </View>
        <View style={{ width: 64 }} />
      </View>
      <View style={{ position: 'absolute', top: geo.sealedTop, left: (width - geo.envW) / 2 }}>
        <Skeleton width={geo.envW} height={geo.envW * 1.748} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space[4], gap: 8, zIndex: 3 },
  bottom: { position: 'absolute', left: space[5], right: space[5] },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, justifyContent: 'center' },
  status: { alignItems: 'center', gap: 6 },
  statusTitle: {
    fontFamily: font.displayItalic,
    fontSize: 22,
    lineHeight: 28,
    color: color.gofun,
    textAlign: 'center',
  },
  refusal: {
    gap: 8,
    padding: space[4],
    borderRadius: radius.card,
    backgroundColor: 'rgba(23,17,18,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.kuro600,
    overflow: 'hidden',
  },
  refusalRule: {
    position: 'absolute',
    left: 0,
    top: 16,
    bottom: 16,
    width: 2,
    backgroundColor: color.shu500,
    borderRadius: 1,
  },
  input: {
    height: 56,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(221,187,122,0.35)',
    paddingHorizontal: space[4],
    color: color.gofun,
    fontFamily: font.display,
    fontSize: 22,
    backgroundColor: color.kuro900,
  },
})
