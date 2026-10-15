"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { ErrorState, askInput } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";

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
  return Number.isNaN(d.getTime()) ? "—" : fmtDateTime(d);
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
function PostRows({ items, emptyText, action }: { items: SocialPostItem[]; emptyText: string; action?: { label: string; run: (p: SocialPostItem) => void } }) {
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
          {action ? (
            <button className="abtn-secondary mt-2 !px-2 !py-0.5 text-xs" onClick={() => action.run(p)}>{action.label}</button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default function SocialOpsPage() {
  const [social, setSocial] = React.useState<SocialBoard | null>(null);
  const [ads, setAds] = React.useState<AdsBoard | null>(null);
  const [msg, setMsg] = React.useState("");
  // ADX12: loadDone separates "still loading" from "board load
  // failed" — before, a failed board fetch showed "লোড হচ্ছে…"
  // forever in every card of that board.
  const [loadDone, setLoadDone] = React.useState(false);
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
    const reason = await askInput({ title: label, description: "কারণ (Audit-এ থাকবে):", inputLabel: "কারণ", inputRequired: true, confirmLabel: "এগিয়ে যান" });
    if (!reason) return;
    try {
      const out = await apiFetch<any>(path, { method: "POST", body: JSON.stringify({ reason }) });
      const detail = out?.result?.error ?? out?.note ?? (out?.sweep ? `Sweep: recovered ${out.sweep.recovered}, published ${out.sweep.published}, failed ${out.sweep.failed} · Post এখন: ${out.postStatusAfter ?? "—"}` : "সম্পন্ন হয়েছে");
      setMsg(`✅ ${label}: ${detail}`);
      await load();
    } catch (e) {
      setMsg(`❌ ${label}: ${e instanceof Error ? e.message : "ব্যর্থ হয়েছে"}`);
    }
  }

  // ADX12: per-board pending slot (loading vs failed + retry).
  const pending = (label: string) => loadDone
    ? <ErrorState message={`${label} লোড হয়নি — আবার চেষ্টা করুন।`} onRetry={load} />
    : <p className="text-sm text-slate-500">লোড হচ্ছে…</p>;
  return (
    <AdminShell title="📣 Social & Ads Ops">
      {msg ? <p className="mb-3 rounded-lg bg-indigo-500/10 p-3 text-sm text-indigo-200">{msg}</p> : null}
      <p className="mb-4 rounded-lg bg-slate-800/60 p-3 text-xs text-slate-400">
        Operator action (AB3): নিচের Retry/যাচাই বোতামগুলো Tenant পাশের নিজের service দিয়েই কাজ করে — ব্যর্থ হলে Provider-এর আসল ভুলটাই দেখাবে।
        সীমা: কোনো Account <b>Disconnect/Reconnect Admin থেকে করা যায় না</b> — Reconnect-এ Tenant-এর নিজের OAuth লাগে, Tenant-কে তার অ্যাকাউন্টে গিয়ে আবার কানেক্ট করতে হবে।
      </p>
      {/* ADX11: দুটি স্পষ্ট বিভাগ — Social Accounts আগে (Error
          Account ও ব্যর্থ Post-ই এই বিভাগের প্রথম বিষয়), তারপর
          Ad Accounts। কার্ডগুলোর ক্রম আগের মতোই; বিভাগ-শিরোনাম
          শুধু গঠনটি স্পষ্ট করে। */}
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h2 className="text-base font-semibold">👥 Social Accounts</h2>
        <span className="text-xs text-slate-500">Error অবস্থার Account ও ব্যর্থ Post আগে — Retry প্রতিটি Row থেকেই</span>
      </div>
      <div className="acard mb-4">
        <div className="mb-2 font-semibold">📣 Social <span className="text-xs font-normal text-slate-500">(সব Tenant মিলিয়ে — শুধু Metadata, কোনো Token/Credential কখনো দেখানো হয় না)</span></div>
        {!social ? pending("Social Board") : (
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
        {!social ? <div className="p-4">{pending("Social Board")}</div> : social.errorAccounts.length === 0 ? (
          <p className="p-4 text-sm text-emerald-300">কোনো Social Account Error অবস্থায় নেই।</p>
        ) : (
          <table className="atable">
            <thead><tr><th className="ath">Org</th><th className="ath">Account</th><th className="ath">Platform</th><th className="ath">Last Error</th><th className="ath">Updated</th><th className="ath">Action</th></tr></thead>
            <tbody>{social.errorAccounts.map((a) => (
              <tr key={a.id} className="border-t border-slate-800">
                <td className="atd"><OrgLink id={a.organizationId} name={a.organizationName} /></td>
                <td className="atd">{a.name}{a.username ? <div className="text-xs text-slate-500">@{a.username}</div> : null}</td>
                <td className="atd">{a.platform}</td>
                <td className="atd"><span className="text-red-300">{a.lastError ?? "—"}</span></td>
                <td className="atd text-slate-400">{fmtDate(a.updatedAt)}</td>
                <td className="atd"><button className="abtn-secondary !px-2 !py-0.5 text-xs" onClick={() => opsAction(`/admin/system/social-board/accounts/${a.id}/recheck`, `${a.name} — স্বাস্থ্য আবার যাচাই`)}>স্বাস্থ্য আবার যাচাই</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="acard">
          <div className="mb-2 font-semibold">ব্যর্থ Post ({social?.posts.failed.length ?? "…"})</div>
          {!social ? pending("Social Board") : (
            <PostRows items={social.posts.failed} emptyText="কোনো ব্যর্থ Post নেই।" action={{ label: "আবার Publish চেষ্টা", run: (p) => opsAction(`/admin/system/social-board/posts/${p.id}/retry`, "ব্যর্থ Post আবার চেষ্টা") }} />
          )}
        </div>
        <div className="acard">
          <div className="mb-2 font-semibold">Creator-এর কাছে পাঠানো, ৪৮ ঘণ্টার বেশি অপেক্ষমাণ ({social?.posts.sentToCreatorStale.count ?? "…"})</div>
          {!social ? pending("Social Board") : (
            <>
              <PostRows items={social.posts.sentToCreatorStale.items} emptyText="অপেক্ষমাণ কোনো Post নেই।" />
              <p className="mt-2 text-xs text-slate-500">এই তালিকা শুধু দেখার জন্য — Postটি Creator-এর সাড়ার অপেক্ষায়, retry করার কোনো পথ নেই।</p>
            </>
          )}
        </div>
        <div className="acard">
          <div className="mb-2 font-semibold">Publishing-এ আটকে আছে (&gt;১৫ মিনিট) ({social?.posts.stuckPublishing.count ?? "…"})</div>
          {!social ? pending("Social Board") : (
            <>
              <PostRows items={social.posts.stuckPublishing.items} emptyText="আটকে থাকা কোনো Post নেই।" action={{ label: "Publish sweep চালান", run: (p) => opsAction(`/admin/system/social-board/posts/${p.id}/recover-stuck`, "আটকে থাকা Post recovery") }} />
              <p className="mt-2 text-xs text-slate-500">Sweep-টি ওই Org-এর — stale claim recovery-সহ Org-এর সব due Post প্রসেস হয়, শুধু এই Postটি নয় (৫ মিনিটের automation job যে পথে চলে, হুবহু সেই পথ)।</p>
            </>
          )}
        </div>
      </div>

      <div className="mb-3 mt-6 flex flex-wrap items-baseline gap-2">
        <h2 className="text-base font-semibold">📢 Ad Accounts</h2>
        <span className="text-xs text-slate-500">মনোযোগ দরকার এমন Account আগে — Sync Retry Row থেকেই</span>
      </div>
      <div className="acard">
        <div className="mb-2 font-semibold">📢 বিজ্ঞাপন অ্যাকাউন্ট <span className="text-xs font-normal text-slate-500">(সব Tenant মিলিয়ে)</span></div>
        {!ads ? pending("Ads Board") : (
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
        {!ads ? <div className="p-4">{pending("Ads Board")}</div> : ads.broken.length === 0 ? (
          <p className="p-4 text-sm text-emerald-300">কোনো Ad Account-এ সমস্যা নেই।</p>
        ) : (
          <table className="atable">
            <thead><tr><th className="ath">Org</th><th className="ath">Account</th><th className="ath">Platform</th><th className="ath">Health</th><th className="ath">Platform Status</th><th className="ath">Last Error</th><th className="ath">Last Sync</th><th className="ath">Action</th></tr></thead>
            <tbody>{ads.broken.map((a) => (
              <tr key={a.id} className="border-t border-slate-800">
                <td className="atd"><OrgLink id={a.organizationId} name={a.organizationName} /></td>
                <td className="atd">{a.displayName}{a.label ? <div className="text-xs text-slate-500">{a.name}</div> : null}</td>
                <td className="atd">{a.platform}</td>
                <td className="atd">{a.health === "error" ? <span className="abadge-red">error</span> : <span className="abadge-slate">{a.health}</span>}</td>
                <td className="atd">{a.platformStatusBucket ? <span className="abadge-amber">{a.platformStatusBucket}</span> : "—"}</td>
                <td className="atd"><span className="text-red-300">{a.lastError ?? "—"}</span></td>
                <td className="atd text-slate-400">{fmtDate(a.lastSyncAt)}</td>
                <td className="atd">{["meta", "google", "tiktok"].includes(a.platform) ? <button className="abtn-secondary !px-2 !py-0.5 text-xs" onClick={() => opsAction(`/admin/system/ads-board/accounts/${a.id}/retry-sync`, `${a.displayName} — Sync আবার চেষ্টা`)}>Sync আবার চেষ্টা</button> : <span className="text-xs text-slate-500">এই Platform-এর sync পথ নেই</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </AdminShell>
  );
}
