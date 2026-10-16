import "reflect-metadata";
import { CustomersService } from "./customers.service";
import {
  CrmSegmentsService, segmentMatches, validateSegmentCriteria,
} from "./crm-segments.service";
import { CheckoutGuardService } from "../fraud/checkout-guard.service";
import { IdentifierListsService } from "../fraud/identifier-lists.service";
import { FraudAttemptLogService } from "../fraud/fraud-attempt-log.service";
import { computeIntakeWarnings } from "../orders/intake-warnings";
import { ShopAccountService } from "../storefront/shop-account.service";
import { hashShopSecret } from "../storefront/shop-auth.util";

/**
 * GB6 (GC15) — CRM completion specs: customer tags/notes/VIP/
 * block updates with content-free audits, grouped + sold-bucket
 * list stats, type/tag/segment filters, segment CRUD +
 * validation, the checkout-gate customer block, the intake
 * blocked warning, and the EC25 shop-account leak guard.
 * Fake-Prisma in the neighbouring makeTable style (extended
 * with the order.groupBy the grouped stats use).
 */

function matchWhere(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in v) return v.in.map(String).includes(String(row[k]));
      if ("notIn" in v) return !v.notIn.map(String).includes(String(row[k]));
      if ("not" in v) return row[k] !== v.not;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return String(row[k]) === String(v);
  });
}

function makeTable(name: string, seed: any[] = []) {
  const rows: any[] = [...seed];
  let seq = rows.length;
  const table: any = {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matchWhere(r, where)) ?? null,
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let f = rows.filter((r) => matchWhere(r, where ?? {}));
      if (orderBy?.createdAt) {
        f = [...f].sort((a, b) =>
          (new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime()) *
          (orderBy.createdAt === "desc" ? -1 : 1));
      }
      if (take !== undefined) f = f.slice(0, take);
      return f;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matchWhere(r, where));
      if (idx < 0) throw new Error("record not found");
      return rows.splice(idx, 1)[0];
    },
    groupBy: async ({ by, where }: any = {}) => {
      const field = by[0];
      const groups = new Map<string, { count: number; sum: bigint }>();
      for (const r of rows.filter((x) => matchWhere(x, where))) {
        const g = groups.get(String(r[field])) ?? { count: 0, sum: 0n };
        g.count += 1;
        try { g.sum += BigInt(r.totalMinor ?? 0); } catch { /* ignore */ }
        groups.set(String(r[field]), g);
      }
      return [...groups.entries()].map(([k, g]) => ({ [field]: k, _count: { _all: g.count }, _sum: { totalMinor: g.sum } }));
    },
  };
  return table;
}

const NOTES_A = "গোপন নোট A — staff only";
const NOTES_B = "ভেতরের staff নোট B";

function makeWorld() {
  const customers = makeTable("customer", [
    {
      id: "cA", organizationId: "org-1", firstName: "Ayesha", lastName: "Rahman",
      phone: "01711111111", email: "ayesha@example.com", source: "shop", mergedIntoId: null,
      tags: ["loyal", "ঢাকা"], notes: NOTES_A, isVip: true, isBlocked: false, blockedReason: null,
      address: { district: "Dhaka" }, createdAt: new Date("2026-01-03"),
    },
    {
      id: "cB", organizationId: "org-1", firstName: "Babul", lastName: "Mia",
      phone: "01822222222", email: null, source: "manual", mergedIntoId: null,
      tags: ["wholesale"], notes: null, isVip: false, isBlocked: false, blockedReason: null,
      address: { district: "Khulna" }, createdAt: new Date("2026-01-02"),
    },
    {
      id: "cC", organizationId: "org-1", firstName: "Chitra", lastName: "Das",
      phone: "01933333333", email: null, source: "shop", mergedIntoId: null,
      tags: [], notes: NOTES_B, isVip: false, isBlocked: true, blockedReason: "বারবার ভুয়া অর্ডার",
      address: { district: "dhaka" }, createdAt: new Date("2026-01-01"),
    },
  ]);
  const orders = makeTable("order", [
    { id: "oA1", organizationId: "org-1", customerId: "cA", status: "completed", totalMinor: 100000n, isPractice: false },
    { id: "oA2", organizationId: "org-1", customerId: "cA", status: "processing", totalMinor: 50000n, isPractice: false },
    { id: "oA3", organizationId: "org-1", customerId: "cA", status: "cancelled", totalMinor: 99900n, isPractice: false },
    { id: "oA4", organizationId: "org-1", customerId: "cA", status: "pending", totalMinor: 7000n, isPractice: false },
    { id: "oB1", organizationId: "org-1", customerId: "cB", status: "delivered", totalMinor: 30000n, isPractice: false },
  ]);
  const shipments = makeTable("courierShipment", [
    { id: "sA2", organizationId: "org-1", orderId: "oA2", status: "delivered", codAmountMinor: 50000n },
  ]);
  const prisma: any = {
    customer: customers,
    order: orders,
    courierShipment: shipments,
    channelConversation: makeTable("channelConversation"),
    lead: makeTable("lead"),
    crmSegment: makeTable("crmSegment"),
  };
  const audit = { calls: [] as any[], log: async (i: any) => { audit.calls.push(i); } };
  const segments = new CrmSegmentsService(prisma, audit as any);
  const svc = new CustomersService(prisma, audit as any, undefined, undefined, undefined, segments);
  return { prisma, audit, svc, segments, customers, orders };
}

