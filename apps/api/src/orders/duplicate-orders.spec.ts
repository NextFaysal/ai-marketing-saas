import { OrdersService } from "./orders.service";

describe("OrdersService - Feature 2: Duplicate Order Blocker & Merge Engine", () => {
  let service: OrdersService;
  let prismaMock: any;
  let auditMock: any;

  beforeEach(() => {
    prismaMock = {
      order: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      orderItem: {
        create: jest.fn(),
      },
    };
    auditMock = {
      log: jest.fn().mockResolvedValue(true),
    };

    service = new OrdersService(
      prismaMock as any,
      undefined, // risk
      {} as any, // integrations
      auditMock as any, // audit
      undefined, // inventory
      undefined, // events
    );
  });

  describe("findDuplicates", () => {
    it("groups non-cancelled orders with the same normalized phone number", async () => {
      const orders = [
        {
          id: "ord-1",
          externalNumber: "101",
          totalAmountMinor: BigInt(120000),
          status: "pending",
          placedAt: new Date("2026-10-14T10:00:00Z"),
          customer: { phone: "01712345678", firstName: "Rahim", lastName: "Ahmed" },
          items: [{ id: "item-1", name: "Shirt", quantity: 1, totalMinor: BigInt(120000) }],
        },
        {
          id: "ord-2",
          externalNumber: "102",
          totalAmountMinor: BigInt(120000),
          status: "pending",
          placedAt: new Date("2026-10-14T11:00:00Z"),
          customer: { phone: "+8801712345678", firstName: "Rahim", lastName: "Ahmed" },
          items: [{ id: "item-2", name: "Shirt", quantity: 1, totalMinor: BigInt(120000) }],
        },
        {
          id: "ord-3",
          externalNumber: "103",
          totalAmountMinor: BigInt(50000),
          status: "pending",
          placedAt: new Date("2026-10-14T12:00:00Z"),
          customer: { phone: "01899999999", firstName: "Karim" },
          items: [{ id: "item-3", name: "Cap", quantity: 1, totalMinor: BigInt(50000) }],
        },
      ];

      prismaMock.order.findMany.mockResolvedValue(orders);

      const res = await service.findDuplicates("org-1");

      expect(res.totalGroups).toBe(1);
      expect(res.totalDuplicateOrders).toBe(2);
      expect(res.groups[0].phoneKey).toBe("1712345678");
      expect(res.groups[0].orders).toHaveLength(2);
    });
  });

  describe("mergeOrders", () => {
    it("aggregates items from duplicate order to primary, updates total, and cancels duplicate", async () => {
      const primaryOrder = {
        id: "ord-primary",
        externalNumber: "ORD-1",
        totalMinor: BigInt(100000),
        status: "pending",
        internalNote: null,
        items: [{ id: "it-1", name: "Pants", quantity: 1, totalMinor: BigInt(100000) }],
        customer: { name: "Rahim" },
      };

      const duplicateOrder = {
        id: "ord-dup",
        externalNumber: "ORD-2",
        totalMinor: BigInt(50000),
        status: "pending",
        items: [{ id: "it-2", productId: "p-2", name: "Belt", sku: "BLT", quantity: 1, priceMinor: BigInt(50000), totalMinor: BigInt(50000) }],
      };

      prismaMock.order.findFirst.mockResolvedValue(primaryOrder);
      prismaMock.order.findMany.mockResolvedValue([duplicateOrder]);
      prismaMock.orderItem.create.mockResolvedValue({ id: "new-it" });
      prismaMock.order.update
        .mockResolvedValueOnce({ id: "ord-dup", status: "cancelled" })
        .mockResolvedValueOnce({
          ...primaryOrder,
          totalMinor: BigInt(150000),
          items: [...primaryOrder.items, duplicateOrder.items[0]],
        });

      const result = await service.mergeOrders("org-1", "user-1", {
        primaryOrderId: "ord-primary",
        duplicateOrderIds: ["ord-dup"],
        mergeReason: "Customer accidentally submitted checkout twice",
      });

      expect(result.success).toBe(true);
      expect(result.mergedCount).toBe(1);

      // Verify item copy
      expect(prismaMock.orderItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: "ord-primary",
          name: "Belt",
        }),
      });

      // Verify duplicate is cancelled
      expect(prismaMock.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "ord-dup" },
          data: expect.objectContaining({
            status: "cancelled",
            internalNote: expect.stringContaining("[MERGED] Merged into Order #ORD-1"),
          }),
        }),
      );

      // Verify audit log
      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          userId: "user-1",
          action: "orders.merged",
          entityId: "ord-primary",
          metadata: expect.objectContaining({ primaryOrderId: "ord-primary", mergedCount: 1 }),
        }),
      );
    });
  });

  describe("list with duplicate tags", () => {
    it("flags orders that share the same phone number in the batch", async () => {
      const orders = [
        {
          id: "ord-a",
          status: "pending",
          subtotalMinor: 1000n,
          totalMinor: 1000n,
          customer: { phone: "01711111111" },
          items: [],
        },
        {
          id: "ord-b",
          status: "pending",
          subtotalMinor: 1000n,
          totalMinor: 1000n,
          customer: { phone: "+8801711111111" },
          items: [],
        },
      ];

      prismaMock.order.count.mockResolvedValue(2);
      prismaMock.order.findMany.mockResolvedValue(orders);

      const res = await service.list("org-1", {});
      expect(res.items[0].duplicate).toBeDefined();
      expect(res.items[0].duplicate.isDuplicate).toBe(true);
      expect(res.items[0].duplicate.count).toBe(2);
      expect(res.items[0].duplicate.duplicateOrderIds).toEqual(["ord-b"]);
    });
  });
});
