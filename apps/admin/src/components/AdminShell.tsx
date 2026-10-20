"use client";
import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch, getAdminToken, setAdminToken } from "@/lib/api";
import {
  ALL_NAV_ITEMS, LS_KEYS, NAV_GROUPS, NavIcon, groupForPath, isActivePath,
  lsGetArray, lsSet, navItemForPath,
  type NavCounts, type NavItemDef,
} from "./nav";
import { useNavCounts } from "./useNavCounts";
import { DialogHost, ToastHost, askReason } from "./ui";
import AttentionBell from "./AttentionBell";
import { AdminLocaleSwitcher, useAdminLocale } from "./AdminLocale";
import { fmtNumber } from "@repo/contracts";
import CommandPalette from "./CommandPalette";

// ADX2 (Admin UX DB1): Navigation v2 — 7 collapsible task groups
// (docs/admin-ux-architecture.md §2), persisted group state with the
// active route's group auto-opened (§৭ decision 2), ⭐ প্রিয় pins and
// 🕘 সাম্প্রতিক recents persisted in localStorage, distinct SVG icon
// per item (./nav.tsx), badge slots fed by ADX3's nav-counts
// (absent count ⇒ nothing renders — never a fabricated number).
// Role-aware de-emphasis from the plan was SKIPPED: the login flow
// stores body.user = { id, email, name, isSuperAdmin } — AuthService
// .issueToken() never sends adminTier to the client, so there is no
// honest tier to style from (see architecture doc §2.2).

function countOf(item: NavItemDef, counts: NavCounts | null): number | undefined {
  if (!counts || !item.countKey) return undefined;
  const v = counts[item.countKey];
  return typeof v === "number" ? v : undefined;
}

