import { BadRequestException, NotFoundException } from "@nestjs/common";
import { StorefrontService } from "./storefront.service";

function makeFakeTable() {
  const rows: any[] = [];
  return {
    rows,
    findFirst: async ({ where }: any) => {
      return rows.find((r) => {
        for (const [k, v] of Object.entries(where ?? {})) {
          if (r[k] !== v) return false;
        }
        return true;
      }) ?? null;
    },
    findMany: async ({ where }: any) => {
      return rows.filter((r) => {
        if (!where) return true;
        if (where.OR) {
          return where.OR.some((sub: any) => {
            for (const [k, v] of Object.entries(sub)) {
              if (r[k] !== v) return false;
            }
            return true;
          });
        }
        for (const [k, v] of Object.entries(where)) {
          if (r[k] !== v) return false;
        }
        return true;
      });
    },
    update: async ({ where, data }: any) => {
      const idx = rows.findIndex((r) => r.id === where.id);
      if (idx >= 0) {
        rows[idx] = { ...rows[idx], ...data };
        return rows[idx];
      }
      return null;
    },
  };
}

describe("StorefrontService NDR Recovery", () => {
  let service: StorefrontService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      organization: makeFakeTable(),
      storefrontSetting: makeFakeTable(),
      order: makeFakeTable(),
      customer: makeFakeTable(),
      orderItem: makeFakeTable(),
      deliverySlot: makeFakeTable(),
      pickupPoint: makeFakeTable(),
      installmentPlan: makeFakeTable(),
      courierShipment: makeFakeTable(),
      paymentVerification: makeFakeTable(),
      integration: makeFakeTable(),
    };

    prisma.organization.rows.push({
      id: "org-1",
      slug: "brand-bd",
      name: "Brand BD",
      brandName: "Brand BD",
    });

    prisma.storefrontSetting.rows.push({
      id: "set-1",
      organizationId: "org-1",
      shopEnabled: true,
      trackingPageEnabled: true,
    });

    prisma.customer.rows.push({
      id: "c1",
      organizationId: "org-1",
      phone: "01700000000",
      firstName: "গ্রাহক",
    });

    prisma.order.rows.push({
      id: "ord-1",
      organizationId: "org-1",
      customerId: "c1",
      externalNumber: "ORD-9999",
      status: "processing",
      notes: "আগের নোট",
      totalMinor: 150000n,
    });

    service = new StorefrontService(prisma, null as any);
  });

  it("successfully reschedules delivery date via NDR recovery", async () => {
    const res = await service.ndrRecovery("brand-bd", {
      phone: "01700000000",
      orderNumber: "ORD-9999",
      action: "reschedule",
      rescheduleDate: "2026-10-20",
    });

    expect(res.success).toBe(true);
    expect(res.action).toBe("reschedule");
    expect(res.updatedNotes).toContain("2026-10-20");

    const updated = prisma.order.rows.find((r: any) => r.id === "ord-1");
    expect(updated.notes).toContain("2026-10-20");
    expect(updated.notes).toContain("আগের নোট");
  });

  it("successfully updates alternative phone number", async () => {
    const res = await service.ndrRecovery("brand-bd", {
      phone: "01700000000",
      orderNumber: "ORD-9999",
      action: "alt_phone",
      altPhone: "01811111111",
    });

    expect(res.success).toBe(true);
    expect(res.updatedNotes).toContain("01811111111");
  });

  it("successfully updates address and landmark instructions", async () => {
    const res = await service.ndrRecovery("brand-bd", {
      phone: "01700000000",
      orderNumber: "ORD-9999",
      action: "update_address",
      updatedAddress: "রোড ৫, বাসা ২০, ধানমন্ডি",
    });

    expect(res.success).toBe(true);
    expect(res.updatedNotes).toContain("ধানমন্ডি");
  });

  it("rejects NDR changes on already delivered/terminal orders", async () => {
    prisma.order.rows[0].status = "delivered";

    await expect(
      service.ndrRecovery("brand-bd", {
        phone: "01700000000",
        orderNumber: "ORD-9999",
        action: "reschedule",
        rescheduleDate: "2026-10-20",
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
