import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import {
  buildFeedItems,
  previewFeedItem,
  serializeDarazCsv,
  serializeFeedCsv,
  serializeFeedXml,
  DARAZ_FEED_TEMPLATE_WARNING,
  FEED_SKIP_MESSAGES,
  type FeedProductInput,
} from "./feed-generator";
import type { CreateFeedDto, UpdateFeedDto } from "./feeds.dto";

const CHANNELS = ["meta", "google", "tiktok", "daraz"] as const;

function apiPublicBase(): string {
  return (process.env.API_PUBLIC_URL ?? "http://localhost:4000").replace(/\/+$/, "");
}

function webPublicBase(): string {
  return (process.env.WEB_PUBLIC_URL ?? process.env.APP_PUBLIC_URL ?? apiPublicBase()).replace(/\/+$/, "");
}

@Injectable()
export class FeedsService {
  private readonly logger = new Logger(FeedsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private table(): any {
    return (this.prisma as any).productFeed;
  }

  private feedUrl(feed: any): string {
    return `${apiPublicBase()}/feeds/${feed.token}.${feed.format === "xml" ? "xml" : "csv"}`;
  }

  private serialize(feed: any): any {
    if (!feed) return feed;
    return {
      ...feed,
      url: this.feedUrl(feed),
      lastGeneratedAt: feed.lastGeneratedAt
        ? new Date(feed.lastGeneratedAt).toISOString()
        : null,
    };
  }

  private async loadOr404(orgId: string, id: string): Promise<any> {
    const row = await this.table().findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException("Feed not found in this organization");
    return row;
  }

  async list(orgId: string) {
    const rows = (await this.table().findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    })) ?? [];
    const counts = await Promise.all(
      rows.map(async (r: any) => {
        const { items, skipped } = await this.buildForOrg(orgId, r).catch(() => ({ items: [], skipped: [] }));
        return { feedId: r.id, itemCount: items.length, skippedCount: skipped.length };
      }),
    );
    const byId = new Map(counts.map((c) => [c.feedId, c]));
    return {
      items: rows.map((r: any) => ({ ...this.serialize(r), ...(byId.get(r.id) ?? {}) })),
    };
  }

  async getOne(orgId: string, id: string) {
    return this.serialize(await this.loadOr404(orgId, id));
  }

  async create(orgId: string, actorId: string, dto: CreateFeedDto) {
    if (!(CHANNELS as readonly string[]).includes(dto.channel)) {
      throw new BadRequestException("চ্যানেল সঠিক নয় (meta | google | tiktok | daraz)");
    }
    // OU3: the Daraz export exists only as CSV (no XML form is
    // claimed for a Seller Center upload file).
    if (dto.channel === "daraz" && dto.format !== undefined && dto.format !== "csv") {
      throw new BadRequestException("Daraz ফিড শুধু CSV ফরম্যাটে হয়");
    }
    const format = dto.format ?? (dto.channel === "tiktok" || dto.channel === "daraz" ? "csv" : "xml");
    const row = await this.table().create({
      data: {
        organizationId: orgId,
        channel: dto.channel,
        format,
        token: randomBytes(24).toString("base64url"),
        includeOutOfStock: dto.includeOutOfStock ?? false,
        defaultGoogleCategory: dto.defaultGoogleCategory ?? null,
        active: dto.active ?? true,
      },
    });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "feed.created",
      entityType: "ProductFeed", entityId: row.id, metadata: { channel: row.channel, format: row.format },
    });
    return { feed: this.serialize(row) };
  }

  async update(orgId: string, actorId: string, id: string, dto: UpdateFeedDto) {
    await this.loadOr404(orgId, id);
    const data: Record<string, any> = {};
    if (dto.format !== undefined) data.format = dto.format;
    if (dto.includeOutOfStock !== undefined) data.includeOutOfStock = dto.includeOutOfStock;
    if (dto.defaultGoogleCategory !== undefined) data.defaultGoogleCategory = dto.defaultGoogleCategory;
    if (dto.active !== undefined) data.active = dto.active;
    const updated = await this.table().update({ where: { id }, data });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "feed.updated",
      entityType: "ProductFeed", entityId: id,
    });
    return { feed: this.serialize(updated) };
  }

  async setActive(orgId: string, actorId: string, id: string, active: boolean) {
    await this.loadOr404(orgId, id);
    const updated = await this.table().update({ where: { id }, data: { active } });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "feed.toggled",
      entityType: "ProductFeed", entityId: id, metadata: { active },
    });
    return { feed: this.serialize(updated) };
  }

  /** Rotate the token: the old feed URL dies immediately. */
  async rotateToken(orgId: string, actorId: string, id: string) {
    await this.loadOr404(orgId, id);
    const updated = await this.table().update({
      where: { id },
      data: { token: randomBytes(24).toString("base64url") },
    });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "feed.token_rotated",
      entityType: "ProductFeed", entityId: id,
    });
    return { feed: this.serialize(updated) };
  }

  async remove(orgId: string, actorId: string, id: string) {
    await this.loadOr404(orgId, id);
    await this.table().delete({ where: { id } });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "feed.deleted",
      entityType: "ProductFeed", entityId: id,
    });
    return { deleted: true };
  }

  // ---------- generation ----------

  private async buildForOrg(orgId: string, feed: any) {
    const org = await (this.prisma as any).organization.findFirst({ where: { id: orgId } });
    if (!org) throw new NotFoundException("Organization not found");
    const setting = await (this.prisma as any).storefrontSetting
      .findFirst({ where: { organizationId: orgId } })
      .catch(() => null);
    const products = (await (this.prisma as any).product.findMany({
      where: { organizationId: orgId, status: "ACTIVE" },
      include: { images: true, variants: true, categoryRef: true },
      orderBy: { createdAt: "asc" },
    })) ?? [];
    const inputs: FeedProductInput[] = products.map((p: any) => ({
      id: p.id,
      name: p.name,
      slug: p.slug ?? null,
      description: p.description ?? null,
      seoDescription: p.seoDescription ?? null,
      sku: p.sku ?? null,
      priceMinor: p.priceMinor,
      compareAtMinor: p.compareAtMinor ?? null,
      currency: p.currency ?? "BDT",
      stockQuantity: p.stockQuantity ?? null,
      imageUrl: p.imageUrl ?? null,
      images: (p.images ?? []).map((i: any) => ({ url: i.url, position: i.position ?? 0 })),
      barcode: p.barcode ?? null,
      categoryName: p.categoryRef?.name ?? p.category ?? null,
      variants: (p.variants ?? []).map((v: any) => ({
        id: v.id,
        name: v.name ?? null,
        sku: v.sku ?? null,
        priceMinor: v.priceMinor ?? null,
        stockQuantity: v.stockQuantity ?? null,
      })),
    }));
    return buildFeedItems(inputs, {
      webBase: webPublicBase(),
      orgSlug: org.slug,
      shopEnabled: setting?.shopEnabled === true,
      brand: setting?.shopName ?? org.name,
      defaultGoogleCategory: feed.defaultGoogleCategory ?? null,
      includeOutOfStock: feed.includeOutOfStock === true,
    });
  }

  async preview(orgId: string, id: string) {
    const feed = await this.loadOr404(orgId, id);
    const { items, skipped } = await this.buildForOrg(orgId, feed);
    return {
      feed: this.serialize(feed),
      itemCount: items.length,
      skippedCount: skipped.length,
      items: items.slice(0, 5).map((it) => previewFeedItem(it, feed.channel)),
      skipped: skipped.slice(0, 20).map((s) => ({
        productId: s.productId,
        name: s.name,
        reason: s.reason,
        reasonMessage: FEED_SKIP_MESSAGES[s.reason],
      })),
      warnings: [
        ...(feed.channel === "meta" && !feed.defaultGoogleCategory
          ? ["Meta ক্যাটালগে google_product_category প্রত্যাশা করে — এই ফিডে সেটি সেট করা হয়নি, আইটেমে ক্যাটাগরি যাবে না।"]
          : []),
        ...(feed.channel === "daraz" ? [DARAZ_FEED_TEMPLATE_WARNING] : []),
      ],
    };
  }

  /** Serve one feed file by token. Throws NotFound for unknown
   * tokens, inactive feeds and extension mismatches alike — the
   * response never reveals which case it was. */
  async serveByToken(token: string, ext: string): Promise<{ contentType: string; body: string }> {
    const feed = await this.table().findFirst({ where: { token } });
    if (!feed || feed.active !== true) throw new NotFoundException("Feed not found");
    const expectedExt = feed.format === "xml" ? "xml" : "csv";
    if (ext !== expectedExt) throw new NotFoundException("Feed not found");
    const { items } = await this.buildForOrg(feed.organizationId, feed);
    let body: string;
    let contentType: string;
    if (feed.format === "xml") {
      const org = await (this.prisma as any).organization.findFirst({
        where: { id: feed.organizationId },
      });
      const setting = await (this.prisma as any).storefrontSetting
        .findFirst({ where: { organizationId: feed.organizationId } })
        .catch(() => null);
      body = serializeFeedXml(items, feed.channel === "google" ? "google" : "meta", {
        name: setting?.shopName ?? org?.name ?? "Shop",
        link: `${webPublicBase()}/`,
        description: `${setting?.shopName ?? org?.name ?? "Shop"} product feed`,
      });
      contentType = "application/xml; charset=utf-8";
    } else if (feed.channel === "daraz") {
      body = serializeDarazCsv(items);
      contentType = "text/csv; charset=utf-8";
    } else {
      body = serializeFeedCsv(items);
      contentType = "text/csv; charset=utf-8";
    }
    // Record the fetch (lastGeneratedAt) — failure-isolated.
    try {
      await this.table().update({ where: { id: feed.id }, data: { lastGeneratedAt: new Date() } });
    } catch (e) {
      this.logger.warn(`feed lastGeneratedAt update failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { contentType, body };
  }
}
