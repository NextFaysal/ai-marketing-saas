"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { DataTable, ErrorState, PageHead, Tabs, askInput, toast } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import { fmtNumber, type UiLocale } from "@repo/contracts";
import { useAdminLocale } from "@/components/AdminLocale";

interface SocialPostItem {
  id: string; organizationId: string; organizationName: string | null;
  socialAccountId: string; accountName: string | null; platform: string | null;
  status: string; error: string | null; captionExcerpt: string;
  scheduledAt: string | null; updatedAt: string | null;
}
interface SocialBoard {
  accounts: { total: number; byStatus: Record<string, number>; byPlatform: Record<string, number> };
  errorAccounts: {
    id: string; organizationId: string; organizationName: string | null;
    platform: string; name: string; username: string | null;
    lastError: string | null; updatedAt: string | null;
  }[];
  posts: {
    failed: SocialPostItem[];
    sentToCreatorStale: { count: number; items: SocialPostItem[] };
    stuckPublishing: { count: number; items: SocialPostItem[] };
  };
}
interface AdsBoard {
  total: number; byHealth: Record<string, number>; platformBuckets: Record<string, number>;
  syncDisabledCount: number;
  broken: {
    id: string; organizationId: string; organizationName: string | null;
    name: string; label: string | null; displayName: string; platform: string;
    health: string; platformStatusBucket: string | null;
    lastError: string | null; lastSyncAt: string | null; updatedAt: string | null;
  }[];
}

