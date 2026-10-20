import { BadRequestException, ConflictException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { OrganizationsService } from "./organizations.service";

/**
 * Milestone 59 — Agency White-Label v1 (API side).
 * Hand-rolled fake Prisma in the codebase's spec pattern; the
 * MediaStore is replaced with an in-memory fake via the same lazy
 * accessor the InboxService pattern uses.
 */

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (k === "NOT") { if (matchWhere(row, v)) return false; continue; }
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const cond = v as any;
      if ("not" in cond && row[k] === cond.not) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function table(seed: any[] = []) {
  const rows = [...seed];
  return {
    rows,
    findUnique: async ({ where }: any) => rows.find((r) => matchWhere(r, where)) ?? null,
    findFirst: async ({ where }: any) => rows.find((r) => matchWhere(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)),
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("row not found");
      Object.assign(row, data);
      return row;
    },
  };
}

function makeService() {
  const orgs = table([
    { id: "org-1", name: "Demo Shop", slug: "demo", creditMinor: 0n, brandName: null, logoUrl: null, logoContentType: null, primaryColor: null, customDomain: null },
    { id: "org-2", name: "Other Agency", slug: "other", creditMinor: 0n, brandName: null, logoUrl: null, logoContentType: null, primaryColor: null, customDomain: "reports.taken.com" },
  ]);
  const prisma: any = { organization: orgs };
  const auditCalls: any[] = [];
  const audit: any = { log: async (e: any) => { auditCalls.push(e); } };
  const service = new OrganizationsService(prisma, audit);
  const store = new Map<string, { bytes: Buffer; contentType: string }>();
  (service as any)._mediaStore = {
    put: async (key: string, bytes: Buffer, contentType: string) => { store.set(key, { bytes, contentType }); },
    get: async (key: string) => store.get(key)?.bytes ?? null,
  };
  return { service, orgs, auditCalls, store };
}

describe("M59 branding settings", () => {
  it("saves brand name, colour (uppercased) and domain (lowercased, protocol stripped)", async () => {
    const { service, orgs, auditCalls } = makeService();
    const out = await service.updateBranding("org-1", "u-1", {
      brandName: "  Amar Dokan  ", primaryColor: "#4f46e5", customDomain: "https://Reports.MyAgency.com/x",
    });
    expect(out.brandName).toBe("Amar Dokan");
    expect(out.primaryColor).toBe("#4F46E5");
    expect(out.customDomain).toBe("reports.myagency.com");
    expect(orgs.rows[0].brandName).toBe("Amar Dokan");
    expect(auditCalls.some((c) => c.action === "org.branding.update")).toBe(true);
  });

  it("clears fields on empty string", async () => {
    const { service } = makeService();
    await service.updateBranding("org-1", "u-1", { brandName: "X" });
    const out = await service.updateBranding("org-1", "u-1", { brandName: "  " });
    expect(out.brandName).toBeNull();
  });

  it("rejects a malformed colour and a malformed domain", async () => {
    const { service } = makeService();
    await expect(service.updateBranding("org-1", "u-1", { primaryColor: "red" })).rejects.toBeInstanceOf(ApiException);
    await expect(service.updateBranding("org-1", "u-1", { primaryColor: "#12345" })).rejects.toBeInstanceOf(ApiException);
    await expect(service.updateBranding("org-1", "u-1", { customDomain: "not a domain" })).rejects.toBeInstanceOf(ApiException);
    await expect(service.updateBranding("org-1", "u-1", { customDomain: "localhost" })).rejects.toBeInstanceOf(ApiException);
  });

  it("rejects a domain another org already saved, but allows the owner org to keep its own", async () => {
    const { service } = makeService();
    await expect(service.updateBranding("org-1", "u-1", { customDomain: "reports.taken.com" })).rejects.toBeInstanceOf(ApiException);
    const own = await service.updateBranding("org-2", "u-9", { customDomain: "reports.taken.com" });
    expect(own.customDomain).toBe("reports.taken.com");
  });

  it("tenant isolation: updating org-1 never touches org-2's row", async () => {
    const { service, orgs } = makeService();
    await service.updateBranding("org-1", "u-1", { brandName: "Only Mine", primaryColor: "#000000" });
    expect(orgs.rows[1].brandName).toBeNull();
    expect(orgs.rows[1].primaryColor).toBeNull();
  });

  it("rejects an empty update", async () => {
    const { service } = makeService();
    await expect(service.updateBranding("org-1", "u-1", {})).rejects.toBeInstanceOf(ApiException);
  });
});

describe("M59 logo upload + public serve", () => {
  it("stores a real PNG through the media store and exposes it publicly", async () => {
    const { service, store } = makeService();
    const out = await service.uploadLogo("org-1", "u-1", { dataBase64: PNG_1PX.toString("base64"), contentType: "image/png" });
    expect(out.logoUrl).toBe("/public/branding/org-1/logo");
    expect(store.get("branding/org-1/logo")?.bytes.equals(PNG_1PX)).toBe(true);
    const pub = await service.publicLogo("org-1");
    expect(pub?.contentType).toBe("image/png");
    expect(pub?.bytes.equals(PNG_1PX)).toBe(true);
  });

  it("rejects a disallowed content type, a spoofed type, and an oversize image", async () => {
    const { service } = makeService();
    await expect(service.uploadLogo("org-1", "u-1", { dataBase64: PNG_1PX.toString("base64"), contentType: "image/gif" }))
      .rejects.toBeInstanceOf(ApiException);
    // JPEG header declared, PNG bytes supplied.
    await expect(service.uploadLogo("org-1", "u-1", { dataBase64: PNG_1PX.toString("base64"), contentType: "image/jpeg" }))
      .rejects.toBeInstanceOf(ApiException);
    const big = Buffer.concat([PNG_1PX, Buffer.alloc(OrganizationsService.LOGO_MAX_BYTES)]);
    await expect(service.uploadLogo("org-1", "u-1", { dataBase64: big.toString("base64"), contentType: "image/png" }))
      .rejects.toBeInstanceOf(ApiException);
  });

  it("publicLogo is null before upload and after removal", async () => {
    const { service } = makeService();
    expect(await service.publicLogo("org-1")).toBeNull();
    await service.uploadLogo("org-1", "u-1", { dataBase64: PNG_1PX.toString("base64"), contentType: "image/png" });
    expect(await service.publicLogo("org-1")).not.toBeNull();
    await service.removeLogo("org-1", "u-1");
    expect(await service.publicLogo("org-1")).toBeNull();
  });

  it("one org's logo never leaks into another org's public path", async () => {
    const { service } = makeService();
    await service.uploadLogo("org-1", "u-1", { dataBase64: PNG_1PX.toString("base64"), contentType: "image/png" });
    expect(await service.publicLogo("org-2")).toBeNull();
  });
});
