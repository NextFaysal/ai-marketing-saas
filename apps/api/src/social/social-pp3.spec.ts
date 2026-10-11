process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { SocialImportService, isPublicAddress } from "./social-import.service";
import { SocialImageService } from "./social-image.service";
import { SOCIAL_MEDIA_MAX_BYTES } from "./social.service";
import { MediaStore } from "../inbox/media-store";

/**
 * PP3 — Product image import (URL → MediaStore), proven with:
 * - the guarded fetch: https-only / credentials / non-443 port
 *   refused BEFORE DNS or fetch; private/loopback/link-local/
 *   CGNAT/multicast/reserved resolutions refused with the fetch
 *   never called; literal-IP hosts judged through the same
 *   resolver path; redirects followed manually (≤ 3 hops) with
 *   FULL re-validation per hop (a redirect into a private target
 *   is refused and never fetched); non-2xx surfaces its status;
 *   network errors surface verbatim; the 2.1 MB cap is enforced
 *   DURING the body read;
 * - magic-byte discipline: HTML and PDF payloads are refused with
 *   what was detected named, and create no asset;
 * - dedupe: the same product URL imports once per org — the
 *   second call returns the same asset with no second fetch;
 * - storage + audit: origin "imported", sourceUrl stored, bytes
 *   in MediaStore under the uploads' key shape, audit metadata
 *   carries product id + source HOST only (never the full URL —
 *   a query string could carry a token);
 * - template auto-import: createTemplateImage with productId
 *   only builds the poster from the imported photo (the SP2/SP4
 *   dead end is closed), and an import failure surfaces the
 *   importer's Bengali error verbatim with NO poster created.
 *
 * NO live network: the import service's fetchFn + resolveHost
 * seams are stubbed in every test; MediaStore is stubbed at the
 * prototype (the sibling-spec pattern). No Postgres: the PP3
 * migration is unapplied here and applies on the owner's server.
 */

// Standard 1×1 transparent PNG (same fixture as social-image.spec).
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=";
const PNG_BYTES = Buffer.from(PNG_B64, "base64");

const ORG = "org-1";
const ACTOR = "user-1";
const PUBLIC_IP = "93.184.216.34";

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "gte" in (v as any)) {
      return new Date(row[k]) >= (v as any).gte;
    }
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) Object.assign(row, data);
      return row;
    },
  };
}

function fakePrisma() {
  return {
    product: makeTable("product"),
    mediaAsset: makeTable("asset"),
    organization: makeTable("org"),
    aIUsageRecord: makeTable("usage"),
  } as any;
}

function stubMediaStore() {
  const blobs = new Map<string, { bytes: Buffer; contentType: string }>();
  jest.spyOn(MediaStore.prototype, "put").mockImplementation(async (key: string, bytes: Buffer, contentType: string) => {
    blobs.set(key, { bytes: Buffer.from(bytes), contentType });
  });
  jest.spyOn(MediaStore.prototype, "get").mockImplementation(async (key: string) => blobs.get(key)?.bytes ?? null);
  return blobs;
}

/** A fetch-shaped stub response. `chunks` gives the body a real
 * getReader (the streamed-read path); otherwise the body is only
 * readable via arrayBuffer (the fallback path). */
function stubResponse(init: { status?: number; headers?: Record<string, string>; body?: Buffer; chunks?: Buffer[] }) {
  const status = init.status ?? 200;
  const headersMap = new Map(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const res: any = {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => headersMap.get(name.toLowerCase()) ?? null },
    arrayBuffer: async () => {
      const b = init.body ?? Buffer.alloc(0);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
  };
  if (init.chunks) {
    const chunks = init.chunks;
    const cancel = jest.fn(async () => undefined);
    res.body = {
      getReader: () => {
        let i = 0;
        return {
          read: async () => (i < chunks.length
            ? { done: false, value: new Uint8Array(chunks[i++]) }
            : { done: true, value: undefined }),
          cancel,
        };
      },
    };
    res.cancel = cancel;
  }
  return res;
}

function seedProduct(prisma: any, overrides: Record<string, any> = {}) {
  const row = {
    id: "prod-1", organizationId: ORG, name: "Cotton Panjabi",
    category: "Men's Fashion", priceMinor: 150000n, currency: "BDT",
    imageUrl: "https://cdn.example.com/img/panjabi.png",
    ...overrides,
  };
  prisma.product.rows.push(row);
  return row;
}

/**
 * A world with stubbed seams. The default resolver echoes literal
 * IPs (exactly what dns.lookup does) and maps every other host to
 * a public IP unless `hostIps` overrides it.
 */
function makeWorld(hostIps: Record<string, string[]> = {}) {
  const prisma = fakePrisma();
  const blobs = stubMediaStore();
  const auditRows: any[] = [];
  const audit = { log: jest.fn(async (input: any) => { auditRows.push(input); }) } as any;
  const importer = new SocialImportService(prisma, audit);
  const resolveHost = jest.fn(async (host: string): Promise<string[]> => {
    if (hostIps[host]) return hostIps[host];
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) return [host];
    return [PUBLIC_IP];
  });
  importer.resolveHost = resolveHost;
  const fetchFn = jest.fn(async (_url: string): Promise<any> => stubResponse({ body: PNG_BYTES }));
  importer.fetchFn = fetchFn as any;
  return { prisma, blobs, auditRows, audit, importer, resolveHost, fetchFn };
}