function fmtDate(v: string | null | undefined, locale: UiLocale): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : fmtDateTime(locale, d);
}
function OrgLink({ id, name }: { id: string; name: string | null }) {
  return <a className="font-medium text-indigo-300 hover:underline" href={`/orgs/${id}`}>{name ?? id}</a>;
}
function Chips({ data }: { data: Record<string, number> }) {
  const { dict, locale } = useAdminLocale();
  const entries = Object.entries(data);
  if (entries.length === 0) return <span className="text-sm text-slate-400">{dict.socialOps.nothing}</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([k, v]) => (
        <span key={k} className="abadge-slate">{k}: {fmtNumber(locale, v)}</span>
      ))}
    </div>
  );
}
function PostRows({ items, emptyText, action }: { items: SocialPostItem[]; emptyText: string; action?: { label: string; run: (p: SocialPostItem) => void } }) {
  const { locale } = useAdminLocale();
  if (items.length === 0) return <p className="text-sm text-emerald-300">{emptyText}</p>;
  return (
    <ul className="space-y-2 text-sm">
      {items.map((p) => (
        <li key={p.id} className="rounded bg-slate-800 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <OrgLink id={p.organizationId} name={p.organizationName} />
            <span className="text-slate-400">{p.accountName ?? p.socialAccountId}{p.platform ? ` · ${p.platform}` : ""}</span>
            <span className="ml-auto text-xs text-slate-400">{fmtDate(p.updatedAt, locale)}</span>
          </div>
          {p.captionExcerpt ? <div className="mt-1 text-xs text-slate-300">{p.captionExcerpt}</div> : null}
          {p.error ? <div className="mt-1 text-xs text-red-300">{p.error}</div> : null}
          {action ? (
            <button className="abtn-secondary mt-2 !px-2 !py-0.5 text-xs" onClick={() => action.run(p)}>{action.label}</button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default function SocialOpsPage() {
  const { dict, locale, t } = useAdminLocale();
  const [social, setSocial] = React.useState<SocialBoard | null>(null);
  const [ads, setAds] = React.useState<AdsBoard | null>(null);
  // ADX12: loadDone separates "still loading" from "board load
  // failed" — before, a failed board fetch showed "লোড হচ্ছে…"
  // forever in every card of that board.
  const [loadDone, setLoadDone] = React.useState(false);
  // ADNX11: on mobile the two boards are switched by a tab (the
  // plan's mobile tab switch); lg shows both sections stacked,
  // exactly as before.
  const [section, setSection] = React.useState("social");
  const load = React.useCallback(async () => {
    setLoadDone(false);
    setSocial(await apiFetch<SocialBoard>("/admin/system/social-board").catch(() => null));
    setAds(await apiFetch<AdsBoard>("/admin/system/ads-board").catch(() => null));
    setLoadDone(true);
  }, []);
  React.useEffect(() => { load(); }, [load]);

  // AB3 / AN13: operator retry — প্রতিটি action Tenant পাশের নিজের
  // service পথেই যায় (আলাদা Admin logic নয়), কারণ বাধ্যতামূলক
  // (Audit-এ থাকে), আর API/Provider-এর ফল বা ভুল হুবহু দেখানো হয়।
  async function opsAction(path: string, label: string) {
    const reason = await askInput({ title: label, description: dict.socialOps.reasonDesc, inputLabel: dict.common.reason, inputRequired: true, confirmLabel: dict.common.proceed });
    if (!reason) return;
    try {
      const out = await apiFetch<any>(path, { method: "POST", body: JSON.stringify({ reason }) });
      const detail = out?.result?.error ?? out?.note ?? (out?.sweep ? t("socialOps.sweepDetail", { recovered: fmtNumber(locale, out.sweep.recovered), published: fmtNumber(locale, out.sweep.published), failed: fmtNumber(locale, out.sweep.failed), status: out.postStatusAfter ?? "—" }) : dict.socialOps.doneFallback);
      // ADNX11: retry/action feedback rides toast (✅/❌ prefixes
      // dropped — the toast kind carries the outcome, NB2 rule).
      toast(`${label}: ${detail}`);
      await load();
    } catch (e) {
      toast(`${label}: ${e instanceof Error ? e.message : dict.common.failed}`, "error");
    }
  }

  // ADX12: per-board pending slot (loading vs failed + retry).
  const pending = (label: string) => loadDone
    ? <ErrorState message={t("socialOps.boardLoadError", { label })} onRetry={load} />
    : <div className="space-y-2" aria-label={dict.common.loading}><div className="askel h-4 w-2/3" /><div className="askel h-4 w-1/2" /><div className="askel h-4 w-3/5" /></div>;
  return (
    <AdminShell title={dict.socialOps.title}>
      <PageHead sub={dict.socialOps.sub} />
      <div className="sticky top-0 z-20 -mx-1 mb-4 bg-slate-950/90 px-1 py-2 backdrop-blur lg:hidden">
        <Tabs tabs={[{ id: "social", label: dict.socialOps.tabSocial }, { id: "ads", label: dict.socialOps.tabAds }]} active={section} onChange={setSection} />
      </div>
      <p className="mb-4 rounded-lg bg-slate-800/60 p-3 text-xs text-slate-400">
        {dict.socialOps.operatorNoteA}<b>{dict.socialOps.operatorNoteBold}</b>{dict.socialOps.operatorNoteB}
      </p>
      {/* ADX11: দুটি স্পষ্ট বিভাগ — Social Accounts আগে (Error
          Account ও ব্যর্থ Post-ই এই বিভাগের প্রথম বিষয়), তারপর
          Ad Accounts। কার্ডগুলোর ক্রম আগের মতোই; বিভাগ-শিরোনাম
          শুধু গঠনটি স্পষ্ট করে। */}
      <div className={section === "social" ? "" : "hidden lg:block"}>
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h2 className="text-base font-semibold">{dict.socialOps.socialHeading}</h2>
        <span className="text-xs text-slate-400">{dict.socialOps.socialHeadingSub}</span>
      </div>
      <div className="acard mb-4">
        <div className="mb-2 font-semibold">{dict.socialOps.socialCardTitle} <span className="text-xs font-normal text-slate-400">{dict.socialOps.socialCardNote}</span></div>
        {!social ? pending(dict.socialOps.socialBoard) : (
          <div className="space-y-3">
            <div className="text-sm">{dict.socialOps.socialTotal} <b>{fmtNumber(locale, social.accounts.total)}</b></div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-400">{dict.socialOps.byStatus}</div>
              <Chips data={social.accounts.byStatus} />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-400">{dict.socialOps.byPlatform}</div>
              <Chips data={social.accounts.byPlatform} />
            </div>
          </div>
        )}
      </div>

      <div className="acard mb-4 overflow-hidden p-0">
        <div className="border-b border-slate-800 p-4 font-semibold">{t("socialOps.errorAccountsTitle", { count: social ? fmtNumber(locale, social.errorAccounts.length) : "…" })}</div>
        {!social ? <div className="p-4">{pending(dict.socialOps.socialBoard)}</div> : social.errorAccounts.length === 0 ? (
          <p className="p-4 text-sm text-emerald-300">{dict.socialOps.noErrorAccounts}</p>
        ) : (
          <DataTable>
            <thead><tr><th className="ath">{dict.socialOps.colOrg}</th><th className="ath">{dict.socialOps.colAccount}</th><th className="ath">{dict.socialOps.colPlatform}</th><th className="ath">{dict.socialOps.colLastError}</th><th className="ath">{dict.socialOps.colUpdated}</th><th className="ath">{dict.socialOps.colAction}</th></tr></thead>
            <tbody>{social.errorAccounts.map((a) => (
              <tr key={a.id} className="border-t border-slate-800">
                <td data-label={dict.socialOps.colOrg} className="atd"><OrgLink id={a.organizationId} name={a.organizationName} /></td>
                <td data-label={dict.socialOps.colAccount} className="atd">{a.name}{a.username ? <div className="text-xs text-slate-400">@{a.username}</div> : null}</td>
                <td data-label={dict.socialOps.colPlatform} className="atd">{a.platform}</td>
                <td data-label={dict.socialOps.colLastError} className="atd"><span className="text-red-300">{a.lastError ?? "—"}</span></td>
                <td data-label={dict.socialOps.colUpdated} className="atd text-slate-400">{fmtDate(a.updatedAt, locale)}</td>
                <td data-label={dict.socialOps.colAction} className="atd"><button className="abtn-secondary !px-2 !py-0.5 text-xs" onClick={() => opsAction(`/admin/system/social-board/accounts/${a.id}/recheck`, t("socialOps.recheckLabel", { name: a.name }))}>{dict.socialOps.recheck}</button></td>
              </tr>
            ))}</tbody>
          </DataTable>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="acard">
          <div className="mb-2 font-semibold">{t("socialOps.failedPostsTitle", { count: social ? fmtNumber(locale, social.posts.failed.length) : "…" })}</div>
          {!social ? pending(dict.socialOps.socialBoard) : (
            <PostRows items={social.posts.failed} emptyText={dict.socialOps.noFailedPosts} action={{ label: dict.socialOps.retryPublish, run: (p) => opsAction(`/admin/system/social-board/posts/${p.id}/retry`, dict.socialOps.retryPublishLabel) }} />
          )}
        </div>
        <div className="acard">
          <div className="mb-2 font-semibold">{t("socialOps.staleTitle", { count: social ? fmtNumber(locale, social.posts.sentToCreatorStale.count) : "…" })}</div>
          {!social ? pending(dict.socialOps.socialBoard) : (
            <>
              <PostRows items={social.posts.sentToCreatorStale.items} emptyText={dict.socialOps.noStalePosts} />
              <p className="mt-2 text-xs text-slate-400">{dict.socialOps.staleNote}</p>
            </>
          )}
        </div>
        <div className="acard">
          <div className="mb-2 font-semibold">{t("socialOps.stuckTitle", { count: social ? fmtNumber(locale, social.posts.stuckPublishing.count) : "…" })}</div>
          {!social ? pending(dict.socialOps.socialBoard) : (
            <>
              <PostRows items={social.posts.stuckPublishing.items} emptyText={dict.socialOps.noStuckPosts} action={{ label: dict.socialOps.runSweep, run: (p) => opsAction(`/admin/system/social-board/posts/${p.id}/recover-stuck`, dict.socialOps.recoverLabel) }} />
              <p className="mt-2 text-xs text-slate-400">{dict.socialOps.stuckNote}</p>
            </>
          )}
        </div>
      </div>

      </div>
      <div className={section === "ads" ? "" : "hidden lg:block"}>
      <div className="mb-3 mt-6 flex flex-wrap items-baseline gap-2">
        <h2 className="text-base font-semibold">{dict.socialOps.adsHeading}</h2>
        <span className="text-xs text-slate-400">{dict.socialOps.adsHeadingSub}</span>
      </div>
      <div className="acard">
        <div className="mb-2 font-semibold">{dict.socialOps.adsCardTitle} <span className="text-xs font-normal text-slate-400">{dict.socialOps.adsCardNote}</span></div>
        {!ads ? pending(dict.socialOps.adsBoard) : (
          <div className="space-y-3">
            <div className="text-sm">{dict.socialOps.adsTotal} <b>{fmtNumber(locale, ads.total)}</b> · {dict.socialOps.syncDisabled} <b>{fmtNumber(locale, ads.syncDisabledCount)}</b></div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-400">{dict.socialOps.byHealth}</div>
              <Chips data={ads.byHealth} />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-400">{dict.socialOps.byPlatformStatus}</div>
              <Chips data={ads.platformBuckets} />
            </div>
          </div>
        )}
      </div>

      <div className="acard mt-4 overflow-hidden p-0">
        <div className="border-b border-slate-800 p-4 font-semibold">{t("socialOps.brokenTitle", { count: ads ? fmtNumber(locale, ads.broken.length) : "…" })} <span className="text-xs font-normal text-slate-400">{dict.socialOps.brokenNote}</span></div>
        {!ads ? <div className="p-4">{pending(dict.socialOps.adsBoard)}</div> : ads.broken.length === 0 ? (
          <p className="p-4 text-sm text-emerald-300">{dict.socialOps.noBrokenAds}</p>
        ) : (
          <DataTable>
            <thead><tr><th className="ath">{dict.socialOps.colOrg}</th><th className="ath">{dict.socialOps.colAccount}</th><th className="ath">{dict.socialOps.colPlatform}</th><th className="ath">{dict.socialOps.colHealth}</th><th className="ath">{dict.socialOps.colPlatformStatus}</th><th className="ath">{dict.socialOps.colLastError}</th><th className="ath">{dict.socialOps.colLastSync}</th><th className="ath">{dict.socialOps.colAction}</th></tr></thead>
            <tbody>{ads.broken.map((a) => (
              <tr key={a.id} className="border-t border-slate-800">
                <td data-label={dict.socialOps.colOrg} className="atd"><OrgLink id={a.organizationId} name={a.organizationName} /></td>
                <td data-label={dict.socialOps.colAccount} className="atd">{a.displayName}{a.label ? <div className="text-xs text-slate-400">{a.name}</div> : null}</td>
                <td data-label={dict.socialOps.colPlatform} className="atd">{a.platform}</td>
                <td data-label={dict.socialOps.colHealth} className="atd">{a.health === "error" ? <span className="abadge-red">error</span> : <span className="abadge-slate">{a.health}</span>}</td>
                <td data-label={dict.socialOps.colPlatformStatus} className="atd">{a.platformStatusBucket ? <span className="abadge-amber">{a.platformStatusBucket}</span> : "—"}</td>
                <td data-label={dict.socialOps.colLastError} className="atd"><span className="text-red-300">{a.lastError ?? "—"}</span></td>
                <td data-label={dict.socialOps.colLastSync} className="atd text-slate-400">{fmtDate(a.lastSyncAt, locale)}</td>
                <td data-label={dict.socialOps.colAction} className="atd">{["meta", "google", "tiktok"].includes(a.platform) ? <button className="abtn-secondary !px-2 !py-0.5 text-xs" onClick={() => opsAction(`/admin/system/ads-board/accounts/${a.id}/retry-sync`, t("socialOps.syncRetryLabel", { name: a.displayName }))}>{dict.socialOps.syncRetry}</button> : <span className="text-xs text-slate-400">{dict.socialOps.noSyncPath}</span>}</td>
              </tr>
            ))}</tbody>
          </DataTable>
        )}
      </div>
      </div>
    </AdminShell>
  );
}
