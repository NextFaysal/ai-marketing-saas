import { InventoryAdGuardService } from "./inventory-ad-guard.service";

describe("InventoryAdGuardService (Feature 3: Inventory Stockout ↔ Meta Ad Auto-Pause Guardrail)", () => {
  let service: InventoryAdGuardService;
  let prismaMock: any;
  let campaignsMock: any;
  let eventsMock: any;

  beforeEach(() => {
    prismaMock = {
      product: {
        findFirst: jest.fn(),
      },
      campaignAd: {
        findMany: jest.fn(),
      },
      campaignPlan: {
        findFirst: jest.fn(),
      },
      inventoryAdGuardLog: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "log-1", ...data })),
        findMany: jest.fn(),
      },
    };

    campaignsMock = {
      setMetaStatus: jest.fn().mockResolvedValue(true),
    };

    eventsMock = {
      emit: jest.fn(),
    };

    service = new InventoryAdGuardService(
      prismaMock as any,
      {} as any, // audit
      campaignsMock as any,
      eventsMock as any,
    );
  });

  describe("checkStockoutAndProtect", () => {
    it("does nothing when stock is above 0", async () => {
      const res = await service.checkStockoutAndProtect("org-1", "prod-1", 5);
      expect(res.protected).toBe(false);
      expect(res.reason).toBe("in_stock");
      expect(campaignsMock.setMetaStatus).not.toHaveBeenCalled();
    });

    it("auto-pauses active published Meta campaigns when product stock reaches 0", async () => {
      prismaMock.product.findFirst.mockResolvedValue({
        id: "prod-1",
        title: "Wireless Earbuds Pro",
      });

      prismaMock.campaignAd.findMany.mockResolvedValue([
        {
          id: "ad-1",
          name: "Earbuds Promo 1",
          productId: "prod-1",
          adSet: {
            plan: {
              id: "plan-101",
              name: "Flash Sale Campaign",
              status: "published",
              metaStatus: "ACTIVE",
            },
          },
        },
      ]);

      const res = await service.checkStockoutAndProtect("org-1", "prod-1", 0);

      expect(res.protected).toBe(true);
      expect(res.pausedCount).toBe(1);
      expect(campaignsMock.setMetaStatus).toHaveBeenCalledWith(
        "org-1",
        "system_ad_guard",
        "plan-101",
        "PAUSED",
      );
      expect(prismaMock.inventoryAdGuardLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: "org-1",
          productId: "prod-1",
          action: "AUTO_PAUSED",
          campaignPlanId: "plan-101",
        }),
      });
      expect(eventsMock.emit).toHaveBeenCalledWith(
        "ad_guard.auto_paused",
        expect.objectContaining({
          productId: "prod-1",
          planId: "plan-101",
        }),
      );
    });
  });

  describe("checkRestockAndNotify", () => {
    it("finds auto-paused campaigns and alerts merchant when product is restocked", async () => {
      prismaMock.product.findFirst.mockResolvedValue({
        id: "prod-1",
        title: "Wireless Earbuds Pro",
      });

      prismaMock.inventoryAdGuardLog.findMany.mockResolvedValue([
        {
          id: "log-1",
          campaignPlanId: "plan-101",
          action: "AUTO_PAUSED",
        },
      ]);

      prismaMock.campaignPlan.findFirst.mockResolvedValue({
        id: "plan-101",
        name: "Flash Sale Campaign",
        metaStatus: "PAUSED",
      });

      const res = await service.checkRestockAndNotify("org-1", "prod-1", 20);

      expect(res.notified).toBe(true);
      expect(res.eligibleCampaignCount).toBe(1);
      expect(prismaMock.inventoryAdGuardLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "ALERT_SENT",
          currentStock: 20,
        }),
      });
      expect(eventsMock.emit).toHaveBeenCalledWith(
        "ad_guard.restocked",
        expect.objectContaining({
          productId: "prod-1",
          newStock: 20,
        }),
      );
    });
  });

  describe("resumeCampaign", () => {
    it("re-activates the campaign on Meta and logs AUTO_RESUMED", async () => {
      prismaMock.campaignPlan.findFirst.mockResolvedValue({
        id: "plan-101",
        name: "Flash Sale Campaign",
      });

      const res = await service.resumeCampaign("org-1", "user-1", "plan-101");

      expect(res.success).toBe(true);
      expect(campaignsMock.setMetaStatus).toHaveBeenCalledWith(
        "org-1",
        "user-1",
        "plan-101",
        "ACTIVE",
      );
      expect(prismaMock.inventoryAdGuardLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "AUTO_RESUMED",
          campaignPlanId: "plan-101",
        }),
      });
    });
  });
});