afterEach(() => jest.restoreAllMocks());

describe("isPublicAddress", () => {
  const pub = ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "100.63.0.1", "100.128.0.1", "192.167.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"];
  const priv = [
    "0.1.2.3", "10.1.2.3", "100.64.0.1", "100.127.255.255", "127.0.0.1", "169.254.169.254",
    "172.16.0.1", "172.31.255.255", "192.168.0.1", "224.0.0.1", "239.1.1.1", "240.0.0.1",
    "255.255.255.255", "::1", "::", "fe80::1", "febf::ffff", "fc00::1", "fd12:3456::1",
    "ff02::1", "::ffff:10.0.0.1", "::ffff:192.168.1.1", "not-an-ip", "",
  ];
  it.each(pub)("public: %s", (addr) => expect(isPublicAddress(addr)).toBe(true));
  it.each(priv)("non-public: %s", (addr) => expect(isPublicAddress(addr)).toBe(false));
});

describe("SocialImportService.importForProduct", () => {
  it("happy path: public resolution + PNG bytes → imported asset stored, audited with host only", async () => {
    const w = makeWorld();
    seedProduct(w.prisma, { imageUrl: "https://cdn.example.com/img/panjabi.png?sig=SECRET-QUERY" });
    const asset: any = await w.importer.importForProduct(ORG, ACTOR, "prod-1");
    expect(asset.origin).toBe("imported");
    expect(asset.kind).toBe("image");
    expect(asset.contentType).toBe("image/png");
    expect(asset.sourceUrl).toBe("https://cdn.example.com/img/panjabi.png?sig=SECRET-QUERY");
    expect(asset.name).toBe("Cotton Panjabi — ছবি");
    expect(asset.sizeBytes).toBe(PNG_BYTES.length);
    // Stored exactly like an upload: same key shape, real bytes.
    const row = w.prisma.mediaAsset.rows[0];
    expect(row.id).toBe(asset.id);
    expect(row.storageKey).toBe(`${ORG}/social/${asset.id}.png`);
    expect(row.createdById).toBe(ACTOR);
    expect(w.blobs.get(row.storageKey)?.bytes.equals(PNG_BYTES)).toBe(true);
    // One fetch, manual redirects, of the product's exact URL.
    expect(w.fetchFn).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = w.fetchFn.mock.calls[0] as any[];
    expect(calledUrl).toBe("https://cdn.example.com/img/panjabi.png?sig=SECRET-QUERY");
    expect(calledInit.redirect).toBe("manual");
    // Audit: product id + HOST only — the query string never leaks.
    const entry = w.auditRows.find((r: any) => r.action === "social.media_imported");
    expect(entry).toBeTruthy();
    expect(entry.metadata.productId).toBe("prod-1");
    expect(entry.metadata.sourceHost).toBe("cdn.example.com");
    expect(JSON.stringify(w.auditRows)).not.toContain("SECRET-QUERY");
  });

  it("dedupe: a second import of the same product URL returns the same asset — fetch count stays 1", async () => {
    const w = makeWorld();
    seedProduct(w.prisma);
    const first: any = await w.importer.importForProduct(ORG, ACTOR, "prod-1");
    const second: any = await w.importer.importForProduct(ORG, ACTOR, "prod-1");
    expect(second.id).toBe(first.id);
    expect(w.fetchFn).toHaveBeenCalledTimes(1);
    expect(w.resolveHost).toHaveBeenCalledTimes(1);
    expect(w.prisma.mediaAsset.rows).toHaveLength(1);
  });

  it("cross-tenant product → 404, neither seam ever called", async () => {
    const w = makeWorld();
    seedProduct(w.prisma, { id: "prod-other", organizationId: "org-OTHER" });
    const err = await w.importer.importForProduct(ORG, ACTOR, "prod-other").catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.message).toContain("Product not found in this organization");
    expect(w.fetchFn).not.toHaveBeenCalled();
    expect(w.resolveHost).not.toHaveBeenCalled();
  });

  it("empty/null imageUrl → Bengali 400, neither seam ever called", async () => {
    const w = makeWorld();
    seedProduct(w.prisma, { id: "prod-null", imageUrl: null });
    seedProduct(w.prisma, { id: "prod-blank", imageUrl: "   " });
    for (const id of ["prod-null", "prod-blank"]) {
      const err = await w.importer.importForProduct(ORG, ACTOR, id).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain("কোনো ছবির URL নেই");
    }
    expect(w.fetchFn).not.toHaveBeenCalled();
    expect(w.resolveHost).not.toHaveBeenCalled();
  });

  it("http:// URL → 400 BEFORE any DNS lookup or fetch", async () => {
    const w = makeWorld();
    seedProduct(w.prisma, { imageUrl: "http://cdn.example.com/img/panjabi.png" });
    const err = await w.importer.importForProduct(ORG, ACTOR, "prod-1").catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("https://");
    expect(w.resolveHost).not.toHaveBeenCalled();
    expect(w.fetchFn).not.toHaveBeenCalled();
  });

  it("URL credentials and a non-443 port → 400 before DNS/fetch", async () => {
    const w = makeWorld();
    seedProduct(w.prisma, { id: "prod-cred", imageUrl: "https://user:pass@cdn.example.com/x.png" });
    seedProduct(w.prisma, { id: "prod-port", imageUrl: "https://cdn.example.com:8443/x.png" });
    const credErr = await w.importer.importForProduct(ORG, ACTOR, "prod-cred").catch((e) => e);
    expect(credErr).toBeInstanceOf(BadRequestException);
    expect(credErr.message).toContain("username/password");
    const portErr = await w.importer.importForProduct(ORG, ACTOR, "prod-port").catch((e) => e);
    expect(portErr).toBeInstanceOf(BadRequestException);
    expect(portErr.message).toContain("8443");
    expect(w.resolveHost).not.toHaveBeenCalled();
    expect(w.fetchFn).not.toHaveBeenCalled();
  });

  it("resolver returns a private IP → refused, fetch never called (even when one address is public)", async () => {
    const w = makeWorld({ "cdn.example.com": [PUBLIC_IP, "192.168.1.10"] });
    seedProduct(w.prisma);
    const err = await w.importer.importForProduct(ORG, ACTOR, "prod-1").catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("private/internal");
    expect(w.fetchFn).not.toHaveBeenCalled();
    expect(w.prisma.mediaAsset.rows).toHaveLength(0);
  });

  it("literal private-IP URL (resolver echoes the literal) → refused, fetch never called", async () => {
    const w = makeWorld();
    seedProduct(w.prisma, { imageUrl: "https://192.168.1.5/img/x.png" });
    const err = await w.importer.importForProduct(ORG, ACTOR, "prod-1").catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("private/internal");
    expect(w.resolveHost).toHaveBeenCalledWith("192.168.1.5");
    expect(w.fetchFn).not.toHaveBeenCalled();
  });

  it("IPv6 loopback resolution → refused, fetch never called", async () => {
    const w = makeWorld({ "cdn.example.com": ["::1"] });
    seedProduct(w.prisma);
    const err = await w.importer.importForProduct(ORG, ACTOR, "prod-1").catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("private/internal");
    expect(w.fetchFn).not.toHaveBeenCalled();
  });

  it("empty resolution and resolver failure → Bengali 400, fetch never called", async () => {
    const w = makeWorld({ "cdn.example.com": [] });
    seedProduct(w.prisma);
    const err = await w.importer.importForProduct(ORG, ACTOR, "prod-1").catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(w.fetchFn).not.toHaveBeenCalled();

    const w2 = makeWorld();
    seedProduct(w2.prisma);
    w2.importer.resolveHost = jest.fn(async () => { throw new Error("getaddrinfo ENOTFOUND cdn.example.com"); });
    const err2 = await w2.importer.importForProduct(ORG, ACTOR, "prod-1").catch((e) => e);
    expect(err2).toBeInstanceOf(BadRequestException);
    expect(err2.message).toContain("ENOTFOUND");
    expect(w2.fetchFn).not.toHaveBeenCalled();
  });

  it("redirect: hop 1 (302) → hop 2 (public, PNG) succeeds; both hops validated, fetch called twice", async () => {
    const w = makeWorld();
    seedProduct(w.prisma, { imageUrl: "https://cdn.example.com/old.png" });
    w.fetchFn.mockImplementation(async (url: string) => {
      if (url === "https://cdn.example.com/old.png") {
        return stubResponse({ status: 302, headers: { location: "https://images.example.net/final.png" } });
      }
      if (url === "https://images.example.net/final.png") return stubResponse({ body: PNG_BYTES });
      throw new Error(`unexpected fetch: ${url}`);
    });
    const asset: any = await w.importer.importForProduct(ORG, ACTOR, "prod-1");
    expect(asset.origin).toBe("imported");
    expect(asset.contentType).toBe("image/png");
    expect(w.fetchFn).toHaveBeenCalledTimes(2);
    // The redirect target's host was resolved (validated) too.
    expect(w.resolveHost).toHaveBeenCalledWith("cdn.example.com");
    expect(w.resolveHost).toHaveBeenCalledWith("images.example.net");
  });

  it("redirect to a private target → refused; the private URL is NEVER fetched", async () => {
    const w = makeWorld();
    seedProduct(w.prisma, { imageUrl: "https://cdn.example.com/old.png" });
    w.fetchFn.mockImplementation(async (url: string) => {
      if (url === "https://cdn.example.com/old.png") {
        return stubResponse({ status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } });
      }
      throw new Error(`must never fetch: ${url}`);
    });
    const err = await w.importer.importForProduct(ORG, ACTOR, "prod-1").catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("private/internal");
    expect(w.fetchFn).toHaveBeenCalledTimes(1); // only the first, public hop
    expect(w.prisma.mediaAsset.rows).toHaveLength(0);
  });

  it("endless redirects → 400 after the hop budget (4 fetches: initial + 3 hops)", async () => {
    const w = makeWorld();
    seedProduct(w.prisma, { imageUrl: "https://cdn.example.com/loop.png" });
    w.fetchFn.mockImplementation(async () =>
      stubResponse({ status: 302, headers: { location: "https://cdn.example.com/loop.png" } }));
    const err = await w.importer.importForProduct(ORG, ACTOR, "prod-1").catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("redirect");
    expect(w.fetchFn).toHaveBeenCalledTimes(4);
  });

  it("non-2xx final response (404) → Bengali 400 carrying the status, no asset", async () => {
    const w = makeWorld();
    seedProduct(w.prisma);
    w.fetchFn.mockImplementation(async () => stubResponse({ status: 404, body: Buffer.from("not found") }));
    const err = await w.importer.importForProduct(ORG, ACTOR, "prod-1").catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("(HTTP 404)");
    expect(w.prisma.mediaAsset.rows).toHaveLength(0);
  });

  it("network error → Bengali 400 with the underlying message verbatim appended", async () => {
    const w = makeWorld();
    seedProduct(w.prisma);
    w.fetchFn.mockImplementation(async () => { throw new Error("socket hang up verbatim-fixture"); });
    const err = await w.importer.importForProduct(ORG, ACTOR, "prod-1").catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("socket hang up verbatim-fixture");
    expect(w.prisma.mediaAsset.rows).toHaveLength(0);
  });

  it("magic mismatch: HTML bytes → 400 naming the refusal, no MediaAsset row", async () => {
    const w = makeWorld();
    seedProduct(w.prisma);
    w.fetchFn.mockImplementation(async () =>
      stubResponse({ body: Buffer.from("<!DOCTYPE html><html><body>not an image</body></html>") }));
    const err = await w.importer.importForProduct(ORG, ACTOR, "prod-1").catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("ছবি পাওয়া যায়নি");
    expect(w.prisma.mediaAsset.rows).toHaveLength(0);
  });

  it("magic mismatch: PDF bytes → 400 naming what was detected (application/pdf), no asset", async () => {
    const w = makeWorld();
    seedProduct(w.prisma);
    w.fetchFn.mockImplementation(async () =>
      stubResponse({ body: Buffer.from("%PDF-1.7 fake pdf body") }));
    const err = await w.importer.importForProduct(ORG, ACTOR, "prod-1").catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("application/pdf");
    expect(w.prisma.mediaAsset.rows).toHaveLength(0);
  });

  it("oversize body (streamed reader) → cap enforced DURING the read: 400, reader cancelled, no asset", async () => {
    const w = makeWorld();
    seedProduct(w.prisma);
    let lastRes: any;
    w.fetchFn.mockImplementation(async () => {
      lastRes = stubResponse({ chunks: [Buffer.alloc(SOCIAL_MEDIA_MAX_BYTES, 1), Buffer.alloc(64, 2)] });
      return lastRes;
    });
    const err = await w.importer.importForProduct(ORG, ACTOR, "prod-1").catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("২.১ MB");
    expect(lastRes.cancel).toHaveBeenCalled();
    expect(w.prisma.mediaAsset.rows).toHaveLength(0);
  });

  it("oversize body (arrayBuffer fallback) → 400, no asset", async () => {
    const w = makeWorld();
    seedProduct(w.prisma);
    w.fetchFn.mockImplementation(async () =>
      stubResponse({ body: Buffer.alloc(SOCIAL_MEDIA_MAX_BYTES + 1, 7) }));
    const err = await w.importer.importForProduct(ORG, ACTOR, "prod-1").catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("২.১ MB");
    expect(w.prisma.mediaAsset.rows).toHaveLength(0);
  });
});

