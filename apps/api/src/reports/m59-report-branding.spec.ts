import { NotFoundException } from "@nestjs/common";
import { ReportSharesService } from "./report-shares.service";

/**
 * Milestone 59 — the shareable client report under white-label
 * branding. The token mechanism itself is M20's (randomBytes token,
 * expiry checked at read, revoke = row deleted); this spec proves
 * the M59 additions — branding payload + delivery summary — and
 * re-proves the four token states against them.
 */

function inRange(row: any, where: any): boolean {
  if (where.organizationId && row.organizationId !== where.organizationId) return false;
  const c = where.createdAt;
  if (c) {
    const t = new Date(row.createdAt).getTime();
    if (c.gte && !(t >= new Date(c.gte).getTime())) return false;
    if (c.lt && !(t < new Date(c.lt).getTime())) return false;
  }
  return true;
}

function makeService() {
  const now = new Date();
  const shares = [
    { id: "s-1", organizationId: "org-1", token: "tok-valid", title: "Client Report", days: 30, expiresAt: new Date(now.getTime() + 7 * 86400000), createdById: "u-1", createdAt: now },
    { id: "s-2", organizationId: "org-1", token: "tok-expired", title: "Old", days: 30, expiresAt: new Date(now.getTime() - 86400000), createdById: "u-1", createdAt: now },
  ];
  const shipments = [
    { organizationId: "org-1", status: "delivered", createdAt: now },
    { organizationId: "org-1", status: "partial_delivered", createdAt: now },
    { organizationId: "org-1", status: "returned", createdAt: now },
    { organizationId: "org-1", status: "in_transit", createdAt: now },
    { organizationId: "org-2", status: "returned", createdAt: now },
    { organizationId: "org-1", status: "returned", createdAt: new Date(now.getTime() - 400 * 86400000) },
  ];
  const prisma: any = {
    reportShare: {
      findUnique: async ({ where }: any) => shares.find((s) => s.token === where.token) ?? null,
      findFirst: async ({ where }: any) => shares.find((s) => s.id === where.id && s.organizationId === where.organizationId) ?? null,
      delete: async ({ where }: any) => {
        const i = shares.findIndex((s) => s.id === where.id);
        if (i >= 0) shares.splice(i, 1);
        return {};
      },
    },
    organization: {
      findUnique: async ({ where }: any) => (where.id === "org-1"
        ? { id: "org-1", name: "Legal Shop Name Ltd", brandName: "Amar Dokan", logoUrl: "/public/branding/org-1/logo", primaryColor: "#0E7490" }
        : null),
    },
    courierShipment: {
      findMany: async ({ where }: any) => shipments.filter((s) => inRange(s, where)),
    },
  };
  const audit: any = { log: async () => undefined };
  const analytics: any = {
    computeRange: async () => ({
      totals: { orders: 12, revenueMinor: 150000n, adSpendMinor: 20000n, impressions: 1000, clicks: 50, platformConversions: 9 },
      kpis: { mer: 7.5, platformRoas: 6.1, ctrPercent: 5, cpcMinor: 400, cpaMinor: 2222 },
      campaigns: [],
    }),
  };
  return { service: new ReportSharesService(prisma, audit, analytics), shares };
}

describe("M59 branded public report", () => {
  it("returns branding (brand name wins over legal name) + delivery summary for the window", async () => {
    const { service } = makeService();
    const out: any = await service.publicReport("tok-valid");
    expect(out.branding).toEqual({ name: "Amar Dokan", logoUrl: "/public/branding/org-1/logo", primaryColor: "#0E7490" });
    expect(out.business).toBe("Legal Shop Name Ltd");
    // org-1 in-window: delivered + partial_delivered = 2, returned = 1
    // (org-2's return and the 400-day-old return are excluded).
    expect(out.delivery).toEqual({ shipments: 4, delivered: 2, returned: 1, returnRatePercent: 33.3 });
    expect(out.totals.orders).toBe(12);
  });

  it("wrong token -> NotFound", async () => {
    const { service } = makeService();
    await expect(service.publicReport("tok-nope")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("expired token -> NotFound", async () => {
    const { service } = makeService();
    await expect(service.publicReport("tok-expired")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("revoked link dies instantly (revoke deletes the row)", async () => {
    const { service } = makeService();
    await service.publicReport("tok-valid");
    await service.revoke("org-1", "s-1");
    await expect(service.publicReport("tok-valid")).rejects.toBeInstanceOf(NotFoundException);
  });
});
