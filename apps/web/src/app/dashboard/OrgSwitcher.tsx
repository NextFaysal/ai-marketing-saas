"use client";
import React from "react";
import { Building2, Check, ChevronDown, Pin, Plus, LayoutGrid, Search } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  emptyOrgListPrefs, filterSwitcherOrgs, isPinnedOrg, isSwitchNeeded, orderSwitcherOrgs,
  orgArchived, orgStateBadge, orgSuspended, orgSwitcherPrefsKey, parseOrgListPrefs,
  resolveCurrentOrgId, roleLabel, switcherMode, togglePinnedOrg, touchRecentOrg,
  userIdFromAccessToken, type OrgListPrefs, type SwitcherOrg,
} from "@/lib/org-switcher";
import OrgCreateForm from "./OrgCreateForm";

/**
 * OU1 (One-Umbrella OB1): the dashboard Organization switcher.
 *
 * Data: GET /organizations (listMine) — the user's ACTIVE
 * memberships only, so a suspended membership can never be
 * switched into from here.
 *
 * Switching: the whole dashboard reads the org id from
 * localStorage at mount (lib/org.ts), so a switch stores the new
 * id and does a FULL page reload. That is the honest architecture
 * of this codebase — there is no in-place org context to patch,
 * and a partial switch would leave stale org-scoped data visible.
 *
 * The menu also carries the two OU1 companions: the portfolio
 * summary entry ("সব Organization-এর সারসংক্ষেপ" → the existing
 * /dashboard/portfolio page) and "নতুন Organization তৈরি"
 * (OrgCreateForm — on success the creator, now OWNER of the new
 * org via the existing backend path, is switched straight in).
 *
 * Single-org users see the same button with their one org marked
 * current plus a short note — no fake multi-org chrome.
 *
 * ORG8 (Organization Next OB2): the list is personalized —
 * name/slug search (shown once the list is long enough to need
 * it), per-user pins (pinned orgs float to the top) and
 * recent-use ordering. Prefs live in localStorage keyed by the
 * signed-in user's id, so they are per device (see the lib note).
 */
