import "reflect-metadata";
import { FraudNetworkService, hashFraudPhone } from "./fraud-network.service";
import { FraudShieldService } from "../orders/fraud-shield.service";

/**
 * NF13 (FB5) — Platform Fraud Network specs. Fake-prisma
 * harness in the nf12 pattern (in-memory tables, org-scoped
 * `matches`, unique enforcement on the keys the design rides:
 * setting per org, contribution per (org, order), stat per
 * phoneHash). The HMAC key rides process.env exactly like
 * production; the key-absent test deletes it.
 */

type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub));
    if (k === "AND") return (v as any[]).every((sub) => matches(row, sub));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.map(String).includes(String(row[k]));
      if ("notIn" in v) return !(v as any).notIn.map(String).includes(String(row[k]));
      return true;
    }
    return String(row[k]) === String(v);
  });
}

let seq = 0;
function makeTable(rows: Row[], uniqueKeys: string[][] = []) {
  const api: any = {
    rows,
    async findFirst({ where }: any = {}) {
      return rows.find((r) => matches(r, where)) ?? null;
    },
    async findMany({ where, orderBy }: any = {}) {
      let out = rows.filter((r) => matches(r, where));
      const spec = Array.isArray(orderBy) ? orderBy[0] : orderBy;
      if (spec) {
        const [key, dir] = Object.entries(spec)[0] as [string, string];
        out = [...out].sort((a, b) => {
          const c = String(a[key] ?? "") < String(b[key] ?? "") ? -1 : String(a[key] ?? "") > String(b[key] ?? "") ? 1 : 0;
          return dir === "desc" ? -c : c;
        });
      }
      return out;
    },
    async create({ data }: any) {
      for (const keys of uniqueKeys) {
        if (keys.some((k) => data[k] === null || data[k] === undefined)) continue;
        if (rows.some((r) => keys.every((k) => String(r[k]) === String(data[k])))) {
          throw new Error("Unique constraint failed P2002");
        }
      }
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    async update({ where, data }: any) {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error("Record not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    async count({ where }: any = {}) {
      return rows.filter((r) => matches(r, where)).length;
    },
  };
  api.findUnique = api.findFirst;
  return api;
}

const PHONE = "01712345678";
const PHONE_FORMS = [PHONE, "+8801712345678", "8801712345678", "1712345678"];

function makeWorld() {
  const db: Record<string, Row[]> = {
    fraudNetworkSetting: [],
    fraudNetworkPhoneStat: [],
    fraudNetworkContribution: [],
    fraudShieldSetting: [],
    order: [],
    customer: [],
    courierShipment: [],
    channelConversation: [],
    returnRequest: [],
  };
  const prisma: any = {
    fraudNetworkSetting: makeTable(db.fraudNetworkSetting, [["organizationId"]]),
    fraudNetworkPhoneStat: makeTable(db.fraudNetworkPhoneStat, [["phoneHash"]]),
    fraudNetworkContribution: makeTable(db.fraudNetworkContribution, [["organizationId", "orderId"]]),
    fraudShieldSetting: makeTable(db.fraudShieldSetting, [["organizationId"]]),
    order: makeTable(db.order),
    customer: makeTable(db.customer),
    courierShipment: makeTable(db.courierShipment),
    channelConversation: makeTable(db.channelConversation),
    returnRequest: makeTable(db.returnRequest),
  };
  const audit: any = { log: async () => undefined };
  const svc = new FraudNetworkService(prisma, audit);
  return { db, prisma, svc, audit };
}

let custSeq = 0;
/** Seed an order whose phone lives on its customer row. */
function seedOrder(
  w: ReturnType<typeof makeWorld>,
  opts: {
    orgId: string; id: string; phone?: string; status?: string; isCod?: boolean;
    createdAt?: Date; shipmentStatuses?: string[]; shipmentPhone?: string;
  },
) {
  const phone = opts.phone ?? PHONE;
  const custId = `cust-${++custSeq}`;
  w.db.customer.push({
    id: custId, organizationId: opts.orgId, firstName: "Test", lastName: "Buyer", phone,
  });
  const order: Row = {
    id: opts.id, organizationId: opts.orgId, customerId: custId,
    customer: { id: custId, phone, firstName: "Test", lastName: "Buyer" },
    status: opts.status ?? "completed", isCod: opts.isCod ?? true,
    totalMinor: 100000n, createdAt: opts.createdAt ?? new Date(), updatedAt: new Date(),
    conversationId: null,
  };
  w.db.order.push(order);
  for (const [i, st] of (opts.shipmentStatuses ?? []).entries()) {
    w.db.courierShipment.push({
      id: `${opts.id}-ship-${i}`, organizationId: opts.orgId, orderId: opts.id,
      status: st, recipientPhone: opts.shipmentPhone ?? null,
    });
  }
  return order;
}

async function enable(w: ReturnType<typeof makeWorld>, orgId: string) {
  return w.svc.updateSettings(orgId, `owner-${orgId}`, { enabled: true });
}

beforeEach(() => {
  process.env.FRAUD_NETWORK_HMAC_KEY = "nf13-test-hmac-key";
});
afterEach(() => {
  delete process.env.FRAUD_NETWORK_HMAC_KEY;
});

describe("NF13 fraud network", () => {
  it("1. opt-in gating BOTH directions: non-opted-in org contributes nothing (direct + sweep) and lookup is not_opted_in", async () => {
    const w = makeWorld();
    seedOrder(w, { orgId: "org-a", id: "o-1", status: "completed" });
    const direct: any = await w.svc.contributeForOrder("org-a", "o-1");
    expect(direct).toEqual({ contributed: false, reason: "not_opted_in" });
    const sweep: any = await w.svc.runSweep("org-a");
    expect(sweep.skippedReason).toBe("not_opted_in");
    expect(sweep.contributed).toBe(0);
    expect(w.db.fraudNetworkContribution).toHaveLength(0);
    expect(w.db.fraudNetworkPhoneStat).toHaveLength(0);
    await expect(w.svc.lookup("org-a", PHONE)).resolves.toEqual({ status: "not_opted_in" });
    const settings: any = await w.svc.getSettings("org-a");
    expect(settings).toMatchObject({ available: true, enabled: false, enabledAt: null });
  });

  it("2. hash-only storage: no raw phone in ANY format in any table or payload", async () => {
    const w = makeWorld();
    for (const orgId of ["org-a", "org-b", "org-c"]) {
      await enable(w, orgId);
      seedOrder(w, { orgId, id: `o-${orgId}`, status: "completed" });
      await w.svc.contributeForOrder(orgId, `o-${orgId}`);
    }
    const settings: any = await w.svc.getSettings("org-a");
    const lookup: any = await w.svc.lookup("org-a", PHONE);
    expect(lookup.status).toBe("ok");
    const everything = JSON.stringify({
      settingsTable: w.db.fraudNetworkSetting,
      statTable: w.db.fraudNetworkPhoneStat,
      contributionTable: w.db.fraudNetworkContribution,
      settings, lookup,
    });
    for (const form of PHONE_FORMS) {
      expect(everything).not.toContain(form);
    }
    const expectedHash = hashFraudPhone(PHONE);
    expect(expectedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(w.db.fraudNetworkContribution[0].phoneHash).toBe(expectedHash);
    expect(w.db.fraudNetworkPhoneStat[0].phoneHash).toBe(expectedHash);
    // The shared aggregate carries NO org id by design.
    expect(w.db.fraudNetworkPhoneStat[0]).not.toHaveProperty("organizationId");
  });

  it("3. exactly-once: contribute twice + sweep twice moves counters once", async () => {
    const w = makeWorld();
    await enable(w, "org-a");
    seedOrder(w, { orgId: "org-a", id: "o-1", status: "completed" });
    const first: any = await w.svc.contributeForOrder("org-a", "o-1");
    expect(first.contributed).toBe(true);
    const second: any = await w.svc.contributeForOrder("org-a", "o-1");
    expect(second).toEqual({ contributed: false, reason: "already_contributed" });
    await w.svc.runSweep("org-a");
    await w.svc.runSweep("org-a");
    expect(w.db.fraudNetworkContribution).toHaveLength(1);
    expect(w.db.fraudNetworkPhoneStat).toHaveLength(1);
    expect(w.db.fraudNetworkPhoneStat[0].deliveredCount).toBe(1);
    expect(w.db.fraudNetworkPhoneStat[0].contributingOrgCount).toBe(1);
  });

  it("4. no pre-consent backfill: order created before enabledAt never contributes; one created after does", async () => {
    const w = makeWorld();
    seedOrder(w, { orgId: "org-a", id: "o-old", status: "completed", createdAt: new Date(Date.now() - 3600_000) });
    await enable(w, "org-a");
    const oldRes: any = await w.svc.contributeForOrder("org-a", "o-old");
    expect(oldRes).toEqual({ contributed: false, reason: "pre_consent" });
    seedOrder(w, { orgId: "org-a", id: "o-new", status: "completed", createdAt: new Date() });
    const newRes: any = await w.svc.contributeForOrder("org-a", "o-new");
    expect(newRes.contributed).toBe(true);
    // The sweep honours the same rule.
    const sweep: any = await w.svc.runSweep("org-a");
    expect(sweep.contributed).toBe(0);
    expect(w.db.fraudNetworkContribution.map((r) => r.orderId)).toEqual(["o-new"]);
  });

  it("5. <3-org suppression: 1 and 2 orgs → insufficient_data with NO counts; 3rd org → ok with counts", async () => {
    const w = makeWorld();
    await enable(w, "org-a");
    seedOrder(w, { orgId: "org-a", id: "o-a", status: "completed" });
    await w.svc.contributeForOrder("org-a", "o-a");
    const one: any = await w.svc.lookup("org-a", PHONE);
    expect(one).toEqual({ status: "insufficient_data", contributingOrgCount: 1 });
    expect(JSON.stringify(one)).not.toContain("delivered");

    await enable(w, "org-b");
    seedOrder(w, { orgId: "org-b", id: "o-b", status: "cancelled", isCod: false });
    await w.svc.contributeForOrder("org-b", "o-b");
    const two: any = await w.svc.lookup("org-a", PHONE);
    expect(two).toEqual({ status: "insufficient_data", contributingOrgCount: 2 });
    expect(JSON.stringify(two)).not.toContain("returnedFailed");

    await enable(w, "org-c");
    seedOrder(w, { orgId: "org-c", id: "o-c", status: "completed" });
    await w.svc.contributeForOrder("org-c", "o-c");
    const three: any = await w.svc.lookup("org-a", PHONE);
    expect(three).toEqual({
      status: "ok", delivered: 2, returnedFailed: 1, codRefusals: 0,
      contributingOrgCount: 3, total: 3,
    });
  });

  it("6. disable stops contributions immediately; re-enable stamps a new enabledAt so the disabled-window order never contributes", async () => {
    const w = makeWorld();
    await enable(w, "org-a");
    await w.svc.updateSettings("org-a", "owner-org-a", { enabled: false });
    seedOrder(w, { orgId: "org-a", id: "o-window", status: "completed", createdAt: new Date() });
    const whileDisabled: any = await w.svc.contributeForOrder("org-a", "o-window");
    expect(whileDisabled).toEqual({ contributed: false, reason: "not_opted_in" });
    // A small delay so the new enabledAt is strictly after the
    // window order's createdAt.
    await new Promise((r) => setTimeout(r, 5));
    await enable(w, "org-a");
    const afterReEnable: any = await w.svc.contributeForOrder("org-a", "o-window");
    expect(afterReEnable).toEqual({ contributed: false, reason: "pre_consent" });
    seedOrder(w, { orgId: "org-a", id: "o-after", status: "completed", createdAt: new Date() });
    const fresh: any = await w.svc.contributeForOrder("org-a", "o-after");
    expect(fresh.contributed).toBe(true);
    expect(w.db.fraudNetworkContribution.map((r) => r.orderId)).toEqual(["o-after"]);
  });

  it("7. key absent: settings unavailable, enable refuses in Bengali, contribute/lookup unavailable", async () => {
    delete process.env.FRAUD_NETWORK_HMAC_KEY;
    const w = makeWorld();
    seedOrder(w, { orgId: "org-a", id: "o-1", status: "completed" });
    const settings: any = await w.svc.getSettings("org-a");
    expect(settings.available).toBe(false);
    await expect(w.svc.updateSettings("org-a", "owner-org-a", { enabled: true }))
      .rejects.toThrow(/এখনো চালু হয়নি/);
    const contrib: any = await w.svc.contributeForOrder("org-a", "o-1");
    expect(contrib).toEqual({ contributed: false, reason: "unavailable" });
    await expect(w.svc.lookup("org-a", PHONE)).resolves.toEqual({ status: "unavailable" });
    const sweep: any = await w.svc.runSweep("org-a");
    expect(sweep.skippedReason).toBe("unavailable");
    expect(w.db.fraudNetworkContribution).toHaveLength(0);
    expect(w.db.fraudNetworkPhoneStat).toHaveLength(0);
    // Disabling stays possible without a key (it can only stop things).
    await expect(w.svc.updateSettings("org-a", "owner-org-a", { enabled: false })).resolves.toBeTruthy();
  });

  it("8. contributingOrgCount counts DISTINCT orgs: same org, 2 orders, same phone → 1", async () => {
    const w = makeWorld();
    await enable(w, "org-a");
    seedOrder(w, { orgId: "org-a", id: "o-1", status: "completed" });
    seedOrder(w, { orgId: "org-a", id: "o-2", status: "completed" });
    await w.svc.contributeForOrder("org-a", "o-1");
    await w.svc.contributeForOrder("org-a", "o-2");
    expect(w.db.fraudNetworkPhoneStat[0].contributingOrgCount).toBe(1);
    expect(w.db.fraudNetworkPhoneStat[0].deliveredCount).toBe(2);
    expect(w.db.fraudNetworkContribution).toHaveLength(2);
  });

  it("9. settings isolation: org A's opt-in never affects org B", async () => {
    const w = makeWorld();
    await enable(w, "org-a");
    seedOrder(w, { orgId: "org-a", id: "o-a", status: "completed" });
    seedOrder(w, { orgId: "org-b", id: "o-b", status: "completed" });
    const aRes: any = await w.svc.contributeForOrder("org-a", "o-a");
    expect(aRes.contributed).toBe(true);
    const bRes: any = await w.svc.contributeForOrder("org-b", "o-b");
    expect(bRes).toEqual({ contributed: false, reason: "not_opted_in" });
    await expect(w.svc.lookup("org-b", PHONE)).resolves.toEqual({ status: "not_opted_in" });
    const bSettings: any = await w.svc.getSettings("org-b");
    expect(bSettings.enabled).toBe(false);
    expect(w.db.fraudNetworkContribution.map((r) => r.organizationId)).toEqual(["org-a"]);
  });

  it("10. COD refusal mapping: COD cancelledOrFailed bumps returnedFailed AND codRefusals; non-COD cancelled bumps returnedFailed only", async () => {
    const w = makeWorld();
    await enable(w, "org-a");
    seedOrder(w, { orgId: "org-a", id: "o-cod", phone: "01712345678", status: "cancelled", isCod: true });
    seedOrder(w, { orgId: "org-a", id: "o-noncod", phone: "01812345678", status: "cancelled", isCod: false });
    await w.svc.contributeForOrder("org-a", "o-cod");
    await w.svc.contributeForOrder("org-a", "o-noncod");
    const codHash = hashFraudPhone("01712345678");
    const nonCodHash = hashFraudPhone("01812345678");
    const codStat = w.db.fraudNetworkPhoneStat.find((r) => r.phoneHash === codHash)!;
    const nonCodStat = w.db.fraudNetworkPhoneStat.find((r) => r.phoneHash === nonCodHash)!;
    expect(codStat.returnedFailedCount).toBe(1);
    expect(codStat.codRefusalCount).toBe(1);
    expect(nonCodStat.returnedFailedCount).toBe(1);
    expect(nonCodStat.codRefusalCount).toBe(0);
  });

  it("outcome mapping: returned + refunded count as returnedFailed; shipment-returned wins; open contributes nothing", async () => {
    const w = makeWorld();
    await enable(w, "org-a");
    seedOrder(w, { orgId: "org-a", id: "o-ret", phone: "01712345678", status: "processing", shipmentStatuses: ["returned"] });
    seedOrder(w, { orgId: "org-a", id: "o-ref", phone: "01812345678", status: "refunded", isCod: false });
    seedOrder(w, { orgId: "org-a", id: "o-open", phone: "01912345678", status: "processing" });
    const ret: any = await w.svc.contributeForOrder("org-a", "o-ret");
    expect(ret).toEqual({ contributed: true, outcome: "returned" });
    const ref: any = await w.svc.contributeForOrder("org-a", "o-ref");
    expect(ref).toEqual({ contributed: true, outcome: "refunded" });
    const open: any = await w.svc.contributeForOrder("org-a", "o-open");
    expect(open).toEqual({ contributed: false, reason: "open" });
    for (const phone of ["01712345678", "01812345678"]) {
      const stat = w.db.fraudNetworkPhoneStat.find((r) => r.phoneHash === hashFraudPhone(phone))!;
      expect(stat.returnedFailedCount).toBe(1);
      expect(stat.deliveredCount).toBe(0);
    }
    expect(w.db.fraudNetworkPhoneStat.find((r) => r.phoneHash === hashFraudPhone("01912345678"))).toBeUndefined();
  });

  it("phone resolution falls back to the first shipment recipientPhone when the customer has none", async () => {
    const w = makeWorld();
    await enable(w, "org-a");
    const order = seedOrder(w, { orgId: "org-a", id: "o-ship", status: "completed", shipmentStatuses: ["delivered"], shipmentPhone: PHONE });
    // Strip the customer phone everywhere except the shipment.
    order.customer = { id: order.customerId, phone: null, firstName: "Test", lastName: "Buyer" };
    w.db.customer[0].phone = null;
    const res: any = await w.svc.contributeForOrder("org-a", "o-ship");
    expect(res.contributed).toBe(true);
    expect(w.db.fraudNetworkContribution[0].phoneHash).toBe(hashFraudPhone(PHONE));
  });

  it("sweep contributes terminal orders for an opted-in org and reports honestly", async () => {
    const w = makeWorld();
    await enable(w, "org-a");
    seedOrder(w, { orgId: "org-a", id: "o-1", status: "completed" });
    seedOrder(w, { orgId: "org-a", id: "o-2", status: "processing" });
    seedOrder(w, { orgId: "org-a", id: "o-3", status: "cancelled", isCod: true });
    const out: any = await w.svc.runSweep("org-a");
    expect(out).toMatchObject({ checked: 2, contributed: 2, skipped: 0, failures: [] });
    expect(w.db.fraudNetworkContribution.map((r) => r.orderId).sort()).toEqual(["o-1", "o-3"]);
  });
});

describe("NF13 FraudShield sibling signal", () => {
  function makeShield(w: ReturnType<typeof makeWorld>, network?: any) {
    const risk: any = { forOrder: jest.fn(async () => ({ band: "low", score: 5 })) };
    const blocked: any = { isBlocked: jest.fn(async () => false) };
    return new FraudShieldService(
      w.prisma as any, risk, blocked, w.audit as any, undefined, undefined,
      undefined, undefined, undefined, network ?? w.svc,
    );
  }

  async function seedNetworkAtFloor(w: ReturnType<typeof makeWorld>) {
    for (const orgId of ["org-a", "org-b", "org-c"]) {
      await enable(w, orgId);
      seedOrder(w, { orgId, id: `seed-${orgId}`, status: "completed" });
      await w.svc.contributeForOrder(orgId, `seed-${orgId}`);
    }
  }

  it("opted-in org: assessOrder carries networkSignal as a sibling — the org's own score is untouched", async () => {
    const w = makeWorld();
    await seedNetworkAtFloor(w);
    seedOrder(w, { orgId: "org-a", id: "o-target", status: "processing" });
    const shield = makeShield(w);
    const r: any = await shield.assessOrder("org-a", "o-target");
    expect(r).toBeTruthy();
    expect(typeof r.score).toBe("number");
    expect(r.networkSignal).toEqual({
      status: "ok", delivered: 3, returnedFailed: 0, codRefusals: 0,
      contributingOrgCount: 3, total: 3,
    });
    const re: any = await shield.reassess("org-a", "owner-org-a", "o-target");
    expect(re.networkSignal?.status).toBe("ok");
  });

  it("non-opted-in org: networkSignal is ABSENT from the assessment", async () => {
    const w = makeWorld();
    seedOrder(w, { orgId: "org-x", id: "o-target", status: "processing" });
    const shield = makeShield(w);
    const r: any = await shield.assessOrder("org-x", "o-target");
    expect(r).toBeTruthy();
    expect("networkSignal" in r).toBe(false);
    const re: any = await shield.reassess("org-x", "owner-org-x", "o-target");
    expect("networkSignal" in re).toBe(false);
  });

  it("network failure never breaks assessment: a throwing lookup still yields a score", async () => {
    const w = makeWorld();
    await enable(w, "org-a");
    seedOrder(w, { orgId: "org-a", id: "o-target", status: "processing" });
    const shield = makeShield(w, { lookup: async () => { throw new Error("network down"); } });
    const r: any = await shield.assessOrder("org-a", "o-target");
    expect(r).toBeTruthy();
    expect(typeof r.score).toBe("number");
    expect("networkSignal" in r).toBe(false);
  });
});
