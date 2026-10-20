import { Injectable, Optional } from "@nestjs/common";
import { badRequest } from "../i18n";
import { lookup } from "node:dns/promises";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";
import { StorageRegistryService } from "../storage/storage-registry.service";
import { detectMediaKind } from "../inbox/media-sniff";
import { isPublicAddress } from "../social/social-import.service";
import { imageExtForContentType, mediaCdnHost, publicMediaUrl } from "../storage/media-url";
import { orgFlagEnabled } from "../common/feature-flags";

/** One fetch call (the real implementation is the global fetch). */
export type MirrorFetchFn = (url: string, init?: any) => Promise<any>;
/** Resolves a hostname to ALL of its addresses (A + AAAA). */
export type MirrorHostResolver = (hostname: string) => Promise<string[]>;

/** RM4 mirror bounds (stated constants, not buried magic): at most
 * this many candidate images are processed per run (the rest wait
 * for the next run), and at most this many fetches run against the
 * SAME host at once, so one slow merchant CDN cannot be hammered. */
export const MIRROR_BATCH_LIMIT = 25;
export const MIRROR_PER_HOST_CONCURRENCY = 2;
/** Same 10 MB ceiling as the direct-upload path (RM4). */
export const MIRROR_MAX_BYTES = 10 * 1024 * 1024;
/** RB6b (plan D3): the OrgFeatureFlag key for the auto-mirror
 * opt-out. No row = auto-mirror ON (the D3 default); a row with
 * enabled=false is the merchant's opt-out. Read via orgFlagEnabled
 * (the codebase's per-org opt-out resolution). */
export const PRODUCT_IMAGE_AUTO_MIRROR_FLAG = "product_image_auto_mirror";
const MAX_REDIRECT_HOPS = 3;
const FETCH_TIMEOUT_MS = 10_000;

export interface MirrorFailure {
  productId: string;
  host: string;
  reason: string;
}

/** RB6b: review-image counts, reported separately from the
 * product counts (the product fields keep their RM4 shape). A
 * dedupe adoption counts as `mirrored` here — the entry now
 * points at the org's own CDN either way. */
export interface ReviewMirrorSummary {
  scanned: number;
  mirrored: number;
  failed: number;
}

export interface MirrorSummary {
  scanned: number;
  mirrored: number;
  deduped: number;
  failed: MirrorFailure[];
  reviews: ReviewMirrorSummary;
}

interface MirrorCandidate {
  product: any;
  /** The gallery row to rewrite, or null when the candidate is
   * the product's cover imageUrl with no matching gallery row. */
  imageRow: any | null;
  url: string;
}

/** RB6b: one external image URL inside one ExternalReview row's
 * imageUrls array. Entries (not unique URLs) are the counting
 * unit for the reviews summary. */
interface ReviewImageEntry {
  review: any;
  url: string;
}

