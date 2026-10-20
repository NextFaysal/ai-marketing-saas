"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { apiFetch } from "@/lib/api";
import { EmptyState, ErrorState, PageHead } from "@/components/ui";
import { fmtNumber } from "@repo/contracts";
import { useAdminLocale } from "@/components/AdminLocale";

/**
 * MB5 (ML15) — platform translation-coverage board.
 *
 * Renders GET /admin/translations/coverage (SUPER admins only):
 * per-org ContentTranslation coverage + platform totals, per
 * CONTENT locale (bn/en/hi — labelled as content locales, the
 * D5 boundary: distinct from the bn/en UI locales). Every
 * number comes from the API's real row counts; an empty
 * platform shows the empty state, never invented figures.
 */

interface EntityCoverage {
  possible: number;
  translated: number;
  approved: number;
  draft: number;
}
interface LocaleCoverage extends EntityCoverage {
  byEntity: Record<string, EntityCoverage>;
}
interface OrgCoverage {
  organizationId: string;
  organizationName: string | null;
  entityCounts: { product: number; category: number; blogPost: number };
  locales: Record<string, LocaleCoverage>;
}
interface CoverageResponse {
  localeKind: "content";
  locales: string[];
  fieldsPerEntity: Record<string, number>;
  orgs: OrgCoverage[];
  totals: { locales: Record<string, LocaleCoverage> };
}

const ENTITY_KEYS = ["product", "category", "storefront_string", "blog_post"] as const;

export default function TranslationCoveragePage() {
  const { dict, locale, t } = useAdminLocale();
  const d = dict.translationCoverage;
  const [data, setData] = React.useState<CoverageResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true); setLoadError("");
    try { setData(await apiFetch<CoverageResponse>("/admin/translations/coverage")); }
    catch (e) { setLoadError(e instanceof Error ? e.message : dict.common.loadFailed); }
    finally { setLoading(false); }
  }, [dict]);
  React.useEffect(() => { load(); }, [load]);

  const pct = (c: EntityCoverage): string =>
    c.possible > 0 ? `${fmtNumber(locale, Math.round((c.approved / c.possible) * 100))}%` : dict.common.none;
  const num = (n: number) => fmtNumber(locale, n);
  const entityLabel = (key: string): string =>
    key === "product" ? d.entityProduct
    : key === "category" ? d.entityCategory
    : key === "storefront_string" ? d.entityStorefront
    : d.entityBlogPost;

  const coverageCells = (c: EntityCoverage) => (
    <>
      <td className="atd">{num(c.possible)}</td>
      <td className="atd">{num(c.translated)}</td>
      <td className="atd">{num(c.approved)}</td>
      <td className="atd">{num(c.draft)}</td>
      <td className="atd">{pct(c)}</td>
    </>
  );
  const coverageHead = (
    <>
      <th className="ath">{d.colPossible}</th>
      <th className="ath">{d.colTranslated}</th>
      <th className="ath">{d.colApproved}</th>
      <th className="ath">{d.colDraft}</th>
      <th className="ath">{d.colApprovedPct}</th>
    </>
  );

  return (
    <AdminShell title={d.title}>
      <PageHead sub={d.sub} />
      <p className="mb-3 text-sm text-slate-400">{d.intro}</p>
      <p className="mb-3 text-xs text-amber-300/90">{d.contentLocalesNote}</p>

      {loading && !data ? <div className="askel-table m-4" /> : null}
      {!loading && loadError ? (
        <div className="acard p-4">
          <ErrorState message={t("translationCoverage.loadFailed", { message: loadError })} onRetry={load} />
        </div>
      ) : null}
      {!loading && !loadError && data && data.orgs.length === 0 ? (
        <div className="acard p-4"><EmptyState title={d.emptyTitle} sub={d.emptySub} /></div>
      ) : null}

      {data && data.orgs.length > 0 ? (
        <>
          <p className="mb-3 text-xs text-slate-400">{t("translationCoverage.orgCount", { count: num(data.orgs.length) })}</p>

          <h2 className="mb-2 text-sm font-bold text-slate-200">{d.totalsTitle}</h2>
          <div className="acard mb-5 overflow-hidden p-0">
            <table className="atable atable-cards">
              <thead className="bg-slate-900"><tr>
                <th className="ath">{d.colLocale}</th>{coverageHead}
              </tr></thead>
              <tbody>
                {data.locales.map((loc) => {
                  const c = data.totals.locales[loc];
                  if (!c) return null;
                  return (
                    <tr key={loc} className="border-t border-slate-800">
                      <td data-label={d.colLocale} className="atd font-bold">{loc}</td>
                      {coverageCells(c)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h2 className="mb-2 text-sm font-bold text-slate-200">{d.entityTitle}</h2>
          <div className="acard mb-5 overflow-hidden p-0">
            <table className="atable atable-cards">
              <thead className="bg-slate-900"><tr>
                <th className="ath">{d.colEntity}</th><th className="ath">{d.colLocale}</th>{coverageHead}
              </tr></thead>
              <tbody>
                {ENTITY_KEYS.map((key) => data.locales.map((loc) => {
                  const c = data.totals.locales[loc]?.byEntity?.[key];
                  if (!c) return null;
                  return (
                    <tr key={`${key}-${loc}`} className="border-t border-slate-800">
                      <td data-label={d.colEntity} className="atd">{entityLabel(key)}</td>
                      <td data-label={d.colLocale} className="atd font-bold">{loc}</td>
                      {coverageCells(c)}
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          </div>

          <div className="space-y-5">
            {data.orgs.map((org) => (
              <div key={org.organizationId}>
                <h2 className="mb-2 text-sm font-bold text-slate-200">
                  <a className="text-indigo-300 hover:underline" href={`/orgs/${org.organizationId}`}>
                    {org.organizationName ?? org.organizationId}
                  </a>
                </h2>
                <div className="acard overflow-hidden p-0">
                  <table className="atable atable-cards">
                    <thead className="bg-slate-900"><tr>
                      <th className="ath">{d.colLocale}</th>{coverageHead}
                    </tr></thead>
                    <tbody>
                      {data.locales.map((loc) => {
                        const c = org.locales[loc];
                        if (!c) return null;
                        return (
                          <tr key={loc} className="border-t border-slate-800">
                            <td data-label={d.colLocale} className="atd font-bold">{loc}</td>
                            {coverageCells(c)}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </AdminShell>
  );
}
