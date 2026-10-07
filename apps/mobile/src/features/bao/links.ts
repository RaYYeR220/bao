import { isAddress, type Address } from '@solana/kit'

import { APP_HOST } from './data-access/bao-config'

const INVITE_CODE = /^[A-Za-z0-9_-]{3,64}$/
const CIRCLE_ID = /^[A-Za-z0-9_-]{1,64}$/
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/

/** A packet (or any account) address: base58 that decodes to exactly 32 bytes. */
export const isPacketAddress = (value: unknown): value is Address => typeof value === 'string' && isAddress(value)
export const isInviteCode = (value: unknown): value is string => typeof value === 'string' && INVITE_CODE.test(value)
export const isCircleId = (value: unknown): value is string => typeof value === 'string' && CIRCLE_ID.test(value)
export const isSignature = (value: unknown): value is string => typeof value === 'string' && SIGNATURE.test(value)

/** Circle invites travel as an app link; the code itself also works typed in. */
export const inviteLink = (code: string) => `bao://join/${code}`

export type BaoLink =
  | { kind: 'packet'; address: Address; screen: 'grab' | 'share' }
  | { kind: 'join'; code: string }
  | { kind: 'circle'; id: string }

/** First path segments that mean "this is meant as a Bao link", valid or not. */
const LINK_HEADS = new Set(['packet', 'p', 'grab', 'share', 'join', 'c', 'circle'])

type Parsed = { link: BaoLink | null; linkish: boolean }

const segmentsOf = (path: string) => path.split('/').filter(Boolean)

function fromSegments(segments: string[]): Parsed {
  const [head, value, ...rest] = segments
  if (!head || !LINK_HEADS.has(head)) return { link: null, linkish: false }
  if (!value || rest.length) return { link: null, linkish: true }
  let link: BaoLink | null = null
  if (head === 'packet' || head === 'p' || head === 'grab') {
    if (isPacketAddress(value)) link = { kind: 'packet', address: value, screen: 'grab' }
  } else if (head === 'share') {
    if (isPacketAddress(value)) link = { kind: 'packet', address: value, screen: 'share' }
  } else if (head === 'join' || head === 'c') {
    if (isInviteCode(value)) link = { kind: 'join', code: value }
  } else if (isCircleId(value)) {
    link = { kind: 'circle', id: value }
  }
  return { link, linkish: true }
}

/**
 * Reads an untrusted link (deep link, QR code, NFC tag, notification payload). Bao links are
 * bao://packet/<address>, bao://join/<code>, https://<bao host>/p/<address>,
 * https://<bao host>/c/<code> (plus the app's own grab, share and circle paths) and a bare
 * packet address. Addresses must decode to 32 bytes; links to any other host are refused.
 * `linkish` says the input was meant as a Bao link, so a refusal deserves an explanation.
 */
function parse(raw: string): Parsed {
  const text = raw.trim()
  if (!text || text.length > 512) return { link: null, linkish: false }
  if (isPacketAddress(text)) return { link: { kind: 'packet', address: text, screen: 'grab' }, linkish: true }
  const url = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i.exec(text)
  if (url) {
    const scheme = url[1].toLowerCase()
    const host = url[2].toLowerCase()
    // bao://packet/<address>: the first segment arrives as the URL host
    if (scheme === 'bao') return fromSegments([host, ...segmentsOf(url[3])])
    if (scheme === 'https' && host === APP_HOST) return fromSegments(segmentsOf(url[3]))
    if (scheme === 'https' || scheme === 'http') return { link: null, linkish: true }
    return { link: null, linkish: false }
  }
  if (text.startsWith('/')) return fromSegments(segmentsOf(text.replace(/[?#].*$/, '')))
  return { link: null, linkish: false }
}

export const parseBaoLink = (raw: string): BaoLink | null => parse(raw).link

/** In-app route for a validated link. */
export function hrefFor(link: BaoLink): string {
  if (link.kind === 'join') return `/join/${link.code}`
  if (link.kind === 'circle') return `/circle/${link.id}`
  return `/${link.screen}/${link.address}`
}

/** Turns a scanned or tapped code into a place in the app: a packet, a circle invite, or nothing. */
export function routeForCode(data: string): string | null {
  const link = parseBaoLink(data)
  return link ? hrefFor(link) : null
}

/** Not a route: expo-router renders +not-found, which says the link was not a Bao link. */
export const BAD_LINK_PATH = '/not-a-bao-link'

/**
 * Incoming system links → a safe in-app path. Valid Bao links are rebuilt from their validated
 * parts (no query string survives); Bao-looking links that fail validation, and links to other
 * hosts, land on the not-found screen; anything else (app launch, shortcuts) passes through.
 */
export function systemPathFor(path: string): string {
  const { link, linkish } = parse(path)
  if (link) return hrefFor(link)
  return linkish ? BAD_LINK_PATH : path
}
