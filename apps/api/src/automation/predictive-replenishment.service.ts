import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../common/events.service";
import {
  ConfigureProductCycleDto,
  MarkReorderedDto,
  SendReplenishmentReminderDto,
} from "./predictive-replenishment.dto";

@Injectable()
export class PredictiveReplenishmentService {
  private readonly logger = new Logger(PredictiveReplenishmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly events?: EventsService,
  ) {}

  /**
   * Scans completed/delivered orders, identifies consumable products with replenishment cycles,
   * and creates predictive repeat-purchase reminders.
   */
  async generateReplenishmentPredictions(organizationId: string): Promise<any> {
    // 1. Find all products in org that have replenishmentDays configured
    const consumableProducts = await (this.prisma as any).product.findMany({
      where: {
        organizationId,
        replenishmentDays: { gt: 0 },
      },
    });

    if (consumableProducts.length === 0) {
      return {
        message: "কোনো প্রোডাক্টের রিপ্লেনিশমেন্ট সাইকেল কনফিগার করা নেই।",
        createdCount: 0,
        predictions: [],
      };
    }

    const productMap = new Map<string, any>();
    for (const p of consumableProducts) {
      productMap.set(p.id, p);
      if (p.sku) productMap.set(p.sku.toLowerCase(), p);
    }

    // 2. Find completed/delivered orders
    const orders = await (this.prisma as any).order.findMany({
      where: {
        organizationId,
        status: { in: ["completed", "delivered"] },
      },
      include: {
        items: true,
        customer: true,
      },
      take: 200,
      orderBy: { createdAt: "desc" },
    });

    let createdCount = 0;
    const now = new Date();

    for (const order of orders) {
      const customerPhone =
        order.customer?.phone || (order.address ? order.address.slice(0, 20) : "N/A");
      const customerName =
        order.customer?.name || (order.customer?.firstName ? `${order.customer.firstName} ${order.customer.lastName || ""}`.trim() : "গ্রাহক");

      const deliveredAt = order.placedAt || order.createdAt;

      for (const item of order.items) {
        let matchedProduct: any = null;
        if (item.productId && productMap.has(item.productId)) {
          matchedProduct = productMap.get(item.productId);
        } else if (item.sku && productMap.has(item.sku.toLowerCase())) {
          matchedProduct = productMap.get(item.sku.toLowerCase());
        }

        if (matchedProduct && matchedProduct.replenishmentDays) {
          // Check if prediction already exists for this order & product
          const existing = await (this.prisma as any).predictiveReplenishment.findFirst({
            where: {
              organizationId,
              orderId: order.id,
              productName: item.name,
            },
          });

          if (!existing) {
            const days = matchedProduct.replenishmentDays;
            const predictedDate = new Date(deliveredAt.getTime() + days * 24 * 60 * 60 * 1000);

            // If predictedDate is within next 5 days or past, mark DUE, else PENDING
            const daysUntilDue = (predictedDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
            const status = daysUntilDue <= 5 ? "DUE" : "PENDING";

            await (this.prisma as any).predictiveReplenishment.create({
              data: {
                organizationId,
                customerId: order.customerId,
                customerName,
                customerPhone,
                orderId: order.id,
                productId: matchedProduct.id,
                productName: item.name,
                deliveredAt,
                replenishmentDays: days,
                predictedDate,
                status,
                discountCode: "REORDER5",
                notes: matchedProduct.replenishmentReminderText || null,
              },
            });
            createdCount++;
          }
        }
      }
    }

    return {
      message: `${createdCount}টি নতুন রিপ্লেনিশমেন্ট প্রেডিকশন সফলভাবে জেনারেট হয়েছে।`,
      createdCount,
    };
  }

  /**
   * List predictive replenishment opportunities with full KPI scoreboard.
   */
  async listReplenishments(
    organizationId: string,
    filter?: { status?: string; search?: string },
  ): Promise<any> {
    const where: any = { organizationId };

    if (filter?.status) {
      where.status = filter.status;
    }

    if (filter?.search) {
      where.OR = [
        { customerName: { contains: filter.search, mode: "insensitive" } },
        { customerPhone: { contains: filter.search } },
        { productName: { contains: filter.search, mode: "insensitive" } },
      ];
    }

    const items = await (this.prisma as any).predictiveReplenishment.findMany({
      where,
      orderBy: { predictedDate: "asc" },
      take: 100,
    });

    // Auto-update any PENDING that are now within 5 days to DUE
    const now = new Date();
    const updatedItems = items.map((it: any) => {
      const daysUntilDue = Math.ceil(
        (new Date(it.predictedDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      return {
        ...it,
        daysUntilDue,
      };
    });

    // Compute high-level KPI metrics across all items for this organization
    const allRecords = await (this.prisma as any).predictiveReplenishment.findMany({
      where: { organizationId },
    });

    const totalTracked = allRecords.length;
    const dueCount = allRecords.filter(
      (r: any) =>
        r.status === "DUE" ||
        (r.status === "PENDING" &&
          (new Date(r.predictedDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24) <= 5),
    ).length;
    const remindedCount = allRecords.filter((r: any) => r.status === "REMINDED").length;
    const reorderedCount = allRecords.filter((r: any) => r.status === "REORDERED").length;

    const conversionRatePercent =
      remindedCount + reorderedCount > 0
        ? Math.round((reorderedCount / (remindedCount + reorderedCount)) * 1000) / 10
        : 0;

    // Estimate recovered revenue: average order value or sum of reorders
    const estimatedRecoveredLtvBdt = reorderedCount * 1200; // estimated BDT 1,200 avg consumable reorder

    return {
      kpi: {
        totalTracked,
        dueCount,
        remindedCount,
        reorderedCount,
        conversionRatePercent,
        estimatedRecoveredLtvBdt,
      },
      items: updatedItems,
    };
  }

  /**
   * Send or mark a replenishment reminder sent to customer.
   */
  async sendReminder(
    organizationId: string,
    id: string,
    dto?: SendReplenishmentReminderDto,
  ): Promise<any> {
    const item = await (this.prisma as any).predictiveReplenishment.findFirst({
      where: { id, organizationId },
    });
    if (!item) throw new NotFoundException("Replenishment record not found");

    const message =
      dto?.customMessage ||
      item.notes ||
      `প্রিয় ${item.customerName}, আপনার পূর্বের অর্ডারের "${item.productName}" সম্ভবত শেষ পর্যায়ে। এখনই রি-অর্ডারে ৫% ছাড় পেতে ডিসকাউন্ট কোড ${item.discountCode || "REORDER5"} ব্যবহার করুন!`;

    const updated = await (this.prisma as any).predictiveReplenishment.update({
      where: { id },
      data: {
        status: "REMINDED",
        lastRemindedAt: new Date(),
        notes: message,
      },
    });

    await this.audit.log({
      organizationId,
      action: "replenishment.reminder_sent",
      entityType: "PredictiveReplenishment",
      entityId: id,
      metadata: {
        customerPhone: item.customerPhone,
        productName: item.productName,
        discountCode: item.discountCode,
      },
    });

    return {
      success: true,
      message: `গ্রাহক ${item.customerName} (${item.customerPhone})-কে রিমাইন্ডার পাঠানো হয়েছে।`,
      record: updated,
    };
  }

  /**
   * Mark a customer replenishment cycle as REORDERED.
   */
  async markReordered(
    organizationId: string,
    id: string,
    dto?: MarkReorderedDto,
  ): Promise<any> {
    const item = await (this.prisma as any).predictiveReplenishment.findFirst({
      where: { id, organizationId },
    });
    if (!item) throw new NotFoundException("Replenishment record not found");

    const updated = await (this.prisma as any).predictiveReplenishment.update({
      where: { id },
      data: {
        status: "REORDERED",
        reorderOrderId: dto?.reorderOrderId || null,
        notes: dto?.notes || item.notes,
      },
    });

    await this.audit.log({
      organizationId,
      action: "replenishment.reordered",
      entityType: "PredictiveReplenishment",
      entityId: id,
      metadata: {
        productName: item.productName,
        customerPhone: item.customerPhone,
        reorderOrderId: dto?.reorderOrderId,
      },
    });

    return {
      success: true,
      message: `রি-অর্ডার সফলভাবে মার্ক করা হয়েছে!`,
      record: updated,
    };
  }

  /**
   * Configure consumable replenishment cycle on a product.
   */
  async configureProductCycle(
    organizationId: string,
    productId: string,
    dto: ConfigureProductCycleDto,
  ): Promise<any> {
    const product = await (this.prisma as any).product.findFirst({
      where: { id: productId, organizationId },
    });
    if (!product) throw new NotFoundException("Product not found");

    const updated = await (this.prisma as any).product.update({
      where: { id: productId },
      data: {
        replenishmentDays: dto.replenishmentDays,
        replenishmentReminderText: dto.replenishmentReminderText || null,
      },
    });

    return {
      success: true,
      message: `প্রোডাক্ট "${product.name}"-এর রিপ্লেনিশমেন্ট সাইকেল ${dto.replenishmentDays} দিন সেট করা হয়েছে।`,
      product: {
        id: updated.id,
        name: updated.name,
        replenishmentDays: updated.replenishmentDays,
      },
    };
  }
}
