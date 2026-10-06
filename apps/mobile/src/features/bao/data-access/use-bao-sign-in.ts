import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'

import { baoApi } from './use-bao-api'
import { saveSession } from './session-store'

const toBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return globalThis.btoa(binary)
}

/**
 * One step: connect the wallet with Sign In With Solana (inside MWA authorize), then exchange
 * the signed message for a session token.
 */
export function useBaoSignIn() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const account = wallet.account ?? (await wallet.connect())
      const input = await baoApi.call('POST /api/auth/nonce', { body: { address: account.address } })
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
      return user
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
