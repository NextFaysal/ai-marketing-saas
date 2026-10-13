import { describe, expect, it } from "vitest";
import { joinVoiceResults } from "./voice-input";

describe("joinVoiceResults (AP2 voice)", () => {
  it("separates final from interim and trims", () => {
    expect(joinVoiceResults([
      { isFinal: true, transcript: " গত সপ্তাহে " },
      { isFinal: false, transcript: "বিক্রি" },
    ])).toEqual({ finalText: "গত সপ্তাহে", interimText: "বিক্রি" });
  });
  it("concatenates multiple finals", () => {
    expect(joinVoiceResults([
      { isFinal: true, transcript: "hello " },
      { isFinal: true, transcript: "world" },
    ]).finalText).toBe("hello world");
  });
  it("empty → empty strings", () => {
    expect(joinVoiceResults([])).toEqual({ finalText: "", interimText: "" });
  });
});