describe("Template auto-import (SocialImageService.createTemplateImage)", () => {
  function templateWorld(hostIps: Record<string, string[]> = {}) {
    const w = makeWorld(hostIps);
    w.prisma.organization.rows.push({
      id: ORG, name: "Shop One", brandName: "Shop One",
      primaryColor: "#ff5733", logoContentType: null,
    });
    seedProduct(w.prisma);
    const imageSvc = new SocialImageService(w.prisma, w.audit, w.importer);
    return { ...w, imageSvc };
  }

  it("productId only → poster created from the AUTO-IMPORTED photo (data URI derives from the imported bytes)", async () => {
    const w = templateWorld();
    const created: any = await w.imageSvc.createTemplateImage(ORG, ACTOR, { productId: "prod-1", headline: "ঈদ অফার" });
    expect(created.origin).toBe("template");
    expect(created.contentType).toBe("image/svg+xml");
    // The import actually happened (exactly one fetch).
    expect(w.fetchFn).toHaveBeenCalledTimes(1);
    const imported = w.prisma.mediaAsset.rows.find((r: any) => r.origin === "imported");
    expect(imported).toBeTruthy();
    expect(imported.sourceUrl).toBe("https://cdn.example.com/img/panjabi.png");
    // The poster's embedded photo IS the imported PNG, byte-for-byte.
    const posterRow = w.prisma.mediaAsset.rows.find((r: any) => r.id === created.id);
    const svg = w.blobs.get(posterRow.storageKey)?.bytes.toString("utf8") ?? "";
    expect(svg).toContain(`data:image/png;base64,${PNG_B64}`);
    // Default subtext = the product's REAL formatted price, as before.
    expect(svg).toContain("BDT 1500.00");
    expect(w.prisma.aIUsageRecord.rows.some((r: any) => r.feature === "social_template")).toBe(true);
  });

  it("import failure (private IP) → the importer's Bengali error surfaces VERBATIM and NO poster is created", async () => {
    const w = templateWorld({ "cdn.example.com": ["10.0.0.9"] });
    const err = await w.imageSvc.createTemplateImage(ORG, ACTOR, { productId: "prod-1", headline: "ঈদ অফার" }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    // Verbatim: the same call made directly on the importer
    // produces the identical message — nothing was wrapped.
    const direct = await w.importer.importForProduct(ORG, ACTOR, "prod-1").catch((e) => e);
    expect(err.message).toBe(direct.message);
    expect(err.message).toContain("private/internal");
    // No poster, no imported asset, no usage row.
    expect(w.prisma.mediaAsset.rows).toHaveLength(0);
    expect(w.prisma.aIUsageRecord.rows).toHaveLength(0);
  });

  it("mediaAssetId set → behaviour unchanged: no import fetch happens at all", async () => {
    const w = templateWorld();
    const assetRow = {
      id: "asset-1", organizationId: ORG, kind: "image", name: "photo.png",
      contentType: "image/png", sizeBytes: PNG_BYTES.length,
      storageKey: `${ORG}/social/asset-1.png`, publicToken: null,
      origin: "upload", prompt: null, createdById: ACTOR,
    };
    w.prisma.mediaAsset.rows.push(assetRow);
    w.blobs.set(assetRow.storageKey, { bytes: PNG_BYTES, contentType: "image/png" });
    const created: any = await w.imageSvc.createTemplateImage(ORG, ACTOR, {
      mediaAssetId: "asset-1", productId: "prod-1", headline: "Sale",
    });
    expect(created.origin).toBe("template");
    expect(w.fetchFn).not.toHaveBeenCalled();
    expect(w.prisma.mediaAsset.rows.filter((r: any) => r.origin === "imported")).toHaveLength(0);
  });
});
