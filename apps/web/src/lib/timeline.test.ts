import { describe, expect, it } from "vitest";
import { mergeTimeline } from "./timeline";

const msg = (id: string, createdAt: string) => ({ id, createdAt });
const note = (id: string, createdAt: string) => ({ id, createdAt, content: `note-${id}` });

describe("mergeTimeline", () => {
  it("merges messages and notes sorted by createdAt ascending", () => {
    const items = mergeTimeline(
      [msg("m2", "2026-01-01T10:02:00.000Z"), msg("m1", "2026-01-01T10:00:00.000Z")],
      [note("n1", "2026-01-01T10:01:00.000Z")],
    );
    expect(items.map((i) => i.kind)).toEqual(["message", "note", "message"]);
    expect(items.map((i) => (i.kind === "message" ? i.message.id : i.note.id))).toEqual(["m1", "n1", "m2"]);
    expect(items.map((i) => i.at)).toEqual([
      "2026-01-01T10:00:00.000Z",
      "2026-01-01T10:01:00.000Z",
      "2026-01-01T10:02:00.000Z",
    ]);
  });

  it("puts messages before notes on an exact timestamp tie", () => {
    const at = "2026-01-01T10:00:00.000Z";
    const items = mergeTimeline([msg("m1", at)], [note("n1", at)]);
    expect(items.map((i) => i.kind)).toEqual(["message", "note"]);
  });

  it("is stable within the same kind on ties", () => {
    const at = "2026-01-01T10:00:00.000Z";
    const items = mergeTimeline(
      [msg("m1", at), msg("m2", at)],
      [note("n1", at), note("n2", at)],
    );
    expect(items.map((i) => (i.kind === "message" ? i.message.id : i.note.id))).toEqual(["m1", "m2", "n1", "n2"]);
  });

  it("handles empty inputs", () => {
    expect(mergeTimeline([], [])).toEqual([]);
    expect(mergeTimeline([msg("m1", "2026-01-01T10:00:00.000Z")], []).map((i) => i.kind)).toEqual(["message"]);
    expect(mergeTimeline([], [note("n1", "2026-01-01T10:00:00.000Z")]).map((i) => i.kind)).toEqual(["note"]);
  });

  it("does not mutate its inputs", () => {
    const messages = [msg("m2", "2026-01-01T10:02:00.000Z"), msg("m1", "2026-01-01T10:00:00.000Z")];
    const notes = [note("n1", "2026-01-01T10:01:00.000Z")];
    mergeTimeline(messages, notes);
    expect(messages.map((m) => m.id)).toEqual(["m2", "m1"]);
    expect(notes.map((n) => n.id)).toEqual(["n1"]);
  });
});
