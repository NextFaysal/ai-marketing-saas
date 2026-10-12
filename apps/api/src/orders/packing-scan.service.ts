import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CompletePackingScanDto, ScanItemVerifyDto, StartPackingScanDto, VisionLabelScanDto } from "./packing-scan.dto";

@Injectable()
export class PackingScanService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /**
   * Start or resume a packing scan session for an order.
   * Pulls expected items from OrderItem and seeds PackingScanItem rows.
   */
  async startScan(organizationId: string, actorId: string, dto: StartPackingScanDto) {
    const order = await (this.prisma as any).order.findFirst({
      where: { id: dto.orderId, organizationId },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException("অর্ডারটি খুঁজে পাওয়া যায়নি");
    }

    if (!order.items || order.items.length === 0) {
      throw new BadRequestException("অর্ডারে কোনো আইটেম নেই, স্ক্যান করা সম্ভব নয়");
    }

    // Check if an existing in-progress scan exists
    let scanLog = await (this.prisma as any).packingScanLog.findFirst({
      where: {
        organizationId,
        orderId: order.id,
        status: "in_progress",
      },
      include: { items: true },
    });

    if (!scanLog) {
      const totalItems = order.items.reduce((acc: number, item: any) => acc + (item.quantity || 1), 0);
      scanLog = await (this.prisma as any).packingScanLog.create({
        data: {
          organizationId,
          orderId: order.id,
          scannedById: actorId,
          status: "in_progress",
          matchedItems: 0,
          totalItems,
          items: {
            create: order.items.map((item: any) => ({
              orderItemId: item.id,
              sku: item.sku || null,
              expectedQty: item.quantity || 1,
              scannedQty: 0,
              status: "pending",
            })),
          },
        },
        include: { items: true },
      });

      await this.audit?.log?.({
        organizationId,
        userId: actorId,
        action: "packing_scan.started",
        entityType: "packing_scan",
        entityId: scanLog.id,
        metadata: { orderId: order.id, totalItems },
      }).catch(() => undefined);
    }

    return scanLog;
  }

  /**
   * Scan / verify a single item or barcode by SKU or orderItemId.
   */
  async verifyItem(organizationId: string, scanId: string, dto: ScanItemVerifyDto) {
    const scanLog = await (this.prisma as any).packingScanLog.findFirst({
      where: { id: scanId, organizationId },
      include: { items: true, order: { include: { items: true } } },
    });

    if (!scanLog) {
      throw new NotFoundException("স্ক্যান সেশন পাওয়া যায়নি");
    }

    if (scanLog.status !== "in_progress") {
      throw new BadRequestException("এই প্যাকিং স্ক্যান সেশনটি ইতিমধ্যে সমাপ্ত হয়েছে");
    }

    const querySku = (dto.sku || dto.barcode || "").trim().toLowerCase();
    const qtyToAdd = dto.quantity && dto.quantity > 0 ? dto.quantity : 1;

    // Find matching scan item
    const targetItem = scanLog.items.find((item: any) => {
      if (dto.orderItemId && item.orderItemId === dto.orderItemId) return true;
      if (querySku && item.sku && item.sku.toLowerCase() === querySku) return true;
      return false;
    });

    if (!targetItem) {
      return {
        matched: false,
        message: "স্ক্যান করা আইটেমটি অর্ডারের লিস্টে নেই (অনাকাঙ্ক্ষিত আইটেম)",
        item: null,
        scanLog,
      };
    }

    const newScannedQty = targetItem.scannedQty + qtyToAdd;
    let newStatus = "pending";
    if (newScannedQty === targetItem.expectedQty) {
      newStatus = "matched";
    } else if (newScannedQty > targetItem.expectedQty) {
      newStatus = "mismatch"; // over-packed
    }

    await (this.prisma as any).packingScanItem.update({
      where: { id: targetItem.id },
      data: {
        scannedQty: newScannedQty,
        status: newStatus,
      },
    });

    // Re-evaluate aggregate progress
    const updatedItems = await (this.prisma as any).packingScanItem.findMany({
      where: { packingScanId: scanLog.id },
    });

    const totalScanned = updatedItems.reduce((acc: number, it: any) => acc + it.scannedQty, 0);
    const allMatched = updatedItems.every((it: any) => it.scannedQty === it.expectedQty);

    await (this.prisma as any).packingScanLog.update({
      where: { id: scanLog.id },
      data: {
        matchedItems: totalScanned,
      },
    });

    return {
      matched: true,
      item: {
        ...targetItem,
        scannedQty: newScannedQty,
        status: newStatus,
      },
      allMatched,
      totalExpected: scanLog.totalItems,
      totalScanned,
    };
  }

  /**
   * Complete and finalize the packing scan.
   */
  async completeScan(organizationId: string, actorId: string, scanId: string, dto: CompletePackingScanDto) {
    const scanLog = await (this.prisma as any).packingScanLog.findFirst({
      where: { id: scanId, organizationId },
      include: { items: true },
    });

    if (!scanLog) throw new NotFoundException("স্ক্যান সেশন পাওয়া যায়নি");

    const hasMismatch = scanLog.items.some((it: any) => it.scannedQty !== it.expectedQty);

    if (hasMismatch && !dto.overrideMismatch) {
      throw new BadRequestException("সবগুলো আইটেম সঠিকভাবে মেলেনি। নিশ্চিত হতে overrideMismatch ফ্ল্যাগ দিন।");
    }

    const finalStatus = hasMismatch ? "overridden" : "verified";

    const completed = await (this.prisma as any).packingScanLog.update({
      where: { id: scanLog.id },
      data: {
        status: finalStatus,
        notes: dto.notes ?? scanLog.notes,
        completedAt: new Date(),
      },
      include: { items: true },
    });

    await this.audit?.log?.({
      organizationId,
      userId: actorId,
      action: "packing_scan.completed",
      entityType: "packing_scan",
      entityId: scanLog.id,
      metadata: { finalStatus, orderId: scanLog.orderId },
    }).catch(() => undefined);

    return completed;
  }

  /**
   * Vision label scan: parses image of shipping label / invoice to extract order number,
   * tracking, or customer phone using OCR / LLM vision.
   */
  async scanLabelVision(organizationId: string, dto: VisionLabelScanDto, fetchFn: typeof fetch = fetch) {
    const bytes = Buffer.from(dto.imageBase64, "base64");
    if (!bytes || bytes.length === 0) {
      throw new BadRequestException("ছবি ডেটা পাওয়া যায়নি");
    }

    const providerName = (process.env.LLM_PROVIDER ?? "").toLowerCase();
    const apiKey = process.env.LLM_API_KEY ?? "";
    const model = process.env.LLM_MODEL;

    // Fallback parser if no AI provider configured or in dev
    if (!["openai", "gemini", "anthropic"].includes(providerName) || !apiKey) {
      // In dev / test stub environment, return honest mock recognition
      return {
        detected: false,
        orderNumber: null,
        phone: null,
        courierTracking: null,
        message: "AI ভিশন প্রোভাইডার কনফিগার করা নেই। ম্যানুয়ালি অর্ডার নির্বাচন বা বারকোড স্ক্যান করুন।",
      };
    }

    const mime = dto.mimeType || "image/jpeg";
    const prompt = `Extract courier label details from this shipping parcel. Return strict JSON:
{"orderNumber":string|null,"phone":string|null,"courierTracking":string|null,"recipientName":string|null}`;

    try {
      let rawText = "";
      if (providerName === "openai") {
        const res = await fetchFn("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: model ?? "gpt-4o-mini",
            messages: [{ role: "user", content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${mime};base64,${dto.imageBase64}` } },
            ] }],
            response_format: { type: "json_object" },
          }),
        });
        const data: any = await res.json().catch(() => ({}));
        rawText = data?.choices?.[0]?.message?.content ?? "";
      } else if (providerName === "gemini") {
        const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${model ?? "gemini-2.0-flash"}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: dto.imageBase64 } }] }],
          }),
        });
        const data: any = await res.json().catch(() => ({}));
        rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      }

      const parsed = JSON.parse(rawText.replace(/```json/gi, "").replace(/```/g, "").trim());
      return {
        detected: true,
        orderNumber: parsed.orderNumber || null,
        phone: parsed.phone || null,
        courierTracking: parsed.courierTracking || null,
        recipientName: parsed.recipientName || null,
      };
    } catch (e: any) {
      return {
        detected: false,
        orderNumber: null,
        phone: null,
        courierTracking: null,
        message: `লেবেল রিড করতে ব্যর্থ হয়েছে: ${e?.message || "অজানা সমস্যা"}`,
      };
    }
  }

  /**
   * History of packing scans for the organization.
   */
  async getScanHistory(organizationId: string, orderId?: string) {
    return (this.prisma as any).packingScanLog.findMany({
      where: {
        organizationId,
        ...(orderId ? { orderId } : {}),
      },
      include: { items: true, order: { select: { externalNumber: true, status: true, totalMinor: true } } },
      orderBy: { scannedAt: "desc" },
      take: 50,
    });
  }
}
