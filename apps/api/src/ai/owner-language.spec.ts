/**
 * MB5 (ML13) — owner-facing language resolver contract.
 * Pins D-MB5-1 precedence: dto → org aiReplyLanguage →
 * Organization.dashboardLocale → User.preferredLocale → bn.
 */
import { resolveOwnerLanguage, resolveOwnerLanguageForOrg } from "./owner-language";

describe("resolveOwnerLanguage (pure)", () => {
  it("dto wins over every other rung", () => {
    expect(
      resolveOwnerLanguage({
        dtoLanguage: "en",
        orgReplyLanguage: "bn",
        orgDashboardLocale: "bn",
        userPreferredLocale: "bn",
      }),
    ).toEqual({ language: "en", source: "dto" });
  });

  it("org aiReplyLanguage outranks the UI locales (business policy > display default)", () => {
    expect(
      resolveOwnerLanguage({
        orgReplyLanguage: "en",
        orgDashboardLocale: "bn",
        userPreferredLocale: "bn",
      }),
    ).toEqual({ language: "en", source: "orgReplyLanguage" });
  });

  it('"auto" aiReplyLanguage is not an instruction and falls through to dashboardLocale', () => {
    expect(
      resolveOwnerLanguage({
        orgReplyLanguage: "auto",
        orgDashboardLocale: "en",
        userPreferredLocale: "bn",
      }),
    ).toEqual({ language: "en", source: "dashboardLocale" });
  });

  it("user preference is the last signal before the default", () => {
    expect(resolveOwnerLanguage({ userPreferredLocale: "en" })).toEqual({
      language: "en",
      source: "userPreference",
    });
  });

  it("defaults to bn with no signal at all", () => {
    expect(resolveOwnerLanguage({})).toEqual({ language: "bn", source: "default" });
    expect(
      resolveOwnerLanguage({
        dtoLanguage: "fr",
        orgReplyLanguage: null,
        orgDashboardLocale: "hi",
        userPreferredLocale: undefined,
      }),
    ).toEqual({ language: "bn", source: "default" });
  });
});

describe("resolveOwnerLanguageForOrg (fetcher)", () => {
  const prismaWith = (rows: {
    profile?: { aiReplyLanguage: string | null } | null;
    org?: { dashboardLocale: string | null } | null;
    user?: { preferredLocale: string | null } | null;
  }) => ({
    businessProfile: { findUnique: jest.fn(async () => rows.profile ?? null) },
    organization: { findUnique: jest.fn(async () => rows.org ?? null) },
    user: { findUnique: jest.fn(async () => rows.user ?? null) },
  });

  it("short-circuits on a pinned dto without touching the db", async () => {
    const prisma = prismaWith({});
    await expect(
      resolveOwnerLanguageForOrg(prisma as any, { organizationId: "o1", dtoLanguage: "en" }),
    ).resolves.toEqual({ language: "en", source: "dto" });
    expect(prisma.businessProfile.findUnique).not.toHaveBeenCalled();
  });

  it("resolves through the fetched rungs in order", async () => {
    const prisma = prismaWith({
      profile: { aiReplyLanguage: "auto" },
      org: { dashboardLocale: "en" },
      user: { preferredLocale: "bn" },
    });
    await expect(
      resolveOwnerLanguageForOrg(prisma as any, { organizationId: "o1", userId: "u1" }),
    ).resolves.toEqual({ language: "en", source: "dashboardLocale" });
  });

  it("a failed read degrades its rung instead of throwing", async () => {
    const prisma = {
      businessProfile: { findUnique: jest.fn(async () => { throw new Error("db down"); }) },
      organization: { findUnique: jest.fn(async () => ({ dashboardLocale: "en" })) },
      user: { findUnique: jest.fn(async () => null) },
    };
    await expect(
      resolveOwnerLanguageForOrg(prisma as any, { organizationId: "o1", userId: "u1" }),
    ).resolves.toEqual({ language: "en", source: "dashboardLocale" });
  });
});
