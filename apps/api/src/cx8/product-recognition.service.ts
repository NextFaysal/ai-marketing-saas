import { Injectable, Optional } from "@nestjs/common";
import { formatMinor } from "@repo/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { VisionService } from "../ai/vision.service";
import { MediaStore } from "../inbox/media-store";
import { detectMediaKind } from "../inbox/media-sniff";
import { PRODUCT_DESCRIBE_PROMPT, parseProductDescription, rankProductCandidates } from "./product-match";
import { badRequest, notFound } from "../i18n/api-exception";

/** How many of the org's products the scorer may consider. The
 *  catalog search is a text overlap over rows already in memory —
 *  bounded so a huge catalog cannot turn one click into a scan of
 *  the whole table. */
const CATALOG_SCAN_LIMIT = 500;

/**
 * CX8 (খ): agent-triggered product recognition from an inbound
 * inbox image.
 *
 * This service has NO send capability — deliberately. It reads the
 * conversation/message, loads the stored image bytes, asks
 * VisionService for a description, scores the org's own catalog
 * against that description, and returns candidates for the AGENT.
 * Nothing here creates or updates a message, and no inbox send
 * seam is imported: the agent's one click inserts a composer draft
 * in the web UI; sending stays the agent's own action.
 */
@Injectable()
export class ProductRecognitionService {
  private _mediaStore: MediaStore | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly vision: VisionService,
    @Optional() private readonly mediaStoreOverride?: MediaStore,
  ) {}

  private mediaStore(): MediaStore {
    if (this.mediaStoreOverride) return this.mediaStoreOverride;
    if (!this._mediaStore) this._mediaStore = MediaStore.fromEnv();
    return this._mediaStore;
  }

  /** Bytes for an inbound image message: the durable MediaStore
   *  copy first (platform ids/urls expire — that is why U6 stores
   *  them), a stored mediaUrl as the fallback for rows captured
   *  before the store existed. A WhatsApp mediaId alone cannot be
   *  resolved here without the channel integration — that case is
   *  an honest error, not a silent empty. */
  private async loadImageBytes(message: any): Promise<{ bytes: Buffer; contentType: string }> {
    if (message.mediaStorageKey) {
      const stored = await this.mediaStore().get(message.mediaStorageKey).catch(() => null);
      if (stored) return { bytes: stored, contentType: message.mediaContentType ?? "image/jpeg" };
    }
    if (message.mediaUrl) {
      const res = await fetch(message.mediaUrl);
      if (!res.ok) throw badRequest("cx8.theImageCouldNotBeFetched", { resStatus: res.status });
      return {
        bytes: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get("content-type") ?? message.mediaContentType ?? "image/jpeg",
      };
    }
    throw badRequest("cx8.noSavedCopyOfThisMessage");
  }

  async recognize(organizationId: string, userId: string, conversationId: string, messageId: string) {
    const conv = await (this.prisma as any).channelConversation.findFirst({
      where: { id: conversationId, organizationId },
    });
    if (!conv) throw notFound("cx8.conversationNotFoundInThisOrganization");
    const message = await (this.prisma as any).channelMessage.findFirst({
      where: { id: messageId, conversationId },
    });
    if (!message) throw notFound("cx8.messageNotFoundInThisConversation");
    if (message.direction !== "in" || message.type !== "image") {
      throw badRequest("cx8.productsCanOnlyBeSearchedFrom");
    }

    const { bytes, contentType } = await this.loadImageBytes(message);
    const detected = detectMediaKind(bytes);
    const mimeType = detected?.kind === "image" ? detected.contentType : contentType.split(";")[0].trim();

    const result = await this.vision.analyzeImage(organizationId, userId, {
      imageBytes: bytes,
      mimeType,
      prompt: PRODUCT_DESCRIBE_PROMPT,
      feature: "vision_product_match",
    });
    if (!result.available) {
      return {
        available: false,
        reason: result.reason,
        message: "AI ছবি পড়া এখন সেটআপ করা নেই — প্রোডাক্ট তালিকা থেকে হাতে বেছে নিন",
        description: null,
        candidates: [] as any[],
      };
    }

    const description = parseProductDescription(result.text);
    const products = await (this.prisma as any).product.findMany({
      where: { organizationId, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
      take: CATALOG_SCAN_LIMIT,
    });
    const ranked = rankProductCandidates(description, products ?? []);
    return {
      available: true,
      provider: result.provider,
      description,
      candidates: ranked.map(({ product, score, reasons }) => ({
        productId: product.id,
        name: product.name,
        priceMinor: String(product.priceMinor),
        priceText: formatMinor(BigInt(product.priceMinor as any), product.currency ?? "BDT"),
        currency: product.currency ?? "BDT",
        imageUrl: product.imageUrl ?? null,
        score,
        reasons,
      })),
    };
  }
}
