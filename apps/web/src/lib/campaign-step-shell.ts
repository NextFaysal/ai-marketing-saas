/**
 * Campaign Builder DX2 — step-shell logic (pure, no fetching).
 *
 * Two pieces the builder page shares with its tests:
 *
 * 1. Step ↔ readiness mapping. The readiness endpoint returns
 *    checks with keys: structure, policy, account, schedule,
 *    landing, budget, targeting, events, lead_form, whatsapp,
 *    creative, funnel (see the API readiness() in
 *    campaigns.service.ts). Each builder step owns the checks
 *    whose fix lives in that step:
 *      0 Objective        — account, events, lead_form,
 *                           structure, whatsapp (destination)
 *      1 Audience         — targeting, schedule, funnel
 *      2 Budget / Bidding — budget
 *      3 Creative         — policy, landing, creative
 *      4 Review           — every check (the full panel)
 *    A step chip is ⛔ when any of its checks is an error,
 *    ⚠ when any is a warning, ✓ when all are ok, and a neutral
 *    "–" before readiness has ever been fetched (or when the
 *    step owns no returned check yet).
 *
 * 2. The unified save-state machine. Autosave is honest: the
 *    "saved" state is reachable ONLY through markSaved, which
 *    the page calls after the savers' API calls have actually
 *    succeeded. A failure lands in "failed" and stays there
 *    until a retry succeeds — it never degrades to "saved".
 */

export interface ReadinessCheckLike {
  key: string;
  level: string;
}

export const STEP_CHECK_KEYS: Record<number, string[]> = {
  0: ["account", "events", "lead_form", "structure", "whatsapp"],
  1: ["targeting", "schedule", "funnel"],
  2: ["budget"],
  3: ["policy", "landing", "creative"],
  // Step 4 (Review) owns every check — handled specially below.
  4: [],
};

export type StepChip = "error" | "warn" | "ok" | "unknown";

export function chipForStep(
  checks: ReadinessCheckLike[] | null | undefined,
  step: number,
): StepChip {
  if (!checks || checks.length === 0) return "unknown";
  const mine =
    step === 4
      ? checks
      : checks.filter((c) => (STEP_CHECK_KEYS[step] ?? []).includes(c.key));
  if (mine.length === 0) return "unknown";
  if (mine.some((c) => c.level === "error")) return "error";
  if (mine.some((c) => c.level === "warn")) return "warn";
  return "ok";
}

export const chipSymbol = (chip: StepChip): string =>
  chip === "error" ? "⛔" : chip === "warn" ? "⚠" : chip === "ok" ? "✓" : "–";

export function readinessCounts(
  checks: ReadinessCheckLike[] | null | undefined,
): { errors: number; warnings: number; oks: number } {
  const list = checks ?? [];
  return {
    errors: list.filter((c) => c.level === "error").length,
    warnings: list.filter((c) => c.level === "warn").length,
    oks: list.filter((c) => c.level === "ok").length,
  };
}

/* ---------------- save-state machine ---------------- */

export type SaveState =
  | { kind: "idle" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "failed" };

export const idleSaveState: SaveState = { kind: "idle" };

export function markDirty(_state: SaveState): SaveState {
  return { kind: "dirty" };
}

export function startSaving(_state: SaveState): SaveState {
  return { kind: "saving" };
}

/** "HH:MM" in the active locale, the format the summary rail displays.
 * ML6 (W-D): `locale` threaded with a "bn" default — existing
 * callers/tests keep the byte-identical bn output. */
export function formatSavedTime(d: Date, locale: "bn" | "en" = "bn"): string {
  return d.toLocaleTimeString(locale === "en" ? "en-IN" : "bn-BD", { hour: "2-digit", minute: "2-digit" });
}

/** Only call this after the savers' API calls actually succeeded. */
export function markSaved(_state: SaveState, when: Date, locale: "bn" | "en" = "bn"): SaveState {
  return { kind: "saved", at: formatSavedTime(when, locale) };
}

export function markFailed(_state: SaveState): SaveState {
  return { kind: "failed" };
}

export function saveStateLabel(state: SaveState, locale: "bn" | "en" = "bn"): string {
  if (locale === "en") {
    switch (state.kind) {
      case "saving":
        return "Saving…";
      case "saved":
        return `All saved · ${state.at}`;
      case "failed":
        return "⚠ Not saved — try again";
      case "dirty":
        return "✎ Unsaved changes — saved when you change step";
      default:
        return "Save status: no changes yet";
    }
  }
  switch (state.kind) {
    case "saving":
      return "সেভ হচ্ছে…";
    case "saved":
      return `সব সেভ হয়েছে · ${state.at}`;
    case "failed":
      return "⚠ সেভ হয়নি — আবার চেষ্টা করুন";
    case "dirty":
      return "✎ সেভ বাকি আছে — ধাপ বদলালে সেভ হবে";
    default:
      return "সেভের অবস্থা: এখনো কোনো বদল হয়নি";
  }
}

/* ---------------- keyboard navigation (Design Round 2) ---------------- */

/**
 * Tabs-pattern keyboard map for the step rail: ArrowRight /
 * ArrowLeft move one step (clamped at the ends), Home / End
 * jump to the first / last step. Returns the target index,
 * or null for any other key (the caller leaves the event
 * alone). Pure — the page wires it to goStep + focus.
 */
export function stepIndexForKey(
  current: number,
  key: string,
  total: number,
): number | null {
  if (total <= 0) return null;
  const cur = Math.min(Math.max(current, 0), total - 1);
  switch (key) {
    case "ArrowRight":
      return Math.min(cur + 1, total - 1);
    case "ArrowLeft":
      return Math.max(cur - 1, 0);
    case "Home":
      return 0;
    case "End":
      return total - 1;
    default:
      return null;
  }
}

/* ---------------- saver registry / runner ---------------- */

export type StepSaver = () => Promise<boolean>;

/**
 * A registry of savers keyed by step. Sections register the
 * exact API call their own save button performs; navigation
 * runs the current step's savers before leaving it.
 */
export function createSaverRegistry() {
  const byStep = new Map<number, Map<string, StepSaver>>();
  return {
    register(step: number, key: string, saver: StepSaver): () => void {
      let m = byStep.get(step);
      if (!m) {
        m = new Map();
        byStep.set(step, m);
      }
      m.set(key, saver);
      return () => {
        m?.delete(key);
      };
    },
    saversFor(step: number): { key: string; run: StepSaver }[] {
      const m = byStep.get(step);
      if (!m) return [];
      return [...m.entries()].map(([key, run]) => ({ key, run }));
    },
    clearStep(step: number): void {
      byStep.delete(step);
    },
  };
}

/**
 * Run savers sequentially. Returns true only when EVERY saver
 * reported success; the first failure (false or thrown) stops
 * the run and returns false — the caller must stay on the step
 * and surface the retry state, never "saved".
 */
export async function runStepSavers(
  savers: { key: string; run: StepSaver }[],
): Promise<boolean> {
  for (const s of savers) {
    let ok = false;
    try {
      ok = await s.run();
    } catch {
      ok = false;
    }
    if (!ok) return false;
  }
  return true;
}
