import {
  CourierOptimizerService,
  extractDistrictFromAddress,
} from "./courier-optimizer.service";
import { NotFoundException } from "@nestjs/common";

describe("CourierOptimizerService — Smart Courier AI Routing", () => {
  let service: CourierOptimizerService;
  let prismaMock: any;

  beforeEach(() => {
    prismaMock = {
      order: {
        findFirst: jest.fn(),
      },
      integration: {
        findMany: jest.fn(),
      },
      courierShipment: {
        findMany: jest.fn(),
      },
    };

    service = new CourierOptimizerService(prismaMock);
  });

  describe("District Extraction", () => {
    it("extracts English and Bengali district names correctly", () => {
      expect(extractDistrictFromAddress("House 12, Road 4, Dhanmondi, Dhaka")).toBe("Dhaka");
      expect(extractDistrictFromAddress("মিরপুর ১০, ঢাকা ১২১৬")).toBe("Dhaka");
      expect(extractDistrictFromAddress("GEC Circle, Chittagong")).toBe("Chittagong");
      expect(extractDistrictFromAddress("হালিশহর, চট্টগ্রাম")).toBe("Chittagong");
      expect(extractDistrictFromAddress("Zindabazar, Sylhet")).toBe("Sylhet");
      expect(extractDistrictFromAddress("শহীদ মিনার রোড, রাজশাহী")).toBe("Rajshahi");
      expect(extractDistrictFromAddress("চৌরাস্তা, গাজীপুর")).toBe("Gazipur");
    });

    it("falls back to Dhaka when address is missing or unrecognized", () => {
      expect(extractDistrictFromAddress(null)).toBe("Dhaka");
      expect(extractDistrictFromAddress("")).toBe("Dhaka");
      expect(extractDistrictFromAddress("Some random village")).toBe("Dhaka");
    });
  });

  describe("Smart Routing Recommendation", () => {
    it("throws NotFoundException if order does not exist", async () => {
      prismaMock.order.findFirst.mockResolvedValue(null);

      await expect(
        service.getSmartRouting("org-1", "non-existent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("recommends Pathao inside Dhaka by benchmark when no history exists", async () => {
      prismaMock.order.findFirst.mockResolvedValue({
        id: "order-1",
        address: "Dhanmondi, Dhaka",
        customer: null,
      });

      prismaMock.integration.findMany.mockResolvedValue([
        { id: "int-1", provider: "pathao", status: "connected" },
        { id: "int-2", provider: "steadfast", status: "connected" },
      ]);

      prismaMock.courierShipment.findMany.mockResolvedValue([]);

      const result = await service.getSmartRouting("org-1", "order-1");

      expect(result.district).toBe("Dhaka");
      expect(result.isInsideDhaka).toBe(true);
      expect(result.recommendedProvider).toBe("pathao");
      expect(result.confidence).toBe("benchmark");
      expect(result.summaryReason).toContain("পাঠাও");
    });

    it("recommends Steadfast outside Dhaka by benchmark when no history exists", async () => {
      prismaMock.order.findFirst.mockResolvedValue({
        id: "order-2",
        address: "Agrabad, Chittagong",
        customer: null,
      });

      prismaMock.integration.findMany.mockResolvedValue([
        { id: "int-1", provider: "pathao", status: "connected" },
        { id: "int-2", provider: "steadfast", status: "connected" },
      ]);

      prismaMock.courierShipment.findMany.mockResolvedValue([]);

      const result = await service.getSmartRouting("org-1", "order-2");

      expect(result.district).toBe("Chittagong");
      expect(result.isInsideDhaka).toBe(false);
      expect(result.recommendedProvider).toBe("steadfast");
      expect(result.confidence).toBe("benchmark");
      expect(result.summaryReason).toContain("স্টিডফাস্ট");
    });

    it("uses real store historical data when enough samples exist", async () => {
      prismaMock.order.findFirst.mockResolvedValue({
        id: "order-3",
        address: "Chittagong",
        customer: null,
      });

      prismaMock.integration.findMany.mockResolvedValue([
        { id: "int-1", provider: "steadfast", status: "connected" },
        { id: "int-2", provider: "redx", status: "connected" },
      ]);

      // Mock 10 shipments in Chittagong
      // Steadfast: 9 delivered, 1 returned (90% success)
      // RedX: 4 delivered, 6 returned (40% success)
      const mockShipments = [
        ...Array(9).fill({ provider: "steadfast", status: "delivered" }),
        { provider: "steadfast", status: "returned" },
        ...Array(4).fill({ provider: "redx", status: "delivered" }),
        ...Array(6).fill({ provider: "redx", status: "returned" }),
      ];

      prismaMock.courierShipment.findMany.mockResolvedValue(mockShipments);

      const result = await service.getSmartRouting("org-1", "order-3");

      expect(result.district).toBe("Chittagong");
      expect(result.recommendedProvider).toBe("steadfast");
      expect(result.confidence).toBe("high");

      const steadfastCard = result.scorecards.find((c) => c.provider === "steadfast");
      expect(steadfastCard).toBeDefined();
      expect(steadfastCard?.deliveryRate).toBe(0.9);
      expect(steadfastCard?.returnRate).toBe(0.1);
      expect(steadfastCard?.sampleSize).toBe(10);
      expect(steadfastCard?.isWinner).toBe(true);
    });
  });
});
