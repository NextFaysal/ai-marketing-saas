/**
 * IN3 web helpers: macro step summaries, honest run-result
 * formatting (success only when every step succeeded; skipped
 * steps are called skipped), bulk-reply summary.
 */
import { describe, expect, it } from "vitest";
import { bulkReplySummary, formatMacroRunResult, macroRunStepLines, macroStepSummary, type MacroRunResult } from "./inbox-in3";

describe("macroStepSummary", () => {
  it("resolves names through lookups and never invents them", () => {
    expect(macroStepSummary({ type: "reply", quickReplyId: "qr-1" }, { quickReplyTitle: (id) => (id === "qr-1" ? "অর্ডার আপডেট" : undefined) })).toContain("অর্ডার আপডেট");
    expect(macroStepSummary({ type: "reply", quickReplyId: "qr-x" }, { quickReplyTitle: () => undefined })).toBe("💬 উত্তর");
    expect(macroStepSummary({ type: "assign", assignedUserId: "me" })).toContain("নিজেকে");
    expect(macroStepSummary({ type: "assign", assignedUserId: null })).toContain("তুলে নিন");
    expect(macroStepSummary({ type: "assign", assignedUserId: "u-9" }, { memberName: () => undefined })).toContain("u-9");
    expect(macroStepSummary({ type: "snooze", minutes: 120 })).toContain("120 মিনিট");
    expect(macroStepSummary({ type: "close", outcome: "sale" })).toContain("sale");
  });
});

const run = (patch: Partial<MacroRunResult>): MacroRunResult => ({
  macroId: "m1", macroName: "ফলোআপ", conversationId: "c1",
  success: true, completed: 2, total: 2,
  steps: [{ index: 0, type: "reply", ok: true }, { index: 1, type: "tag", ok: true }],
  ...patch,
});

describe("formatMacroRunResult", () => {
  it("reports full success plainly", () => {
    expect(formatMacroRunResult(run({}))).toContain("সম্পন্ন");
    expect(formatMacroRunResult(run({}))).toContain("2/2");
  });
  it("names the failed step + error and counts the skipped ones", () => {
    const r = run({
      success: false, completed: 1, total: 3,
      steps: [
        { index: 0, type: "tag", ok: true },
        { index: 1, type: "reply", ok: false, error: "Message was NOT sent: window closed" },
        { index: 2, type: "assign", ok: false, skipped: true },
      ],
    });
    const text = formatMacroRunResult(r);
    expect(text).toContain("থেমেছে");
    expect(text).toContain("NOT sent");
    expect(text).toContain("বাকি 1টি ধাপ হয়নি");
    const lines = macroRunStepLines(r);
    expect(lines[0]).toMatch(/^✓/);
    expect(lines[1]).toMatch(/^✗/);
    expect(lines[2]).toMatch(/^⏭/);
  });
});

describe("bulkReplySummary", () => {
  it("mirrors the server counts", () => {
    expect(bulkReplySummary(3, 0)).toContain("3টি");
    expect(bulkReplySummary(3, 0)).not.toContain("পাঠানো যায়নি");
    expect(bulkReplySummary(1, 2)).toContain("পাঠানো যায়নি 2টি");
  });
});
