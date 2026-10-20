"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  buildCustomRolePayload, buildCustomRoleUpdatePayload,
  type CustomRole, type CustomRolesResponse, type LoginHistoryRow, type MemberSession, type PresetRoleProfile,
} from "@/lib/gb6-team";
import { useLocale } from "@/lib/i18n/provider";
import type { UiLocale } from "@/lib/i18n/dict";
import { fmtDate, fmtDateTime, fmtNumber } from "@repo/contracts";
import { teamBn } from "@/lib/i18n/team";

interface Member {
  id: string; role: string; status: string; user: { id: string; name: string; email: string };
  // GB6 (GC16): the member's custom role in this org (if any).
  customRoleId?: string | null; customRoleName?: string | null;
}
interface AreaDef { key: string; labelBn: string; label?: string; noteBn: string; minRole: string }
interface Invitation { id: string; email: string; role: string; status: string; expiresAt: string; emailSent: boolean; createdAt: string }
// ORG9/ORG10 (Organization Next OB3): shareable invite links + join-request queue.
interface InviteLink { id: string; role: string; maxUses: number; usedCount: number; expiresAt: string; revokedAt: string | null; status: string; createdAt: string }
interface JoinRequest { id: string; status: string; message: string | null; rejectReason: string | null; createdAt: string; decidedAt: string | null; inviteLinkId: string | null; linkRole: string | null; user: { id: string; name: string; email: string } }
interface SeatUsage { limit: number | null; activeMembers: number; suspendedMembers: number; pendingInvites: number; available: number | null }

const ROLES = ["ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER"];
// Milestone 68: working hours (agent roles only).
const AGENT_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"];
const DAY_DEFS = [
  { key: "sat", labelKey: "tmDaySat" }, { key: "sun", labelKey: "tmDaySun" }, { key: "mon", labelKey: "tmDayMon" },
  { key: "tue", labelKey: "tmDayTue" }, { key: "wed", labelKey: "tmDayWed" }, { key: "thu", labelKey: "tmDayThu" }, { key: "fri", labelKey: "tmDayFri" },
] as const;
type TeamDict = typeof teamBn;
interface ScheduleRow { userId: string; timezone: string; windows: Record<string, [string, string][]>; hasSchedule: boolean; onShift: boolean }
// Milestone 69: activity board + feed shapes.
interface ActivityMember {
  userId: string; name: string; role: string; activityState: string; presenceStatus: string;
  heartbeatAt: string | null; lastActionAt: string | null; onShift: boolean; hasSchedule: boolean;
  today: { repliesSent: number; closedToday: number; auditActions: number; openNow: number };
}
interface FeedRow { id: string; actorName: string; action: string; entityType: string; createdAt: string }
const ACTION_LABEL_KEYS: Record<string, keyof TeamDict> = {
  "org.member_role_updated": "tmActRoleUpdated", "org.member_suspended": "tmActSuspended",
  "org.member_reactivated": "tmActReactivated", "org.member_removed": "tmActRemoved",
  "org.ownership_transferred": "tmActOwnership", "org.member_left": "tmActLeft",
  "org.archived": "tmActArchived", "org.restored": "tmActRestored",
  "org.member_invited": "tmActInvited", "org.member_access_updated": "tmActAccessUpdated", "inbox.agent_schedule_updated": "tmActScheduleUpdated",
  "org.invite_link_created": "tmActLinkCreated", "org.invite_link_revoked": "tmActLinkRevoked",
  "org.join_requested": "tmActJoinRequested", "org.join_request_approved": "tmActJoinApproved", "org.join_request_rejected": "tmActJoinRejected",
  "inbox.agent_schedule_cleared": "tmActScheduleCleared", "inbox.conversation_assigned": "tmActAssigned",
  "integration.messaging.connected": "tmActMessagingConnected", "order.created": "tmActOrderCreated",
};
function agoText(iso: string | null, locale: UiLocale, D: TeamDict, tr: (path: string, params?: Record<string, string | number>) => string): string {
  if (!iso) return "—";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return D.tmJustNow;
  if (mins < 60) return tr("team.tmMinsAgo", { n: fmtNumber(locale, mins) });
  const h = Math.floor(mins / 60);
  if (h < 24) return tr("team.tmHoursAgo", { n: fmtNumber(locale, h) });
  return tr("team.tmDaysAgo", { n: fmtNumber(locale, Math.floor(h / 24)) });
}
const STATE_CHIP: Record<string, { labelKey: keyof TeamDict; cls: string }> = {
  active: { labelKey: "tmStateActive", cls: "bg-emerald-100 text-emerald-700" },
  idle: { labelKey: "tmStateIdle", cls: "bg-amber-100 text-amber-700" },
  away: { labelKey: "tmStateAway", cls: "bg-slate-200 text-slate-600" },
  offline: { labelKey: "tmStateOffline", cls: "bg-slate-100 text-slate-500" },
};

