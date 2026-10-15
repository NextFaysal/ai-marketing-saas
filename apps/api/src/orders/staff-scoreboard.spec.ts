import { OrdersService } from "./orders.service";

describe("OrdersService - Feature 5: Staff Performance & Sales Attribution Scoreboard", () => {
  let service: OrdersService;
  let prismaMock: any;

  beforeEach(() => {
    prismaMock = {
      order: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      membership: {
        findMany: jest.fn(),
      },
    };

    service = new OrdersService(prismaMock);
  });

  describe("getStaffScoreboard", () => {
    it("computes delivery rates, revenue, and commissions per staff member", async () => {
      // Mock team memberships
      prismaMock.membership.findMany.mockResolvedValue([
        {
          userId: "agent_1",
          role: "SUPPORT_AGENT",
          user: { id: "agent_1", name: "Tamim Iqbal", email: "tamim@store.com" },
        },
        {
          userId: "agent_2",
          role: "SUPPORT_AGENT",
          user: { id: "agent_2", name: "Mushfiqur Rahim", email: "mushi@store.com" },
        },
      ]);

      // Mock orders handled by agents and unassigned
      prismaMock.order.findMany.mockResolvedValue([
        // Agent 1: 2 completed (delivered), 1 returned
        {
          id: "ord_1",
          agentId: "agent_1",
          status: "completed",
          totalMinor: 250000n, // 2500 BDT
          commissionMinor: 0n,
          confirmedAt: new Date(),
        },
        {
          id: "ord_2",
          agentId: "agent_1",
          status: "completed",
          totalMinor: 150000n, // 1500 BDT
          commissionMinor: 0n,
          confirmedAt: new Date(),
        },
        {
          id: "ord_3",
          agentId: "agent_1",
          status: "returned",
          totalMinor: 100000n,
          commissionMinor: 0n,
          confirmedAt: new Date(),
        },

        // Agent 2: 1 completed, 0 returned, 1 in-flight
        {
          id: "ord_4",
          agentId: "agent_2",
          status: "completed",
          totalMinor: 300000n, // 3000 BDT
          commissionMinor: 10000n, // custom 100 BDT commission
          confirmedAt: new Date(),
        },
        {
          id: "ord_5",
          agentId: "agent_2",
          status: "processing",
          totalMinor: 120000n,
          commissionMinor: 0n,
          confirmedAt: new Date(),
        },

        // Unassigned order
        {
          id: "ord_6",
          agentId: null,
          status: "completed",
          totalMinor: 50000n,
          commissionMinor: 0n,
          confirmedAt: null,
        },
      ]);

      const result = await service.getStaffScoreboard("org_1", {
        commissionPerDeliveryBdt: 50,
      });

      expect(result.totalAgents).toBe(2);

      // Agent 1 checks:
      const a1 = result.leaderboard.find((l) => l.agentId === "agent_1")!;
      expect(a1.name).toBe("Tamim Iqbal");
      expect(a1.totalOrders).toBe(3);
      expect(a1.deliveredOrders).toBe(2);
      expect(a1.returnedOrders).toBe(1);
      expect(a1.deliveredRevenueBdt).toBe(4000); // 2500 + 1500
      expect(a1.deliveryRatePercent).toBe(66.7); // 2 / (2 + 1) = 66.66%
      expect(a1.returnRatePercent).toBe(33.3);
      expect(a1.totalCommissionBdt).toBe(100); // 2 delivered * 50 BDT

      // Agent 2 checks:
      const a2 = result.leaderboard.find((l) => l.agentId === "agent_2")!;
      expect(a2.name).toBe("Mushfiqur Rahim");
      expect(a2.totalOrders).toBe(2);
      expect(a2.deliveredOrders).toBe(1);
      expect(a2.inFlightOrders).toBe(1);
      expect(a2.deliveredRevenueBdt).toBe(3000);
      expect(a2.deliveryRatePercent).toBe(100);
      expect(a2.totalCommissionBdt).toBe(100); // custom 100 BDT commission

      // Unassigned checks:
      const unassigned = result.leaderboard.find((l) => l.agentId === "unassigned")!;
      expect(unassigned.totalOrders).toBe(1);
      expect(unassigned.deliveredOrders).toBe(1);
    });
  });

  describe("assignAgent & bulkAssignAgent", () => {
    it("assigns an agent to an individual order", async () => {
      prismaMock.order.findFirst.mockResolvedValue({
        id: "ord_1",
        organizationId: "org_1",
        commissionMinor: 0n,
      });

      prismaMock.order.update.mockResolvedValue({
        id: "ord_1",
        organizationId: "org_1",
        agentId: "agent_1",
        confirmedAt: new Date(),
        commissionMinor: 7500n,
        totalMinor: 100000n,
      });

      const updated = await service.assignAgent("org_1", "ord_1", "agent_1", 7500);
      expect(updated.id).toBe("ord_1");
      expect(prismaMock.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "ord_1" },
          data: expect.objectContaining({
            agentId: "agent_1",
            commissionMinor: 7500n,
          }),
        }),
      );
    });

    it("bulk assigns multiple orders to an agent", async () => {
      prismaMock.order.updateMany.mockResolvedValue({ count: 5 });

      const res = await service.bulkAssignAgent("org_1", ["o1", "o2", "o3", "o4", "o5"], "agent_1");
      expect(res.success).toBe(true);
      expect(res.updatedCount).toBe(5);
      expect(prismaMock.order.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org_1",
          id: { in: ["o1", "o2", "o3", "o4", "o5"] },
        },
        data: expect.objectContaining({
          agentId: "agent_1",
        }),
      });
    });
  });
});
