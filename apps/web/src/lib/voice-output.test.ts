import { describe, expect, it } from "vitest";
import { langForText, stripForSpeech } from "./voice-output";

describe("voice-output helpers (AP7 voice-first)", () => {
  it("strips markdown structure for speech", () => {
    const out = stripForSpeech("## সারসংক্ষেপ\n\n**মোট বিক্রি:** ৫০০ টাকা\n\n- অর্ডার | ১২টি\n\n`code` এবং [লিংক](https://x.com)");
    expect(out).not.toContain("#");
    expect(out).not.toContain("**");
    expect(out).not.toContain("|");
    expect(out).toContain("মোট বিক্রি:");
    expect(out).toContain("লিংক");
  });
  it("removes fenced code blocks entirely", () => {
    expect(stripForSpeech("আগে\n```js\nconst x = 1;\n```\nপরে")).toBe("আগে পরে");
  });
  it("picks bn-BD for Bengali text, en-US otherwise", () => {
    expect(langForText("গতকালের বিক্রি")).toBe("bn-BD");
    expect(langForText("Yesterday sales")).toBe("en-US");
  });
  it("caps very long answers", () => {
    expect(stripForSpeech("ক".repeat(5000)).length).toBeLessThanOrEqual(1800);
  });
});
