process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "<MASKED_SECRET_001>";

import { ConnectionHealingService, HEAL_ATTEMPT_ACTION, HEAL_MAX_ATTEMPTS_PER_DAY } from "./connection-healing.service";

/**
 * CC21 — sweep auto-healing (commerce webhooks only).
 * Pinned:
 * - healing is attempted ONLY when the stored webhook record
 *   really reports a failed/error/missing topic;
 * - a successful repair (record healthy afterwards) counts as
 *   healed; a still-broken record or a thrown registrar is
 *   recorded, never thrown into the sweep;
 * - caps: >= 3 recorded attempts TODAY (real audit rows) skip
 *   the target; an attempt from yesterday does not count;
 * - autoHealEnabled=false skips entirely — the registrar is
 *   never called;
 * - non-commerce providers are never touched;
 * - every attempt writes an attempt audit row and a result
 *   audit row (the CC13 timeline source).
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("gte" in v) return new Date(row[k]).getTime() >= new Date(v.gte).getTime();
      if ("lte" in v) return new Date(row[k]).getTime() <= new Date(v.lte).getTime();
      return true;
    }
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  const applyOrderTake = (list: any[], args: any) => {
    let out = [...list];
    if (typeof args?.take === "number") out = out.slice(0, args.take);
    return out;
  };
  return {
    rows,
    findFirst: async (args: any = {}) => applyOrderTake(rows.filter((r) => matches(r, args.where ?? {})), args)[0] ?? null,
    findMany: async (args: any = {}) => applyOrderTake(rows.filter((r) => matches(r, args.where ?? {})), args),
    findUnique: async (args: any) => rows.filter((r) => matches(r, args.where ?? {}))[0] ?? null,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (row) Object.assign(row, data);
      return row;
    },
  };
}

const BAD_HOOKS = { provider: "shopify", topics: { "orders/create": { status: "failed", error: "gone" } }, updatedAt: new Date().toISOString() };
const GOOD_HOOKS = { provider: "shopify", topics: { "orders/create": { status: "registered" } }, updatedAt: new Date().toISOString() };

function build(repairImpl?: (orgId: string, actor: string, id: string) => Promise<any>) {
  const tables: any = { integration: makeTable("int"), auditLog: makeTable("audit") };
  const auditRows: any[] = [];
  const audit = { log: async (entry: any) => { auditRows.push(entry); await tables.auditLog.create({ data: { ...entry, organizationId: entry.organizationId ?? "org-1" } }); } } as any;
  const repairCalls: string[] = [];
  const providerHealth: any = {
    repairWebhooks: async (orgId: string, actor: string, id: string) => {
      repairCalls.push(id);
      if (repairImpl) return repairImpl(orgId, actor, id);
      // Default: the registrar fixes the record (the real one
      // writes the fresh record back onto the Integration row).
      const row = tables.integration.rows.find((r: any) => r.id === id);
      if (row) row.webhookStatus = GOOD_HOOKS;
      return { webhookStatus: GOOD_HOOKS };
    },
  };
  const healing = new ConnectionHealingService(tables as any, audit, providerHealth);
  return { tables, healing, repairCalls, auditRows };
}

async function seedStore(tables: any, overrides: any = {}) {
  return tables.integration.create({
    data: {
      organizationId: "org-1", provider: "shopify", status: "CONNECTED",
      webhookStatus: BAD_HOOKS, autoHealEnabled: true, ...overrides,
    },
  });
}

describe("CC21 auto-healing (commerce webhooks)", () => {
  it("heals a store whose stored webhook record reports failure, and records attempt + result", async () => {
    const { tables, healing, repairCalls, auditRows } = build();
    const store = await seedStore(tables);
    const out = await healing.autoHealCommerceWebhooks("org-1");
    expect(repairCalls).toEqual([store.id]);
    expect(out.attempted).toBe(1);
    expect(out.healed).toBe(1);
    expect(out.results[0].outcome).toBe("healed");
    expect(auditRows.some((r) => r.action === HEAL_ATTEMPT_ACTION && r.entityId === store.id)).toBe(true);
    expect(auditRows.some((r) => r.action === "connection.auto_heal.webhook_result" && r.metadata?.outcome === "healed")).toBe(true);
  });

  it("records still_bad when the registrar runs but the record stays broken", async () => {
    const { tables, healing } = build(async () => ({ webhookStatus: BAD_HOOKS }));
    await seedStore(tables);
    const out = await healing.autoHealCommerceWebhooks("org-1");
    expect(out.attempted).toBe(1);
    expect(out.healed).toBe(0);
    expect(out.results[0].outcome).toBe("still_bad");
  });

  it("records error (and never throws) when the registrar throws", async () => {
    const { tables, healing } = build(async () => { throw new Error("registrar down"); });
    await seedStore(tables);
    const out = await healing.autoHealCommerceWebhooks("org-1");
    expect(out.results[0].outcome).toBe("error");
    expect(out.results[0].detail).toContain("registrar down");
  });

  it("skips an opted-out connection entirely — registrar never called", async () => {
    const { tables, healing, repairCalls } = build();
    await seedStore(tables, { autoHealEnabled: false });
    const out = await healing.autoHealCommerceWebhooks("org-1");
    expect(repairCalls).toEqual([]);
    expect(out.attempted).toBe(0);
    expect(out.results[0].outcome).toBe("skipped_opt_out");
  });

  it("enforces the daily cap from recorded attempt rows; yesterday's attempts do not count", async () => {
    const { tables, healing, repairCalls, auditRows } = build();
    const store = await seedStore(tables);
    // 3 attempts already recorded TODAY + 2 from yesterday.
    for (let i = 0; i < 3; i++) {
      await tables.auditLog.create({ data: { organizationId: "org-1", action: HEAL_ATTEMPT_ACTION, entityType: "Integration", entityId: store.id } });
    }
    const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000);
    for (let i = 0; i < 2; i++) {
      const row = await tables.auditLog.create({ data: { organizationId: "org-1", action: HEAL_ATTEMPT_ACTION, entityType: "Integration", entityId: store.id } });
      row.createdAt = yesterday;
    }
    const out = await healing.autoHealCommerceWebhooks("org-1");
    expect(repairCalls).toEqual([]);
    expect(out.results[0].outcome).toBe("skipped_daily_cap");
    // The cap constant is the documented 3/day.
    expect(HEAL_MAX_ATTEMPTS_PER_DAY).toBe(3);
    expect(auditRows.filter((r) => r.action === HEAL_ATTEMPT_ACTION)).toHaveLength(0);
  });

  it("does not attempt anything for a healthy webhook record or a non-commerce provider", async () => {
    const { tables, healing, repairCalls } = build();
    await seedStore(tables, { webhookStatus: GOOD_HOOKS });
    await seedStore(tables, { provider: "whatsapp", webhookStatus: BAD_HOOKS });
    const out = await healing.autoHealCommerceWebhooks("org-1");
    expect(repairCalls).toEqual([]);
    expect(out.attempted).toBe(0);
    expect(out.results).toEqual([]);
  });

  it("a second sweep the same day counts the first attempt toward the cap", async () => {
    const { tables, healing, repairCalls } = build(async () => ({ webhookStatus: BAD_HOOKS }));
    await seedStore(tables);
    await healing.autoHealCommerceWebhooks("org-1");
    await healing.autoHealCommerceWebhooks("org-1");
    await healing.autoHealCommerceWebhooks("org-1");
    const fourth = await healing.autoHealCommerceWebhooks("org-1");
    expect(repairCalls).toHaveLength(3);
    expect(fourth.results[0].outcome).toBe("skipped_daily_cap");
  });
});
