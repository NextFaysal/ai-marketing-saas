/**
 * SU11 — cursor pagination for the social post list (pure helpers).
 *
 * Mirrors the IN9 conversation-cursor discipline exactly:
 * - The list's canonical order is (createdAt DESC, id DESC); the id
 *   is the tie-breaker because many posts can share one createdAt.
 * - A cursor is the base64url-encoded JSON of the boundary row's
 *   { createdAt, id } — opaque to clients, strictly validated on
 *   decode. Anything malformed decodes to null and the caller falls
 *   back to the FIRST page (never a 400, never a throw) — the IN9
 *   rule, pinned by social-su11.spec.ts.
 */

export interface SocialPostCursor {
  /** ISO timestamp of the boundary row's createdAt. */
  createdAt: string;
  id: string;
}

type CursorRow = { id: string; createdAt?: Date | string | null };

/** Encode a row's position as an opaque cursor string. */
export function encodeSocialPostCursor(row: CursorRow): string {
  const createdAt = row.createdAt instanceof Date
    ? row.createdAt.toISOString()
    : new Date(row.createdAt ?? 0).toISOString();
  const payload: SocialPostCursor = { createdAt, id: String(row.id) };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Decode + strictly validate a cursor. Returns null for anything
 * malformed (bad base64/JSON, missing id, unparseable timestamp) —
 * callers treat null as "start from the first page". */
export function decodeSocialPostCursor(raw: unknown): SocialPostCursor | null {
  if (typeof raw !== "string" || !raw || raw.length > 512) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const { createdAt, id } = parsed as { createdAt?: unknown; id?: unknown };
    if (typeof id !== "string" || !id) return null;
    if (typeof createdAt !== "string" || Number.isNaN(new Date(createdAt).getTime())) return null;
    return { createdAt: new Date(createdAt).toISOString(), id };
  } catch {
    return null;
  }
}

/**
 * The Prisma where-fragment selecting rows STRICTLY AFTER the
 * cursor in (createdAt DESC, id DESC) order — composed under AND
 * by the caller so it stacks with every other list filter:
 * older rows, plus same-timestamp rows with a smaller id.
 */
export function socialPostCursorWhere(cursor: SocialPostCursor): Record<string, unknown> {
  const at = new Date(cursor.createdAt);
  return {
    OR: [
      { createdAt: { lt: at } },
      { createdAt: at, id: { lt: cursor.id } },
    ],
  };
}

/** Page size for cursor mode: default 100 (the IN9 default),
 * clamped to [1, 100]. */
export function clampSocialPostPageLimit(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(1, Math.floor(n)));
}
