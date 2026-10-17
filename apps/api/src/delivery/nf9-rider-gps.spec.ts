import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { RiderGpsService, hashRiderShareToken, NF9_TRAIL_CAP_PER_ASSIGNMENT } from "./rider-gps.service";
import { isOutForDelivery, isStaleFix, NF9_STALE_THRESHOLD_MS } from "./rider-location-visibility";
import { StorefrontService } from "../storefront/storefront.service";

/**
 * NF9 (FB4) — Rider live GPS specs, in the neighbouring
 * fake-Prisma style (delivery.spec / nf8 spec). Proven here:
 * (a) token auth — hash at rest, wrong/revoked/expired refused,
 *     rotation kills the old token;
 * (b) a token can only ever post/read for ITS rider (rider A's
 *     token cannot post a ping for rider B — the DTO has no
 *     rider field and a forged one is ignored);
 * (c) org isolation — tokens, pings, fleet and the customer
 *     payload never cross orgs;
 * (d) posting refused with no active assignment and while
 *     sharing is OFF; stop-sharing takes effect immediately;
 * (e) stale-fix labelling (5-minute threshold) in fleet + the
 *     customer payload;
 * (f) the bounded trail (200/assignment) + latest-fix upsert;
 * (g) the customer payload (RiderGpsService.customerVisibleLocation
 *     AND the real EC18 StorefrontService.trackOrder) includes
 *     the location ONLY when out-for-delivery + sharing + an
 *     active assignment for that order.
 */

const ORG = "org-1";
const ORG2 = "org-2";
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("gte" in v && !(row[k] != null && new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      if ("lt" in v && !(row[k] != null && new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  const applyOrder = (list: any[], orderBy: any) => {
    if (!orderBy) return list;
    const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
    let out = [...list];
    for (const spec of [...specs].reverse()) {
      const [field, dir] = Object.entries(spec)[0] as [string, string];
      out = [...out].sort((a, b) => {
        const av: any = a[field] instanceof Date ? a[field].getTime() : a[field];
        const bv: any = b[field] instanceof Date ? b[field].getTime() : b[field];
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return dir === "desc" ? -cmp : cmp;
      });
    }
    return out;
  };
  return {
    rows,
    findFirst: async ({ where, orderBy }: any = {}) =>
      applyOrder(rows.filter((r) => matches(r, where)), orderBy)[0] ?? null,
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let f = applyOrder(rows.filter((r) => matches(r, where ?? {})), orderBy);
      if (take) f = f.slice(0, take);
      return f;
    },
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where ?? {}));
      if (!row) throw new Error(`row not found in ${name}`);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matches(r, where ?? {}));
      if (idx < 0) throw new Error(`row not found in ${name}`);
      return rows.splice(idx, 1)[0];
    },
    deleteMany: async ({ where }: any) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matches(rows[i], where ?? {})) { rows.splice(i, 1); count++; }
      }
      return { count };
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where)).length,
  };
}

function makeWorld() {
  const prisma: any = {
    rider: makeTable("rider"),
    deliveryAssignment: makeTable("assignment"),
    order: makeTable("order"),
    organization: makeTable("organization"),
    riderShareLink: makeTable("shareLink"),
    riderLocationPing: makeTable("ping"),
    riderLocationLatest: makeTable("latest"),
  };
  prisma.organization.rows.push(
    { id: ORG, slug: "shop-one", name: "Shop One Ltd", brandName: "ShopOne", logoUrl: null, primaryColor: null },
    { id: ORG2, slug: "shop-two", name: "Other Ltd", brandName: null, logoUrl: null, primaryColor: null },
  );
  prisma.rider.rows.push(
    { id: "rider-1", organizationId: ORG, name: "করিম", phone: "01711111111", active: true },
    { id: "rider-2", organizationId: ORG, name: "রহিম", phone: "01722222222", active: true },
    { id: "rider-3", organizationId: ORG, name: "সাকিব", phone: "01744444444", active: true },
    { id: "rider-foreign", organizationId: ORG2, name: "বিদেশি", phone: "01733333333", active: true },
  );
  prisma.order.rows.push(
    { id: "ord-1", organizationId: ORG, externalNumber: "1042", status: "processing" },
    { id: "ord-2", organizationId: ORG, externalNumber: "1043", status: "processing" },
    { id: "ord-foreign", organizationId: ORG2, externalNumber: "9999", status: "processing" },
  );
  prisma.deliveryAssignment.rows.push(
    { id: "as-1", organizationId: ORG, orderId: "ord-1", riderId: "rider-1", status: "picked_up", assignedAt: new Date() },
    { id: "as-2", organizationId: ORG, orderId: "ord-2", riderId: "rider-2", status: "assigned", assignedAt: new Date() },
    { id: "as-foreign", organizationId: ORG2, orderId: "ord-foreign", riderId: "rider-foreign", status: "picked_up", assignedAt: new Date() },
  );
  const audits: any[] = [];
  const audit = { log: jest.fn(async (e: any) => { audits.push(e); }) } as any;
  const svc = new RiderGpsService(prisma as any, audit);
  return { svc, prisma, audits };
}

