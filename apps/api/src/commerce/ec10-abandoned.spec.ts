import { parseShopifyCheckout, upsertAbandonedStoreCheckout } from "../integrations/shopify/shopify-checkouts";
import { checkTrackerOnHomepage, detectTracker } from "../integrations/commerce/tracker-check";
import { AbandonedCheckoutsService, STORE_CHECKOUT_RECOVERY_ACTION } from "./abandoned-checkouts.service";

/* Fake prisma: matcher supports equality, { in: [...] },
 * { not: v } and { gte: Date } (the last is used by
 * findRecoveryOrder for placedAt). */
function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const cond: any = v;
      if ("in" in cond) {
        if (!cond.in.includes(row[k])) return false;
        continue;
      }
      if ("not" in cond) {
        if (row[k] === cond.not) return false;
        continue;
      }
      if ("gte" in cond) {
        if (row[k] === null || row[k] === undefined) return false;
        if (new Date(row[k]).getTime() < new Date(cond.gte).getTime()) return false;
        continue;
      }
      // nested object conditions are not used by EC10 code paths
      if (!matchWhere(row, cond)) return false;
    } else if (v === null) {
      if (row[k] !== null && row[k] !== undefined) return false;
    } else if (row[k] !== v) {
      return false;
    }
  }
  return true;
}

function applyOrderBy(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  for (const spec of specs.reverse()) {
    for (const [field, dir] of Object.entries(spec)) {
      out.sort((a: any, b: any) => {
        const av = a[field];
        const bv = b[field];
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const cmp = new Date(av).getTime() !== new Date(av).getTime() || av instanceof Date || bv instanceof Date
          ? new Date(av).getTime() - new Date(bv).getTime()
          : av < bv ? -1 : 1;
        return dir === "desc" ? -cmp : cmp;
      });
    }
  }
  return out;
}

function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where, orderBy }: any = {}) => {
      const found = applyOrderBy(rows.filter((r) => matchWhere(r, where)), orderBy);
      return found[0] ?? null;
    },
    findMany: async ({ where, orderBy, take, skip }: any = {}) => {
      let found = applyOrderBy(rows.filter((r) => matchWhere(r, where)), orderBy);
      if (skip) found = found.slice(skip);
      if (take !== undefined) found = found.slice(0, take);
      return found;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
    upsert: async ({ where, update, create }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (row) {
        Object.assign(row, update);
        return row;
      }
      const created = { id: create.id ?? `row-${++seq}`, createdAt: new Date(), ...create };
      rows.push(created);
      return created;
    },
  };
}

function makePrisma() {
  return {
    abandonedStoreCheckout: makeTable(),
    store: makeTable(),
    customer: makeTable(),
    order: makeTable(),
    auditLog: makeTable(),
    channelConversation: makeTable(),
    integration: makeTable(),
    integrationCredential: makeTable(),
  } as any;
}

const shopifyPayload = (overrides: Record<string, any> = {}) => ({
  id: 987654,
  email: "buyer@example.com",
  phone: null,
  shipping_address: { phone: "+8801700000000" },
  billing_address: { phone: "+8801800000000" },
  line_items: [
    { title: "Cotton T-Shirt", quantity: 2, price: "250.25" },
    { name: "Cap", price: "100" },
  ],
  total_price: "1250.50",
  currency: "BDT",
  abandoned_checkout_url: "https://shop.example.com/checkouts/abc",
  created_at: "2026-10-12T10:00:00.000Z",
  ...overrides,
});

describe("EC10 parseShopifyCheckout", () => {
  it("parses money, items and phone fallbacks", () => {
    const parsed = parseShopifyCheckout(shopifyPayload());
    expect(parsed.externalCheckoutId).toBe("987654");
    expect(parsed.email).toBe("buyer@example.com");
    // phone falls back to shipping_address before billing_address
    expect(parsed.phone).toBe("+8801700000000");
    expect(parsed.totalMinor).toBe(125050n);
    expect(parsed.currency).toBe("BDT");
    expect(parsed.checkoutUrl).toBe("https://shop.example.com/checkouts/abc");
    expect(parsed.abandonedAt.toISOString()).toBe("2026-10-12T10:00:00.000Z");
    expect(parsed.items).toEqual([
      { name: "Cotton T-Shirt", quantity: 2, priceMinor: 25025 },
      { name: "Cap", quantity: 1, priceMinor: 10000 },
    ]);
  });

  it("prefers a direct phone and defaults currency", () => {
    const parsed = parseShopifyCheckout(shopifyPayload({ phone: "+8801900000000", currency: undefined }));
    expect(parsed.phone).toBe("+8801900000000");
    expect(parsed.currency).toBe("BDT");
  });
});