/**
 * RM4 — mirror external product images into the org's own R2
 * public bucket, so a shop stops depending on merchant/Shopify/
 * WooCommerce image hosts staying alive and fast.
 *
 * "External" = a ProductImage.url or Product.imageUrl that is an
 * http(s) URL whose host is NOT our CDN host. Mirroring fetches
 * the bytes under the PP3 guarded-fetch policy (see
 * SocialImportService): https only, no URL credentials, port 443
 * only, the host is DNS-resolved first and EVERY address must be
 * public, redirects followed manually (≤3) with full revalidation
 * per hop, one ~10s timeout over the chain, the body read with the
 * cap enforced DURING the read, and the bytes must sniff as an
 * image by magic bytes. The one deliberate difference from PP3 is
 * the cap: 10 MB here (product photos), not the social 2.1 MB. The
 * known TOCTOU limit from PP3 applies identically (resolve-then-
 * fetch cannot pin the connection to the validated address).
 *
 * Dedupe is by content: the sha256 of the fetched bytes is looked
 * up in the StoredFile registry (same org, surface "product", not
 * trashed) BEFORE any upload — a hit means the row simply adopts
 * the already-stored object's CDN URL and nothing is uploaded
 * again. URLs repeated across rows/products in the same run also
 * share ONE fetch. A failed candidate leaves its row untouched;
 * failures are reported in the return value only (no new table).
 *
 * Triggered by the OWNER/ADMIN endpoint
 * (POST organizations/:orgId/products/images/mirror-external)
 * and, since RB6b, by the scheduled `product_image_mirror_sweep`
 * job (per-org enable, owner-controlled like every sweep), which
 * honours the plan-D3 opt-out: an OrgFeatureFlag row
 * (`product_image_auto_mirror`, enabled=false) turns the
 * automatic run off for that org; no row = ON. The manual
 * endpoint is an explicit owner action and is NOT gated by the
 * opt-out. RB6b also mirrors ExternalReview imageUrls through
 * the same pipeline (surface "review"), reported separately in
 * the summary's `reviews` field.
 *
 * Seams (the PP3 pattern): specs substitute `fetchFn` and
 * `resolveHost` — no spec touches the live network.
 */
@Injectable()
export class ProductImageMirrorService {
  /** The fetch implementation — defaults to the global fetch. */
  fetchFn: MirrorFetchFn = (url: string, init?: any) => fetch(url, init);

  /** Host → all addresses — defaults to dns.lookup({ all: true }). */
  resolveHost: MirrorHostResolver = async (hostname: string) => {
    const records = await lookup(hostname, { all: true });
    return records.map((r) => r.address);
  };

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly storage?: StorageService,
    @Optional() private readonly registry?: StorageRegistryService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  // ---------- candidate discovery ----------

  private isExternalImageUrl(raw: unknown): raw is string {
    if (typeof raw !== "string" || !raw.trim()) return false;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return false;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return url.hostname.toLowerCase() !== mediaCdnHost();
  }

  private hostOf(raw: string): string {
    try {
      return new URL(raw).hostname;
    } catch {
      return "";
    }
  }

  private async loadCandidates(organizationId: string): Promise<MirrorCandidate[]> {
    const productTable = (this.prisma as any).product;
    const imageTable = (this.prisma as any).productImage;
    const products: any[] = (await productTable.findMany({ where: { organizationId } })) ?? [];
    const candidates: MirrorCandidate[] = [];
    for (const product of products) {
      const rows: any[] = imageTable?.findMany
        ? ((await imageTable.findMany({ where: { productId: product.id } })) ?? [])
        : [];
      const sorted = [...rows].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      const galleryUrls = new Set<string>();
      for (const row of sorted) {
        if (this.isExternalImageUrl(row.url)) {
          candidates.push({ product, imageRow: row, url: row.url });
          galleryUrls.add(row.url);
        }
      }
      // The cover counts once: when Product.imageUrl is external
      // AND already a gallery row's URL, the row above covers it
      // (its rewrite also fixes the cover via the equality update
      // in applyOutcome); only a cover with no gallery row gets
      // its own candidate.
      if (this.isExternalImageUrl(product.imageUrl) && !galleryUrls.has(product.imageUrl)) {
        candidates.push({ product, imageRow: null, url: product.imageUrl });
      }
    }
    return candidates;
  }

  /** RB6b: external image URLs from the org's ExternalReview
   * rows (WooCommerce review photos live on the merchant's host
   * today, exactly like product images did). Bounded by the same
   * stated per-run cap as the product pass — entries past the
   * cap simply wait for the next run. */
  private async loadReviewEntries(organizationId: string): Promise<ReviewImageEntry[]> {
    const reviewTable = (this.prisma as any).externalReview;
    if (!reviewTable?.findMany) return [];
    const rows: any[] = (await reviewTable.findMany({ where: { organizationId } })) ?? [];
    const entries: ReviewImageEntry[] = [];
    for (const review of rows) {
      const urls = Array.isArray(review?.imageUrls) ? review.imageUrls : [];
      for (const u of urls) {
        if (this.isExternalImageUrl(u)) entries.push({ review, url: u });
        if (entries.length >= MIRROR_BATCH_LIMIT) return entries;
      }
    }
    return entries;
  }