const DHAKA = { lat: 23.8103, lng: 90.4125, accuracy: 12 };

describe("NF9 (a) share-token auth — hash at rest, wrong/revoked/expired refused, rotation", () => {
  it("issue returns the raw token ONCE; only its SHA-256 hash is stored; the hash never leaves in the response", async () => {
    const { svc, prisma } = makeWorld();
    const out: any = await svc.issueShareLink(ORG, "staff-1", "rider-1");
    expect(out.token).toBeTruthy();
    expect(out.link).toContain(`/rider/${out.token}`);
    const row = prisma.riderShareLink.rows[0];
    expect(row.tokenHash).toBe(sha256(out.token));
    expect(row.tokenHash).toBe(hashRiderShareToken(out.token));
    expect(JSON.stringify(row)).not.toContain(out.token);
    expect(JSON.stringify(out)).not.toContain(row.tokenHash);
    expect(row.sharingEnabled).toBe(true);
    expect(new Date(row.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("wrong token 404s on resolve and on ping", async () => {
    const { svc } = makeWorld();
    await svc.issueShareLink(ORG, "staff-1", "rider-1");
    await expect(svc.publicResolve("totally-wrong-token-value")).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.postPing("totally-wrong-token-value", DHAKA)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.setSharing("totally-wrong-token-value", false)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rotation kills the old token immediately; the new token resolves", async () => {
    const { svc } = makeWorld();
    const first: any = await svc.issueShareLink(ORG, "staff-1", "rider-1");
    const second: any = await svc.issueShareLink(ORG, "staff-1", "rider-1");
    expect(second.token).not.toBe(first.token);
    await expect(svc.publicResolve(first.token)).rejects.toBeInstanceOf(NotFoundException);
    const resolved: any = await svc.publicResolve(second.token);
    expect(resolved.rider.id).toBe("rider-1");
  });

  it("revoked token refuses (403) on resolve + ping, and the rider cannot resurrect it from the page", async () => {
    const { svc } = makeWorld();
    const issued: any = await svc.issueShareLink(ORG, "staff-1", "rider-1");
    await svc.revokeShareLink(ORG, "staff-1", "rider-1");
    await expect(svc.publicResolve(issued.token)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.postPing(issued.token, DHAKA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.setSharing(issued.token, true)).rejects.toBeInstanceOf(ForbiddenException);
    const state: any = await svc.shareState(ORG, "rider-1");
    expect(state).toMatchObject({ hasLink: true, sharing: false, revoked: true });
  });

  it("expired token refuses (403)", async () => {
    const { svc, prisma } = makeWorld();
    const issued: any = await svc.issueShareLink(ORG, "staff-1", "rider-1");
    prisma.riderShareLink.rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(svc.publicResolve(issued.token)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.postPing(issued.token, DHAKA)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("issuing for a foreign-org rider 404s (staff side is org-scoped)", async () => {
    const { svc } = makeWorld();
    await expect(svc.issueShareLink(ORG, "staff-1", "rider-foreign")).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.revokeShareLink(ORG, "staff-1", "rider-foreign")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("NF9 (b/c) token binds ONE rider in ONE org — cross-rider and cross-org are impossible", () => {
  it("rider A's token posts under rider A only — a forged riderId in the DTO is ignored; rider B gets nothing", async () => {
    const { svc, prisma } = makeWorld();
    const a: any = await svc.issueShareLink(ORG, "staff-1", "rider-1");
    await svc.issueShareLink(ORG, "staff-1", "rider-2");
    const out: any = await svc.postPing(a.token, { ...DHAKA, riderId: "rider-2", organizationId: ORG2 } as any);
    expect(out.ok).toBe(true);
    expect(prisma.riderLocationPing.rows).toHaveLength(1);
    expect(prisma.riderLocationPing.rows[0]).toMatchObject({ riderId: "rider-1", organizationId: ORG, deliveryAssignmentId: "as-1" });
    expect(prisma.riderLocationLatest.rows).toHaveLength(1);
    expect(prisma.riderLocationLatest.rows[0].riderId).toBe("rider-1");
    const resolved: any = await svc.publicResolve(a.token);
    expect(resolved.rider.id).toBe("rider-1");
    expect(resolved.assignment.id).toBe("as-1");
  });

  it("org isolation: a foreign org's token + pings never appear in org-1's fleet or customer payload", async () => {
    const { svc, prisma } = makeWorld();
    const foreign: any = await svc.issueShareLink(ORG2, "staff-9", "rider-foreign");
    await svc.postPing(foreign.token, DHAKA);
    expect(prisma.riderLocationPing.rows[0].organizationId).toBe(ORG2);

    const fleet1: any = await svc.fleet(ORG);
    expect(fleet1.entries.map((e: any) => e.assignmentId)).not.toContain("as-foreign");
    expect(fleet1.riders.map((r: any) => r.id)).not.toContain("rider-foreign");

    const cross = await svc.customerVisibleLocation(ORG, "ord-foreign", { shipmentStatus: "out_for_delivery" });
    expect(cross).toBeNull();
    const own = await svc.customerVisibleLocation(ORG2, "ord-foreign", { shipmentStatus: "out_for_delivery" });
    expect(own).not.toBeNull();
  });
});

describe("NF9 (d) posting gates — active assignment + sharing ON; stop-sharing takes effect", () => {
  it("posting is refused when the rider has NO active assignment", async () => {
    const { svc, prisma } = makeWorld();
    const issued: any = await svc.issueShareLink(ORG, "staff-1", "rider-3"); // rider-3: no assignment
    await expect(svc.postPing(issued.token, DHAKA)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.riderLocationPing.rows).toHaveLength(0);
  });

  it("posting is refused after the assignment leaves the active states (delivered)", async () => {
    const { svc, prisma } = makeWorld();
    const issued: any = await svc.issueShareLink(ORG, "staff-1", "rider-1");
    prisma.deliveryAssignment.rows.find((r: any) => r.id === "as-1").status = "delivered";
    await expect(svc.postPing(issued.token, DHAKA)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.riderLocationPing.rows).toHaveLength(0);
  });

  it("stop-sharing: subsequent posts refuse (403) and the location disappears from the customer payload; start re-enables", async () => {
    const { svc } = makeWorld();
    const issued: any = await svc.issueShareLink(ORG, "staff-1", "rider-1");
    await svc.postPing(issued.token, DHAKA);
    const before = await svc.customerVisibleLocation(ORG, "ord-1", {});
    expect(before).not.toBeNull();

    const stopped: any = await svc.setSharing(issued.token, false);
    expect(stopped.sharingEnabled).toBe(false);
    await expect(svc.postPing(issued.token, DHAKA)).rejects.toBeInstanceOf(ForbiddenException);
    const resolved: any = await svc.publicResolve(issued.token);
    expect(resolved.sharingEnabled).toBe(false);
    const after = await svc.customerVisibleLocation(ORG, "ord-1", {});
    expect(after).toBeNull();

    await svc.setSharing(issued.token, true);
    const resumed: any = await svc.postPing(issued.token, DHAKA);
    expect(resumed.ok).toBe(true);
  });

  it("invalid coordinates / recordedAt are refused and write nothing", async () => {
    const { svc, prisma } = makeWorld();
    const issued: any = await svc.issueShareLink(ORG, "staff-1", "rider-1");
    await expect(svc.postPing(issued.token, { lat: 999, lng: 90 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.postPing(issued.token, { lat: 23, lng: -999 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.postPing(issued.token, { ...DHAKA, recordedAt: "not-a-date" })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.riderLocationPing.rows).toHaveLength(0);
  });
});

describe("NF9 (e/f) freshness + retention — stale labelling, latest upsert, bounded trail", () => {
  it("unit: the out-for-delivery + stale helpers use the codebase vocabularies", () => {
    expect(isOutForDelivery({ shipmentStatus: "out_for_delivery" })).toBe(true);
    expect(isOutForDelivery({ shipmentStatus: "Out For Delivery" })).toBe(true);
    expect(isOutForDelivery({ orderStatus: "out-for-delivery" })).toBe(true);
    expect(isOutForDelivery({ assignmentStatus: "picked_up" })).toBe(true);
    expect(isOutForDelivery({ assignmentStatus: "assigned" })).toBe(false);
    expect(isOutForDelivery({ orderStatus: "processing" })).toBe(false);
    const now = new Date();
    expect(isStaleFix(new Date(now.getTime() - NF9_STALE_THRESHOLD_MS - 1000), now)).toBe(true);
    expect(isStaleFix(new Date(now.getTime() - 60_000), now)).toBe(false);
  });

  it("fleet labels a 10-minute-old fix stale with its real age; a fresh fix is not stale", async () => {
    const { svc } = makeWorld();
    const issued: any = await svc.issueShareLink(ORG, "staff-1", "rider-1");
    await svc.postPing(issued.token, { ...DHAKA, recordedAt: new Date(Date.now() - 10 * 60_000).toISOString() });
    let fleet: any = await svc.fleet(ORG);
    let entry = fleet.entries.find((e: any) => e.assignmentId === "as-1");
    expect(entry.location.stale).toBe(true);
    expect(entry.location.ageMs).toBeGreaterThanOrEqual(10 * 60_000 - 5000);
    expect(entry.location.mapsUrl).toContain("google.com/maps?q=23.8103%2C90.4125");
    expect(entry.sharing.sharing).toBe(true);

    await svc.postPing(issued.token, { lat: 23.9, lng: 90.5 });
    fleet = await svc.fleet(ORG);
    entry = fleet.entries.find((e: any) => e.assignmentId === "as-1");
    expect(entry.location.stale).toBe(false);
    expect(entry.location.lat).toBe(23.9);
    // An assignment with no fix yet shows location: null — never a placeholder.
    const other = fleet.entries.find((e: any) => e.assignmentId === "as-2");
    expect(other.location).toBeNull();
  });

  it("latest is ONE upserted row per rider; an out-of-order older ping never moves it backwards", async () => {
    const { svc, prisma } = makeWorld();
    const issued: any = await svc.issueShareLink(ORG, "staff-1", "rider-1");
    const t0 = Date.now() - 120_000;
    await svc.postPing(issued.token, { lat: 23.1, lng: 90.1, recordedAt: new Date(t0).toISOString() });
    await svc.postPing(issued.token, { lat: 23.2, lng: 90.2, recordedAt: new Date(t0 + 60_000).toISOString() });
    await svc.postPing(issued.token, { lat: 23.0, lng: 90.0, recordedAt: new Date(t0 + 10_000).toISOString() });
    expect(prisma.riderLocationLatest.rows).toHaveLength(1);
    expect(prisma.riderLocationLatest.rows[0]).toMatchObject({ riderId: "rider-1", lat: 23.2, lng: 90.2 });
    expect(prisma.riderLocationPing.rows).toHaveLength(3); // the trail keeps all three
  });

  it(`trail is bounded at ${200} rows per assignment — the oldest are pruned on insert`, async () => {
    const { svc, prisma } = makeWorld();
    const issued: any = await svc.issueShareLink(ORG, "staff-1", "rider-1");
    const base = Date.now() - 400_000;
    const total = NF9_TRAIL_CAP_PER_ASSIGNMENT + 5;
    for (let i = 0; i < total; i++) {
      await svc.postPing(issued.token, {
        lat: 23 + i / 10000, lng: 90.4,
        recordedAt: new Date(base + i * 1000).toISOString(),
      });
    }
    const trail = prisma.riderLocationPing.rows.filter((r: any) => r.deliveryAssignmentId === "as-1");
    expect(trail.length).toBe(NF9_TRAIL_CAP_PER_ASSIGNMENT);
    // The surviving rows are the NEWEST ones.
    const times = trail.map((r: any) => new Date(r.recordedAt).getTime());
    expect(Math.min(...times)).toBe(base + 5 * 1000);
    expect(prisma.riderLocationLatest.rows[0].lat).toBeCloseTo(23 + (total - 1) / 10000, 6);
  });
});

describe("NF9 (g) customer payload — location ONLY when out-for-delivery + sharing + active assignment", () => {
  it("picked_up (own-rider out-for-delivery) + sharing + fix → location with maps link and rider name", async () => {
    const { svc } = makeWorld();
    const issued: any = await svc.issueShareLink(ORG, "staff-1", "rider-1");
    await svc.postPing(issued.token, DHAKA);
    const loc: any = await svc.customerVisibleLocation(ORG, "ord-1", { orderStatus: "processing" });
    expect(loc).not.toBeNull();
    expect(loc.lat).toBe(DHAKA.lat);
    expect(loc.lng).toBe(DHAKA.lng);
    expect(loc.riderName).toBe("করিম");
    expect(loc.stale).toBe(false);
    expect(loc.mapsUrl).toContain("google.com/maps");
    expect(loc.recordedAt).toBeTruthy();
  });

  it("assigned (not picked up, no out_for_delivery anywhere) → null; a courier out_for_delivery shipment status opens the gate", async () => {
    const { svc } = makeWorld();
    const issued: any = await svc.issueShareLink(ORG, "staff-1", "rider-2");
    await svc.postPing(issued.token, DHAKA); // posting IS allowed while assigned
    expect(await svc.customerVisibleLocation(ORG, "ord-2", { orderStatus: "processing" })).toBeNull();
    expect(await svc.customerVisibleLocation(ORG, "ord-2", { orderStatus: "processing", shipmentStatus: "in_transit" })).toBeNull();
    const opened: any = await svc.customerVisibleLocation(ORG, "ord-2", { orderStatus: "processing", shipmentStatus: "out_for_delivery" });
    expect(opened).not.toBeNull();
    const byOrder: any = await svc.customerVisibleLocation(ORG, "ord-2", { orderStatus: "out_for_delivery" });
    expect(byOrder).not.toBeNull();
  });

  it("no share link at all → null even when picked_up with a fix recorded under a previous link lifecycle", async () => {
    const { svc, prisma } = makeWorld();
    // A fix exists (written directly, as if from an earlier link) but NO link row exists now.
    prisma.riderLocationLatest.rows.push({
      id: "latest-x", organizationId: ORG, riderId: "rider-1", deliveryAssignmentId: "as-1",
      lat: 23.8, lng: 90.4, accuracy: null, recordedAt: new Date(),
    });
    expect(await svc.customerVisibleLocation(ORG, "ord-1", {})).toBeNull();
  });

  it("a fix recorded under a DIFFERENT (finished) assignment is never shown for the current order", async () => {
    const { svc, prisma } = makeWorld();
    const issued: any = await svc.issueShareLink(ORG, "staff-1", "rider-1");
    await svc.postPing(issued.token, DHAKA); // latest bound to as-1 / ord-1
    expect(await svc.customerVisibleLocation(ORG, "ord-2", { shipmentStatus: "out_for_delivery" })).toBeNull();
    expect(prisma.riderLocationLatest.rows[0].deliveryAssignmentId).toBe("as-1");
  });
});

describe("NF9 (g2) EC18 integration — StorefrontService.trackOrder carries riderLocation under the same rule", () => {
  function makeShopWorld() {
    const prisma: any = {
      organization: makeTable("organization"), storefrontSetting: makeTable("storefrontSetting"),
      businessProfile: makeTable("businessProfile"), category: makeTable("category"),
      product: makeTable("product"), productVariant: makeTable("productVariant"),
      productImage: makeTable("productImage"), shippingZone: makeTable("shippingZone"),
      storeCart: makeTable("storeCart"), storeCartItem: makeTable("storeCartItem"),
      order: makeTable("order"), orderItem: makeTable("orderItem"),
      fulfillment: makeTable("fulfillment"), courierShipment: makeTable("courierShipment"),
      paymentVerification: makeTable("paymentVerification"), customer: makeTable("customer"),
      deliverySlot: makeTable("deliverySlot"), integration: makeTable("integration"),
      rider: makeTable("rider"), deliveryAssignment: makeTable("assignment"),
      riderShareLink: makeTable("shareLink"), riderLocationLatest: makeTable("latest"),
      returnRequest: makeTable("returnRequest"), giftCard: makeTable("giftCard"),
      pickupPoint: makeTable("pickupPoint"), installmentPlan: makeTable("installmentPlan"),
      installmentItem: makeTable("installmentItem"),
    };
    const PLACED = new Date("2026-10-12T08:00:00Z");
    prisma.organization.rows.push({
      id: ORG, slug: "shop-one", name: "Shop One Ltd", brandName: "ShopOne",
      logoUrl: "logo.png", primaryColor: "#123456", customDomain: null,
    });
    prisma.storefrontSetting.rows.push({
      id: "set-1", organizationId: ORG, shopEnabled: true, shopName: null,
      trackingPageEnabled: true, supportPhone: "01899999999",
      returnPolicyText: null, deliveryPromiseText: null,
    });
    prisma.customer.rows.push({
      id: "c1", organizationId: ORG, firstName: "রহিম", phone: "01711111111", email: null, address: null,
    });
    prisma.order.rows.push({
      id: "o1", organizationId: ORG, customerId: "c1",
      externalId: "native-xyz", externalNumber: "ORD-1234-AB",
      source: "native_storefront", status: "processing", currency: "BDT",
      totalMinor: 100000n, placedAt: PLACED, createdAt: PLACED,
      deliverySlotId: null, deliveryDate: null, address: "ঢাকা",
    });
    prisma.rider.rows.push({ id: "rider-1", organizationId: ORG, name: "করিম", phone: "01711111111", active: true });
    prisma.deliveryAssignment.rows.push({
      id: "as-1", organizationId: ORG, orderId: "o1", riderId: "rider-1", status: "picked_up", assignedAt: new Date(),
    });
    prisma.riderShareLink.rows.push({
      id: "link-1", organizationId: ORG, riderId: "rider-1",
      tokenHash: sha256("shop-rider-token"), sharingEnabled: true,
      expiresAt: new Date(Date.now() + 3600_000), revokedAt: null,
    });
    prisma.riderLocationLatest.rows.push({
      id: "latest-1", organizationId: ORG, riderId: "rider-1", deliveryAssignmentId: "as-1",
      lat: DHAKA.lat, lng: DHAKA.lng, accuracy: DHAKA.accuracy, recordedAt: new Date(),
    });
    return prisma;
  }

  it("trackOrder includes the rider location while picked_up + sharing; hiding sharing removes it entirely", async () => {
    const prisma = makeShopWorld();
    const svc = new StorefrontService(prisma, undefined, undefined, undefined, undefined, undefined);
    const out: any = await svc.trackOrder("shop-one", { phone: "01711111111", orderNumber: "ORD-1234-AB" });
    expect(out.riderLocation).not.toBeNull();
    expect(out.riderLocation.lat).toBe(DHAKA.lat);
    expect(out.riderLocation.riderName).toBe("করিম");
    expect(out.riderLocation.mapsUrl).toContain("google.com/maps");

    prisma.riderShareLink.rows[0].sharingEnabled = false;
    const hidden: any = await svc.trackOrder("shop-one", { phone: "01711111111", orderNumber: "ORD-1234-AB" });
    expect(hidden.riderLocation).toBeNull();

    prisma.riderShareLink.rows[0].sharingEnabled = true;
    prisma.deliveryAssignment.rows[0].status = "assigned";
    const notOut: any = await svc.trackOrder("shop-one", { phone: "01711111111", orderNumber: "ORD-1234-AB" });
    expect(notOut.riderLocation).toBeNull();
  });
});
