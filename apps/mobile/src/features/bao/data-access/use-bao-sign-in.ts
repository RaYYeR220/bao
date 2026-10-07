import type { UserView } from '@bao/sdk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'

import { API_URL, APP_HOST, BAO_CHAIN } from './bao-config'
import { WalletAccountMismatchError } from './send-with-wallet'
import { saveSession } from './session-store'
import { ApiUnavailableError, baoApi } from './use-bao-api'

const API_HOST = API_URL.replace(/^[a-z]+:\/\//i, '')
  .split('/')[0]
  .toLowerCase()

const toBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return globalThis.btoa(binary)
}

/**
 * MWA returns the SIWS signature and message as base64 text; the wallet adapter hands them
 * over as the UTF-8 bytes of that text. Recover the base64 if so, else encode the raw bytes.
 */
const walletBase64 = (value: Uint8Array) => {
  const text = new TextDecoder().decode(value)
  return /^[A-Za-z0-9+/]+={0,2}$/.test(text) && text.length % 4 === 0 ? text : toBase64(value)
}

export type SignInResult = { address: string; user: UserView | null; serverReachable: boolean }

/**
 * Connect the wallet, then prove ownership with Sign In With Solana and exchange it for a
 * session. If the Bao server is unreachable the wallet stays connected and everything that
 * runs on-chain (grab, drop, history) keeps working; the session is picked up later.
 */
export function useBaoSignIn() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<SignInResult> => {
      const account = wallet.account ?? (await wallet.connect())
      let input
      try {
        input = await baoApi.call('POST /api/auth/nonce', { body: { address: account.address } }, { force: true })
      } catch (error) {
        if (error instanceof ApiUnavailableError) {
          await queryClient.invalidateQueries()
          return { address: account.address, user: null, serverReachable: false }
        }
        throw error
      }
      // Only sign a Bao challenge: for this wallet, on devnet, bound to the Bao domain.
      if (
        input.address !== account.address ||
        input.chainId !== BAO_CHAIN ||
        (input.domain !== APP_HOST && input.domain !== API_HOST)
      )
        throw new Error('The Bao server sent a sign-in request Bao does not recognise. Try again later.')
      // signIn authorizes and signs in one wallet round trip, for the BAO_CHAIN cluster
      const output = await wallet.signIn({ ...input, chainId: BAO_CHAIN })
      if (output.account.address !== account.address) throw new WalletAccountMismatchError()
      const { token, user } = await baoApi.call('POST /api/auth/verify', {
        body: {
          input,
          output: {
            address: output.account.address,
            signedMessage: walletBase64(output.signedMessage as Uint8Array),
            signature: walletBase64(output.signature as Uint8Array),
          },
        },
      })
      await saveSession({ token, address: user.address })
      await queryClient.invalidateQueries()
      return { address: user.address, user, serverReachable: true }
    },
  })
}

export function useBaoSignOut() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      try {
        // the JWT leaves the keystore first; the wallet authorization and cached data follow
        await saveSession(null)
      } finally {
        await wallet.disconnect().catch(() => undefined)
        queryClient.clear()
      }
    },
  })
}

/** Devnet Playground faucet: test SOL, tSKR and a test Genesis token for this wallet. */
export function useFaucet() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => baoApi.call('POST /api/faucet', { body: {} }, { force: true, timeoutMs: 45_000 }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['balances'] })
      await queryClient.invalidateQueries({ queryKey: ['genesis'] })
    },
  })
}
