import { GrowthCopilotService } from "./growth-copilot.service";

describe("GrowthCopilotService — AI Growth Copilot & Ad Optimizer", () => {
  let service: GrowthCopilotService;
  let prismaMock: any;
  let auditMock: any;
  let proposalsMock: any;

  beforeEach(() => {
    prismaMock = {
      campaignPlan: {
        findMany: jest.fn(),
      },
      dailyAdMetric: {
        findMany: jest.fn(),
      },
      order: {
        findMany: jest.fn(),
      },
      product: {
        findMany: jest.fn(),
      },
      abandonedStoreCheckout: {
        count: jest.fn(),
      },
    };

    auditMock = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    proposalsMock = {
      propose: jest.fn().mockResolvedValue({ id: "prop-1", type: "pause_campaign" }),
      approve: jest.fn().mockResolvedValue({ id: "prop-1", status: "executed" }),
    };

    service = new GrowthCopilotService(prismaMock, auditMock, proposalsMock);
  });

  describe("runAudit", () => {
    it("detects bleeding ads and generates critical pause recommendation", async () => {
      const now = new Date();

      prismaMock.campaignPlan.findMany.mockResolvedValue([
        { id: "plan-1", name: "Summer Sale", externalCampaignId: "camp-123" },
      ]);

      // Ad spent 2,000 BDT with 0 purchases
      prismaMock.dailyAdMetric.findMany.mockResolvedValue([
        {
          campaignExternalId: "camp-123",
          campaignName: "Summer Sale",
          spendMinor: "200000",
          conversions: 0,
          date: now,
        },
      ]);

      prismaMock.order.findMany.mockResolvedValue([]);
      prismaMock.product.findMany.mockResolvedValue([]);
      prismaMock.abandonedStoreCheckout.count.mockResolvedValue(0);

      const audit = await service.runAudit("org-1");

      expect(audit.overallHealthScore).toBeLessThan(100);
      const bleeder = audit.opportunities.find((o) => o.category === "pause_bleeder");
      expect(bleeder).toBeDefined();
      expect(bleeder?.priority).toBe("critical");
      expect(bleeder?.title).toContain("Summer Sale");
      expect(bleeder?.actionType).toBe("pause_campaign");
      expect(bleeder?.actionPayload.planId).toBe("plan-1");
    });

    it("detects winning scalable campaigns and generates scale recommendation", async () => {
      const now = new Date();

      prismaMock.campaignPlan.findMany.mockResolvedValue([
        { id: "plan-2", name: "Winning Shoes", externalCampaignId: "camp-456" },
      ]);

      // Spent 1,000 BDT with 10 purchases
      prismaMock.dailyAdMetric.findMany.mockResolvedValue([
        {
          campaignExternalId: "camp-456",
          campaignName: "Winning Shoes",
          spendMinor: "100000",
          conversions: 10,
          date: now,
        },
      ]);

      prismaMock.order.findMany.mockResolvedValue([
        { totalMinor: "500000", status: "completed" },
      ]);
      prismaMock.product.findMany.mockResolvedValue([]);
      prismaMock.abandonedStoreCheckout.count.mockResolvedValue(0);

      const audit = await service.runAudit("org-1");

      const scaler = audit.opportunities.find((o) => o.category === "scale_winner");
      expect(scaler).toBeDefined();
      expect(scaler?.priority).toBe("high");
      expect(scaler?.title).toContain("বাজেট ২০% বৃদ্ধি করুন");
      expect(scaler?.actionType).toBe("scale_budget");
    });

    it("detects low stock warning on active products", async () => {
      prismaMock.campaignPlan.findMany.mockResolvedValue([]);
      prismaMock.dailyAdMetric.findMany.mockResolvedValue([]);
      prismaMock.order.findMany.mockResolvedValue([]);
      prismaMock.abandonedStoreCheckout.count.mockResolvedValue(0);

      prismaMock.product.findMany.mockResolvedValue([
        { id: "prod-1", name: "সিল্ক শাড়ি", stockQuantity: 4 },
      ]);

      const audit = await service.runAudit("org-1");

      const stockAlert = audit.opportunities.find((o) => o.category === "inventory_guard");
      expect(stockAlert).toBeDefined();
      expect(stockAlert?.summary).toContain("সিল্ক শাড়ি");
      expect(stockAlert?.metrics.stockRemaining).toBe(4);
    });

    it("detects abandoned carts and suggests recovery broadcast", async () => {
      prismaMock.campaignPlan.findMany.mockResolvedValue([]);
      prismaMock.dailyAdMetric.findMany.mockResolvedValue([]);
      prismaMock.order.findMany.mockResolvedValue([]);
      prismaMock.product.findMany.mockResolvedValue([]);
      prismaMock.abandonedStoreCheckout.count.mockResolvedValue(15);

      const audit = await service.runAudit("org-1");

      const cartAlert = audit.opportunities.find((o) => o.category === "retargeting");
      expect(cartAlert).toBeDefined();
      expect(cartAlert?.title).toContain("15 জন গ্রাহক কার্ট ফেলে চলে গেছেন");
      expect(cartAlert?.actionType).toBe("create_broadcast");
    });
  });

  describe("applyAction", () => {
    it("pauses campaign via proposals execution", async () => {
      const res = await service.applyAction("org-1", "user-1", "opp-1", "pause_campaign", {
        planId: "plan-1",
      });

      expect(res.success).toBe(true);
      expect(proposalsMock.propose).toHaveBeenCalledWith("org-1", "user-1", {
        type: "pause_campaign",
        planId: "plan-1",
      });
      expect(proposalsMock.approve).toHaveBeenCalledWith("org-1", "user-1", "prop-1");
      expect(auditMock.log).toHaveBeenCalled();
    });

    it("creates broadcast draft for cart recovery", async () => {
      const res = await service.applyAction("org-1", "user-1", "opp-2", "create_broadcast", {
        channel: "whatsapp",
      });

      expect(res.success).toBe(true);
      expect(proposalsMock.propose).toHaveBeenCalledWith(
        "org-1",
        "user-1",
        expect.objectContaining({ type: "create_broadcast_draft" }),
      );
    });
  });
});