export default function TeamPage() {
  const { dict, t, locale } = useLocale();
  const D = dict.team;
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [usage, setUsage] = useState<SeatUsage | null>(null);
  const [myRole, setMyRole] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [lastLink, setLastLink] = useState("");
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [myUserId, setMyUserId] = useState("");
  const [editingShift, setEditingShift] = useState("");
  // Milestone 72: custom access editor state.
  const [editingAccess, setEditingAccess] = useState("");
  const [accessCatalog, setAccessCatalog] = useState<{ key: string; labelBn: string; label?: string; noteBn: string; minRole: string }[]>([]);
  const [accessDraft, setAccessDraft] = useState<{ grants: string[]; denies: string[] }>({ grants: [], denies: [] });
  const [accessEffective, setAccessEffective] = useState<{ key: string; allowed: boolean; source: string }[]>([]);
  const [activity, setActivity] = useState<ActivityMember[]>([]);
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [shiftTz, setShiftTz] = useState("Asia/Dhaka");
  const [shiftDays, setShiftDays] = useState<Record<string, { on: boolean; start: string; end: string }>>({});
  // GB6 (GC16): custom roles manager + member history/sessions.
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [presetProfiles, setPresetProfiles] = useState<PresetRoleProfile[]>([]);
  const [areaCatalog, setAreaCatalog] = useState<AreaDef[]>([]);
  const [roleName, setRoleName] = useState("");
  const [roleAreas, setRoleAreas] = useState<string[]>([]);
  const [presetKey, setPresetKey] = useState("");
  const [editingRoleId, setEditingRoleId] = useState("");
  const [roleError, setRoleError] = useState("");
  const [historyFor, setHistoryFor] = useState("");
  const [loginHistory, setLoginHistory] = useState<LoginHistoryRow[]>([]);
  const [memberSessions, setMemberSessions] = useState<MemberSession[]>([]);
  const [panelError, setPanelError] = useState("");
  // ORG1/ORG2 (Organization Next OB1): lifecycle — transfer
  // needs the org's exact name for the type-to-confirm step.
  const [orgName, setOrgName] = useState("");
  const [transferTarget, setTransferTarget] = useState("");
  const [transferStep, setTransferStep] = useState(0);
  const [transferConfirmText, setTransferConfirmText] = useState("");
  // ORG9/ORG10: invite links + join-request queue state.
  const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [newJoinLink, setNewJoinLink] = useState("");

  // Milestone 69: the live board refreshes itself every 30s.
  const refreshActivity = useCallback((orgId: string) => {
    apiFetch<{ members: ActivityMember[] }>(`/organizations/${orgId}/inbox/team-activity`)
      .then((r) => setActivity(r.members)).catch(() => undefined);
    apiFetch<FeedRow[]>(`/organizations/${orgId}/members/activity-feed?take=20`)
      .then(setFeed).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError(D.tmNoOrg); return; }
    try {
      const [m, inv, u, orgs] = await Promise.all([
        apiFetch<Member[]>(`/organizations/${orgId}/members`),
        apiFetch<Invitation[]>(`/organizations/${orgId}/members/invitations`).catch(() => [] as Invitation[]),
        apiFetch<SeatUsage>(`/organizations/${orgId}/members/usage`).catch(() => null),
        apiFetch<{ id: string; myRole: string; name: string }[]>(`/organizations`).catch(() => [] as { id: string; myRole: string; name: string }[]),
      ]);
      setMembers(m);
      setInvitations(inv);
      setUsage(u);
      const mine = (orgs as { id: string; myRole: string; name: string }[]).find((o) => o.id === orgId);
      if (mine) { setMyRole(mine.myRole); setOrgName(mine.name ?? ""); }
      // GB6 (GC16): custom roles + preset profiles + the real area catalog.
      apiFetch<CustomRolesResponse>(`/organizations/${orgId}/custom-roles`)
        .then((r) => { setCustomRoles(r.roles ?? []); setPresetProfiles(r.presetProfiles ?? []); })
        .catch(() => { setCustomRoles([]); setPresetProfiles([]); });
      // ORG9/ORG10: invite links + join-request queue (OWNER/ADMIN
      // endpoints — a non-admin caller simply gets empty lists).
      apiFetch<InviteLink[]>(`/organizations/${orgId}/invite-links`).then(setInviteLinks).catch(() => setInviteLinks([]));
      apiFetch<JoinRequest[]>(`/organizations/${orgId}/join-requests`).then(setJoinRequests).catch(() => setJoinRequests([]));
      apiFetch<AreaDef[]>(`/organizations/${orgId}/access-catalog`).then(setAreaCatalog).catch(() => setAreaCatalog([]));
      apiFetch<ScheduleRow[]>(`/organizations/${orgId}/inbox/agent-schedules`).then(setSchedules).catch(() => setSchedules([]));
      apiFetch<{ id: string }>("/auth/me").then((me) => setMyUserId(me.id)).catch(() => undefined);
      refreshActivity(orgId);
    } catch (e) {
      setError(e instanceof Error ? e.message : D.tmLoadFailed);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { const orgId = getOrganizationId(); if (orgId) refreshActivity(orgId); }, 30_000);
    return () => clearInterval(t);
  }, [refreshActivity]);

  async function wrap(key: string, fn: () => Promise<void>) {
    setBusy(key); setError(""); setNotice("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : D.tmActionFailed); } finally { setBusy(""); }
  }

  async function directInvite() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const email = (document.getElementById("direct-email") as HTMLInputElement).value;
    const role = (document.getElementById("direct-role") as HTMLSelectElement).value;
    await wrap("direct", async () => {
      await apiFetch(`/organizations/${orgId}/members/invite`, { method: "POST", body: JSON.stringify({ email, role }) });
      setNotice(D.tmMemberAdded);
      await load();
    });
  }

  async function emailInvite() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const email = (document.getElementById("inv-email") as HTMLInputElement).value;
    const role = (document.getElementById("inv-role") as HTMLSelectElement).value;
    await wrap("email-invite", async () => {
      const out = await apiFetch<{ inviteUrl: string; emailSent: boolean }>(`/organizations/${orgId}/members/email-invite`, {
        method: "POST", body: JSON.stringify({ email, role }),
      });
      setLastLink(out.inviteUrl);
      setNotice(out.emailSent ? D.tmInviteEmailSent : D.tmInviteNoEmail);
      await load();
    });
  }

  const canManage = myRole === "OWNER" || myRole === "ADMIN";

  async function changeRole(m: Member, role: string) {
    const orgId = getOrganizationId(); if (!orgId || role === m.role) return;
    await wrap(`role-${m.user.id}`, async () => {
      await apiFetch(`/organizations/${orgId}/members/${m.user.id}/role`, { method: "PATCH", body: JSON.stringify({ role }) });
      setNotice(t("team.tmRoleNow", { name: m.user.name, role }));
      await load();
    });
  }

  async function setStatus(m: Member, status: "SUSPENDED" | "ACTIVE") {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap(`status-${m.user.id}`, async () => {
      const out = await apiFetch<{ handedOver: number }>(`/organizations/${orgId}/members/${m.user.id}/status`, {
        method: "PATCH", body: JSON.stringify({ status }),
      });
      setNotice(status === "SUSPENDED"
        ? t("team.tmSuspendedNotice", { name: m.user.name, count: fmtNumber(locale, out.handedOver) })
        : t("team.tmReactivatedNotice", { name: m.user.name }));
      await load();
    });
  }

  async function removeMember(m: Member) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(t("team.tmRemoveConfirm", { name: m.user.name }))) return;
    await wrap(`remove-${m.user.id}`, async () => {
      const out = await apiFetch<{ handedOver: number }>(`/organizations/${orgId}/members/${m.user.id}`, { method: "DELETE" });
      setNotice(t("team.tmRemovedNotice", { name: m.user.name, count: fmtNumber(locale, out.handedOver) }));
      await load();
    });
  }

  // ORG1: ownership transfer — two steps; the second requires
  // typing the organization's exact name (the server re-checks
  // everything; this is the fat-finger guard). Immediate: the
  // chosen ADMIN becomes OWNER and I stay on as ADMIN.
  const transferCandidates = members.filter((m) => m.role === "ADMIN" && m.status === "ACTIVE" && m.user.id !== myUserId);
  async function doTransfer() {
    const orgId = getOrganizationId(); if (!orgId || !transferTarget) return;
    const target = members.find((m) => m.user.id === transferTarget);
    await wrap("transfer", async () => {
      await apiFetch(`/organizations/${orgId}/transfer-ownership`, {
        method: "POST", body: JSON.stringify({ targetUserId: transferTarget }),
      });
      setTransferStep(0); setTransferTarget(""); setTransferConfirmText("");
      setNotice(t("team.tmTransferredNotice", { name: target?.user.name ?? "" }));
      await load();
    });
  }

  // ORG2: self-leave. Afterwards the org disappears from my
  // switcher; the app flow moves me to another of my orgs, or
  // to onboarding when none remain.
  async function doLeave() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(t("team.tmLeaveConfirm", { org: orgName || D.tmThisOrg }))) return;
    await wrap("leave", async () => {
      await apiFetch(`/organizations/${orgId}/leave`, { method: "POST" });
      const remaining = await apiFetch<{ id: string }[]>(`/organizations`).catch(() => [] as { id: string }[]);
      if (remaining.length > 0) {
        localStorage.setItem("organizationId", remaining[0].id);
        window.location.href = "/dashboard";
      } else {
        localStorage.removeItem("organizationId");
        window.location.href = "/onboarding";
      }
    });
  }

  const scheduleOf = (userId: string) => schedules.find((s) => s.userId === userId);
  const canEditShift = (m: Member) =>
    AGENT_ROLES.includes(m.role) && (["OWNER", "ADMIN", "MARKETING_MANAGER"].includes(myRole) || m.user.id === myUserId);

  function openShiftEditor(m: Member) {
    const s = scheduleOf(m.user.id);
    const days: Record<string, { on: boolean; start: string; end: string }> = {};
    for (const d of DAY_DEFS) {
      const w = s?.windows?.[d.key]?.[0];
      days[d.key] = w ? { on: true, start: w[0], end: w[1] } : { on: false, start: "09:00", end: "18:00" };
    }
    setShiftDays(days);
    setShiftTz(s?.timezone ?? "Asia/Dhaka");
    setEditingShift(m.user.id);
  }

  async function saveShift(m: Member) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const windows: Record<string, [string, string][]> = {};
    for (const d of DAY_DEFS) {
      const day = shiftDays[d.key];
      if (day?.on) windows[d.key] = [[day.start, day.end]];
    }
    await wrap(`shift-${m.user.id}`, async () => {
      await apiFetch(`/organizations/${orgId}/inbox/agent-schedules/${m.user.id}`, {
        method: "PUT", body: JSON.stringify({ timezone: shiftTz, windows }),
      });
      setNotice(t("team.tmShiftSaved", { name: m.user.name }));
      setEditingShift("");
      await load();
    });
  }

  async function clearShift(m: Member) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap(`shift-clear-${m.user.id}`, async () => {
      await apiFetch(`/organizations/${orgId}/inbox/agent-schedules/${m.user.id}`, { method: "DELETE" });
      setNotice(t("team.tmShiftCleared", { name: m.user.name }));
      setEditingShift("");
      await load();
    });
  }

  // Milestone 72: custom access editor.
  async function openAccessEditor(m: Member) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setEditingAccess(m.user.id);
    try {
      if (!accessCatalog.length) setAccessCatalog(await apiFetch(`/organizations/${orgId}/access-catalog`));
      const data: any = await apiFetch(`/organizations/${orgId}/members/${m.user.id}/access`);
      setAccessDraft({ grants: data.overrides?.grants ?? [], denies: data.overrides?.denies ?? [] });
      setAccessEffective(data.effective ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : D.tmAccessLoadFailed); }
  }

  function setAccessMode(key: string, mode: "role" | "grant" | "deny") {
    setAccessDraft((d) => {
      const grants = d.grants.filter((k) => k !== key);
      const denies = d.denies.filter((k) => k !== key);
      if (mode === "grant") grants.push(key);
      if (mode === "deny") denies.push(key);
      return { grants, denies };
    });
  }

  async function saveAccess(m: Member) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap(`access-${m.user.id}`, async () => {
      const data: any = await apiFetch(`/organizations/${orgId}/members/${m.user.id}/access`, {
        method: "PATCH", body: JSON.stringify(accessDraft),
      });
      setAccessEffective(data.effective ?? []);
      setNotice(t("team.tmAccessSaved", { name: m.user.name }));
    });
  }

  async function resetTotp(userId: string, name: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap(`totp-${userId}`, async () => {
      await apiFetch(`/organizations/${orgId}/members/${userId}/totp-reset`, { method: "POST" });
      setNotice(t("team.tmTotpReset", { name }));
    });
  }

  // ---- GB6 (GC16): custom roles ----
  async function reloadCustomRoles(orgId: string) {
    const r = await apiFetch<CustomRolesResponse>(`/organizations/${orgId}/custom-roles`);
    setCustomRoles(r.roles ?? []); setPresetProfiles(r.presetProfiles ?? []);
  }

  async function createCustomRoleFromPreset() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const { payload, errors } = buildCustomRolePayload({ mode: "preset", presetKey });
    if (!payload) { setRoleError(errors.join(" ")); return; }
    setBusy("role-preset"); setRoleError(""); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/custom-roles`, { method: "POST", body: JSON.stringify(payload) });
      setNotice(D.tmPresetRoleCreated);
      setPresetKey("");
      await reloadCustomRoles(orgId);
    } catch (e) { setRoleError(e instanceof Error ? e.message : D.tmRoleCreateFailed); }
    finally { setBusy(""); }
  }

  async function saveCustomRole() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const built = editingRoleId
      ? buildCustomRoleUpdatePayload(roleName, roleAreas)
      : buildCustomRolePayload({ mode: "scratch", name: roleName, areas: roleAreas });
    if (!built.payload) { setRoleError(built.errors.join(" ")); return; }
    setBusy("role-save"); setRoleError(""); setError(""); setNotice("");
    try {
      if (editingRoleId) {
        await apiFetch(`/organizations/${orgId}/custom-roles/${editingRoleId}`, { method: "PATCH", body: JSON.stringify(built.payload) });
        setNotice(D.tmRoleUpdated);
      } else {
        await apiFetch(`/organizations/${orgId}/custom-roles`, { method: "POST", body: JSON.stringify(built.payload) });
        setNotice(D.tmRoleCreated);
      }
      setEditingRoleId(""); setRoleName(""); setRoleAreas([]);
      await reloadCustomRoles(orgId);
      await load();
    } catch (e) { setRoleError(e instanceof Error ? e.message : D.tmRoleSaveFailed); }
    finally { setBusy(""); }
  }

  async function deleteCustomRole(r: CustomRole) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(t("team.tmRoleDeleteConfirm", { name: r.name }))) return;
    setBusy(`role-del-${r.id}`); setRoleError(""); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/custom-roles/${r.id}`, { method: "DELETE" });
      setNotice(D.tmRoleDeleted);
      if (editingRoleId === r.id) { setEditingRoleId(""); setRoleName(""); setRoleAreas([]); }
      await reloadCustomRoles(orgId);
    } catch (e) {
      // Server refuses while the role is still assigned — show its message verbatim.
      setRoleError(e instanceof Error ? e.message : D.tmRoleDeleteFailed);
    } finally { setBusy(""); }
  }

  async function assignCustomRole(m: Member, customRoleId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap(`custom-role-${m.user.id}`, async () => {
      await apiFetch(`/organizations/${orgId}/members/${m.user.id}/custom-role`, {
        method: "PATCH", body: JSON.stringify({ customRoleId: customRoleId || null }),
      });
      setNotice(customRoleId
        ? t("team.tmCustomRoleSet", { name: m.user.name, role: customRoles.find((r) => r.id === customRoleId)?.name ?? "" })
        : t("team.tmCustomRoleRemoved", { name: m.user.name }));
      await load();
    });
  }

  // ---- GB6 (GC16): member login history + sessions ----
  // Both are USER-global (all organizations), not per-org slices
  // — the panel labels say so.
  async function openHistoryPanel(m: Member) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (historyFor === m.user.id) { setHistoryFor(""); return; }
    setHistoryFor(m.user.id); setPanelError(""); setLoginHistory([]); setMemberSessions([]);
    try {
      const [h, s] = await Promise.all([
        apiFetch<LoginHistoryRow[]>(`/organizations/${orgId}/members/${m.user.id}/login-history`),
        apiFetch<MemberSession[]>(`/organizations/${orgId}/members/${m.user.id}/sessions`),
      ]);
      setLoginHistory(h); setMemberSessions(s);
    } catch (e) { setPanelError(e instanceof Error ? e.message : D.tmHistoryLoadFailed); }
  }

  async function reloadMemberSessions(userId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setMemberSessions(await apiFetch<MemberSession[]>(`/organizations/${orgId}/members/${userId}/sessions`));
  }

  async function revokeMemberSession(m: Member, sessionId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap(`msession-${sessionId}`, async () => {
      await apiFetch(`/organizations/${orgId}/members/${m.user.id}/sessions/${sessionId}`, { method: "DELETE" });
      setNotice(t("team.tmSessionRevoked", { name: m.user.name }));
      await reloadMemberSessions(m.user.id);
    });
  }

  async function revokeAllMemberSessions(m: Member) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(t("team.tmRevokeAllConfirm", { name: m.user.name }))) return;
    await wrap(`msessions-all-${m.user.id}`, async () => {
      // Server field is `revokedCount` (verified in organizations.service.ts).
      const out = await apiFetch<{ revokedCount: number }>(`/organizations/${orgId}/members/${m.user.id}/sessions/revoke-all`, { method: "POST" });
      setNotice(t("team.tmSessionsRevoked", { name: m.user.name, count: fmtNumber(locale, out.revokedCount) }));
      await reloadMemberSessions(m.user.id);
    });
  }

  async function revoke(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap(`revoke-${id}`, async () => {
      await apiFetch(`/organizations/${orgId}/members/invitations/${id}`, { method: "DELETE" });
      setNotice(D.tmInviteRevoked);
      await load();
    });
  }

  async function resend(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap(`resend-${id}`, async () => {
      const out = await apiFetch<{ inviteUrl: string; emailSent: boolean }>(`/organizations/${orgId}/members/invitations/${id}/resend`, { method: "POST" });
      setLastLink(out.inviteUrl);
      setNotice(out.emailSent ? D.tmResentEmail : D.tmResentNoEmail);
      await load();
    });
  }

  // ORG9: shareable invite links — the raw URL is shown ONCE
  // (the server stores only its hash), so keep it in state until
  // the admin copies it away.
  async function createLink() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const role = (document.getElementById("link-role") as HTMLSelectElement).value;
    const maxUses = Number((document.getElementById("link-max") as HTMLInputElement).value) || 10;
    const expiresInDays = Number((document.getElementById("link-days") as HTMLSelectElement).value) || 7;
    await wrap("link-create", async () => {
      const out = await apiFetch<{ inviteUrl: string }>(`/organizations/${orgId}/invite-links`, {
        method: "POST", body: JSON.stringify({ role, maxUses, expiresInDays }),
      });
      setNewJoinLink(out.inviteUrl);
      setNotice(D.tmLinkCreated);
      await load();
    });
  }

  async function copyJoinLink() {
    try {
      await navigator.clipboard.writeText(newJoinLink);
      setNotice(D.tmLinkCopied);
    } catch {
      setError(D.tmCopyFailed);
    }
  }

  async function revokeLink(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(D.tmLinkRevokeConfirm)) return;
    await wrap(`link-revoke-${id}`, async () => {
      await apiFetch(`/organizations/${orgId}/invite-links/${id}`, { method: "DELETE" });
      setNotice(D.tmLinkRevoked);
      await load();
    });
  }

  // ORG10: queue decisions. Approve takes the role from the
  // row's select (defaulting to the link's role); the seat guard
  // runs on the server at this exact moment.
  async function approveRequest(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const role = (document.getElementById(`jr-role-${id}`) as HTMLSelectElement | null)?.value;
    await wrap(`jr-approve-${id}`, async () => {
      const out = await apiFetch<{ alreadyMember: boolean; role: string }>(`/organizations/${orgId}/join-requests/${id}/approve`, {
        method: "POST", body: JSON.stringify(role ? { role } : {}),
      });
      setNotice(out.alreadyMember ? D.tmAlreadyMember : t("team.tmApprovedNotice", { role: out.role }));
      await load();
    });
  }

  async function rejectRequest(id: string, name: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const reason = window.prompt(t("team.tmRejectPrompt", { name }), "");
    if (reason === null) return;
    await wrap(`jr-reject-${id}`, async () => {
      await apiFetch(`/organizations/${orgId}/join-requests/${id}/reject`, {
        method: "POST", body: JSON.stringify(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setNotice(D.tmRejectedNotice);
      await load();
    });
  }

  return (
    <div className="space-y-4">
      <h1 className="page-title">Team Settings</h1>
      <div>
        <a href="/dashboard/team/performance" className="btn-secondary">{D.tmPerfLink}</a>
      </div>
      {error ? <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {notice ? <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div> : null}

      {usage ? (
        <div className="card flex flex-wrap items-center gap-x-8 gap-y-2 p-5 text-sm">
          <div><span className="text-2xl font-bold">{fmtNumber(locale, usage.activeMembers)}</span> <span className="text-slate-500">{D.tmActiveMembers}</span></div>
          <div>{D.tmSeatLimit}<strong>{usage.limit === null ? D.tmUnlimited : t("team.tmCountSuffix", { count: fmtNumber(locale, usage.limit) })}</strong></div>
          <div>{D.tmPendingInvites}<strong>{fmtNumber(locale, usage.pendingInvites)}</strong></div>
          {usage.suspendedMembers > 0 ? <div>{D.tmSuspendedLabel}<strong>{fmtNumber(locale, usage.suspendedMembers)}</strong></div> : null}
          {usage.available !== null ? (
            <div className={usage.available === 0 ? "font-semibold text-red-600" : "text-slate-600"}>
              {usage.available === 0 ? D.tmNoSeats : t("team.tmSeatsLeft", { count: fmtNumber(locale, usage.available ?? 0) })}
            </div>
          ) : null}
        </div>
      ) : null}

      {activity.length ? (
        <div className="card p-5">
          <h2 className="mb-1 font-semibold">{D.tmBoardTitle}</h2>
          <p className="mb-3 text-xs text-slate-400">{D.tmBoardRule}</p>
          {canManage ? (
            <div className="mb-3">
              <button className="btn-secondary" disabled={busy === "rebalance"} onClick={async () => {
                const orgId = getOrganizationId(); if (!orgId) return;
                await wrap("rebalance", async () => {
                  const plan: any = await apiFetch(`/organizations/${orgId}/inbox/rebalance`, { method: "POST", body: JSON.stringify({ dryRun: true }) });
                  if (!plan.movedCount) { setNotice(D.tmNoRebalanceNeeded); return; }
                  const names = new Map(members.map((x) => [x.user.id, x.user.name]));
                  const lines = plan.moves.slice(0, 8).map((mv: any) => `• ${names.get(mv.fromUserId) ?? mv.fromUserId} → ${names.get(mv.toUserId) ?? mv.toUserId}`).join("\n");
                  if (!window.confirm(t("team.tmRebalanceConfirm", { count: fmtNumber(locale, plan.movedCount), lines, more: plan.moves.length > 8 ? "\n…" : "" }))) return;
                  const done: any = await apiFetch(`/organizations/${orgId}/inbox/rebalance`, { method: "POST", body: JSON.stringify({ dryRun: false }) });
                  setNotice(t("team.tmRebalanceDone", { count: fmtNumber(locale, done.movedCount) }));
                  refreshActivity(orgId);
                });
              }}>{D.tmRebalanceBtn}</button>
              <span className="ml-2 text-xs text-slate-400">{D.tmRebalanceNote}</span>
            </div>
          ) : null}
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500"><th className="py-2">{dict.common.member}</th><th>{D.tmColStatus}</th><th>{D.tmColLastAction}</th><th>{D.tmColToday}</th><th>{D.tmColOpenNow}</th></tr></thead>
            <tbody>
              {activity.map((a) => {
                const chip = STATE_CHIP[a.activityState] ?? STATE_CHIP.offline;
                return (
                  <tr key={a.userId} className="border-t">
                    <td className="py-2">{a.name} <span className="text-xs text-slate-400">({a.role})</span></td>
                    <td>
                      <span className={`rounded px-1.5 py-0.5 text-xs ${chip.cls}`}>{D[chip.labelKey]}</span>
                      {a.hasSchedule && !a.onShift ? <span className="ml-1 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{D.tmOffShift}</span> : null}
                    </td>
                    <td>{agoText(a.lastActionAt ?? a.heartbeatAt, locale, D, t)}</td>
                    <td className="text-slate-600">{t("team.tmTodayLine", { replies: fmtNumber(locale, a.today.repliesSent), closed: fmtNumber(locale, a.today.closedToday), other: fmtNumber(locale, a.today.auditActions) })}</td>
                    <td>{t("team.tmCountSuffix", { count: fmtNumber(locale, a.today.openNow) })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="card p-5">
        <h2 className="mb-3 font-semibold">{t("team.tmMembersTitle", { count: fmtNumber(locale, members.length) })}</h2>
        <p className="mb-3 text-xs text-slate-400">{D.tmMembersNote}</p>
        {members.length === 0 ? <p className="text-sm text-slate-500">{D.tmNoMembers}</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500"><th className="py-2">{D.tmColName}</th><th>{D.tmColEmail}</th><th>{D.tmColRole}</th><th>{D.tmColStatus}</th><th></th></tr></thead>
            <tbody>
              {members.map((m) => (
                <React.Fragment key={m.id}>
                <tr className="border-t">
                  <td className="py-2">{m.user.name}</td><td>{m.user.email}</td>
                  <td>
                    {canManage && m.role !== "OWNER" ? (
                      <select className="input w-44" value={m.role} disabled={busy === `role-${m.user.id}`}
                        onChange={(e) => changeRole(m, e.target.value)}>
                        {["OWNER", ...ROLES].filter((r) => r === m.role || r !== "OWNER").map((r) => (
                          <option key={r} value={r} disabled={r === "OWNER"}>{r}</option>
                        ))}
                      </select>
                    ) : m.role}
                    {/* GB6 (GC16): custom-role assignment alongside the
                        base preset role. Both stay visible: the base
                        role governs role-list surfaces, the custom
                        role's areas govern area-checked surfaces. */}
                    {m.role !== "OWNER" ? (
                      <div className="mt-1.5">
                        <select className="input w-44" value={m.customRoleId ?? ""} disabled={!canManage || busy === `custom-role-${m.user.id}`}
                          onChange={(e) => assignCustomRole(m, e.target.value)} aria-label={D.tmAriaCustomRole}>
                          <option value="">{D.tmNoCustomRole}</option>
                          {customRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                        <span className="block text-[11px] text-slate-400">{D.tmCustomRoleCaption}{!canManage ? D.tmCustomRoleNeedsAdmin : ""}</span>
                      </div>
                    ) : <span className="block text-[11px] text-slate-400">{D.tmOwnerNoCustomRole}</span>}
                  </td>
                  <td>{m.status === "SUSPENDED" ? <span className="font-semibold text-red-600">{D.tmSuspendedStatus}</span> : m.status}
                    {scheduleOf(m.user.id)?.hasSchedule ? (
                      <span className={scheduleOf(m.user.id)?.onShift ? "ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700" : "ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600"}>
                        {scheduleOf(m.user.id)?.onShift ? D.tmOnShift : D.tmOffShift}
                      </span>
                    ) : null}
                  </td>
                  <td className="space-x-2 whitespace-nowrap text-right">
                    {canManage && m.role !== "OWNER" ? (
                      m.status === "SUSPENDED" ? (
                        <button className="btn-secondary" disabled={busy === `status-${m.user.id}`} onClick={() => setStatus(m, "ACTIVE")}>{D.tmReactivate}</button>
                      ) : (
                        <button className="btn-secondary" disabled={busy === `status-${m.user.id}`} onClick={() => setStatus(m, "SUSPENDED")}>{D.tmSuspend}</button>
                      )
                    ) : null}
                    {myRole === "OWNER" && m.role !== "OWNER" ? (
                      <button className="btn-secondary" disabled={busy === `remove-${m.user.id}`} onClick={() => removeMember(m)}>{D.tmRemoveBtn}</button>
                    ) : null}
                    {canEditShift(m) ? (
                      <button className="btn-secondary" onClick={() => (editingShift === m.user.id ? setEditingShift("") : openShiftEditor(m))}>{D.tmShiftBtn}</button>
                    ) : null}
                    {canManage && m.role !== "OWNER" ? (
                      <button className="btn-secondary" onClick={() => (editingAccess === m.user.id ? setEditingAccess("") : openAccessEditor(m))}>{D.tmAccessBtn}</button>
                    ) : null}
                    {canManage ? (
                      <button className="btn-secondary" onClick={() => openHistoryPanel(m)}>{D.tmHistoryBtn}</button>
                    ) : null}
                    <button className="btn-secondary" disabled={busy === `totp-${m.user.id}`} onClick={() => resetTotp(m.user.id, m.user.name)}>{D.tmTotpResetBtn}</button>
                  </td>
                </tr>
                {editingShift === m.user.id ? (
                  <tr className="border-t bg-slate-50">
                    <td colSpan={5} className="p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                        <strong>{t("team.tmShiftTitle", { name: m.user.name })}</strong>
                        <span className="text-slate-500">Timezone:</span>
                        <input className="input w-44" value={shiftTz} onChange={(e) => setShiftTz(e.target.value)} placeholder="Asia/Dhaka" />
                        <span className="text-xs text-slate-400">{D.tmShiftNote}</span>
                      </div>
                      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                        {DAY_DEFS.map((d) => {
                          const day = shiftDays[d.key] ?? { on: false, start: "09:00", end: "18:00" };
                          return (
                            <label key={d.key} className="flex items-center gap-2 rounded bg-white px-2 py-1.5 text-sm">
                              <input type="checkbox" checked={day.on}
                                onChange={(e) => setShiftDays({ ...shiftDays, [d.key]: { ...day, on: e.target.checked } })} />
                              <span className="w-20">{D[d.labelKey]}</span>
                              <input type="time" className="input w-28" value={day.start} disabled={!day.on}
                                onChange={(e) => setShiftDays({ ...shiftDays, [d.key]: { ...day, start: e.target.value } })} />
                              <span>–</span>
                              <input type="time" className="input w-28" value={day.end} disabled={!day.on}
                                onChange={(e) => setShiftDays({ ...shiftDays, [d.key]: { ...day, end: e.target.value } })} />
                            </label>
                          );
                        })}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button className="btn-primary" disabled={busy === `shift-${m.user.id}`} onClick={() => saveShift(m)}>{D.tmSaveShift}</button>
                        <button className="btn-secondary" onClick={() => setEditingShift("")}>{D.tmCloseShort}</button>
                        {scheduleOf(m.user.id)?.hasSchedule ? (
                          <button className="btn-secondary" disabled={busy === `shift-clear-${m.user.id}`} onClick={() => clearShift(m)}>{D.tmClearSchedule}</button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
                {editingAccess === m.user.id ? (
                  <tr className="border-t bg-indigo-50/50">
                    <td colSpan={5} className="p-3">
                      <div className="mb-2 text-sm">
                        <strong>{t("team.tmAccessTitle", { name: m.user.name })}</strong>
                        <span className="ml-2 text-xs text-slate-500">{t("team.tmAccessNote", { role: m.role })}</span>
                      </div>
                      <div className="grid gap-1.5 lg:grid-cols-2">
                        {accessCatalog.map((a) => {
                          const mode = accessDraft.denies.includes(a.key) ? "deny" : accessDraft.grants.includes(a.key) ? "grant" : "role";
                          const eff = accessEffective.find((e) => e.key === a.key);
                          return (
                            <div key={a.key} className="flex flex-wrap items-center gap-2 rounded bg-white px-2 py-1.5 text-sm">
                              <span className="min-w-32 flex-1">
                                <span className="font-medium">{locale === "en" ? (a.label ?? a.labelBn) : a.labelBn}</span>
                                <span className="block text-[11px] text-slate-400">{a.noteBn}{t("team.tmRoleBase", { minRole: a.minRole })}</span>
                              </span>
                              {eff ? (
                                <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${eff.allowed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                                  {eff.allowed ? D.tmAllowed : D.tmDenied}{eff.source === "grant" ? " (Grant)" : eff.source === "deny" ? " (Deny)" : eff.source === "role" ? " (Role)" : ""}
                                </span>
                              ) : null}
                              <span className="flex overflow-hidden rounded-lg ring-1 ring-slate-200">
                                {([["role", D.tmModeRole], ["grant", D.tmModeGrant], ["deny", D.tmModeDeny]] as const).map(([v, label]) => (
                                  <button key={v} className={`px-2 py-1 text-xs font-medium ${mode === v ? (v === "deny" ? "bg-red-600 text-white" : v === "grant" ? "bg-emerald-600 text-white" : "bg-slate-900 text-white") : "bg-white text-slate-600"}`}
                                    onClick={() => setAccessMode(a.key, v)}>{label}</button>
                                ))}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button className="btn-primary" disabled={busy === `access-${m.user.id}`} onClick={() => saveAccess(m)}>{D.tmSaveAccess}</button>
                        <button className="btn-secondary" onClick={() => setEditingAccess("")}>{D.tmCloseShort}</button>
                        <span className="self-center text-xs text-slate-400">{D.tmAccessFailedNote}</span>
                      </div>
                    </td>
                  </tr>
                ) : null}
                {historyFor === m.user.id ? (
                  <tr className="border-t bg-slate-50">
                    <td colSpan={5} className="p-3">
                      <div className="mb-2 text-sm">
                        <strong>{t("team.tmHistoryTitle", { name: m.user.name })}</strong>
                        <span className="ml-2 text-xs text-amber-700">{D.tmHistoryNote}</span>
                      </div>
                      {panelError ? <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{panelError}</p> : null}
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div>
                          <h3 className="mb-1 text-sm font-semibold">{t("team.tmSessionsTitle", { count: fmtNumber(locale, memberSessions.length) })}</h3>
                          {memberSessions.length === 0 ? <p className="text-sm text-slate-400">{D.tmNoSessions}</p> : memberSessions.map((s) => (
                            <div key={s.id} className="mb-1.5 flex flex-wrap items-center justify-between gap-2 rounded bg-white px-2 py-1.5 text-sm">
                              <span>
                                <span className="font-medium">{s.ip ?? D.tmIpUnknown}</span>
                                <span className="block max-w-md truncate text-[11px] text-slate-400" title={s.userAgent ?? ""}>{s.userAgent ?? D.tmDeviceUnknown}</span>
                                <span className="block text-[11px] text-slate-400">{t("team.tmSessionTimes", { start: fmtDateTime(locale, s.createdAt), seen: fmtDateTime(locale, s.lastSeenAt) })}</span>
                              </span>
                              <button className="btn-secondary btn-sm text-red-600" disabled={busy === `msession-${s.id}`} onClick={() => revokeMemberSession(m, s.id)}>{D.tmRevokeSession}</button>
                            </div>
                          ))}
                          {memberSessions.length > 0 ? (
                            <button className="btn-secondary btn-sm text-red-600" disabled={busy === `msessions-all-${m.user.id}`} onClick={() => revokeAllMemberSessions(m)}>{D.tmRevokeAllSessions}</button>
                          ) : null}
                        </div>
                        <div>
                          <h3 className="mb-1 text-sm font-semibold">{t("team.tmLoginAttempts", { count: fmtNumber(locale, 50) })}</h3>
                          {loginHistory.length === 0 ? <p className="text-sm text-slate-400">{D.tmNoLoginHistory}</p> : (
                            <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
                              {loginHistory.map((h, i) => (
                                <li key={h.id ?? i} className="flex flex-wrap items-center gap-2 rounded bg-white px-2 py-1.5">
                                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${h.success ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>{h.success ? D.tmSuccess : D.tmFailedAttempt}</span>
                                  <span className="text-slate-600">{h.ip ?? D.tmIpUnknown}</span>
                                  <span className="max-w-40 truncate text-[11px] text-slate-400" title={h.userAgent ?? ""}>{h.userAgent ?? ""}</span>
                                  <span className="text-[11px] text-slate-400">{fmtDateTime(locale, h.createdAt)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                      <button className="btn-secondary btn-sm mt-3" onClick={() => setHistoryFor("")}>{dict.common.close}</button>
                    </td>
                  </tr>
                ) : null}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
        {canManage ? null : <p className="mt-2 text-xs text-slate-400">{D.tmManageNote}</p>}
      </div>

      {/* GB6 (GC16): custom roles manager */}
      <div className="card p-5">
        <h2 className="mb-1 font-semibold">{D.tmCustomRolesTitle}</h2>
        <p className="mb-3 text-xs text-slate-400">{D.tmCustomRolesNote}</p>
        {roleError ? <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{roleError}</div> : null}
        {customRoles.length === 0 ? <p className="mb-3 text-sm text-slate-500">{D.tmNoCustomRoles}</p> : (
          <div className="mb-4 space-y-2">
            {customRoles.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{r.name}</span>
                  {r.presetKey ? <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">{D.tmPresetPrefix}{r.presetKey}</span> : null}
                  <span className="ml-2 text-xs text-slate-500">{t("team.tmMemberCountSuffix", { count: fmtNumber(locale, r.memberCount) })}</span>
                  <span className="block text-xs text-slate-400">
                    {r.areas.map((a) => { const c = areaCatalog.find((x) => x.key === a); return c ? (locale === "en" ? (c.label ?? c.labelBn) : c.labelBn) : a; }).join(", ") || D.tmNoAreas}
                  </span>
                </span>
                {canManage ? (
                  <span className="flex gap-2">
                    <button className="btn-secondary btn-sm" onClick={() => { setEditingRoleId(r.id); setRoleName(r.name); setRoleAreas([...r.areas]); setRoleError(""); }}>{D.tmEdit}</button>
                    <button className="btn-secondary btn-sm text-red-600" disabled={busy === `role-del-${r.id}`} onClick={() => deleteCustomRole(r)}>{D.tmDelete}</button>
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {canManage ? (
          <div className="grid gap-4 border-t pt-4 lg:grid-cols-2">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{editingRoleId ? D.tmEditRole : D.tmNewRoleScratch}</h3>
              <input className="input w-full" placeholder={t("team.tmRoleNamePh", { min: fmtNumber(locale, 1), max: fmtNumber(locale, 60) })} value={roleName} onChange={(e) => setRoleName(e.target.value)} maxLength={70} />
              <div className="grid gap-1 sm:grid-cols-2">
                {(areaCatalog.length ? areaCatalog : []).map((a) => (
                  <label key={a.key} className="flex items-start gap-2 rounded bg-slate-50 px-2 py-1.5 text-sm">
                    <input type="checkbox" className="mt-0.5" checked={roleAreas.includes(a.key)}
                      onChange={(e) => setRoleAreas(e.target.checked ? [...roleAreas, a.key] : roleAreas.filter((k) => k !== a.key))} />
                    <span><span className="font-medium">{locale === "en" ? (a.label ?? a.labelBn) : a.labelBn}</span><span className="block text-[11px] text-slate-400">{a.noteBn}</span></span>
                  </label>
                ))}
                {areaCatalog.length === 0 ? <p className="text-xs text-slate-400">{D.tmAreasNotLoaded}</p> : null}
              </div>
              <div className="flex gap-2">
                <button className="btn-primary" disabled={busy === "role-save"} onClick={saveCustomRole}>{editingRoleId ? D.tmUpdateRole : D.tmCreateRole}</button>
                {editingRoleId ? <button className="btn-secondary" onClick={() => { setEditingRoleId(""); setRoleName(""); setRoleAreas([]); }}>{dict.common.cancel}</button> : null}
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{D.tmFromPreset}</h3>
              <p className="text-xs text-slate-400">{D.tmPresetNote}</p>
              <select className="input w-full" value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
                <option value="">{D.tmPresetPick}</option>
                {presetProfiles.map((p) => <option key={p.key} value={p.key}>{locale === "en" ? (p.label ?? p.labelBn) : p.labelBn} ({p.label})</option>)}
              </select>
              {presetKey ? (
                <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                  {presetProfiles.find((p) => p.key === presetKey)?.noteBn}
                  <span className="block mt-1">{D.tmAreasLabel}{(presetProfiles.find((p) => p.key === presetKey)?.areas ?? []).map((a) => { const c = areaCatalog.find((x) => x.key === a); return c ? (locale === "en" ? (c.label ?? c.labelBn) : c.labelBn) : a; }).join(", ")}</span>
                </p>
              ) : null}
              <button className="btn-primary" disabled={busy === "role-preset" || !presetKey} onClick={createCustomRoleFromPreset}>{D.tmCreateFromPreset}</button>
            </div>
          </div>
        ) : <p className="text-xs text-slate-400">{D.tmCustomRolePermissionNote}</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-1 font-semibold">{D.tmEmailInviteTitle}</h2>
          <p className="mb-3 text-sm text-slate-500">{t("team.tmEmailInviteNote", { days: fmtNumber(locale, 7) })}</p>
          <div className="flex flex-wrap gap-2">
            <input id="inv-email" type="email" className="input flex-1" placeholder="teammate@email.com" />
            <select id="inv-role" className="input w-44">{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            <button className="btn-primary" disabled={busy === "email-invite"} onClick={emailInvite}>{D.tmCreateInvite}</button>
          </div>
          {lastLink ? (
            <div className="mt-3 rounded-lg bg-slate-50 p-3">
              <div className="mb-1 text-xs text-slate-500">{D.tmInviteLinkLabel}</div>
              <code className="block overflow-x-auto whitespace-nowrap text-xs">{lastLink}</code>
            </div>
          ) : null}
        </div>

        <div className="card p-5">
          <h2 className="mb-1 font-semibold">{D.tmDirectTitle}</h2>
          <p className="mb-3 text-sm text-slate-500">{D.tmDirectNote}</p>
          <div className="flex flex-wrap gap-2">
            <input id="direct-email" type="email" className="input flex-1" placeholder="user@email.com" />
            <select id="direct-role" className="input w-44">{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            <button className="btn-primary" disabled={busy === "direct"} onClick={directInvite}>{D.tmAddBtn}</button>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-semibold">{D.tmPendingTitle}</h2>
        {invitations.length === 0 ? <p className="text-sm text-slate-500">{D.tmNoInvites}</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500"><th className="py-2">{D.tmColEmail}</th><th>{D.tmColRole}</th><th>{D.tmColStatus}</th><th>{D.tmColEmailSent}</th><th>{D.tmColExpiry}</th><th></th></tr></thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id} className="border-t">
                  <td className="py-2">{inv.email}</td>
                  <td>{inv.role}</td>
                  <td>{inv.status}</td>
                  <td>{inv.emailSent ? D.tmYes : D.tmNo}</td>
                  <td>{fmtDate(locale, inv.expiresAt)}</td>
                  <td className="space-x-2 text-right">
                    {inv.status === "pending" || inv.status === "expired" ? (
                      <button className="btn-secondary" disabled={busy === `resend-${inv.id}`} onClick={() => resend(inv.id)}>{D.tmResendBtn}</button>
                    ) : null}
                    {inv.status === "pending" ? (
                      <button className="btn-secondary" disabled={busy === `revoke-${inv.id}`} onClick={() => revoke(inv.id)}>{dict.common.cancel}</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ORG9 (Organization Next OB3): shareable invite links — OWNER/ADMIN only. */}
      {canManage ? (
        <div className="card p-5">
          <h2 className="mb-1 font-semibold">{D.tmInviteLinksTitle}</h2>
          <p className="mb-3 text-sm text-slate-500">{D.tmInviteLinksNote}</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">{D.tmColRole}
              <select id="link-role" className="input ml-2 w-44" defaultValue="VIEWER">{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            </label>
            <label className="text-sm">{D.tmMaxRequests}
              <input id="link-max" type="number" min={1} max={1000} defaultValue={10} className="input ml-2 w-24" />
            </label>
            <label className="text-sm">{D.tmColExpiry}
              <select id="link-days" className="input ml-2 w-32" defaultValue={7}>
                <option value={1}>{t("team.tmDaysOption", { count: fmtNumber(locale, 1) })}</option>
                <option value={7}>{t("team.tmDaysOption", { count: fmtNumber(locale, 7) })}</option>
                <option value={30}>{t("team.tmDaysOption", { count: fmtNumber(locale, 30) })}</option>
                <option value={90}>{t("team.tmDaysOption", { count: fmtNumber(locale, 90) })}</option>
              </select>
            </label>
            <button className="btn-primary" disabled={busy === "link-create"} onClick={createLink}>{D.tmCreateLinkBtn}</button>
          </div>
          {newJoinLink ? (
            <div className="mt-3 rounded-lg bg-slate-50 p-3">
              <div className="mb-1 text-xs text-slate-500">{D.tmNewLinkLabel}</div>
              <div className="flex flex-wrap items-center gap-2">
                <code className="block flex-1 overflow-x-auto whitespace-nowrap text-xs">{newJoinLink}</code>
                <button className="btn-secondary" onClick={copyJoinLink}>{dict.common.copy}</button>
              </div>
            </div>
          ) : null}
          {inviteLinks.length === 0 ? <p className="mt-3 text-sm text-slate-500">{D.tmNoLinks}</p> : (
            <table className="mt-3 w-full text-sm">
              <thead><tr className="text-left text-slate-500"><th className="py-2">{D.tmColRole}</th><th>{D.tmColUsage}</th><th>{D.tmColStatus}</th><th>{D.tmColExpiryEnd}</th><th></th></tr></thead>
              <tbody>
                {inviteLinks.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="py-2">{l.role}</td>
                    <td>{t("team.tmUsageCell", { used: fmtNumber(locale, l.usedCount), max: fmtNumber(locale, l.maxUses) })}</td>
                    <td>{l.status === "active" ? D.tmLinkActive : l.status === "revoked" ? D.tmLinkRevokedStatus : l.status === "expired" ? D.tmLinkExpired : D.tmLinkExhausted}</td>
                    <td>{fmtDate(locale, l.expiresAt)}</td>
                    <td className="text-right">
                      {!l.revokedAt ? (
                        <button className="btn-secondary" disabled={busy === `link-revoke-${l.id}`} onClick={() => revokeLink(l.id)}>{D.tmRevokeLinkBtn}</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {/* ORG10 (Organization Next OB3): join-request approval queue — OWNER/ADMIN only. */}
      {canManage ? (
        <div className="card p-5">
          <h2 className="mb-1 font-semibold">{D.tmJoinTitle}</h2>
          <p className="mb-3 text-sm text-slate-500">{D.tmJoinNote}</p>
          {joinRequests.length === 0 ? <p className="text-sm text-slate-500">{D.tmNoRequests}</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-500"><th className="py-2">{D.tmColNameEmail}</th><th>{D.tmColMessage}</th><th>{D.tmColStatus}</th><th>{D.tmColRoleOnApprove}</th><th></th></tr></thead>
              <tbody>
                {joinRequests.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="py-2">
                      <div className="font-medium">{r.user.name || "—"}</div>
                      <div className="text-xs text-slate-500">{r.user.email}</div>
                      <div className="text-xs text-slate-400">{fmtDate(locale, r.createdAt)}</div>
                    </td>
                    <td className="max-w-xs py-2 text-slate-600">{r.message ?? "—"}</td>
                    <td className="py-2">
                      {r.status === "PENDING" ? D.tmReqPending : r.status === "APPROVED" ? D.tmReqApproved : D.tmReqRejected}
                      {r.status === "REJECTED" && r.rejectReason ? <div className="text-xs text-slate-400">{r.rejectReason}</div> : null}
                    </td>
                    <td className="py-2">
                      {r.status === "PENDING" ? (
                        <select id={`jr-role-${r.id}`} className="input w-44" defaultValue={r.linkRole ?? "VIEWER"}>{ROLES.map((x) => <option key={x} value={x}>{x}</option>)}</select>
                      ) : (r.linkRole ?? "—")}
                    </td>
                    <td className="space-x-2 whitespace-nowrap py-2 text-right">
                      {r.status === "PENDING" ? (
                        <>
                          <button className="btn-primary" disabled={busy === `jr-approve-${r.id}`} onClick={() => approveRequest(r.id)}>{D.tmApproveBtn}</button>
                          <button className="btn-secondary" disabled={busy === `jr-reject-${r.id}`} onClick={() => rejectRequest(r.id, r.user.name || r.user.email)}>{D.tmRejectBtn}</button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {feed.length ? (
        <div className="card p-5">
          <h2 className="mb-3 font-semibold">{D.tmFeedTitle}</h2>
          <ul className="space-y-1.5 text-sm">
            {feed.map((f) => (
              <li key={f.id} className="flex flex-wrap items-baseline gap-x-2 border-b border-slate-50 pb-1.5">
                <span className="font-medium">{f.actorName}</span>
                <span className="text-slate-600">{ACTION_LABEL_KEYS[f.action] ? D[ACTION_LABEL_KEYS[f.action]] : f.action}</span>
                <span className="text-xs text-slate-400">{f.entityType} · {agoText(f.createdAt, locale, D, t)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ORG1 (Organization Next OB1): ownership transfer — OWNER only. */}
      {myRole === "OWNER" ? (
        <div className="card border-amber-200 p-5">
          <h2 className="mb-1 font-semibold">{D.tmTransferTitle}</h2>
          <p className="mb-3 text-sm text-slate-500">
            {D.tmTransferNoteA}<b>{D.tmTransferNoteB}</b>{D.tmTransferNoteC}<b>{D.tmTransferNoteD}</b>{D.tmTransferNoteE}
          </p>
          {transferCandidates.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{D.tmNoCandidates}</p>
          ) : transferStep === 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <select className="input w-64" value={transferTarget} onChange={(e) => setTransferTarget(e.target.value)} aria-label={D.tmAriaNewOwner}>
                <option value="">{D.tmOwnerPlaceholder}</option>
                {transferCandidates.map((m) => (
                  <option key={m.user.id} value={m.user.id}>{m.user.name} ({m.user.email})</option>
                ))}
              </select>
              <button className="btn-secondary" disabled={!transferTarget} onClick={() => setTransferStep(1)}>{D.tmContinueBtn}</button>
            </div>
          ) : (
            <div className="space-y-3 rounded-xl bg-amber-50 p-4">
              <p className="text-sm text-amber-900">
                {D.tmTransferConfirmA}<b>{members.find((m) => m.user.id === transferTarget)?.user.name}</b>{D.tmTransferConfirmB}<b>{orgName}</b>{D.tmTransferConfirmC}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input className="input w-64" value={transferConfirmText} onChange={(e) => setTransferConfirmText(e.target.value)} placeholder={orgName} aria-label={D.tmAriaConfirmName} />
                <button className="btn-primary" disabled={busy === "transfer" || transferConfirmText !== orgName || !orgName} onClick={doTransfer}>
                  {busy === "transfer" ? D.tmTransferring : D.tmTransferBtn}
                </button>
                <button className="btn-secondary" disabled={busy === "transfer"} onClick={() => { setTransferStep(0); setTransferConfirmText(""); }}>{D.tmBackBtn}</button>
              </div>
              {orgName && transferConfirmText !== orgName ? (
                <p className="text-xs text-amber-700">{t("team.tmNameMustMatch", { org: orgName })}</p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {/* ORG2: self-leave — every member; the OWNER is pointed at transfer first. */}
      {myRole ? (
        <div className="card border-rose-100 p-5">
          <h2 className="mb-1 font-semibold">{D.tmLeaveTitle}</h2>
          {myRole === "OWNER" ? (
            <p className="text-sm text-slate-500">
              {D.tmLeaveOwnerA}<b>{D.tmLeaveOwnerB}</b>{D.tmLeaveOwnerC}
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-500">{D.tmLeaveNote}</p>
              <button className="btn-secondary text-rose-700" disabled={busy === "leave"} onClick={doLeave}>
                {busy === "leave" ? D.tmLeavingBtn : D.tmLeaveBtn}
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
