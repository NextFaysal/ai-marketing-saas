import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * MB5 (ML15) — platform translation-coverage board.
 *
 * Cross-org aggregation over ContentTranslation (NF5): for
 * every org and every CONTENT locale, how many translatable
 * field-slots exist (the denominator), how many carry a
 * translation row at all, and how many of those are APPROVED
 * (the only ones ever served publicly) vs still draft.
 *
 * Denominators are real row counts, never estimates:
 *   product            → Product rows    × 2 fields (name, description)
 *   category           → Category rows   × 2 fields (name, description)
 *   storefront_string  → constant 3 fields (announcementText,
 *                        returnPolicyText, deliveryPromiseText)
 *                        per org — the singleton "shop" entity
 *   blog_post          → BlogPost rows   × 1 field (title only,
 *                        ML15/CD-5)
 *
 * The locales here are CONTENT locales (bn/en/hi, D5) — a
 * different axis from the UI locales (bn/en); the response
 * labels them as such so the two can never be conflated.
 * Counts and org identity only — no translation TEXT is ever
 * read or returned by this board. An empty platform is zeros,
 * never an error; every read degrades defensively.
 */

export const CONTENT_LOCALES = ["bn", "en", "hi"] as const;
export type ContentLocale = (typeof CONTENT_LOCALES)[number];

export const TRANSLATION_FIELDS_PER_ENTITY = {
  product: 2,
  category: 2,
  storefront_string: 3,
  blog_post: 1,
} as const;
export const TRANSLATION_ENTITY_TYPES = Object.keys(TRANSLATION_FIELDS_PER_ENTITY) as Array<keyof typeof TRANSLATION_FIELDS_PER_ENTITY>;

export interface EntityCoverage {
  possible: number;
  translated: number;
  approved: number;
  draft: number;
}
export interface LocaleCoverage extends EntityCoverage {
  byEntity: Record<string, EntityCoverage>;
}

const emptyEntity = (): EntityCoverage => ({ possible: 0, translated: 0, approved: 0, draft: 0 });
const emptyLocale = (): LocaleCoverage => ({
  ...emptyEntity(),
  byEntity: Object.fromEntries(TRANSLATION_ENTITY_TYPES.map((e) => [e, emptyEntity()])),
});

function countOf(row: any): number {
  const c = row?._count;
  if (typeof c === "number") return c;
  if (c && typeof c._all === "number") return c._all;
  return 0;
}

@Injectable()
export class AdminTranslationsCoverageService {
  constructor(private readonly prisma: PrismaService) {}

  private db(): any {
    return this.prisma as any;
  }

  /** Entity row counts per org: { [orgId]: { product, category, blog_post } }. */
  private async entityCountsByOrg(): Promise<Map<string, Record<string, number>>> {
    const out = new Map<string, Record<string, number>>();
    const sources: Array<[string, any]> = [
      ["product", this.db().product],
      ["category", this.db().category],
      ["blog_post", this.db().blogPost],
    ];
    for (const [entityType, table] of sources) {
      if (!table?.groupBy) continue;
      const rows = await table
        .groupBy({ by: ["organizationId"], _count: { _all: true } })
        .catch(() => []);
      for (const row of rows ?? []) {
        const orgId = String(row.organizationId ?? "");
        if (!orgId) continue;
        const rec = out.get(orgId) ?? {};
        rec[entityType] = countOf(row);
        out.set(orgId, rec);
      }
    }
    return out;
  }