describe("GB6 update — tags (wholesale replace, OrdersService discipline)", () => {
  it("replaces tags with trim + dedupe and audits count only", async () => {
    const { svc, audit } = makeWorld();
    const out = await svc.update("org-1", "actor-1", "cB", { tags: ["  vip ", "vip", "নতুন"] });
    expect(out.customer.tags).toEqual(["vip", "নতুন"]);
    const call = audit.calls.find((c) => c.action === "customer.tags_updated");
    expect(call).toBeDefined();
    expect(call.metadata).toEqual({ count: 2 });
    // A tags-only update does not emit the classic audit.
    expect(audit.calls.filter((c) => c.action === "customer.updated")).toHaveLength(0);
  });

  it("rejects 11 tags and a 31-char tag with 400", async () => {
    const { svc } = makeWorld();
    await expect(svc.update("org-1", "a", "cB", { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }))
      .rejects.toThrow(/সর্বোচ্চ ১০টি/);
    await expect(svc.update("org-1", "a", "cB", { tags: ["x".repeat(31)] }))
      .rejects.toThrow(/১–৩০/);
  });

  it("tags: null clears to an empty array", async () => {
    const { svc } = makeWorld();
    const out = await svc.update("org-1", "a", "cA", { tags: null });
    expect(out.customer.tags).toEqual([]);
  });
});

describe("GB6 update — notes / VIP / block (content never audited)", () => {
  it("stores notes; the audit metadata carries length ONLY", async () => {
    const { svc, audit } = makeWorld();
    const out = await svc.update("org-1", "actor-1", "cB", { notes: NOTES_B });
    expect(out.customer.notes).toBe(NOTES_B);
    const call = audit.calls.find((c) => c.action === "customer.notes_updated");
    expect(call.metadata).toEqual({ length: NOTES_B.length });
    expect(JSON.stringify(audit.calls)).not.toContain("staff নোট");
  });

  it("notes beyond 10000 chars 400; null clears", async () => {
    const { svc } = makeWorld();
    await expect(svc.update("org-1", "a", "cB", { notes: "x".repeat(10001) })).rejects.toThrow(/১০,০০০/);
    const out = await svc.update("org-1", "a", "cA", { notes: null });
    expect(out.customer.notes).toBeNull();
  });

  it("vip + block audits carry flags only; unblocking clears the reason", async () => {
    const { svc, audit } = makeWorld();
    await svc.update("org-1", "actor-1", "cB", { isVip: true });
    expect(audit.calls.find((c) => c.action === "customer.vip_updated")?.metadata).toEqual({ isVip: true });

    const blocked = await svc.update("org-1", "actor-1", "cB", { isBlocked: true, blockedReason: "স্প্যাম অর্ডার" });
    expect(blocked.customer.isBlocked).toBe(true);
    expect(blocked.customer.blockedReason).toBe("স্প্যাম অর্ডার");
    const blockCall = audit.calls.find((c) => c.action === "customer.block_updated");
    expect(blockCall.metadata).toEqual({ isBlocked: true });
    expect(JSON.stringify(blockCall)).not.toContain("স্প্যাম");

    const cleared = await svc.update("org-1", "actor-1", "cB", { isBlocked: false });
    expect(cleared.customer.isBlocked).toBe(false);
    expect(cleared.customer.blockedReason).toBeNull();
  });

  it("blockedReason beyond 300 chars 400s", async () => {
    const { svc } = makeWorld();
    await expect(svc.update("org-1", "a", "cB", { blockedReason: "x".repeat(301) })).rejects.toThrow(/৩০০/);
  });
});

