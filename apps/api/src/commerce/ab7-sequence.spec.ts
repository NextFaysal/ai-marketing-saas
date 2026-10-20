import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { AbandonedCheckoutsService } from "./abandoned-checkouts.service";
import { AbandonedSequenceController } from "./commerce.controller";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

/**
 * AB7 / AX18 — EC10 sequence state (getCheckoutSequence) + the
 * public issueRecoveryCoupon semantics AX18 relies on.
 *
 * Fake-prisma style of ec10-abandoned.spec.ts. Rows are pushed
 * directly so their shape is EXACTLY the real one — in
 * particular WorkflowRun rows carry NO updatedAt (the schema
 * has none), which is why lastActivityAt must fall back to
 * createdAt.
 */
function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const cond: any = v;
      if ("in" in cond) {
        if (!cond.in.includes(row[k])) return false;
        continue;
      }
      return false;
    }
    if (row[k] !== v) return false;
  }
  return true;
}
function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matchWhere(r, where)) ?? null,
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let found = rows.filter((r) => matchWhere(r, where));
      if (orderBy?.createdAt) {
        found = [...found].sort((a, b) =>
          orderBy.createdAt === "desc"
            ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      }
      return take !== undefined ? found.slice(0, take) : found;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
  };
}
function makePrisma() {
  return {
    abandonedStoreCheckout: makeTable(),
    storeCart: makeTable(),
    workflow: makeTable(),
    workflowRun: makeTable(),
    abandonedCouponSetting: makeTable(),
    storeDiscount: makeTable(),
  } as any;
}

const CHECKOUT_ROW = {
  id: "chk-1", organizationId: "org-1", storeId: "st-1", externalCheckoutId: "ext-99",
  email: "a@example.com", phone: null, items: [], totalMinor: 50000n, currency: "BDT",
  checkoutUrl: null, status: "open", abandonedAt: new Date("2026-10-15T10:00:00.000Z"),
  recoveredOrderId: null, createdAt: new Date("2026-10-15T10:00:00.000Z"), updatedAt: new Date("2026-10-15T10:00:00.000Z"),
};

function seedEnrolled(prisma: any) {
  prisma.abandonedStoreCheckout.rows.push({ ...CHECKOUT_ROW });
  prisma.workflow.rows.push({
    id: "wf-1", organizationId: "org-1", name: "কার্ট রিকভারি ৩ ধাপ (SMS)",
    trigger: "cart_abandoned", enabled: true, steps: [], createdById: "owner",
    createdAt: new Date(), updatedAt: new Date(),
  });
  // An older run for a DIFFERENT checkout — must not match.
  prisma.workflowRun.rows.push({
    id: "run-other", organizationId: "org-1", workflowId: "wf-1", trigger: "cart_abandoned",
    context: { checkoutId: "chk-other" }, status: "completed",
    stepsLog: [{ step: "send_sms", status: "ok", detail: "sent" }],
    nextStepIndex: 0, createdAt: new Date("2026-10-15T11:00:00.000Z"),
  });
  // The newest matching run (EC10's recovery send emits
  // cart.abandoned with context.checkoutId — the shape a real
  // workflow run for this checkout carries).
  prisma.workflowRun.rows.push({
    id: "run-1", organizationId: "org-1", workflowId: "wf-1", trigger: "cart_abandoned",
    context: { source: "shopify", checkoutId: "chk-1", storeId: "st-1", email: "a@example.com" },
    status: "waiting",
    stepsLog: [
      { step: "wait", status: "ok", detail: "Paused for 60 minutes (resume at 2026-10-15T12:00:00.000Z)" },
      { step: "send_sms", status: "ok", detail: "sms sent to 8801700000000 (provider id sms-1)", branch: "then" },
      { step: "wait", status: "ok" },
    ],
    resumeAt: new Date("2026-10-16T11:00:00.000Z"), nextStepIndex: 3,
    createdAt: new Date("2026-10-15T11:30:00.000Z"),
    // NOTE: no updatedAt — the WorkflowRun model has none.
  });
}

