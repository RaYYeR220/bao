import type { CircleDetail } from '@bao/sdk'
import * as Clipboard from 'expo-clipboard'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useCircle } from '@/features/bao/data-access/use-bao-api'
import { displayName, formatAmount } from '@/features/bao/format'
import { inviteLink } from '@/features/bao/links'
import { CircleSeal } from '@/features/bao/ui/circle-seal'
import { PacketEnvelope } from '@/features/bao/ui/packet-envelope'
import { Backdrop } from '@/ui/backdrop'
import { buzz, play } from '@/ui/feedback'
import { Icon } from '@/ui/icon'
import { Avatar, FoilButton, Hairline, RoundButton, Skeleton, StateBlock } from '@/ui/kit'
import { useTiltGleam } from '@/ui/motion'
import { T } from '@/ui/text'
import { color, font, radius, space } from '@/ui/tokens'

export default function CircleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const insets = useSafeAreaInsets()
  const q = useCircle(id)
  const c = q.data
  const [refreshing, setRefreshing] = useState(false)
  const back = () => (router.canGoBack() ? router.back() : router.replace('/circles'))

  return (
    <View style={{ flex: 1 }}>
      <Backdrop glowY={0.12} />
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <RoundButton icon="back" label="Back" onPress={back} />
        <T variant="caps" style={{ flex: 1, textAlign: 'center' }}>
          Circle
        </T>
        <RoundButton
          icon="share"
          label="Share the invite"
          onPress={() => c && void Share.share({ message: `Join ${c.name} on Bao 紅包 · code ${c.inviteCode} · ${inviteLink(c.inviteCode)}` })}
        />
      </View>
      {q.isLoading ? (
        <View style={{ padding: space[5], gap: space[4], alignItems: 'center' }}>
          <Skeleton width={72} height={72} radius={36} />
          <Skeleton width={180} height={30} />
          <Skeleton width="100%" height={200} radius={14} />
        </View>
      ) : !c ? (
        <StateBlock icon="circles" title="This circle did not load" body="The Bao server did not answer." action="Try again" onAction={() => void q.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: space[5], paddingBottom: insets.bottom + space[6], gap: space[6] }}
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
          <Animated.View entering={FadeInDown.duration(400)} style={{ alignItems: 'center', gap: 10 }}>
            <CircleSeal glyph={c.emoji} size={76} />
            <T style={{ fontFamily: font.display, fontSize: 32, lineHeight: 38, color: color.gofun, textAlign: 'center' }} accessibilityRole="header">
              {c.name}
            </T>
            <T variant="meta">
              {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'} · {c.livePackets} live
            </T>
          </Animated.View>

          <Section title="In the air">
            {c.packets.length ? (
              <LivePackets c={c} />
            ) : (
              <T variant="body" style={{ textAlign: 'center' }}>
                Nothing open right now.
              </T>
            )}
            <FoilButton label="Drop a packet here" icon="envelope" onPress={() => router.push({ pathname: '/send', params: { circle: c.id } })} />
          </Section>

          <Invite c={c} />

          {c.chains.length ? (
            <Section title="Luck King chains">
              {c.chains.map((ch) => (
                <Pressable key={ch.root} onPress={() => router.push(`/packet/${ch.root}`)} style={styles.chain} accessibilityRole="button">
                  <Icon name="crown" size={18} />
                  <View style={{ flex: 1 }}>
                    <T variant="bodyStrong">{ch.depth + 1} packets long</T>
                    <T variant="meta">{ch.lastKing ? `Now with ${displayName(ch.lastKingSkr, ch.lastKing)}` : 'Waiting for its king'}</T>
                  </View>
                  <ChainBeads depth={ch.depth} />
                </Pressable>
              ))}
            </Section>
          ) : null}

          <View style={{ flexDirection: 'row', gap: space[4] }}>
            <Board
              title="Most generous"
              rows={c.leaderboard.generous.map((g) => ({ name: displayName(g.skrName, g.address), value: formatAmount(g.total, 6) }))}
            />
            <Board title="Luckiest" rows={c.leaderboard.lucky.map((g) => ({ name: displayName(g.skrName, g.address), value: `${g.crowns} 運` }))} />
          </View>

          <Section title={`Members · ${c.members.length}`}>
            {c.members.map((m, i) => (
              <View key={m.address}>
                {i ? <Hairline /> : null}
                <View style={styles.member}>
                  <Avatar name={displayName(m.skrName, m.address)} size={30} />
                  <T variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                    {displayName(m.skrName, m.address)}
                  </T>
                  {m.address === c.owner ? (
                    <T variant="capsSmall" style={{ color: color.kin400 }}>
                      founder
                    </T>
                  ) : null}
                </View>
              </View>
            ))}
          </Section>
        </ScrollView>
      )}
    </View>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space[3] }}>
      <T variant="caps">{title}</T>
      {children}
    </View>
  )
}

