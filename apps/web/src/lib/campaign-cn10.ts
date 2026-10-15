/**
 * Campaign Builder Next CN10 — pure presentation helpers shared by
 * the builder and the campaigns hub. No fetching, no invented data:
 * every value comes from rows the pages already loaded.
 */

/** Split a comment body into plain / mention segments using the
 *  server-resolved mention names (row.mentions). A segment is a
 *  mention only when the body contains "@<name>" for a resolved
 *  name — unresolved "@text" stays plain. Longest names win so a
 *  name that prefixes another cannot shadow it. */
export function mentionSegments(
  body: string,
  mentionNames: string[],
): { text: string; mention: boolean }[] {
  const names = [...new Set(mentionNames.filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  if (!names.length || !body) return [{ text: body, mention: false }];
  const out: { text: string; mention: boolean }[] = [];
  let rest = body;
  while (rest.length) {
    let hit: { idx: number; name: string } | null = null;
    for (const name of names) {
      const idx = rest.indexOf(`@${name}`);
      if (idx >= 0 && (!hit || idx < hit.idx)) hit = { idx, name };
    }
    if (!hit) {
      out.push({ text: rest, mention: false });
      break;
    }
    if (hit.idx > 0) out.push({ text: rest.slice(0, hit.idx), mention: false });
    out.push({ text: `@${hit.name}`, mention: true });
    rest = rest.slice(hit.idx + hit.name.length + 1);
  }
  return out.length ? out : [{ text: body, mention: false }];
}

/** The ONE plan-level date the hub launch calendar may use: a real
 *  publish timestamp first, then a scheduled launch, then creation.
 *  Ad-set flight windows are deliberately NOT read here — the hub
 *  list payload carries no ad-set dates. */
export function planCalendarDate(p: {
  publishedAt?: string | null;
  publishAt?: string | null;
  createdAt?: string | null;
}): { date: Date; kind: "published" | "scheduled" | "created" } | null {
  if (p.publishedAt) return { date: new Date(p.publishedAt), kind: "published" };
  if (p.publishAt) return { date: new Date(p.publishAt), kind: "scheduled" };
  if (p.createdAt) return { date: new Date(p.createdAt), kind: "created" };
  return null;
}

export interface CalCell {
  day: Date;
  inMonth: boolean;
  isToday: boolean;
}

/** A Monday-first month grid (whole weeks) for the given month. */
export function monthGrid(year: number, month: number, today = new Date()): CalCell[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Mon=0 … Sun=6
  const start = new Date(year, month, 1 - lead);
  const cells: CalCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({
      day: d,
      inMonth: d.getMonth() === month,
      isToday:
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate(),
    });
    // Stop after the week containing the month's last day.
    const last = new Date(year, month + 1, 0);
    if (i >= 27 && d.getTime() >= last.getTime() && (i + 1) % 7 === 0) break;
  }
  return cells;
}

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
