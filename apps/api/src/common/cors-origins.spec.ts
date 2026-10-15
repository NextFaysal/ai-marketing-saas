import {
  createCorsOriginChecker,
  isPlatformOrLocalOrigin,
  prismaVerifiedCustomDomainLookup,
} from "./cors-origins";

/**
 * TD6 — CORS origin table. The checker is exercised exactly as the
 * cors middleware calls it: (origin, callback) → allow boolean.
 * The custom-domain lookup is a fake; the Prisma adapter is tested
 * against a fake structural seam with the EC8 condition.
 */

type Checker = ReturnType<typeof createCorsOriginChecker>;

function decide(checker: Checker, origin: string | undefined): Promise<boolean> {
  return new Promise((resolve, reject) => {
    void checker(origin, (err, allow) => (err ? reject(err) : resolve(allow === true)));
  });
}

const fakeLookup =
  (verifiedHosts: Set<string>, counter?: { calls: number }) =>
  async (host: string): Promise<boolean> => {
    if (counter) counter.calls++;
    return verifiedHosts.has(host);
  };

describe("TD6 cors — allowed origins", () => {
  const checker = createCorsOriginChecker({
    exactOrigins: ["https://app.qosprey.com/", undefined], // WEB_URL with a stray slash
    lookupVerifiedCustomDomain: fakeLookup(new Set(["dhaka-fashion.com", "www.dhaka-fashion.com"])),
  });

  it("allows a missing Origin header (non-browser clients)", async () => {
    await expect(decide(checker, undefined)).resolves.toBe(true);
  });

  it("allows the exact WEB_URL env origin", async () => {
    await expect(decide(checker, "https://app.qosprey.com")).resolves.toBe(true);
  });

  it("allows the platform apex and the platform's own service subdomains", async () => {
    await expect(decide(checker, "https://qosprey.com")).resolves.toBe(true);
    await expect(decide(checker, "https://admin.qosprey.com")).resolves.toBe(true);
    await expect(decide(checker, "https://api.qosprey.com")).resolves.toBe(true);
  });

  it("allows a tenant shop subdomain (one valid label)", async () => {
    await expect(decide(checker, "https://dhaka-fashion.qosprey.com")).resolves.toBe(true);
    await expect(decide(checker, "https://mirpur-shop.qosprey.com")).resolves.toBe(true);
  });

  it("allows a VERIFIED merchant custom domain", async () => {
    await expect(decide(checker, "https://dhaka-fashion.com")).resolves.toBe(true);
    await expect(decide(checker, "https://www.dhaka-fashion.com")).resolves.toBe(true);
  });

  it("allows http only for localhost dev origins", async () => {
    await expect(decide(checker, "http://localhost:3000")).resolves.toBe(true);
    await expect(decide(checker, "http://127.0.0.1:3001")).resolves.toBe(true);
  });
});

