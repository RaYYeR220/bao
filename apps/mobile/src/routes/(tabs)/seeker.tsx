import { useMobileWallet } from '@wallet-ui/react-native-kit'
import * as Clipboard from 'expo-clipboard'
import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle, Path } from 'react-native-svg'

import { TSKR_DECIMALS } from '@/features/bao/data-access/bao-config'
import { humanError, isWalletCancel } from '@/features/bao/data-access/send-with-wallet'
import {
  ApiUnavailableError,
  apiErrorMessage,
  useApiState,
  useMe,
  useSession,
} from '@/features/bao/data-access/use-bao-api'
import { useBalances } from '@/features/bao/data-access/use-bao-data'
import { useBaoSignIn, useBaoSignOut, useFaucet } from '@/features/bao/data-access/use-bao-sign-in'
import { useGenesisToken } from '@/features/bao/data-access/use-genesis-token'
import { explorerAddress, faucetLinks, formatAmount, shortAddress } from '@/features/bao/format'
import { Backdrop } from '@/ui/backdrop'
import { buzz, play } from '@/ui/feedback'
import { Icon } from '@/ui/icon'
import { ExplorerLink, FoilButton, Hairline, Note, Row, SgtBadge, Skeleton } from '@/ui/kit'
import { T } from '@/ui/text'
import { color, font, radius, space } from '@/ui/tokens'

export default function SeekerScreen() {
  const insets = useSafeAreaInsets()
  const wallet = useMobileWallet()
  const address = wallet.account?.address
  const session = useSession()
  const apiState = useApiState()
  const me = useMe()
  const genesis = useGenesisToken(address)
  const balances = useBalances(address)
  const signIn = useBaoSignIn()
  const signOut = useBaoSignOut()
  const faucet = useFaucet()
  const [note, setNote] = useState<{
    tone: 'jade' | 'shu' | 'muted'
    text: string
    links?: { label: string; url: string }[]
  } | null>(null)

  const connect = async () => {
    setNote(null)
    try {
      const res = await signIn.mutateAsync()
      buzz('success')
      play('soft')
      if (!res.serverReachable)
        setNote({
          tone: 'muted',
          text: 'Connected. The Bao server is unreachable, so names and circles will sync later.',
        })
    } catch (e) {
      if (!isWalletCancel(e)) setNote({ tone: 'shu', text: humanError(e) })
    }
  }

  const getTokens = async () => {
    setNote(null)
    try {
      if (!session) await signIn.mutateAsync()
      const res = await faucet.mutateAsync()
      buzz('success')
      play('shimmer')
      const got = [res.sol && 'test SOL', res.tskr && 'tSKR', res.genesis && 'a test Genesis token']
        .filter(Boolean)
        .join(', ')
      setNote({
        tone: 'jade',
        text: got ? `Sent: ${got}. It lands in a few seconds.` : 'You already have everything the playground gives.',
        links: faucetLinks(res),
      })
      setTimeout(() => {
        void balances.refetch()
        void genesis.refetch()
      }, 4000)
    } catch (e) {
      if (e instanceof ApiUnavailableError)
        setNote({ tone: 'muted', text: 'The faucet lives on the Bao server, which is unreachable right now.' })
      else if (!isWalletCancel(e)) {
        const text = apiErrorMessage(e, 'The faucet did not answer.')
        setNote({ tone: /already collected/.test(text) ? 'muted' : 'shu', text })
      }
    }
  }

  const name = me.data?.skrName ?? (address ? shortAddress(address) : null)
  const verified = !!genesis.data

  return (
    <View style={{ flex: 1 }}>
      <Backdrop glowY={0.18} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          paddingHorizontal: space[5],
          paddingBottom: space[6],
          gap: space[5],
        }}
      >
        <View style={{ gap: 4 }}>
          <T variant="caps">Your Seeker</T>
          <T variant="title" style={{ fontSize: 34, lineHeight: 40 }} accessibilityRole="header">
            {address ? 'The phone, verified' : 'Connect your Seeker'}
          </T>
        </View>

        <View style={styles.idCard}>
          <Badge verified={verified} />
          <View style={{ flex: 1, gap: 6 }}>
            {address ? (
              <>
                <T
                  style={{ fontFamily: font.displayItalic, fontSize: 24, lineHeight: 30, color: color.gofun }}
                  numberOfLines={1}
                >
                  {name}
                </T>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {me.data?.seekerOnMainnet ? <SgtBadge label="Seeker ✓ on mainnet" /> : null}
                  {genesis.isLoading ? (
                    <Skeleton width={120} height={20} radius={10} />
                  ) : verified ? (
                    <SgtBadge label="Devnet Genesis ✓" />
                  ) : (
                    <SgtBadge label="No test Genesis yet" tone="muted" />
                  )}
                </View>
              </>
            ) : (
              <T variant="body">
                One approval connects the wallet in your Seed Vault and proves this phone is a Seeker.
              </T>
            )}
          </View>
        </View>

        {!address ? (
          <FoilButton
            label="Connect your Seeker"
            icon="wallet"
            busy={signIn.isPending}
            onPress={() => void connect()}
          />
        ) : (
          <>
            <View style={styles.balances}>
              <Balance label="tSKR" value={balances.data ? formatAmount(balances.data.tskr, TSKR_DECIMALS) : null} />
              <View style={styles.vr} />
              <Balance label="SOL" value={balances.data ? formatAmount(balances.data.lamports, 9, 3) : null} />
            </View>

            <View style={styles.faucet}>
              <View style={styles.faucetIcon}>
                <Icon name="drop" size={24} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <T variant="bodyStrong">Playground faucet</T>
                <T variant="meta">
                  Test SOL, tSKR and a test Genesis token, so you can grab and drop for free on devnet.
                </T>
              </View>
            </View>
            <FoilButton
              label={signIn.isPending ? 'Sign in your wallet…' : 'Get test tokens'}
              icon="drop"
              busy={faucet.isPending || signIn.isPending}
              onPress={() => void getTokens()}
            />
            {!session ? (
              <Note
                icon="link"
                action={apiState === 'down' ? undefined : 'Sign in to sync'}
                onAction={() => void connect()}
              >
                {apiState === 'down'
                  ? 'Some features need the Bao server, which is unreachable. Grabs and drops still work on-chain.'
                  : 'Sign in once to sync your .skr name, circles and notifications.'}
              </Note>
            ) : null}
          </>
        )}

        {note ? (
          <Animated.View entering={FadeIn}>
            <Note tone={note.tone} icon={note.tone === 'jade' ? 'check' : 'info'}>
              {note.text}
            </Note>
            {note.links?.length ? (
              <View style={styles.links}>
                {note.links.map((l) => (
                  <ExplorerLink key={l.label} label={l.label} url={l.url} />
                ))}
              </View>
            ) : null}
          </Animated.View>
        ) : null}

        <View>
          <Hairline />
          {address ? (
            <>
              <Row
                icon="copy"
                label="Wallet"
                value={shortAddress(address, 5)}
                onPress={() => {
                  void Clipboard.setStringAsync(address)
                  buzz('success')
                  setNote({ tone: 'jade', text: 'Address copied.' })
                }}
              />
              <Hairline />
            </>
          ) : null}
          <Row icon="settings" label="Preferences" value="Sound, haptics" onPress={() => router.push('/preferences')} />
          <Hairline />
          <Row icon="link" label="Network" value="Solana devnet" />
          <T variant="meta" style={{ marginTop: -4, marginBottom: 10, marginLeft: 34 }}>
            Bao is in its devnet playground: the real program and real randomness, with test tokens.
          </T>
          {address ? (
            <>
              <Hairline />
              <Row
                icon="logout"
                label="Sign out"
                onPress={() => {
                  setNote(null)
                  signOut.mutate()
                }}
              />
            </>
          ) : null}
          <Hairline />
        </View>
        {address ? (
          <ExplorerLink label="Your wallet on the explorer" url={explorerAddress(address)} tone="muted" />
        ) : null}
      </ScrollView>
    </View>
  )
}

