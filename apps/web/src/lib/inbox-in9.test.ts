import { describe, expect, it } from "vitest";
import {
  appendConversationPage,
  clearComposerDraft,
  composerDraftKey,
  loadComposerDraft,
  saveComposerDraft,
  type DraftStorage,
} from "./inbox-in9";

// IN9d: composer drafts persist per conversation, restore on open,
// and clear on empty/send — against an in-memory storage fake.
function memoryStorage(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

describe("composer drafts (IN9d)", () => {
  it("saves, loads and clears a draft under the conversation's key", () => {
    const s = memoryStorage();
    saveComposerDraft(s, "conv-1", "দাম কত?");
    expect(s.map.get(composerDraftKey("conv-1"))).toBe("দাম কত?");
    expect(loadComposerDraft(s, "conv-1")).toBe("দাম কত?");
    clearComposerDraft(s, "conv-1");
    expect(loadComposerDraft(s, "conv-1")).toBe("");
  });

  it("keeps drafts isolated per conversation", () => {
    const s = memoryStorage();
    saveComposerDraft(s, "conv-1", "এক");
    saveComposerDraft(s, "conv-2", "দুই");
    expect(loadComposerDraft(s, "conv-1")).toBe("এক");
    expect(loadComposerDraft(s, "conv-2")).toBe("দুই");
    clearComposerDraft(s, "conv-1");
    expect(loadComposerDraft(s, "conv-2")).toBe("দুই");
  });

  it("saving an empty text removes the draft (the clear-on-send path)", () => {
    const s = memoryStorage();
    saveComposerDraft(s, "conv-1", "লেখা");
    saveComposerDraft(s, "conv-1", "");
    expect(s.map.has(composerDraftKey("conv-1"))).toBe(false);
  });

  it("never throws against a broken storage and loads as empty", () => {
    const broken: DraftStorage = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    };
    expect(() => saveComposerDraft(broken, "c", "x")).not.toThrow();
    expect(() => clearComposerDraft(broken, "c")).not.toThrow();
    expect(loadComposerDraft(broken, "c")).toBe("");
    expect(loadComposerDraft(null, "c")).toBe("");
    expect(loadComposerDraft(memoryStorage(), null)).toBe("");
  });
});

describe("appendConversationPage (IN9a)", () => {
  const row = (id: string, preview = "") => ({ id, lastMessagePreview: preview });

  it("appends new rows in page order", () => {
    const out = appendConversationPage([row("a"), row("b")], [row("c"), row("d")]);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("de-duplicates by id — the existing (fresher) row wins", () => {
    const out = appendConversationPage(
      [row("a"), row("b", "fresh")],
      [row("b", "stale"), row("c")],
    );
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(out[1].lastMessagePreview).toBe("fresh");
  });

  it("an empty page returns an equal list", () => {
    const existing = [row("a")];
    expect(appendConversationPage(existing, [])).toEqual(existing);
  });
});
