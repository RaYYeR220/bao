import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { router, useLocalSearchParams } from 'expo-router'
import { useMemo, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import Animated, { FadeIn, FadeInRight, FadeOutLeft } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { TSKR_DECIMALS } from '@/features/bao/data-access/bao-config'
import {
  ConfirmTimeoutError,
  humanError,
  isWalletCancel,
  TransactionFailedError,
} from '@/features/bao/data-access/send-with-wallet'
import { useApiState, useCircles, useSession } from '@/features/bao/data-access/use-bao-api'
import { useBalances, useCrown, usePacketData } from '@/features/bao/data-access/use-bao-data'
import {
  MAX_SHARES,
  MIN_SHARES,
  toBaseUnits,
  useDropPacket,
  type DropInput,
} from '@/features/bao/data-access/use-drop-packet'
import { chainPlace, clockTime, displayName, explorerTx, formatAmount } from '@/features/bao/format'
import { isCircleId, isPacketAddress } from '@/features/bao/links'
import { Backdrop } from '@/ui/backdrop'
import { useNow } from '@/ui/countdown'
import { EnvelopeFace } from '@/ui/envelope/envelope'
import { buzz, play } from '@/ui/feedback'
import { Icon, type IconName } from '@/ui/icon'
import { ExplorerLink, FoilButton, Note, RoundButton, TextButton } from '@/ui/kit'
import { useTiltGleam } from '@/ui/motion'
import { T } from '@/ui/text'
import { color, font, radius, skins, space, type SkinName } from '@/ui/tokens'

type Audience = 'public' | 'circle' | 'code'
const QUICK = ['8', '18', '88', '168']
const EXPIRY: { h: number; label: string }[] = [
  { h: 1, label: '1 hour' },
  { h: 24, label: '24 hours' },
  { h: 168, label: '7 days' },
]
const RAIN_IN: { min: number; label: string }[] = [
  { min: 0, label: 'Now' },
  { min: 15, label: 'In 15 min' },
  { min: 60, label: 'In 1 hour' },
  { min: 180, label: 'In 3 hours' },
]

/** Keeps the amount field a plain decimal: digits, one point, at most TSKR_DECIMALS decimals. */
function cleanAmount(text: string) {
  const [whole, ...rest] = text
    .replace(/,/g, '.')
    .replace(/[^0-9.]/g, '')
    .split('.')
  const amount = rest.length ? `${whole}.${rest.join('').slice(0, TSKR_DECIMALS)}` : whole
  return amount.slice(0, 12)
}

export default function SendScreen() {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const raw = useLocalSearchParams<{ parent?: string; parentRefund?: string; circle?: string }>()
  // route params can arrive from a link: keep only well-formed addresses and ids
  const params = {
    parent: isPacketAddress(raw.parent) ? raw.parent : undefined,
    parentRefund: isPacketAddress(raw.parentRefund) ? raw.parentRefund : undefined,
    circle: isCircleId(raw.circle) ? raw.circle : undefined,
  }
  const wallet = useMobileWallet()
  const session = useSession()
  const apiState = useApiState()
  const balances = useBalances(wallet.account?.address)
  const circles = useCircles()
  const parent = usePacketData(params.parent)
  const drop = useDropPacket()
  const gleam = useTiltGleam(0.5)

  const [step, setStep] = useState(0)
  const [amount, setAmount] = useState('88')
  const [shares, setShares] = useState(8)
  const [mode, setMode] = useState<'lucky' | 'equal'>('lucky')
  const [audience, setAudience] = useState<Audience>(params.circle ? 'circle' : 'public')
  const [circleId, setCircleId] = useState<string | undefined>(params.circle)
  const [code, setCode] = useState('')
  const [hint, setHint] = useState('')
  const [seekerOnly, setSeekerOnly] = useState(true)
  const [rainIn, setRainIn] = useState(0)
  const [expiry, setExpiry] = useState(24)
  const [message, setMessage] = useState('')
  const [skin, setSkin] = useState<SkinName>('shu')
  const [error, setError] = useState<{ message: string; signature: string | null } | null>(null)
  const sending = useRef(false)
  const amountRef = useRef<TextInput>(null)
  const now = useNow(15_000)

  const total = useMemo(() => {
    try {
      return toBaseUnits(amount || '0', TSKR_DECIMALS)
    } catch {
      return null
    }
  }, [amount])
  const balance = balances.data?.tskr ?? null
  const short = total !== null && balance !== null && total > balance
  const tooSmall = total !== null && total < BigInt(shares)
  const step1Ok = total !== null && total > 0n && !tooSmall && shares >= MIN_SHARES && shares <= MAX_SHARES
  const circleAvailable = !!session && apiState !== 'down'
  const step2Ok =
    audience === 'public' ? true : audience === 'circle' ? !!circleId && circleAvailable : code.trim().length >= 2

  const parentDetail = parent.data?.detail
  const crown = useCrown(params.parent)
  const holdsCrown = !!crown.data && crown.data.king === wallet.account?.address
  const chainPending = !!params.parent && crown.isFetched && !holdsCrown
  const chainLabel =
    parentDetail && holdsCrown
      ? chainPlace(parentDetail.chainDepth + 2, displayName(parentDetail.senderSkr, parentDetail.sender))
      : null

  const envW = step === 2 ? Math.min(width * 0.34, 132) : Math.min(width * 0.22, 92)

  async function submit() {
    if (sending.current) return
    sending.current = true
    setError(null)
    const input: DropInput = {
      amountUi: amount,
      shares,
      mode,
      audience:
        audience === 'circle'
          ? { kind: 'circle', circleId: circleId! }
          : audience === 'code'
            ? { kind: 'code', code: code.trim(), hint: hint.trim() || undefined }
            : { kind: 'open' },
      seekerOnly: audience === 'public' ? true : seekerOnly,
      expiresInHours: expiry,
      startsAt: audience === 'public' && rainIn > 0 ? Math.floor(Date.now() / 1000) + rainIn * 60 : undefined,
      message: message.trim() || undefined,
      skin,
      parentPacket: holdsCrown ? params.parent : undefined,
      parentRefundTo: holdsCrown ? params.parentRefund : undefined,
    }
    try {
      const res = await drop.mutateAsync(input)
      buzz('success')
      play('stamp')
      // the share screen shows the drop signature with its explorer link
      router.replace({ pathname: '/share/[address]', params: { address: res.packet, sig: res.signature, fresh: '1' } })
    } catch (e) {
      // closing the wallet is a change of mind, not an error
      if (isWalletCancel(e)) return
      buzz('error')
      setError({
        message: e instanceof TransactionFailedError ? e.message : humanError(e),
        signature: e instanceof ConfirmTimeoutError ? e.signature : null,
      })
    } finally {
      sending.current = false
    }
  }

  const next = () => {
    buzz('select')
    setStep((s) => Math.min(2, s + 1))
  }
  const back = () => {
    if (step === 0) return router.canGoBack() ? router.back() : router.replace('/')
    setStep((s) => s - 1)
  }

  return (
    <View style={{ flex: 1 }}>
      <Backdrop glowY={0.2} variant="stage" />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
          <RoundButton icon={step === 0 ? 'close' : 'back'} label={step === 0 ? 'Close' : 'Back'} onPress={back} />
          <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            <T variant="caps">{['The packet', 'Who it is for', 'Seal it'][step]}</T>
            <View style={styles.steps}>
              {[0, 1, 2].map((i) => (
                <View
                  key={i}
                  style={[
                    styles.stepBar,
                    { backgroundColor: i <= step ? color.kin300 : color.kuro600, width: i === step ? 22 : 10 },
                  ]}
                />
              ))}
            </View>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: space[5], paddingBottom: space[6] }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ alignItems: 'center', marginTop: space[3], marginBottom: space[4] }}>
            <EnvelopeFace
              width={envW}
              tone={skin}
              gleam={gleam}
              ticks={{ total: shares, left: shares }}
              sealState={step === 2 ? 'closed' : 'closed'}
            />
            {chainLabel ? (
              <View style={styles.chain}>
                <Icon name="crown" size={14} />
                <T variant="capsSmall" style={{ color: color.kin300 }}>
                  {chainLabel}
                </T>
              </View>
            ) : null}
          </View>

          {chainPending && step === 0 ? (
            <Note icon="crown" style={{ marginBottom: space[4] }}>
              {crown.data
                ? 'Someone else wears that crown now. This drop starts a chain of its own.'
                : 'You lead so far. The crown is settled once every share is grabbed; this drop starts a chain of its own.'}
            </Note>
          ) : null}
          {step === 0 ? (
            <Animated.View
              key="s0"
              entering={FadeInRight.duration(300)}
              exiting={FadeOutLeft.duration(200)}
              style={{ gap: space[5] }}
            >
              <Pressable
                onPress={() => amountRef.current?.focus()}
                style={{ alignItems: 'center' }}
                accessibilityLabel="Amount"
              >
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                  <TextInput
                    ref={amountRef}
                    value={amount}
                    onChangeText={(t) => setAmount(cleanAmount(t))}
                    keyboardType="decimal-pad"
                    selectTextOnFocus
                    style={styles.amount}
                    maxLength={12}
                    selectionColor={color.kin300}
                    accessibilityLabel="Amount in tSKR"
                  />
                  <T style={{ fontFamily: font.caps, fontSize: 14, letterSpacing: 2, color: color.kin300 }}>TSKR</T>
                </View>
                <T variant="meta" style={{ color: short ? color.shu300 : color.gofun64 }}>
                  {!wallet.account
                    ? 'Connect at the last step'
                    : balance === null
                      ? 'Reading your balance…'
                      : `Balance ${formatAmount(balance, TSKR_DECIMALS)} tSKR${short ? ' · not enough' : ''}`}
                </T>
              </Pressable>
              <View style={styles.quick}>
                {QUICK.map((q) => (
                  <Chip key={q} label={q} on={amount === q} onPress={() => setAmount(q)} />
                ))}
              </View>

              <View style={styles.block}>
                <View style={styles.rowBetween}>
                  <View style={{ gap: 2 }}>
                    <T variant="bodyStrong">Shares</T>
                    <T variant="meta">How many people can grab</T>
                  </View>
                  <Stepper value={shares} onChange={setShares} min={MIN_SHARES} max={MAX_SHARES} />
                </View>
                <TickRuler shares={shares} />
                {tooSmall ? (
                  <T variant="meta" style={{ color: color.shu300 }}>
                    Put in at least one unit per share.
                  </T>
                ) : null}
              </View>

              <View style={{ gap: space[3] }}>
                <View style={{ flexDirection: 'row', gap: space[3] }}>
                  <ModeSeal label="Lucky" cjk="運" on={mode === 'lucky'} onPress={() => setMode('lucky')} />
                  <ModeSeal label="Equal" cjk="均" on={mode === 'equal'} onPress={() => setMode('equal')} />
                </View>
                <T variant="meta" style={{ textAlign: 'center' }}>
                  {mode === 'lucky'
                    ? 'Each share is drawn by provable randomness. The biggest grab is crowned Luck King.'
                    : 'Everyone gets the same share. No crown, no drama.'}
                </T>
              </View>
            </Animated.View>
          ) : null}

          {step === 1 ? (
            <Animated.View
              key="s1"
              entering={FadeInRight.duration(300)}
              exiting={FadeOutLeft.duration(200)}
              style={{ gap: space[4] }}
            >
              <AudienceRow
                icon="rain"
                title="Public"
                body="The public feed, now or as a scheduled rain. Always Seeker-only, so only real phones can grab."
                on={audience === 'public'}
                onPress={() => setAudience('public')}
              />
              <AudienceRow
                icon="circles"
                title="A circle"
                body={
                  circleAvailable
                    ? 'Only members of one of your circles can grab.'
                    : 'Needs the Bao server and a signed-in session.'
                }
                on={audience === 'circle'}
                disabled={!circleAvailable}
                onPress={() => setAudience('circle')}
              />
              <AudienceRow
                icon="lock"
                title="Code word"
                body="Anyone with the link and the word. Say it out loud at the table."
                on={audience === 'code'}
                onPress={() => setAudience('code')}
              />

              {audience === 'public' ? (
                <Animated.View entering={FadeIn} style={styles.block}>
                  <T variant="bodyStrong">When does it open?</T>
                  <View style={styles.chipsWrap}>
                    {RAIN_IN.map((r) => (
                      <Chip key={r.min} label={r.label} on={rainIn === r.min} onPress={() => setRainIn(r.min)} />
                    ))}
                  </View>
                  {rainIn > 0 ? (
                    <T variant="meta">
                      Opens at {clockTime(now + rainIn * 60)}. People who set a reminder get a nudge.
                    </T>
                  ) : null}
                </Animated.View>
              ) : null}

              {audience === 'circle' && circleAvailable ? (
                <Animated.View entering={FadeIn} style={styles.block}>
                  <T variant="bodyStrong">Which circle?</T>
                  {circles.data?.length ? (
                    <View style={styles.chipsWrap}>
                      {circles.data.map((c) => (
                        <Chip
                          key={c.id}
                          label={`${c.emoji ?? '◎'} ${c.name}`}
                          on={circleId === c.id}
                          onPress={() => setCircleId(c.id)}
                        />
                      ))}
                    </View>
                  ) : (
                    <TextButton label="Create a circle first" icon="plus" onPress={() => router.push('/circles')} />
                  )}
                </Animated.View>
              ) : null}

              {audience === 'code' ? (
                <Animated.View entering={FadeIn} style={styles.block}>
                  <TextInput
                    value={code}
                    onChangeText={setCode}
                    placeholder="The code word"
                    placeholderTextColor={color.gofun44}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                    accessibilityLabel="Code word"
                  />
                  <TextInput
                    value={hint}
                    onChangeText={setHint}
                    placeholder="Hint, optional (shown to everyone)"
                    placeholderTextColor={color.gofun44}
                    style={[styles.input, { fontSize: 16, fontFamily: font.text }]}
                    maxLength={60}
                    accessibilityLabel="Hint"
                  />
                </Animated.View>
              ) : null}

              {audience !== 'public' ? (
                <Toggle
                  label="Seeker-only"
                  body="One grab per Seeker Genesis Token, checked by the program."
                  on={seekerOnly}
                  onChange={setSeekerOnly}
                />
              ) : null}

              <View style={styles.block}>
                <T variant="bodyStrong">Unclaimed shares return to you after</T>
                <View style={styles.chipsWrap}>
                  {EXPIRY.map((e) => (
                    <Chip key={e.h} label={e.label} on={expiry === e.h} onPress={() => setExpiry(e.h)} />
                  ))}
                </View>
              </View>
            </Animated.View>
          ) : null}

          {step === 2 ? (
            <Animated.View key="s2" entering={FadeInRight.duration(300)} style={{ gap: space[4] }}>
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space[4] }}>
                {(Object.keys(skins) as SkinName[]).map((k) => (
                  <Pressable
                    key={k}
                    onPress={() => {
                      buzz('select')
                      setSkin(k)
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: skin === k }}
                    accessibilityLabel={`${skins[k].label} envelope`}
                    style={[styles.skin, skin === k && styles.skinOn]}
                  >
                    <View
                      style={[
                        styles.swatch,
                        { backgroundColor: k === 'shu' ? color.shu400 : k === 'kuro' ? color.kuro700 : color.jade500 },
                      ]}
                    >
                      <T style={{ fontFamily: font.cjk, fontSize: 18, color: color.kin200 }}>{skins[k].cjk}</T>
                    </View>
                    <T variant="meta" style={{ color: skin === k ? color.gofun : color.gofun64 }}>
                      {skins[k].label}
                    </T>
                  </Pressable>
                ))}
              </View>
              <View style={styles.block}>
                <TextInput
                  value={message}
                  onChangeText={(t) => setMessage(t.slice(0, 80))}
                  placeholder="A line for the envelope, optional"
                  placeholderTextColor={color.gofun44}
                  style={[styles.input, { fontFamily: font.displayItalic, fontSize: 19, paddingLeft: space[4] + 2 }]}
                  maxLength={80}
                  accessibilityLabel="Message"
                />
                <T variant="meta" style={{ alignSelf: 'flex-end' }}>
                  {message.length} / 80
                </T>
              </View>

              <View style={styles.summary}>
                <SummaryRow k="Amount" v={`${amount} tSKR`} />
                <SummaryRow k="Shares" v={`${shares} · ${mode === 'lucky' ? 'Lucky split' : 'Equal split'}`} />
                <SummaryRow
                  k="For"
                  v={
                    audience === 'public'
                      ? rainIn
                        ? `Public rain at ${clockTime(now + rainIn * 60)}`
                        : 'Public, opens now'
                      : audience === 'circle'
                        ? (circles.data?.find((c) => c.id === circleId)?.name ?? 'Circle')
                        : `Code word${hint ? ` · hint “${hint}”` : ''}`
                  }
                />
                <SummaryRow
                  k="Grabs"
                  v={audience === 'public' || seekerOnly ? 'One per Seeker' : 'Anyone with the link'}
                />
                <SummaryRow k="Returns after" v={EXPIRY.find((e) => e.h === expiry)!.label} />
                {audience === 'public' ? (
                  <T variant="meta" style={{ marginTop: 6 }}>
                    Public rains carry a small protocol fee (at most 1%).
                  </T>
                ) : null}
              </View>

              {short ? (
                <Note tone="shu" icon="drop" action="Get test tokens" onAction={() => router.push('/seeker')}>
                  This wallet holds {formatAmount(balance, TSKR_DECIMALS)} tSKR, less than the packet.
                </Note>
              ) : null}
              {error ? (
                <Note tone="shu" icon="info">
                  {error.message}
                </Note>
              ) : null}
              {error?.signature ? <ExplorerLink label="Drop tx" url={explorerTx(error.signature)} /> : null}
            </Animated.View>
          ) : null}
        </ScrollView>
        {/* the one decision of each step sits in thumb reach, never below the fold */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + space[3] }]}>
          {step === 0 ? (
            <FoilButton label="Next: who it is for" disabled={!step1Ok} onPress={next} />
          ) : step === 1 ? (
            <FoilButton label="Next: seal it" disabled={!step2Ok} onPress={next} />
          ) : (
            <>
              <FoilButton
                label={drop.isPending ? 'Confirm in your wallet…' : 'Seal the packet'}
                icon="envelope"
                tone="shu"
                busy={drop.isPending}
                disabled={!step1Ok || !step2Ok || short}
                onPress={() => void submit()}
                accessibilityHint="Opens your wallet to sign one transaction"
              />
              <T variant="meta" style={{ textAlign: 'center', fontSize: 12 }}>
                One signature. The tokens wait on Solana until grabbed, or return to you.
              </T>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        buzz('select')
        onPress()
      }}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      style={[styles.chip, on && styles.chipOn]}
    >
      <T style={{ fontFamily: font.textMedium, fontSize: 15, color: on ? color.kuro950 : color.gofun }}>{label}</T>
    </Pressable>
  )
}

