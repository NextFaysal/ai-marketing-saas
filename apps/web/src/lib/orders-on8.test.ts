import { describe, expect, it } from "vitest";
import {
  buildRulePayload, draftFromRule, emptyActionDraft, emptyRuleDraft,
  logActionSummary, type AutomationRule, type RuleDraft,
} from "./orders-on8";

function draft(patch: Partial<RuleDraft> = {}): RuleDraft {
  return { ...emptyRuleDraft(), name: "টেস্ট নিয়ম", actions: [{ ...emptyActionDraft("add_tag"), tag: "নতুন" }], ...patch };
}

describe("buildRulePayload", () => {
  it("minimal order_created rule: null triggerConfig + null conditions, money omitted", () => {
    const { payload, error } = buildRulePayload(draft());
    expect(error).toBeNull();
    expect(payload).toEqual({
      name: "টেস্ট নিয়ম", trigger: "order_created", triggerConfig: null,
      conditions: null, actions: [{ type: "add_tag", tag: "নতুন" }],
    });
  });

  it("converts taka to a minor string and includes only set conditions", () => {
    const { payload } = buildRulePayload(draft({ minTotalTaka: "3000", isCod: "true", sources: "woocommerce, manual", district: " Dhaka " }));
    expect(payload?.conditions).toEqual({
      minTotalMinor: "300000", isCod: true, sources: ["woocommerce", "manual"], district: "Dhaka",
    });
  });

  it("shapes each trigger's config and refuses a missing toStatus", () => {
    expect(buildRulePayload(draft({ trigger: "status_changed", toStatus: "delivered" })).payload?.triggerConfig).toEqual({ toStatus: "delivered" });
    expect(buildRulePayload(draft({ trigger: "status_changed", toStatus: "" })).error).toMatch(/স্ট্যাটাস/);
    expect(buildRulePayload(draft({ trigger: "parcel_stuck_hours", hours: "72" })).payload?.triggerConfig).toEqual({ hours: 72 });
    expect(buildRulePayload(draft({ trigger: "parcel_stuck_hours", hours: "0" })).error).toMatch(/ঘণ্টা/);
    expect(buildRulePayload(draft({ trigger: "due_overdue_days", days: "3" })).payload?.triggerConfig).toEqual({ days: 3 });
  });

  it("shapes every action type from its own field only", () => {
    const { payload, error } = buildRulePayload(draft({
      actions: [
        { ...emptyActionDraft("assign"), userId: "u1", tag: "ignored" },
        { ...emptyActionDraft("hold"), reason: "যাচাই" },
        { ...emptyActionDraft("notify_customer"), message: "হ্যালো {{customerName}}" },
      ],
    }));
    expect(error).toBeNull();
    expect(payload?.actions).toEqual([
      { type: "assign", userId: "u1" },
      { type: "hold", reason: "যাচাই" },
      { type: "notify_customer", message: "হ্যালো {{customerName}}" },
    ]);
  });

  it("refuses empty name, bad money, empty actions and unfilled action fields", () => {
    expect(buildRulePayload(draft({ name: " " })).error).toMatch(/নাম/);
    expect(buildRulePayload(draft({ minTotalTaka: "abc" })).error).toMatch(/টাকার/);
    expect(buildRulePayload(draft({ actions: [] })).error).toMatch(/কাজ/);
    expect(buildRulePayload(draft({ actions: [emptyActionDraft("notify_staff")] })).error).toMatch(/বার্তা/);
  });
});

describe("draftFromRule", () => {
  it("round-trips a stored rule back through buildRulePayload", () => {
    const rule: AutomationRule = {
      id: "r1", organizationId: "org-1", name: "বড় COD", enabled: false,
      trigger: "order_created", triggerConfig: null,
      conditions: { isCod: true, minTotalMinor: "300000" },
      actions: [{ type: "hold", reason: "যাচাই করুন" }, { type: "notify_staff", message: "খেয়াল করুন" }],
      presetKey: "big_cod_verify", runCount: 3,
    };
    const { payload, error } = buildRulePayload(draftFromRule(rule));
    expect(error).toBeNull();
    expect(payload).toEqual({
      name: "বড় COD", trigger: "order_created", triggerConfig: null,
      conditions: { isCod: true, minTotalMinor: "300000" },
      actions: rule.actions,
    });
  });
});

describe("logActionSummary", () => {
  it("renders per-action outcomes with labels; empty result is a dash", () => {
    expect(logActionSummary({ id: "l1", ruleId: "r1", orderId: "o1", triggerKey: "created", createdAt: "", actionsResult: [{ type: "add_tag", ok: true }, { type: "hold", ok: false }] }))
      .toBe("ট্যাগ যোগ করুন ✓ · পর্যালোচনার জন্য আটকান ✗");
    expect(logActionSummary({ id: "l2", ruleId: "r1", orderId: "o1", triggerKey: "created", createdAt: "", actionsResult: [] })).toBe("—");
  });
});
