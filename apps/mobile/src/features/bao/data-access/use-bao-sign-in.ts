import type { UserView } from '@bao/sdk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'

import { ApiUnavailableError, baoApi } from './use-bao-api'
import { saveSession } from './session-store'

const toBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return globalThis.btoa(binary)
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
      const output = await wallet.signIn({ ...input, chainId: input.chainId as never })
      const { token, user } = await baoApi.call('POST /api/auth/verify', {
        body: {
          input,
          output: {
            address: output.account.address,
            signedMessage: toBase64(output.signedMessage as Uint8Array),
            signature: toBase64(output.signature as Uint8Array),
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
      await saveSession(null)
      await wallet.disconnect().catch(() => undefined)
      queryClient.clear()
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