function LivePackets({ c }: { c: CircleDetail }) {
  const gleam = useTiltGleam(0.5)
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingVertical: 6 }}>
      {c.packets.map((p) => (
        <Pressable key={p.address} onPress={() => router.push(`/grab/${p.address}`)} accessibilityRole="button" accessibilityLabel={`Open ${displayName(p.senderSkr, p.sender)}'s packet`}>
          <PacketEnvelope packet={p} width={96} gleam={gleam} />
          <T variant="meta" style={{ textAlign: 'center', marginTop: 6 }} numberOfLines={1}>
            {displayName(p.senderSkr, p.sender)}
          </T>
        </Pressable>
      ))}
    </ScrollView>
  )
}

function Invite({ c }: { c: CircleDetail }) {
  const [copied, setCopied] = useState(false)
  return (
    <View style={styles.invite}>
      <View style={styles.inviteFrame} pointerEvents="none" />
      <T variant="caps" style={{ color: color.paperInk3 }}>
        Invite code
      </T>
      <Pressable
        onPress={async () => {
          await Clipboard.setStringAsync(c.inviteCode)
          setCopied(true)
          buzz('success')
          play('soft')
          setTimeout(() => setCopied(false), 1600)
        }}
        accessibilityRole="button"
        accessibilityLabel={`Invite code ${c.inviteCode}, copy`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
      >
        <T style={{ fontFamily: font.numerals, fontSize: 32, letterSpacing: 5, color: color.kuro950 }}>{c.inviteCode}</T>
        <Icon name={copied ? 'check' : 'copy'} size={18} tone={copied ? color.jade500 : color.kin600} />
      </Pressable>
      <QRCode value={inviteLink(c.inviteCode)} size={150} color={color.kuro950} backgroundColor="transparent" />
      <T variant="meta" style={{ color: color.paperInk2, textAlign: 'center' }}>
        Friends scan this with Bao, or type the code under Circles.
      </T>
      {copied ? (
        <Animated.View entering={FadeIn}>
          <T variant="capsSmall" style={{ color: color.jade500 }}>
            Copied
          </T>
        </Animated.View>
      ) : null}
    </View>
  )
}

function ChainBeads({ depth }: { depth: number }) {
  const n = Math.min(depth + 1, 8)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      {Array.from({ length: n }, (_, i) => (
        <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i === n - 1 ? color.shu400 : color.kin400 }} />
      ))}
    </View>
  )
}

function Board({ title, rows }: { title: string; rows: { name: string; value: string }[] }) {
  return (
    <View style={styles.board}>
      <T variant="caps">{title}</T>
      {rows.length ? (
        rows.slice(0, 5).map((r, i) => (
          <View key={`${r.name}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <T style={{ fontFamily: font.display, fontSize: 15, color: i === 0 ? color.kin300 : color.gofun44, width: 14 }}>{i + 1}</T>
            <T variant="meta" style={{ flex: 1, color: color.gofun }} numberOfLines={1}>
              {r.name}
            </T>
            <T style={{ fontFamily: font.display, fontSize: 15, color: color.gofun }}>{r.value}</T>
          </View>
        ))
      ) : (
        <T variant="meta">No one yet.</T>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space[4], gap: 8 },
  chain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.kuro600,
    backgroundColor: 'rgba(23,17,18,0.85)',
  },
  invite: { alignItems: 'center', gap: space[3], padding: space[5], borderRadius: 4, backgroundColor: color.paper, transform: [{ rotate: '0.8deg' }] },
  inviteFrame: { position: 'absolute', left: 7, top: 7, right: 7, bottom: 7, borderWidth: 1, borderColor: 'rgba(127,95,44,0.5)', borderRadius: 2 },
  board: {
    flex: 1,
    gap: 10,
    padding: space[4],
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.kuro600,
    backgroundColor: 'rgba(23,17,18,0.85)',
  },
  member: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
})
