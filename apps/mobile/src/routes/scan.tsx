import { CameraView, useCameraPermissions } from 'expo-camera'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { Linking, StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { buzz, play } from '@/ui/feedback'
import { routeForCode } from '@/features/bao/links'
import { Note, RoundButton, StateBlock } from '@/ui/kit'
import { T } from '@/ui/text'
import { color, space } from '@/ui/tokens'

export default function ScanScreen() {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [permission, request] = useCameraPermissions()
  const [unknown, setUnknown] = useState(false)
  const done = useRef(false)
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'))
  const box = Math.min(width * 0.7, 300)

  return (
    <View style={{ flex: 1, backgroundColor: color.kuroDeep }}>
      {permission?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            if (done.current) return
            const href = routeForCode(data)
            if (!href) {
              setUnknown(true)
              return
            }
            done.current = true
            buzz('success')
            play('soft')
            router.replace(href as never)
          }}
        />
      ) : null}
      {permission?.granted ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={[styles.mask, { flex: 1 }]} />
          <View style={{ flexDirection: 'row', height: box }}>
            <View style={[styles.mask, { flex: 1 }]} />
            <View style={{ width: box, height: box }}>
              {(['tl', 'tr', 'bl', 'br'] as const).map((k) => (
                <View key={k} style={[styles.corner, cornerStyle(k)]} />
              ))}
            </View>
            <View style={[styles.mask, { flex: 1 }]} />
          </View>
          <View style={[styles.mask, { flex: 1.3 }]} />
        </View>
      ) : null}

      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <RoundButton icon="close" label="Close" onPress={close} />
        <T variant="caps" style={{ flex: 1, textAlign: 'center', color: color.gofun64 }}>
          Scan
        </T>
        <View style={{ width: 40 }} />
      </View>

      {!permission ? null : permission.granted ? (
        <View style={[styles.caption, { bottom: insets.bottom + space[6] }]}>
          <T style={styles.captionTitle}>Point at a Bao code</T>
          <T variant="meta" style={{ textAlign: 'center' }}>
            Bao QR codes open a packet or a circle right here.
          </T>
          {unknown ? (
            <Animated.View entering={FadeIn}>
              <Note tone="shu">That code is not a Bao packet or invite.</Note>
            </Animated.View>
          ) : null}
        </View>
      ) : (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <StateBlock
            icon="scan"
            title="Let Bao see the code"
            body="The camera is only used to read packet and circle QR codes. Nothing is recorded."
            action={permission.canAskAgain ? 'Allow the camera' : 'Open settings'}
            onAction={() => (permission.canAskAgain ? void request() : void Linking.openSettings())}
          />
        </View>
      )}
    </View>
  )
}

function cornerStyle(k: 'tl' | 'tr' | 'bl' | 'br') {
  const s = { borderColor: color.kin300 }
  if (k === 'tl') return { ...s, left: 0, top: 0, borderLeftWidth: 1.5, borderTopWidth: 1.5 }
  if (k === 'tr') return { ...s, right: 0, top: 0, borderRightWidth: 1.5, borderTopWidth: 1.5 }
  if (k === 'bl') return { ...s, left: 0, bottom: 0, borderLeftWidth: 1.5, borderBottomWidth: 1.5 }
  return { ...s, right: 0, bottom: 0, borderRightWidth: 1.5, borderBottomWidth: 1.5 }
}

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space[4],
  },
  mask: { backgroundColor: 'rgba(10,7,7,0.72)' },
  corner: { position: 'absolute', width: 34, height: 34 },
  caption: { position: 'absolute', left: space[5], right: space[5], gap: 8, alignItems: 'center' },
  captionTitle: { fontFamily: 'BodoniModa-MediumItalic', fontSize: 22, lineHeight: 28, color: color.gofun, textAlign: 'center' },
})
