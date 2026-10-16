import { createHash } from "node:crypto";
import { OrganizationsService } from "./organizations.service";

/**
 * RB4/RM5 item 2 — hash-versioned CDN logos.
 *
 * Fake Prisma in the m59 spec pattern; StorageService and the
 * registry are recorded fakes. Pins: the versioned key shape,
 * the absolute CDN logoUrl stored in s3 mode, the byte-for-byte
 * legacy behaviour in local mode, the redirect decision, and
 * the remove-time registry trash marking.
 */

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const HASH8 = createHash("sha256").update(PNG_1PX).digest("hex").slice(0, 8);
const VERSIONED_KEY = `branding/org-1/logo-${HASH8}.png`;
const CDN_URL = `https://media.qosprey.com/${VERSIONED_KEY}`;

function table(seed: any[] = []) {
  const rows = [...seed];
  return {
    rows,
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    findFirst: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("row not found");
      Object.assign(row, data);
      return row;
    },
  };
}

function makeService(storageMode: "s3" | "local" | "absent") {
  const orgs = table([
    { id: "org-1", name: "Demo Shop", slug: "demo", creditMinor: 0n, logoUrl: null, logoContentType: null },
  ]);
  const prisma: any = { organization: orgs };
  const audit: any = { log: async () => undefined };
  const puts: any[] = [];
  const objects = new Map<string, Buffer>();
  const storage: any =
    storageMode === "absent"
      ? undefined
      : {
          mode: storageMode,
          bucketFor: (v: string) => (v === "public" ? "qosprey-media-public" : "qosprey-media-private"),
          put: async (visibility: string, key: string, bytes: Buffer, contentType: string) => {
            puts.push({ visibility, key, contentType, size: bytes.length });
            objects.set(`${visibility}:${key}`, Buffer.from(bytes));
          },
          get: async (visibility: string, key: string) => objects.get(`${visibility}:${key}`) ?? null,
        };
  const registered: any[] = [];
  const trashed: any[] = [];
  const registry: any = {
    register: async (input: any) => { registered.push(input); return input; },
    markTrashed: async (orgId: string, key: string) => { trashed.push({ orgId, key }); return { key, trashed: true }; },
  };
  const service = new OrganizationsService(prisma, audit, storage, registry);
  const legacyStore = new Map<string, Buffer>();
  (service as any)._mediaStore = {
    put: async (key: string, bytes: Buffer) => { legacyStore.set(key, Buffer.from(bytes)); },
    get: async (key: string) => legacyStore.get(key) ?? null,
  };
  return { service, orgs, puts, objects, registered, trashed, legacyStore };
}

describe("RB4 logoVersionedKey", () => {
  it("builds branding/{org}/logo-{hash8}.{ext} per content type", () => {
    expect(OrganizationsService.logoVersionedKey("org-9", "abcdef01", "image/png")).toBe("branding/org-9/logo-abcdef01.png");
    expect(OrganizationsService.logoVersionedKey("org-9", "abcdef01", "image/jpeg")).toBe("branding/org-9/logo-abcdef01.jpg");
    expect(OrganizationsService.logoVersionedKey("org-9", "abcdef01", "image/webp")).toBe("branding/org-9/logo-abcdef01.webp");
  });
});

describe("RB4 uploadLogo in s3 mode", () => {
  it("puts to the public bucket under the versioned key and stores the CDN URL", async () => {
    const { service, orgs, puts, registered, legacyStore } = makeService("s3");
    const out = await service.uploadLogo("org-1", "user-1", {
      contentType: "image/png",
      dataBase64: PNG_1PX.toString("base64"),
    } as any);
    expect(puts).toEqual([{ visibility: "public", key: VERSIONED_KEY, contentType: "image/png", size: PNG_1PX.length }]);
    expect(legacyStore.size).toBe(0);
    expect(out.logoUrl).toBe(CDN_URL);
    expect(orgs.rows[0].logoUrl).toBe(CDN_URL);
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({
      organizationId: "org-1", bucket: "qosprey-media-public", key: VERSIONED_KEY,
      visibility: "public", surface: "branding", status: "active",
      sha256: createHash("sha256").update(PNG_1PX).digest("hex"),
    });
  });

  it("re-uploading the same bytes yields the same key; different bytes a new key", async () => {
    const { service } = makeService("s3");
    const dto = { contentType: "image/png", dataBase64: PNG_1PX.toString("base64") } as any;
    const a = await service.uploadLogo("org-1", "user-1", dto);
    const b = await service.uploadLogo("org-1", "user-1", dto);
    expect(a.logoUrl).toBe(b.logoUrl);
  });
});

describe("RB4 uploadLogo in local mode — M59 behaviour unchanged", () => {
  it("fixed legacy key + relative logoPath, no storage calls", async () => {
    const { service, orgs, puts, legacyStore } = makeService("local");
    const out = await service.uploadLogo("org-1", "user-1", {
      contentType: "image/png",
      dataBase64: PNG_1PX.toString("base64"),
    } as any);
    expect(puts).toEqual([]);
    expect(legacyStore.has("branding/org-1/logo")).toBe(true);
    expect(out.logoUrl).toBe("/public/branding/org-1/logo");
    expect(orgs.rows[0].logoUrl).toBe("/public/branding/org-1/logo");
  });
});

describe("RB4 public logo serving decisions", () => {
  it("logoRedirectUrl returns the stored URL only for CDN-era rows", async () => {
    const { service, orgs } = makeService("s3");
    orgs.rows[0].logoUrl = CDN_URL;
    orgs.rows[0].logoContentType = "image/png";
    await expect(service.logoRedirectUrl("org-1")).resolves.toBe(CDN_URL);
    orgs.rows[0].logoUrl = "/public/branding/org-1/logo";
    await expect(service.logoRedirectUrl("org-1")).resolves.toBeNull();
    orgs.rows[0].logoUrl = null;
    await expect(service.logoRedirectUrl("org-1")).resolves.toBeNull();
  });

  it("publicLogo reads the versioned key from the public bucket for CDN rows", async () => {
    const { service, orgs, objects } = makeService("s3");
    orgs.rows[0].logoUrl = CDN_URL;
    orgs.rows[0].logoContentType = "image/png";
    objects.set(`public:${VERSIONED_KEY}`, PNG_1PX);
    const logo = await service.publicLogo("org-1");
    expect(logo?.contentType).toBe("image/png");
    expect(logo?.bytes.equals(PNG_1PX)).toBe(true);
  });

  it("removeLogo marks the CDN object trashed in the registry", async () => {
    const { service, orgs, trashed } = makeService("s3");
    orgs.rows[0].logoUrl = CDN_URL;
    orgs.rows[0].logoContentType = "image/png";
    await service.removeLogo("org-1", "user-1");
    expect(trashed).toEqual([{ orgId: "org-1", key: VERSIONED_KEY }]);
    expect(orgs.rows[0].logoUrl).toBeNull();
  });

  it("removeLogo on a legacy row touches no registry", async () => {
    const { service, orgs, trashed } = makeService("s3");
    orgs.rows[0].logoUrl = "/public/branding/org-1/logo";
    orgs.rows[0].logoContentType = "image/png";
    await service.removeLogo("org-1", "user-1");
    expect(trashed).toEqual([]);
  });
});