export default function OrgSwitcher() {
  const [orgs, setOrgs] = React.useState<SwitcherOrg[] | null>(null);
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<"list" | "create">("list");
  const [storedId, setStoredId] = React.useState<string | null>(null);
  // ORG8: per-user list personalization (pin / recent / search).
  // Stored client-side only, keyed by the signed-in user's id —
  // see lib/org-switcher for the honest scope note (per device).
  const [prefs, setPrefs] = React.useState<OrgListPrefs>(emptyOrgListPrefs());
  const [query, setQuery] = React.useState("");
  const prefsKeyRef = React.useRef<string>(orgSwitcherPrefsKey(null));

  const savePrefs = React.useCallback((next: OrgListPrefs) => {
    setPrefs(next);
    try { localStorage.setItem(prefsKeyRef.current, JSON.stringify(next)); } catch { /* private mode — pins just don't persist */ }
  }, []);

  React.useEffect(() => {
    setStoredId(getOrganizationId());
    let initialPrefs = emptyOrgListPrefs();
    try {
      const key = orgSwitcherPrefsKey(userIdFromAccessToken(localStorage.getItem("accessToken")));
      prefsKeyRef.current = key;
      initialPrefs = parseOrgListPrefs(localStorage.getItem(key));
      setPrefs(initialPrefs);
    } catch { /* storage unavailable — defaults apply */ }
    let alive = true;
    apiFetch<SwitcherOrg[]>("/organizations")
      .then((rows) => {
        if (!alive) return;
        const list = Array.isArray(rows) ? rows : [];
        setOrgs(list);
        // Opening the dashboard IS a use of the current org:
        // seed the recent list with it so "recent" is truthful
        // from the first open, not only after a switch.
        const currentId = resolveCurrentOrgId(list, getOrganizationId());
        if (currentId && initialPrefs.recentIds[0] !== currentId) {
          const next = touchRecentOrg(initialPrefs, currentId);
          setPrefs(next);
          try { localStorage.setItem(prefsKeyRef.current, JSON.stringify(next)); } catch { /* ignore */ }
        }
      })
      .catch(() => { if (alive) setOrgs([]); });
    return () => { alive = false; };
  }, []);

  if (!orgs) return null; // still loading — render nothing rather than a wrong org name
  const mode = switcherMode(orgs);
  if (mode === "empty") return null; // layout routes org-less users to /onboarding
  const currentId = resolveCurrentOrgId(orgs, storedId);
  const current = orgs.find((o) => o.id === currentId) ?? orgs[0];
  const visibleOrgs = filterSwitcherOrgs(orderSwitcherOrgs(orgs, prefs), query);
  const showSearch = orgs.length > 5;
  const showPin = orgs.length > 1;

  const switchTo = (targetId: string) => {
    if (!isSwitchNeeded(orgs, storedId, targetId)) { setOpen(false); return; }
    savePrefs(touchRecentOrg(prefs, targetId));
    localStorage.setItem("organizationId", targetId);
    window.location.reload();
  };

  const togglePin = (orgId: string) => {
    savePrefs(togglePinnedOrg(prefs, orgId));
  };

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen(!open); setView("list"); setQuery(""); }}
        className="flex max-w-[190px] items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-2.5 py-1.5 text-left shadow-sm transition hover:bg-slate-50 sm:max-w-[230px]"
        title={current.name}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Building2 className="h-4 w-4 shrink-0 text-indigo-600" />
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-bold leading-tight text-slate-800">{current.name}</span>
          <span className="block text-[10px] leading-tight text-slate-500">
            {roleLabel(current.myRole)}
            {orgStateBadge(current) ? (
              <span className={`ml-1 rounded px-1 py-px text-[9px] font-bold ${orgSuspended(current) ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>{orgStateBadge(current)}</span>
            ) : null}
          </span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-12 z-50 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl" role="menu">
            {view === "list" ? (
              <>
                <div className="px-2 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Organization বদলান</div>
                {showSearch ? (
                  <div className="relative px-1 pb-1.5">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-[calc(50%+2px)] text-slate-400" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Organization খুঁজুন…"
                      className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                      aria-label="Organization খুঁজুন"
                    />
                  </div>
                ) : null}
                <div className="max-h-64 overflow-y-auto">
                  {visibleOrgs.length === 0 ? (
                    <p className="px-2 py-3 text-[12.5px] text-slate-400">“{query}” নামে কোনো Organization পাওয়া যায়নি।</p>
                  ) : null}
                  {visibleOrgs.map((o) => {
                    const isCurrent = o.id === current.id;
                    const pinned = isPinnedOrg(prefs, o.id);
                    return (
                      <div key={o.id} className="relative">
                        <button
                          onClick={() => switchTo(o.id)}
                          className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition hover:bg-slate-50 ${showPin ? "pr-10" : ""} ${isCurrent ? "bg-indigo-50/70" : ""}`}
                          role="menuitem"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-[11px] font-bold text-white">
                            {(o.name || "?").slice(0, 1).toUpperCase()}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-slate-800">
                              {o.name}
                              {orgStateBadge(o) ? (
                                <span className={`ml-1.5 rounded px-1.5 py-0.5 align-middle text-[10px] font-bold ${orgSuspended(o) ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>{orgStateBadge(o)}</span>
                              ) : null}
                            </span>
                            <span className="block text-[11px] text-slate-500">
                              {roleLabel(o.myRole)}{o.slug ? ` · ${o.slug}` : ""}
                              {orgArchived(o) && !orgSuspended(o) ? " · Restore করলে আবার চালু হবে" : ""}
                            </span>
                          </span>
                          {isCurrent ? <Check className="h-4 w-4 shrink-0 text-indigo-600" /> : null}
                        </button>
                        {showPin ? (
                          <button
                            type="button"
                            onClick={() => togglePin(o.id)}
                            className={`absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg transition hover:bg-slate-100 ${pinned ? "text-indigo-600" : "text-slate-300 hover:text-slate-500"}`}
                            title={pinned ? "Pin সরান" : "ওপরে Pin করুন"}
                            aria-label={pinned ? `${o.name} — Pin সরান` : `${o.name} — ওপরে Pin করুন`}
                            aria-pressed={pinned}
                          >
                            <Pin className="h-3.5 w-3.5" fill={pinned ? "currentColor" : "none"} />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-1 border-t border-slate-100 pt-1">
                  <a href="/dashboard/portfolio" className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50" role="menuitem">
                    <LayoutGrid className="h-4 w-4 text-slate-400" /> সব Organization-এর সারসংক্ষেপ
                  </a>
                  <button onClick={() => setView("create")} className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-[13px] font-semibold text-indigo-700 transition hover:bg-indigo-50" role="menuitem">
                    <Plus className="h-4 w-4" /> নতুন Organization তৈরি
                  </button>
                </div>
                {mode === "single" ? (
                  <p className="px-2 pb-1 pt-1 text-[11px] leading-relaxed text-slate-400">আপনি এখন একটি Organization-এর সদস্য। নতুন আরেকটি তৈরি করলে এখান থেকেই বদলাতে পারবেন।</p>
                ) : null}
              </>
            ) : (
              <OrgCreateForm onBack={() => setView("list")} onCreated={(orgId) => switchTo(orgId)} />
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
