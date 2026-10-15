import { CourierReconciliationService } from "./courier-reconciliation.service";

describe("CourierReconciliationService (Feature 4: Courier COD Disbursement Reconciliation)", () => {
  let service: CourierReconciliationService;
  let prismaMock: any;
  let auditMock: any;

  beforeEach(() => {
    prismaMock = {
      courierShipment: {
        findMany: jest.fn(),
      },
      courierDisbursementBatch: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      courierDisbursementItem: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    auditMock = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    service = new CourierReconciliationService(prismaMock, auditMock);
  });

  describe("processDisbursementBatch", () => {
    it("correctly reconciles matched, underpaid, and unknown parcels", async () => {
      // Mock existing shipments in system
      prismaMock.courierShipment.findMany.mockResolvedValue([
        {
          id: "ship_1",
          orderId: "ord_1",
          trackingCode: "ST-1001",
          codAmountMinor: 150000n, // 1500 BDT
          consignmentId: "CN-1",
        },
        {
          id: "ship_2",
          orderId: "ord_2",
          trackingCode: "ST-1002",
          codAmountMinor: 200000n, // 2000 BDT
          consignmentId: "CN-2",
        },
      ]);

      prismaMock.courierDisbursementBatch.create.mockImplementation((args: any) => {
        return {
          id: "batch_1",
          ...args.data,
          items: args.data.items.create.map((it: any, idx: number) => ({
            id: `item_${idx + 1}`,
            ...it,
          })),
        };
      });

      const result = await service.processDisbursementBatch("org_1", {
        provider: "steadfast",
        referenceNo: "DISB-2026-OCT-14",
        items: [
          // Matched item: 1500 BDT collected, 120 fee
          {
            trackingCode: "ST-1001",
            courierCollectedMinor: 150000,
            courierFeeMinor: 12000,
            netPaidMinor: 138000,
          },
          // Underpaid item: system says 2000 BDT, courier remitted only 1200 BDT
          {
            trackingCode: "ST-1002",
            courierCollectedMinor: 120000,
            courierFeeMinor: 10000,
            netPaidMinor: 110000,
          },
          // Unknown tracking code not in our database
          {
            trackingCode: "ST-9999",
            courierCollectedMinor: 50000,
            courierFeeMinor: 6000,
            netPaidMinor: 44000,
          },
        ],
      });

      expect(result.id).toBe("batch_1");
      expect(result.matchedCount).toBe(1);
      expect(result.discrepancyCount).toBe(1);
      expect(result.unmatchedCount).toBe(1);
      expect(result.status).toBe("DISCREPANCY");

      // Verify item statuses
      const matched = result.items.find((i: any) => i.trackingCode === "ST-1001");
      expect(matched.status).toBe("MATCHED");
      expect(matched.discrepancyMinor).toBe(0);

      const underpaid = result.items.find((i: any) => i.trackingCode === "ST-1002");
      expect(underpaid.status).toBe("UNDERPAID");
      expect(underpaid.discrepancyMinor).toBe(80000); // 800 BDT shortfall
      expect(underpaid.disputeStatus).toBe("OPEN");

      const unknown = result.items.find((i: any) => i.trackingCode === "ST-9999");
      expect(unknown.status).toBe("UNKNOWN_TRACKING");

      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "courier.disbursement_reconciled",
          organizationId: "org_1",
        }),
      );
    });
  });

  describe("getMissingDisbursements", () => {
    it("flags parcels that were delivered over 7 days ago but never disbursed", async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 10);

      prismaMock.courierShipment.findMany.mockResolvedValue([
        {
          id: "ship_old_1",
          orderId: "ord_10",
          trackingCode: "ST-5001",
          provider: "steadfast",
          recipientName: "Rahim",
          recipientPhone: "01711111111",
          codAmountMinor: 180000n, // 1800 BDT
          status: "delivered",
          updatedAt: pastDate,
        },
        {
          id: "ship_old_2",
          orderId: "ord_11",
          trackingCode: "ST-5002",
          provider: "steadfast",
          recipientName: "Karim",
          recipientPhone: "01822222222",
          codAmountMinor: 250000n, // 2500 BDT
          status: "delivered",
          updatedAt: pastDate,
        },
      ]);

      // ST-5001 has already been disbursed, but ST-5002 has not!
      prismaMock.courierDisbursementItem.findMany.mockResolvedValue([
        { trackingCode: "ST-5001" },
      ]);

      const result = await service.getMissingDisbursements("org_1", 7);

      expect(result.totalMissingParcels).toBe(1);
      expect(result.totalMissingAmountMinor).toBe(250000);
      expect(result.parcels[0].trackingCode).toBe("ST-5002");
      expect(result.parcels[0].recipientName).toBe("Karim");
      expect(result.parcels[0].daysOverdue).toBeGreaterThanOrEqual(9);
    });
  });

  describe("updateDispute & exportClaimSheet", () => {
    it("updates dispute status and produces a formatted claim sheet", async () => {
      prismaMock.courierDisbursementItem.findFirst.mockResolvedValue({
        id: "item_1",
        organizationId: "org_1",
        trackingCode: "ST-1002",
        status: "UNDERPAID",
        disputeStatus: "OPEN",
        notes: "Initial note",
      });

      prismaMock.courierDisbursementItem.update.mockResolvedValue({
        id: "item_1",
        organizationId: "org_1",
        trackingCode: "ST-1002",
        status: "UNDERPAID",
        disputeStatus: "CLAIMED",
        notes: "Ticket opened with Steadfast #9842",
        systemCodMinor: 200000n,
        courierCollectedMinor: 120000n,
        courierFeeMinor: 10000n,
        netPaidMinor: 110000n,
        discrepancyMinor: 80000n,
      });

      const updated = await service.updateDispute("org_1", "item_1", {
        disputeStatus: "CLAIMED",
        notes: "Ticket opened with Steadfast #9842",
      });

      expect(updated.disputeStatus).toBe("CLAIMED");
      expect(updated.notes).toBe("Ticket opened with Steadfast #9842");

      // Claim sheet test
      prismaMock.courierDisbursementBatch.findFirst.mockResolvedValue({
        id: "batch_1",
        referenceNo: "DISB-2026-OCT-14",
        provider: "steadfast",
        items: [
          {
            trackingCode: "ST-1002",
            orderId: "ord_2",
            consignmentId: "CN-2",
            status: "UNDERPAID",
            systemCodMinor: 200000n,
            courierCollectedMinor: 120000n,
            discrepancyMinor: 80000n,
            disputeStatus: "CLAIMED",
            notes: "Ticket opened with Steadfast #9842",
          },
        ],
      });

      const claimSheet = await service.exportClaimSheet("org_1", "batch_1");
      expect(claimSheet.referenceNo).toBe("DISB-2026-OCT-14");
      expect(claimSheet.totalDiscrepancies).toBe(1);
      expect(claimSheet.totalShortfallMinor).toBe(80000);
      expect(claimSheet.claims[0].shortfallBdt).toBe(800);
    });
  });
});