function NavRow({
  item, counts, collapsed, pinned, onTogglePin, onNavigate,
}: {
  item: NavItemDef; counts: NavCounts | null; collapsed: boolean;
  pinned: boolean; onTogglePin: (href: string) => void; onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? "/";
  const { locale, t } = useAdminLocale();
  const label = t(item.labelKey);
  const active = isActivePath(pathname, item.href);
  const count = countOf(item, counts);
  const showBadge = count !== undefined && count > 0;
  return (
    <div className="group/row relative flex items-center">
      <a
        href={item.href}
        onClick={onNavigate}
        title={collapsed ? (showBadge ? `${label} (${fmtNumber(locale, count)})` : label) : undefined}
        className={`anav relative flex-1 ${active ? "anav-active" : ""} ${collapsed ? "justify-center px-2" : ""}`}
      >
        <span className="relative">
          <NavIcon name={item.icon} />
          {collapsed && showBadge ? (
            <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{fmtNumber(locale, count)}</span>
          ) : null}
        </span>
        {!collapsed ? <span className="truncate">{label}</span> : null}
        {!collapsed && showBadge ? (
          <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500/90 px-1.5 text-[11px] font-bold text-white">{fmtNumber(locale, count)}</span>
        ) : null}
      </a>
      {!collapsed ? (
        <button
          type="button"
          aria-label={pinned ? t("shell.pinRemove", { label }) : t("shell.pinAdd", { label })}
          title={pinned ? t("shell.pinRemoveTitle") : t("shell.pinAddTitle")}
          onClick={() => onTogglePin(item.href)}
          className={`mr-1 shrink-0 rounded-md p-1 transition ${pinned ? "text-amber-300" : "text-slate-600 opacity-0 hover:text-slate-300 focus:opacity-100 group-hover/row:opacity-100"}`}
        >
          <NavIcon name="star" size={14} filled={pinned} />
        </button>
      ) : null}
    </div>
  );
}

interface NavContentProps {
  collapsed: boolean;
  counts: NavCounts | null;
  favorites: string[];
  recents: string[];
  openGroups: Record<string, boolean>;
  onToggleGroup: (groupId: string) => void;
  onTogglePin: (href: string) => void;
  onNavigate?: () => void;
}

function NavContent({ collapsed, counts, favorites, recents, openGroups, onToggleGroup, onTogglePin, onNavigate }: NavContentProps) {
  const { dict, locale, t } = useAdminLocale();
  const favItems = favorites.map((h) => ALL_NAV_ITEMS.find((i) => i.href === h)).filter((x): x is NavItemDef => !!x);
  const recentItems = recents.map((h) => ALL_NAV_ITEMS.find((i) => i.href === h)).filter((x): x is NavItemDef => !!x);
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4" aria-label={dict.shell.navLabel}>
      {!collapsed && favItems.length === 0 ? (
        <div className="px-3 pb-1 pt-3 text-[11px] leading-relaxed text-slate-400">{dict.shell.noFavorites}</div>
      ) : null}
      {!collapsed && favItems.length > 0 ? (
        <div>
          <div className="anav-group flex items-center gap-1.5"><NavIcon name="star" size={12} /> {dict.shell.favorites}</div>
          {favItems.map((item) => (
            <NavRow key={`fav-${item.href}`} item={item} counts={counts} collapsed={false} pinned onTogglePin={onTogglePin} onNavigate={onNavigate} />
          ))}
        </div>
      ) : null}
      {!collapsed && recentItems.length > 0 ? (
        <div>
          <div className="anav-group flex items-center gap-1.5"><NavIcon name="clock" size={12} /> {dict.shell.recents}</div>
          {recentItems.map((item) => (
            <NavRow key={`recent-${item.href}`} item={item} counts={counts} collapsed={false} pinned={favorites.includes(item.href)} onTogglePin={onTogglePin} onNavigate={onNavigate} />
          ))}
        </div>
      ) : null}
      {NAV_GROUPS.map((group) => {
        const groupTotal = group.items.reduce((sum, i) => sum + (countOf(i, counts) ?? 0), 0);
        const open = !!openGroups[group.id];
        if (collapsed) {
          return (
            <div key={group.id}>
              <div className="mx-2 border-t border-slate-800 pb-1 pt-4 first:border-0" />
              {group.items.map((item) => (
                <NavRow key={item.href} item={item} counts={counts} collapsed pinned={false} onTogglePin={onTogglePin} onNavigate={onNavigate} />
              ))}
            </div>
          );
        }
        return (
          <div key={group.id}>
            <button
              type="button"
              onClick={() => onToggleGroup(group.id)}
              aria-expanded={open}
              className="anav-group flex w-full items-center gap-1.5 rounded-md text-left transition hover:text-slate-300"
            >
              <span className="truncate">{t(group.titleKey)}</span>
              {groupTotal > 0 ? (
                <span className="inline-flex items-center justify-center rounded-full bg-red-500/90 px-1.5 py-0.5 text-[10px] font-bold normal-case tracking-normal text-white">{fmtNumber(locale, groupTotal)}</span>
              ) : null}
              <span className={`ml-auto inline-block transition-transform ${open ? "rotate-90" : ""}`}><NavIcon name="chevron" size={13} /></span>
            </button>
            {open ? group.items.map((item) => (
              <NavRow key={item.href} item={item} counts={counts} collapsed={false} pinned={favorites.includes(item.href)} onTogglePin={onTogglePin} onNavigate={onNavigate} />
            )) : null}
          </div>
        );
      })}
    </nav>
  );
}