describe("EC10 upsertAbandonedStoreCheckout", () => {
  it("creates then updates, deduped on [storeId, externalCheckoutId], status untouched", async () => {
    const prisma = makePrisma();
    const first = await upsertAbandonedStoreCheckout(prisma, {
      organizationId: "org-1",
      storeId: "st-1",
      payload: shopifyPayload(),
    });
    expect(first).toBe("created");
    expect(prisma.abandonedStoreCheckout.rows).toHaveLength(1);
    expect(prisma.abandonedStoreCheckout.rows[0].status).toBe("open");

    // Simulate a lifecycle move before the same checkout is seen again.
    prisma.abandonedStoreCheckout.rows[0].status = "expired";

    const second = await upsertAbandonedStoreCheckout(prisma, {
      organizationId: "org-1",
      storeId: "st-1",
      payload: shopifyPayload({ total_price: "2000.00", email: "new@example.com" }),
    });
    expect(second).toBe("updated");
    expect(prisma.abandonedStoreCheckout.rows).toHaveLength(1);
    expect(prisma.abandonedStoreCheckout.rows[0].totalMinor).toBe(200000n);
    expect(prisma.abandonedStoreCheckout.rows[0].email).toBe("new@example.com");
    expect(prisma.abandonedStoreCheckout.rows[0].status).toBe("expired");
  });
});

describe("EC10 tracker detection", () => {
  it("detectTracker requires both tracker.js and the key", () => {
    const html = `<script src="https://cdn.example.com/tracker.js" data-key="key-123"></script>`;
    expect(detectTracker(html, "key-123")).toBe(true);
    expect(detectTracker(html, "key-other")).toBe(false);
    expect(detectTracker(`<script data-key="key-123"></script>`, "key-123")).toBe(false);
  });

  it("checkTrackerOnHomepage: found → pass", async () => {
    const fetchFn: any = async () => ({
      ok: true,
      status: 200,
      text: async () => `<script src="/tracker.js" data-key="key-123"></script>`,
    });
    await expect(checkTrackerOnHomepage("https://shop.example.com", "key-123", fetchFn)).resolves.toMatchObject({ status: "pass" });
  });

  it("checkTrackerOnHomepage: not found → fail", async () => {
    const fetchFn: any = async () => ({
      ok: true,
      status: 200,
      text: async () => `<html><body>no tracker here</body></html>`,
    });
    await expect(checkTrackerOnHomepage("https://shop.example.com", "key-123", fetchFn)).resolves.toMatchObject({ status: "fail" });
  });

  it("checkTrackerOnHomepage: fetch throws → unknown", async () => {
    const fetchFn: any = async () => {
      throw new Error("network down");
    };
    const res = await checkTrackerOnHomepage("https://shop.example.com", "key-123", fetchFn);
    expect(res.status).toBe("unknown");
    expect(res.evidence).toContain("network down");
  });

  it("checkTrackerOnHomepage: HTTP 500 → unknown", async () => {
    const fetchFn: any = async () => ({
      ok: false,
      status: 500,
      text: async () => "server error",
    });
    const res = await checkTrackerOnHomepage("https://shop.example.com", "key-123", fetchFn);
    expect(res.status).toBe("unknown");
    expect(res.evidence).toContain("500");
  });

  it("checkTrackerOnHomepage: no trackingKey → unknown", async () => {
    const res = await checkTrackerOnHomepage("https://shop.example.com", null, (async () => {
      throw new Error("must not be called");
    }) as any);
    expect(res.status).toBe("unknown");
  });
});