describe("AX18 getCheckoutSequence", () => {
  it("enrolled store checkout → workflow name, run status, current step, stepsLog (existing fields only), lastActivityAt from createdAt", async () => {
    const prisma = makePrisma();
    seedEnrolled(prisma);
    const svc = new AbandonedCheckoutsService(prisma);
    const res: any = await svc.getCheckoutSequence("org-1", "chk-1");
    expect(res.enrolled).toBe(true);
    expect(res.workflowName).toBe("কার্ট রিকভারি ৩ ধাপ (SMS)");
    expect(res.runStatus).toBe("waiting");
    expect(res.currentStepIndex).toBe(3);
    expect(res.steps).toEqual([
      { step: "wait", status: "ok", detail: "Paused for 60 minutes (resume at 2026-10-15T12:00:00.000Z)" },
      { step: "send_sms", status: "ok", detail: "sms sent to 8801700000000 (provider id sms-1)", branch: "then" },
      { step: "wait", status: "ok" },
    ]);
    expect(res.lastActivityAt).toBe("2026-10-15T11:30:00.000Z");
  });

  it("matches a run by the EC10 event's externalCheckoutId context key too", async () => {
    const prisma = makePrisma();
    prisma.abandonedStoreCheckout.rows.push({ ...CHECKOUT_ROW });
    prisma.workflowRun.rows.push({
      id: "run-ext", organizationId: "org-1", workflowId: "wf-x", trigger: "cart_abandoned",
      context: { source: "shopify", externalCheckoutId: "ext-99" }, status: "completed",
      stepsLog: [], nextStepIndex: 0, createdAt: new Date("2026-10-15T12:00:00.000Z"),
    });
    const svc = new AbandonedCheckoutsService(prisma);
    const res: any = await svc.getCheckoutSequence("org-1", "chk-1");
    expect(res.enrolled).toBe(true);
    expect(res.runStatus).toBe("completed");
    expect(res.steps).toEqual([]);
  });

  it("enrolled native cart → matched via context.cartId", async () => {
    const prisma = makePrisma();
    prisma.storeCart.rows.push({
      id: "cart-1", organizationId: "org-1", status: "open", email: "n@example.com",
      phone: null, items: [], createdAt: new Date(), updatedAt: new Date(),
    });
    prisma.workflow.rows.push({
      id: "wf-1", organizationId: "org-1", name: "Native recovery", trigger: "cart_abandoned",
      enabled: true, steps: [], createdById: "owner", createdAt: new Date(), updatedAt: new Date(),
    });
    prisma.workflowRun.rows.push({
      id: "run-n", organizationId: "org-1", workflowId: "wf-1", trigger: "cart_abandoned",
      context: { source: "native", cartId: "cart-1" }, status: "completed",
      stepsLog: [{ step: "issue_recovery_coupon", status: "skipped", detail: "coupon setting disabled" }],
      nextStepIndex: 0, createdAt: new Date("2026-10-15T09:00:00.000Z"),
    });
    const svc = new AbandonedCheckoutsService(prisma);
    const res: any = await svc.getCheckoutSequence("org-1", "cart-1");
    expect(res).toMatchObject({
      enrolled: true, workflowName: "Native recovery", runStatus: "completed",
      lastActivityAt: "2026-10-15T09:00:00.000Z",
    });
    expect(res.steps[0].step).toBe("issue_recovery_coupon");
  });

  it("checkout with no matching run → exactly { enrolled: false }", async () => {
    const prisma = makePrisma();
    prisma.abandonedStoreCheckout.rows.push({ ...CHECKOUT_ROW });
    prisma.workflowRun.rows.push({
      id: "run-other", organizationId: "org-1", workflowId: "wf-1", trigger: "cart_abandoned",
      context: { checkoutId: "chk-other" }, status: "completed", stepsLog: [],
      nextStepIndex: 0, createdAt: new Date(),
    });
    const svc = new AbandonedCheckoutsService(prisma);
    await expect(svc.getCheckoutSequence("org-1", "chk-1")).resolves.toEqual({ enrolled: false });
  });

  it("foreign or unknown checkout → 404", async () => {
    const prisma = makePrisma();
    prisma.abandonedStoreCheckout.rows.push({ ...CHECKOUT_ROW });
    const svc = new AbandonedCheckoutsService(prisma);
    await expect(svc.getCheckoutSequence("org-2", "chk-1")).rejects.toMatchObject({ code: "commerce.abandonedCheckoutNotFoundInOrg", status: 404 });
    await expect(svc.getCheckoutSequence("org-1", "nope")).rejects.toMatchObject({ code: "commerce.abandonedCheckoutNotFoundInOrg", status: 404 });
  });
});

