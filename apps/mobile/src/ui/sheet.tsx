import type { ReactNode } from 'react'
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from 'react-native'
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { RoundButton } from './kit'
import { useReducedMotion } from './motion'
import { T } from './text'
import { color, radius, space } from './tokens'

/** Lacquer bottom sheet: kuro-800, 24 radius, a foil hairline along the lip. */
export function Sheet({
  visible,
  onClose,
  title,
  kicker,
  children,
}: {
  visible: boolean
  onClose: () => void
  title?: string
  kicker?: string
  children: ReactNode
}) {
  const insets = useSafeAreaInsets()
  const reduced = useReducedMotion()
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
        <Animated.View
          entering={reduced ? FadeIn.duration(150) : SlideInDown.duration(380).springify().damping(22).stiffness(180).mass(1.1)}
          style={[styles.panel, { paddingBottom: insets.bottom + space[4] }]}
        >
          <View style={styles.lip} />
          <View style={styles.handle} />
          {title ? (
            <View style={styles.head}>
              <View style={{ flex: 1, gap: 4 }}>
                {kicker ? <T variant="caps">{kicker}</T> : null}
                <T variant="title" style={{ fontSize: 24 }}>
                  {title}
                </T>
              </View>
              <RoundButton icon="close" label="Close" onPress={onClose} size={40} />
            </View>
          ) : null}
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(5,3,3,0.72)' },
  panel: {
    backgroundColor: color.kuro800,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: space[5],
    paddingTop: space[3],
    gap: space[4],
  },
  lip: {
    position: 'absolute',
    top: 0,
    left: 24,
    right: 24,
    height: 1,
    experimental_backgroundImage: 'linear-gradient(90deg, rgba(221,187,122,0), rgba(221,187,122,0.55), rgba(221,187,122,0))',
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: color.kuro600 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
})
