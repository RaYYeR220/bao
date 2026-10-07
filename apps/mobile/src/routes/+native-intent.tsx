/**
 * Incoming links → screens.
 *   bao://packet/<address>, https://<host>/p/<address>  → the Grab screen
 *   bao://join/<code>,      https://<host>/c/<code>     → join a circle
 *   bao://send, bao://scan (app shortcuts)
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    const clean = path.replace(/^[a-z+.-]+:\/\/[^/]*/i, '').replace(/^\/+/, '/')
    const packet =
      /^\/(?:packet|p)\/([1-9A-HJ-NP-Za-km-z]{32,44})/.exec(clean) ??
      /^\/?(?:packet|p)\/([1-9A-HJ-NP-Za-km-z]{32,44})/.exec(path.replace(/^bao:\/\//, '/'))
    if (packet) return `/grab/${packet[1]}`
    const join =
      /^\/(?:join|c)\/([A-Za-z0-9_-]{3,64})/.exec(clean) ??
      /^\/?join\/([A-Za-z0-9_-]{3,64})/.exec(path.replace(/^bao:\/\//, '/'))
    if (join) return `/join/${join[1]}`
    return path
  } catch {
    return '/'
  }
}
