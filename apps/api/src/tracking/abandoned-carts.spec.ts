import { TrackingService } from "./tracking.service";
import { AttributionService } from "../attribution/attribution.service";
import { deriveAbandonedCarts } from "./abandoned-carts";
import { AbandonedCartsService } from "./abandoned-carts.service";

// Local fake-prisma (the shared tracking.service.spec.ts matches() helper
// only supports equality and {not}; this one also supports {in}, {gte},
// orderBy and take, which the abandoned-carts queries use).
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in (v as any)) return (v as any).in.includes(row[k]);
      if ("not" in (v as any)) return row[k] !== (v as any).not;
      if ("gte" in (v as any)) return new Date(row[k]).getTime() >= new Date((v as any).gte).getTime();
      return false;
    }
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}
function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let out = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy) {
        const [key, dir] = Object.entries(orderBy)[0] as [string, string];
        out = [...out].sort((a, b) => {
          const d = new Date(a[key]).getTime() - new Date(b[key]).getTime();
          return dir === "desc" ? -d : d;
        });
      }
      if (typeof take === "number") out = out.slice(0, take);
      return out;
    },
    create: async ({ data }: any) => { const row = { id: `id-${++seq}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return row; },
  };
}

const H = 60 * 60 * 1000;
const D = 24 * H;
const NOW = new Date("2026-10-11T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function ev(partial: any) {
  return {
    visitorId: "v1", sessionKey: "s1", storeId: "store-1",
    properties: null, valueMinor: null, currency: null,
    ...partial,
  };
}

describe("deriveAbandonedCarts", () => {
  it("(1) cart 2h ago, no purchase → included, signal add_to_cart", () => {
    const rows = deriveAbandonedCarts([ev({ type: "add_to_cart", occurredAt: ago(2 * H) })], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ visitorId: "v1", sessionKey: "s1", storeId: "store-1", signal: "add_to_cart" });
    expect(rows[0].lastActivityAt).toBe(ago(2 * H).toISOString());
  });

  it("(2) purchase 30min AFTER the first signal → excluded (converted)", () => {
    const rows = deriveAbandonedCarts([
      ev({ type: "add_to_cart", occurredAt: ago(2 * H) }),
      ev({ type: "purchase", occurredAt: ago(2 * H - 30 * 60 * 1000) }),
    ], NOW);
    expect(rows).toHaveLength(0);
  });

  it("(3) purchase 1 day BEFORE the cart → still included", () => {
    const rows = deriveAbandonedCarts([
      ev({ type: "purchase", occurredAt: ago(1 * D), sessionKey: "old-session" }),
      ev({ type: "add_to_cart", occurredAt: ago(2 * H) }),
    ], NOW);
    expect(rows).toHaveLength(1);
  });

  it("(4) last activity 10min ago → excluded (too recent)", () => {
    const rows = deriveAbandonedCarts([ev({ type: "add_to_cart", occurredAt: ago(10 * 60 * 1000) })], NOW);
    expect(rows).toHaveLength(0);
  });

  it("(5) last activity 8 days ago → excluded (lookback)", () => {
    const rows = deriveAbandonedCarts([ev({ type: "add_to_cart", occurredAt: ago(8 * D) })], NOW);
    expect(rows).toHaveLength(0);
  });

  it("(6) session with only page_view → absent", () => {
    const rows = deriveAbandonedCarts([ev({ type: "page_view", occurredAt: ago(2 * H) })], NOW);
    expect(rows).toHaveLength(0);
  });

  it("(7) checkout_started present → signal checkout_started", () => {
    const rows = deriveAbandonedCarts([
      ev({ type: "add_to_cart", occurredAt: ago(3 * H) }),
      ev({ type: "checkout_started", occurredAt: ago(2 * H) }),
    ], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].signal).toBe("checkout_started");
    expect(rows[0].lastActivityAt).toBe(ago(2 * H).toISOString());
  });

  it("(8) value honesty: no stored valueMinor → null; latest valued signal wins", () => {
    const noValue = deriveAbandonedCarts([
      ev({ type: "add_to_cart", occurredAt: ago(2 * H), properties: { productId: "p1" } }),
    ], NOW);
    expect(noValue[0].valueMinor).toBeNull();
    expect(noValue[0].currency).toBeNull();

    const laterValued = deriveAbandonedCarts([
      ev({ type: "add_to_cart", occurredAt: ago(3 * H) }),
      ev({ type: "checkout_started", occurredAt: ago(2 * H), valueMinor: 125050n, currency: "BDT" }),
    ], NOW);
    expect(laterValued[0].valueMinor).toBe("125050");
    expect(laterValued[0].currency).toBe("BDT");

    const earlierValued = deriveAbandonedCarts([
      ev({ type: "add_to_cart", occurredAt: ago(3 * H), valueMinor: 10000n, currency: "BDT" }),
      ev({ type: "add_to_cart", occurredAt: ago(2 * H) }),
    ], NOW);
    expect(earlierValued[0].valueMinor).toBe("10000");
  });

  it("(9) items: dedupe by productId/name, first wins, quantity must be a positive number", () => {
    const rows = deriveAbandonedCarts([
      ev({ type: "add_to_cart", occurredAt: ago(4 * H), properties: { productId: "p1", name: "Shirt", quantity: 2 } }),
      ev({ type: "add_to_cart", occurredAt: ago(3 * H), properties: { productId: "p1", name: "Shirt", quantity: 5 } }),
      ev({ type: "add_to_cart", occurredAt: ago(2.5 * H), properties: { name: "Pant" } }),
      ev({ type: "add_to_cart", occurredAt: ago(2.2 * H), properties: { productId: "p3", quantity: 0 } }),
      ev({ type: "add_to_cart", occurredAt: ago(2.1 * H), properties: { productId: "p4", quantity: "2" } }),
      ev({ type: "add_to_cart", occurredAt: ago(2 * H), properties: null }),
    ], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].items).toEqual([
      { productId: "p1", name: "Shirt", quantity: 2 },
      { productId: null, name: "Pant", quantity: null },
      { productId: "p3", name: null, quantity: null },
      { productId: "p4", name: null, quantity: null },
    ]);
  });

  it("sorts rows by lastActivityAt desc", () => {
    const rows = deriveAbandonedCarts([
      ev({ type: "add_to_cart", occurredAt: ago(5 * H), sessionKey: "old", visitorId: "v-old" }),
      ev({ type: "add_to_cart", occurredAt: ago(2 * H), sessionKey: "new", visitorId: "v-new" }),
    ], NOW);
    expect(rows.map((r) => r.visitorId)).toEqual(["v-new", "v-old"]);
  });
});

describe("TrackingService ingest — identify (S4)", () => {
  function fakePrisma() {
    return {
      store: makeTable(), visitor: makeTable(), trackingSession: makeTable(),
      touchpoint: makeTable(), trackingEvent: makeTable(), order: makeTable(),
      attributionCredit: makeTable(),
    };
  }
  async function setup() {
    const prisma = fakePrisma();
    prisma.store.rows.push({ id: "store-1", organizationId: "org-1", trackingKey: "key-1" });
    const svc = new TrackingService(prisma as any, new AttributionService(prisma as any));
    return { prisma, svc };
  }
  const base = { anonymousId: "anon-1", sessionKey: "sess-1", session: {} };

  it("stores a sanitized email (trimmed, lowercased) and phone on the visitor", async () => {
    const { prisma, svc } = await setup();
    const r = await svc.ingest({
      key: "key-1",
      events: [{ ...base, clientEventId: "id-1", type: "identify", properties: { email: "A@B.com ", phone: "+880 1711-000000" } } as any],
    });
    expect(r.accepted).toBe(1);
    expect(prisma.visitor.rows).toHaveLength(1);
    expect(prisma.visitor.rows[0].email).toBe("a@b.com");
    expect(prisma.visitor.rows[0].phone).toBe("+880 1711-000000");
    // The identify event itself is still stored like any event.
    expect(prisma.trackingEvent.rows).toHaveLength(1);
    expect(prisma.trackingEvent.rows[0].type).toBe("identify");
  });

  it("ignores an invalid email and an invalid phone, stores nothing for them", async () => {
    const { prisma, svc } = await setup();
    await svc.ingest({
      key: "key-1",
      events: [{ ...base, clientEventId: "id-2", type: "identify", properties: { email: "not-an-email", phone: "abc" } } as any],
    });
    expect(prisma.visitor.rows[0].email).toBeUndefined();
    expect(prisma.visitor.rows[0].phone).toBeUndefined();
  });

  it("a later identify updates only the valid provided fields", async () => {
    const { prisma, svc } = await setup();
    await svc.ingest({
      key: "key-1",
      events: [{ ...base, clientEventId: "id-3", type: "identify", properties: { email: "first@example.com" } } as any],
    });
    await svc.ingest({
      key: "key-1",
      events: [{ ...base, clientEventId: "id-4", type: "identify", properties: { phone: "01711000000" } } as any],
    });
    expect(prisma.visitor.rows).toHaveLength(1);
    expect(prisma.visitor.rows[0].email).toBe("first@example.com");
    expect(prisma.visitor.rows[0].phone).toBe("01711000000");
  });
});

describe("AbandonedCartsService", () => {
  function fakePrisma() {
    return { trackingEvent: makeTable(), visitor: makeTable(), store: makeTable(), auditLog: makeTable() };
  }

  function seedCart(prisma: any, opts: { org?: string; visitorId?: string; email?: string | null; at?: Date } = {}) {
    const org = opts.org ?? "org-1";
    const visitorId = opts.visitorId ?? "v1";
    const at = opts.at ?? new Date(Date.now() - 2 * H);
    prisma.trackingEvent.rows.push({
      id: `ev-${visitorId}-${org}`, organizationId: org, storeId: "store-1", visitorId,
      sessionKey: `sess-${visitorId}`, type: "add_to_cart",
      properties: { productId: "p1", name: "Shirt", quantity: 2 },
      valueMinor: null, currency: null, occurredAt: at,
    });
    prisma.visitor.rows.push({ id: visitorId, organizationId: org, anonymousId: `anon-${visitorId}`, email: opts.email === undefined ? "shopper@example.com" : opts.email, phone: null });
    if (!prisma.store.rows.some((s: any) => s.id === "store-1")) {
      prisma.store.rows.push({ id: "store-1", organizationId: org, name: "আমার দোকান", url: "https://shop.example.com" });
    }
    return at;
  }

  function makeAudit(prisma: any) {
    const inputs: any[] = [];
    return {
      inputs,
      log: async (input: any) => {
        inputs.push(input);
        prisma.auditLog.rows.push({
          id: `audit-${prisma.auditLog.rows.length + 1}`, createdAt: new Date(),
          organizationId: input.organizationId, userId: input.userId, action: input.action,
          entityType: input.entityType, entityId: input.entityId, metadata: input.metadata,
        });
      },
    };
  }

  function makeEmail(behavior: "ok" | "throw" = "ok") {
    const calls: any[] = [];
    return {
      calls,
      send: async (input: any) => {
        calls.push(input);
        if (behavior === "throw") throw new Error("SMTP connection refused");
        return { providerMessageId: "msg-123" };
      },
    };
  }

  it("list() returns the cart enriched with contact, store and no recovery marker", async () => {
    const prisma = fakePrisma();
    seedCart(prisma);
    const svc = new AbandonedCartsService(prisma as any, makeAudit(prisma) as any, makeEmail() as any);
    const res = await svc.list("org-1");
    expect(res.minAgeHours).toBe(1);
    expect(res.lookbackDays).toBe(7);
    expect(res.carts).toHaveLength(1);
    expect(res.carts[0]).toMatchObject({
      visitorId: "v1", storeName: "আমার দোকান", storeUrl: "https://shop.example.com",
      contact: { email: "shopper@example.com", phone: null }, recoverySentAt: null,
    });
    expect(res.carts[0].items).toEqual([{ productId: "p1", name: "Shirt", quantity: 2 }]);
  });

  it("list() is tenant-isolated: another org's carts never appear", async () => {
    const prisma = fakePrisma();
    seedCart(prisma, { org: "org-2", visitorId: "v-other" });
    seedCart(prisma, { org: "org-1", visitorId: "v1" });
    const svc = new AbandonedCartsService(prisma as any, makeAudit(prisma) as any, makeEmail() as any);
    const res = await svc.list("org-1");
    expect(res.carts.map((c: any) => c.visitorId)).toEqual(["v1"]);
    await expect(svc.sendRecovery("org-1", "user-1", "v-other")).rejects.toThrow("কোনো abandoned cart পাওয়া যায়নি");
  });

  it("sendRecovery: no email on the visitor → BadRequest, nothing sent, no marker", async () => {
    const prisma = fakePrisma();
    seedCart(prisma, { email: null });
    const email = makeEmail();
    const svc = new AbandonedCartsService(prisma as any, makeAudit(prisma) as any, email as any);
    await expect(svc.sendRecovery("org-1", "user-1", "v1")).rejects.toThrow("কোনো ইমেইল ঠিকানা নেই");
    expect(email.calls).toHaveLength(0);
    expect(prisma.auditLog.rows).toHaveLength(0);
  });

  it("sendRecovery: already sent for this cart → BadRequest, no second send", async () => {
    const prisma = fakePrisma();
    const at = seedCart(prisma);
    prisma.auditLog.rows.push({
      id: "audit-seed", createdAt: new Date(), organizationId: "org-1", action: "tracking.cart_recovery_sent",
      entityType: "Visitor", entityId: "v1",
      metadata: { storeId: "store-1", sessionKey: "sess-v1", lastCartActivity: at.toISOString(), to: "shopper@example.com", providerMessageId: "old" },
    });
    const email = makeEmail();
    const svc = new AbandonedCartsService(prisma as any, makeAudit(prisma) as any, email as any);
    const list = await svc.list("org-1");
    expect(list.carts[0].recoverySentAt).not.toBeNull();
    await expect(svc.sendRecovery("org-1", "user-1", "v1")).rejects.toThrow("ইতিমধ্যে পাঠানো হয়েছে");
    expect(email.calls).toHaveLength(0);
  });

  it("sendRecovery: email provider throws → BadRequest and ZERO new audit markers", async () => {
    const prisma = fakePrisma();
    seedCart(prisma);
    const svc = new AbandonedCartsService(prisma as any, makeAudit(prisma) as any, makeEmail("throw") as any);
    await expect(svc.sendRecovery("org-1", "user-1", "v1")).rejects.toThrow("ইমেইল পাঠানো যায়নি: SMTP connection refused");
    expect(prisma.auditLog.rows).toHaveLength(0);
  });

  it("sendRecovery: no email provider injected → honest BadRequest", async () => {
    const prisma = fakePrisma();
    seedCart(prisma);
    const svc = new AbandonedCartsService(prisma as any, makeAudit(prisma) as any);
    await expect(svc.sendRecovery("org-1", "user-1", "v1")).rejects.toThrow("ইমেইল পাঠানোর সুবিধা এই deployment-এ নেই");
  });

  it("sendRecovery success: sends once, writes exactly one marker, list() then shows recoverySentAt", async () => {
    const prisma = fakePrisma();
    const at = seedCart(prisma);
    const email = makeEmail();
    const svc = new AbandonedCartsService(prisma as any, makeAudit(prisma) as any, email as any);

    const res = await svc.sendRecovery("org-1", "user-1", "v1");
    expect(res).toEqual({ sent: true, to: "shopper@example.com", providerMessageId: "msg-123" });
    expect(email.calls).toHaveLength(1);
    expect(email.calls[0].to).toBe("shopper@example.com");
    expect(email.calls[0].subject).toBe("আমার দোকান: আপনার কার্টটি এখনও অপেক্ষা করছে");
    expect(email.calls[0].text).toContain("- Shirt ×2");
    expect(email.calls[0].text).toContain("https://shop.example.com");

    expect(prisma.auditLog.rows).toHaveLength(1);
    expect(prisma.auditLog.rows[0]).toMatchObject({
      action: "tracking.cart_recovery_sent", entityType: "Visitor", entityId: "v1",
    });
    expect(prisma.auditLog.rows[0].metadata).toMatchObject({
      storeId: "store-1", sessionKey: "sess-v1", lastCartActivity: at.toISOString(),
      to: "shopper@example.com", providerMessageId: "msg-123",
    });

    const list = await svc.list("org-1");
    expect(list.carts[0].recoverySentAt).not.toBeNull();

    // And a second send is refused.
    await expect(svc.sendRecovery("org-1", "user-1", "v1")).rejects.toThrow("ইতিমধ্যে পাঠানো হয়েছে");
    expect(email.calls).toHaveLength(1);
    expect(prisma.auditLog.rows).toHaveLength(1);
  });
});
