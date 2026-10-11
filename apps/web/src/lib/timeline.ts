/**
 * Inbox Next-Gen P3: merged message + internal-note timeline.
 *
 * Pure helper — the thread renders ONE chronological stream where
 * internal notes (whispers) sit inline between messages instead of
 * living in a separate side panel. Sorting is by createdAt asc;
 * ordering is stable, and on an exact timestamp tie a message
 * comes before a note (the customer-visible event happened, then
 * the team's reaction to it).
 */

export interface TimelineMessageLike {
  id: string;
  createdAt: string;
}

export interface TimelineNoteLike {
  id: string;
  createdAt: string;
}

export type TimelineItem<M extends TimelineMessageLike = TimelineMessageLike, N extends TimelineNoteLike = TimelineNoteLike> =
  | { kind: "message"; at: string; message: M }
  | { kind: "note"; at: string; note: N };

export function mergeTimeline<M extends TimelineMessageLike, N extends TimelineNoteLike>(
  messages: readonly M[],
  notes: readonly N[],
): TimelineItem<M, N>[] {
  const items: (TimelineItem<M, N> & { _idx: number })[] = [];
  messages.forEach((message, i) => {
    items.push({ kind: "message", at: message.createdAt, message, _idx: i });
  });
  notes.forEach((note, i) => {
    items.push({ kind: "note", at: note.createdAt, note, _idx: messages.length + i });
  });
  items.sort((a, b) => {
    const ta = new Date(a.at).getTime();
    const tb = new Date(b.at).getTime();
    const na = Number.isNaN(ta) ? 0 : ta;
    const nb = Number.isNaN(tb) ? 0 : tb;
    if (na !== nb) return na - nb;
    if (a.kind !== b.kind) return a.kind === "message" ? -1 : 1;
    return a._idx - b._idx;
  });
  return items.map(({ _idx: _ignored, ...rest }) => rest as TimelineItem<M, N>);
}
