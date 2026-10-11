import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { lookup } from "node:dns/promises";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { MediaStore } from "../inbox/media-store";
import { detectMediaKind } from "../inbox/media-sniff";
import { SOCIAL_MEDIA_MAX_BYTES } from "./social.service";

/** One fetch call (the real implementation is the global fetch). */
export type ImportFetchFn = (url: string, init?: any) => Promise<any>;

/** Resolves a hostname to ALL of its addresses (A + AAAA). */
export type HostResolver = (hostname: string) => Promise<string[]>;

const MAX_REDIRECT_HOPS = 3;
const FETCH_TIMEOUT_MS = 10_000;

/** Parse a dotted-quad IPv4 literal, or return null. */
function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return octets;
}

function ipv4IsPublic(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 0) return false; // 0.0.0.0/8 — "this network"
  if (a === 10) return false; // 10.0.0.0/8 — private
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 — CGNAT shared space
  if (a === 127) return false; // 127.0.0.0/8 — loopback
  if (a === 169 && b === 254) return false; // 169.254.0.0/16 — link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12 — private
  if (a === 192 && b === 168) return false; // 192.168.0.0/16 — private
  if (a >= 224 && a <= 239) return false; // 224.0.0.0/4 — multicast
  if (a >= 240) return false; // 240.0.0.0/4 — reserved (incl. 255.255.255.255)
  return true;
}

/** Expand an IPv6 literal (with `::` compression and an optional
 * trailing embedded IPv4) into 8 hextets, or return null. */
function expandIpv6(address: string): number[] | null {
  let a = address.toLowerCase();
  const v4Tail = a.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Tail) {
    const octets = parseIpv4(v4Tail[1]);
    if (!octets) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    a = `${a.slice(0, a.length - v4Tail[1].length)}${hi}:${lo}`;
  }
  const halves = a.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : null;
  let groups: string[];
  if (tail === null) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array.from({ length: missing }, () => "0"), ...tail];
  }
  const hextets = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  if (hextets.some((n) => !Number.isInteger(n))) return null;
  return hextets;
}

function ipv6IsPublic(address: string): boolean {
  const h = expandIpv6(address);
  if (!h) return false;
  // IPv4-mapped (::ffff:a.b.c.d) — judge the embedded IPv4.
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
    return ipv4IsPublic([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff]);
  }
  if (h.every((x) => x === 0)) return false; // :: — unspecified
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return false; // ::1 — loopback
  const first = h[0];
  if ((first & 0xff00) === 0xff00) return false; // ff00::/8 — multicast
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 — link-local
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 — unique-local
  return true;
}

/**
 * Is this resolved address a public, routable one? Anything that
 * does not parse as an IP at all fails CLOSED (not public).
 * Pure and exported for tests.
 */
export function isPublicAddress(address: string): boolean {
  if (typeof address !== "string" || !address) return false;
  if (address.includes(":")) return ipv6IsPublic(address);
  const octets = parseIpv4(address);
  return octets ? ipv4IsPublic(octets) : false;
}

function extForImageContentType(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "bin";
}

/**
 * PP3 — Product image import (URL → MediaStore).
 *
 * Products carry their photo only as an external `imageUrl`
 * (SP2's documented deferral — there was no way to bring it in).
 * This service fetches that URL ONCE per organization (dedupe on
 * MediaAsset.sourceUrl), stores the bytes through the same
 * MediaStore path as uploads, and records the asset with
 * origin "imported".
 *
 * The fetch is GUARDED (SSRF discipline — the URL is tenant data
 * and the server must never become a proxy into the internal
 * network):
 *  - https: only; URL credentials refused; explicit ports other
 *    than 443 refused — all BEFORE any DNS lookup or fetch.
 *  - The host is resolved first and EVERY returned address must
 *    be public (private / loopback / link-local / CGNAT /
 *    multicast / reserved ranges refused) — the fetch never
 *    starts for a non-public target. Literal-IP hosts flow
 *    through the same resolver path (dns.lookup echoes them).
 *  - Redirects are followed manually (max 3 hops) and EVERY hop
 *    re-runs the full validation — a redirect into a private
 *    target is refused exactly like a direct private URL.
 *  - One AbortController bounds the whole chain at ~10s.
 *  - The body is read with the 2.1 MB cap enforced DURING the
 *    read (streamed accumulation aborts past the cap);
 *    content-length is never trusted.
 *  - The downloaded bytes must sniff as an image by magic bytes
 *    (detectMediaKind) — an HTML page or a PDF served from the
 *    URL is refused, with what was detected named in the error.
 *
 * Known limit (stated honestly in docs/social-pp3-acceptance.md):
 * resolve-then-fetch cannot pin the connection to the validated
 * address with Node's fetch, so a hostile DNS could theoretically
 * rebind between the check and the connect (TOCTOU). The guards
 * above reduce the risk; they do not eliminate it.
 *
 * Seams (public fields, the PP1 SocialRasterService pattern):
 * specs substitute `fetchFn` and `resolveHost` — no spec ever
 * touches the live network.
 */
