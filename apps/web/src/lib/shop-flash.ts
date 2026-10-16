/**
 * GB7 (GC18) — flash-sale countdown helpers (pure).
 *
 * The shop home payload carries the SERVER's clock (`serverNow`)
 * alongside each flash sale's `endsAt`, because the visitor's own
 * clock may be wrong. We compute the offset between server time
 * and client time ONCE at mount, then every remaining-time read
 * is `endsAt - (clientNow + offset)` — honest to the server clock
 * without re-fetching.
 */

/** Offset to add to a client timestamp to get server time. */
export function flashOffsetMs(serverNowIso: string, clientNowMs: number): number {
  const serverMs = Date.parse(serverNowIso);
  if (!Number.isFinite(serverMs) || !Number.isFinite(clientNowMs)) return 0;
  return serverMs - clientNowMs;
}

/** Milliseconds until `endsAtIso` on the server clock; never negative. */
export function flashRemainingMs(endsAtIso: string, offsetMs: number, clientNowMs: number): number {
  const endsMs = Date.parse(endsAtIso);
  if (!Number.isFinite(endsMs) || !Number.isFinite(clientNowMs)) return 0;
  const off = Number.isFinite(offsetMs) ? offsetMs : 0;
  return Math.max(0, endsMs - (clientNowMs + off));
}

/**
 * "HH:MM:SS" — hours are TOTAL hours (may exceed 24, zero-padded
 * to at least 2 digits); minutes/seconds are the remainders.
 * Negative / non-finite input clamps to "00:00:00".
 */
export function formatCountdown(ms: number): string {
  const totalSeconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