describe("GB6 detail / list payloads — notes stay detail-only", () => {
  it("detail HAS notes + the CRM fields, normalized", async () => {
    const { svc } = makeWorld();
    const out = await svc.detail("org-1", "cA");
    expect(out.customer.notes).toBe(NOTES_A);
    expect(out.customer.tags).toEqual(["loyal", "ঢাকা"]);
    expect(out.customer.isVip).toBe(true);
    expect(out.customer.isBlocked).toBe(false);
    expect(out.customer.blockedReason).toBeNull();
  });

  it("list rows carry tags/isVip/isBlocked but NEVER notes", async () => {
    const { svc } = makeWorld();
    const rows = await svc.list("org-1");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).not.toHaveProperty("notes");
      expect(row).not.toHaveProperty("blockedReason");
      expect(Array.isArray(row.tags)).toBe(true);
    }
    const a = rows.find((r: any) => r.id === "cA");
    expect(a.tags).toEqual(["loyal", "ঢাকা"]);
    expect(a.isVip).toBe(true);
    const c = rows.find((r: any) => r.id === "cC");
    expect(c.isBlocked).toBe(true);
  });
});

describe("GB6 list stats — grouped labelled figures + EC33 sold bucket", () => {
  it("computes exact stats per customer", async () => {
    const { svc } = makeWorld();
    const rows = await svc.list("org-1");
    const byId = new Map<string, any>(rows.map((r: any) => [r.id, r]));

    const a = byId.get("cA");
    // Non-cancelled: oA1 + oA2 + oA4 = 3 orders, 157000.
    expect(a.orderCount).toBe(3);
    expect(a.totalSpentMinor).toBe("157000");
    // Sold: oA1 (completed) + oA2 (processing + delivered shipment).
    expect(a.soldOrderCount).toBe(2);
    expect(a.lifetimeValueMinor).toBe("150000");
    expect(a.aovMinor).toBe("75000");
    expect(a.isRepeat).toBe(true);

    const b = byId.get("cB");
    expect(b.orderCount).toBe(1);
    expect(b.totalSpentMinor).toBe("30000");
    expect(b.soldOrderCount).toBe(1);
    expect(b.lifetimeValueMinor).toBe("30000");
    expect(b.aovMinor).toBe("30000");
    expect(b.isRepeat).toBe(false);

    const c = byId.get("cC");
    expect(c.orderCount).toBe(0);
    expect(c.soldOrderCount).toBe(0);
    expect(c.lifetimeValueMinor).toBe("0");
    expect(c.aovMinor).toBeNull();
    expect(c.isRepeat).toBe(false);
  });

  it("falls back when the order delegate has no groupBy", async () => {
    const { svc, prisma } = makeWorld();
    delete prisma.order.groupBy;
    const rows = await svc.list("org-1");
    const a = rows.find((r: any) => r.id === "cA");
    expect(a.orderCount).toBe(3);
    expect(a.totalSpentMinor).toBe("157000");
    expect(a.soldOrderCount).toBe(2);
  });
});

describe("GB6 list filters — customerType / tag / segmentId", () => {
  it("customerType vip / blocked / repeat / first return the right subsets", async () => {
    const { svc } = makeWorld();
    const ids = (rows: any[]) => rows.map((r) => r.id).sort();
    expect(ids(await svc.list("org-1", undefined, { customerType: "vip" }))).toEqual(["cA"]);
    expect(ids(await svc.list("org-1", undefined, { customerType: "blocked" }))).toEqual(["cC"]);
    expect(ids(await svc.list("org-1", undefined, { customerType: "repeat" }))).toEqual(["cA"]);
    expect(ids(await svc.list("org-1", undefined, { customerType: "first" }))).toEqual(["cB", "cC"]);
    expect(ids(await svc.list("org-1", undefined, { customerType: "all" }))).toEqual(["cA", "cB", "cC"]);
  });

  it("tag filter matches the stored tag exactly", async () => {
    const { svc } = makeWorld();
    const rows = await svc.list("org-1", undefined, { tag: "wholesale" });
    expect(rows.map((r: any) => r.id)).toEqual(["cB"]);
  });

  it("segmentId filter total equals the segment memberCount on the same fixtures", async () => {
    const { svc, segments } = makeWorld();
    const seg = await segments.createSegment("org-1", "actor-1", {
      name: "ভালো ক্রেতা", criteria: { minSpentMinor: "20000" },
    });
    expect(seg.memberCount).toBe(2); // cA 150000 + cB 30000 sold LTV
    const rows = await svc.list("org-1", undefined, { segmentId: seg.id });
    expect(rows).toHaveLength(seg.memberCount);
    expect(rows.map((r: any) => r.id).sort()).toEqual(["cA", "cB"]);
  });

  it("segmentId from another org 404s the list", async () => {
    const { svc, segments } = makeWorld();
    const seg = await segments.createSegment("org-1", "actor-1", { name: "S", criteria: { isVip: true } });
    await expect(svc.list("org-2", undefined, { segmentId: seg.id })).rejects.toThrow(/not found/i);
  });
});

