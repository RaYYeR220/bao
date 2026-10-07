import { useMutation, useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated'

import { maybeAskForPush } from '@/features/bao/data-access/push'
import { ApiUnavailableError, apiErrorMessage, baoApi, useSession } from '@/features/bao/data-access/use-bao-api'
import { humanError, isWalletCancel } from '@/features/bao/data-access/send-with-wallet'
import { useBaoSignIn } from '@/features/bao/data-access/use-bao-sign-in'
import { isInviteCode } from '@/features/bao/links'
import { CircleSeal } from '@/features/bao/ui/circle-seal'
import { buzz, play } from '@/ui/feedback'
import { FoilButton, Note, TextButton } from '@/ui/kit'
import { T } from '@/ui/text'
import { color, font, radius, space } from '@/ui/tokens'

/** bao://join/<code>: join a circle from an invite link, QR or code. */
export default function JoinScreen() {
  const { code: rawCode } = useLocalSearchParams<{ code: string }>()
  // links are validated on the way in; a code that still is not an invite code never reaches the API
  const code = isInviteCode(rawCode) ? rawCode : null
  const session = useSession()
  const signIn = useBaoSignIn()
  const qc = useQueryClient()
  const join = useMutation({
    mutationFn: async () => {
      if (!code) throw new Error('That is not a Bao invite code.')
      return baoApi.call('POST /api/circles/join', { body: { inviteCode: code } }, { force: true })
    },
    onSuccess: async () => {
      buzz('success')
      play('stamp')
      await qc.invalidateQueries({ queryKey: ['circles'] })
      void maybeAskForPush()
    },
  })

  useEffect(() => {
    if (session && code && join.isIdle) join.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  const close = () => (router.canGoBack() ? router.back() : router.replace('/circles'))
  const c = join.data
  const err = join.error
  const signInError = signIn.error && !isWalletCancel(signIn.error) ? humanError(signIn.error) : null
  const message = !code
    ? 'That is not a Bao invite code. Ask for a fresh invite link or QR.'
    : signInError
      ? signInError
      : err instanceof ApiUnavailableError
        ? 'Circles live on the Bao server, which is unreachable right now. Try the invite again in a moment.'
        : err
          ? /404|not found/i.test(String(err))
            ? 'That invite code does not match any circle.'
            : apiErrorMessage(err, 'The invite did not go through. Try again in a moment.')
          : null

  return (
    <View style={styles.scrim}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
      <Animated.View entering={SlideInDown.springify().damping(22).stiffness(180)}>
        <View style={styles.card}>
          <View style={styles.frame} pointerEvents="none" />
          <T variant="caps" style={{ color: color.paperInk3 }}>
            Circle invite
          </T>
          {c ? (
            <Animated.View entering={FadeIn} style={{ alignItems: 'center', gap: 10 }}>
              <CircleSeal glyph={c.emoji} size={72} />
              <T style={{ fontFamily: font.display, fontSize: 28, color: color.kuro950, textAlign: 'center' }}>
                You are in {c.name}
              </T>
              <T variant="meta" style={{ color: color.paperInk2 }}>
                {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'} · {c.livePackets} live
              </T>
              <FoilButton
                label="Open the circle"
                tone="shu"
                onPress={() => router.replace(`/circle/${c.id}`)}
                style={{ alignSelf: 'stretch' }}
              />
            </Animated.View>
          ) : (
            <>
              <T style={{ fontFamily: font.numerals, fontSize: 32, letterSpacing: 5, color: color.kuro950 }}>
                {code ?? '······'}
              </T>
              <T variant="body" style={{ color: color.paperInk2, textAlign: 'center' }}>
                {session
                  ? join.isPending
                    ? 'Joining…'
                    : 'Joining the circle behind this code.'
                  : 'Sign in with your Seeker to join this circle.'}
              </T>
              {message ? <Note tone="shu">{message}</Note> : null}
              {!code ? null : !session ? (
                <FoilButton
                  label="Sign in and join"
                  tone="shu"
                  busy={signIn.isPending}
                  onPress={() => void signIn.mutateAsync().catch(() => undefined)}
                  style={{ alignSelf: 'stretch' }}
                />
              ) : err ? (
                <FoilButton
                  label="Try again"
                  tone="shu"
                  onPress={() => join.mutate()}
                  style={{ alignSelf: 'stretch' }}
                />
              ) : null}
            </>
          )}
          <TextButton label="Close" tone="ink" onPress={close} />
        </View>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(5,3,3,0.78)', justifyContent: 'center', padding: space[5] },
  card: {
    alignItems: 'center',
    gap: space[3],
    padding: space[5],
    borderRadius: 4,
    backgroundColor: color.paper,
    boxShadow: '0px 30px 50px -18px rgba(0,0,0,0.85)',
  },
  frame: {
    position: 'absolute',
    left: 7,
    top: 7,
    right: 7,
    bottom: 7,
    borderWidth: 1,
    borderColor: 'rgba(127,95,44,0.5)',
    borderRadius: radius.envelope - 4,
  },
})
