import type { CircleSummary } from '@bao/sdk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { maybeAskForPush } from '@/features/bao/data-access/push'
import { WalletRejectedError } from '@/features/bao/data-access/send-with-wallet'
import { baoApi, useApiState, useCircles, useSession } from '@/features/bao/data-access/use-bao-api'
import { useBaoSignIn } from '@/features/bao/data-access/use-bao-sign-in'
import { CircleSeal, SEAL_GLYPHS } from '@/features/bao/ui/circle-seal'
import { Backdrop } from '@/ui/backdrop'
import { buzz, play } from '@/ui/feedback'
import { Icon } from '@/ui/icon'
import { FoilButton, Note, Skeleton, StateBlock, TextButton } from '@/ui/kit'
import { Sheet } from '@/ui/sheet'
import { T } from '@/ui/text'
import { color, font, radius, space } from '@/ui/tokens'

export default function CirclesScreen() {
  const insets = useSafeAreaInsets()
  const { account } = useMobileWallet()
  const session = useSession()
  const apiState = useApiState()
  const circles = useCircles()
  const signIn = useBaoSignIn()
  const [create, setCreate] = useState(false)
  const [join, setJoin] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [signInNote, setSignInNote] = useState<string | null>(null)

  const doSignIn = async () => {
    setSignInNote(null)
    try {
      const r = await signIn.mutateAsync()
      if (!r.serverReachable) setSignInNote('The Bao server is unreachable right now. Circles will be here when it is back.')
    } catch (e) {
      if (!(e instanceof WalletRejectedError)) setSignInNote(e instanceof Error ? e.message : 'The wallet did not answer.')
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <Backdrop glowY={0.15} />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: space[5], paddingBottom: space[6], gap: space[5] }}
        refreshControl={
          session ? (
            <RefreshControl
              refreshing={refreshing}
              tintColor={color.kin300}
              colors={[color.kin300]}
              progressBackgroundColor={color.kuro800}
              onRefresh={async () => {
                setRefreshing(true)
                await circles.refetch()
                setRefreshing(false)
              }}
            />
          ) : undefined
        }
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View style={{ gap: 4 }}>
            <T variant="caps">Who you drop for</T>
            <T variant="title" style={{ fontSize: 34, lineHeight: 40 }} accessibilityRole="header">
              Circles
            </T>
          </View>
          <Pressable onPress={() => router.push('/scan')} accessibilityRole="button" accessibilityLabel="Scan a circle invite" style={styles.iconBtn} hitSlop={6}>
            <Icon name="scan" size={22} />
          </Pressable>
        </View>

        {!session ? (
          <View style={{ gap: space[3] }}>
            <StateBlock
              icon="circles"
              title="Your people, in one place"
              body="A circle is a group you drop packets into: friends, a team, a Discord. Members get a nudge when a packet lands."
              action={account ? 'Sign in to see your circles' : 'Connect your Seeker'}
              onAction={() => void doSignIn()}
            />
            {apiState === 'down' ? <Note icon="link">Circles live on the Bao server, which is unreachable right now. Packets and grabs still work on-chain.</Note> : null}
            {signInNote ? <Note tone="shu">{signInNote}</Note> : null}
          </View>
        ) : circles.isLoading ? (
          <View style={{ gap: 12 }}>
            {[0, 1].map((i) => (
              <Skeleton key={i} width="100%" height={88} radius={14} />
            ))}
          </View>
        ) : circles.isError ? (
          <StateBlock icon="refresh" title="Circles did not load" body="The Bao server did not answer." action="Try again" onAction={() => void circles.refetch()} />
        ) : circles.data?.length ? (
          <View style={{ gap: 12 }}>
            {circles.data.map((c, i) => (
              <CircleRow key={c.id} c={c} i={i} />
            ))}
          </View>
        ) : (
          <StateBlock icon="circles" title="No circles yet" body="Start one and share the invite, or join a friend’s with their code." />
        )}

        {session ? (
          <View style={{ gap: space[3] }}>
            <FoilButton label="Start a circle" icon="plus" onPress={() => setCreate(true)} />
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space[5] }}>
              <TextButton label="Join with a code" icon="lock" onPress={() => setJoin(true)} />
              <TextButton label="Scan an invite" icon="qr" onPress={() => router.push('/scan')} />
            </View>
          </View>
        ) : null}
      </ScrollView>
      <CreateSheet visible={create} onClose={() => setCreate(false)} />
      <JoinSheet visible={join} onClose={() => setJoin(false)} />
    </View>
  )
}

