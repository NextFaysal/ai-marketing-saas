"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { apiFetch } from "@/lib/api";

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

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("bn-BD");
}
function OrgLink({ id, name }: { id: string; name: string | null }) {
  return <a className="font-medium text-indigo-300 hover:underline" href={`/orgs/${id}`}>{name ?? id}</a>;
}
function Chips({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return <span className="text-sm text-slate-500">কিছু নেই</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([k, v]) => (
        <span key={k} className="abadge-slate">{k}: {v.toLocaleString("bn-BD")}</span>
      ))}
    </div>
  );
}
function PostRows({ items, emptyText }: { items: SocialPostItem[]; emptyText: string }) {
  if (items.length === 0) return <p className="text-sm text-emerald-300">{emptyText}</p>;
  return (
    <ul className="space-y-2 text-sm">
      {items.map((p) => (
        <li key={p.id} className="rounded bg-slate-800 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <OrgLink id={p.organizationId} name={p.organizationName} />
            <span className="text-slate-400">{p.accountName ?? p.socialAccountId}{p.platform ? ` · ${p.platform}` : ""}</span>
            <span className="ml-auto text-xs text-slate-500">{fmtDate(p.updatedAt)}</span>
          </div>
          {p.captionExcerpt ? <div className="mt-1 text-xs text-slate-300">{p.captionExcerpt}</div> : null}
          {p.error ? <div className="mt-1 text-xs text-red-300">{p.error}</div> : null}
        </li>
      ))}
    </ul>
  );
}

export default function SocialOpsPage() {
  const [social, setSocial] = React.useState<SocialBoard | null>(null);
  const [ads, setAds] = React.useState<AdsBoard | null>(null);
  const load = React.useCallback(async () => {
    setSocial(await apiFetch<SocialBoard>("/admin/system/social-board").catch(() => null));
    setAds(await apiFetch<AdsBoard>("/admin/system/ads-board").catch(() => null));
  }, []);
  React.useEffect(() => { load(); }, [load]);

  return (
    <AdminShell title="📣 Social & Ads Ops">
      <div className="acard mb-4">
        <div className="mb-2 font-semibold">📣 Social <span className="text-xs font-normal text-slate-500">(সব Tenant মিলিয়ে — শুধু Metadata, কোনো Token/Credential কখনো দেখানো হয় না)</span></div>
        {!social ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : (
          <div className="space-y-3">
            <div className="text-sm">Social Account মোট: <b>{social.accounts.total.toLocaleString("bn-BD")}</b></div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-400">Status অনুযায়ী</div>
              <Chips data={social.accounts.byStatus} />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-400">Platform অনুযায়ী</div>
              <Chips data={social.accounts.byPlatform} />
            </div>
          </div>
        )}
      </div>

      <div className="acard mb-4 overflow-hidden p-0">
        <div className="border-b border-slate-800 p-4 font-semibold">Social Account — Error অবস্থায় ({social?.errorAccounts.length ?? "…"})</div>
        {!social ? <p className="p-4 text-sm text-slate-500">লোড হচ্ছে…</p> : social.errorAccounts.length === 0 ? (
          <p className="p-4 text-sm text-emerald-300">কোনো Social Account Error অবস্থায় নেই।</p>
        ) : (
          <table className="atable">
            <thead><tr><th className="ath">Org</th><th className="ath">Account</th><th className="ath">Platform</th><th className="ath">Last Error</th><th className="ath">Updated</th></tr></thead>
            <tbody>{social.errorAccounts.map((a) => (
              <tr key={a.id} className="border-t border-slate-800">
                <td className="atd"><OrgLink id={a.organizationId} name={a.organizationName} /></td>
                <td className="atd">{a.name}{a.username ? <div className="text-xs text-slate-500">@{a.username}</div> : null}</td>
                <td className="atd">{a.platform}</td>
                <td className="atd"><span className="text-red-300">{a.lastError ?? "—"}</span></td>
                <td className="atd text-slate-400">{fmtDate(a.updatedAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="acard">
          <div className="mb-2 font-semibold">ব্যর্থ Post ({social?.posts.failed.length ?? "…"})</div>
          {!social ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : (
            <PostRows items={social.posts.failed} emptyText="কোনো ব্যর্থ Post নেই।" />
          )}
        </div>
        <div className="acard">
          <div className="mb-2 font-semibold">Creator-এর কাছে পাঠানো, ৪৮ ঘণ্টার বেশি অপেক্ষমাণ ({social?.posts.sentToCreatorStale.count ?? "…"})</div>
          {!social ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : (
            <PostRows items={social.posts.sentToCreatorStale.items} emptyText="অপেক্ষমাণ কোনো Post নেই।" />
          )}
        </div>
        <div className="acard">
          <div className="mb-2 font-semibold">Publishing-এ আটকে আছে (&gt;১৫ মিনিট) ({social?.posts.stuckPublishing.count ?? "…"})</div>
          {!social ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : (
            <PostRows items={social.posts.stuckPublishing.items} emptyText="আটকে থাকা কোনো Post নেই।" />
          )}
        </div>
      </div>

      <div className="acard mt-4">
        <div className="mb-2 font-semibold">📢 বিজ্ঞাপন অ্যাকাউন্ট <span className="text-xs font-normal text-slate-500">(সব Tenant মিলিয়ে)</span></div>
        {!ads ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : (
          <div className="space-y-3">
            <div className="text-sm">Ad Account মোট: <b>{ads.total.toLocaleString("bn-BD")}</b> · Sync Disabled: <b>{ads.syncDisabledCount.toLocaleString("bn-BD")}</b></div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-400">Connection Health অনুযায়ী</div>
              <Chips data={ads.byHealth} />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-400">Platform Status অনুযায়ী</div>
              <Chips data={ads.platformBuckets} />
            </div>
          </div>
        )}
      </div>

      <div className="acard mt-4 overflow-hidden p-0">
        <div className="border-b border-slate-800 p-4 font-semibold">বিজ্ঞাপন অ্যাকাউন্ট — মনোযোগ দরকার ({ads?.broken.length ?? "…"}) <span className="text-xs font-normal text-slate-500">Error আগে, তারপর Platform Disabled/Restricted</span></div>
        {!ads ? <p className="p-4 text-sm text-slate-500">লোড হচ্ছে…</p> : ads.broken.length === 0 ? (
          <p className="p-4 text-sm text-emerald-300">কোনো Ad Account-এ সমস্যা নেই।</p>
        ) : (
          <table className="atable">
            <thead><tr><th className="ath">Org</th><th className="ath">Account</th><th className="ath">Platform</th><th className="ath">Health</th><th className="ath">Platform Status</th><th className="ath">Last Error</th><th className="ath">Last Sync</th></tr></thead>
            <tbody>{ads.broken.map((a) => (
              <tr key={a.id} className="border-t border-slate-800">
                <td className="atd"><OrgLink id={a.organizationId} name={a.organizationName} /></td>
                <td className="atd">{a.displayName}{a.label ? <div className="text-xs text-slate-500">{a.name}</div> : null}</td>
                <td className="atd">{a.platform}</td>
                <td className="atd">{a.health === "error" ? <span className="abadge-red">error</span> : <span className="abadge-slate">{a.health}</span>}</td>
                <td className="atd">{a.platformStatusBucket ? <span className="abadge-amber">{a.platformStatusBucket}</span> : "—"}</td>
                <td className="atd"><span className="text-red-300">{a.lastError ?? "—"}</span></td>
                <td className="atd text-slate-400">{fmtDate(a.lastSyncAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </AdminShell>
  );
}
