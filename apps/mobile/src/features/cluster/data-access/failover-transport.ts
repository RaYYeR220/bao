import {
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  isJsonRpcPayload,
  isSolanaError,
  type RpcTransport,
} from '@solana/kit'

export interface FailoverOptions {
  /** How long the primary gets to answer before the request goes to the fallback. */
  timeoutMs?: number
  /** How long the primary is left alone after it failed. */
  cooldownMs?: number
  /**
   * Whether a failure seen now says anything about the primary. Android blocks the network of a
   * backgrounded app (a wallet in front): such a request still falls back, but opens no breaker.
   */
  canJudge?: () => boolean
  /** Told about every request that left the primary for the fallback. */
  onFailover?: (event: { method: string | undefined; reason: string }) => void
  now?: () => number
}

class PrimaryTimeoutError extends Error {}

/** The HTTP status the endpoint answered with, when that is why the transport threw. */
function httpStatus(error: unknown): number | null {
  return isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) ? error.context.statusCode : null
}

/**
 * Two doors to one cluster: every request goes to `primary`, and to `fallback` when the primary
 * could not answer it. "Could not answer" is a failure of the door, never of the request: no
 * connection, no reply within `timeoutMs`, an HTTP status other than 2xx, a body that is not JSON.
 * A JSON-RPC error inside a 200 reply (bad params, account not found, a failed simulation) is the
 * cluster's own answer and is returned as it is; the fallback would only say the same.
 *
 * After a failure the primary is skipped for `cooldownMs`, so an outage costs one timeout and not
 * one per request; then a single request tries it again while the others keep to the fallback.
 * HTTP 400 is the primary refusing the request itself (a method outside its allowlist): only that
 * method skips it, the rest keep using it.
 *
 * Nothing stands behind the fallback. Its answer, or its error, is what the caller gets: when
 * both doors fail the caller sees exactly the error it would have seen with the fallback alone.
 */
export function createFailoverTransport(
  primary: RpcTransport,
  fallback: RpcTransport,
  { timeoutMs = 4_000, cooldownMs = 30_000, canJudge = () => true, onFailover, now = Date.now }: FailoverOptions = {},
): RpcTransport {
  // 0 while the primary is trusted; otherwise the time until which requests skip it
  let skipUntil = 0
  const refusedUntil = new Map<string, number>()

  async function askPrimary<TResponse>(request: Parameters<RpcTransport>[0]) {
    const controller = new AbortController()
    const forward = () => controller.abort()
    if (request.signal?.aborted) forward()
    request.signal?.addEventListener('abort', forward)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      // the race holds the deadline even where an aborted fetch is slow to reject
      return await Promise.race([
        primary<TResponse>({ ...request, signal: controller.signal }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new PrimaryTimeoutError())
            controller.abort()
          }, timeoutMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', forward)
    }
  }

  return async function send<TResponse>(request: Parameters<RpcTransport>[0]) {
    const method = isJsonRpcPayload(request.payload) ? request.payload.method : undefined
    const started = now()
    if (started < skipUntil || (method !== undefined && started < (refusedUntil.get(method) ?? 0))) {
      return await fallback<TResponse>(request)
    }
    // the cooldown is over: this request tries the primary again, the others stay on the fallback
    // until it has its answer
    if (skipUntil !== 0) skipUntil = started + timeoutMs
    const judged = canJudge()
    try {
      const response = await askPrimary<TResponse>(request)
      skipUntil = 0
      return response
    } catch (error) {
      // the caller gave up: nobody is waiting for a second answer
      if (request.signal?.aborted) throw error
      const status = httpStatus(error)
      if (status === 400 && method !== undefined) {
        // it answered: the door is open, it only does not take this method
        skipUntil = 0
        refusedUntil.set(method, now() + cooldownMs)
      } else if (judged && canJudge()) {
        skipUntil = now() + cooldownMs
      }
      onFailover?.({
        method,
        reason:
          error instanceof PrimaryTimeoutError
            ? `no answer in ${timeoutMs} ms`
            : status !== null
              ? `HTTP ${status}`
              : String(error instanceof Error ? error.message : error),
      })
      return await fallback<TResponse>(request)
    }
  }
}