describe("AX18 issueRecoveryCoupon (public EC10 issuance)", () => {
  it("is public, issues a REAL StoreDiscount when enabled, and does NOT dedupe by sourceRef (callers own exactly-once)", async () => {
    const prisma = makePrisma();
    prisma.abandonedCouponSetting.rows.push({
      id: "set-1", organizationId: "org-1", enabled: true, kind: "percent",
      value: 15, expiryHours: 48, minOrderMinor: null,
    });
    const svc = new AbandonedCheckoutsService(prisma);
    expect(typeof svc.issueRecoveryCoupon).toBe("function");
    const first = await svc.issueRecoveryCoupon("org-1", "chk-1");
    const second = await svc.issueRecoveryCoupon("org-1", "chk-1");
    expect(first?.code).toMatch(/^RCV-[A-Z0-9]{8}$/);
    expect(first).toMatchObject({ kind: "percent", value: 15, expiryHours: 48 });
    // The documented EC10 semantics: same ref, two coupons —
    // EC10's own call sites are protected by their audit
    // markers, and the workflow action by its wf: pre-check.
    expect(second?.code).toMatch(/^RCV-[A-Z0-9]{8}$/);
    expect(prisma.storeDiscount.rows).toHaveLength(2);
    expect(prisma.storeDiscount.rows.every((r: any) => r.origin === "abandoned_recovery" && r.sourceRef === "chk-1")).toBe(true);
  });

  it("setting disabled → null (the workflow action turns this into a skipped step)", async () => {
    const prisma = makePrisma();
    prisma.abandonedCouponSetting.rows.push({
      id: "set-1", organizationId: "org-1", enabled: false, kind: "percent",
      value: 15, expiryHours: 48, minOrderMinor: null,
    });
    const svc = new AbandonedCheckoutsService(prisma);
    await expect(svc.issueRecoveryCoupon("org-1", "chk-1")).resolves.toBeNull();
    expect(prisma.storeDiscount.rows).toHaveLength(0);
  });
});

describe("AX18 sequence route wiring", () => {
  it("the canonical path organizations/:organizationId/abandoned-checkouts/:checkoutId/sequence is served, guarded like the commerce siblings", () => {
    // The AX18 spec path (and the dashboard's apiFetch call)
    // carries NO commerce segment, so it cannot live on
    // CommerceController (prefix .../commerce). The dedicated
    // controller must compose to exactly that path, with the
    // same TenantGuard + RolesGuard pair as CommerceController.
    expect(Reflect.getMetadata(PATH_METADATA, AbandonedSequenceController)).toBe("organizations/:organizationId");
    const handler = AbandonedSequenceController.prototype.getAbandonedSequence;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe("abandoned-checkouts/:checkoutId/sequence");
    const guards = Reflect.getMetadata(GUARDS_METADATA, AbandonedSequenceController) ?? [];
    expect(guards).toEqual(expect.arrayContaining([TenantGuard, RolesGuard]));
    // And the handler delegates to the service (foreign → 404
    // behaviour is pinned by the service specs above).
    const svc: any = { getCheckoutSequence: async (org: string, id: string) => ({ enrolled: false, org, id }) };
    const ctrl = new AbandonedSequenceController(svc);
    return expect(ctrl.getAbandonedSequence("org-1", "chk-1")).resolves.toEqual({ enrolled: false, org: "org-1", id: "chk-1" });
  });
});