  // ---------- guarded fetch (PP3 policy, 10 MB cap) ----------

  private async validateHop(rawUrl: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw badRequest("products.mirrorUrlInvalid", { url: rawUrl });
    }
    if (url.protocol !== "https:") {
      throw badRequest("products.mirrorHttpsOnly");
    }
    if (url.username || url.password) {
      throw badRequest("products.mirrorUrlNoCredentials");
    }
    if (url.port && url.port !== "443") {
      throw badRequest("products.mirrorPort443Only", { port: url.port });
    }
    const hostname = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
    if (!hostname) throw badRequest("products.mirrorHostMissing");
    let addresses: string[];
    try {
      addresses = await this.resolveHost(hostname);
    } catch (e) {
      throw badRequest("products.mirrorHostLookupFailed", { host: hostname, detail: e instanceof Error ? e.message : String(e) });
    }
    if (!Array.isArray(addresses) || addresses.length === 0) {
      throw badRequest("products.mirrorHostNoAddress", { host: hostname });
    }
    for (const address of addresses) {
      if (!isPublicAddress(address)) {
        throw badRequest("products.mirrorPrivateAddress");
      }
    }
    return url;
  }

  private async readBodyCapped(res: any): Promise<Buffer> {
    const overCap = () => new Error("ছবিটি অনেক বড় — সর্বোচ্চ ১০ MB পর্যন্ত ছবি মিরর করা যায়।");
    const body = res?.body;
    if (body && typeof body.getReader === "function") {
      const reader = body.getReader();
      const chunks: Buffer[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > MIRROR_MAX_BYTES) {
            try { await reader.cancel(); } catch { /* the refusal stands either way */ }
            throw overCap();
          }
          chunks.push(Buffer.from(value));
        }
      }
      return Buffer.concat(chunks);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MIRROR_MAX_BYTES) throw overCap();
    return buf;
  }

  private async fetchGuardedImage(startUrl: string): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      let current = startUrl;
      for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
        const url = await this.validateHop(current);
        let res: any;
        try {
          res = await this.fetchFn(url.toString(), { redirect: "manual", signal: controller.signal });
        } catch (e) {
          throw badRequest("products.mirrorFetchFailed", { detail: e instanceof Error ? e.message : String(e) });
        }
        const status = Number(res?.status ?? 0);
        if (status >= 300 && status < 400) {
          const location = typeof res?.headers?.get === "function" ? res.headers.get("location") : null;
          if (!location) throw badRequest("products.mirrorRedirectNoLocation", { status });
          if (hop === MAX_REDIRECT_HOPS) throw badRequest("products.mirrorTooManyRedirects");
          current = new URL(location, url).toString();
          continue;
        }
        if (status !== 200) {
          throw badRequest("products.mirrorHttpStatus", { status });
        }
        return await this.readBodyCapped(res);
      }
      throw badRequest("products.mirrorTooManyRedirects");
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- per-host fetch throttling ----------

  private hostGates = new Map<string, { running: number; waiters: Array<() => void> }>();

  private async withHostSlot<T>(host: string, fn: () => Promise<T>): Promise<T> {
    let gate = this.hostGates.get(host);
    if (!gate) {
      gate = { running: 0, waiters: [] };
      this.hostGates.set(host, gate);
    }
    if (gate.running >= MIRROR_PER_HOST_CONCURRENCY) {
      await new Promise<void>((resolve) => gate!.waiters.push(resolve));
    }
    gate.running += 1;
    try {
      return await fn();
    } finally {
      gate.running -= 1;
      const next = gate.waiters.shift();
      if (next) next();
    }
  }

  // ---------- the auto-mirror opt-out (RB6b, plan D3) ----------

  /** Auto-mirror is ON unless the org has an OrgFeatureFlag row
   * (`product_image_auto_mirror`) with enabled=false. Resolution
   * is orgFlagEnabled's: explicit row wins, anything unreadable
   * means enabled — a flag lookup can never silently turn the
   * feature off. */
  async autoMirrorEnabled(organizationId: string): Promise<boolean> {
    return orgFlagEnabled(this.prisma as any, organizationId, PRODUCT_IMAGE_AUTO_MIRROR_FLAG);
  }

  async setAutoMirrorEnabled(
    organizationId: string,
    enabled: boolean,
    actorId: string,
  ): Promise<{ productImageAutoMirror: boolean }> {
    const table = (this.prisma as any).orgFeatureFlag;
    if (table?.upsert) {
      await table.upsert({
        where: { organizationId_key: { organizationId, key: PRODUCT_IMAGE_AUTO_MIRROR_FLAG } },
        create: { organizationId, key: PRODUCT_IMAGE_AUTO_MIRROR_FLAG, enabled },
        update: { enabled },
      });
    }
    if (this.audit) {
      await this.audit
        .log({
          organizationId,
          userId: actorId,
          action: "product.images.auto_mirror_setting",
          entityType: "Organization",
          entityId: organizationId,
          metadata: { enabled },
        })
        .catch(() => undefined);
    }
    return { productImageAutoMirror: enabled };
  }

  /** The scheduled entry point (job type
   * `product_image_mirror_sweep`). An opted-out org is a skip,
   * not a failure; otherwise this is the SAME run as the manual
   * endpoint, reshaped to flat counts for the job result. */
  async runAutoMirror(organizationId: string, actorId: string): Promise<unknown> {
    if (!(await this.autoMirrorEnabled(organizationId))) {
      return { skipped: "opted-out" };
    }
    const s = await this.mirrorExternalImages(organizationId, actorId);
    return {
      scanned: s.scanned,
      mirrored: s.mirrored,
      deduped: s.deduped,
      failed: s.failed.length,
      reviews: s.reviews,
    };
  }

  // ---------- shared fetch → store pipeline ----------

  /** Phases 1–2, shared by the product and review passes: fetch
   * every unique URL (per-host throttled), then — sequentially,
   * on purpose, so the registry check-then-register cannot race
   * itself when two URLs serve identical bytes — sniff, dedupe
   * by sha256 against the registry (same org + surface), and
   * upload the survivors. One outcome per URL. */
  private async resolveUrlOutcomes(
    organizationId: string,
    actorId: string,
    urls: string[],
    firstOwnerByUrl: Map<string, string>,
    surface: string,
    keyFor: (ownerId: string, ext: string) => string,
    storage: StorageService,
  ): Promise<Map<string, { cdnUrl: string; kind: "mirrored" | "deduped" } | { error: string }>> {
    const fetched = new Map<string, { bytes: Buffer } | { error: string }>();
    await Promise.all(
      urls.map(async (url) => {
        try {
          const bytes = await this.withHostSlot(this.hostOf(url), () => this.fetchGuardedImage(url));
          fetched.set(url, { bytes });
        } catch (e) {
          fetched.set(url, { error: e instanceof Error ? e.message : String(e) });
        }
      }),
    );

    const outcomeByUrl = new Map<string, { cdnUrl: string; kind: "mirrored" | "deduped" } | { error: string }>();
    for (const url of urls) {
      const got = fetched.get(url)!;
      if ("error" in got) {
        outcomeByUrl.set(url, { error: got.error });
        continue;
      }
      try {
        const detected = detectMediaKind(got.bytes);
        if (!detected || detected.kind !== "image") {
          const what = detected ? detected.contentType : "অচেনা ফরম্যাটের ডেটা";
          throw badRequest("products.mirrorNotAnImage", { what });
        }
        const sha256 = createHash("sha256").update(got.bytes).digest("hex");
        const existing = await (this.prisma as any).storedFile?.findFirst?.({
          where: { organizationId, sha256, surface, status: { not: "trashed" } },
        });
        if (existing?.key) {
          outcomeByUrl.set(url, { cdnUrl: publicMediaUrl(existing.key), kind: "deduped" });
          continue;
        }
        const key = keyFor(firstOwnerByUrl.get(url)!, imageExtForContentType(detected.contentType));
        await storage.put("public", key, got.bytes, detected.contentType);
        try {
          await this.registry?.register({
            organizationId,
            bucket: storage.bucketFor("public"),
            key,
            visibility: "public",
            surface,
            contentType: detected.contentType,
            sizeBytes: got.bytes.length,
            sha256,
            status: "active",
            createdById: actorId,
            // sourceRef = WHERE the bytes came from (the dedupe
            // anchor for future runs, alongside the sha256).
            sourceRef: url,
          });
        } catch (e) {
          await storage.delete("public", key).catch(() => undefined);
          throw e;
        }
        outcomeByUrl.set(url, { cdnUrl: publicMediaUrl(key), kind: "mirrored" });
      } catch (e) {
        outcomeByUrl.set(url, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    return outcomeByUrl;
  }

  /** Product pass — Phase 3: rewrite the gallery rows / covers.
   * A row's failure is reported and its URL left untouched,
   * exactly like a fetch failure. */
  private async mirrorProductBatch(
    organizationId: string,
    actorId: string,
    batch: MirrorCandidate[],
    summary: MirrorSummary,
    storage: StorageService,
  ): Promise<void> {
    // Group by source URL: rows/products sharing one URL fetch it
    // once. Map preserves first-seen order (stable reporting).
    const byUrl = new Map<string, MirrorCandidate[]>();
    for (const c of batch) {
      const group = byUrl.get(c.url);
      if (group) group.push(c);
      else byUrl.set(c.url, [c]);
    }
    const firstOwnerByUrl = new Map<string, string>(
      [...byUrl.entries()].map(([url, group]) => [url, group[0].product.id] as [string, string]),
    );
    const outcomeByUrl = await this.resolveUrlOutcomes(
      organizationId,
      actorId,
      [...byUrl.keys()],
      firstOwnerByUrl,
      "product",
      (productId, ext) => `${organizationId}/product/${productId}/${randomUUID()}.${ext}`,
      storage,
    );

    for (const c of batch) {
      const outcome = outcomeByUrl.get(c.url)!;
      if ("error" in outcome) {
        summary.failed.push({ productId: c.product.id, host: this.hostOf(c.url), reason: outcome.error });
        continue;
      }
      try {
        if (c.imageRow) {
          await (this.prisma as any).productImage.update({
            where: { id: c.imageRow.id },
            data: { url: outcome.cdnUrl },
          });
        }
        if (c.product.imageUrl === c.url) {
          await (this.prisma as any).product.update({
            where: { id: c.product.id },
            data: { imageUrl: outcome.cdnUrl },
          });
        }
        if (outcome.kind === "mirrored") summary.mirrored += 1;
        else summary.deduped += 1;
      } catch (e) {
        summary.failed.push({
          productId: c.product.id,
          host: this.hostOf(c.url),
          reason: `ছবি সংরক্ষণের পর রেকর্ড আপডেট ব্যর্থ: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  }

  /** Review pass (RB6b) — rewrite each review row's imageUrls:
   * successful entries become CDN URLs, failed entries keep the
   * original URL, non-external entries pass through untouched.
   * One update per changed row; if that update fails, the row's
   * would-be successes count as failed (the row still shows the
   * external URL, so the next run retries them). */
  private async mirrorReviewBatch(
    organizationId: string,
    actorId: string,
    entries: ReviewImageEntry[],
    summary: MirrorSummary,
    storage: StorageService,
  ): Promise<void> {
    const urls = [...new Set(entries.map((e) => e.url))];
    const firstOwnerByUrl = new Map<string, string>();
    for (const e of entries) {
      if (!firstOwnerByUrl.has(e.url)) firstOwnerByUrl.set(e.url, e.review.id);
    }
    const outcomeByUrl = await this.resolveUrlOutcomes(
      organizationId,
      actorId,
      urls,
      firstOwnerByUrl,
      "review",
      (reviewId, ext) => `${organizationId}/review/${reviewId}/${randomUUID()}.${ext}`,
      storage,
    );

    const byReview = new Map<string, { review: any; urls: string[] }>();
    for (const e of entries) {
      const group = byReview.get(e.review.id);
      if (group) group.urls.push(e.url);
      else byReview.set(e.review.id, { review: e.review, urls: [e.url] });
    }
    for (const { review, urls: reviewUrls } of byReview.values()) {
      const original: any[] = Array.isArray(review.imageUrls) ? review.imageUrls : [];
      let changed = false;
      const next = original.map((u: any) => {
        if (typeof u !== "string") return u;
        const outcome = outcomeByUrl.get(u);
        if (outcome && "cdnUrl" in outcome) {
          changed = true;
          return outcome.cdnUrl;
        }
        return u;
      });
      let updateFailed = false;
      if (changed) {
        try {
          await (this.prisma as any).externalReview.update({
            where: { id: review.id },
            data: { imageUrls: next },
          });
        } catch {
          updateFailed = true;
        }
      }
      for (const u of reviewUrls) {
        const outcome = outcomeByUrl.get(u);
        if (outcome && "cdnUrl" in outcome && !updateFailed) summary.reviews.mirrored += 1;
        else summary.reviews.failed += 1;
      }
    }
  }

  // ---------- the run ----------

  async mirrorExternalImages(organizationId: string, actorId: string): Promise<MirrorSummary> {
    const all = await this.loadCandidates(organizationId);
    const batch = all.slice(0, MIRROR_BATCH_LIMIT);
    const reviewEntries = await this.loadReviewEntries(organizationId);
    const summary: MirrorSummary = {
      scanned: batch.length,
      mirrored: 0,
      deduped: 0,
      failed: [],
      reviews: { scanned: reviewEntries.length, mirrored: 0, failed: 0 },
    };
    if (batch.length === 0 && reviewEntries.length === 0) return summary;
    if (!this.storage || this.storage.mode !== "s3") {
      // Honest refusal, not a fake "0 mirrored": without object
      // storage there is nowhere for mirrored bytes to go.
      for (const c of batch) {
        summary.failed.push({
          productId: c.product.id,
          host: this.hostOf(c.url),
          reason: "object storage (Cloudflare R2) সেটআপ হয়নি — মিরর করা যাচ্ছে না।",
        });
      }
      summary.reviews.failed = reviewEntries.length;
      return summary;
    }
    const storage = this.storage;

    if (batch.length > 0) {
      await this.mirrorProductBatch(organizationId, actorId, batch, summary, storage);
    }
    if (reviewEntries.length > 0) {
      await this.mirrorReviewBatch(organizationId, actorId, reviewEntries, summary, storage);
    }

    if (this.audit) {
      await this.audit
        .log({
          organizationId,
          userId: actorId,
          action: "product.images.mirror_external",
          entityType: "Product",
          entityId: organizationId,
          metadata: {
            scanned: summary.scanned,
            mirrored: summary.mirrored,
            deduped: summary.deduped,
            failed: summary.failed.length,
            failedHosts: [...new Set(summary.failed.map((f) => f.host).filter(Boolean))],
            reviews: summary.reviews,
          },
        })
        .catch(() => undefined);
    }
    return summary;
  }
}
