import { Injectable, Logger, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { PrismaService } from "../prisma/prisma.service";
import { KnowledgeIndexingService } from "./knowledge-indexing.service";
import { LearningService } from "./learning.service";
import {
  extractSameHostLinks,
  loadRobotsDisallows,
  pageAllowed,
  pageTitle,
  stripTags,
} from "../competitors/site-audit";

/**
 * SA-B4 (Smart AI Phase 0, P5b): website learning — the Brain
 * reads the org's OWN public website and keeps what it says as
 * public knowledge.
 *
 * Boundaries, enforced in code:
 *  - The ONLY seed URL is the org's own BusinessProfile
 *    .websiteUrl, and only while websiteLearningEnabled is on.
 *    Links are followed on the SEED HOST ONLY, depth 1, capped
 *    at MAX_PAGES pages per run.
 *  - SSRF: the codebase's scanner utilities (competitors/
 *    site-audit) honour robots + same-host but perform NO
 *    address check, so this service adds the missing guard:
 *    http/https only, and the hostname's DNS answers (or an IP
 *    literal) must contain NO private / loopback / link-local /
 *    reserved address — checked before EVERY fetch, redirects
 *    included (manual redirect handling, max 3 hops, each hop
 *    re-validated). Known limit, recorded honestly: this is a
 *    resolve-then-fetch check; Node's fetch offers no connection
 *    pinning, so a hostile DNS could in theory rebind between
 *    the check and the connect. The seed is the org's own
 *    configured URL (not attacker input), which bounds the
 *    exposure; the check exists so a misconfigured or compromised
 *    URL can never reach the internal network.
 *  - robots.txt is honoured via the scanner's own parser
 *    (loadRobotsDisallows / pageAllowed); a disallowed path is
 *    skipped and reported, never fetched.
 *  - Fetches are bounded: 10s timeout, html content-type only,
 *    page text capped before storage. Failures are recorded per
 *    page and in LearningState — never silent, never fatal to
 *    the sweep.
 *  - Storage: ONE KnowledgeDocument per page, kind "website",
 *    source "website:<url>", visibility "public" (it is the
 *    org's already-published content). A refresh whose extracted
 *    text hashes identically to the stored doc performs NO
 *    update and NO re-index. A page that vanishes is recorded in
 *    the run detail; its doc is NOT deleted (deleting knowledge
 *    is a human act).
 */

export const WEBSITE_LEARNING_UA = "QospreyWebsiteLearner/1.0 (+organization website learning; respects robots.txt)";
export const MAX_PAGES = 10;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_TEXT_CHARS = 20_000;
const MIN_TEXT_CHARS = 40;
const MAX_ORGS_PER_SWEEP = 200;

type FetchFn = typeof fetch;
type LookupFn = (hostname: string, opts: { all: true }) => Promise<{ address: string; family: number }[]>;

const defaultLookup: LookupFn = (hostname, opts) => lookup(hostname, opts) as Promise<{ address: string; family: number }[]>;

/** True for private / loopback / link-local / reserved IPs
 * (v4 + v6, incl. v4-mapped v6). Fail-closed on unparseable. */
export function isPrivateOrReservedIp(ip: string): boolean {
  const addr = String(ip ?? "").trim().toLowerCase();
  if (!addr) return true;
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateOrReservedIp(mapped[1]);
  if (addr.includes(":")) {
    if (addr === "::1" || addr === "::") return true;
    if (/^fe[89ab]/.test(addr)) return true; // fe80::/10 link-local
    if (/^f[cd]/.test(addr)) return true; // fc00::/7 unique-local
    if (/^ff/.test(addr)) return true; // multicast
    return false;
  }
  const parts = addr.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT shared space
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

const isIpLiteral = (host: string): boolean => /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":");

const ASSET_EXT = /\.(?:jpe?g|png|gif|svg|webp|ico|css|js|mjs|pdf|zip|gz|mp4|mp3|woff2?|ttf|eot|xml|json|txt)$/i;

export interface WebsiteLearnResult {
  status: "ok" | "skipped" | "failed";
  reason?: string;
  seedUrl?: string;
  pagesFetched: number;
  pagesCreated: number;
  pagesUpdated: number;
  pagesUnchanged: number;
  skipped: { url: string; reason: string }[];
  errors: { url: string; reason: string }[];
}

@Injectable()
export class WebsiteLearningService {
  private readonly logger = new Logger(WebsiteLearningService.name);
  private readonly fetchFn: FetchFn;
  private readonly lookupFn: LookupFn;
  private indexingFallback?: KnowledgeIndexingService;
  private learningFallback?: LearningService;

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly indexing?: KnowledgeIndexingService,
    @Optional() private readonly learning?: LearningService,
    @Optional() deps?: { fetchFn?: FetchFn; lookupFn?: LookupFn },
  ) {
    this.fetchFn = deps?.fetchFn ?? fetch;
    this.lookupFn = deps?.lookupFn ?? defaultLookup;
  }

  private db(): any {
    if (!this.prisma) throw new Error("WebsiteLearningService: PrismaService is not available");
    return this.prisma as any;
  }

  private indexer(): KnowledgeIndexingService {
    return this.indexing ?? (this.indexingFallback ??= new KnowledgeIndexingService(this.prisma as any));
  }

  private learn(): LearningService {
    return this.learning ?? (this.learningFallback ??= new LearningService(this.prisma as any));
  }

  /** The SSRF gate: scheme + resolved-address check. Throws an
   * Error whose message is the machine-readable reason. */
  async assertPublicHttpUrl(rawUrl: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error("invalid_url");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("blocked_scheme");
    const host = url.hostname.toLowerCase();
    if (!host) throw new Error("invalid_url");
    if (host === "localhost") throw new Error("blocked_private_address");
    if (isIpLiteral(host)) {
      if (isPrivateOrReservedIp(host)) throw new Error("blocked_private_address");
      return url;
    }
    let records: { address: string }[] = [];
    try {
      records = await this.lookupFn(host, { all: true });
    } catch {
      throw new Error("dns_lookup_failed");
    }
    if (!records.length) throw new Error("dns_no_records");
    if (records.some((r) => isPrivateOrReservedIp(r.address))) throw new Error("blocked_private_address");
    return url;
  }

  /** Bounded fetch with manual, re-validated redirects. Returns
   * the html text, or throws a reason-coded Error. */
  private async fetchHtml(rawUrl: string): Promise<{ html: string; finalUrl: string }> {
    let current = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await this.assertPublicHttpUrl(current);
      const res: any = await this.fetchFn(current, {
        headers: { "User-Agent": WEBSITE_LEARNING_UA, Accept: "text/html,application/xhtml+xml" },
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      } as any);
      const status = Number(res?.status ?? 0);
      if (status >= 300 && status < 400) {
        const location = typeof res?.headers?.get === "function" ? res.headers.get("location") : null;
        if (!location) throw new Error(`http_${status}`);
        if (hop === MAX_REDIRECTS) throw new Error("too_many_redirects");
        current = new URL(location, current).toString();
        continue;
      }
      if (!res?.ok) throw new Error(`http_${status || "error"}`);
      const contentType = typeof res?.headers?.get === "function" ? String(res.headers.get("content-type") ?? "") : "";
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        throw new Error("content_type_not_html");
      }
      const html = String(await res.text());
      return { html, finalUrl: current };
    }
    throw new Error("too_many_redirects");
  }

  /** Learn (or refresh) one org's website. Never throws. */
  async learnOrgWebsite(organizationId: string): Promise<WebsiteLearnResult> {
    const out: WebsiteLearnResult = {
      status: "ok", pagesFetched: 0, pagesCreated: 0, pagesUpdated: 0, pagesUnchanged: 0, skipped: [], errors: [],
    };
    try {
      const toggles = await this.learn().getToggles(organizationId);
      if (!toggles.websiteLearningEnabled) return { ...out, status: "skipped", reason: "website_learning_disabled" };
      if (!toggles.websiteUrl) return { ...out, status: "skipped", reason: "no_website_url" };
      const seedRaw = /^https?:\/\//i.test(toggles.websiteUrl) ? toggles.websiteUrl : `https://${toggles.websiteUrl}`;
      const seed = await this.assertPublicHttpUrl(seedRaw).catch((e: Error) => {
        throw Object.assign(new Error(e.message), { seedFailure: true });
      });
      out.seedUrl = seed.toString();

      // robots (the scanner's parser; a blocked/unreachable
      // robots.txt yields no disallows, its own discipline).
      const robotsFetch: FetchFn = (async (u: any, init: any) => {
        await this.assertPublicHttpUrl(String(u));
        return this.fetchFn(u, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      }) as FetchFn;
      const disallows = await loadRobotsDisallows(robotsFetch, seed.origin).catch(() => [] as string[]);
      if (!pageAllowed(seed.toString(), disallows)) {
        out.skipped.push({ url: seed.toString(), reason: "robots_disallow" });
        await this.learn().saveState(organizationId, "website", {
          watermark: new Date(), lastStatus: "skipped",
          lastDetail: { seedUrl: out.seedUrl, skipped: out.skipped, errors: [] },
        });
        return { ...out, status: "skipped", reason: "robots_disallow" };
      }

      // Seed page first, then same-host links (depth 1).
      const seedFetched = await this.fetchHtml(seed.toString()).catch((e: Error) => {
        throw Object.assign(new Error(e.message), { seedFailure: true });
      });
      const candidates: string[] = [seed.toString()];
      for (const link of extractSameHostLinks(seedFetched.html, seed)) {
        if (candidates.length >= MAX_PAGES) break;
        if (candidates.includes(link)) continue;
        if (ASSET_EXT.test(new URL(link).pathname)) continue;
        candidates.push(link);
      }

      for (const pageUrl of candidates) {
        if (!pageAllowed(pageUrl, disallows)) {
          out.skipped.push({ url: pageUrl, reason: "robots_disallow" });
          continue;
        }
        try {
          const fetched = pageUrl === seed.toString() ? seedFetched : await this.fetchHtml(pageUrl);
          out.pagesFetched++;
          const text = stripTags(fetched.html).slice(0, MAX_TEXT_CHARS);
          if (text.length < MIN_TEXT_CHARS) {
            out.skipped.push({ url: pageUrl, reason: "thin_content" });
            continue;
          }
          const title = (pageTitle(fetched.html) ?? new URL(pageUrl).pathname).slice(0, 200);
          const source = `website:${pageUrl}`;
          const existing = await this.db().knowledgeDocument.findFirst({
            where: { organizationId, source },
          });
          const hash = createHash("sha256").update(text).digest("hex");
          if (existing) {
            const existingHash = createHash("sha256").update(String(existing.content ?? "")).digest("hex");
            if (existingHash === hash) {
              out.pagesUnchanged++;
              continue;
            }
            const updated = await this.db().knowledgeDocument.update({
              where: { id: existing.id },
              data: { title, content: text, kind: "website", visibility: "public" },
            });
            out.pagesUpdated++;
            await this.indexer().indexDocument(updated).catch(() => undefined);
          } else {
            const created = await this.db().knowledgeDocument.create({
              data: { organizationId, kind: "website", title, content: text, visibility: "public", source },
            });
            out.pagesCreated++;
            await this.indexer().indexDocument(created).catch(() => undefined);
          }
        } catch (e) {
          out.errors.push({ url: pageUrl, reason: e instanceof Error ? e.message : "fetch_failed" });
        }
      }

      if (!out.pagesFetched && out.errors.length) out.status = "failed";
      await this.learn().saveState(organizationId, "website", {
        watermark: new Date(),
        lastStatus: out.status === "ok" ? "ok" : out.status,
        lastDetail: {
          seedUrl: out.seedUrl, pagesFetched: out.pagesFetched, pagesCreated: out.pagesCreated,
          pagesUpdated: out.pagesUpdated, pagesUnchanged: out.pagesUnchanged,
          skipped: out.skipped, errors: out.errors,
        },
      });
      return out;
    } catch (e) {
      const reason = e instanceof Error ? e.message : "website_learning_failed";
      out.status = "failed";
      out.reason = reason;
      this.logger.error(`website learning failed for org ${organizationId}: ${reason}`);
      await this.learn()
        .saveState(organizationId, "website", { lastStatus: "failed", lastDetail: { reason, seedUrl: out.seedUrl ?? null } })
        .catch(() => undefined);
      return out;
    }
  }

  /** The website_learning_sweep job body: every org whose
   * profile enables website learning and carries a URL. One
   * org's failure never stops the sweep. */
  async runSweep(): Promise<{ orgs: number; results: { organizationId: string; status: string; reason?: string }[] }> {
    const results: { organizationId: string; status: string; reason?: string }[] = [];
    try {
      const profiles = await this.db().businessProfile.findMany({
        where: { websiteLearningEnabled: true },
        select: { organizationId: true, websiteUrl: true },
        take: MAX_ORGS_PER_SWEEP,
      });
      for (const p of profiles ?? []) {
        if (!p?.websiteUrl || !String(p.websiteUrl).trim()) continue;
        const r = await this.learnOrgWebsite(String(p.organizationId));
        results.push({ organizationId: String(p.organizationId), status: r.status, reason: r.reason });
      }
    } catch (e) {
      this.logger.error(`website learning sweep failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { orgs: results.length, results };
  }
}
