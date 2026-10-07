import { useEffect, useId, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg'

import { buzz } from './feedback'
import { Icon, type IconName } from './icon'
import { useReducedMotion } from './motion'
import { T } from './text'
import { color, font, foilPositions, foilStops, radius, space } from './tokens'

/** Hairline foil-outline pill, the primary action. */
export function FoilButton({
  label,
  icon,
  onPress,
  disabled,
  busy,
  style,
  tone = 'foil',
  accessibilityHint,
}: {
  label: string
  icon?: IconName
  onPress?: () => void
  disabled?: boolean
  busy?: boolean
  style?: StyleProp<ViewStyle>
  tone?: 'foil' | 'shu'
  accessibilityHint?: string
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const shu = tone === 'shu'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      disabled={disabled || busy}
      onPress={() => {
        buzz('select')
        onPress?.()
      }}
      style={({ pressed }) => [styles.foilBtn, { opacity: disabled ? 0.4 : pressed ? 0.75 : 1 }, style]}
    >
      {({ pressed }) => (
        <>
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
            <Defs>
              <LinearGradient id={`b${id}`} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={color.kin600} />
                <Stop offset="0.5" stopColor={color.kin200} />
                <Stop offset="1" stopColor={color.kin600} />
              </LinearGradient>
            </Defs>
            <Rect
              x="0.5"
              y="0.5"
              width="99.6%"
              height="98%"
              rx="27"
              fill={
                shu ? (pressed ? color.shu600 : color.shu500) : pressed ? 'rgba(58,46,47,0.6)' : 'rgba(44,33,34,0.35)'
              }
              stroke={`url(#b${id})`}
              strokeWidth="1"
            />
          </Svg>
          <View style={styles.foilBtnInner}>
            {busy ? (
              <ActivityIndicator color={color.kin200} size="small" />
            ) : icon ? (
              <Icon name={icon} size={20} />
            ) : null}
            <T variant="button" style={shu ? { color: color.gofun } : undefined} numberOfLines={1}>
              {label}
            </T>
          </View>
        </>
      )}
    </Pressable>
  )
}

/** Quiet text action with an optional icon. */
export function TextButton({
  label,
  icon,
  onPress,
  tone = 'foil',
  style,
  disabled,
}: {
  label: string
  icon?: IconName
  onPress?: () => void
  tone?: 'foil' | 'muted' | 'jade' | 'shu' | 'ink'
  style?: StyleProp<ViewStyle>
  disabled?: boolean
}) {
  const c =
    tone === 'muted'
      ? color.gofun64
      : tone === 'jade'
        ? color.jade300
        : tone === 'shu'
          ? color.shu500
          : tone === 'ink'
            ? color.kuro900
            : color.kin300
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        buzz('select')
        onPress?.()
      }}
      hitSlop={8}
      style={({ pressed }) => [styles.textBtn, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }, style]}
    >
      {icon ? <Icon name={icon} size={18} tone={tone === 'foil' ? 'foil' : c} /> : null}
      <T variant="bodyStrong" style={{ color: c, fontSize: 14 }}>
        {label}
      </T>
    </Pressable>
  )
}

/** Round foil-ring icon button (close, scan, back). 44 dp target. */
export function RoundButton({
  icon,
  label,
  onPress,
  size = 40,
  style,
}: {
  icon: IconName
  label: string
  onPress?: () => void
  size?: number
  style?: StyleProp<ViewStyle>
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        buzz('select')
        onPress?.()
      }}
      hitSlop={6}
      style={({ pressed }) => [
        styles.round,
        { width: size, height: size, borderRadius: size / 2, opacity: pressed ? 0.6 : 1 },
        style,
      ]}
    >
      <Icon name={icon} size={size * 0.42} />
    </Pressable>
  )
}

