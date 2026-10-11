import { describe, expect, it } from "vitest";
import { insertAtCursor, toggleBulletLines, wrapSelection } from "./composer-format";

describe("wrapSelection", () => {
  it("wraps a selection in bold markers and keeps it selected", () => {
    const r = wrapSelection("hello world", 6, 11, "*");
    expect(r.text).toBe("hello *world*");
    expect(r.text.slice(r.selectionStart, r.selectionEnd)).toBe("world");
  });

  it("inserts an empty pair and puts the caret in the middle", () => {
    const r = wrapSelection("hi ", 3, 3, "_");
    expect(r.text).toBe("hi __");
    expect(r.selectionStart).toBe(4);
    expect(r.selectionEnd).toBe(4);
  });

  it("does not touch text outside the selection (Bengali safe)", () => {
    const r = wrapSelection("দাম ৫০০ টাকা", 4, 7, "*");
    expect(r.text).toBe("দাম *৫০০* টাকা");
  });
});

describe("insertAtCursor", () => {
  it("inserts an emoji at the caret", () => {
    const r = insertAtCursor("abc", 1, 1, "😀");
    expect(r.text).toBe("a😀bc");
    expect(r.selectionStart).toBe(1 + "😀".length);
  });

  it("replaces the current selection", () => {
    const r = insertAtCursor("hello world", 6, 11, "সবাই");
    expect(r.text).toBe("hello সবাই");
  });
});

describe("toggleBulletLines", () => {
  it("adds bullets to every touched line", () => {
    const r = toggleBulletLines("one\ntwo", 0, 7);
    expect(r.text).toBe("• one\n• two");
  });

  it("removes bullets when all lines already have them", () => {
    const r = toggleBulletLines("• one\n• two", 0, 11);
    expect(r.text).toBe("one\ntwo");
  });

  it("only affects the lines inside the selection", () => {
    const r = toggleBulletLines("keep\none\ntwo\nkeep2", 5, 12);
    expect(r.text).toBe("keep\n• one\n• two\nkeep2");
  });
});
