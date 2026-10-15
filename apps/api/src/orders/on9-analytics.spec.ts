import "reflect-metadata";
import { OrderAnalyticsService, dhakaDayBounds, parseRange } from "./order-analytics.service";

/**
 * ON9 — Orders Analytics v2 + Owner Digest: Dhaka range
 * boundaries, the EC33 sold bucket + AOV, repeat rate, cancel
 * breakdown by source, courier scorecard (decided denominators,
 * transit/COD pair counts, null-when-no-pairs), product return
 * warning thresholds, digest figures, per-recipient send
 * isolation, the no-phone SMS skip, the audit row, and
 * cross-org isolation. Fake-Prisma house style.
 */

function matchWhere(row: any, where: any): boolean {
  for (const [key, cond] of Object.entries(where ?? {})) {
    const val = (row as any)[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c: any = cond;
      if ("in" in c && !c.in.map(String).includes(String(val))) return false;
      continue;
    }
    if (String(val) !== String(cond)) return false;
  }
  return true;
}

function makeTable(rows: any[]) {
  return {
    rows,
    findMany: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where))),
    findFirst: jest.fn(async ({ where }: any = {}) => rows.find((r) => matchWhere(r, where)) ?? null),
    findUnique: jest.fn(async ({ where }: any = {}) => rows.find((r) => matchWhere(r, where)) ?? null),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `row-${rows.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    }),
  };
}

const NOW = new Date("2026-10-14T06:00:00Z"); // 12:00 in Dhaka
const D = (iso: string) => new Date(iso);

function baseData() {
  const orders: any[] = [
    { id: "s1", organizationId: "org-1", customerId: "cust-a", status: "completed", source: "woocommerce", isPractice: false, totalMinor: 100000n, placedAt: D("2026-10-05T06:00:00Z"), createdAt: D("2026-10-05T06:00:00Z"), address: null },
    { id: "s2", organizationId: "org-1", customerId: "cust-a", status: "delivered", source: "manual", isPractice: false, totalMinor: 50000n, placedAt: D("2026-10-05T06:00:00Z"), createdAt: D("2026-10-05T06:00:00Z"), address: null },
    { id: "s3", organizationId: "org-1", customerId: "cust-b", status: "processing", source: "woocommerce", isPractice: false, totalMinor: 30000n, placedAt: D("2026-10-05T06:00:00Z"), createdAt: D("2026-10-05T06:00:00Z"), address: "House 1, Chattogram" },
    { id: "p1", organizationId: "org-1", customerId: "cust-b", status: "processing", source: "manual", isPractice: false, totalMinor: 99900n, placedAt: D("2026-10-05T06:00:00Z"), createdAt: D("2026-10-05T06:00:00Z"), address: null },
    { id: "c1", organizationId: "org-1", customerId: null, status: "cancelled", source: "facebook", isPractice: false, totalMinor: 10000n, placedAt: D("2026-10-05T06:00:00Z"), createdAt: D("2026-10-05T06:00:00Z"), address: null },
    { id: "c2", organizationId: "org-1", customerId: null, status: "cancelled", source: "woocommerce", isPractice: false, totalMinor: 10000n, placedAt: D("2026-10-05T06:00:00Z"), createdAt: D("2026-10-05T06:00:00Z"), address: null },
    { id: "r1", organizationId: "org-1", customerId: "cust-b", status: "delivered", source: "woocommerce", isPractice: false, totalMinor: 20000n, placedAt: D("2026-10-05T06:00:00Z"), createdAt: D("2026-10-05T06:00:00Z"), address: "Khulna" },
    { id: "o-pack", organizationId: "org-1", customerId: null, status: "processing", source: "manual", isPractice: false, totalMinor: 5000n, placedAt: D("2026-10-13T06:00:00Z"), createdAt: D("2026-10-13T06:00:00Z"), address: null },
    { id: "practice-1", organizationId: "org-1", customerId: "cust-a", status: "completed", source: "manual", isPractice: true, totalMinor: 777700n, placedAt: D("2026-10-05T06:00:00Z"), createdAt: D("2026-10-05T06:00:00Z"), address: null },
    { id: "other-org", organizationId: "org-2", customerId: "cust-z", status: "completed", source: "manual", isPractice: false, totalMinor: 555500n, placedAt: D("2026-10-05T06:00:00Z"), createdAt: D("2026-10-05T06:00:00Z"), address: null },
  ];
  const shipments: any[] = [
    { id: "sh1", organizationId: "org-1", orderId: "s3", provider: "steadfast", status: "delivered", createdAt: D("2026-10-05T06:00:00Z"), updatedAt: D("2026-10-07T06:00:00Z"), codCollectedAt: D("2026-10-09T06:00:00Z"), codCollectedMinor: 30000n },
    { id: "sh2", organizationId: "org-1", orderId: "p1", provider: "steadfast", status: "returned", createdAt: D("2026-10-05T06:00:00Z"), updatedAt: D("2026-10-08T06:00:00Z"), codCollectedAt: null },
    { id: "sh3", organizationId: "org-1", orderId: "o-pack", provider: "pathao", status: "in_transit", createdAt: D("2026-10-13T06:00:00Z"), updatedAt: D("2026-10-14T05:00:00Z"), codCollectedAt: null },
    { id: "sh4", organizationId: "org-1", orderId: "s1", provider: "pathao", status: "delivered", createdAt: D("2026-10-05T06:00:00Z"), updatedAt: D("2026-10-06T06:00:00Z"), codCollectedAt: null },
    // Booked BEFORE the range; idle 10 days at NOW → the stuck parcel.
    { id: "sh5", organizationId: "org-1", orderId: "p1", provider: "redx", status: "in_transit", createdAt: D("2026-09-01T06:00:00Z"), updatedAt: D("2026-10-04T06:00:00Z"), codCollectedAt: null },
  ];
  const customers: any[] = [
    { id: "cust-a", organizationId: "org-1", address: { district: "Dhaka" } },
    { id: "cust-b", organizationId: "org-1", address: null },
    { id: "cust-z", organizationId: "org-2", address: { district: "Sylhet" } },
  ];
  const fulfillments: any[] = [
    { id: "f-pack", organizationId: "org-1", orderId: "o-pack", status: "packed", createdAt: D("2026-10-14T00:00:00Z"), updatedAt: D("2026-10-14T00:00:00Z") },
  ];
  const returnRequests: any[] = [
    { id: "rr1", organizationId: "org-1", orderId: "r1", status: "received", items: [] },
    { id: "rr-open", organizationId: "org-1", orderId: "s1", status: "requested", items: [] },
  ];
  return { orders, shipments, customers, fulfillments, returnRequests };
}

function makeService(data: any, extra?: { email?: any; audits?: any[] }) {
  const audits: any[] = extra?.audits ?? [];
  const prisma: any = {
    order: makeTable(data.orders ?? []),
    courierShipment: makeTable(data.shipments ?? []),
    customer: makeTable(data.customers ?? []),
    fulfillment: makeTable(data.fulfillments ?? []),
    fulfillmentSetting: makeTable(data.settings ?? []),
    returnRequest: makeTable(data.returnRequests ?? []),
    orderItem: makeTable(data.orderItems ?? []),
    paymentVerification: makeTable(data.verifications ?? []),
    membership: makeTable(data.memberships ?? []),
    user: makeTable(data.users ?? []),
    organization: makeTable(data.organizations ?? [{ id: "org-1", name: "Test Shop" }]),
    auditLog: makeTable(audits),
    scheduledJob: makeTable(data.jobs ?? []),
  };
  const audit: any = { log: jest.fn(async (input: any) => { audits.push({ id: `audit-${audits.length + 1}`, createdAt: new Date(), ...input }); }) };
  const svc = new OrderAnalyticsService(prisma, audit, extra?.email, undefined);
  return { svc, prisma, audits, audit };
}

describe("ON9 Dhaka range bounds", () => {
  it("a Dhaka day is [00:00+06, next 00:00+06) in UTC", () => {
    const { start, end } = dhakaDayBounds("2026-10-10");
    expect(start.toISOString()).toBe("2026-10-09T18:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-10T18:00:00.000Z");
  });

  it("orders on the boundary: 23:59 Dhaka out, 00:00 in, next-day 00:00 out", async () => {
    const mk = (id: string, placedAt: string) => ({
      id, organizationId: "org-1", customerId: null, status: "processing", source: "manual",
      isPractice: false, totalMinor: 100n, placedAt: D(placedAt), createdAt: D(placedAt), address: null,
    });
    const { svc } = makeService({
      orders: [
        mk("before", "2026-10-09T17:59:59Z"), // Oct 9, 23:59 Dhaka
        mk("first", "2026-10-09T18:00:00Z"),  // Oct 10, 00:00 Dhaka
        mk("last", "2026-10-10T17:59:59Z"),   // Oct 10, 23:59 Dhaka
        mk("after", "2026-10-10T18:00:00Z"),  // Oct 11, 00:00 Dhaka
        // placedAt null → createdAt is the order date
        { id: "fallback", organizationId: "org-1", customerId: null, status: "processing", source: "manual", isPractice: false, totalMinor: 100n, placedAt: null, createdAt: D("2026-10-10T10:00:00Z"), address: null },
      ],
      shipments: [], customers: [], fulfillments: [], returnRequests: [],
    });
    const a = await svc.getAnalytics("org-1", "2026-10-10", "2026-10-10", NOW);
    expect(a.ordersCount).toBe(3);
    expect(a.from).toBe("2026-10-10");
    expect(a.to).toBe("2026-10-10");
  });

  it("rejects from > to", async () => {
    expect(() => parseRange("2026-10-11", "2026-10-10", NOW)).toThrow(/শুরুর তারিখ/);
  });
});

describe("ON9 analytics figures", () => {
  it("sold-bucket revenue, AOV, repeat rate, cancel + return rates", async () => {
    const { svc } = makeService(baseData());
    const a = await svc.getAnalytics("org-1", "2026-10-01", "2026-10-31", NOW);
    expect(a.ordersCount).toBe(8); // practice + other-org excluded
    expect(a.soldCount).toBe(4); // s1, s2, s3 (delivered shipment), r1
    expect(a.revenueMinor).toBe("200000");
    expect(a.aovMinor).toBe("50000");
    expect(a.repeatCustomerRate).toBe(100); // cust-a {s1,s2} and cust-b {s3,r1} both repeat
    expect(a.cancellationRate).toBe(25); // 2 / 8
    expect(a.returnRate).toBe(12.5); // r1 only (rr-open is merely "requested")
    expect(a.cancelBreakdownBasis).toBe("source");
    expect(a.cancelBreakdown).toEqual([
      { source: "facebook", count: 1 },
      { source: "woocommerce", count: 1 },
    ]);
  });

  it("AOV and rates are null (never fabricated 0) on an empty range", async () => {
    const { svc } = makeService(baseData());
    const a = await svc.getAnalytics("org-1", "2027-01-01", "2027-01-31", NOW);
    expect(a.ordersCount).toBe(0);
    expect(a.revenueMinor).toBe("0");
    expect(a.aovMinor).toBeNull();
    expect(a.repeatCustomerRate).toBeNull();
    expect(a.cancellationRate).toBeNull();
    expect(a.returnRate).toBeNull();
  });

  it("top districts: structured wins, medium parse counts, top-10 shape", async () => {
    const { svc } = makeService(baseData());
    const a = await svc.getAnalytics("org-1", "2026-10-01", "2026-10-31", NOW);
    expect(a.topDistricts[0]).toEqual({ district: "Dhaka", orders: 2, revenueMinor: "150000" });
    const names = a.topDistricts.map((d: any) => d.district);
    expect(names).toContain("Chattogram"); // parsed from s3's address text
    expect(names).toContain("Khulna"); // parsed from r1's address text
  });

  it("courier scorecard: decided denominators, transit + COD pair counts, null-when-no-pairs", async () => {
    const { svc } = makeService(baseData());
    const a = await svc.getAnalytics("org-1", "2026-10-01", "2026-10-31", NOW);
    const sf = a.courierScorecard.find((c: any) => c.provider === "steadfast")!;
    expect(sf.shipments).toBe(2); // sh5 (redx, booked Sep) is out of range
    expect(sf.deliveredPct).toBe(50);
    expect(sf.returnedPct).toBe(50);
    expect(sf.avgTransitDays).toBe(2);
    expect(sf.transitPairs).toBe(1);
    expect(sf.avgCodCollectLagDays).toBe(2);
    expect(sf.codPairs).toBe(1);
    const pa = a.courierScorecard.find((c: any) => c.provider === "pathao")!;
    expect(pa.deliveredPct).toBe(100); // decided = 1 (sh3 still in flight)
    expect(pa.avgTransitDays).toBe(1);
    expect(pa.avgCodCollectLagDays).toBeNull(); // delivered but COD never collected
    expect(pa.codPairs).toBe(0);
    expect(a.courierScorecard.some((c: any) => c.provider === "redx")).toBe(false);
  });

  it("snapshot reuses ON6 stuck + OB3 SLA definitions", async () => {
    const { svc } = makeService(baseData());
    const a = await svc.getAnalytics("org-1", "2026-10-01", "2026-10-31", NOW);
    expect(a.stuckNow).toBe(1); // sh5 idle 10 days > default 5
    expect(a.slaBreachesNow).toBe(2); // p1 + s3 both awaiting pack since Oct 5 (>24h, no packed fulfilment); o-pack packed 6h ago is fine
  });

  it("cross-org isolation: org-2 sees only its own order", async () => {
    const { svc } = makeService(baseData());
    const a = await svc.getAnalytics("org-2", "2026-10-01", "2026-10-31", NOW);
    expect(a.ordersCount).toBe(1);
    expect(a.revenueMinor).toBe("555500");
    expect(a.topDistricts).toEqual([{ district: "Sylhet", orders: 1, revenueMinor: "555500" }]);
  });
});

describe("ON9 product return warnings (thresholds)", () => {
  function warningsData() {
    const orders: any[] = [];
    const orderItems: any[] = [];
    const returnRequests: any[] = [];
    const addProduct = (pid: string, orderCount: number, returnedCount: number) => {
      for (let i = 0; i < orderCount; i++) {
        const oid = `${pid}-o${i}`;
        orders.push({ id: oid, organizationId: "org-1", customerId: null, status: "delivered", source: "manual", isPractice: false, totalMinor: 1000n, placedAt: D("2026-10-05T06:00:00Z"), createdAt: D("2026-10-05T06:00:00Z"), address: null });
        orderItems.push({ id: `${oid}-item`, orderId: oid, productId: pid, name: `Product ${pid}`, quantity: 1 });
        if (i < returnedCount) {
          returnRequests.push({ id: `${oid}-rr`, organizationId: "org-1", orderId: oid, status: "completed", items: [{ orderItemId: `${oid}-item`, quantity: 1 }] });
        }
      }
    };
    addProduct("prod-a", 12, 3); // exactly 25%, 12 orders → INCLUDED
    addProduct("prod-b", 25, 6); // 24% → excluded
    addProduct("prod-c", 9, 3); // 33% but only 9 orders → excluded
    return { orders, orderItems, returnRequests, shipments: [], customers: [], fulfillments: [] };
  }

  it("25% + ≥10 orders warns; 24% and high-rate-but-9-orders do not", async () => {
    const { svc } = makeService(warningsData());
    const a = await svc.getAnalytics("org-1", "2026-10-01", "2026-10-31", NOW);
    expect(a.productReturnWarnings).toEqual([
      { productId: "prod-a", productName: "Product prod-a", orders: 12, returns: 3, ratePct: 25 },
    ]);
  });
});

describe("ON9 owner digest", () => {
  function digestData() {
    return {
      organizations: [{ id: "org-1", name: "Digest Shop" }],
      orders: [
        { id: "y1", organizationId: "org-1", customerId: null, status: "delivered", source: "manual", isPractice: false, totalMinor: 40000n, placedAt: D("2026-10-13T04:00:00Z"), createdAt: D("2026-10-13T04:00:00Z"), address: null },
        { id: "y2", organizationId: "org-1", customerId: null, status: "completed", source: "manual", isPractice: false, totalMinor: 60000n, placedAt: D("2026-10-13T04:00:00Z"), createdAt: D("2026-10-13T04:00:00Z"), address: null },
        { id: "t1", organizationId: "org-1", customerId: null, status: "processing", source: "manual", isPractice: false, totalMinor: 9000n, placedAt: D("2026-10-14T04:00:00Z"), createdAt: D("2026-10-14T04:00:00Z"), address: null },
      ],
      shipments: [], customers: [], fulfillments: [], returnRequests: [],
      verifications: [
        { id: "pv1", organizationId: "org-1", orderId: "y1", status: "approved", amountMinor: 25000n, createdAt: D("2026-10-13T05:00:00Z") },
        { id: "pv2", organizationId: "org-1", orderId: "y2", status: "approved", amountMinor: 10000n, createdAt: D("2026-10-10T05:00:00Z") },
        { id: "pv3", organizationId: "org-1", orderId: "y1", status: "pending", amountMinor: 99900n, createdAt: D("2026-10-13T05:00:00Z") },
      ],
      memberships: [
        { userId: "u-good", organizationId: "org-1", role: "OWNER", status: "ACTIVE" },
        { userId: "u-bad", organizationId: "org-1", role: "OWNER", status: "ACTIVE" },
        { userId: "u-admin", organizationId: "org-1", role: "ADMIN", status: "ACTIVE" },
        { userId: "u-off", organizationId: "org-1", role: "OWNER", status: "SUSPENDED" },
      ],
      users: [
        { id: "u-good", email: "good@example.com", name: "Good Owner" },
        { id: "u-bad", email: "bad@example.com", name: "Bad Owner" },
        { id: "u-admin", email: "admin@example.com", name: "Admin" },
        { id: "u-off", email: "off@example.com", name: "Off Owner" },
      ],
      jobs: [{ id: "job-1", organizationId: "org-1", type: "owner_order_digest", enabled: true }],
    };
  }

  it("buildDigest(yesterday): placed, sold revenue, collected-that-day, org-wide due", async () => {
    const { svc } = makeService(digestData());
    const d = await svc.buildDigest("org-1", "yesterday", NOW);
    expect(d.day).toBe("2026-10-13");
    expect(d.ordersPlaced).toBe(2);
    expect(d.revenueMinor).toBe("100000");
    expect(d.collectedMinor).toBe("25000"); // pv1 only: pv2 is Oct 10, pv3 is pending
    expect(d.dueOutstandingMinor).toBe("65000"); // (40000-25000) + (60000-10000)
  });

  it("sendDigest: one bad email never stops the others; SMS skips with no_phone_on_record; ONE audit row", async () => {
    const audits: any[] = [];
    const email: any = {
      send: jest.fn(async ({ to }: any) => {
        if (to === "bad@example.com") throw new Error("SMTP rejected");
        return { providerMessageId: "m-1" };
      }),
    };
    const { svc } = makeService(digestData(), { email, audits });
    const summary = await svc.sendDigest("org-1", "yesterday", undefined, NOW);

    // Only the two ACTIVE OWNERs are recipients (not ADMIN, not SUSPENDED).
    const emailResults = summary.recipients.filter((r: any) => r.channel === "email");
    expect(emailResults).toHaveLength(2);
    expect(emailResults.find((r: any) => r.userId === "u-good")?.ok).toBe(true);
    expect(emailResults.find((r: any) => r.userId === "u-bad")?.ok).toBe(false);
    expect(summary.sentCount).toBe(1);
    expect(summary.failedCount).toBe(1);

    // No User/Organization phone exists anywhere → SMS always skips honestly.
    const smsResults = summary.recipients.filter((r: any) => r.channel === "sms");
    expect(smsResults).toHaveLength(2);
    expect(smsResults.every((r: any) => r.skipped && r.error === "no_phone_on_record")).toBe(true);

    // Bengali subject + figures in the body.
    const sent = email.send.mock.calls[0][0];
    expect(sent.subject).toContain("গতকালের অর্ডার সারাংশ");
    expect(sent.subject).toContain("Digest Shop");
    expect(sent.text).toContain("৳1000");

    // Exactly ONE audit row carrying the per-recipient results + figures.
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("owner_order_digest");
    expect(audits[0].metadata.results).toHaveLength(4);
    expect(audits[0].metadata.revenueMinor).toBe("100000");
  });

  it("digestStatus reads the last audit run + the org's job enablement", async () => {
    const audits: any[] = [];
    const email: any = { send: jest.fn(async () => ({ providerMessageId: "m" })) };
    const { svc } = makeService(digestData(), { email, audits });
    const before = await svc.digestStatus("org-1");
    expect(before.lastRun).toBeNull();
    expect(before.jobEnabled).toBe(true);
    expect(before.ownerEmails).toEqual(["good@example.com", "bad@example.com"]);

    await svc.sendDigest("org-1", "today", "u-good", NOW);
    const after = await svc.digestStatus("org-1");
    expect(after.lastRun?.period).toBe("today");
    expect(after.lastRun?.day).toBe("2026-10-14");
    expect(after.lastRun?.results.length).toBeGreaterThan(0);
  });

  it("runOwnerDigestJob sends yesterday's digest", async () => {
    const email: any = { send: jest.fn(async () => ({ providerMessageId: "m" })) };
    const { svc } = makeService(digestData(), { email });
    const out = await svc.runOwnerDigestJob("org-1");
    expect(out.period).toBe("yesterday");
    expect(email.send).toHaveBeenCalledTimes(2);
  });
});