function CircleRow({ c, i }: { c: CircleSummary; i: number }) {
  return (
    <Animated.View entering={FadeInDown.delay(i * 50).duration(350)}>
      <Pressable
        onPress={() => router.push(`/circle/${c.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`${c.name}, ${c.memberCount} members, ${c.livePackets} live packets`}
        style={({ pressed }) => [styles.row, { opacity: pressed ? 0.8 : 1 }]}
      >
        <CircleSeal glyph={c.emoji} />
        <View style={{ flex: 1, gap: 3 }}>
          <T style={{ fontFamily: font.display, fontSize: 22, lineHeight: 27, color: color.gofun }} numberOfLines={1}>
            {c.name}
          </T>
          <T variant="meta">
            {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'}
            {c.livePackets ? (
              <T variant="meta" style={{ color: color.jade300 }}>
                {' '}
                · {c.livePackets} live
              </T>
            ) : null}
          </T>
        </View>
        <Icon name="chevron" size={16} tone="muted" />
      </Pressable>
    </Animated.View>
  )
}

function CreateSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const [glyph, setGlyph] = useState(SEAL_GLYPHS[0])
  const qc = useQueryClient()
  const create = useMutation({
    mutationFn: () => baoApi.call('POST /api/circles', { body: { name: name.trim(), emoji: glyph } }, { force: true }),
    onSuccess: async (c) => {
      buzz('success')
      play('stamp')
      await qc.invalidateQueries({ queryKey: ['circles'] })
      onClose()
      setName('')
      void maybeAskForPush()
      router.push(`/circle/${c.id}`)
    },
  })
  return (
    <Sheet visible={visible} onClose={onClose} kicker="New circle" title="Name your circle">
      <TextInput
        value={name}
        onChangeText={(t) => setName(t.slice(0, 32))}
        placeholder="Radiants, Seoul Seekers, the family…"
        placeholderTextColor={color.gofun44}
        style={styles.input}
        autoFocus
        accessibilityLabel="Circle name"
      />
      <T variant="caps">Its seal</T>
      <View style={styles.glyphs}>
        {SEAL_GLYPHS.map((g) => (
          <Pressable
            key={g}
            onPress={() => {
              buzz('select')
              setGlyph(g)
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: glyph === g }}
            accessibilityLabel={`Seal ${g}`}
            style={[styles.glyph, glyph === g && styles.glyphOn]}
          >
            <CircleSeal glyph={g} size={44} />
          </Pressable>
        ))}
      </View>
      {create.isError ? <Note tone="shu">{create.error instanceof Error ? create.error.message.replace(/^.*→ \d+: /, '') : 'Could not create it.'}</Note> : null}
      <FoilButton label="Start the circle" disabled={name.trim().length < 2} busy={create.isPending} onPress={() => create.mutate()} />
    </Sheet>
  )
}

function JoinSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [code, setCode] = useState('')
  return (
    <Sheet visible={visible} onClose={onClose} kicker="Join" title="Enter the invite code">
      <TextInput
        value={code}
        onChangeText={(t) => setCode(t.replace(/\s/g, ''))}
        placeholder="e.g. RADIANT8"
        placeholderTextColor={color.gofun44}
        autoCapitalize="characters"
        autoCorrect={false}
        style={[styles.input, { letterSpacing: 3 }]}
        autoFocus
        accessibilityLabel="Invite code"
      />
      <FoilButton
        label="Join"
        disabled={code.length < 3}
        onPress={() => {
          onClose()
          router.push(`/join/${encodeURIComponent(code)}`)
        }}
      />
    </Sheet>
  )
}

const styles = StyleSheet.create({
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    padding: space[4],
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.kuro600,
    backgroundColor: 'rgba(23,17,18,0.85)',
    minHeight: 88,
  },
  input: {
    minHeight: 56,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(221,187,122,0.35)',
    paddingHorizontal: space[4],
    color: color.gofun,
    fontFamily: font.display,
    fontSize: 22,
    backgroundColor: color.kuro900,
  },
  glyphs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  glyph: { padding: 3, borderRadius: 30, borderWidth: 1, borderColor: 'transparent' },
  glyphOn: { borderColor: color.kin300 },
})
