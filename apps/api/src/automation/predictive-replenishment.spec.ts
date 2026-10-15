import { PredictiveReplenishmentService } from "./predictive-replenishment.service";

describe("PredictiveReplenishmentService (Feature 6: Predictive Replenishment & Auto Re-order)", () => {
  let service: PredictiveReplenishmentService;
  let prismaMock: any;
  let auditMock: any;

  beforeEach(() => {
    prismaMock = {
      product: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      order: {
        findMany: jest.fn(),
      },
      predictiveReplenishment: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    auditMock = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    service = new PredictiveReplenishmentService(prismaMock, auditMock);
  });

  describe("generateReplenishmentPredictions", () => {
    it("detects consumable product orders and generates replenishment schedule", async () => {
      // 1. Mock consumable products
      prismaMock.product.findMany.mockResolvedValue([
        {
          id: "prod_ghee",
          name: "Organic Ghee 1kg",
          sku: "GHEE-1KG",
          replenishmentDays: 30, // 30-day consumable cycle
          replenishmentReminderText: "আপনার প্রিমিয়াম ঘি কি শেষ হয়ে এসেছে? ৫% ছাড়ে রি-অর্ডার করুন!",
        },
      ]);

      // 2. Mock completed order placed 28 days ago (2 days until replenishment due!)
      const pastDeliveredDate = new Date();
      pastDeliveredDate.setDate(pastDeliveredDate.getDate() - 28);

      prismaMock.order.findMany.mockResolvedValue([
        {
          id: "ord_100",
          status: "completed",
          placedAt: pastDeliveredDate,
          customer: {
            name: "Sadia Rahman",
            phone: "01755555555",
          },
          items: [
            {
              productId: "prod_ghee",
              name: "Organic Ghee 1kg",
              quantity: 1,
            },
          ],
        },
      ]);

      // No existing prediction for this order
      prismaMock.predictiveReplenishment.findFirst.mockResolvedValue(null);
      prismaMock.predictiveReplenishment.create.mockImplementation((args: any) => ({
        id: "rep_1",
        ...args.data,
      }));

      const result = await service.generateReplenishmentPredictions("org_1");

      expect(result.createdCount).toBe(1);
      expect(prismaMock.predictiveReplenishment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: "org_1",
            orderId: "ord_100",
            productName: "Organic Ghee 1kg",
            customerName: "Sadia Rahman",
            customerPhone: "01755555555",
            replenishmentDays: 30,
            status: "DUE", // within 5 days of due date
          }),
        }),
      );
    });
  });

  describe("listReplenishments", () => {
    it("returns items with daysUntilDue and calculates conversion rate and recovered LTV", async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const items = [
        {
          id: "rep_1",
          customerName: "Sadia Rahman",
          customerPhone: "01755555555",
          productName: "Organic Ghee 1kg",
          predictedDate: tomorrow,
          status: "DUE",
        },
        {
          id: "rep_2",
          customerName: "Fahim Ahmed",
          customerPhone: "01844444444",
          productName: "Vitamin C Serum",
          predictedDate: tomorrow,
          status: "REORDERED",
        },
        {
          id: "rep_3",
          customerName: "Nusrat Jahan",
          customerPhone: "01933333333",
          productName: "Baby Diaper Large",
          predictedDate: tomorrow,
          status: "REMINDED",
        },
      ];

      prismaMock.predictiveReplenishment.findMany.mockResolvedValue(items);

      const result = await service.listReplenishments("org_1");

      expect(result.items.length).toBe(3);
      expect(result.items[0].daysUntilDue).toBeLessThanOrEqual(2);
      expect(result.kpi.totalTracked).toBe(3);
      expect(result.kpi.reorderedCount).toBe(1);
      expect(result.kpi.remindedCount).toBe(1);
      expect(result.kpi.conversionRatePercent).toBe(50); // 1 reordered / (1 reminded + 1 reordered) = 50%
      expect(result.kpi.estimatedRecoveredLtvBdt).toBe(1200);
    });
  });

  describe("sendReminder & markReordered", () => {
    it("sends reminder, sets status to REMINDED and logs audit", async () => {
      prismaMock.predictiveReplenishment.findFirst.mockResolvedValue({
        id: "rep_1",
        organizationId: "org_1",
        customerName: "Sadia Rahman",
        customerPhone: "01755555555",
        productName: "Organic Ghee 1kg",
        discountCode: "REORDER5",
      });

      prismaMock.predictiveReplenishment.update.mockResolvedValue({
        id: "rep_1",
        status: "REMINDED",
        lastRemindedAt: new Date(),
      });

      const res = await service.sendReminder("org_1", "rep_1");
      expect(res.success).toBe(true);
      expect(prismaMock.predictiveReplenishment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "rep_1" },
          data: expect.objectContaining({ status: "REMINDED" }),
        }),
      );
      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "replenishment.reminder_sent",
          entityId: "rep_1",
        }),
      );
    });

    it("marks replenishment as reordered with linked order", async () => {
      prismaMock.predictiveReplenishment.findFirst.mockResolvedValue({
        id: "rep_1",
        organizationId: "org_1",
        productName: "Organic Ghee 1kg",
        customerPhone: "01755555555",
      });

      prismaMock.predictiveReplenishment.update.mockResolvedValue({
        id: "rep_1",
        status: "REORDERED",
        reorderOrderId: "new_order_888",
      });

      const res = await service.markReordered("org_1", "rep_1", {
        reorderOrderId: "new_order_888",
      });

      expect(res.success).toBe(true);
      expect(prismaMock.predictiveReplenishment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "rep_1" },
          data: expect.objectContaining({
            status: "REORDERED",
            reorderOrderId: "new_order_888",
          }),
        }),
      );
    });
  });

  describe("configureProductCycle", () => {
    it("configures replenishmentDays on product", async () => {
      prismaMock.product.findFirst.mockResolvedValue({
        id: "prod_1",
        name: "Face Wash 150ml",
      });

      prismaMock.product.update.mockResolvedValue({
        id: "prod_1",
        name: "Face Wash 150ml",
        replenishmentDays: 45,
      });

      const res = await service.configureProductCycle("org_1", "prod_1", {
        replenishmentDays: 45,
        replenishmentReminderText: "আপনার ফেসওয়াশ কি শেষ? নতুন স্টক থেকে অর্ডার করুন!",
      });

      expect(res.success).toBe(true);
      expect(res.product.replenishmentDays).toBe(45);
    });
  });
});