/** Jade "SGT" chip: this grab is bound to a Seeker Genesis Token. */
export function SgtBadge({ label = 'SGT', tone = 'jade' }: { label?: string; tone?: 'jade' | 'muted' }) {
  const c = tone === 'jade' ? color.jade300 : color.gofun44
  return (
    <View
      style={[styles.sgt, { borderColor: tone === 'jade' ? 'rgba(143,193,174,0.4)' : 'rgba(116,111,107,0.5)' }]}
      accessible
      accessibilityLabel={label === 'SGT' ? 'Seeker Genesis Token verified' : label}
    >
      <Svg width={11} height={11} viewBox="0 0 10 10">
        <Circle cx="5" cy="5" r="4.2" fill="none" stroke={c} strokeWidth={0.9} />
        <Path d="M3 5.1 L4.4 6.4 L7.1 3.6" fill="none" stroke={c} strokeWidth={1} />
      </Svg>
      <T variant="capsSmall" style={{ color: c, letterSpacing: 1.4 }}>
        {label}
      </T>
    </View>
  )
}

/** Bengara lacquer disc with an italic initial. */
export function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const letter = (name.replace(/^[^a-zA-Z0-9]+/, '')[0] ?? '·').toLowerCase()
  return (
    <View style={{ width: size, height: size }} accessible={false}>
      <Svg width={size} height={size} viewBox="0 0 30 30">
        <Defs>
          <LinearGradient id={`a${id}`} x1="0.2" y1="0.1" x2="0.8" y2="1">
            <Stop offset="0" stopColor="#8A4E45" />
            <Stop offset="0.6" stopColor={color.bengara} />
            <Stop offset="1" stopColor="#4A2622" />
          </LinearGradient>
        </Defs>
        <Circle cx="15" cy="15" r="15" fill={`url(#a${id})`} />
        <Circle cx="15" cy="15" r="14.5" fill="none" stroke="rgba(244,239,230,0.08)" />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <T
          style={{ fontFamily: font.displayItalic, fontSize: size * 0.53, lineHeight: size * 0.9, color: color.gofun }}
        >
          {letter}
        </T>
      </View>
    </View>
  )
}

/** Caps label between two fading foil hairlines. */
export function FoilRule({ label, style }: { label?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.rule, style]}>
      <View
        style={[
          styles.ruleLine,
          { experimental_backgroundImage: 'linear-gradient(90deg, rgba(169,130,63,0), rgba(169,130,63,0.6))' },
        ]}
      />
      {label ? (
        <T variant="caps" style={{ color: color.kin500 }}>
          {label}
        </T>
      ) : null}
      <View
        style={[
          styles.ruleLine,
          { experimental_backgroundImage: 'linear-gradient(90deg, rgba(169,130,63,0.6), rgba(169,130,63,0))' },
        ]}
      />
    </View>
  )
}

export function Hairline({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: color.kuro600 }, style]} />
}

/** A breathing lacquer block for loading states (never a spinner). */
export function Skeleton({
  width,
  height,
  radius: r = 6,
  style,
}: {
  width: number | `${number}%`
  height: number
  radius?: number
  style?: StyleProp<ViewStyle>
}) {
  const reduced = useReducedMotion()
  const t = useSharedValue(0)
  useEffect(() => {
    if (reduced) return
    t.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }), -1, true)
  }, [reduced, t])
  const anim = useAnimatedStyle(() => ({ opacity: 0.45 + t.value * 0.35 }))
  return <Animated.View style={[{ width, height, borderRadius: r, backgroundColor: color.kuro800 }, anim, style]} />
}

/** Lacquer card surface (14 radius, hairline). */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>
}

/** A calm note: the server is down, devnet honesty, etc. */
export function Note({
  icon = 'info',
  children,
  action,
  onAction,
  tone = 'muted',
  style,
}: {
  icon?: IconName
  children: ReactNode
  action?: string
  onAction?: () => void
  tone?: 'muted' | 'jade' | 'shu'
  style?: StyleProp<ViewStyle>
}) {
  const c = tone === 'jade' ? color.jade300 : tone === 'shu' ? color.shu300 : color.gofun64
  return (
    <View style={[styles.note, style]}>
      <Icon name={icon} size={16} tone={c} />
      <View style={{ flex: 1, gap: 6 }}>
        <T variant="meta" style={{ color: c }}>
          {children}
        </T>
        {action ? <TextButton label={action} onPress={onAction} style={{ paddingVertical: 2, minHeight: 0 }} /> : null}
      </View>
    </View>
  )
}