describe("GB6 segments — evaluator + CRUD validation", () => {
  it("evaluator: every present criterion must match (district case-insensitive)", () => {
    const facts = { tags: ["loyal"], isVip: true, isRepeat: false, lifetimeValueMinor: 5000n, district: "Dhaka" };
    expect(segmentMatches({ tagsAny: ["loyal", "other"] }, facts)).toBe(true);
    expect(segmentMatches({ tagsAny: ["other"] }, facts)).toBe(false);
    expect(segmentMatches({ isVip: true, isRepeat: true }, facts)).toBe(false);
    expect(segmentMatches({ minSpentMinor: "5000" }, facts)).toBe(true);
    expect(segmentMatches({ minSpentMinor: "5001" }, facts)).toBe(false);
    expect(segmentMatches({ district: "DHAKA" }, facts)).toBe(true);
    expect(segmentMatches({ district: "Khulna" }, facts)).toBe(false);
    expect(segmentMatches({}, facts)).toBe(true);
  });

  it("validation: unknown key 400, minSpentMinor 'abc' 400, 11 tagsAny 400", () => {
    expect(() => validateSegmentCriteria({ bogus: 1 })).toThrow(/অজানা/);
    expect(() => validateSegmentCriteria({ minSpentMinor: "abc" })).toThrow(/minSpentMinor/);
    expect(() => validateSegmentCriteria({ minSpentMinor: "-5" })).toThrow(/minSpentMinor/);
    expect(() => validateSegmentCriteria({ tagsAny: Array.from({ length: 11 }, (_, i) => `t${i}`) })).toThrow(/tagsAny/);
    expect(validateSegmentCriteria({ minSpentMinor: "0", isVip: false })).toEqual({ minSpentMinor: "0", isVip: false });
  });

  it("memberCount per criteria over the fixtures", async () => {
    const { segments } = makeWorld();
    expect((await segments.createSegment("org-1", "a", { name: "VIP", criteria: { isVip: true } })).memberCount).toBe(1);
    expect((await segments.createSegment("org-1", "a", { name: "ঢাকা", criteria: { district: "DHAKA" } })).memberCount).toBe(2);
    expect((await segments.createSegment("org-1", "a", { name: "পাইকারি", criteria: { tagsAny: ["wholesale"] } })).memberCount).toBe(1);
    expect((await segments.createSegment("org-1", "a", { name: "রিপিট", criteria: { isRepeat: true } })).memberCount).toBe(1);
    const listed = await segments.listSegments("org-1");
    expect(listed).toHaveLength(4);
    expect(listed.every((s: any) => typeof s.memberCount === "number")).toBe(true);
  });

  it("create audits keys only; foreign-org segment 404s on patch/delete", async () => {
    const { segments, audit } = makeWorld();
    const seg = await segments.createSegment("org-1", "actor-1", {
      name: "গোপন সেগমেন্ট", criteria: { tagsAny: ["loyal"], minSpentMinor: "100" },
    });
    const call = audit.calls.find((c) => c.action === "customer.segment_created");
    expect(call.metadata).toEqual({ keys: ["tagsAny", "minSpentMinor"] });
    expect(JSON.stringify(call)).not.toContain("loyal");

    await expect(segments.updateSegment("org-2", "a", seg.id, { name: "X" })).rejects.toThrow(/not found/i);
    await expect(segments.deleteSegment("org-2", "a", seg.id)).rejects.toThrow(/not found/i);

    const updated = await segments.updateSegment("org-1", "a", seg.id, { criteria: { isVip: true } });
    expect(updated.memberCount).toBe(1);
    const del = await segments.deleteSegment("org-1", "a", seg.id);
    expect(del).toEqual({ deleted: true, id: seg.id });
    expect(await segments.listSegments("org-1")).toHaveLength(0);
  });

  it("create with an unknown criteria key rejects end-to-end", async () => {
    const { segments } = makeWorld();
    await expect(segments.createSegment("org-1", "a", { name: "S", criteria: { nope: true } }))
      .rejects.toThrow(/অজানা/);
  });
});

