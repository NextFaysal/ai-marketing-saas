import { CourierNdrService, isNdrStatus } from "./courier-ndr.service";

describe("CourierNdrService (Feature 1: NDR Interceptor & Recovery Hub)", () => {
  let service: CourierNdrService;
  let prismaMock: any;
  let inboxMock: any;
  let eventsMock: any;

  beforeEach(() => {
    prismaMock = {
      courierNdrIncident: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      courierShipment: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      order: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    };

    inboxMock = {
      sendAutomatedMessage: jest.fn().mockResolvedValue({ id: "msg-123" }),
    };

    eventsMock = {
      emit: jest.fn(),
    };

    const auditMock = { log: jest.fn() } as any;

    service = new CourierNdrService(
      prismaMock as any,
      auditMock,
      inboxMock as any,
      eventsMock as any,
    );
  });

  describe("isNdrStatus helper", () => {
    it("detects NDR and failed delivery statuses correctly", () => {
      expect(isNdrStatus("hold")).toBe(true);
      expect(isNdrStatus("failed_attempt")).toBe(true);
      expect(isNdrStatus("delivery_failed")).toBe(true);
      expect(isNdrStatus("customer_unreachable")).toBe(true);
      expect(isNdrStatus("cancelled_by_customer")).toBe(true);
      expect(isNdrStatus("delivered")).toBe(false);
      expect(isNdrStatus("in_transit")).toBe(false);
      expect(isNdrStatus(null)).toBe(false);
    });
  });

  describe("interceptNdr", () => {
    it("creates an NDR incident and contacts the customer via inbox when conversation exists", async () => {
      prismaMock.courierNdrIncident.findFirst.mockResolvedValue(null);
      prismaMock.courierNdrIncident.create.mockResolvedValue({
        id: "ndr-1",
        organizationId: "org-1",
        shipmentId: "ship-1",
        orderId: "ord-1",
        status: "OPEN",
        trackingCode: "TRK123",
        provider: "steadfast",
      });
      prismaMock.courierNdrIncident.update.mockResolvedValue({
        id: "ndr-1",
        status: "CUSTOMER_CONTACTED",
      });
      prismaMock.order.findFirst.mockResolvedValue({
        id: "ord-1",
        externalNumber: "ORD-999",
        conversationId: "conv-1",
        customer: { phone: "01700000000", name: "Rahim" },
      });

      const shipment = {
        id: "ship-1",
        orderId: "ord-1",
        provider: "steadfast",
        trackingCode: "TRK123",
        status: "hold",
        trackingToken: "tok-abc",
        recipientPhone: "01700000000",
      };

      const result = await service.interceptNdr("org-1", shipment, "customer_unreachable");
      expect(result).toBeDefined();
      expect(prismaMock.courierNdrIncident.create).toHaveBeenCalled();
      expect(inboxMock.sendAutomatedMessage).toHaveBeenCalledWith(
        "org-1",
        "conv-1",
        expect.stringContaining("ডেলিভারি সতর্কবার্তা"),
        "courier_update",
      );
      expect(eventsMock.emit).toHaveBeenCalledWith(
        "courier.ndr_intercepted",
        expect.objectContaining({ organizationId: "org-1", trackingCode: "TRK123" }),
      );
    });
  });

  describe("list", () => {
    it("returns calculated metrics and enriched incidents", async () => {
      prismaMock.courierNdrIncident.findMany.mockResolvedValue([
        {
          id: "ndr-1",
          orderId: "ord-1",
          status: "OPEN",
          provider: "pathao",
          trackingCode: "PATH-1",
          createdAt: new Date(),
        },
      ]);
      prismaMock.courierNdrIncident.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(3) // open
        .mockResolvedValueOnce(3) // contacted
        .mockResolvedValueOnce(2) // rescheduled
        .mockResolvedValueOnce(2) // resolved
        .mockResolvedValueOnce(0); // returned

      prismaMock.order.findMany.mockResolvedValue([
        {
          id: "ord-1",
          externalNumber: "ORD-101",
          totalAmountMinor: BigInt(250000),
          customer: { name: "Karim", phone: "01800000000" },
        },
      ]);

      const res = await service.list("org-1");
      expect(res.metrics.total).toBe(10);
      expect(res.metrics.open).toBe(3);
      expect(res.metrics.recoveryRatePercent).toBe(40); // (2+2)/10 * 100
      expect(res.incidents[0].orderNumber).toBe("ORD-101");
      expect(res.incidents[0].customerName).toBe("Karim");
    });
  });

  describe("customerRespond", () => {
    it("allows customer to confirm reschedule for tomorrow via tracking link", async () => {
      prismaMock.courierShipment.findFirst.mockResolvedValue({
        id: "ship-1",
        organizationId: "org-1",
        trackingToken: "token-xyz",
      });
      prismaMock.courierNdrIncident.findFirst.mockResolvedValue({
        id: "ndr-1",
        shipmentId: "ship-1",
        status: "CUSTOMER_CONTACTED",
        notes: "Initial hold",
      });
      prismaMock.courierNdrIncident.update.mockResolvedValue({
        id: "ndr-1",
        status: "RESCHEDULED",
      });

      const response = await service.customerRespond("token-xyz", {
        action: "CONFIRMED_TOMORROW",
      });

      expect(response.success).toBe(true);
      expect(prismaMock.courierNdrIncident.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "ndr-1" },
          data: expect.objectContaining({
            status: "RESCHEDULED",
            customerFeedback: "CONFIRMED_TOMORROW",
          }),
        }),
      );
    });

    it("allows customer to update address when address was incomplete", async () => {
      prismaMock.courierShipment.findFirst.mockResolvedValue({
        id: "ship-1",
        organizationId: "org-1",
        trackingToken: "token-xyz",
      });
      prismaMock.courierNdrIncident.findFirst.mockResolvedValue({
        id: "ndr-1",
        shipmentId: "ship-1",
        status: "CUSTOMER_CONTACTED",
      });
      prismaMock.courierShipment.update.mockResolvedValue({});
      prismaMock.courierNdrIncident.update.mockResolvedValue({});

      const response = await service.customerRespond("token-xyz", {
        action: "CHANGE_ADDRESS",
        newAddress: "House 12, Road 4, Dhanmondi, Dhaka",
        note: "Please call before coming",
      });

      expect(response.success).toBe(true);
      expect(prismaMock.courierShipment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { recipientAddress: "House 12, Road 4, Dhanmondi, Dhaka" },
        }),
      );
    });
  });
});