function Badge({ verified }: { verified: boolean }) {
  return (
    <Svg width={72} height={72} viewBox="0 0 38 38" accessibilityLabel={verified ? 'Verified Seeker' : 'Seeker'}>
      <Circle cx="19" cy="19" r="18" fill="none" stroke={verified ? color.jade300 : color.kuro600} strokeWidth={0.8} />
      <Circle cx="19" cy="19" r="15.5" fill={color.kuro800} />
      <Circle cx="19" cy="16" r="5" fill="none" stroke={color.kin300} strokeWidth={0.9} />
      <Path d="M10.5 28.5 c2-5 15-5 17 0" fill="none" stroke={color.kin300} strokeWidth={0.9} />
      {verified ? (
        <>
          <Circle cx="30.5" cy="8" r="5" fill={color.jade700} stroke={color.kuro950} strokeWidth={1} />
          <Path d="M28.3 8 L29.9 9.6 L32.8 6.6" fill="none" stroke={color.jade300} strokeWidth={0.9} />
        </>
      ) : null}
    </Svg>
  )
}

function Balance({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <T variant="caps">{label}</T>
      {value === null ? (
        <Skeleton width={80} height={30} />
      ) : (
        <T
          style={{
            fontFamily: font.numerals,
            fontSize: 32,
            lineHeight: 38,
            color: color.gofun,
            fontVariant: ['tabular-nums', 'lining-nums'],
          }}
        >
          {value}
        </T>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  idCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    padding: space[4],
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.kuro600,
    backgroundColor: 'rgba(23,17,18,0.85)',
  },
  balances: { flexDirection: 'row', gap: space[4], alignItems: 'center' },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginTop: space[3] },
  vr: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: color.kuro600 },
  faucet: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  faucetIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(221,187,122,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
