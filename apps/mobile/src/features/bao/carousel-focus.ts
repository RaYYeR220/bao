/**
 * Which card a carousel is on while its list changes under it.
 *
 * One rule keeps the card, the counter and the caption in agreement: the shown index is read from
 * the scroll offset and from nothing else. When the list changes, this asks for a scroll that
 * brings the wanted card back to the centre and waits for the offset to report it; it never
 * moves the index on its own. A scroll can be late or cut short (asked for before a longer list
 * is laid out, it is clamped to the old width), so the target stays `pending` and is asked for
 * again once the content has been laid out.
 *
 * Every method that may need the list moved returns the card index to scroll to, without
 * animation, or null.
 */
export function createCarouselFocus() {
  let keys: string[] = []
  // round(offset / card width) as last reported: not clamped, the offset can sit past a list that shrank
  let raw = 0
  // the card to keep centred when the list changes
  let want: string | null = null
  // where a re-centring scroll is headed; null when the offset is where it should be
  let pending: number | null = null
  // a finger, or the fling it started, is moving the carousel: nothing is scrolled under it
  let gesturing = false

  const clamp = (i: number) => Math.max(0, Math.min(keys.length - 1, i))

  /** Aims at the wanted card if it is still listed (and `keep`), else at the card under the offset. */
  function aim(keep: boolean): number | null {
    if (!keys.length || gesturing) return null
    const at = keep && want !== null ? keys.indexOf(want) : -1
    const target = at >= 0 ? at : clamp(raw)
    want = keys[target]
    pending = target === raw ? null : target
    return pending
  }

  return {
    /** The list changed (first load, a packet came or went, another source with another order). */
    setKeys(next: string[]): number | null {
      keys = next
      return aim(true)
    },
    /** The offset now rounds to card `at`. Returns the index the counter and caption show. */
    onOffset(at: number): number {
      raw = at
      if (pending !== null) {
        if (raw === pending) pending = null
      } else if (keys.length) {
        // nobody asked for this move: the user (or a native clamp) chose this card
        want = keys[clamp(raw)]
      }
      return clamp(raw)
    },
    /** The content was laid out again: the scroll still owed, to be asked for once more. */
    owed: (): number | null => (gesturing ? null : pending),
    beginGesture() {
      gesturing = true
      // the user takes over; where they land becomes the wanted card
      pending = null
    },
    /** The finger is up and the fling has settled (a settle that no drag began is not a gesture). */
    endGesture(): number | null {
      if (!gesturing) return null
      gesturing = false
      return aim(false)
    },
    /** Bring this card to the centre (a packet just dropped). */
    focusOn(key: string): number | null {
      if (gesturing || !keys.includes(key)) return null
      want = key
      return aim(true)
    },
    get gesturing() {
      return gesturing
    },
  }
}

export type CarouselFocus = ReturnType<typeof createCarouselFocus>
