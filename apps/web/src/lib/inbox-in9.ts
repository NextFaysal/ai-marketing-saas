/**
 * IN9: pure helpers for cursor pagination + the offline-tolerant
 * composer draft in the inbox page.
 *
 * Drafts (IN9d): the composer's unsent text is kept per
 * conversation in localStorage (the same browser-only, best-effort
 * pattern as the UX1 filter/folder persistence). A draft is a
 * convenience copy ONLY — it is never a message, never marked sent,
 * and a successful send clears it (the text then lives in the
 * thread; a failed send keeps its copy in the UX1 pending bubble,
 * whose retry is the recovery path). Storage failures (private
 * mode, quota) degrade to "no draft", never an error.
 *
 * Pagination (IN9a): appendConversationPage merges the next cursor
 * page into the loaded list — first occurrence wins, so a row that
 * was already loaded (e.g. refreshed in place) is never duplicated
 * by a page that was fetched against a slightly older boundary.
 */

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const composerDraftKey = (conversationId: string): string => `inbox.draft.${conversationId}`;

/** The browser's localStorage, or null where it is unavailable
 * (SSR, blocked storage). Never throws. */
export function getDraftStorage(): DraftStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadComposerDraft(storage: DraftStorage | null, conversationId: string | null | undefined): string {
  if (!storage || !conversationId) return "";
  try {
    return storage.getItem(composerDraftKey(conversationId)) ?? "";
  } catch {
    return "";
  }
}

export function saveComposerDraft(storage: DraftStorage | null, conversationId: string | null | undefined, text: string): void {
  if (!storage || !conversationId) return;
  try {
    // An empty composer has no draft — storing "" would only leave
    // litter behind and defeat the clear-on-send rule.
    if (!text) storage.removeItem(composerDraftKey(conversationId));
    else storage.setItem(composerDraftKey(conversationId), text);
  } catch { /* drafts are best-effort */ }
}

export function clearComposerDraft(storage: DraftStorage | null, conversationId: string | null | undefined): void {
  if (!storage || !conversationId) return;
  try {
    storage.removeItem(composerDraftKey(conversationId));
  } catch { /* drafts are best-effort */ }
}

/** Append the next cursor page to the loaded list, de-duplicated
 * by id (existing rows keep their position and their fresher
 * local state; page rows that are new append in page order). */
export function appendConversationPage<T extends { id: string }>(existing: readonly T[], page: readonly T[]): T[] {
  const seen = new Set(existing.map((c) => c.id));
  const fresh = page.filter((c) => !seen.has(c.id));
  return fresh.length ? [...existing, ...fresh] : [...existing];
}