@Injectable()
export class SocialImportService {
  /** The fetch implementation — defaults to the global fetch. */
  fetchFn: ImportFetchFn = (url: string, init?: any) => fetch(url, init);

  /** Host → all addresses — defaults to dns.lookup({ all: true }). */
  resolveHost: HostResolver = async (hostname: string) => {
    const records = await lookup(hostname, { all: true });
    return records.map((r) => r.address);
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** SocialService.serializeAsset shape (+ sourceUrl). */
  private serializeAsset(row: any) {
    if (!row) return row;
    return {
      id: row.id, kind: row.kind, name: row.name, contentType: row.contentType,
      sizeBytes: row.sizeBytes, createdAt: row.createdAt,
      publicUrl: row.publicToken ? `/public/media/${row.publicToken}` : null,
      origin: row.origin ?? "upload",
      prompt: row.prompt ?? null,
      sourceUrl: row.sourceUrl ?? null,
    };
  }

  /**
   * Import one product's image into the org's Media Library.
   * Returns the serialized asset — the EXISTING one when this
   * product URL was already imported for this org (dedupe: no
   * second fetch, no second row).
   */
  async importForProduct(organizationId: string, actorId: string, productId: string) {
    const product = await (this.prisma as any).product.findFirst({
      where: { id: productId, organizationId },
    });
    if (!product) throw new NotFoundException("Product not found in this organization");

    const imageUrl = typeof product.imageUrl === "string" ? product.imageUrl.trim() : "";
    if (!imageUrl) {
      throw new BadRequestException("এই Product-এর কোনো ছবির URL নেই — আগে Product-এ ছবির URL (imageUrl) যোগ করুন, তারপর import করুন।");
    }

    // Dedupe FIRST: the same source URL in the same org is the
    // same asset — return it without any network work at all.
    const existing = await (this.prisma as any).mediaAsset.findFirst({
      where: { organizationId, sourceUrl: imageUrl },
    });
    if (existing) return this.serializeAsset(existing);

    const bytes = await this.fetchGuardedImage(imageUrl);

    // Magic bytes decide — a URL serving HTML/PDF is refused,
    // with what was actually detected named in the message.
    const detected = detectMediaKind(bytes);
    if (!detected || detected.kind !== "image") {
      const what = detected ? `${detected.contentType}` : "অচেনা ফরম্যাটের ডেটা";
      throw new BadRequestException(`এই URL থেকে ছবি পাওয়া যায়নি — পাওয়া গেছে ${what}। শুধু PNG/JPEG/GIF/WebP ছবি import করা যায়।`);
    }

    const assetId = randomUUID();
    const storageKey = `${organizationId}/social/${assetId}.${extForImageContentType(detected.contentType)}`;
    await MediaStore.fromEnv().put(storageKey, bytes, detected.contentType);
    const asset = await (this.prisma as any).mediaAsset.create({
      data: {
        id: assetId, organizationId, kind: "image",
        name: `${product.name} — ছবি`,
        contentType: detected.contentType, sizeBytes: bytes.length,
        storageKey, origin: "imported", sourceUrl: imageUrl,
        createdById: actorId,
      },
    });

    // Audit metadata: product id + the source HOST only — never
    // the full URL (a query string on a tenant product URL could
    // carry a token; the host is enough to trace the import).
    let sourceHost = "";
    try { sourceHost = new URL(imageUrl).hostname; } catch { sourceHost = ""; }
    await this.audit.log({
      organizationId, userId: actorId, action: "social.media_imported",
      entityType: "MediaAsset", entityId: asset.id,
      metadata: { productId: product.id, sourceHost, contentType: detected.contentType, sizeBytes: bytes.length },
    });
    return this.serializeAsset(asset);
  }

  /**
   * Validate one URL hop (parse, scheme, credentials, port, DNS,
   * public-IP check) and return the parsed URL. Throws a Bengali
   * BadRequestException on any violation — BEFORE any fetch.
   */
  private async validateHop(rawUrl: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BadRequestException(`ছবির URLটি সঠিক URL নয়: ${rawUrl}`);
    }
    if (url.protocol !== "https:") {
      throw new BadRequestException("ছবির URL অবশ্যই https:// দিয়ে শুরু হতে হবে — http বা অন্য protocol থেকে import করা যাবে না।");
    }
    if (url.username || url.password) {
      throw new BadRequestException("ছবির URL-এ username/password থাকা যাবে না।");
    }
    if (url.port && url.port !== "443") {
      throw new BadRequestException(`ছবির URL-এ শুধু port 443 চলবে (দেওয়া হয়েছে ${url.port})।`);
    }
    const hostname = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
    if (!hostname) {
      throw new BadRequestException("ছবির URL-এ host পাওয়া যায়নি।");
    }
    let addresses: string[];
    try {
      addresses = await this.resolveHost(hostname);
    } catch (e) {
      throw new BadRequestException(`ছবির URL-এর host (${hostname}) খুঁজে পাওয়া যায়নি: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!Array.isArray(addresses) || addresses.length === 0) {
      throw new BadRequestException(`ছবির URL-এর host (${hostname})-এর কোনো ঠিকানা পাওয়া যায়নি।`);
    }
    for (const address of addresses) {
      if (!isPublicAddress(address)) {
        throw new BadRequestException("ছবির URL একটি private/internal ঠিকানায় নির্দেশ করে — নিরাপত্তার কারণে সেখান থেকে ছবি import করা যাবে না।");
      }
    }
    return url;
  }

  /**
   * Read a response body with the byte cap enforced DURING the
   * read: streamed chunks accumulate and the read aborts the
   * moment the cap is passed. Stub-shaped responses without a
   * readable body fall back to arrayBuffer + a length check.
   */
  private async readBodyCapped(res: any): Promise<Buffer> {
    const overCap = () => new BadRequestException("ছবিটি অনেক বড় — সর্বোচ্চ ২.১ MB পর্যন্ত ছবি import করা যাবে।");
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
          if (total > SOCIAL_MEDIA_MAX_BYTES) {
            try { await reader.cancel(); } catch { /* the refusal stands either way */ }
            throw overCap();
          }
          chunks.push(Buffer.from(value));
        }
      }
      return Buffer.concat(chunks);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > SOCIAL_MEDIA_MAX_BYTES) throw overCap();
    return buf;
  }

  /**
   * The guarded fetch itself: manual redirect following (≤ 3
   * hops), full re-validation per hop, one ~10s AbortController
   * across the whole chain, cap enforced while reading.
   */
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
          throw new BadRequestException(`ছবির URL থেকে ছবি আনা যায়নি: ${e instanceof Error ? e.message : String(e)}`);
        }
        const status = Number(res?.status ?? 0);
        if (status >= 300 && status < 400) {
          const location = typeof res?.headers?.get === "function"
            ? res.headers.get("location")
            : (res?.headers?.location ?? res?.headers?.Location ?? null);
          if (!location) {
            throw new BadRequestException(`ছবির URL redirect করেছে (HTTP ${status}) কিন্তু কোথায় যাবে তা জানায়নি — import করা গেল না।`);
          }
          if (hop === MAX_REDIRECT_HOPS) {
            throw new BadRequestException("ছবির URL অনেক বেশিবার redirect করেছে — import করা গেল না।");
          }
          // The next hop is validated from scratch at the top of
          // the loop — a redirect to a private target is refused
          // before it is ever fetched.
          current = new URL(location, url).toString();
          continue;
        }
        if (status < 200 || status >= 300) {
          throw new BadRequestException(`ছবির URL থেকে সাড়া পাওয়া যায়নি (HTTP ${status})।`);
        }
        return await this.readBodyCapped(res);
      }
      // Unreachable (the loop returns or throws), but keeps the
      // compiler honest about the return path.
      throw new BadRequestException("ছবির URL অনেক বেশিবার redirect করেছে — import করা গেল না।");
    } finally {
      clearTimeout(timer);
    }
  }
}
