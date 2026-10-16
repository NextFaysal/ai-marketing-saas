import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { decryptJson, encryptJson } from "../integrations/crypto";
import { socialVideoMaxBytes } from "./social.service";
import { SocialImportService } from "./social-import.service";

/** One fetch call (the real implementation is the global fetch). */
export type StockFetchFn = (url: string, init?: any) => Promise<any>;

const PEXELS_API = "https://api.pexels.com";

/**
 * SN5 — stock media (Pexels) with the tenant's OWN API key.
 *
 * Key discipline (OrgLlmConfig / CC8 pattern, SP4 verify-before-
 * save): the key lives ONLY inside OrgStockConfig.encryptedData
 * (sealed JSON { apiKey }); it is saved only after a REAL Pexels
 * call with that key succeeds — a failed verification saves
 * nothing and surfaces Pexels' answer verbatim. No response,
 * audit row or log line ever carries the key; the status shape
 * exposes configured + last-4 only.
 *
 * Import discipline: the client names a stock item by id only.
 * The service re-reads the item from Pexels itself, takes the
 * canonical file URL from the provider's payload, and hands it
 * to SocialImportService.importExternalMedia — the codebase's
 * ONE SSRF-guarded URL→bytes path. Attribution (photographer
 * credit) is stored on the asset and copied onto derived assets
 * by the library service, so a credit is never silently dropped.
 *
 * Seam (public field, the PP1 pattern): specs substitute
 * `fetchFn` — no spec ever touches the live network.
 */
@Injectable()
export class SocialStockService {
  /** The fetch implementation — defaults to the global fetch. */
  fetchFn: StockFetchFn = (url: string, init?: any) => fetch(url, init);