function Stepper({
  value,
  onChange,
  min,
  max,
}: {
  value: number
  onChange: (n: number) => void
  min: number
  max: number
}) {
  const set = (n: number) => {
    const v = Math.max(min, Math.min(max, n))
    if (v !== value) buzz('select')
    onChange(v)
  }
  return (
    <View
      style={styles.stepper}
      accessibilityRole="adjustable"
      accessibilityValue={{ min, max, now: value }}
      accessibilityLabel="Shares"
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => set(value + (e.nativeEvent.actionName === 'increment' ? 1 : -1))}
    >
      <Pressable
        onPress={() => set(value - 1)}
        onLongPress={() => set(value - 10)}
        style={styles.stepBtn}
        accessibilityLabel="Fewer shares"
        hitSlop={6}
      >
        <Icon name="minus" size={18} />
      </Pressable>
      <T
        style={{
          fontFamily: font.numerals,
          fontSize: 28,
          color: color.gofun,
          minWidth: 54,
          textAlign: 'center',
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
      </T>
      <Pressable
        onPress={() => set(value + 1)}
        onLongPress={() => set(value + 10)}
        style={styles.stepBtn}
        accessibilityLabel="More shares"
        hitSlop={6}
      >
        <Icon name="plus" size={18} />
      </Pressable>
    </View>
  )
}

/** Foil tick ruler: one tick per share, up to 40, then proportional. */
function TickRuler({ shares }: { shares: number }) {
  const n = Math.min(40, shares)
  return (
    <View style={styles.ruler} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: 40 }, (_, i) => (
        <View
          key={i}
          style={[styles.tick, { height: i % 5 === 4 ? 14 : 9, backgroundColor: i < n ? color.kin300 : color.kuro600 }]}
        />
      ))}
    </View>
  )
}

