import * as Clipboard from 'expo-clipboard'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { AccessibilityInfo, Pressable, ScrollView, Share, StyleSheet, useWindowDimensions, View } from 'react-native'
import NfcManager, { Ndef, NfcTech } from 'react-native-nfc-manager'
import QRCode from 'react-native-qrcode-svg'
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { packetLink } from '@/features/bao/data-access/bao-config'
import { usePacketData } from '@/features/bao/data-access/use-bao-data'
import { explorerTx, formatAmount } from '@/features/bao/format'
import { PacketEnvelope } from '@/features/bao/ui/packet-envelope'
import { Backdrop } from '@/ui/backdrop'
import { buzz, play } from '@/ui/feedback'
import { Icon } from '@/ui/icon'
import { ExplorerLink, FoilButton, Note, RoundButton, Skeleton } from '@/ui/kit'
import { useTiltGleam } from '@/ui/motion'
import { T } from '@/ui/text'
import { color, font, radius, space } from '@/ui/tokens'

type NfcState = 'idle' | 'waiting' | 'written' | 'off' | 'unsupported' | 'error'

export default function ShareScreen() {
  const { address, sig, fresh } = useLocalSearchParams<{ address: string; sig?: string; fresh?: string }>()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const packet = usePacketData(address)
  const detail = packet.data?.detail ?? null
  const gleam = useTiltGleam(0.5)
  const link = packetLink(address)
  const [copied, setCopied] = useState(false)
  const [nfc, setNfc] = useState<NfcState>('idle')
  const createSig = sig ?? detail?.createSignature ?? null

  useEffect(() => {
    if (fresh) AccessibilityInfo.announceForAccessibility('Your packet is sealed and live.')
    return () => {
      void NfcManager.cancelTechnologyRequest().catch(() => undefined)
    }
  }, [fresh])

  const close = () => router.navigate({ pathname: '/', params: { focus: address } })

  async function copy() {
    await Clipboard.setStringAsync(link)
    setCopied(true)
    buzz('success')
    play('soft')
    setTimeout(() => setCopied(false), 1800)
  }

  async function writeTag() {
    try {
      const supported = await NfcManager.isSupported()
      if (!supported) return setNfc('unsupported')
      await NfcManager.start()
      if (!(await NfcManager.isEnabled())) return setNfc('off')
      setNfc('waiting')
      await NfcManager.requestTechnology(NfcTech.Ndef, { alertMessage: 'Hold a tag to the back of your phone' })
      const bytes = Ndef.encodeMessage([Ndef.uriRecord(link)])
      if (!bytes) throw new Error('encode')
      await NfcManager.ndefHandler.writeNdefMessage(bytes)
      setNfc('written')
      buzz('success')
      play('stamp')
    } catch {
      setNfc((s) => (s === 'waiting' ? 'error' : s))
    } finally {
      void NfcManager.cancelTechnologyRequest().catch(() => undefined)
    }
  }

  const envW = Math.min(width * 0.36, 150)
  const qrSize = Math.min(width - 2 * space[5] - 64, 220)

  return (
    <View style={{ flex: 1 }}>
      <Backdrop glowY={0.18} variant="stage" />
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <RoundButton icon="close" label="Done" onPress={close} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <T variant="caps">{fresh ? 'Sealed and live' : 'Share the packet'}</T>
        </View>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space[5], paddingBottom: insets.bottom + space[6], gap: space[5] }}
      >
        <View style={styles.hero}>
          {detail ? (
            <Animated.View entering={FadeInDown.duration(600)}>
              <PacketEnvelope packet={detail} width={envW} gleam={gleam} />
            </Animated.View>
          ) : (
            <Skeleton width={envW} height={envW * 1.748} />
          )}
          <View style={{ flex: 1, gap: 8 }}>
            <T style={{ fontFamily: font.display, fontSize: 26, lineHeight: 31, color: color.gofun }}>
              {fresh ? 'Your packet is out there.' : 'Pass it on.'}
            </T>
            <T variant="body" style={{ fontSize: 14, lineHeight: 20 }}>
              {detail
                ? `${formatAmount(detail.total, detail.token.decimals)} ${detail.token.symbol} in ${detail.shares} ${detail.shares === 1 ? 'share' : 'shares'}. ${
                    detail.audience === 'code'
                      ? 'Tell them the word in person; it is never stored.'
                      : detail.audience === 'circle'
                        ? 'Your circle got a nudge.'
                        : 'Seekers nearby can grab it from the feed.'
                  }`
                : 'Reading the packet from Solana…'}
            </T>
            {createSig ? <ExplorerLink label="Drop tx" url={explorerTx(createSig)} /> : null}
          </View>
        </View>

        <View style={styles.linkRow}>
          <Icon name="link" size={18} />
          <T variant="meta" style={{ flex: 1, color: color.gofun }} numberOfLines={1} ellipsizeMode="middle">
            {link.replace(/^https:\/\//, '')}
          </T>
          <Pressable
            onPress={() => void copy()}
            accessibilityRole="button"
            accessibilityLabel="Copy link"
            hitSlop={8}
            style={styles.mini}
          >
            <Icon name={copied ? 'check' : 'copy'} size={18} tone={copied ? 'jade' : 'foil'} />
          </Pressable>
        </View>
        <FoilButton
          label="Share the link"
          icon="share"
          onPress={() => void Share.share({ message: `A red packet for you on Bao 紅包 · shake to grab ${link}` })}
        />

        <View style={styles.qrCard} accessible accessibilityLabel="QR code of the packet link">
          <View style={styles.qrFrame} pointerEvents="none" />
          <T variant="caps" style={{ color: color.paperInk3 }}>
            Scan to grab
          </T>
          <QRCode value={link} size={qrSize} color={color.kuro950} backgroundColor="transparent" ecl="M" />
          <T style={{ fontFamily: font.cjk, fontSize: 13, letterSpacing: 4, color: color.shu500 }}>紅包</T>
        </View>

        <View style={styles.nfc}>
          <View style={styles.nfcIcon}>
            <Icon name="nfc" size={26} tone={nfc === 'written' ? 'jade' : 'foil'} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <T variant="bodyStrong">Write to an NFC tag</T>
            <T variant="meta">
              {nfc === 'waiting'
                ? 'Hold a blank tag flat against the back of the phone…'
                : nfc === 'written'
                  ? 'Done. Any phone that taps this tag opens the packet.'
                  : nfc === 'off'
                    ? 'NFC is off. Turn it on, then try again.'
                    : nfc === 'unsupported'
                      ? 'This phone has no NFC. Share the link or QR instead.'
                      : nfc === 'error'
                        ? 'The tag did not take it. Try again, or use a different tag.'
                        : 'Stick it under a table or on a card: a tap opens the packet.'}
            </T>
          </View>
        </View>
        {nfc === 'off' ? (
          <FoilButton
            label="Open NFC settings"
            icon="settings"
            onPress={() => void NfcManager.goToNfcSetting().catch(() => undefined)}
          />
        ) : nfc !== 'unsupported' ? (
          <FoilButton
            label={nfc === 'waiting' ? 'Waiting for a tag…' : nfc === 'written' ? 'Write another tag' : 'Write the tag'}
            icon="nfc"
            busy={nfc === 'waiting'}
            onPress={() => void writeTag()}
          />
        ) : null}
        {nfc === 'waiting' ? (
          <Animated.View entering={FadeIn}>
            <Note
              icon="info"
              action="Cancel"
              onAction={() => void NfcManager.cancelTechnologyRequest().then(() => setNfc('idle'))}
            >
              The tag needs to stay still for a second.
            </Note>
          </Animated.View>
        ) : null}

        <FoilButton label="Open in the feed" icon="feed" onPress={close} />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space[4], gap: 8, paddingBottom: space[3] },
  hero: { flexDirection: 'row', alignItems: 'center', gap: space[5], paddingTop: space[2] },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: space[4],
    paddingRight: 6,
    minHeight: 54,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.kuro600,
    backgroundColor: color.kuro900,
  },
  mini: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  qrCard: {
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[5],
    borderRadius: 4,
    backgroundColor: color.paper,
    transform: [{ rotate: '-1deg' }],
    boxShadow: '0px 24px 40px -18px rgba(0,0,0,0.85)',
  },
  qrFrame: {
    position: 'absolute',
    left: 8,
    top: 8,
    right: 8,
    bottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(127,95,44,0.55)',
    borderRadius: 2,
  },
  nfc: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  nfcIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(221,187,122,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
