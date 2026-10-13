/**
 * IN9a: cursor pagination for the conversation list — pure helpers.
 *
 * The list's canonical order is (lastMessageAt DESC, id DESC). The
 * id is the tie-breaker: many conversations can share one
 * lastMessageAt (bulk imports, same-second messages), and a cursor
 * of the timestamp alone would skip or repeat the tied rows at a
 * page boundary. A cursor is the base64url-encoded JSON of the
 * boundary row's { t, id } — opaque to clients, validated strictly
 * on decode (anything malformed decodes to null and the caller
 * falls back to the first page instead of erroring the whole list).
 *
 * lastMessageAt is nullable in the schema. Postgres orders DESC
 * with NULLS FIRST, so a null timestamp sorts as the NEWEST key;
 * the key math here mirrors that (null → +Infinity) so the page
 * boundary is the same row the database would put last on the page.
 */

export interface ConversationCursor {
  /** ISO timestamp of the boundary row's lastMessageAt, or null. */
  t: string | null;
  id: string;
}

type CursorRow = { id: string; lastMessageAt?: Date | string | null };

/** Encode a row's position as an opaque cursor string. */
export function encodeConversationCursor(row: CursorRow): string {
  const t = row.lastMessageAt == null
    ? null
    : row.lastMessageAt instanceof Date
      ? row.lastMessageAt.toISOString()
      : new Date(row.lastMessageAt).toISOString();
  const payload: ConversationCursor = { t, id: String(row.id) };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Decode + strictly validate a cursor. Returns null for anything
 * malformed (bad base64/JSON, missing id, unparseable timestamp) —
 * callers treat null as "start from the first page". */
export function decodeConversationCursor(raw: unknown): ConversationCursor | null {
  if (typeof raw !== "string" || !raw || raw.length > 512) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const { t, id } = parsed as { t?: unknown; id?: unknown };
    if (typeof id !== "string" || !id) return null;
    if (t === null) return { t: null, id };
    if (typeof t !== "string" || Number.isNaN(new Date(t).getTime())) return null;
    return { t: new Date(t).toISOString(), id };
  } catch {
    return null;
  }
}

/**
 * The Prisma where-fragment selecting rows STRICTLY AFTER the
 * cursor in (lastMessageAt DESC, id DESC) order — composed under
 * AND by the caller so it stacks with every other list filter.
 *
 * - Cursor on a dated row: older rows, plus same-timestamp rows
 *   with a smaller id (the tie-break).
 * - Cursor on a null-timestamp row (nulls sort first, so these come
 *   before every dated row): the remaining null rows with a smaller
 *   id, plus ALL dated rows.
 */
export function conversationCursorWhere(cursor: ConversationCursor): Record<string, unknown> {
  if (cursor.t === null) {
    return {
      OR: [
        { lastMessageAt: null, id: { lt: cursor.id } },
        { lastMessageAt: { not: null } },
      ],
    };
  }
  const at = new Date(cursor.t);
  return {
    OR: [
      { lastMessageAt: { lt: at } },
      { lastMessageAt: at, id: { lt: cursor.id } },
    ],
  };
}

/** Sort key for a row: null lastMessageAt is the "newest" key
 * (Postgres DESC NULLS FIRST); ties fall to the id, descending. */
export function conversationCursorKey(row: CursorRow): { ms: number; id: string } {
  const ms = row.lastMessageAt == null
    ? Number.POSITIVE_INFINITY
    : new Date(row.lastMessageAt).getTime();
  return { ms: Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms, id: String(row.id) };
}

/**
 * The boundary row of a page: the row that sorts LAST under
 * (lastMessageAt DESC, id DESC) — i.e. the smallest key. The next
 * page starts strictly after it, so no row on this page can repeat
 * and no row after it in the canonical order can be skipped,
 * regardless of any within-page display re-sort (unread/SLA/etc.)
 * applied after the fetch.
 */
export function oldestCursorRow<T extends CursorRow>(rows: readonly T[]): T | null {
  let best: T | null = null;
  let bestKey: { ms: number; id: string } | null = null;
  for (const row of rows) {
    const key = conversationCursorKey(row);
    if (!bestKey || key.ms < bestKey.ms || (key.ms === bestKey.ms && key.id < bestKey.id)) {
      best = row;
      bestKey = key;
    }
  }
  return best;
}

/** Page size for cursor mode: default 100 (the historical list
 * cap), clamped to [1, 100] so a client can never widen the page
 * past the cap the counts/UI were built around. */
export function clampConversationPageLimit(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(1, Math.floor(n)));
}
