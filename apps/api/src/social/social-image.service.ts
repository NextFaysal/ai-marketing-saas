import { BadRequestException, HttpException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { MediaStore } from "../inbox/media-store";
import { detectMediaKind } from "../inbox/media-sniff";
import { resolveImageProvider } from "../ai/images/image.factory";
import { storedAssetPublicUrl } from "../storage/media-url";
import { SocialImportService } from "./social-import.service";
import { formatMinor } from "@repo/contracts";

/** XML-escape interpolated text for the poster SVG. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Word-wrap poster headline text into at most 2 lines of
 * `maxChars` characters; overflow is cut with an ellipsis on the
 * second line. Pure and exported for tests.
 */
export function wrapPosterText(text: string, maxChars = 24): string[] {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let overflow = false;
  for (const word of words) {
    if (lines.length >= 2) { overflow = true; break; }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (word.length > maxChars) overflow = true;
    if (current) {
      lines.push(current);
      if (lines.length >= 2) { overflow = true; break; }
      current = word.slice(0, maxChars);
    } else {
      // A single word longer than the line budget.
      current = word.slice(0, maxChars);
    }
  }
  if (current && lines.length < 2) lines.push(current);
  if (lines.length === 0) lines.push("");
  if (!overflow && lines.join(" ") !== words.join(" ")) overflow = true;
  if (overflow) {
    const last = lines.length - 1;
    lines[last] = (lines[last].length >= maxChars ? lines[last].slice(0, maxChars - 1) : lines[last]) + "…";
  }
  return lines;
}

/**
 * Compose the template poster as a standalone SVG (1080×1080):
 * the tenant's photo embedded byte-for-byte as a data URI (no
 * decode/raster step needed), an optional brand header (logo +
 * brand name), and a brand-colour bottom band carrying the
 * headline and subtext. Pure and exported for tests.
 */
export function composePosterSvg(input: {
  photoDataUri: string;
  headline: string;
  subtext: string;
  brandName: string;
  primaryColor: string;
  logoDataUri?: string;
}): string {
  const { photoDataUri, headline, subtext, brandName, primaryColor, logoDataUri } = input;
  const lines = wrapPosterText(headline, 24);
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">`);
  parts.push(`<image href="${photoDataUri}" x="0" y="0" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/>`);
  if (logoDataUri || brandName) {
    parts.push(`<rect x="0" y="0" width="1080" height="150" fill="rgba(0,0,0,0.35)"/>`);
  }
  if (logoDataUri) {
    parts.push(`<image href="${logoDataUri}" x="36" y="36" width="96" height="96"/>`);
  }
  if (brandName) {
    const x = logoDataUri ? 148 : 36;
    parts.push(`<text x="${x}" y="96" font-size="40" fill="#FFFFFF" font-family="sans-serif">${escapeXml(brandName)}</text>`);
  }
  parts.push(`<rect x="0" y="820" width="1080" height="260" fill="${escapeXml(primaryColor)}" opacity="0.94"/>`);
  const tspans = lines
    .map((line, i) => `<tspan x="54" dy="${i === 0 ? 0 : 70}">${escapeXml(line)}</tspan>`)
    .join("");
  parts.push(`<text x="54" y="915" font-size="62" font-weight="bold" fill="#FFFFFF" font-family="sans-serif">${tspans}</text>`);
  if (subtext) {
    parts.push(`<text x="54" y="1015" font-size="46" fill="#FFFFFF" opacity="0.92" font-family="sans-serif">${escapeXml(subtext)}</text>`);
  }
  parts.push(`</svg>`);
  return parts.join("");
}

function extForImageContentType(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("svg")) return "svg";
  return "bin";
}

/**
 * SP4 — AI image generation + template poster composer.
 *
 * AI generation goes through the platform image provider
 * (Admin → Platform Config, verify-before-save). Grounding
 * honesty: a linked product enriches the prompt with its NAME
 * and CATEGORY only — never its price or any claim — because an
 * image prompt must not bake invented marketing facts into pixels.
 *
 * The template composer needs no provider at all: it renders a
 * real SVG poster from the tenant's own library photo, brand
 * colour/logo and text (see docs/social-sp4-acceptance.md for the
 * rendering decision and its honest limits).
 */
