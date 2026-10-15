import { describe, expect, it } from "vitest";
import {
  chipForStep,
  chipSymbol,
  createSaverRegistry,
  idleSaveState,
  markDirty,
  markFailed,
  markSaved,
  readinessCounts,
  runStepSavers,
  saveStateLabel,
  startSaving,
  stepIndexForKey,
} from "./campaign-step-shell";

const checks = [
  { key: "account", level: "ok" },
  { key: "targeting", level: "warn" },
  { key: "budget", level: "error" },
  { key: "policy", level: "ok" },
  { key: "landing", level: "ok" },
];

describe("stepIndexForKey", () => {
  it("arrows move one step and clamp at the ends", () => {
    expect(stepIndexForKey(0, "ArrowRight", 5)).toBe(1);
    expect(stepIndexForKey(4, "ArrowRight", 5)).toBe(4);
    expect(stepIndexForKey(2, "ArrowLeft", 5)).toBe(1);
    expect(stepIndexForKey(0, "ArrowLeft", 5)).toBe(0);
  });
  it("Home / End jump to the first / last step", () => {
    expect(stepIndexForKey(3, "Home", 5)).toBe(0);
    expect(stepIndexForKey(1, "End", 5)).toBe(4);
  });
  it("other keys and empty rails are ignored", () => {
    expect(stepIndexForKey(2, "Enter", 5)).toBeNull();
    expect(stepIndexForKey(2, "a", 5)).toBeNull();
    expect(stepIndexForKey(0, "ArrowRight", 0)).toBeNull();
  });
});

describe("chipForStep", () => {
  it("unknown before readiness has ever been fetched", () => {
    expect(chipForStep(null, 0)).toBe("unknown");
    expect(chipForStep(undefined, 2)).toBe("unknown");
    expect(chipForStep([], 4)).toBe("unknown");
    expect(chipSymbol("unknown")).toBe("–");
  });
  it("error beats warn beats ok within a step's own checks", () => {
    expect(chipForStep(checks, 2)).toBe("error"); // budget error
    expect(chipSymbol(chipForStep(checks, 2))).toBe("⛔");
    expect(chipForStep(checks, 1)).toBe("warn"); // targeting warn
    expect(chipSymbol(chipForStep(checks, 1))).toBe("⚠");
    expect(chipForStep(checks, 0)).toBe("ok"); // account ok only
    expect(chipForStep(checks, 3)).toBe("ok"); // policy + landing ok
    expect(chipSymbol(chipForStep(checks, 3))).toBe("✓");
  });
  it("a step owning no returned check stays unknown, not ok", () => {
    expect(chipForStep([{ key: "budget", level: "ok" }], 1)).toBe("unknown");
  });
  it("review aggregates every check", () => {
    expect(chipForStep(checks, 4)).toBe("error");
    expect(chipForStep([{ key: "budget", level: "ok" }], 4)).toBe("ok");
  });
  it("readinessCounts tallies levels", () => {
    expect(readinessCounts(checks)).toEqual({ errors: 1, warnings: 1, oks: 3 });
    expect(readinessCounts(null)).toEqual({ errors: 0, warnings: 0, oks: 0 });
  });
});

describe("save-state machine", () => {
  it("dirty → saving → saved, with a bn-BD time label", () => {
    const dirty = markDirty(idleSaveState);
    expect(dirty.kind).toBe("dirty");
    const saving = startSaving(dirty);
    expect(saving.kind).toBe("saving");
    expect(saveStateLabel(saving)).toBe("সেভ হচ্ছে…");
    const saved = markSaved(saving, new Date(2026, 9, 15, 14, 5));
    expect(saved.kind).toBe("saved");
    if (saved.kind === "saved") expect(saved.at.length).toBeGreaterThan(0);
    expect(saveStateLabel(saved)).toContain("সব সেভ হয়েছে · ");
  });
  it("failure lands in the retry state and never reads as saved", () => {
    const failed = markFailed(startSaving(markDirty(idleSaveState)));
    expect(failed.kind).toBe("failed");
    expect(saveStateLabel(failed)).toBe("⚠ সেভ হয়নি — আবার চেষ্টা করুন");
    expect(saveStateLabel(failed)).not.toContain("সব সেভ হয়েছে");
    // A retry can still succeed from the failed state.
    const retried = markSaved(startSaving(failed), new Date(2026, 9, 15, 14, 6));
    expect(retried.kind).toBe("saved");
  });
});

describe("saver registry + runner", () => {
  it("registers per step and runs sequentially in order", async () => {
    const reg = createSaverRegistry();
    const order: string[] = [];
    reg.register(1, "a", async () => { order.push("a"); return true; });
    reg.register(1, "b", async () => { order.push("b"); return true; });
    reg.register(2, "c", async () => { order.push("c"); return true; });
    expect(reg.saversFor(1).map((s) => s.key)).toEqual(["a", "b"]);
    expect(await runStepSavers(reg.saversFor(1))).toBe(true);
    expect(order).toEqual(["a", "b"]);
    const off = reg.register(1, "d", async () => true);
    off();
    expect(reg.saversFor(1).map((s) => s.key)).toEqual(["a", "b"]);
  });
  it("first failure stops the run and reports false (no saved)", async () => {
    const order: string[] = [];
    const savers = [
      { key: "a", run: async () => { order.push("a"); return true; } },
      { key: "b", run: async () => { order.push("b"); return false; } },
      { key: "c", run: async () => { order.push("c"); return true; } },
    ];
    expect(await runStepSavers(savers)).toBe(false);
    expect(order).toEqual(["a", "b"]); // c never ran
  });
  it("a throwing saver is a failure; an empty step passes", async () => {
    expect(await runStepSavers([{ key: "x", run: async () => { throw new Error("nope"); } }])).toBe(false);
    expect(await runStepSavers([])).toBe(true);
  });
});
