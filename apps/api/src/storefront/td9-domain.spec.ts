import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { StorefrontService } from "./storefront.service";

/**
 * TD9 — StorefrontService custom-domain write path + www-aware
 * resolution. Own fake Prisma in the ec8 spec's style (self-contained;
 * the ec8 spec file itself is untouched). The fake's matchWhere
 * understands the query shapes TD9 uses: { in: [...] } and NOT.
 */

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (k === "NOT") {
      if (matchWhere(row, v)) return false;
      continue;
    }
    if (k === "OR") {
      if (!(v as any[]).some((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const cond: any = v;
      if ("in" in cond) {
        if (!cond.in.includes(row[k])) return false;
        continue;
      }
      if ("not" in cond) {
        if (row[k] === cond.not) return false;
        continue;
      }
      if (!matchWhere(row, cond)) return false;
    } else if (v === null) {
      if (row[k] !== null && row[k] !== undefined) return false;
    } else if (row[k] !== v) {
      return false;
    }
  }
  return true;
}

function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where))[0] ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)),
    findUnique: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where))[0] ?? null,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
  };
}

function makePrisma() {
  return {
    organization: makeTable(),
    storefrontSetting: makeTable(),
  } as any;
}

const VERIFIED_AT = new Date("2026-10-10T00:00:00Z");

function seed(prisma: any, opts: { domain?: string | null; verified?: boolean } = {}) {
  prisma.organization.rows.push({
    id: "org-1",
    slug: "shop-one",
    name: "Shop One",
    brandName: null,
    customDomain: opts.domain ?? null,
  });
  prisma.storefrontSetting.rows.push({
    id: "set-1",
    organizationId: "org-1",
    shopEnabled: true,
    domainVerifyToken: "tok-abc",
    domainVerifiedAt: opts.verified ? VERIFIED_AT : null,
  });
}

function makeService(prisma: any) {
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new StorefrontService(prisma, undefined, undefined, audit as any);
  return { svc, audit };
}

