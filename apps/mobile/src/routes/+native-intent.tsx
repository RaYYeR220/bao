import { systemPathFor } from '@/features/bao/links'

/**
 * Incoming links → screens. Links are untrusted: addresses and invite codes are validated and
 * only https links on the Bao host are accepted (see `systemPathFor`).
 *   bao://packet/<address>, https://<host>/p/<address>  → the Grab screen
 *   bao://join/<code>,      https://<host>/c/<code>     → join a circle
 *   bao://send, bao://scan (app shortcuts) pass through
 *   anything that looks like a Bao link but is not valid → the not-found screen
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    return systemPathFor(path)
  } catch {
    return '/'
  }
}