/** Empty / error state with a pictogram and one clear next step. */
export function StateBlock({
  icon,
  title,
  body,
  action,
  onAction,
  secondary,
  onSecondary,
  style,
}: {
  icon: IconName
  title: string
  body?: string
  action?: string
  onAction?: () => void
  secondary?: string
  onSecondary?: () => void
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View style={[styles.state, style]}>
      <View style={styles.stateIcon}>
        <Icon name={icon} size={26} />
      </View>
      <T variant="title" style={{ textAlign: 'center', fontSize: 22, lineHeight: 28 }}>
        {title}
      </T>
      {body ? (
        <T variant="body" style={{ textAlign: 'center', maxWidth: 300 }}>
          {body}
        </T>
      ) : null}
      {action ? (
        <FoilButton label={action} onPress={onAction} style={{ alignSelf: 'stretch', marginTop: space[3] }} />
      ) : null}
      {secondary ? <TextButton label={secondary} onPress={onSecondary} /> : null}
    </View>
  )
}

/** Opens a devnet explorer link. */
export function ExplorerLink({
  label,
  url,
  tone = 'jade',
}: {
  label: string
  url: string
  tone?: 'jade' | 'foil' | 'muted' | 'ink'
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${label}, opens the Solana explorer`}
      onPress={() => void Linking.openURL(url)}
      hitSlop={10}
      style={({ pressed }) => [styles.explorer, { opacity: pressed ? 0.6 : 1 }]}
    >
      <T
        variant="capsSmall"
        style={{
          color:
            tone === 'jade'
              ? color.jade300
              : tone === 'ink'
                ? color.jade500
                : tone === 'muted'
                  ? color.gofun64
                  : color.kin300,
          fontSize: 10.5,
        }}
      >
        {label}
      </T>
      <Icon
        name="external"
        size={12}
        tone={tone === 'jade' ? 'jade' : tone === 'ink' ? color.jade500 : tone === 'muted' ? 'muted' : 'foil'}
        strokeWidth={1.5}
      />
    </Pressable>
  )
}

export function FoilGradientDefs({ id }: { id: string }) {
  return (
    <Defs>
      <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
        {foilStops.map((c, i) => (
          <Stop key={i} offset={foilPositions[i]} stopColor={c} />
        ))}
      </LinearGradient>
    </Defs>
  )
}

/** Pressable row for settings and lists, ≥ 48 dp. */
export function Row({
  icon,
  label,
  value,
  onPress,
  right,
  ...rest
}: {
  icon?: IconName
  label: string
  value?: string
  right?: ReactNode
} & Omit<PressableProps, 'children'>) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={value ? `${label}, ${value}` : label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { opacity: pressed && onPress ? 0.65 : 1 }]}
      {...rest}
    >
      {icon ? <Icon name={icon} size={20} /> : null}
      <T variant="bodyStrong" style={{ flex: 1, fontSize: 15 }}>
        {label}
      </T>
      {value ? (
        <T variant="meta" style={{ color: color.gofun64 }} numberOfLines={1}>
          {value}
        </T>
      ) : null}
      {right}
      {onPress && !right ? <Icon name="chevron" size={16} tone="muted" /> : null}
    </Pressable>
  )
}

export const kitStyles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
})

const styles = StyleSheet.create({
  foilBtn: { height: 54, borderRadius: 27, justifyContent: 'center' },
  foilBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 20,
  },
  textBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, justifyContent: 'center' },
  round: {
    borderWidth: 1,
    borderColor: 'rgba(221,187,122,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sgt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.seal,
    paddingLeft: 5,
    paddingRight: 8,
    paddingVertical: 3,
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  rule: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ruleLine: { flex: 1, height: 1 },
  card: {
    backgroundColor: color.kuro900,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.kuro600,
    padding: space[4],
  },
  note: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    padding: space[3],
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.kuro600,
    backgroundColor: 'rgba(23,17,18,0.7)',
  },
  state: { alignItems: 'center', gap: space[3], paddingHorizontal: space[5], paddingVertical: space[6] },
  stateIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(221,187,122,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space[2],
  },
  explorer: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52, paddingVertical: 10 },
})
