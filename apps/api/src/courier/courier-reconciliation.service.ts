import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import {
  UpdateDisputeDto,
  UploadDisbursementDto,
} from "./courier-reconciliation.dto";
import { badRequest, notFound } from "../i18n";

function serializeBatch(batch: any) {
  if (!batch) return null;
  return {
    ...batch,
    totalCollectedMinor: Number(batch.totalCollectedMinor || 0),
    totalFeeMinor: Number(batch.totalFeeMinor || 0),
    netDisbursedMinor: Number(batch.netDisbursedMinor || 0),
    items: batch.items ? batch.items.map(serializeItem) : undefined,
  };
}

function serializeItem(item: any) {
  if (!item) return null;
  return {
    ...item,
    systemCodMinor: Number(item.systemCodMinor || 0),
    courierCollectedMinor: Number(item.courierCollectedMinor || 0),
    courierFeeMinor: Number(item.courierFeeMinor || 0),
    netPaidMinor: Number(item.netPaidMinor || 0),
    discrepancyMinor: Number(item.discrepancyMinor || 0),
  };
}

@Injectable()
export class CourierReconciliationService {
  private readonly logger = new Logger(CourierReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /**
   * Process a disbursement statement uploaded from Steadfast/Pathao/RedX.
   * Compares each line item's collected COD against the internal Order & Shipment records.
   */
  async processDisbursementBatch(
    organizationId: string,
    dto: UploadDisbursementDto,
    uploadedBy?: string,
  ): Promise<any> {
    if (!dto.items || dto.items.length === 0) {
      throw badRequest("courier.disbursementStatementEmpty");
    }

    // Extract all tracking codes to look up corresponding shipments
    const trackingCodes = dto.items.map((i) => i.trackingCode.trim());
    const shipments = await this.prisma.courierShipment.findMany({
      where: {
        organizationId,
        trackingCode: { in: trackingCodes },
      },
    });

    const shipmentMap = new Map<string, any>();
    for (const s of shipments) {
      if (s.trackingCode) {
        shipmentMap.set(s.trackingCode.trim().toLowerCase(), s);
      }
    }

    let totalCollectedMinor = 0n;
    let totalFeeMinor = 0n;
    let netDisbursedMinor = 0n;
    let matchedCount = 0;
    let discrepancyCount = 0;
    let unmatchedCount = 0;

    const itemsToCreate: any[] = [];

    for (const item of dto.items) {
      const codeKey = item.trackingCode.trim().toLowerCase();
      const matchedShipment = shipmentMap.get(codeKey);

      const courierCollected = BigInt(Math.round(item.courierCollectedMinor || 0));
      const courierFee = BigInt(Math.round(item.courierFeeMinor || 0));
      const netPaid =
        item.netPaidMinor !== undefined
          ? BigInt(Math.round(item.netPaidMinor))
          : courierCollected - courierFee;

      totalCollectedMinor += courierCollected;
      totalFeeMinor += courierFee;
      netDisbursedMinor += netPaid;

      if (!matchedShipment) {
        // Unknown tracking code not originating in our system
        unmatchedCount++;
        itemsToCreate.push({
          organizationId,
          trackingCode: item.trackingCode,
          orderId: null,
          consignmentId: item.consignmentId || null,
          systemCodMinor: 0n,
          courierCollectedMinor: courierCollected,
          courierFeeMinor: courierFee,
          netPaidMinor: netPaid,
          status: "UNKNOWN_TRACKING",
          discrepancyMinor: 0n,
          disputeStatus: "NONE",
          notes: "কুরিয়ার স্টেটমেন্টে এমন ট্র্যাকিং কোড এসেছে যা আমাদের সিস্টেমে নেই।",
        });
      } else {
        const systemCod = BigInt(matchedShipment.codAmountMinor || 0n);

        if (courierCollected < systemCod) {
          // Courier collected or disbursed less than expected COD amount
          discrepancyCount++;
          const discrepancy = systemCod - courierCollected;
          itemsToCreate.push({
            organizationId,
            trackingCode: item.trackingCode,
            orderId: matchedShipment.orderId,
            consignmentId: matchedShipment.consignmentId || item.consignmentId || null,
            systemCodMinor: systemCod,
            courierCollectedMinor: courierCollected,
            courierFeeMinor: courierFee,
            netPaidMinor: netPaid,
            status: "UNDERPAID",
            discrepancyMinor: discrepancy,
            disputeStatus: "OPEN",
            notes: `প্রত্যাশিত COD ৳${Number(systemCod) / 100}, কিন্তু কুরিয়ার জমা দিয়েছে ৳${Number(courierCollected) / 100}`,
          });
        } else {
          // Perfectly matched
          matchedCount++;
          itemsToCreate.push({
            organizationId,
            trackingCode: item.trackingCode,
            orderId: matchedShipment.orderId,
            consignmentId: matchedShipment.consignmentId || item.consignmentId || null,
            systemCodMinor: systemCod,
            courierCollectedMinor: courierCollected,
            courierFeeMinor: courierFee,
            netPaidMinor: netPaid,
            status: "MATCHED",
            discrepancyMinor: 0n,
            disputeStatus: "NONE",
            notes: null,
          });
        }
      }
    }

    const batch = await this.prisma.courierDisbursementBatch.create({
      data: {
        organizationId,
        provider: dto.provider.toLowerCase(),
        referenceNo: dto.referenceNo,
        totalOrders: dto.items.length,
        totalCollectedMinor,
        totalFeeMinor,
        netDisbursedMinor,
        matchedCount,
        discrepancyCount,
        unmatchedCount,
        status: discrepancyCount > 0 ? "DISCREPANCY" : "RECONCILED",
        uploadedBy: uploadedBy || null,
        items: {
          create: itemsToCreate,
        },
      },
      include: {
        items: true,
      },
    });

    if (this.audit) {
      await this.audit.log({
        organizationId,
        userId: uploadedBy,
        action: "courier.disbursement_reconciled",
        entityType: "CourierDisbursementBatch",
        entityId: batch.id,
        metadata: {
          referenceNo: dto.referenceNo,
          provider: dto.provider,
          totalOrders: dto.items.length,
          matchedCount,
          discrepancyCount,
        },
      });
    }

    return serializeBatch(batch);
  }

  /**
   * List recent disbursement batches with summary statistics.
   */
  async listBatches(organizationId: string): Promise<any[]> {
    const batches = await this.prisma.courierDisbursementBatch.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return batches.map(serializeBatch);
  }

  /**
   * Get full details of a specific disbursement batch and all reconciled items.
   */
  async getBatchDetails(organizationId: string, batchId: string): Promise<any> {
    const batch = await this.prisma.courierDisbursementBatch.findFirst({
      where: { id: batchId, organizationId },
      include: {
        items: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!batch) {
      throw notFound("courier.disbursementBatchNotFound");
    }
    return serializeBatch(batch);
  }

  /**
   * Find orders marked 'delivered' or 'partial_delivered' older than threshold days
   * that have NEVER appeared in any disbursement batch (Missing Money Alert!).
   */
  async getMissingDisbursements(
    organizationId: string,
    daysThreshold: number = 7,
  ): Promise<any> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysThreshold);

    // Find all delivered shipments
    const deliveredShipments: any[] = await this.prisma.courierShipment.findMany({
      where: {
        organizationId,
        status: { in: ["delivered", "partial_delivered"] },
        updatedAt: { lte: cutoffDate },
      },
      orderBy: { updatedAt: "asc" },
    });

    if (deliveredShipments.length === 0) {
      return {
        totalMissingParcels: 0,
        totalMissingAmountMinor: 0,
        parcels: [],
      };
    }

    const trackingCodes = deliveredShipments
      .map((s: any) => s.trackingCode)
      .filter((tc: any): tc is string => !!tc);

    // Find any disbursement items with these tracking codes
    const disbursedItems: any[] = await this.prisma.courierDisbursementItem.findMany({
      where: {
        organizationId,
        trackingCode: { in: trackingCodes },
      },
      select: { trackingCode: true },
    });

    const disbursedSet = new Set(disbursedItems.map((d: any) => d.trackingCode.toLowerCase()));

    const missingParcels = deliveredShipments
      .filter((s: any) => s.trackingCode && !disbursedSet.has(s.trackingCode.toLowerCase()))
      .map((s: any) => ({
        id: s.id,
        orderId: s.orderId,
        trackingCode: s.trackingCode,
        provider: s.provider,
        consignmentId: s.consignmentId,
        recipientName: s.recipientName,
        recipientPhone: s.recipientPhone,
        codAmountMinor: Number(s.codAmountMinor || 0),
        status: s.status,
        deliveredAt: s.updatedAt,
        daysOverdue: Math.floor((Date.now() - new Date(s.updatedAt).getTime()) / (1000 * 60 * 60 * 24)),
      }));

    const totalMissingAmountMinor = missingParcels.reduce(
      (sum: number, p: any) => sum + p.codAmountMinor,
      0,
    );

    return {
      totalMissingParcels: missingParcels.length,
      totalMissingAmountMinor,
      parcels: missingParcels,
    };
  }

  /**
   * Update dispute status on a discrepancy item (e.g. claim filed with Steadfast/Pathao).
   */
  async updateDispute(
    organizationId: string,
    itemId: string,
    dto: UpdateDisputeDto,
  ): Promise<any> {
    const item = await this.prisma.courierDisbursementItem.findFirst({
      where: { id: itemId, organizationId },
    });
    if (!item) {
      throw notFound("courier.disbursementItemNotFound");
    }

    const updated = await this.prisma.courierDisbursementItem.update({
      where: { id: itemId },
      data: {
        disputeStatus: dto.disputeStatus,
        notes: dto.notes !== undefined ? dto.notes : item.notes,
      },
    });

    return serializeItem(updated);
  }

  /**
   * Export discrepancy claim sheet formatted for submitting to courier support / account managers.
   */
  async exportClaimSheet(organizationId: string, batchId: string): Promise<any> {
    const batch = await this.prisma.courierDisbursementBatch.findFirst({
      where: { id: batchId, organizationId },
      include: {
        items: {
          where: {
            status: { in: ["UNDERPAID", "UNKNOWN_TRACKING", "OVERCHARGED_FEE"] },
          },
        },
      },
    });
    if (!batch) {
      throw notFound("courier.disbursementBatchNotFound");
    }

    const claims = batch.items.map((item) => ({
      trackingCode: item.trackingCode,
      consignmentId: item.consignmentId || "N/A",
      orderId: item.orderId || "N/A",
      issueType: item.status,
      systemCodBdt: Number(item.systemCodMinor) / 100,
      courierPaidBdt: Number(item.courierCollectedMinor) / 100,
      shortfallBdt: Number(item.discrepancyMinor) / 100,
      disputeStatus: item.disputeStatus,
      notes: item.notes,
    }));

    return {
      batchId: batch.id,
      referenceNo: batch.referenceNo,
      provider: batch.provider,
      totalDiscrepancies: claims.length,
      totalShortfallMinor: Number(
        batch.items.reduce((sum, i) => sum + i.discrepancyMinor, 0n),
      ),
      claims,
    };
  }
}