@Injectable()
export class SocialImageService {
  private readonly importer: SocialImportService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() importer?: SocialImportService,
  ) {
    // PP3: product-image import (SocialModule provides the real
    // service; specs may inject one with stubbed fetch/DNS seams).
    // Defaults to a real instance sharing this service's prisma +
    // audit — the SocialPublishService pattern — so existing
    // two-argument spec constructions keep working unchanged.
    this.importer = importer ?? new SocialImportService(prisma, audit);
  }

  /** Public seam for tests and the status endpoint. */
  resolveProvider() {
    return resolveImageProvider();
  }

  private serializeAsset(row: any) {
    if (!row) return row;
    return {
      id: row.id, kind: row.kind, name: row.name, contentType: row.contentType,
      sizeBytes: row.sizeBytes, createdAt: row.createdAt,
      publicUrl: storedAssetPublicUrl(row),
      origin: row.origin ?? "upload",
      prompt: row.prompt ?? null,
    };
  }

  private async checkDailyLimit(organizationId: string) {
    const { killSwitches, effectiveLimits, isAiDisabledForOrg } = await import("../common/platform-settings");
    const ks = await killSwitches(this.prisma as any);
    if (isAiDisabledForOrg(ks, organizationId)) {
      throw new HttpException(ks.aiGloballyPaused ? "AI features are temporarily paused platform-wide by the platform team." : "AI features are temporarily disabled for this organization by the platform team.", 403);
    }
    const baseline = Number(process.env.AI_DAILY_MESSAGE_LIMIT ?? 200);
    const { aiDaily: limit } = await effectiveLimits(this.prisma as any, organizationId, { aiDaily: baseline, broadcastCap: 1000 });
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const used = await (this.prisma as any).aIUsageRecord.count({
      where: { organizationId, feature: "social_image", createdAt: { gte: startOfDay } },
    });
    if (used >= limit) {
      throw new HttpException(
        `Daily AI generation limit reached for this organization (${limit}). Try again tomorrow or ask the platform team to raise your plan limit.`,
        429,
      );
    }
  }

  imageStatus() {
    const r = this.resolveProvider();
    return { configured: Boolean(r), provider: r?.providerName ?? null };
  }

  async generateAiImage(
    organizationId: string,
    actorId: string,
    dto: { prompt: string; productId?: string },
  ) {
    const prompt = dto.prompt?.trim() ?? "";
    if (!prompt) throw new BadRequestException("ছবির বর্ণনা (Prompt) দিন।");

    // Enforcement FIRST (kill switch + daily cap), mirroring SP3/M55.
    await this.checkDailyLimit(organizationId);

    const r = this.resolveProvider();
    if (!r) {
      throw new BadRequestException("AI ছবি তৈরির provider configure করা নেই — Admin Panel থেকে সেট করুন, অথবা Template Poster ব্যবহার করুন");
    }

    let product: any = null;
    if (dto.productId) {
      product = await (this.prisma as any).product.findFirst({
        where: { id: dto.productId, organizationId },
      });
      if (!product) throw new NotFoundException("Product not found in this organization");
    }

    // Grounding: the product contributes its name and category
    // ONLY — never its price, discounts or any other claim.
    const finalPrompt = product
      ? `${prompt}\nProduct: ${product.name}${product.category ? `. Category: ${product.category}` : ""}.`
      : prompt;

    let result: any;
    try {
      result = await r.provider.generate(finalPrompt);
    } catch (e: any) {
      // Provider failure: verbatim error, NO usage row, NO asset.
      throw new BadRequestException(e?.message ?? String(e));
    }

    // The provider's bytes must actually be an image — magic bytes
    // decide, exactly like uploads. Unusable bytes produce nothing:
    // no asset and no usage row (nothing usable was produced).
    const detected = detectMediaKind(result.bytes, result.contentType);
    if (!detected || detected.kind !== "image") {
      throw new BadRequestException("Provider এমন ডেটা ফেরত দিয়েছে যা ছবি হিসেবে পড়া যাচ্ছে না — Asset তৈরি হয়নি।");
    }

    const id = randomUUID();
    const storageKey = `${organizationId}/social/${id}.${extForImageContentType(detected.contentType)}`;
    await MediaStore.fromEnv().put(storageKey, result.bytes, detected.contentType);
    const asset = await (this.prisma as any).mediaAsset.create({
      data: {
        id, organizationId, kind: "image",
        name: `AI ছবি — ${prompt.slice(0, 40)}`,
        contentType: detected.contentType, sizeBytes: result.bytes.length,
        storageKey, origin: "ai_generated", prompt: finalPrompt, createdById: actorId,
      },
    });

    // Usage is recorded only AFTER the asset persisted.
    await (this.prisma as any).aIUsageRecord.create({
      data: {
        organizationId, userId: actorId, feature: "social_image",
        provider: r.providerName, model: result.model,
        inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        estimated: result.tokensEstimated,
      },
    });

    await this.audit.log({
      organizationId, userId: actorId, action: "social.ai_image_created",
      entityType: "MediaAsset", entityId: asset.id,
      metadata: { provider: r.providerName, model: result.model, sizeBytes: result.bytes.length },
    });

    return this.serializeAsset(asset);
  }

  async createTemplateImage(
    organizationId: string,
    actorId: string,
    dto: { mediaAssetId?: string; productId?: string; headline: string; subtext?: string },
  ) {
    const headline = dto.headline?.trim() ?? "";
    if (!headline) throw new BadRequestException("Poster-এর Headline দিন।");
    if (headline.length > 120) {
      throw new BadRequestException("Headline সর্বোচ্চ ১২০ অক্ষরের হতে পারবে।");
    }

    let product: any = null;
    if (dto.productId) {
      product = await (this.prisma as any).product.findFirst({
        where: { id: dto.productId, organizationId },
      });
      if (!product) throw new NotFoundException("Product not found in this organization");
    }

    // PP3 closes the SP2 deferral: a product-only poster no
    // longer dead-ends. The product's photo is AUTO-IMPORTED from
    // its external imageUrl (guarded fetch + dedupe live in
    // SocialImportService) and the imported asset row then flows
    // through EXACTLY the mediaAssetId path below. Import errors
    // propagate UNCHANGED — they are already honest Bengali
    // HttpExceptions; wrapping or silently falling back would
    // hide why the poster could not be made.
    let photoAssetId = dto.mediaAssetId;
    if (!photoAssetId) {
      if (dto.productId) {
        const imported = await this.importer.importForProduct(organizationId, actorId, dto.productId);
        photoAssetId = imported.id;
      } else {
        throw new BadRequestException("Template Poster-এর জন্য একটি ছবি বেছে নিন।");
      }
    }

    const asset = await (this.prisma as any).mediaAsset.findFirst({
      where: { id: photoAssetId, organizationId },
    });
    if (!asset) throw new NotFoundException("Media asset not found in this organization");
    if (asset.kind !== "image") {
      throw new BadRequestException("Template Poster-এর জন্য একটি ছবি (image) asset লাগবে।");
    }

    // An explicit subtext (even "") wins; otherwise the poster's
    // subtext defaults to the product's REAL formatted price.
    const subtext = dto.subtext !== undefined
      ? dto.subtext.trim()
      : (product ? formatMinor(BigInt(product.priceMinor), product.currency) : "");

    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    const primaryColor = /^#[0-9a-fA-F]{6}$/.test(org?.primaryColor ?? "")
      ? (org.primaryColor as string).toUpperCase()
      : "#111827";
    const brandName = org?.brandName || org?.name || "";

    const photoBytes = await MediaStore.fromEnv().get(asset.storageKey);
    if (!photoBytes) throw new NotFoundException("Media bytes not found in storage");
    const photoDataUri = `data:${asset.contentType};base64,${photoBytes.toString("base64")}`;

    let logoDataUri: string | undefined;
    try {
      if (org?.logoContentType) {
        const b = await MediaStore.fromEnv().get(`branding/${organizationId}/logo`);
        if (b) logoDataUri = `data:${org.logoContentType};base64,${b.toString("base64")}`;
      }
    } catch { logoDataUri = undefined; }

    const svg = composePosterSvg({ photoDataUri, headline, subtext, brandName, primaryColor, logoDataUri });

    const bytes = Buffer.from(svg, "utf8");
    const id = randomUUID();
    const storageKey = `${organizationId}/social/${id}.svg`;
    await MediaStore.fromEnv().put(storageKey, bytes, "image/svg+xml");
    const created = await (this.prisma as any).mediaAsset.create({
      data: {
        id, organizationId, kind: "image",
        name: `Template Poster — ${headline.slice(0, 50)}`,
        contentType: "image/svg+xml", sizeBytes: bytes.length,
        storageKey, origin: "template", prompt: null, createdById: actorId,
      },
    });

    // Visibility-only usage row under a SEPARATE feature so
    // template renders never consume the social_image AI cap.
    await (this.prisma as any).aIUsageRecord.create({
      data: {
        organizationId, userId: actorId, feature: "social_template",
        provider: "template-composer", model: "svg-template-v1",
        inputTokens: 0, outputTokens: 0, estimated: true,
      },
    });

    await this.audit.log({
      organizationId, userId: actorId, action: "social.template_image_created",
      entityType: "MediaAsset", entityId: created.id,
      metadata: { sizeBytes: bytes.length, withProduct: Boolean(product) },
    });

    return this.serializeAsset(created);
  }
}
