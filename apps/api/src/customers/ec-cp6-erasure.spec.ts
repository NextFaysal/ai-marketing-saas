import { NotFoundException } from "@nestjs/common";
import { CustomersService } from "./customers.service";
import { ErasureService } from "./erasure.service";

/** CP6: GDPR deep erasure. */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
}
function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `row-${++seq}`, ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => r.id === where.id);
      if (i < 0) throw new Error("not found");
      return rows.splice(i, 1)[0];
    },
    deleteMany: async ({ where }: any = {}) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matches(rows[i], where)) { rows.splice(i, 1); count++; }
      }
      return { count };
    },
  };
}

function setup() {
  const prisma: any = {
    customer: makeTable(), order: makeTable(), customerStoreIdentity: makeTable(),
    externalReview: makeTable(), abandonedStoreCheckout: makeTable(),
    channelConversation: makeTable(), courierShipment: makeTable(), lead: makeTable(), store: makeTable(),
  };
  prisma.customer.rows.push(
    {
      id: "c1", organizationId: "org-1", firstName: "Rahim", lastName: "Uddin",
      email: "rahim@example.com", phone: "01700000000", address: { city: "Dhaka" },
      customFields: { vip: true }, referralCode: "RAHIM10", mergedIntoId: null, source: "shopify",
    },
    { id: "c2", organizationId: "org-1", firstName: "Other", lastName: "Person", email: "other@example.com", phone: "01800000000", mergedIntoId: null },
    { id: "c-foreign", organizationId: "org-2", firstName: "Rahim", lastName: "Uddin", email: "rahim@example.com", phone: "01700000000", mergedIntoId: null },
  );
  prisma.order.rows.push(
    { id: "o1", organizationId: "org-1", customerId: "c1", address: "House 1, Dhaka", totalMinor: 50000n, refundedMinor: 5000n, status: "completed" },
    { id: "o2", organizationId: "org-1", customerId: "c1", address: "Flat 2, Khulna", totalMinor: 20000n, refundedMinor: 0n, status: "completed" },
    { id: "o3", organizationId: "org-1", customerId: "c2", address: "Other address", totalMinor: 9000n, refundedMinor: 0n, status: "completed" },
  );
  prisma.customerStoreIdentity.rows.push(
    { id: "i1", organizationId: "org-1", customerId: "c1", storeId: "s1", externalId: "111" },
    { id: "i2", organizationId: "org-1", customerId: "c1", storeId: "s2", externalId: "222" },
    { id: "i3", organizationId: "org-1", customerId: "c2", storeId: "s1", externalId: "333" },
  );
  prisma.externalReview.rows.push(
    { id: "r1", organizationId: "org-1", storeId: "s1", productId: "p1", externalId: "e1", authorName: "Rahim Uddin", rating: 5, text: "ভালো", imageUrls: ["https://img/review.jpg"] },
    { id: "r2", organizationId: "org-1", storeId: "s1", productId: "p1", externalId: "e2", authorName: "Other Person", rating: 4, text: "ok", imageUrls: [] },
    { id: "r3", organizationId: "org-2", storeId: "s9", productId: "p9", externalId: "e3", authorName: "Rahim Uddin", rating: 5, text: "other org", imageUrls: [] },
  );
  prisma.abandonedStoreCheckout.rows.push(
    { id: "a1", organizationId: "org-1", storeId: "s1", externalCheckoutId: "x1", email: "rahim@example.com", phone: null },
    { id: "a2", organizationId: "org-1", storeId: "s1", externalCheckoutId: "x2", email: null, phone: "01700000000" },
    { id: "a3", organizationId: "org-1", storeId: "s1", externalCheckoutId: "x3", email: "someone@else.com", phone: "01900000000" },
  );
  const audits: any[] = [];
  const audit: any = { log: async (e: any) => { audits.push(e); } };
  const erasure = new ErasureService(prisma, audit);
  const customers = new CustomersService(prisma, audit, undefined, undefined, erasure);
  return { prisma, audits, erasure, customers };
}

describe("CP6 ErasureService.eraseCustomer", () => {
  it("erases PII everywhere, keeps order money intact, counts are exact, audit written", async () => {
    const { prisma, audits, customers } = setup();
    const report = await customers.eraseCustomer("org-1", "u1", "c1");
    expect(report).toEqual({
      customerId: "c1",
      ordersAnonymized: 2,
      identitiesDeleted: 2,
      reviewsRedacted: 1,
      abandonedCheckoutsDeleted: 2,
    });

    // Customer row kept, PII gone.
    const c = prisma.customer.rows.find((r: any) => r.id === "c1");
    expect(c.firstName).toBe("মুছে ফেলা হয়েছে");
    expect(c.lastName).toBeNull();
    expect(c.email).toBeNull();
    expect(c.phone).toBeNull();
    expect(c.address).toBeNull();
    expect(c.customFields).toBeNull();
    expect(c.referralCode).toBeNull();

    // Orders: address nulled, FINANCIAL fields untouched.
    const o1 = prisma.order.rows.find((r: any) => r.id === "o1");
    expect(o1.address).toBeNull();
    expect(o1.totalMinor).toBe(50000n);
    expect(o1.refundedMinor).toBe(5000n);
    expect(prisma.order.rows.find((r: any) => r.id === "o2").address).toBeNull();
    // Another customer's order untouched.
    expect(prisma.order.rows.find((r: any) => r.id === "o3").address).toBe("Other address");

    // Identities: only c1's deleted.
    expect(prisma.customerStoreIdentity.rows.map((r: any) => r.id)).toEqual(["i3"]);

    // Reviews: only the name-linked, same-org row redacted;
    // unlinked + foreign-org rows untouched; review photos kept.
    const r1 = prisma.externalReview.rows.find((r: any) => r.id === "r1");
    expect(r1.authorName).toBe("মুছে ফেলা হয়েছে");
    expect(r1.imageUrls).toEqual(["https://img/review.jpg"]);
    expect(prisma.externalReview.rows.find((r: any) => r.id === "r2").authorName).toBe("Other Person");
    expect(prisma.externalReview.rows.find((r: any) => r.id === "r3").authorName).toBe("Rahim Uddin");

    // Abandoned checkouts: email-match + phone-match deleted.
    expect(prisma.abandonedStoreCheckout.rows.map((r: any) => r.id)).toEqual(["a3"]);

    const audit = audits.find((a: any) => a.action === "customers.erase");
    expect(audit).toBeTruthy();
    expect(audit.metadata).toMatchObject({ customerId: "c1", ordersAnonymized: 2, identitiesDeleted: 2, reviewsRedacted: 1, abandonedCheckoutsDeleted: 2 });
  });

  it("foreign-org customer 404s (service + shared erasure)", async () => {
    const { customers, erasure } = setup();
    await expect(customers.eraseCustomer("org-1", "u1", "c-foreign")).rejects.toBeInstanceOf(NotFoundException);
    await expect(erasure.eraseCustomer("org-1", "u1", "nope")).rejects.toBeInstanceOf(NotFoundException);
  });
});