describe("TD9 setCustomDomain", () => {
  it("sets the domain (normalised: case / protocol / path stripped)", async () => {
    const prisma = makePrisma();
    seed(prisma);
    const { svc } = makeService(prisma);
    const out = await svc.setCustomDomain("org-1", "user-1", "https://Shop.Example.COM/path");
    expect(out).toEqual({ domain: "shop.example.com", previousDomain: null, verificationReset: true });
    expect(prisma.organization.rows[0].customDomain).toBe("shop.example.com");
  });

  it("conflicts when another org holds the www form of the requested domain (and vice versa)", async () => {
    const prisma = makePrisma();
    seed(prisma);
    prisma.organization.rows.push({
      id: "org-2", slug: "other", name: "Other", brandName: null, customDomain: "www.taken.com",
    });
    const { svc } = makeService(prisma);
    await expect(svc.setCustomDomain("org-1", "user-1", "taken.com")).rejects.toBeInstanceOf(
      ConflictException,
    );
    prisma.organization.rows[1].customDomain = "taken.com";
    await expect(svc.setCustomDomain("org-1", "user-1", "www.taken.com")).rejects.toBeInstanceOf(
      ConflictException,
    );
    // The holder itself may keep / re-save its own domain.
    const own = await svc.setCustomDomain("org-2", "user-9", "taken.com");
    expect(own.domain).toBe("taken.com");
  });

  it.each(["qosprey.com", "x.qosprey.com", "www.qosprey.com"])(
    "refuses the platform domain %s as a custom domain",
    async (domain) => {
      const prisma = makePrisma();
      seed(prisma);
      const { svc } = makeService(prisma);
      await expect(svc.setCustomDomain("org-1", "user-1", domain)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.organization.rows[0].customDomain).toBeNull();
    },
  );

  it.each(["not a domain", "localhost", "bad_domain.com", "example"])(
    "refuses the malformed domain %j",
    async (domain) => {
      const prisma = makePrisma();
      seed(prisma);
      const { svc } = makeService(prisma);
      await expect(svc.setCustomDomain("org-1", "user-1", domain)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it("a change resets the verify token + verifiedAt on the setting", async () => {
    const prisma = makePrisma();
    seed(prisma, { domain: "old.example.com", verified: true });
    const { svc } = makeService(prisma);
    const out = await svc.setCustomDomain("org-1", "user-1", "new.example.com");
    expect(out).toEqual({
      domain: "new.example.com",
      previousDomain: "old.example.com",
      verificationReset: true,
    });
    expect(prisma.storefrontSetting.rows[0].domainVerifyToken).toBeNull();
    expect(prisma.storefrontSetting.rows[0].domainVerifiedAt).toBeNull();
  });

  it("re-setting the SAME value resets nothing", async () => {
    const prisma = makePrisma();
    seed(prisma, { domain: "shop.example.com", verified: true });
    const { svc } = makeService(prisma);
    const out = await svc.setCustomDomain("org-1", "user-1", "SHOP.example.com");
    expect(out).toEqual({
      domain: "shop.example.com",
      previousDomain: "shop.example.com",
      verificationReset: false,
    });
    expect(prisma.storefrontSetting.rows[0].domainVerifyToken).toBe("tok-abc");
    expect(prisma.storefrontSetting.rows[0].domainVerifiedAt).toEqual(VERIFIED_AT);
  });

  it("null removes the domain and resets verification", async () => {
    const prisma = makePrisma();
    seed(prisma, { domain: "shop.example.com", verified: true });
    const { svc, audit } = makeService(prisma);
    const out = await svc.setCustomDomain("org-1", "user-1", null);
    expect(out).toEqual({ domain: null, previousDomain: "shop.example.com", verificationReset: true });
    expect(prisma.organization.rows[0].customDomain).toBeNull();
    expect(prisma.storefrontSetting.rows[0].domainVerifyToken).toBeNull();
    expect(prisma.storefrontSetting.rows[0].domainVerifiedAt).toBeNull();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "storefront.custom_domain_removed",
        metadata: { domain: null, previousDomain: "shop.example.com", verificationReset: true },
      }),
    );
  });

  it("audits a set with domain / previousDomain / verificationReset", async () => {
    const prisma = makePrisma();
    seed(prisma, { domain: "old.example.com", verified: true });
    const { svc, audit } = makeService(prisma);
    await svc.setCustomDomain("org-1", "user-1", "new.example.com");
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        userId: "user-1",
        action: "storefront.custom_domain_set",
        metadata: { domain: "new.example.com", previousDomain: "old.example.com", verificationReset: true },
      }),
    );
  });

  it("unknown org → NotFound", async () => {
    const prisma = makePrisma();
    seed(prisma);
    const { svc } = makeService(prisma);
    await expect(svc.setCustomDomain("org-missing", "user-1", "shop.example.com")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("TD9 byDomain — www/apex resolution", () => {
  it("stored apex resolves from the www form (returned domain is the stored form)", async () => {
    const prisma = makePrisma();
    seed(prisma, { domain: "shop.example.com", verified: true });
    const { svc } = makeService(prisma);
    await expect(svc.byDomain("www.shop.example.com")).resolves.toEqual({
      organizationSlug: "shop-one",
      domain: "shop.example.com",
    });
  });

  it("stored www resolves from the apex form (returned domain is the stored form)", async () => {
    const prisma = makePrisma();
    seed(prisma, { domain: "www.shop.example.com", verified: true });
    const { svc } = makeService(prisma);
    await expect(svc.byDomain("shop.example.com")).resolves.toEqual({
      organizationSlug: "shop-one",
      domain: "www.shop.example.com",
    });
  });

  it("exact form resolves as before", async () => {
    const prisma = makePrisma();
    seed(prisma, { domain: "shop.example.com", verified: true });
    const { svc } = makeService(prisma);
    await expect(svc.byDomain("shop.example.com")).resolves.toEqual({
      organizationSlug: "shop-one",
      domain: "shop.example.com",
    });
  });

  it("unverified resolves in NEITHER form", async () => {
    const prisma = makePrisma();
    seed(prisma, { domain: "shop.example.com", verified: false });
    const { svc } = makeService(prisma);
    await expect(svc.byDomain("shop.example.com")).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.byDomain("www.shop.example.com")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("TD9 domainAllowed", () => {
  it("verified: both the stored and the toggled form are allowed", async () => {
    const prisma = makePrisma();
    seed(prisma, { domain: "shop.example.com", verified: true });
    const { svc } = makeService(prisma);
    await expect(svc.domainAllowed("shop.example.com")).resolves.toBe(true);
    await expect(svc.domainAllowed("www.shop.example.com")).resolves.toBe(true);
  });

  it("unverified / unknown / empty: false, never a throw", async () => {
    const prisma = makePrisma();
    seed(prisma, { domain: "shop.example.com", verified: false });
    const { svc } = makeService(prisma);
    await expect(svc.domainAllowed("shop.example.com")).resolves.toBe(false);
    await expect(svc.domainAllowed("www.shop.example.com")).resolves.toBe(false);
    await expect(svc.domainAllowed("unknown.example.com")).resolves.toBe(false);
    await expect(svc.domainAllowed("")).resolves.toBe(false);
  });
});