  private readonly importer: SocialImportService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() importer?: SocialImportService,
  ) {
    this.importer = importer ?? new SocialImportService(prisma, audit);
  }

  // ---------- key storage (sealed) ----------

  private async getConfigRow(organizationId: string): Promise<any | null> {
    return (this.prisma as any).orgStockConfig?.findUnique?.({
      where: { organizationId },
    }).catch(() => null) ?? null;
  }

  /** The decrypted key, or null. Plaintext lives only in this
   * return value, in memory (org-llm-config discipline). */
  private async resolveKey(organizationId: string): Promise<string | null> {
    const row = await this.getConfigRow(organizationId);
    if (!row?.encryptedData) return null;
    try {
      const payload = decryptJson<{ apiKey?: string }>(row.encryptedData);
      return typeof payload?.apiKey === "string" && payload.apiKey ? payload.apiKey : null;
    } catch {
      return null;
    }
  }

  /** Honest status: configured + last-4 ONLY — never the key. */
  async getStockStatus(organizationId: string) {
    const row = await this.getConfigRow(organizationId);
    if (!row) {
      return {
        configured: false, provider: "pexels", status: null,
        lastVerifiedAt: null, keyLast4: null,
      };
    }
    const key = await this.resolveKey(organizationId);
    return {
      configured: Boolean(key),
      provider: "pexels",
      status: row.status ?? "configured",
      lastVerifiedAt: row.lastVerifiedAt ?? null,
      keyLast4: key ? key.slice(-4) : null,
    };
  }

  /** One real Pexels call with `apiKey` — the verify probe AND
   * the shared request helper. Throws a Bengali BadRequest with
   * Pexels' own answer on any non-200. */
  private async pexelsGet(apiKey: string, path: string): Promise<any> {
    let res: any;
    try {
      res = await this.fetchFn(`${PEXELS_API}${path}`, {
        headers: { Authorization: apiKey },
      });
    } catch (e) {
      throw new BadRequestException(`Pexels-এ সংযোগ করা যায়নি: ${e instanceof Error ? e.message : String(e)}`);
    }
    const status = Number(res?.status ?? 0);
    if (status < 200 || status >= 300) {
      let detail = "";
      try {
        const body = await res.json();
        detail = typeof body?.error === "string" ? body.error
          : typeof body?.status === "string" ? body.status
          : typeof body?.message === "string" ? body.message : "";
      } catch { detail = ""; }
      throw new BadRequestException(`Pexels অনুরোধ ব্যর্থ হয়েছে (HTTP ${status})${detail ? `: ${detail}` : ""}`);
    }
    try {
      return await res.json();
    } catch {
      throw new BadRequestException("Pexels এমন উত্তর দিয়েছে যা পড়া যাচ্ছে না — আবার চেষ্টা করুন।");
    }
  }

  /**
   * Verify-before-save (SP4 discipline): probe Pexels with the
   * NEW key first; only a real success writes the sealed row.
   * A failed probe throws verbatim and saves NOTHING (an older
   * saved key, if any, stays exactly as it was).
   */
  async saveStockKey(organizationId: string, actorId: string, dto: { apiKey?: string }) {
    const apiKey = typeof dto?.apiKey === "string" ? dto.apiKey.trim() : "";
    if (!apiKey) throw new BadRequestException("Pexels API key দিন।");
    await this.pexelsGet(apiKey, "/v1/curated?per_page=1");
    const data = {
      provider: "pexels",
      encryptedData: encryptJson({ apiKey }),
      status: "verified",
      lastVerifiedAt: new Date(),
      lastError: null,
    };
    const existing = await this.getConfigRow(organizationId);
    if (existing) {
      await (this.prisma as any).orgStockConfig.update({ where: { id: existing.id }, data });
    } else {
      await (this.prisma as any).orgStockConfig.create({ data: { organizationId, ...data } });
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "social.stock_key_saved",
      entityType: "Organization", entityId: organizationId,
      metadata: { provider: "pexels" },
    });
    return this.getStockStatus(organizationId);
  }

  async deleteStockKey(organizationId: string, actorId: string) {
    const existing = await this.getConfigRow(organizationId);
    if (existing) {
      await (this.prisma as any).orgStockConfig.delete({ where: { id: existing.id } });
      await this.audit.log({
        organizationId, userId: actorId, action: "social.stock_key_deleted",
        entityType: "Organization", entityId: organizationId,
        metadata: { provider: "pexels" },
      });
    }
    return this.getStockStatus(organizationId);
  }

  private async requireKey(organizationId: string): Promise<string> {
    const key = await this.resolveKey(organizationId);
    if (!key) {
      throw new BadRequestException("আগে নিজের Pexels API key যোগ করুন — Library-র Stock অংশে key দিলে তবেই stock ছবি/ভিডিও খোঁজা যাবে।");
    }
    return key;
  }

  // ---------- search ----------

  /** Pexels photo → the search item shape. Pure mapping. */
  static mapPhotoItem(raw: any) {
    const src = raw?.src ?? {};
    return {
      stockId: String(raw?.id ?? ""),
      kind: "photo" as const,
      thumbUrl: src.medium ?? src.small ?? src.tiny ?? null,
      width: typeof raw?.width === "number" ? raw.width : null,
      height: typeof raw?.height === "number" ? raw.height : null,
      duration: null as number | null,
      photographer: typeof raw?.photographer === "string" ? raw.photographer : "",
      pageUrl: typeof raw?.url === "string" ? raw.url : "",
      alt: typeof raw?.alt === "string" ? raw.alt : "",
    };
  }

  /** Pexels video → the search item shape. Pure mapping. */
  static mapVideoItem(raw: any) {
    const pictures = Array.isArray(raw?.video_pictures) ? raw.video_pictures : [];
    return {
      stockId: String(raw?.id ?? ""),
      kind: "video" as const,
      thumbUrl: pictures[0]?.picture ?? (typeof raw?.image === "string" ? raw.image : null),
      width: typeof raw?.width === "number" ? raw.width : null,
      height: typeof raw?.height === "number" ? raw.height : null,
      duration: typeof raw?.duration === "number" ? raw.duration : null,
      photographer: typeof raw?.user?.name === "string" ? raw.user.name : "",
      pageUrl: typeof raw?.url === "string" ? raw.url : "",
      alt: "",
    };
  }

  async searchStock(
    organizationId: string,
    query: { q?: string; kind?: string; page?: number | string },
  ) {
    const key = await this.requireKey(organizationId);
    const kind = query?.kind === "video" ? "video" : "photo";
    const pageRaw = Number(query?.page);
    const page = Number.isFinite(pageRaw) ? Math.min(50, Math.max(1, Math.floor(pageRaw))) : 1;
    const q = typeof query?.q === "string" ? query.q.trim().slice(0, 100) : "";
    const perPage = 15;
    let path: string;
    if (kind === "video") {
      path = q
        ? `/videos/search?query=${encodeURIComponent(q)}&per_page=${perPage}&page=${page}`
        : `/videos/popular?per_page=${perPage}&page=${page}`;
    } else {
      path = q
        ? `/v1/search?query=${encodeURIComponent(q)}&per_page=${perPage}&page=${page}`
        : `/v1/curated?per_page=${perPage}&page=${page}`;
    }
    const body = await this.pexelsGet(key, path);
    const rawItems: any[] = kind === "video"
      ? (Array.isArray(body?.videos) ? body.videos : [])
      : (Array.isArray(body?.photos) ? body.photos : []);
    const items = rawItems.map((r) => kind === "video"
      ? SocialStockService.mapVideoItem(r)
      : SocialStockService.mapPhotoItem(r));
    return {
      kind, page,
      totalResults: typeof body?.total_results === "number" ? body.total_results : items.length,
      items,
    };
  }

  // ---------- import ----------

  /** The file URL to download for one provider item — photos
   * take large2x (sharp, library-sized); videos take the
   * largest MP4 that fits the video cap, falling back to the
   * largest MP4 Pexels offers when sizes are unlisted. */
  static pickFileUrl(kind: "photo" | "video", raw: any): string {
    if (kind === "photo") {
      const src = raw?.src ?? {};
      return src.large2x ?? src.large ?? src.original ?? "";
    }
    const files: any[] = (Array.isArray(raw?.video_files) ? raw.video_files : [])
      .filter((f: any) => typeof f?.link === "string" && f.link);
    if (files.length === 0) return "";
    const mp4 = files.filter((f) => String(f.file_type ?? "").includes("mp4"));
    const pool = mp4.length > 0 ? mp4 : files;
    const cap = socialVideoMaxBytes();
    const area = (f: any) => (Number(f.width) || 0) * (Number(f.height) || 0);
    const fitting = pool.filter((f) => typeof f.size === "number" && f.size <= cap);
    const chosen = (fitting.length > 0 ? fitting : pool)
      .slice()
      .sort((a, b) => area(b) - area(a))[0];
    return chosen?.link ?? "";
  }

  /**
   * Import one stock item by id. The provider payload is re-read
   * here, so the downloaded URL and the credit line ALWAYS come
   * from Pexels itself — never from the client. Dedupe (on the
   * Pexels page URL) lives in the importer: importing the same
   * item twice returns the existing asset.
   */
  async importStock(
    organizationId: string,
    actorId: string,
    dto: { stockId?: string; kind?: string },
  ) {
    const kind = dto?.kind === "video" ? "video" : "photo";
    const stockId = typeof dto?.stockId === "string" ? dto.stockId.trim() : "";
    if (!/^\d+$/.test(stockId)) {
      throw new BadRequestException("সঠিক Stock item বেছে নিন।");
    }
    const key = await this.requireKey(organizationId);
    const raw = await this.pexelsGet(key, kind === "video" ? `/videos/videos/${stockId}` : `/v1/photos/${stockId}`);
    const item = kind === "video"
      ? SocialStockService.mapVideoItem(raw)
      : SocialStockService.mapPhotoItem(raw);
    const fileUrl = SocialStockService.pickFileUrl(kind, raw);
    if (!fileUrl || !item.pageUrl) {
      throw new BadRequestException("Pexels এই item-এর ডাউনলোডযোগ্য ফাইল দেয়নি — অন্য একটি item বেছে নিন।");
    }
    const attribution = item.photographer
      ? `${kind === "video" ? "Video" : "Photo"} by ${item.photographer} on Pexels`
      : "Pexels";
    const name = kind === "photo" && item.alt
      ? item.alt
      : `Pexels ${kind === "video" ? "ভিডিও" : "ছবি"} — ${item.photographer || item.stockId}`;
    const asset = await this.importer.importExternalMedia(organizationId, actorId, {
      fileUrl, name, origin: "pexels", sourceUrl: item.pageUrl, attribution,
    });
    // The importer returns the library shape (plus sourceUrl /
    // attribution); add the remaining library fields the web
    // tile reads so an imported asset renders exactly like any
    // other asset in the grid.
    return {
      ...asset,
      folderId: (asset as any).folderId ?? null,
      tags: Array.isArray((asset as any).tags) ? (asset as any).tags : [],
      derivedFromId: (asset as any).derivedFromId ?? null,
    };
  }
}
