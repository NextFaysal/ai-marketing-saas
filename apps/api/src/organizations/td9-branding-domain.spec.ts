import { BadRequestException } from "@nestjs/common";
import { OrganizationsService } from "./organizations.service";

/**
 * TD9 — the branding path (PATCH /organizations/:id/branding) must
 * apply the same storefront-verification reset on a domain change
 * as StorefrontService.setCustomDomain, plus the platform-domain
 * refusal. Fake Prisma in the m59-branding spec's style, plus a
 * storefrontSetting table (the m59 fake has none — the service's
 * defensive lookup is exercised by the last test here).
 */

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (k === "NOT") {
      if (matchWhere(row, v)) return false;
      continue;
    }
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

const VERIFIED_AT = new Date("2026-10-10T00:00:00Z");

function makeService(opts: { withSettingTable?: boolean } = {}) {
  const withSettingTable = opts.withSettingTable !== false;
  const orgs = table([
    {
      id: "org-1", name: "Demo Shop", slug: "demo", creditMinor: 0n,
      brandName: null, logoUrl: null, logoContentType: null, primaryColor: null,
      customDomain: "old.example.com",
    },
    {
      id: "org-2", name: "Other Agency", slug: "other", creditMinor: 0n,
      brandName: null, logoUrl: null, logoContentType: null, primaryColor: null,
      customDomain: "reports.taken.com",
    },
  ]);
  const settings = table([
    {
      id: "set-1", organizationId: "org-1",
      domainVerifyToken: "tok-abc", domainVerifiedAt: VERIFIED_AT,
    },
  ]);
  const prisma: any = { organization: orgs };
  if (withSettingTable) prisma.storefrontSetting = settings;
  const auditCalls: any[] = [];
  const audit: any = { log: async (e: any) => { auditCalls.push(e); } };
  const service = new OrganizationsService(prisma, audit);
  return { service, orgs, settings, auditCalls };
}

describe("TD9 branding-path domain change", () => {
  it("a domain change resets the storefront verify token + verifiedAt", async () => {
    const { service, settings, orgs } = makeService();
    const out = await service.updateBranding("org-1", "u-1", { customDomain: "new.example.com" });
    expect(out.customDomain).toBe("new.example.com");
    expect(orgs.rows[0].customDomain).toBe("new.example.com");
    expect(settings.rows[0].domainVerifyToken).toBeNull();
    expect(settings.rows[0].domainVerifiedAt).toBeNull();
  });

  it("removing the domain (empty string) is also a change and resets", async () => {
    const { service, settings } = makeService();
    const out = await service.updateBranding("org-1", "u-1", { customDomain: "  " });
    expect(out.customDomain).toBeNull();
    expect(settings.rows[0].domainVerifyToken).toBeNull();
    expect(settings.rows[0].domainVerifiedAt).toBeNull();
  });

  it("re-saving the SAME domain (case variant) does NOT reset", async () => {
    const { service, settings } = makeService();
    const out = await service.updateBranding("org-1", "u-1", { customDomain: "OLD.example.com" });
    expect(out.customDomain).toBe("old.example.com");
    expect(settings.rows[0].domainVerifyToken).toBe("tok-abc");
    expect(settings.rows[0].domainVerifiedAt).toEqual(VERIFIED_AT);
  });

  it("an update WITHOUT the customDomain field touches neither domain nor verification", async () => {
    const { service, settings, orgs } = makeService();
    const out = await service.updateBranding("org-1", "u-1", { brandName: "New Name" });
    expect(out.brandName).toBe("New Name");
    expect(orgs.rows[0].customDomain).toBe("old.example.com");
    expect(settings.rows[0].domainVerifyToken).toBe("tok-abc");
    expect(settings.rows[0].domainVerifiedAt).toEqual(VERIFIED_AT);
  });

  it.each(["qosprey.com", "x.qosprey.com"])(
    "refuses the platform domain %s on this path too, resetting nothing",
    async (domain) => {
      const { service, settings, orgs } = makeService();
      await expect(service.updateBranding("org-1", "u-1", { customDomain: domain })).rejects.toMatchObject({ code: "common.platformDomainNotAllowed", status: 400 });
      expect(orgs.rows[0].customDomain).toBe("old.example.com");
      expect(settings.rows[0].domainVerifyToken).toBe("tok-abc");
      expect(settings.rows[0].domainVerifiedAt).toEqual(VERIFIED_AT);
    },
  );

  it("a domain change still succeeds when prisma has NO storefrontSetting table (defensive)", async () => {
    const { service, orgs } = makeService({ withSettingTable: false });
    const out = await service.updateBranding("org-1", "u-1", { customDomain: "new.example.com" });
    expect(out.customDomain).toBe("new.example.com");
    expect(orgs.rows[0].customDomain).toBe("new.example.com");
  });
});