describe("EC10 listUnified", () => {
  it("merges tracker + store rows sorted by value desc and marks recovered orders", async () => {
    const prisma = makePrisma();
    prisma.store.rows.push({ id: "st-shop", organizationId: "org-1", name: "Shopify Shop", url: "https://shop.example.com" });
    prisma.abandonedStoreCheckout.rows.push(
      {
        id: "chk-1", organizationId: "org-1", storeId: "st-shop", externalCheckoutId: "ext-1",
        email: "a@example.com", phone: null, items: [{ name: "T-Shirt", quantity: 1, priceMinor: 50000 }],
        totalMinor: 50000n, currency: "BDT", checkoutUrl: "https://shop.example.com/checkouts/1",
        status: "open", abandonedAt: new Date("2026-10-12T10:00:00.000Z"), recoveredOrderId: null,
        createdAt: new Date(), updatedAt: new Date(),
      },
      {
        id: "chk-2", organizationId: "org-1", storeId: "st-shop", externalCheckoutId: "ext-2",
        email: "b@example.com", phone: null, items: [],
        totalMinor: 10000n, currency: "BDT", checkoutUrl: null,
        status: "open", abandonedAt: new Date("2026-10-12T11:00:00.000Z"), recoveredOrderId: null,
        createdAt: new Date(), updatedAt: new Date(),
      },
    );
    prisma.customer.rows.push({ id: "cust-1", organizationId: "org-1", email: "a@example.com", phone: null });
    // Cancelled orders must not count; the real order is after the abandon.
    prisma.order.rows.push(
      {
        id: "ord-cancelled", organizationId: "org-1", customerId: "cust-1", status: "cancelled",
        placedAt: new Date("2026-10-12T12:00:00.000Z"), createdAt: new Date("2026-10-12T12:00:00.000Z"),
      },
      {
        id: "ord-1", organizationId: "org-1", customerId: "cust-1", status: "processing",
        placedAt: new Date("2026-10-12T13:00:00.000Z"), createdAt: new Date("2026-10-12T13:00:00.000Z"),
      },
      {
        id: "ord-before", organizationId: "org-1", customerId: "cust-1", status: "processing",
        placedAt: new Date("2026-10-11T09:00:00.000Z"), createdAt: new Date("2026-10-11T09:00:00.000Z"),
      },
    );

    const trackerCarts: any = {
      list: async () => ({
        generatedAt: new Date().toISOString(),
        carts: [
          {
            visitorId: "vis-1", storeId: "st-woo", storeName: "Woo Shop", storeUrl: "https://woo.example.com",
            items: [{ name: "Mug", quantity: 1 }], valueMinor: 30000,
            lastActivityAt: "2026-10-12T09:00:00.000Z",
            contact: { email: "t@example.com", phone: null }, recoverySentAt: null,
          },
        ],
      }),
    };

    const service = new AbandonedCheckoutsService(prisma, undefined, undefined, undefined, trackerCarts);
    const res = await service.listUnified("org-1");

    expect(res.items.map((i: any) => i.id)).toEqual(["chk-1", "vis-1", "chk-2"]);
    expect(res.items[0]).toMatchObject({ source: "shopify", recovered: true, recoveredOrderId: "ord-1", totalMinor: "50000" });
    expect(res.items[1]).toMatchObject({ source: "tracker", recovered: false, totalMinor: "30000", email: "t@example.com" });
    expect(res.items[2]).toMatchObject({ source: "shopify", recovered: false });
  });
});

