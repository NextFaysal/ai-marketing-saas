import { TrackingService } from "./tracking.service";
import { AttributionService } from "../attribution/attribution.service";

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && "not" in (v as any)) return row[k] !== (v as any).not;
    return row[k] === v;
  });
}
function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `id-${++seq}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return row; },
  };
}
function fakePrisma() {
  return {
    store: makeTable(), visitor: makeTable(), trackingSession: makeTable(),
    touchpoint: makeTable(), trackingEvent: makeTable(), order: makeTable(),
    attributionCredit: makeTable(),
  };
}

const baseEvent = {
  anonymousId: "anon-1", sessionKey: "sess-1",
  session: { utmSource: "facebook", utmCampaign: "eid-sale", fbclid: "fb-123", landingPage: "https://shop.example.com/?utm_source=facebook" },
};

describe("TrackingService.ingest", () => {
  async function setup() {
    const prisma = fakePrisma();
    prisma.store.rows.push({ id: "store-1", organizationId: "org-1", trackingKey: "key-1" });
    const attribution = new AttributionService(prisma as any);
    const svc = new TrackingService(prisma as any, attribution);
    return { prisma, svc };
  }

  it("accepts a page view, creates visitor, session and ONE touchpoint per session", async () => {
    const { prisma, svc } = await setup();
    const r1 = await svc.ingest({ key: "key-1", events: [{ ...baseEvent, clientEventId: "e1", type: "page_view" } as any] });
    const r2 = await svc.ingest({ key: "key-1", events: [{ ...baseEvent, clientEventId: "e2", type: "product_view" } as any] });
    expect(r1.accepted).toBe(1); expect(r2.accepted).toBe(1);
    expect(prisma.visitor.rows).toHaveLength(1);
    expect(prisma.trackingSession.rows).toHaveLength(1);
    expect(prisma.touchpoint.rows).toHaveLength(1);
    expect(prisma.touchpoint.rows[0]).toMatchObject({ source: "facebook", campaign: "eid-sale", clickIdType: "fbclid", isDirect: false });
  });

  it("deduplicates the same clientEventId (beacon retry / reload)", async () => {
    const { prisma, svc } = await setup();
    const ev = { ...baseEvent, clientEventId: "dup-1", type: "page_view" } as any;
    await svc.ingest({ key: "key-1", events: [ev] });
    const second = await svc.ingest({ key: "key-1", events: [ev] });
    expect(second.duplicates).toBe(1);
    expect(prisma.trackingEvent.rows).toHaveLength(1);
  });

  it("rejects unknown event types and unknown tracking keys", async () => {
    const { svc } = await setup();
    const r = await svc.ingest({ key: "key-1", events: [{ ...baseEvent, clientEventId: "x1", type: "steal_data" } as any] });
    expect(r.rejected).toBe(1);
    await expect(svc.ingest({ key: "wrong-key", events: [] })).rejects.toThrow("Unknown tracking key");
  });

  it("a purchase event for a synced order creates attribution credits for all models", async () => {
    const { prisma, svc } = await setup();
    prisma.order.rows.push({ id: "order-1", organizationId: "org-1", externalId: "900", totalMinor: 91000n, placedAt: new Date(Date.now() + 60000), status: "processing" });
    await svc.ingest({ key: "key-1", events: [{ ...baseEvent, clientEventId: "pv-1", type: "page_view" } as any] });
    const r = await svc.ingest({ key: "key-1", events: [{ ...baseEvent, clientEventId: "buy-1", type: "purchase", orderExternalId: "900", value: "910.00" } as any] });
    expect(r.accepted).toBe(1);
    // 4 models, single touchpoint in window, so 1 credit per model = 4 rows
    expect(prisma.attributionCredit.rows).toHaveLength(4);
    const lastTouch = prisma.attributionCredit.rows.find((c: any) => c.model === "LAST_TOUCH");
    expect(lastTouch.revenueMinor).toBe(91000n);
    expect(lastTouch.touchpointId).toBe(prisma.touchpoint.rows[0].id);
    // Duplicate purchase delivery must not double-count
    await svc.ingest({ key: "key-1", events: [{ ...baseEvent, clientEventId: "buy-2", type: "purchase", orderExternalId: "900" } as any] });
    expect(prisma.attributionCredit.rows).toHaveLength(4);
  });
});