// ADX14: density personalization — comfortable (default, the
// v2/v3 look) or compact (denser tables/nav). Persisted in
// localStorage and mirrored to <html data-admin-density> by the
// shell effect; the CSS lives in globals.css (ADX14 section).
// Purely presentational: fresh/blocked storage = comfortable.
type Density = "comfortable" | "compact";
function DensityToggle({ density, onChange, collapsed }: { density: Density; onChange: (d: Density) => void; collapsed: boolean }) {
  const { dict, t } = useAdminLocale();
  const densityName = density === "compact" ? dict.shell.densityCompact : dict.shell.densityComfortable;
  if (collapsed) {
    return (
      <button
        type="button"
        className="anav mb-1 w-full justify-center"
        title={t("shell.densityTitle", { density: densityName })}
        aria-label={dict.shell.densityChange}
        onClick={() => onChange(density === "compact" ? "comfortable" : "compact")}
      >
        <NavIcon name="list" size={16} />
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1 px-2 pb-1.5" role="group" aria-label={dict.shell.densityPick}>
      <span className="text-[11px] text-slate-400">{dict.shell.densityLabel}:</span>
      {(["comfortable", "compact"] as const).map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={density === d}
          className={density === d ? "abtn !px-2 !py-0.5 text-[11px]" : "abtn-secondary !px-2 !py-0.5 text-[11px]"}
          onClick={() => onChange(d)}
        >
          {d === "comfortable" ? dict.shell.densityComfortable : dict.shell.densityCompact}
        </button>
      ))}
    </div>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  const { dict } = useAdminLocale();
  return (
    <div className={`flex items-center gap-3 px-5 pb-2 pt-5 ${collapsed ? "justify-center px-2" : ""}`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-[0_10px_24px_-8px_rgb(99_102_241/0.9)]"><NavIcon name="shield" size={20} /></span>
      {!collapsed ? (
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold tracking-tight">{dict.shell.brandName}</div>
          <div className="text-[11px] text-slate-400">{dict.shell.brandSub}</div>
        </div>
      ) : null}
    </div>
  );
}

export default function AdminShell({ children, title }: { children: React.ReactNode; title: string }) {
  const { dict, locale, t } = useAdminLocale();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [ready, setReady] = React.useState(false);
  const [adminEmail, setAdminEmail] = React.useState("");
  const [q, setQ] = React.useState("");
  const [drawer, setDrawer] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  // ADX3: live counts from GET /admin/nav-counts (null = unknown;
  // badges and the bell render nothing while unknown).
  const counts = useNavCounts();
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  // Ctrl+K / Cmd+K toggles the command palette from anywhere.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const [density, setDensity] = React.useState<Density>("comfortable");
  const [favorites, setFavorites] = React.useState<string[]>([]);
  const [recents, setRecents] = React.useState<string[]>([]);
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    (async () => {
      if (!getAdminToken()) { router.replace("/login"); return; }
      try {
        await apiFetch("/admin/health");
        const me = JSON.parse(localStorage.getItem("admin_user") ?? "{}");
        setAdminEmail(me.email ?? "");
        setCollapsed(localStorage.getItem(LS_KEYS.collapsed) === "1");
        const storedDensity = localStorage.getItem(LS_KEYS.density);
        if (storedDensity === "compact" || storedDensity === "comfortable") setDensity(storedDensity);
        setFavorites(lsGetArray(LS_KEYS.favorites).filter((h) => ALL_NAV_ITEMS.some((i) => i.href === h)));
        setRecents(lsGetArray(LS_KEYS.recent).filter((h) => ALL_NAV_ITEMS.some((i) => i.href === h)).slice(0, 5));
        let storedGroups: Record<string, boolean> = {};
        try { const v = JSON.parse(localStorage.getItem(LS_KEYS.groups) ?? "{}"); if (v && typeof v === "object") storedGroups = v; } catch { /* ignore */ }
        const activeGroup = groupForPath(window.location.pathname)?.id;
        setOpenGroups({ ...storedGroups, ...(activeGroup ? { [activeGroup]: true } : {}) });
        setReady(true);
      } catch {
        setAdminToken(null);
        router.replace("/login");
      }
    })();
  }, [router]);

  // Auto-open the active route's group on navigation (§৭ decision 2:
  // the current page is never hidden inside a folded group) and
  // record the visit in সাম্প্রতিক (max 5, most-recent first).
  React.useEffect(() => {
    if (!ready) return;
    const activeGroup = groupForPath(pathname)?.id;
    if (activeGroup) {
      setOpenGroups((prev) => {
        if (prev[activeGroup]) return prev;
        const next = { ...prev, [activeGroup]: true };
        lsSet(LS_KEYS.groups, next);
        return next;
      });
    }
    const item = navItemForPath(pathname);
    if (item) {
      setRecents((prev) => {
        const next = [item.href, ...prev.filter((h) => h !== item.href)].slice(0, 5);
        if (next.join("|") === prev.join("|")) return prev;
        lsSet(LS_KEYS.recent, next);
        return next;
      });
    }
  }, [pathname, ready]);

  // ADX14: mirror the density onto <html> so the globals.css
  // compact rules apply app-wide (tables, nav) incl. drawers/modals.
  React.useEffect(() => {
    try { document.documentElement.dataset.adminDensity = density; } catch { /* ignore */ }
  }, [density]);

  function changeDensity(d: Density) {
    setDensity(d);
    try { localStorage.setItem(LS_KEYS.density, d); } catch { /* ignore */ }
  }

  function toggleCollapsed() {
    setCollapsed((c) => {
      try { localStorage.setItem(LS_KEYS.collapsed, c ? "0" : "1"); } catch { /* ignore */ }
      return !c;
    });
  }

  function toggleGroup(groupId: string) {
    setOpenGroups((prev) => {
      const next = { ...prev, [groupId]: !prev[groupId] };
      lsSet(LS_KEYS.groups, next);
      return next;
    });
  }

  function togglePin(href: string) {
    setFavorites((prev) => {
      const next = prev.includes(href) ? prev.filter((h) => h !== href) : [...prev, href];
      lsSet(LS_KEYS.favorites, next);
      return next;
    });
  }

  function logout() {
    setAdminToken(null);
    try { localStorage.removeItem("admin_user"); } catch { /* ignore */ }
    router.replace("/login");
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-lg">🛡</span>
          {dict.shell.verifying}
        </div>
      </div>
    );
  }

  const initials = (adminEmail || "A").slice(0, 2).toUpperCase();
  const navProps = { counts, favorites, recents, openGroups, onToggleGroup: toggleGroup, onTogglePin: togglePin };

  // ADNX6: mobile bottom quick bar items — hrefs/icons/countKeys
  // all come from the single nav source (./nav.tsx); the pending
  // badge reuses the shell's existing nav-counts (absent = none).
  const quickItems: { href: string; label: string; icon: NavItemDef["icon"]; countKey?: NavItemDef["countKey"] }[] = [
    { href: "/", label: dict.shell.quickHome, icon: "home" },
    { href: "/payouts", label: dict.shell.quickPayouts, icon: "wallet", countKey: "pendingPayouts" },
    { href: "/tickets", label: dict.shell.quickTickets, icon: "ticket", countKey: "openTickets" },
    { href: "/health", label: dict.shell.quickHealth, icon: "activity", countKey: "failedJobs24h" },
  ];

  return (
    <div className="min-h-screen">
      {/* ADNX6: skip link — first focusable element, jumps past
          the nav to the main landmark. */}
      <a href="#admin-main" className="askip-link">{dict.shell.skipToContent}</a>
      {/* Mobile top bar */}
      <div className="aglass fixed inset-x-0 top-0 z-40 flex items-center gap-3 border-b border-slate-800 px-4 py-3 lg:hidden">
        <button aria-label={dict.shell.openMenu} className="abtn-secondary !px-2.5" onClick={() => setDrawer(true)}>☰</button>
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white"><NavIcon name="shield" size={16} /></span>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{dict.shell.brandName}</div>
          <div className="truncate text-[11px] text-slate-400">{adminEmail}</div>
        </div>
        <button className="abtn-secondary ml-auto !px-2.5" aria-label={dict.shell.logout} onClick={logout}><NavIcon name="logout" size={16} /></button>
      </div>

      {/* Mobile drawer — the exact same NavContent as the desktop sidebar */}
      {drawer ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="aoverlay absolute inset-0 bg-black/70" onClick={() => setDrawer(false)} />
          <aside className="adrawer absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-slate-800 bg-slate-950 shadow-2xl">
            <div className="flex items-start justify-between pr-3">
              <Brand collapsed={false} />
              <button aria-label={dict.shell.closeMenu} className="abtn-secondary mt-4 !px-2.5" onClick={() => setDrawer(false)}>✕</button>
            </div>
            <NavContent collapsed={false} {...navProps} onNavigate={() => setDrawer(false)} />
            <div className="border-t border-slate-800 p-3 text-xs text-slate-400">
              <div className="truncate px-2 pb-1">{adminEmail}</div>
              <DensityToggle density={density} onChange={changeDensity} collapsed={false} />
              <button className="anav w-full" onClick={logout}><NavIcon name="logout" size={16} /> {dict.shell.logout}</button>
            </div>
          </aside>
        </div>
      ) : null}

      <div className="lg:flex">
        {/* Desktop sidebar */}
        <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-800 bg-slate-900/50 lg:flex ${collapsed ? "w-[84px]" : "w-64"}`}>
          <Brand collapsed={collapsed} />
          <NavContent collapsed={collapsed} {...navProps} />
          <div className="border-t border-slate-800 p-3">
            {!collapsed ? <div className="truncate px-2 pb-1.5 text-xs text-slate-400">{adminEmail}</div> : null}
            <DensityToggle density={density} onChange={changeDensity} collapsed={collapsed} />
            <div className={`flex ${collapsed ? "flex-col gap-1" : "items-center gap-1"}`}>
              <button className={`anav flex-1 ${collapsed ? "justify-center" : ""}`} title={dict.shell.collapseSidebar} onClick={toggleCollapsed}>
                <span className={`inline-block ${collapsed ? "" : "rotate-180"}`}><NavIcon name="chevron" size={15} /></span>
                {!collapsed ? <span>{dict.shell.collapse}</span> : null}
              </button>
              <button className={`anav flex-1 ${collapsed ? "justify-center" : ""}`} title={dict.shell.logout} onClick={logout}><NavIcon name="logout" size={16} /> {!collapsed ? <span>{dict.shell.logout}</span> : null}</button>
            </div>
          </div>
        </aside>

        <main id="admin-main" className="ahas-quickbar min-w-0 flex-1 px-4 pb-10 pt-[76px] sm:px-6 lg:p-8">
          <div className="mx-auto w-full max-w-[1440px]">
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <h1 className="text-[22px] font-bold tracking-tight sm:text-2xl">{title}</h1>
              <div className="ml-auto flex flex-wrap items-center gap-2.5">
                <form
                  onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`); }}
                  className="flex gap-2"
                >
                  <input className="ainput w-44 sm:w-64" placeholder={dict.shell.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
                  <button className="abtn-secondary">{dict.shell.searchButton}</button>
                </form>
                <button type="button" onClick={() => setPaletteOpen(true)} className="abtn-secondary hidden items-center gap-2 md:inline-flex" aria-label={dict.shell.paletteOpen}>
                  <NavIcon name="command" size={15} />
                  <span className="text-xs text-slate-400">Ctrl K</span>
                </button>
                <AttentionBell counts={counts} />
                {/* ML3 (MB1): admin language switcher (bn/en). */}
                <AdminLocaleSwitcher />
                <div className="hidden items-center gap-2.5 rounded-full border border-slate-800 bg-slate-900/70 py-1 pl-1 pr-3 md:flex" title={adminEmail}>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-[11px] font-bold">{initials}</span>
                  <span className="max-w-[180px] truncate text-xs text-slate-300">{adminEmail}</span>
                </div>
              </div>
            </div>
            {children}
          </div>
        </main>
      </div>
      {/* ADNX6: mobile bottom quick bar — below lg only (the
          .aquickbar class hides it at lg+), safe-area aware, and
          never on /login because login pages do not render this
          shell at all. "আরও" opens the existing mobile drawer. */}
      <nav className="aquickbar" aria-label={dict.shell.quickNavLabel}>
        {quickItems.map((item) => {
          const count = item.countKey && counts ? counts[item.countKey] : undefined;
          const active = isActivePath(pathname, item.href);
          return (
            <a key={item.href} href={item.href} className={`aquickbar-item ${active ? "aquickbar-active" : ""}`} aria-current={active ? "page" : undefined}>
              <span className="relative">
                <NavIcon name={item.icon} size={20} />
                {typeof count === "number" && count > 0 ? <span className="aquickbar-badge">{fmtNumber(locale, count)}</span> : null}
              </span>
              <span>{item.label}</span>
            </a>
          );
        })}
        <button type="button" className="aquickbar-item" onClick={() => setDrawer(true)} aria-label={dict.shell.quickMoreLabel}>
          <NavIcon name="list" size={20} />
          <span>{dict.shell.quickMore}</span>
        </button>
      </nav>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {/* ADNX3: the single toast + modal-dialog hosts for every page */}
      <ToastHost />
      <DialogHost />
    </div>
  );
}

/**
 * ADNX3: the audit-reason dialog, awaited by callers. Replaces
 * the old synchronous browser-prompt helper — same contract
 * (a ≥3-char reason or null when cancelled; the modal itself
 * blocks a short reason, so no second error step exists).
 * Pages import it from here as before, now with `await`.
 */
export function reasonDialog(action: string): Promise<string | null> {
  return askReason(action).then((v) => (v ? v.trim() : null));
}