function sendSetup(emailImpl: () => Promise<any>) {
  const prisma = makePrisma();
  prisma.store.rows.push({ id: "st-shop", organizationId: "org-1", name: "Shopify Shop", url: "https://shop.example.com" });
  prisma.abandonedStoreCheckout.rows.push({
    id: "chk-1", organizationId: "org-1", storeId: "st-shop", externalCheckoutId: "ext-1",
    email: "a@example.com", phone: null,
    items: [{ name: "T-Shirt", quantity: 1, priceMinor: 50000 }],
    totalMinor: 50000n, currency: "BDT", checkoutUrl: "https://shop.example.com/checkouts/1",
    status: "open", abandonedAt: new Date("2026-10-12T10:00:00.000Z"), recoveredOrderId: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
  const audit: any = {
    log: async (input: any) => {
      prisma.auditLog.rows.push({
        id: `audit-${prisma.auditLog.rows.length + 1}`,
        organizationId: input.organizationId,
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata,
        createdAt: new Date(),
      });
    },
  };
  const sent: any[] = [];
  const email: any = {
    send: async (input: any) => {
      sent.push(input);
      return emailImpl();
    },
  };
  const emitted: any[] = [];
  const events: any = {
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    on: () => undefined,
  };
  const service = new AbandonedCheckoutsService(prisma, audit, email, events, undefined);
  return { prisma, service, sent, emitted };
}

describe("EC10 sendStoreRecovery", () => {
  it("success → marker written + cart.abandoned event emitted; second call refuses", async () => {
    const { prisma, service, sent, emitted } = sendSetup(async () => ({ providerMessageId: "msg-1" }));

    const res = await service.sendStoreRecovery("org-1", "user-1", "chk-1");
    expect(res).toMatchObject({ sent: true, to: "a@example.com", providerMessageId: "msg-1", eventEmitted: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("Shopify Shop");
    expect(sent[0].text).toContain("https://shop.example.com/checkouts/1");

    const markers = prisma.auditLog.rows.filter((r: any) => r.action === STORE_CHECKOUT_RECOVERY_ACTION);
    expect(markers).toHaveLength(1);
    expect(markers[0].entityId).toBe("chk-1");

    expect(emitted).toHaveLength(1);
    expect(emitted[0].event).toBe("cart.abandoned");
    expect(emitted[0].payload).toMatchObject({ organizationId: "org-1" });
    expect(emitted[0].payload.context).toMatchObject({ source: "shopify", checkoutId: "chk-1", total: 500 });

    await expect(service.sendStoreRecovery("org-1", "user-1", "chk-1")).rejects.toThrow("ইতিমধ্যে পাঠানো হয়েছে");
    expect(sent).toHaveLength(1);
    expect(emitted).toHaveLength(1);
  });

  it("email send throws → BadRequest and NO marker / NO event", async () => {
    const { prisma, service, emitted } = sendSetup(async () => {
      throw new Error("SMTP down");
    });
    await expect(service.sendStoreRecovery("org-1", "user-1", "chk-1")).rejects.toThrow("ইমেইল পাঠানো যায়নি: SMTP down");
    expect(prisma.auditLog.rows.filter((r: any) => r.action === STORE_CHECKOUT_RECOVERY_ACTION)).toHaveLength(0);
    expect(emitted).toHaveLength(0);
  });

  it("checkout without email → BadRequest", async () => {
    const { prisma, service } = sendSetup(async () => ({ providerMessageId: "msg-1" }));
    prisma.abandonedStoreCheckout.rows[0].email = null;
    await expect(service.sendStoreRecovery("org-1", "user-1", "chk-1")).rejects.toThrow("কোনো ইমেইল ঠিকানা নেই");
  });

  it("foreign checkout id → NotFound", async () => {
    const { service } = sendSetup(async () => ({ providerMessageId: "msg-1" }));
    await expect(service.sendStoreRecovery("org-2", "user-1", "chk-1")).rejects.toThrow("not found");
  });

  it("generates WhatsApp recovery data with clean phone and discount message", async () => {
    const { prisma, service } = sendSetup(async () => ({ providerMessageId: "msg-1" }));
    prisma.abandonedStoreCheckout.rows[0].phone = "01711223344";
    const data = await service.getWhatsAppRecoveryData("org-1", "chk-1", "SAVE15");

    expect(data.phone).toBe("8801711223344");
    expect(data.discountCode).toBe("SAVE15");
    expect(data.waLink).toContain("https://wa.me/8801711223344");
    expect(data.messageText).toContain("SAVE15");
  });

  it("throws when checkout has no phone for WhatsApp recovery", async () => {
    const { prisma, service } = sendSetup(async () => ({ providerMessageId: "msg-1" }));
    prisma.abandonedStoreCheckout.rows[0].phone = null;
    await expect(service.getWhatsAppRecoveryData("org-1", "chk-1")).rejects.toThrow("কোনো ফোন নম্বর নেই");
  });
});
