import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { VisionService } from "../ai/vision.service";
import { detectMediaKind } from "../inbox/media-sniff";
import { LABEL_SCAN_PROMPT, LabelIdentifiers, cleanIdentifier, parseLabelExtraction } from "./label-extract";
import { badRequest } from "../i18n/api-exception";

/** CX8 label uploads: images only, 8MB cap (multer enforces it at
 *  the route; the service re-checks so no caller can bypass it). */
export const MAX_LABEL_SCAN_BYTES = 8 * 1024 * 1024;

export interface LabelMatch {
  orderId: string;
  orderNumber: string | null;
  orderStatus: string | null;
  shipmentId: string | null;
  trackingCode: string | null;
  provider: string | null;
  shipmentStatus: string | null;
}

export interface LabelCandidate extends LabelMatch {
  phoneLast4: string;
}

@Injectable()
export class LabelScanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vision: VisionService,
  ) {}

  /**
   * Scan one uploaded label photo. Vision-unavailable is a normal
   * honest result (available:false + the Bengali setup message),
   * NOT an error — and the extracted/match fields stay empty rather
   * than guessed. A non-image upload (by MAGIC BYTES, never by file
   * name) and an oversized upload are honest Bengali 400s.
   */
  async scanLabel(organizationId: string, userId: string, file: { buffer?: Buffer; size?: number } | undefined) {
    const bytes = file?.buffer;
    if (!bytes || bytes.length === 0) {
      throw badRequest("cx8.theImageWasNotFoundUpload");
    }
    if (bytes.length > MAX_LABEL_SCAN_BYTES) {
      throw badRequest("cx8.theImageIsTooLargeAt");
    }
    const detected = detectMediaKind(bytes);
    if (!detected || detected.kind !== "image" || !["image/jpeg", "image/png", "image/webp"].includes(detected.contentType)) {
      throw badRequest("cx8.onlyImagesJpegPngWebpCan");
    }

    const result = await this.vision.analyzeImage(organizationId, userId, {
      imageBytes: bytes,
      mimeType: detected.contentType,
      prompt: LABEL_SCAN_PROMPT,
      feature: "vision_label_scan",
    });
    if (!result.available) {
      return {
        available: false,
        reason: result.reason,
        message: "AI ছবি পড়া এখন সেটআপ করা নেই — নিচে নম্বর দিয়ে খুঁজুন",
        extracted: {} as LabelIdentifiers,
        matched: null as LabelMatch | null,
        candidates: [] as LabelCandidate[],
      };
    }
    const extracted = parseLabelExtraction(result.text);
    const lookup = await this.lookup(organizationId, extracted);
    return { available: true, provider: result.provider, extracted, ...lookup };
  }

  /**
   * Plain identifier search — the "🔢 নম্বর দিয়ে খুঁজুন" box. Needs
   * NO AI: the typed (or keyboard-mic dictated) value is tried as a
   * tracking code and as an order number; exactly 4 digits mean a
   * phone last-4 narrowing; a longer digit string additionally
   * narrows by its last 4 digits when the exact tries miss.
   */
  async searchByNumber(organizationId: string, queryRaw: string) {
    const q = String(queryRaw ?? "").trim();
    if (!q) throw badRequest("cx8.writeTheNumberToSearchFor");
    let ids: LabelIdentifiers;
    if (/^\d{4}$/.test(q)) {
      ids = { phoneLast4: q };
    } else {
      const clean = cleanIdentifier(q);
      if (!clean) throw badRequest("cx8.theNumberIsNotInThe");
      ids = { trackingCode: clean, orderNumber: clean };
      if (/^\d{5,}$/.test(q)) ids.phoneLast4 = q.slice(-4);
    }
    const lookup = await this.lookup(organizationId, ids);
    return { available: true, extracted: ids, ...lookup };
  }

  /**
   * Org-scoped lookup with strict precedence:
   *  1. exact shipment trackingCode → single match;
   *  2. exact order number (externalNumber or externalId) → single
   *     match only when exactly one order carries it;
   *  3. phoneLast4 may ONLY narrow a candidate list (max 5) — it
   *     never produces a single auto-opened match on its own.
   * Every query carries organizationId: another org's identical
   * tracking code is invisible here.
   */
  async lookup(organizationId: string, ids: LabelIdentifiers): Promise<{ matched: LabelMatch | null; candidates: LabelCandidate[] }> {
    if (ids.trackingCode) {
      const shipment = await (this.prisma as any).courierShipment.findFirst({
        where: { organizationId, trackingCode: ids.trackingCode },
      });
      if (shipment) return { matched: await this.shapeFromShipment(organizationId, shipment), candidates: [] };
    }
    if (ids.orderNumber) {
      const orders = await (this.prisma as any).order.findMany({
        where: { organizationId, OR: [{ externalNumber: ids.orderNumber }, { externalId: ids.orderNumber }] },
        take: 2,
      });
      if (orders.length === 1) {
        return { matched: await this.shapeFromOrder(organizationId, orders[0]), candidates: [] };
      }
      if (orders.length > 1) {
        // Ambiguous even as an "exact" value — honesty: candidates.
        const candidates: LabelCandidate[] = [];
        for (const o of orders.slice(0, 5)) {
          const m = await this.shapeFromOrder(organizationId, o);
          candidates.push({ ...m, phoneLast4: ids.phoneLast4 ?? "" });
        }
        return { matched: null, candidates };
      }
    }
    if (ids.phoneLast4) {
      const shipments = await (this.prisma as any).courierShipment.findMany({
        where: { organizationId, recipientPhone: { endsWith: ids.phoneLast4 } },
        orderBy: { createdAt: "desc" },
        take: 5,
      });
      const candidates: LabelCandidate[] = [];
      for (const s of shipments.slice(0, 5)) {
        const m = await this.shapeFromShipment(organizationId, s);
        candidates.push({ ...m, phoneLast4: ids.phoneLast4 });
      }
      return { matched: null, candidates };
    }
    return { matched: null, candidates: [] };
  }

  private async orderForShipment(organizationId: string, orderId: string) {
    return (this.prisma as any).order.findFirst({ where: { id: orderId, organizationId } }).catch(() => null);
  }

  private async shapeFromShipment(organizationId: string, shipment: any): Promise<LabelMatch> {
    const order = shipment.orderId ? await this.orderForShipment(organizationId, shipment.orderId) : null;
    return {
      orderId: shipment.orderId,
      orderNumber: order?.externalNumber ?? shipment.invoice ?? null,
      orderStatus: order?.status ?? null,
      shipmentId: shipment.id,
      trackingCode: shipment.trackingCode ?? null,
      provider: shipment.provider ?? null,
      shipmentStatus: shipment.status ?? null,
    };
  }

  private async shapeFromOrder(organizationId: string, order: any): Promise<LabelMatch> {
    const shipment = await (this.prisma as any).courierShipment
      .findFirst({ where: { organizationId, orderId: order.id }, orderBy: { createdAt: "desc" } })
      .catch(() => null);
    return {
      orderId: order.id,
      orderNumber: order.externalNumber ?? null,
      orderStatus: order.status ?? null,
      shipmentId: shipment?.id ?? null,
      trackingCode: shipment?.trackingCode ?? null,
      provider: shipment?.provider ?? null,
      shipmentStatus: shipment?.status ?? null,
    };
  }
}
