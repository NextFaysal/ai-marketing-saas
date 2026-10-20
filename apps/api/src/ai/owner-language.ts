/**
 * MB5 (ML13) — the ONE language resolver for OWNER-facing AI
 * output: copilot answers, the owner chat assistant, ads
 * narration, AI reports, review insights, the social coach,
 * support suggestions, proactive briefings, and the default
 * language of the per-call creative dto family.
 *
 * This is deliberately a SEPARATE resolver from
 * `resolveReplyLanguage` (reply-quality.ts). That one decides
 * what language a CUSTOMER is answered in, and its precedence
 * is spec-pinned by Smart AI R3 — it is not touched here. An
 * owner's language is a different question: it is set by the
 * business's own language policy and the dashboard's locale
 * machinery (MB1), never by detecting a customer's message.
 *
 * PRECEDENCE (D-MB5-1, as taken — batch record CD-1):
 *  1. an explicit per-call dto language ("bn" | "en") — the
 *     caller asked, the caller gets;
 *  2. the org's explicit BusinessProfile.aiReplyLanguage
 *     ("bn" | "en") — the business's standing language policy.
 *     "auto" / null is not an instruction and falls through.
 *     This rung outranks the UI locales: aiReplyLanguage is a
 *     deliberate business policy, the dashboard locale is a
 *     display default;
 *  3. Organization.dashboardLocale (MB1) — the org's dashboard
 *     default language;
 *  4. the acting user's User.preferredLocale (MB1) — personal
 *     display preference, the weakest signal for business
 *     output;
 *  5. default "bn" (the platform's home-market default).
 *
 * The plan §৬ ML13 text describes the CUSTOMER chain; for
 * owner-facing output this chain is the recorded contract.
 */

export type OwnerLanguage = "bn" | "en";
export type OwnerLanguageSource =
  | "dto"
  | "orgReplyLanguage"
  | "dashboardLocale"
  | "userPreference"
  | "default";

export interface ResolvedOwnerLanguage {
  language: OwnerLanguage;
  source: OwnerLanguageSource;
}

const pinned = (v: string | null | undefined): OwnerLanguage | null =>
  v === "bn" ? "bn" : v === "en" ? "en" : null;

export function resolveOwnerLanguage(input: {
  /** Explicit per-call dto language, when the surface has one. */
  dtoLanguage?: string | null;
  /** BusinessProfile.aiReplyLanguage: "bn" | "en" | "auto" | null. */
  orgReplyLanguage?: string | null;
  /** Organization.dashboardLocale (MB1): "bn" | "en". */
  orgDashboardLocale?: string | null;
  /** Acting user's User.preferredLocale (MB1), when a user acts. */
  userPreferredLocale?: string | null;
}): ResolvedOwnerLanguage {
  const dto = pinned(input.dtoLanguage);
  if (dto) return { language: dto, source: "dto" };
  const org = pinned(input.orgReplyLanguage);
  if (org) return { language: org, source: "orgReplyLanguage" };
  const dashboard = pinned(input.orgDashboardLocale);
  if (dashboard) return { language: dashboard, source: "dashboardLocale" };
  const user = pinned(input.userPreferredLocale);
  if (user) return { language: user, source: "userPreference" };
  return { language: "bn", source: "default" };
}

type PrismaLike = {
  businessProfile?: {
    findUnique: (args: any) => Promise<{ aiReplyLanguage?: string | null } | null>;
  };
  organization?: {
    findUnique: (args: any) => Promise<{ dashboardLocale?: string | null } | null>;
  };
  user?: {
    findUnique: (args: any) => Promise<{ preferredLocale?: string | null } | null>;
  };
};

/**
 * Fetch the resolver's inputs for one org (+ acting user when
 * known) and resolve. Every read is defensive: a missing model
 * or a failed read degrades that rung to "no signal", never to
 * an error — language resolution must not break a compose path.
 */
/**
 * One defensive model read: a model that is absent, or whose
 * findUnique is not callable (a partial test double), or whose
 * read rejects, all degrade the rung to "no signal" — language
 * resolution must never throw into a compose path. (MB5
 * assembly amendment: the bare `?.` chain guarded a nullish
 * model but not a present-but-incomplete one.)
 */
async function readRung<T>(
  model: { findUnique?: unknown } | undefined,
  args: any,
): Promise<T | null> {
  if (!model || typeof model.findUnique !== "function") return null;
  try {
    return (await (model.findUnique as (a: any) => Promise<T | null>)(args)) ?? null;
  } catch {
    return null;
  }
}

export async function resolveOwnerLanguageForOrg(
  prisma: PrismaLike,
  input: {
    organizationId: string;
    userId?: string | null;
    dtoLanguage?: string | null;
  },
): Promise<ResolvedOwnerLanguage> {
  const dto = pinned(input.dtoLanguage);
  if (dto) return { language: dto, source: "dto" };
  const [profile, org, user] = await Promise.all([
    readRung<{ aiReplyLanguage?: string | null }>(prisma.businessProfile, {
      where: { organizationId: input.organizationId },
      select: { aiReplyLanguage: true },
    }),
    readRung<{ dashboardLocale?: string | null }>(prisma.organization, {
      where: { id: input.organizationId },
      select: { dashboardLocale: true },
    }),
    input.userId
      ? readRung<{ preferredLocale?: string | null }>(prisma.user, {
          where: { id: input.userId },
          select: { preferredLocale: true },
        })
      : Promise.resolve(null),
  ]);
  return resolveOwnerLanguage({
    orgReplyLanguage: profile?.aiReplyLanguage ?? null,
    orgDashboardLocale: org?.dashboardLocale ?? null,
    userPreferredLocale: user?.preferredLocale ?? null,
  });
}
