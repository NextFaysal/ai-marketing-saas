import { MessagingService } from "./messaging.service";

/**
 * MX8 (service) — per-recipient dynamic personalization on the
 * real send paths: unique StoreDiscount coupon issuance at send
 * time with resume/retry idempotency, recommendation blocks
 * from real orders + identified browsing, loyalty/gift-card
 * balance vars from the real ledgers, segment-conditional
 * blocks via the MS3 evaluator — on BOTH engines (MX1 recipient
 * table + legacy snapshot). Fake-prisma style like the MX1 spec.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub));
    if (k === "AND") return (v as any[]).every((sub) => matches(row, sub));
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) { const ok = v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not; if (!ok) return false; }
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("gt" in v && !(row[k] > v.gt)) return false;
      if ("gte" in v && !(new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      if ("lte" in v && !(new Date(row[k]).getTime() <= new Date(v.lte).getTime())) return false;
      if ("lt" in v && !(new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if ("contains" in v && !String(row[k] ?? "").includes(v.contains)) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}

function sortRows(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  out.sort((a, b) => {
    for (const spec of specs) {
      for (const [key, dir] of Object.entries(spec)) {
        const av = a[key]; const bv = b[key];
        if (av === bv) continue;
        const cmp = (av as any) < (bv as any) ? -1 : 1;
        return dir === "desc" ? -cmp : cmp;
      }
    }
    return 0;
  });
  return out;
}

function project(row: any, select: any): any {
  if (!select) return row;
  const out: any = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
  return out;
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where, select, orderBy }: any = {}) => {
      const row = sortRows(rows.filter((r) => matches(r, where ?? {})), orderBy)[0] ?? null;
      return row ? project(row, select) : null;
    },
    findMany: async ({ where, take, orderBy, cursor, skip, select }: any = {}) => {
      let out = sortRows(rows.filter((r) => matches(r, where ?? {})), orderBy);
      if (cursor?.id) {
        const pos = out.findIndex((r) => r.id === cursor.id);
        if (pos >= 0) out = out.slice(pos + (skip ?? 0));
      } else if (skip) {
        out = out.slice(skip);
      }
      if (take) out = out.slice(0, take);
      return out.map((r) => project(r, select));
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) { Object.assign(row, data); row.updatedAt = new Date(); }
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let n = 0;
      for (const row of rows) if (matches(row, where ?? {})) { Object.assign(row, data); row.updatedAt = new Date(); n++; }
      return { count: n };
    },
    deleteMany: async ({ where }: any) => {
      let n = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where ?? {})) { rows.splice(i, 1); n++; }
      return { count: n };
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => r.id === where.id);
      if (i >= 0) rows.splice(i, 1);
      return {};
    },
  };
}

function makeRecipientTable() {
  const table: any = makeTable("bcr");
  table.createMany = async ({ data, skipDuplicates }: any) => {
    let count = 0;
    for (const d of data) {
      const dupe = table.rows.some((r: any) => r.broadcastId === d.broadcastId && r.dedupeKey === d.dedupeKey);
      if (dupe) {
        if (skipDuplicates) continue;
        throw new Error("Unique constraint failed on the fields: (`broadcastId`,`dedupeKey`)");
      }
      table.rows.push({ id: `bcr-${table.rows.length + 1}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date(), updatedAt: new Date(), ...d });
      count++;
    }
    return { count };
  };
  return table;
}

function makeDiscountTable() {
  const table: any = makeTable("disc");
  const baseCreate = table.create;
  table.failCreate = false;
  table.create = async (args: any) => {
    if (table.failCreate) throw new Error("db down");
    const dupe = table.rows.some((r: any) => r.organizationId === args.data.organizationId && r.code === args.data.code);
    if (dupe) throw new Error("Unique constraint failed on the fields: (`organizationId`,`code`) (P2002)");
    return baseCreate(args);
  };
  return table;
}

function makeOrderTable() {
  const table: any = makeTable("ord");
  table.groupBy = async ({ by, where }: any) => {
    const rows = table.rows.filter((r: any) => matches(r, where ?? {}));
    const groups = new Map<string, any[]>();
    for (const r of rows) {
      const key = by.map((f: string) => String(r[f])).join("|");
      const arr = groups.get(key) ?? [];
      arr.push(r);
      groups.set(key, arr);
    }
    return [...groups.values()].map((arr) => {
      const out: any = { _count: { _all: arr.length }, _sum: { totalMinor: arr.reduce((s, r) => s + BigInt(r.totalMinor ?? 0), 0n) }, _max: {} };
      for (const f of by) out[f] = arr[0][f];
      const placed = arr.map((r) => r.placedAt).filter(Boolean);
      out._max.placedAt = placed.length ? new Date(Math.max(...placed.map((d: any) => new Date(d).getTime()))) : null;
      out._max.createdAt = new Date(Math.max(...arr.map((r) => new Date(r.createdAt).getTime())));
      return out;
    });
  };
  return table;
}

const DAY = 86400_000;
const NOW = Date.now();
const CUSTOMERS = [
  { id: "c1", organizationId: "org-1", firstName: "Ayesha", lastName: null, email: "c1@example.com", phone: "01710000001", source: "woocommerce", createdAt: new Date(NOW - 90 * DAY), loyaltyBalanceCache: 250, tags: null, customFields: null, address: null },
  { id: "c2", organizationId: "org-1", firstName: "Bilal", lastName: null, email: "c2@example.com", phone: "01710000002", source: "woocommerce", createdAt: new Date(NOW - 90 * DAY), loyaltyBalanceCache: 0, tags: null, customFields: null, address: null },
  { id: "c3", organizationId: "org-1", firstName: "Chitra", lastName: null, email: "c3@example.com", phone: "01710000003", source: "woocommerce", createdAt: new Date(NOW - 90 * DAY), loyaltyBalanceCache: 0, tags: null, customFields: null, address: null },
];
const PRODUCTS = [
  { id: "p1", organizationId: "org-1", name: "Runner", priceMinor: 100000n, currency: "BDT", category: "shoes", slug: "runner", status: "ACTIVE", stockQuantity: 5, imageUrl: null, createdAt: new Date("2026-01-01") },
  { id: "p2", organizationId: "org-1", name: "Tee", priceMinor: 50000n, currency: "BDT", category: "shirts", slug: "tee", status: "ACTIVE", stockQuantity: 5, imageUrl: null, createdAt: new Date("2026-01-02") },
  { id: "p3", organizationId: "org-1", name: "Polo", priceMinor: 60000n, currency: "BDT", category: "shirts", slug: "polo", status: "ACTIVE", stockQuantity: 5, imageUrl: null, createdAt: new Date("2026-01-03") },
  { id: "p4", organizationId: "org-1", name: "Runner Pro", priceMinor: 120000n, currency: "BDT", category: "shoes", slug: "runner-pro", status: "ACTIVE", stockQuantity: 3, imageUrl: null, createdAt: new Date("2026-01-04") },
  { id: "p5", organizationId: "org-1", name: "Runner Zero", priceMinor: 90000n, currency: "BDT", category: "shoes", slug: "runner-zero", status: "ACTIVE", stockQuantity: 0, imageUrl: null, createdAt: new Date("2026-01-05") },
];

function build(opts?: { withRecipientTable?: boolean; failFor?: Set<string>; loyaltyEnabled?: boolean }) {
  const tables: any = {
    messageTemplate: makeTable("tpl"), broadcast: makeTable("bc"), messageDelivery: makeTable("dlv"),
    customer: makeTable("cust"), lead: makeTable("lead"), whatsAppTemplate: makeTable("wa"),
    messagePreference: makeTable("pref"), messagingSetting: makeTable("mset"),
    messagingSavedAudience: makeTable("aud"),
    order: makeOrderTable(), orderItem: makeTable("oi"), product: makeTable("prod"),
    storeDiscount: makeDiscountTable(), loyaltySetting: makeTable("loy"), giftCard: makeTable("gc"),
    visitor: makeTable("vis"), trackingEvent: makeTable("tev"),
  };
  if (opts?.withRecipientTable !== false) tables.broadcastRecipient = makeRecipientTable();
  for (const c of CUSTOMERS) tables.customer.rows.push({ ...c });
  for (const p of PRODUCTS) tables.product.rows.push({ ...p });
  // c1 bought p1 (recent, shoes) and p2 (older, shirts).
  tables.order.rows.push(
    { id: "o1", organizationId: "org-1", customerId: "c1", status: "completed", totalMinor: 100000n, externalNumber: "1001", placedAt: new Date(NOW - 1 * DAY), createdAt: new Date(NOW - 1 * DAY) },
    { id: "o2", organizationId: "org-1", customerId: "c1", status: "completed", totalMinor: 50000n, externalNumber: "1000", placedAt: new Date(NOW - 10 * DAY), createdAt: new Date(NOW - 10 * DAY) },
  );
  tables.orderItem.rows.push(
    { id: "oi1", orderId: "o1", productId: "p1" },
    { id: "oi2", orderId: "o2", productId: "p2" },
  );
  // c2 is an identified visitor who viewed p3 (shirts).
  tables.visitor.rows.push({ id: "v1", organizationId: "org-1", email: "c2@example.com", phone: null });
  tables.trackingEvent.rows.push({
    id: "te1", organizationId: "org-1", visitorId: "v1", type: "product_view",
    properties: { productId: "p3", name: "Polo" }, occurredAt: new Date(NOW - 2 * DAY),
  });
  tables.loyaltySetting.rows.push({ id: "loy-1", organizationId: "org-1", enabled: opts?.loyaltyEnabled !== false });
  // Gift cards: one addressed to c2's email; one self-bought by c1.
  tables.giftCard.rows.push(
    { id: "gc1", organizationId: "org-1", status: "active", balanceCache: 50000n, buyerCustomerId: "c9", recipientEmail: "c2@example.com", recipientPhone: null, expiresAt: null },
    { id: "gc2", organizationId: "org-1", status: "active", balanceCache: 20000n, buyerCustomerId: "c1", recipientEmail: null, recipientPhone: null, expiresAt: null },
    // Bought BY c1 but addressed to someone else — must NOT count for c1.
    { id: "gc3", organizationId: "org-1", status: "active", balanceCache: 99900n, buyerCustomerId: "c1", recipientEmail: "other@example.com", recipientPhone: null, expiresAt: null },
    // Expired — must not count for c2.
    { id: "gc4", organizationId: "org-1", status: "active", balanceCache: 77700n, buyerCustomerId: null, recipientEmail: "c2@example.com", recipientPhone: null, expiresAt: new Date(NOW - DAY) },
  );
  tables.systemSetting = {
    findUnique: async ({ where }: any) => null,
  };
  tables.organization = {
    findUnique: async () => ({ name: "Org", aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null, timezone: "Asia/Dhaka" }),
  };
  const calls: { to: string; subject: string; text: string; html?: string }[] = [];
  const email = {
    isConfigured: () => true,
    send: async ({ to, subject, text, html }: any) => {
      calls.push({ to, subject, text, html });
      if (opts?.failFor?.has(to)) throw new Error("SMTP rejected recipient");
      return { providerMessageId: `<id-${to}>` };
    },
  } as any;
  const sms = { isConfigured: () => false, send: async () => { throw new Error("SMS is not configured"); } } as any;
  const svc = new MessagingService(tables as any, { log: async () => undefined } as any, email, sms);
  return { svc, tables, calls };
}

const PERSONALIZATION = {
  uniqueCoupon: { kind: "percent", value: 10, expiryDays: 7, prefix: "EID" },
  recommendations: { enabled: true, limit: 3, heading: "আপনার জন্য বাছাই", fallbackText: "সাধারণ কালেকশন দেখুন" },
  segmentBlocks: [
    { definition: { entity: "customers", match: "all", conditions: [{ field: "orders_count", op: "gte", value: 1 }] }, body: "VIP সদস্যদের জন্য বিশেষ বার্তা" },
  ],
};

async function personalizedBroadcast(svc: MessagingService, extra?: Record<string, unknown>) {
  return svc.createBroadcast("org-1", "owner", {
    name: "Eid personalized", channel: "email",
    subject: "অফার {{name}} — কোড {{uniqueCouponCode}}",
    body: "Hello {{name}}\nPoints: {{loyaltyPoints}}\nGift: {{giftCardBalance}}",
    htmlBody: "<p>Hello {{name}}</p>",
    audienceType: "customers",
    personalization: PERSONALIZATION,
    ...(extra ?? {}),
  });
}

const callTo = (calls: any[], email: string) => calls.filter((c) => c.to === email);
const recipientRow = (tables: any, bcId: string, cid: string) =>
  tables.broadcastRecipient.rows.find((r: any) => r.broadcastId === bcId && r.recipientId === cid);

describe("MX8 create-time validation", () => {
  it("refuses a bad coupon config, WhatsApp personalization, cascade combination and a missing saved audience", async () => {
    const { svc } = build();
    await expect(svc.createBroadcast("org-1", "owner", {
      name: "x", channel: "email", subject: "s", body: "b", audienceType: "customers",
      personalization: { uniqueCoupon: { kind: "percent", value: 95 } },
    })).rejects.toThrow(/1\.\.90/);
    await expect(svc.createBroadcast("org-1", "owner", {
      name: "x", channel: "whatsapp", whatsappTemplateId: "wa1", audienceType: "customers",
      personalization: { uniqueCoupon: { kind: "percent", value: 10 } },
    })).rejects.toMatchObject({ code: "messaging.personalizationIsNotAvailableForWhatsApp" });
    await expect(svc.createBroadcast("org-1", "owner", {
      name: "x", channel: "email", subject: "s", body: "b", audienceType: "customers",
      cascade: { enabled: true, channels: ["email", "sms"] },
      personalization: { uniqueCoupon: { kind: "percent", value: 10 } },
    })).rejects.toMatchObject({ code: "messaging.personalizationCannotBeCombinedWithA" });
    await expect(svc.createBroadcast("org-1", "owner", {
      name: "x", channel: "email", subject: "s", body: "b", audienceType: "customers",
      personalization: { segmentBlocks: [{ savedAudienceId: "missing", body: "hi" }] },
    })).rejects.toMatchObject({ code: "messaging.segmentBlockSavedAudienceNotFound" });
  });

  it("stores the validated config on the broadcast row", async () => {
    const { svc, tables } = build();
    const bc = await personalizedBroadcast(svc);
    expect(tables.broadcast.rows[0].personalizationConfig).toMatchObject({
      uniqueCoupon: { kind: "percent", value: 10, expiryDays: 7, prefix: "EID" },
    });
    expect(bc.personalizationConfig.segmentBlocks).toHaveLength(1);
  });
});

describe("MX8 send — unique coupons, recommendations, balances, segment blocks", () => {
  it("issues one real StoreDiscount per recipient; every message carries only its own code", async () => {
    const { svc, tables, calls } = build();
    const bc = await personalizedBroadcast(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    const result = await svc.processBroadcast("org-1", bc.id);
    expect(result).toMatchObject({ finalized: true, sent: 3 });

    const discounts = tables.storeDiscount.rows;
    expect(discounts).toHaveLength(3);
    const codes = new Set(discounts.map((d: any) => d.code));
    expect(codes.size).toBe(3);
    for (const d of discounts) {
      expect(d).toMatchObject({ kind: "percent", value: 10, usageLimit: 1, perCustomerLimit: 1, usedCount: 0, active: true, origin: "messaging_unique" });
      expect(d.code).toMatch(/^EID-[0-9A-F]{10}$/);
      expect(d.sourceRef.startsWith(`${bc.id}:customer:`)).toBe(true);
      expect(new Date(d.endsAt).getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
    }
    // Each recipient's message carries THEIR code (here via the
    // subject's {{uniqueCouponCode}}) and no one else's.
    for (const c of CUSTOMERS) {
      const mine = discounts.find((d: any) => d.sourceRef === `${bc.id}:customer:${c.id}`);
      const call = callTo(calls, c.email)[0];
      expect(call.subject).toContain(mine.code);
      for (const other of discounts) {
        if (other.id !== mine.id) {
          expect(call.text).not.toContain(other.code);
          expect(call.subject).not.toContain(other.code);
        }
      }
      // The issued code is the one persisted on the recipient row.
      expect(recipientRow(tables, bc.id, c.id).personalization.couponCode).toBe(mine.code);
    }
  });

  it("appends the standard coupon line when the org never referenced {{uniqueCouponCode}}", async () => {
    const { svc, tables, calls } = build();
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "no var", channel: "email", subject: "ঈদের অফার", body: "Hello {{name}}",
      htmlBody: "<p>Hello {{name}}</p>", audienceType: "customers",
      personalization: { uniqueCoupon: { kind: "percent", value: 15, prefix: "EID" } },
    });
    await svc.prepareBroadcast("org-1", bc.id);
    await svc.processBroadcast("org-1", bc.id);
    const mine = tables.storeDiscount.rows.find((d: any) => d.sourceRef === `${bc.id}:customer:c1`);
    const call = callTo(calls, "c1@example.com")[0];
    expect(call.text).toContain(`কুপন কোড: ${mine.code} — 15% ছাড়`);
    expect(call.html).toContain(mine.code);
    expect(call.subject).toBe("ঈদের অফার");
  });

  it("renders recommendation blocks from real data only (purchase → browsing → honest fallback)", async () => {
    const { svc, tables, calls } = build();
    const bc = await personalizedBroadcast(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    await svc.processBroadcast("org-1", bc.id);

    const c1 = callTo(calls, "c1@example.com")[0];
    // Most recent purchase category = shoes; Runner Pro is the
    // only in-stock, not-yet-bought shoe. Runner Zero is out of
    // stock; Runner/Tee were already bought.
    expect(c1.text).toContain("Runner Pro — ৳1,200.00");
    expect(c1.text).not.toContain("Runner Zero");
    expect(c1.text).not.toContain("সাধারণ কালেকশন");
    expect(recipientRow(tables, bc.id, "c1").personalization.recommendationSignal).toBe("purchase_category");

    const c2 = callTo(calls, "c2@example.com")[0];
    // No orders; identified browsing viewed Polo (shirts).
    expect(c2.text).toContain("Polo — ৳600.00");
    expect(c2.text).toContain("Tee — ৳500.00");
    expect(recipientRow(tables, bc.id, "c2").personalization.recommendationSignal).toBe("browsing_category");

    const c3 = callTo(calls, "c3@example.com")[0];
    // No data at all → ONLY the org-authored fallback, no product.
    expect(c3.text).toContain("সাধারণ কালেকশন দেখুন");
    expect(c3.text).not.toContain("Runner");
    expect(c3.text).not.toContain("Polo");
    expect(recipientRow(tables, bc.id, "c3").personalization.recommendationSignal).toBe("none");
  });

  it("renders loyalty + gift-card balances from the real ledgers; segment block only for members", async () => {
    const { svc, tables, calls } = build();
    const bc = await personalizedBroadcast(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    await svc.processBroadcast("org-1", bc.id);

    const c1 = callTo(calls, "c1@example.com")[0];
    expect(c1.text).toContain("Points: 250");
    // Self-bought unaddressed card only (200.00); the card c1
    // bought for someone else (999.00) is NOT c1's balance.
    expect(c1.text).toContain("Gift: 200.00");
    expect(c1.text).toContain("VIP সদস্যদের জন্য বিশেষ বার্তা");

    const c2 = callTo(calls, "c2@example.com")[0];
    expect(c2.text).toContain("Points: 0");
    // Addressed card 500.00; the expired 777.00 card is excluded.
    expect(c2.text).toContain("Gift: 500.00");
    expect(c2.text).not.toContain("VIP সদস্যদের");

    const c3 = callTo(calls, "c3@example.com")[0];
    expect(c3.text).toContain("Points: 0");
    expect(c3.text).toContain("Gift: 0.00");
    expect(c3.text).not.toContain("VIP সদস্যদের");
  });

  it("with the loyalty program disabled, loyaltyPoints renders EMPTY (no invented balance) while gift still renders", async () => {
    const { svc, calls } = build({ loyaltyEnabled: false });
    const bc = await personalizedBroadcast(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    await svc.processBroadcast("org-1", bc.id);
    const c1 = callTo(calls, "c1@example.com")[0];
    expect(c1.text).toContain("Points: \n");
    expect(c1.text).toContain("Gift: 200.00");
  });

  it("a broadcast without personalization sends byte-identical content (pre-MX8 behaviour)", async () => {
    const { svc, tables, calls } = build();
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "plain", channel: "email", subject: "Hi {{name}}", body: "Hello {{name}}", audienceType: "customers",
    });
    await svc.prepareBroadcast("org-1", bc.id);
    await svc.processBroadcast("org-1", bc.id);
    expect(callTo(calls, "c1@example.com")[0].text).toBe("Hello Ayesha");
    expect(tables.storeDiscount.rows).toHaveLength(0);
  });
});

describe("MX8 resume / retry idempotency — never a second coupon", () => {
  it("partial processing + resume: sent recipients are never re-sent and keep their one coupon", async () => {
    const { svc, tables, calls } = build();
    const bc = await personalizedBroadcast(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    const partial = await svc.processBroadcast("org-1", bc.id, { maxEntries: 1 });
    expect(partial.sent).toBe(1);
    expect(tables.storeDiscount.rows).toHaveLength(1);
    const firstCode = tables.storeDiscount.rows[0].code;

    const done = await svc.processBroadcast("org-1", bc.id);
    expect(done).toMatchObject({ finalized: true, sent: 3 });
    expect(tables.storeDiscount.rows).toHaveLength(3);
    // The first recipient was emailed exactly once, with the
    // first (and only) code issued for them.
    expect(callTo(calls, "c1@example.com")).toHaveLength(1);
    expect(callTo(calls, "c1@example.com")[0].subject).toContain(firstCode);
    expect(recipientRow(tables, bc.id, "c1").personalization.couponCode).toBe(firstCode);
  });

  it("retry-failed re-sends with the SAME code — the persisted state is reused, no new StoreDiscount row", async () => {
    const failFor = new Set(["c2@example.com"]);
    const { svc, tables, calls } = build({ failFor });
    const bc = await personalizedBroadcast(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    const first = await svc.processBroadcast("org-1", bc.id);
    expect(first).toMatchObject({ sent: 2, failed: 1 });
    expect(tables.storeDiscount.rows).toHaveLength(3);
    const c2Discount = tables.storeDiscount.rows.find((d: any) => d.sourceRef === `${bc.id}:customer:c2`);
    // The failed attempt never reached the provider, so no call
    // was recorded for c2 — but the coupon WAS issued and saved.
    expect(recipientRow(tables, bc.id, "c2").personalization.couponCode).toBe(c2Discount.code);

    failFor.delete("c2@example.com");
    const retried: any = await svc.retryFailedBroadcast("org-1", "owner", bc.id);
    expect(retried.status ?? retried.progress?.sent).toBeDefined();
    expect(tables.storeDiscount.rows).toHaveLength(3);
    // The fake provider records every ATTEMPT: the failed first
    // attempt and the successful retry — both rendered with the
    // SAME persisted code.
    const c2Calls = callTo(calls, "c2@example.com");
    expect(c2Calls).toHaveLength(2);
    for (const call of c2Calls) expect(call.subject).toContain(c2Discount.code);
  });

  it("crash-window: a coupon created but never persisted is recovered via the sourceRef claim, not re-issued", async () => {
    const { svc, tables, calls } = build();
    const bc = await personalizedBroadcast(svc);
    // Simulate: issuance succeeded for c3, the process died
    // before the state persist landed.
    tables.storeDiscount.rows.push({
      id: "disc-pre", organizationId: "org-1", code: "EID-PREEXIST1", kind: "percent", value: 10,
      usageLimit: 1, perCustomerLimit: 1, usedCount: 0, active: true,
      origin: "messaging_unique", sourceRef: `${bc.id}:customer:c3`, endsAt: new Date(Date.now() + 7 * DAY),
      createdAt: new Date(), updatedAt: new Date(),
    });
    await svc.prepareBroadcast("org-1", bc.id);
    await svc.processBroadcast("org-1", bc.id);
    const forC3 = tables.storeDiscount.rows.filter((d: any) => d.sourceRef === `${bc.id}:customer:c3`);
    expect(forC3).toHaveLength(1);
    expect(callTo(calls, "c3@example.com")[0].subject).toContain("EID-PREEXIST1");
    expect(tables.storeDiscount.rows).toHaveLength(3);
  });

  it("issuance failure is recorded per recipient and the send carries NO code (never a fake/shared one)", async () => {
    const { svc, tables, calls } = build();
    const bc = await personalizedBroadcast(svc);
    tables.storeDiscount.failCreate = true;
    await svc.prepareBroadcast("org-1", bc.id);
    const result = await svc.processBroadcast("org-1", bc.id);
    expect(result).toMatchObject({ finalized: true, sent: 3 });
    expect(tables.storeDiscount.rows).toHaveLength(0);
    for (const c of CUSTOMERS) {
      const call = callTo(calls, c.email)[0];
      expect(call.subject).not.toMatch(/EID-[0-9A-F]{10}/);
      expect(call.text).not.toContain("কুপন কোড:");
      const state = recipientRow(tables, bc.id, c.id).personalization;
      expect(state.couponError).toContain("db down");
      expect(state.couponCode).toBeUndefined();
    }
    // The rest of the personalization still applied honestly.
    expect(callTo(calls, "c1@example.com")[0].text).toContain("Runner Pro");
  });
});

describe("MX8 legacy snapshot path", () => {
  it("personalizes snapshot broadcasts too, with the state riding inside the snapshot entry", async () => {
    const { svc, tables, calls } = build({ withRecipientTable: false });
    const bc = await personalizedBroadcast(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    const snapshot = tables.broadcast.rows[0].recipientSnapshot;
    expect(Array.isArray(snapshot)).toBe(true);
    const result = await svc.processBroadcast("org-1", bc.id);
    expect(result).toMatchObject({ finalized: true, sent: 3 });
    expect(tables.storeDiscount.rows).toHaveLength(3);
    const codes = new Set(tables.storeDiscount.rows.map((d: any) => d.code));
    expect(codes.size).toBe(3);
    const finalSnapshot = tables.broadcast.rows[0].recipientSnapshot;
    for (const entry of finalSnapshot) {
      expect(entry.personalization?.couponCode).toBeDefined();
      expect(codes.has(entry.personalization.couponCode)).toBe(true);
    }
    expect(callTo(calls, "c1@example.com")[0].text).toContain("Runner Pro — ৳1,200.00");
  });
});

describe("MX8 variables catalogue pin", () => {
  it("the MS5 catalogue stays EXACTLY as pinned — MX8 vars fill + render but are not listed (pin respected, see acceptance)", () => {
    const { svc } = build();
    const vars = svc.getTemplateVariables();
    // UNION regeneration (2026-10-17): SA-B20 (G2) deliberately
    // extended the catalogue with its memory variables (documented
    // in variables.ts) — they are listed by G2's own design. This
    // pin's actual subject is unchanged: MX8's OWN variables
    // (loyaltyPoints, giftCardBalance, uniqueCouponCode) are still
    // NOT listed — they fill + render only.
    expect(vars.customer.map((v: any) => v.key)).toEqual([
      "name", "firstName", "lastName", "email", "phone", "lastOrderNumber", "lastOrderTotal", "ordersCount",
      "lastProductName", "lastCategory", "favoriteCategory", "languagePref", "aiHook",
    ]);
    expect(vars.lead.map((v: any) => v.key)).toEqual([
      "name", "email", "phone", "stage", "source", "value",
      "lastProductName", "lastCategory", "favoriteCategory", "languagePref",
    ]);
    // …while the vars themselves ARE built at prepare (proven by
    // the balance assertions in the send tests above: the texts
    // render "Points: 250" / "Gift: 200.00" from real rows).
  });
});
