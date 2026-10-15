import { describe, expect, it } from "vitest";
import { applyMention, mentionQueryOf } from "./mentions";

describe("mentionQueryOf", () => {
  it("detects a trailing @token", () => {
    expect(mentionQueryOf("এই @1042")).toEqual({ query: "1042", start: 3 });
    expect(mentionQueryOf("@")).toEqual({ query: "", start: 0 });
    expect(mentionQueryOf("hello @rah")).toEqual({ query: "rah", start: 6 });
  });
  it("no token → null", () => {
    expect(mentionQueryOf("hello")).toBeNull();
    expect(mentionQueryOf("email a@b.com লিখলাম")).toBeNull(); // @ glued to a word is not a mention
    expect(mentionQueryOf("@1042 অর্ডারটা")).toBeNull(); // token not trailing
  });
});

describe("applyMention", () => {
  it("replaces the trailing token with @label + space", () => {
    expect(applyMention("এই @104", { type: "order", id: "o1", label: "অর্ডার #1042", sub: "" }))
      .toBe("এই @অর্ডার #1042 ");
  });
  it("no token → input unchanged", () => {
    expect(applyMention("hello", { type: "order", id: "o1", label: "x", sub: "" })).toBe("hello");
  });
});
