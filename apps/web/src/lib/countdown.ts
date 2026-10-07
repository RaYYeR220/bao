/**
 * The countdown as the app writes it: "23h 44m", "12:07" in the last hour, "3 days" beyond two.
 * Shared by the server (first frame) and the ticking client component, so both print the same.
 */
export function countdownText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 48) return `${Math.floor(h / 24)} days`;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s % 60).padStart(2, '0')}`;
}
