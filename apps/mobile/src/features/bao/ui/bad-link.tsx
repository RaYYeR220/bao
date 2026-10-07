import { router } from 'expo-router'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { APP_HOST } from '@/features/bao/data-access/bao-config'
import { Backdrop } from '@/ui/backdrop'
import { RoundButton, StateBlock } from '@/ui/kit'
import { space } from '@/ui/tokens'

const COPY = {
  link: {
    title: 'That is not a Bao link',
    body: `Bao opens packet and circle links from ${APP_HOST}, bao:// links and Bao QR codes. This one is something else.`,
  },
  packet: {
    title: 'That is not a Bao packet',
    body: 'The link does not hold a valid packet address. Ask whoever shared it to send it again.',
  },
  circle: {
    title: 'That is not a Bao circle',
    body: 'The link does not hold a valid circle. Ask whoever shared it for a fresh invite.',
  },
} as const

/** A full screen for a link, QR or tag that did not validate: explain, then lead back to the feed. */
export function BadLink({ kind = 'link' }: { kind?: keyof typeof COPY }) {
  const insets = useSafeAreaInsets()
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'))
  return (
    <View style={{ flex: 1, paddingTop: insets.top + 10 }}>
      <Backdrop variant="stage" />
      <View style={{ paddingHorizontal: space[4] }}>
        <RoundButton icon="close" label="Close" onPress={close} />
      </View>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <StateBlock
          icon="link"
          title={COPY[kind].title}
          body={COPY[kind].body}
          action="Back to the feed"
          onAction={() => router.replace('/')}
        />
      </View>
    </View>
  )
}