  async coverage() {
    const db = this.db();
    const orgs: Array<{ id: string; name: string | null }> =
      (await db.organization
        ?.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } })
        .catch(() => [])) ?? [];
    const counts = await this.entityCountsByOrg();

    // One groupBy carries every translated/approved/draft
    // figure on the board.
    const grouped: any[] =
      (await db.contentTranslation
        ?.groupBy({ by: ["organizationId", "entityType", "locale", "status"], _count: { _all: true } })
        .catch(() => [])) ?? [];

    const perOrg = new Map<string, Record<ContentLocale, LocaleCoverage>>();
    const localeOf = (orgId: string) => {
      let rec = perOrg.get(orgId);
      if (!rec) {
        rec = Object.fromEntries(CONTENT_LOCALES.map((l) => [l, emptyLocale()])) as Record<ContentLocale, LocaleCoverage>;
        perOrg.set(orgId, rec);
      }
      return rec;
    };
    for (const row of grouped) {
      const orgId = String(row.organizationId ?? "");
      const entityType = String(row.entityType ?? "");
      const locale = String(row.locale ?? "") as ContentLocale;
      if (!orgId || !(TRANSLATION_ENTITY_TYPES as string[]).includes(entityType)) continue;
      if (!(CONTENT_LOCALES as readonly string[]).includes(locale)) continue;
      const n = countOf(row);
      const cell = localeOf(orgId)[locale].byEntity[entityType];
      cell.translated += n;
      if (row.status === "approved") cell.approved += n;
      else if (row.status === "draft") cell.draft += n;
    }

    const buildOrgRow = (orgId: string, name: string | null) => {
      const entityCounts = counts.get(orgId) ?? {};
      const possibleFor = (entityType: keyof typeof TRANSLATION_FIELDS_PER_ENTITY): number =>
        entityType === "storefront_string"
          ? TRANSLATION_FIELDS_PER_ENTITY.storefront_string
          : (entityCounts[entityType] ?? 0) * TRANSLATION_FIELDS_PER_ENTITY[entityType];
      const locales = localeOf(orgId);
      for (const locale of CONTENT_LOCALES) {
        const lc = locales[locale];
        for (const entityType of TRANSLATION_ENTITY_TYPES) {
          const cell = lc.byEntity[entityType];
          cell.possible = possibleFor(entityType);
          lc.possible += cell.possible;
          lc.translated += cell.translated;
          lc.approved += cell.approved;
          lc.draft += cell.draft;
        }
      }
      return {
        organizationId: orgId,
        organizationName: name,
        entityCounts: {
          product: entityCounts.product ?? 0,
          category: entityCounts.category ?? 0,
          blogPost: entityCounts.blog_post ?? 0,
        },
        locales,
      };
    };

    const orgRows = orgs.map((o) => buildOrgRow(String(o.id), o.name ?? null));
    // Orgs that appear ONLY in translations/counts (defensive —
    // an org row should always exist, but a count must never be
    // silently dropped if one is missing).
    const known = new Set(orgRows.map((r) => r.organizationId));
    for (const orgId of new Set([...counts.keys(), ...perOrg.keys()])) {
      if (!known.has(orgId)) orgRows.push(buildOrgRow(orgId, null));
    }

    const totalsLocales = Object.fromEntries(
      CONTENT_LOCALES.map((l) => [l, emptyLocale()]),
    ) as Record<ContentLocale, LocaleCoverage>;
    for (const row of orgRows) {
      for (const locale of CONTENT_LOCALES) {
        const src = row.locales[locale];
        const dst = totalsLocales[locale];
        dst.possible += src.possible;
        dst.translated += src.translated;
        dst.approved += src.approved;
        dst.draft += src.draft;
        for (const entityType of TRANSLATION_ENTITY_TYPES) {
          const s = src.byEntity[entityType];
          const d = dst.byEntity[entityType];
          d.possible += s.possible;
          d.translated += s.translated;
          d.approved += s.approved;
          d.draft += s.draft;
        }
      }
    }

    return {
      // D5 boundary, stated in the payload itself: these are
      // CONTENT locales (bn/en/hi), not the bn/en UI locales.
      localeKind: "content" as const,
      locales: [...CONTENT_LOCALES],
      fieldsPerEntity: { ...TRANSLATION_FIELDS_PER_ENTITY },
      orgs: orgRows,
      totals: { locales: totalsLocales },
    };
  }
}
