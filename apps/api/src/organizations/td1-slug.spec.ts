import { BadRequestException, ConflictException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { OrganizationsService } from "./organizations.service";

/**
 * TD1/TD2 (Tenant Domain, Batch TB1) — slug governance:
 * reserved names (code lists + substring rule + SUPER-added
 * platform-setting extras), strict format rules, and the
 * taken/reserved/invalid distinction behind
 * GET /organizations/slug-available — plus create() enforcing
 * exactly the same decision. Hand-rolled fake Prisma, following
 * the codebase pattern.
 */
function table(seed: any[] = []) {
  const rows = [...seed];
  let seq = 0;
  return {
    rows,
    findUnique: async ({ where }: any) => {
      const key = Object.keys(where ?? {})[0];
      return rows.find((r) => r[key] === where[key]) ?? null;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
  };
}

function makeService(opts: { orgs?: any[]; settings?: any[] } = {}) {
  const p: any = {
    organization: table(opts.orgs ?? []),
    membership: table(),
    businessProfile: table(),
    subscription: table(),
    systemSetting: table(opts.settings ?? []),
  };
  p.$transaction = async (fn: any) => fn(p);
  const audit: any = { log: async () => undefined };
  const svc = new OrganizationsService(p, audit);
  return { svc, p };
}

describe("TD1 slug availability decision", () => {
  it("passes an ordinary free name", async () => {
    const { svc } = makeService();
    const out = await svc.checkSlugAvailability("dhaka-fashion");
    expect(out).toMatchObject({ slug: "dhaka-fashion", available: true, reason: "ok" });
    expect(out.message).toContain("খালি আছে");
  });

  it("reports taken distinctly from reserved and invalid", async () => {
    const { svc } = makeService({ orgs: [{ id: "o-1", slug: "demo-store" }] });
    const out = await svc.checkSlugAvailability("demo-store");
    expect(out).toMatchObject({ available: false, reason: "taken" });
  });

  it("refuses system names", async () => {
    const { svc } = makeService();
    for (const slug of ["app", "dashboard", "api", "media", "login", "settings"]) {
      const out = await svc.checkSlugAvailability(slug);
      expect(out).toMatchObject({ available: false, reason: "reserved" });
      expect(out.message).toContain("সংরক্ষিত");
    }
  });

  it("refuses the owner's misleading examples and brand names", async () => {
    const { svc } = makeService();
    for (const slug of ["fake", "orgnail", "qosprey", "verified", "original"]) {
      expect(await svc.checkSlugAvailability(slug)).toMatchObject({ available: false, reason: "reserved" });
    }
  });

  it("refuses future-product names", async () => {
    const { svc } = makeService();
    for (const slug of ["pay", "wallet", "inbox", "crm"]) {
      expect(await svc.checkSlugAvailability(slug)).toMatchObject({ available: false, reason: "reserved" });
    }
  });

  it("substring rule refuses admin/support/official-shaped names", async () => {
    const { svc } = makeService();
    for (const slug of ["my-admin-shop", "admin1", "supportbd", "officialstore", "dhaka-official"]) {
      expect(await svc.checkSlugAvailability(slug)).toMatchObject({ available: false, reason: "reserved" });
    }
  });

  it("refuses bad formats as invalid (not reserved)", async () => {
    const { svc } = makeService();
    for (const slug of ["My-Store", "-abc", "abc-", "ab--cd", "ab", "a".repeat(61), "my_store", ""]) {
      expect(await svc.checkSlugAvailability(slug)).toMatchObject({ available: false, reason: "invalid" });
    }
  });

  it("SUPER-added platform-setting extras are refused too", async () => {
    const { svc } = makeService({
      settings: [{ key: "reservedSlugsExtra", value: ["Brand-XYZ", " local-block "] }],
    });
    expect(await svc.checkSlugAvailability("brand-xyz")).toMatchObject({ available: false, reason: "reserved" });
    expect(await svc.checkSlugAvailability("local-block")).toMatchObject({ available: false, reason: "reserved" });
    // A malformed setting value means "no extras", never a crash.
    const { svc: svc2 } = makeService({ settings: [{ key: "reservedSlugsExtra", value: 42 }] });
    expect(await svc2.checkSlugAvailability("brand-xyz")).toMatchObject({ available: true, reason: "ok" });
  });
});

describe("TD1 create() enforcement", () => {
  it("refuses a reserved slug with a Bengali BadRequest", async () => {
    const { svc } = makeService();
    await expect(svc.create("u-1", { name: "Fake Shop", slug: "fake" } as any))
      .rejects.toBeInstanceOf(ApiException);
    await expect(svc.create("u-1", { name: "Dash", slug: "dashboard" } as any))
      .rejects.toThrow(/সংরক্ষিত/);
  });

  it("refuses a badly formatted slug with BadRequest", async () => {
    const { svc } = makeService();
    await expect(svc.create("u-1", { name: "Bad", slug: "bad--slug" } as any))
      .rejects.toBeInstanceOf(ApiException);
  });

  it("keeps the existing Conflict behaviour for a taken slug", async () => {
    const { svc } = makeService({ orgs: [{ id: "o-1", slug: "demo-store" }] });
    await expect(svc.create("u-1", { name: "Copy", slug: "demo-store" } as any))
      .rejects.toBeInstanceOf(ApiException);
    await expect(svc.create("u-1", { name: "Copy", slug: "demo-store" } as any))
      .rejects.toMatchObject({ code: "organizations.slugAlreadyTaken", status: 409 });
  });

  it("a settings-extra name is refused at create too", async () => {
    const { svc } = makeService({ settings: [{ key: "reservedSlugsExtra", value: { slugs: ["brand-xyz"] } }] });
    await expect(svc.create("u-1", { name: "Brand", slug: "brand-xyz" } as any))
      .rejects.toBeInstanceOf(ApiException);
  });

  it("creates an organization with an ordinary slug", async () => {
    const { svc, p } = makeService();
    const org = await svc.create("u-1", { name: "Dhaka Fashion", slug: "dhaka-fashion" } as any);
    expect(org.slug).toBe("dhaka-fashion");
    expect(p.organization.rows).toHaveLength(1);
    expect(p.membership.rows[0]).toMatchObject({ userId: "u-1", role: "OWNER", status: "ACTIVE" });
  });
});