describe("TD6 cors — denied origins", () => {
  const checker = createCorsOriginChecker({
    exactOrigins: ["https://app.qosprey.com"],
    lookupVerifiedCustomDomain: fakeLookup(new Set(["dhaka-fashion.com"])),
  });

  it.each([
    "https://evilqosprey.com", // look-alike suffix, no dot boundary
    "https://qosprey.com.evil.com", // platform name as a subdomain of evil
    "https://notqosprey.com",
    "https://a.b.qosprey.com", // multi-level under the apex: not covered
    "https://-bad-.qosprey.com", // label fails the slug-format rule
    "https://dhaka_fashion.qosprey.com", // underscore: not a valid label
  ])("denies %s", async (origin) => {
    await expect(decide(checker, origin)).resolves.toBe(false);
  });

  it("denies http on any platform host", async () => {
    await expect(decide(checker, "http://app.qosprey.com")).resolves.toBe(false);
    await expect(decide(checker, "http://dhaka-fashion.qosprey.com")).resolves.toBe(false);
    await expect(decide(checker, "http://qosprey.com")).resolves.toBe(false);
  });

  it("denies an UNVERIFIED custom domain and unknown hosts", async () => {
    await expect(decide(checker, "https://unverified-shop.com")).resolves.toBe(false);
    await expect(decide(checker, "https://example.com")).resolves.toBe(false);
  });

  it("denies junk origins outright", async () => {
    await expect(decide(checker, "null")).resolves.toBe(false);
    await expect(decide(checker, "not a url")).resolves.toBe(false);
    await expect(decide(checker, "ftp://dhaka-fashion.com")).resolves.toBe(false);
  });

  it("fails closed (per origin, no throw) when the lookup errors", async () => {
    const broken = createCorsOriginChecker({
      lookupVerifiedCustomDomain: async () => {
        throw new Error("db down");
      },
    });
    await expect(decide(broken, "https://dhaka-fashion.com")).resolves.toBe(false);
    // …and platform origins keep working without any lookup.
    await expect(decide(broken, "https://app.qosprey.com")).resolves.toBe(true);
  });

  it("caches custom-domain verdicts for the TTL window", async () => {
    const counter = { calls: 0 };
    let clock = 1_000;
    const cached = createCorsOriginChecker({
      lookupVerifiedCustomDomain: fakeLookup(new Set(["dhaka-fashion.com"]), counter),
      cacheTtlMs: 60_000,
      now: () => clock,
    });
    await expect(decide(cached, "https://dhaka-fashion.com")).resolves.toBe(true);
    clock += 30_000;
    await expect(decide(cached, "https://dhaka-fashion.com")).resolves.toBe(true);
    expect(counter.calls).toBe(1);
    clock += 31_000; // past the 60 s TTL
    await expect(decide(cached, "https://dhaka-fashion.com")).resolves.toBe(true);
    expect(counter.calls).toBe(2);
  });
});

describe("TD6 cors — pure platform matcher", () => {
  it("matches the table without any lookup dependency", () => {
    expect(isPlatformOrLocalOrigin("https://qosprey.com")).toBe(true);
    expect(isPlatformOrLocalOrigin("https://dhaka-fashion.qosprey.com")).toBe(true);
    expect(isPlatformOrLocalOrigin("https://evilqosprey.com")).toBe(false);
    expect(isPlatformOrLocalOrigin("https://qosprey.com.evil.com")).toBe(false);
    expect(isPlatformOrLocalOrigin("http://app.qosprey.com")).toBe(false);
    expect(isPlatformOrLocalOrigin("http://localhost:3000")).toBe(true);
    expect(isPlatformOrLocalOrigin("")).toBe(false);
  });
});

describe("TD6 cors — Prisma lookup adapter (EC8 condition)", () => {
  function fakePrisma(rows: {
    orgs: Array<{ id: string; customDomain: string }>;
    settings: Array<{ organizationId: string; domainVerifiedAt: Date | null }>;
  }) {
    return {
      organization: {
        findFirst: async ({ where }: any) => rows.orgs.find((o) => o.customDomain === where.customDomain) ?? null,
      },
      storefrontSetting: {
        findUnique: async ({ where }: any) =>
          rows.settings.find((s) => s.organizationId === where.organizationId) ?? null,
      },
    } as any;
  }

  it("is true only when customDomain matches AND domainVerifiedAt is set", async () => {
    const lookup = prismaVerifiedCustomDomainLookup(
      fakePrisma({
        orgs: [
          { id: "o1", customDomain: "verified.com" },
          { id: "o2", customDomain: "unverified.com" },
          { id: "o3", customDomain: "no-setting.com" },
        ],
        settings: [
          { organizationId: "o1", domainVerifiedAt: new Date() },
          { organizationId: "o2", domainVerifiedAt: null },
        ],
      }),
    );
    await expect(lookup("verified.com")).resolves.toBe(true);
    await expect(lookup("unverified.com")).resolves.toBe(false); // verifiedAt missing
    await expect(lookup("no-setting.com")).resolves.toBe(false); // no setting row at all
    await expect(lookup("absent.com")).resolves.toBe(false); // no org with that domain
  });
});
