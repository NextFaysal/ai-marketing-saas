/**
 * Inbox Next-Gen P1: pure composer text helpers (unit-tested).
 * Formatting uses WhatsApp-style markers (*bold*, _italic_) because
 * WhatsApp renders them natively; the composer only offers the
 * buttons on channels that render them (see inbox page).
 */
export interface EditResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Wrap the selection in a marker pair. With no selection, inserts
 * the pair and places the caret between the markers. */
export function wrapSelection(text: string, start: number, end: number, marker: string): EditResult {
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);
  const next = `${before}${marker}${selected}${marker}${after}`;
  if (selected.length === 0) {
    const caret = start + marker.length;
    return { text: next, selectionStart: caret, selectionEnd: caret };
  }
  return {
    text: next,
    selectionStart: start + marker.length,
    selectionEnd: end + marker.length,
  };
}

/** Insert text at the caret, replacing any selection. */
export function insertAtCursor(text: string, start: number, end: number, insert: string): EditResult {
  const next = text.slice(0, start) + insert + text.slice(end);
  const caret = start + insert.length;
  return { text: next, selectionStart: caret, selectionEnd: caret };
}

/**
 * Toggle "• " bullets on every line touched by the selection: if
 * all touched lines already start with the bullet, remove it;
 * otherwise add it to the lines that lack it.
 */
export function toggleBulletLines(text: string, start: number, end: number): EditResult {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = text.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = text.length;
  const block = text.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const allBulleted = lines.every((l) => l.startsWith("• "));
  const nextBlock = allBulleted
    ? lines.map((l) => l.slice(2)).join("\n")
    : lines.map((l) => (l.startsWith("• ") ? l : `• ${l}`)).join("\n");
  const next = text.slice(0, lineStart) + nextBlock + text.slice(lineEnd);
  return { text: next, selectionStart: lineStart, selectionEnd: lineStart + nextBlock.length };
}