function ModeSeal({ label, cjk, on, onPress }: { label: string; cjk: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        buzz('select')
        onPress()
      }}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${label} split`}
      style={[styles.mode, on && styles.modeOn]}
    >
      <View
        style={[
          styles.modeSeal,
          { backgroundColor: on ? color.shu700 : color.kuro800, borderColor: on ? color.kin300 : color.kuro600 },
        ]}
      >
        <T style={{ fontFamily: font.cjk, fontSize: 20, color: on ? color.kin200 : color.gofun44 }}>{cjk}</T>
      </View>
      <T variant="bodyStrong" style={{ color: on ? color.gofun : color.gofun64 }}>
        {label}
      </T>
    </Pressable>
  )
}

function AudienceRow({
  icon,
  title,
  body,
  on,
  disabled,
  onPress,
}: {
  icon: IconName
  title: string
  body: string
  on: boolean
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={() => {
        buzz('select')
        onPress()
      }}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected: on, disabled: !!disabled }}
      style={[styles.aud, on && styles.audOn, disabled && { opacity: 0.45 }]}
    >
      <Icon name={icon} size={24} tone={on ? 'foil' : 'muted'} />
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="bodyStrong" style={{ color: on ? color.gofun : color.gofun64 }}>
          {title}
        </T>
        <T variant="meta">{body}</T>
      </View>
      <View style={[styles.radio, on && { borderColor: color.kin300 }]}>
        {on ? <View style={styles.radioDot} /> : null}
      </View>
    </Pressable>
  )
}

function Toggle({
  label,
  body,
  on,
  onChange,
}: {
  label: string
  body: string
  on: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <Pressable
      onPress={() => {
        buzz('select')
        onChange(!on)
      }}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      style={styles.toggleRow}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="bodyStrong">{label}</T>
        <T variant="meta">{body}</T>
      </View>
      <View style={[styles.switch, on && styles.switchOn]}>
        <View style={[styles.knob, on && styles.knobOn]} />
      </View>
    </Pressable>
  )
}

function SummaryRow({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.sumRow}>
      <T variant="capsSmall" style={{ color: color.paperInk3 }}>
        {k}
      </T>
      <T style={{ fontFamily: font.textMedium, fontSize: 15, color: color.kuro900, flexShrink: 1, textAlign: 'right' }}>
        {v}
      </T>
    </View>
  )
}

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: space[5],
    paddingTop: space[3],
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(58,46,47,0.8)',
    experimental_backgroundImage: 'linear-gradient(180deg, rgba(15,11,11,0.9), #0B0808)',
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space[4], gap: 8 },
  steps: { flexDirection: 'row', gap: 5 },
  stepBar: { height: 1.5, borderRadius: 1 },
  chain: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space[3] },
  amount: {
    fontFamily: font.numerals,
    fontSize: 72,
    color: color.gofun,
    minWidth: 60,
    padding: 0,
    textAlign: 'center',
    fontVariant: ['tabular-nums', 'lining-nums'],
  },
  quick: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  chip: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: radius.seal,
    borderWidth: 1,
    borderColor: 'rgba(221,187,122,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: color.kin300, borderColor: color.kin300 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  block: {
    gap: space[3],
    padding: space[4],
    borderRadius: radius.card,
    backgroundColor: 'rgba(23,17,18,0.8)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.kuro600,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(221,187,122,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ruler: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 16 },
  tick: { width: 1.2 },
  mode: {
    flex: 1,
    alignItems: 'center',
    gap: 10,
    paddingVertical: space[4],
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.kuro600,
  },
  modeOn: { borderColor: 'rgba(221,187,122,0.55)', backgroundColor: 'rgba(110,28,30,0.18)' },
  modeSeal: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  aud: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.kuro600,
    minHeight: 64,
  },
  audOn: { borderColor: 'rgba(221,187,122,0.55)', backgroundColor: 'rgba(33,24,25,0.9)' },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: color.kuro600,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.kin300 },
  input: {
    minHeight: 54,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(221,187,122,0.3)',
    paddingHorizontal: space[4],
    color: color.gofun,
    fontFamily: font.display,
    fontSize: 20,
    backgroundColor: color.kuro900,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: 6, minHeight: 56 },
  switch: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: color.kuro700,
    padding: 3,
    borderWidth: 1,
    borderColor: color.kuro600,
  },
  switchOn: { backgroundColor: color.jade700, borderColor: color.jade500 },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: color.gofun44 },
  knobOn: { backgroundColor: color.jade300, transform: [{ translateX: 20 }] },
  skin: {
    alignItems: 'center',
    gap: 8,
    padding: 8,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'transparent',
    minWidth: 88,
  },
  skinOn: { borderColor: 'rgba(221,187,122,0.55)' },
  swatch: {
    width: 46,
    height: 72,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(221,187,122,0.45)',
  },
  summary: {
    gap: 10,
    padding: space[4],
    borderRadius: 4,
    backgroundColor: color.paper,
    borderWidth: 1,
    borderColor: 'rgba(127,95,44,0.45)',
  },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
})