describe("GB6 shop-account leak guard (EC25 payload)", () => {
  it("the shop `me` payload carries no notes / blockedReason for a CRM-loaded customer", async () => {
    const { prisma } = makeWorld();
    prisma.organization = makeTable("organization", [{ id: "org-1", slug: "my-shop" }]);
    prisma.storefrontSetting = makeTable("storefrontSetting", [{ organizationId: "org-1", shopEnabled: true }]);
    prisma.shopSession = makeTable("shopSession", [{
      id: "sess-1", organizationId: "org-1", customerId: "cC",
      tokenHash: hashShopSecret("tok-1"), expiresAt: new Date(Date.now() + 3600_000), revokedAt: null,
    }]);
    prisma.customerAddress = makeTable("customerAddress");
    const shop = new ShopAccountService(prisma);
    const me = await shop.me("my-shop", "tok-1");
    expect(me.customer.id).toBe("cC");
    expect(me.customer).not.toHaveProperty("notes");
    expect(me.customer).not.toHaveProperty("blockedReason");
    expect(me.customer).not.toHaveProperty("tags");
    expect(JSON.stringify(me)).not.toContain(NOTES_B);
    expect(JSON.stringify(me)).not.toContain("ভুয়া অর্ডার");
  });
});

function makeGuardWorld() {
  const { prisma } = makeWorld();
  prisma.blockedIdentifier = makeTable("blockedIdentifier");
  prisma.trustedIdentifier = makeTable("trustedIdentifier");
  prisma.fraudAttemptLog = makeTable("fraudAttemptLog");
  prisma.fraudShieldSetting = makeTable("fraudShieldSetting", [{
    id: "set-1", organizationId: "org-1",
    openOrderPolicy: "off", openOrderWindowHours: 72, waitingPeriodMinutes: 0,
    maxOrdersPerPhonePerDay: 0, captchaEnabled: false, captchaOnCheckout: true,
    captchaOnOtp: false, turnstileSiteKey: null, turnstileSecretEncrypted: null,
  }]);
  const audit = { log: async () => undefined };
  const identifiers = new IdentifierListsService(prisma, audit as any);
  const attempts = new FraudAttemptLogService(prisma);
  const guard = new CheckoutGuardService(prisma, identifiers, attempts);
  return { prisma, guard };
}

describe("GB6 checkout gate — blocked customer record", () => {
  it("refuses with the generic message and logs kind customer_block", async () => {
    const { prisma, guard } = makeGuardWorld();
    await expect(guard.evaluateGate("org-1", "shop", { phone: "01933333333", surface: "checkout" }))
      .rejects.toThrow("দুঃখিত, এই মুহূর্তে অর্ডারটি নেওয়া যাচ্ছে না");
    const kinds = prisma.fraudAttemptLog.rows.map((r: any) => r.kind);
    expect(kinds).toContain("customer_block");
  });

  it("an unblocked customer phone passes", async () => {
    const { guard } = makeGuardWorld();
    await expect(guard.evaluateGate("org-1", "shop", { phone: "01711111111", surface: "checkout" }))
      .resolves.toEqual({ trusted: false, warnOpenOrder: false });
  });

  it("a trusted phone bypasses the customer block (step-2 family)", async () => {
    const { prisma, guard } = makeGuardWorld();
    prisma.trustedIdentifier.rows.push({
      id: "t-1", organizationId: "org-1", kind: "phone", matchKey: "1933333333",
    });
    await expect(guard.evaluateGate("org-1", "shop", { phone: "01933333333", surface: "checkout" }))
      .resolves.toEqual({ trusted: true, warnOpenOrder: false });
    expect(prisma.fraudAttemptLog.rows).toHaveLength(0);
  });

  it("fails OPEN when the customer-block lookup errors", async () => {
    const { prisma, guard } = makeGuardWorld();
    const original = prisma.customer.findMany;
    prisma.customer.findMany = async (args: any) => {
      if (args?.select) throw new Error("db down");
      return original(args);
    };
    await expect(guard.evaluateGate("org-1", "shop", { phone: "01933333333", surface: "checkout" }))
      .resolves.toEqual({ trusted: false, warnOpenOrder: false });
  });
});

describe("GB6 intake warning — blocked customer record", () => {
  it("warns customer_blocked for a blocked phone match (no name needed)", async () => {
    const { prisma } = makeWorld();
    const r = await computeIntakeWarnings(prisma, null, "org-1", { phone: "01933333333" });
    expect(r.warnings.map((w) => w.key)).toContain("customer_blocked");
  });

  it("no customer_blocked warning for an unblocked match", async () => {
    const { prisma } = makeWorld();
    const r = await computeIntakeWarnings(prisma, null, "org-1", { phone: "01711111111", name: "Ayesha Rahman" });
    expect(r.warnings.map((w) => w.key)).not.toContain("customer_blocked");
  });
});
