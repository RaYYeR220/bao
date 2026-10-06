// Toolchain spike: sign+send a devnet memo via MWA and render the confirmed signature.
// Unlike the template's sign-and-send card, the blockhash is fetched *inside* the MWA session,
// right after (re)authorize, so slow wallet hand-offs don't eat the ~60s blockhash lifetime.
import {
  appendTransactionMessageInstruction,
  createTransactionMessage,
  getBase58Decoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Signature,
} from '@solana/kit'
import { getAddMemoInstruction } from '@solana-program/memo'
import { transact, useMobileWallet } from '@wallet-ui/react-native-kit'
import { Button } from 'heroui-native/button'
import { Card } from 'heroui-native/card'
import { useState } from 'react'
import { Text, View } from 'react-native'

import { useAppCluster } from '@/features/cluster/data-access/cluster-provider'

type SpikeState = { status: string; signature?: string; error?: string }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function ToolsFeatureSpikeSend() {
  const wallet = useMobileWallet()
  const { client } = useAppCluster()
  const [state, setState] = useState<SpikeState>({ status: 'idle' })
  const busy = state.status === 'waiting for wallet' || state.status === 'sent, confirming'

  async function run() {
    const account = wallet.account
    if (!account) {
      setState({ status: 'error', error: 'connect a wallet first' })
      return
    }
    setState({ status: 'waiting for wallet' })
    let signature: string | undefined
    try {
      signature = await transact(async (mw) => {
        // Reauthorize silently with the cached token; fall back to a fresh (prompted) authorize if the
        // wallet rejects it. Persist the newly issued token, or the next session's reauth will fail.
        const { chain, identity } = wallet
        const cached = await wallet.store.fetch()
        let auth
        try {
          auth = await mw.authorize({ auth_token: wallet.store.$authToken.get(), chain, identity })
        } catch {
          auth = await mw.authorize({ chain, identity })
        }
        if (cached) {
          await wallet.store.persist({ ...cached, authToken: auth.auth_token })
        }
        const {
          context: { slot },
          value: latestBlockhash,
        } = await client.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
        const message = pipe(
          createTransactionMessage({ version: 0 }),
          (m) => setTransactionMessageFeePayer(account.address, m),
          (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
          (m) => appendTransactionMessageInstruction(getAddMemoInstruction({ memo: `bao spike ${Date.now()}` }), m),
        )
        const [signatureBytes] = await mw.signAndSendTransactions({
          minContextSlot: Number(slot),
          transactions: [message],
        })
        return getBase58Decoder().decode(signatureBytes)
      })
      setState({ status: 'sent, confirming', signature })
      for (let i = 0; i < 45; i++) {
        let status
        try {
          ;({
            value: [status],
          } = await client.rpc.getSignatureStatuses([signature as Signature]).send())
        } catch {
          // transient RPC/DNS hiccup (seen on the emulator): keep polling
          await sleep(2000)
          continue
        }
        if (status?.err) {
          throw new Error(`transaction failed: ${JSON.stringify(status.err)}`)
        }
        if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
          setState({ status: status.confirmationStatus, signature })
          return
        }
        await sleep(2000)
      }
      setState({ status: 'not confirmed after 90s', signature })
    } catch (error) {
      setState({ status: 'error', signature, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <Card className="w-full gap-3 p-4">
      <Card.Body className="gap-4">
        <View className="gap-1">
          <Card.Title className="text-xl font-bold">Spike: devnet memo</Card.Title>
          <Card.Description>Blockhash fetched inside the MWA session, then confirmed via RPC.</Card.Description>
        </View>
        <Text testID="spike-status" className="text-base text-black dark:text-white">
          Status: {state.status}
        </Text>
        {state.signature ? (
          <Text testID="spike-signature" selectable className="font-mono text-sm text-black dark:text-white">
            Signature: {state.signature}
          </Text>
        ) : null}
        {state.error ? (
          <Text testID="spike-error" className="text-sm text-red-600">
            {state.error}
          </Text>
        ) : null}
        <Button isDisabled={busy} onPress={() => void run()}>
          {busy ? 'Working...' : 'Send devnet memo'}
        </Button>
      </Card.Body>
    </Card>
  )
}
