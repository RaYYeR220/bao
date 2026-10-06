const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** Circle invites travel as an app link; the code itself also works typed in. */
export const inviteLink = (code: string) => `bao://join/${code}`

/** Turns a scanned or tapped code into a place in the app: a packet, a circle invite, or nothing. */
export function routeForCode(data: string): string | null {
  const text = data.trim()
  const packet = /(?:\/p\/|packet\/)([1-9A-HJ-NP-Za-km-z]{32,44})/.exec(text)
  if (packet) return `/grab/${packet[1]}`
  const join = /(?:join\/|\/c\/)([A-Za-z0-9_-]{3,64})/.exec(text)
  if (join) return `/join/${join[1]}`
  if (BASE58.test(text)) return `/grab/${text}`
  return null
}
