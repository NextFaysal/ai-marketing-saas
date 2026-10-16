"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  buildCustomRolePayload, buildCustomRoleUpdatePayload,
  type CustomRole, type CustomRolesResponse, type LoginHistoryRow, type MemberSession, type PresetRoleProfile,
} from "@/lib/gb6-team";

interface Member {
  id: string; role: string; status: string; user: { id: string; name: string; email: string };
  // GB6 (GC16): the member's custom role in this org (if any).
  customRoleId?: string | null; customRoleName?: string | null;
}
interface AreaDef { key: string; labelBn: string; label?: string; noteBn: string; minRole: string }
interface Invitation { id: string; email: string; role: string; status: string; expiresAt: string; emailSent: boolean; createdAt: string }
interface SeatUsage { limit: number | null; activeMembers: number; suspendedMembers: number; pendingInvites: number; available: number | null }

const ROLES = ["ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER"];
// Milestone 68: working hours (agent roles only).
const AGENT_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"];
const DAY_DEFS = [
  { key: "sat", label: "শনিবার" }, { key: "sun", label: "রবিবার" }, { key: "mon", label: "সোমবার" },
  { key: "tue", label: "মঙ্গলবার" }, { key: "wed", label: "বুধবার" }, { key: "thu", label: "বৃহস্পতিবার" }, { key: "fri", label: "শুক্রবার" },
];
interface ScheduleRow { userId: string; timezone: string; windows: Record<string, [string, string][]>; hasSchedule: boolean; onShift: boolean }
// Milestone 69: activity board + feed shapes.
interface ActivityMember {
  userId: string; name: string; role: string; activityState: string; presenceStatus: string;
  heartbeatAt: string | null; lastActionAt: string | null; onShift: boolean; hasSchedule: boolean;
  today: { repliesSent: number; closedToday: number; auditActions: number; openNow: number };
}
interface FeedRow { id: string; actorName: string; action: string; entityType: string; createdAt: string }
const ACTION_LABELS: Record<string, string> = {
  "org.member_role_updated": "ভূমিকা বদলেছেন", "org.member_suspended": "সদস্য সাময়িক বন্ধ করেছেন",
  "org.member_reactivated": "সদস্য আবার চালু করেছেন", "org.member_removed": "সদস্য সরিয়ে দিয়েছেন",
  "org.member_invited": "সদস্য আমন্ত্রণ জানিয়েছেন", "org.member_access_updated": "কাস্টম অ্যাক্সেস বদলেছেন", "inbox.agent_schedule_updated": "কর্মঘণ্টা বদলেছেন",
  "inbox.agent_schedule_cleared": "কর্মঘণ্টা সরিয়েছেন", "inbox.conversation_assigned": "কথোপকথন Assign করেছেন",
  "integration.messaging.connected": "মেসেজিং Channel যুক্ত করেছেন", "order.created": "অর্ডার তৈরি করেছেন",
};
function agoText(iso: string | null): string {
  if (!iso) return "—";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "এইমাত্র";
  if (mins < 60) return `${mins} মিনিট আগে`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} ঘণ্টা আগে`;
  return `${Math.floor(h / 24)} দিন আগে`;
}
const STATE_CHIP: Record<string, { label: string; cls: string }> = {
  active: { label: "🟢 সক্রিয় (কাজ করছেন)", cls: "bg-emerald-100 text-emerald-700" },
  idle: { label: "🟡 নিষ্ক্রিয় (বসে আছেন)", cls: "bg-amber-100 text-amber-700" },
  away: { label: "⚪ দূরে (Away)", cls: "bg-slate-200 text-slate-600" },
  offline: { label: "⚫ অফলাইন", cls: "bg-slate-100 text-slate-500" },
};

export default function TeamPage() {
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
  const [accessCatalog, setAccessCatalog] = useState<{ key: string; labelBn: string; noteBn: string; minRole: string }[]>([]);
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

  // Milestone 69: the live board refreshes itself every 30s.
  const refreshActivity = useCallback((orgId: string) => {
    apiFetch<{ members: ActivityMember[] }>(`/organizations/${orgId}/inbox/team-activity`)
      .then((r) => setActivity(r.members)).catch(() => undefined);
    apiFetch<FeedRow[]>(`/organizations/${orgId}/members/activity-feed?take=20`)
      .then(setFeed).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
    try {
      const [m, inv, u, orgs] = await Promise.all([
        apiFetch<Member[]>(`/organizations/${orgId}/members`),
        apiFetch<Invitation[]>(`/organizations/${orgId}/members/invitations`).catch(() => [] as Invitation[]),
        apiFetch<SeatUsage>(`/organizations/${orgId}/members/usage`).catch(() => null),
        apiFetch<{ id: string; myRole: string }[]>(`/organizations`).catch(() => [] as { id: string; myRole: string }[]),
      ]);
      setMembers(m);
      setInvitations(inv);
      setUsage(u);
      const mine = (orgs as { id: string; myRole: string }[]).find((o) => o.id === orgId);
      if (mine) setMyRole(mine.myRole);
      // GB6 (GC16): custom roles + preset profiles + the real area catalog.
      apiFetch<CustomRolesResponse>(`/organizations/${orgId}/custom-roles`)
        .then((r) => { setCustomRoles(r.roles ?? []); setPresetProfiles(r.presetProfiles ?? []); })
        .catch(() => { setCustomRoles([]); setPresetProfiles([]); });
      apiFetch<AreaDef[]>(`/organizations/${orgId}/access-catalog`).then(setAreaCatalog).catch(() => setAreaCatalog([]));
      apiFetch<ScheduleRow[]>(`/organizations/${orgId}/inbox/agent-schedules`).then(setSchedules).catch(() => setSchedules([]));
      apiFetch<{ id: string }>("/auth/me").then((me) => setMyUserId(me.id)).catch(() => undefined);
      refreshActivity(orgId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "লোড করা যায়নি");
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { const orgId = getOrganizationId(); if (orgId) refreshActivity(orgId); }, 30_000);
    return () => clearInterval(t);
  }, [refreshActivity]);

  async function wrap(key: string, fn: () => Promise<void>) {
    setBusy(key); setError(""); setNotice("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "কাজটি করা যায়নি"); } finally { setBusy(""); }
  }

  async function directInvite() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const email = (document.getElementById("direct-email") as HTMLInputElement).value;
    const role = (document.getElementById("direct-role") as HTMLSelectElement).value;
    await wrap("direct", async () => {
      await apiFetch(`/organizations/${orgId}/members/invite`, { method: "POST", body: JSON.stringify({ email, role }) });
      setNotice("সদস্য যোগ হয়েছে।");
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
      setNotice(out.emailSent
        ? "আমন্ত্রণের ইমেইল পাঠানো হয়েছে। চাইলে নিচের লিংকটিও সরাসরি পাঠাতে পারেন।"
        : "আমন্ত্রণ তৈরি হয়েছে, কিন্তু ইমেইল পাঠানো যায়নি (SMTP সেট করা নেই বা ব্যর্থ)। নিচের লিংকটি কপি করে সরাসরি পাঠিয়ে দিন।");
      await load();
    });
  }

  const canManage = myRole === "OWNER" || myRole === "ADMIN";

  async function changeRole(m: Member, role: string) {
    const orgId = getOrganizationId(); if (!orgId || role === m.role) return;
    await wrap(`role-${m.user.id}`, async () => {
      await apiFetch(`/organizations/${orgId}/members/${m.user.id}/role`, { method: "PATCH", body: JSON.stringify({ role }) });
      setNotice(`${m.user.name} এর ভূমিকা এখন ${role}।`);
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
        ? `${m.user.name} কে সাময়িক বন্ধ করা হয়েছে — তার ${out.handedOver}টি খোলা কথোপকথন Pool এ ফেরত গেছে, Assignment নিজে থেকে ভাগ করে দেবে। এখন থেকে তিনি এই Organization এ ঢুকতে পারবেন না।`
        : `${m.user.name} আবার সক্রিয়।`);
      await load();
    });
  }

  async function removeMember(m: Member) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(`${m.user.name} কে এই Organization থেকে স্থায়ীভাবে সরিয়ে দেবেন? তার খোলা কথোপকথন Pool এ ফেরত যাবে।`)) return;
    await wrap(`remove-${m.user.id}`, async () => {
      const out = await apiFetch<{ handedOver: number }>(`/organizations/${orgId}/members/${m.user.id}`, { method: "DELETE" });
      setNotice(`${m.user.name} কে সরিয়ে দেওয়া হয়েছে (${out.handedOver}টি খোলা কথোপকথন হস্তান্তর হয়েছে)।`);
      await load();
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
      setNotice(`${m.user.name} এর কর্মঘণ্টা সংরক্ষণ হয়েছে — Assignment এখন থেকে এই সময়ের বাইরে তাকে নতুন কথোপকথন দেবে না।`);
      setEditingShift("");
      await load();
    });
  }

  async function clearShift(m: Member) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap(`shift-clear-${m.user.id}`, async () => {
      await apiFetch(`/organizations/${orgId}/inbox/agent-schedules/${m.user.id}`, { method: "DELETE" });
      setNotice(`${m.user.name} এর কর্মঘণ্টা সরানো হয়েছে — এখন তিনি সব সময় Assignment এর জন্য উপলব্ধ।`);
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
    } catch (e) { setError(e instanceof Error ? e.message : "অ্যাক্সেস লোড করা যায়নি"); }
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
      setNotice(`${m.user.name} এর কাস্টম অ্যাক্সেস সংরক্ষণ হয়েছে।`);
    });
  }

  async function resetTotp(userId: string, name: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap(`totp-${userId}`, async () => {
      await apiFetch(`/organizations/${orgId}/members/${userId}/totp-reset`, { method: "POST" });
      setNotice(`${name} এর 2FA রিসেট হয়েছে — তিনি Settings থেকে আবার চালু করতে পারবেন। (শুধু OWNER এই কাজটি করতে পারে।)`);
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
      setNotice("প্রিসেট থেকে কাস্টম রোল তৈরি হয়েছে।");
      setPresetKey("");
      await reloadCustomRoles(orgId);
    } catch (e) { setRoleError(e instanceof Error ? e.message : "রোল তৈরি ব্যর্থ"); }
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
        setNotice("কাস্টম রোল হালনাগাদ হয়েছে।");
      } else {
        await apiFetch(`/organizations/${orgId}/custom-roles`, { method: "POST", body: JSON.stringify(built.payload) });
        setNotice("কাস্টম রোল তৈরি হয়েছে।");
      }
      setEditingRoleId(""); setRoleName(""); setRoleAreas([]);
      await reloadCustomRoles(orgId);
      await load();
    } catch (e) { setRoleError(e instanceof Error ? e.message : "রোল সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function deleteCustomRole(r: CustomRole) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(`“${r.name}” কাস্টম রোলটি মুছে ফেলবেন?`)) return;
    setBusy(`role-del-${r.id}`); setRoleError(""); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/custom-roles/${r.id}`, { method: "DELETE" });
      setNotice("কাস্টম রোল মুছে ফেলা হয়েছে।");
      if (editingRoleId === r.id) { setEditingRoleId(""); setRoleName(""); setRoleAreas([]); }
      await reloadCustomRoles(orgId);
    } catch (e) {
      // Server refuses while the role is still assigned — show its message verbatim.
      setRoleError(e instanceof Error ? e.message : "রোল মোছা ব্যর্থ");
    } finally { setBusy(""); }
  }

  async function assignCustomRole(m: Member, customRoleId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap(`custom-role-${m.user.id}`, async () => {
      await apiFetch(`/organizations/${orgId}/members/${m.user.id}/custom-role`, {
        method: "PATCH", body: JSON.stringify({ customRoleId: customRoleId || null }),
      });
      setNotice(customRoleId
        ? `${m.user.name} এর কাস্টম রোল এখন ${customRoles.find((r) => r.id === customRoleId)?.name ?? ""}।`
        : `${m.user.name} এর কাস্টম রোল তুলে নেওয়া হয়েছে।`);
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
    } catch (e) { setPanelError(e instanceof Error ? e.message : "ইতিহাস লোড করা যায়নি"); }
  }

  async function reloadMemberSessions(userId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setMemberSessions(await apiFetch<MemberSession[]>(`/organizations/${orgId}/members/${userId}/sessions`));
  }

  async function revokeMemberSession(m: Member, sessionId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap(`msession-${sessionId}`, async () => {
      await apiFetch(`/organizations/${orgId}/members/${m.user.id}/sessions/${sessionId}`, { method: "DELETE" });
      setNotice(`${m.user.name} এর একটি সেশন বাতিল হয়েছে।`);
      await reloadMemberSessions(m.user.id);
    });
  }

  async function revokeAllMemberSessions(m: Member) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(`${m.user.name} এর সব সক্রিয় সেশন বাতিল করবেন? তিনি সব ডিভাইস থেকে লগআউট হয়ে যাবেন।`)) return;
    await wrap(`msessions-all-${m.user.id}`, async () => {
      // Server field is `revokedCount` (verified in organizations.service.ts).
      const out = await apiFetch<{ revokedCount: number }>(`/organizations/${orgId}/members/${m.user.id}/sessions/revoke-all`, { method: "POST" });
      setNotice(`${m.user.name} এর ${out.revokedCount}টি সেশন বাতিল হয়েছে।`);
      await reloadMemberSessions(m.user.id);
    });
  }

  async function revoke(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap(`revoke-${id}`, async () => {
      await apiFetch(`/organizations/${orgId}/members/invitations/${id}`, { method: "DELETE" });
      setNotice("আমন্ত্রণ বাতিল হয়েছে।");
      await load();
    });
  }

  async function resend(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap(`resend-${id}`, async () => {
      const out = await apiFetch<{ inviteUrl: string; emailSent: boolean }>(`/organizations/${orgId}/members/invitations/${id}/resend`, { method: "POST" });
      setLastLink(out.inviteUrl);
      setNotice(out.emailSent ? "আমন্ত্রণ আবার পাঠানো হয়েছে (নতুন লিংক)।" : "নতুন লিংক তৈরি হয়েছে; ইমেইল যায়নি — লিংকটি কপি করে পাঠান।");
      await load();
    });
  }

  return (
    <div className="space-y-4">
      <h1 className="page-title">Team Settings</h1>
      <div>
        <a href="/dashboard/team/performance" className="btn-secondary">📊 পারফরম্যান্স স্কোরকার্ড — কে ভালো করছেন, কার দিকে নজর দিতে হবে →</a>
      </div>
      {error ? <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {notice ? <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div> : null}

      {usage ? (
        <div className="card flex flex-wrap items-center gap-x-8 gap-y-2 p-5 text-sm">
          <div><span className="text-2xl font-bold">{usage.activeMembers}</span> <span className="text-slate-500">সক্রিয় সদস্য</span></div>
          <div>Seat সীমা: <strong>{usage.limit === null ? "সীমাহীন" : `${usage.limit}টি`}</strong></div>
          <div>অপেক্ষমাণ আমন্ত্রণ: <strong>{usage.pendingInvites}</strong></div>
          {usage.suspendedMembers > 0 ? <div>সাময়িক বন্ধ: <strong>{usage.suspendedMembers}</strong></div> : null}
          {usage.available !== null ? (
            <div className={usage.available === 0 ? "font-semibold text-red-600" : "text-slate-600"}>
              {usage.available === 0 ? "আর কোনো Seat খালি নেই — সদস্য যোগ করতে Plan বাড়ান বা কাউকে সরান।" : `আরও ${usage.available}টি Seat খালি আছে।`}
            </div>
          ) : null}
        </div>
      ) : null}

      {activity.length ? (
        <div className="card p-5">
          <h2 className="mb-1 font-semibold">লাইভ টিম বোর্ড — কে কাজ করছেন, কে বসে আছেন</h2>
          <p className="mb-3 text-xs text-slate-400">নিয়ম: শেষ ১৫ মিনিটে আসল কাজের চিহ্ন (Reply, বন্ধ করা কথোপকথন, অন্য কাজ) থাকলে "সক্রিয়"; Dashboard খোলা আছে কিন্তু ১৫+ মিনিট কোনো কাজ নেই — "নিষ্ক্রিয়"। এটি একটি সংকেত মাত্র, কাজের চূড়ান্ত প্রমাণ নয়। প্রতি ৩০ সেকেন্ডে নিজে থেকে হালনাগাদ হয়।</p>
          {canManage ? (
            <div className="mb-3">
              <button className="btn-secondary" disabled={busy === "rebalance"} onClick={async () => {
                const orgId = getOrganizationId(); if (!orgId) return;
                await wrap("rebalance", async () => {
                  const plan: any = await apiFetch(`/organizations/${orgId}/inbox/rebalance`, { method: "POST", body: JSON.stringify({ dryRun: true }) });
                  if (!plan.movedCount) { setNotice("ভারসাম্যের দরকার নেই — কেউ ধারণক্ষমতার ওপরে নেই, অথবা নেওয়ার মতো উপযুক্ত সদস্য খালি নেই।"); return; }
                  const names = new Map(members.map((x) => [x.user.id, x.user.name]));
                  const lines = plan.moves.slice(0, 8).map((mv: any) => `• ${names.get(mv.fromUserId) ?? mv.fromUserId} → ${names.get(mv.toUserId) ?? mv.toUserId}`).join("\n");
                  if (!window.confirm(`পরিকল্পনা: ${plan.movedCount}টি কথোপকথন সরানো হবে (সবচেয়ে নতুনগুলো আগে):\n${lines}${plan.moves.length > 8 ? "\n…" : ""}\n\nএখনই প্রয়োগ করবেন?`)) return;
                  const done: any = await apiFetch(`/organizations/${orgId}/inbox/rebalance`, { method: "POST", body: JSON.stringify({ dryRun: false }) });
                  setNotice(`⚖️ ভারসাম্য সম্পন্ন: ${done.movedCount}টি কথোপকথন কম ব্যস্ত সদস্যদের কাছে সরানো হয়েছে।`);
                  refreshActivity(orgId);
                });
              }}>⚖️ কাজের ভারসাম্য করুন</button>
              <span className="ml-2 text-xs text-slate-400">ধারণক্ষমতার বেশি কাজ যার কাছে, তার সবচেয়ে নতুন কথোপকথনগুলো শিফটে থাকা কম-ব্যস্ত সদস্যের কাছে যায়। আগে পরিকল্পনা দেখানো হয়।</span>
            </div>
          ) : null}
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500"><th className="py-2">সদস্য</th><th>অবস্থা</th><th>শেষ কাজ</th><th>আজকের কাজ</th><th>এখন খোলা</th></tr></thead>
            <tbody>
              {activity.map((a) => {
                const chip = STATE_CHIP[a.activityState] ?? STATE_CHIP.offline;
                return (
                  <tr key={a.userId} className="border-t">
                    <td className="py-2">{a.name} <span className="text-xs text-slate-400">({a.role})</span></td>
                    <td>
                      <span className={`rounded px-1.5 py-0.5 text-xs ${chip.cls}`}>{chip.label}</span>
                      {a.hasSchedule && !a.onShift ? <span className="ml-1 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">অফ-শিফট</span> : null}
                    </td>
                    <td>{agoText(a.lastActionAt ?? a.heartbeatAt)}</td>
                    <td className="text-slate-600">Reply {a.today.repliesSent} · বন্ধ {a.today.closedToday} · অন্য কাজ {a.today.auditActions}</td>
                    <td>{a.today.openNow}টি</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="card p-5">
        <h2 className="mb-3 font-semibold">সদস্যরা ({members.length})</h2>
        <p className="mb-3 text-xs text-slate-400">মূল (preset) ভূমিকা ও কাস্টম রোল দুটোই থাকে: মূল ভূমিকা কিছু নির্দিষ্ট পেজ/কাজ নিয়ন্ত্রণ করে, আর কাস্টম রোলের এলাকাগুলো এলাকা-ভিত্তিক (area-checked) পেজগুলো নিয়ন্ত্রণ করে। কাস্টম রোল দিলে এলাকা-ভিত্তিক পেজে মূল ভূমিকার বদলে কাস্টম রোলের এলাকাই প্রযোজ্য হয় (per-member Grant/Deny এর ওপরে প্রযোজ্য থাকে)।</p>
        {members.length === 0 ? <p className="text-sm text-slate-500">কোনো সদস্য নেই।</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500"><th className="py-2">নাম</th><th>ইমেইল</th><th>ভূমিকা</th><th>অবস্থা</th><th></th></tr></thead>
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
                          onChange={(e) => assignCustomRole(m, e.target.value)} aria-label="কাস্টম রোল">
                          <option value="">কোনো কাস্টম রোল নেই</option>
                          {customRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                        <span className="block text-[11px] text-slate-400">কাস্টম রোল{!canManage ? " (বদলাতে OWNER/ADMIN লাগবে)" : ""}</span>
                      </div>
                    ) : <span className="block text-[11px] text-slate-400">মালিকের কাস্টম রোল হয় না</span>}
                  </td>
                  <td>{m.status === "SUSPENDED" ? <span className="font-semibold text-red-600">সাময়িক বন্ধ</span> : m.status}
                    {scheduleOf(m.user.id)?.hasSchedule ? (
                      <span className={scheduleOf(m.user.id)?.onShift ? "ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700" : "ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600"}>
                        {scheduleOf(m.user.id)?.onShift ? "এখন শিফটে" : "অফ-শিফট"}
                      </span>
                    ) : null}
                  </td>
                  <td className="space-x-2 whitespace-nowrap text-right">
                    {canManage && m.role !== "OWNER" ? (
                      m.status === "SUSPENDED" ? (
                        <button className="btn-secondary" disabled={busy === `status-${m.user.id}`} onClick={() => setStatus(m, "ACTIVE")}>আবার চালু</button>
                      ) : (
                        <button className="btn-secondary" disabled={busy === `status-${m.user.id}`} onClick={() => setStatus(m, "SUSPENDED")}>সাময়িক বন্ধ</button>
                      )
                    ) : null}
                    {myRole === "OWNER" && m.role !== "OWNER" ? (
                      <button className="btn-secondary" disabled={busy === `remove-${m.user.id}`} onClick={() => removeMember(m)}>সরিয়ে দিন</button>
                    ) : null}
                    {canEditShift(m) ? (
                      <button className="btn-secondary" onClick={() => (editingShift === m.user.id ? setEditingShift("") : openShiftEditor(m))}>কর্মঘণ্টা</button>
                    ) : null}
                    {canManage && m.role !== "OWNER" ? (
                      <button className="btn-secondary" onClick={() => (editingAccess === m.user.id ? setEditingAccess("") : openAccessEditor(m))}>অ্যাক্সেস</button>
                    ) : null}
                    {canManage ? (
                      <button className="btn-secondary" onClick={() => openHistoryPanel(m)}>লগইন ও সেশন</button>
                    ) : null}
                    <button className="btn-secondary" disabled={busy === `totp-${m.user.id}`} onClick={() => resetTotp(m.user.id, m.user.name)}>2FA রিসেট</button>
                  </td>
                </tr>
                {editingShift === m.user.id ? (
                  <tr className="border-t bg-slate-50">
                    <td colSpan={5} className="p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                        <strong>{m.user.name} এর সাপ্তাহিক কর্মঘণ্টা</strong>
                        <span className="text-slate-500">Timezone:</span>
                        <input className="input w-44" value={shiftTz} onChange={(e) => setShiftTz(e.target.value)} placeholder="Asia/Dhaka" />
                        <span className="text-xs text-slate-400">যেদিন চালু নেই, সেদিন ছুটি। রাতের শিফটে শেষ সময় শুরুর চেয়ে ছোট দিলে মধ্যরাত পার হবে (যেমন 22:00–06:00)।</span>
                      </div>
                      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                        {DAY_DEFS.map((d) => {
                          const day = shiftDays[d.key] ?? { on: false, start: "09:00", end: "18:00" };
                          return (
                            <label key={d.key} className="flex items-center gap-2 rounded bg-white px-2 py-1.5 text-sm">
                              <input type="checkbox" checked={day.on}
                                onChange={(e) => setShiftDays({ ...shiftDays, [d.key]: { ...day, on: e.target.checked } })} />
                              <span className="w-20">{d.label}</span>
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
                        <button className="btn-primary" disabled={busy === `shift-${m.user.id}`} onClick={() => saveShift(m)}>সংরক্ষণ</button>
                        <button className="btn-secondary" onClick={() => setEditingShift("")}>বন্ধ</button>
                        {scheduleOf(m.user.id)?.hasSchedule ? (
                          <button className="btn-secondary" disabled={busy === `shift-clear-${m.user.id}`} onClick={() => clearShift(m)}>সময়সূচি সরিয়ে দিন (সব সময় উপলব্ধ)</button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
                {editingAccess === m.user.id ? (
                  <tr className="border-t bg-indigo-50/50">
                    <td colSpan={5} className="p-3">
                      <div className="mb-2 text-sm">
                        <strong>{m.user.name} এর কাস্টম অ্যাক্সেস</strong>
                        <span className="ml-2 text-xs text-slate-500">Role ({m.role}) হলো ভিত্তি — এখানে এলাকাভেদে আলাদা অনুমতি দেওয়া বা বন্ধ করা যায়। "বন্ধ রাখুন" Role এর অনুমতিও আটকে দেয়। শুধু-মালিকের কাজ (সদস্য সরানো, 2FA রিসেট) কখনোই Grant দিয়ে দেওয়া যায় না।</span>
                      </div>
                      <div className="grid gap-1.5 lg:grid-cols-2">
                        {accessCatalog.map((a) => {
                          const mode = accessDraft.denies.includes(a.key) ? "deny" : accessDraft.grants.includes(a.key) ? "grant" : "role";
                          const eff = accessEffective.find((e) => e.key === a.key);
                          return (
                            <div key={a.key} className="flex flex-wrap items-center gap-2 rounded bg-white px-2 py-1.5 text-sm">
                              <span className="min-w-32 flex-1">
                                <span className="font-medium">{a.labelBn}</span>
                                <span className="block text-[11px] text-slate-400">{a.noteBn} · Role ভিত্তি: {a.minRole}</span>
                              </span>
                              {eff ? (
                                <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${eff.allowed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                                  {eff.allowed ? "পাবেন" : "পাবেন না"}{eff.source === "grant" ? " (Grant)" : eff.source === "deny" ? " (Deny)" : eff.source === "role" ? " (Role)" : ""}
                                </span>
                              ) : null}
                              <span className="flex overflow-hidden rounded-lg ring-1 ring-slate-200">
                                {([["role", "Role অনুযায়ী"], ["grant", "অনুমতি দিন"], ["deny", "বন্ধ রাখুন"]] as const).map(([v, label]) => (
                                  <button key={v} className={`px-2 py-1 text-xs font-medium ${mode === v ? (v === "deny" ? "bg-red-600 text-white" : v === "grant" ? "bg-emerald-600 text-white" : "bg-slate-900 text-white") : "bg-white text-slate-600"}`}
                                    onClick={() => setAccessMode(a.key, v)}>{label}</button>
                                ))}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button className="btn-primary" disabled={busy === `access-${m.user.id}`} onClick={() => saveAccess(m)}>অ্যাক্সেস সংরক্ষণ</button>
                        <button className="btn-secondary" onClick={() => setEditingAccess("")}>বন্ধ</button>
                        <span className="self-center text-xs text-slate-400">কার্যকর কলামটি শেষ সংরক্ষিত অবস্থা দেখায়। কিছু Endpoint এখনো শুধু Role দিয়ে চলে — সেগুলোতে Grant/Deny প্রযোজ্য নয়।</span>
                      </div>
                    </td>
                  </tr>
                ) : null}
                {historyFor === m.user.id ? (
                  <tr className="border-t bg-slate-50">
                    <td colSpan={5} className="p-3">
                      <div className="mb-2 text-sm">
                        <strong>{m.user.name} এর লগইন ইতিহাস ও সক্রিয় সেশন</strong>
                        <span className="ml-2 text-xs text-amber-700">মনে রাখুন: এটি এই ব্যক্তির সামগ্রিক (সব Organization মিলিয়ে) লগইন ইতিহাস — অ্যাকাউন্টটি সব Organization-এ একটাই, তাই শুধু এই Organization-এর আলাদা ইতিহাস হয় না।</span>
                      </div>
                      {panelError ? <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{panelError}</p> : null}
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div>
                          <h3 className="mb-1 text-sm font-semibold">সক্রিয় সেশন ({memberSessions.length})</h3>
                          {memberSessions.length === 0 ? <p className="text-sm text-slate-400">কোনো সক্রিয় সেশন নেই।</p> : memberSessions.map((s) => (
                            <div key={s.id} className="mb-1.5 flex flex-wrap items-center justify-between gap-2 rounded bg-white px-2 py-1.5 text-sm">
                              <span>
                                <span className="font-medium">{s.ip ?? "IP অজানা"}</span>
                                <span className="block max-w-md truncate text-[11px] text-slate-400" title={s.userAgent ?? ""}>{s.userAgent ?? "ডিভাইস অজানা"}</span>
                                <span className="block text-[11px] text-slate-400">শুরু: {new Date(s.createdAt).toLocaleString("bn-BD")} · শেষ দেখা: {new Date(s.lastSeenAt).toLocaleString("bn-BD")}</span>
                              </span>
                              <button className="btn-secondary btn-sm text-red-600" disabled={busy === `msession-${s.id}`} onClick={() => revokeMemberSession(m, s.id)}>সেশন বাতিল</button>
                            </div>
                          ))}
                          {memberSessions.length > 0 ? (
                            <button className="btn-secondary btn-sm text-red-600" disabled={busy === `msessions-all-${m.user.id}`} onClick={() => revokeAllMemberSessions(m)}>সব সেশন বাতিল</button>
                          ) : null}
                        </div>
                        <div>
                          <h3 className="mb-1 text-sm font-semibold">শেষ ৫০টি লগইন চেষ্টা</h3>
                          {loginHistory.length === 0 ? <p className="text-sm text-slate-400">কোনো লগইন ইতিহাস নেই।</p> : (
                            <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
                              {loginHistory.map((h, i) => (
                                <li key={h.id ?? i} className="flex flex-wrap items-center gap-2 rounded bg-white px-2 py-1.5">
                                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${h.success ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>{h.success ? "সফল" : "ব্যর্থ"}</span>
                                  <span className="text-slate-600">{h.ip ?? "IP অজানা"}</span>
                                  <span className="max-w-40 truncate text-[11px] text-slate-400" title={h.userAgent ?? ""}>{h.userAgent ?? ""}</span>
                                  <span className="text-[11px] text-slate-400">{new Date(h.createdAt).toLocaleString("bn-BD")}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                      <button className="btn-secondary btn-sm mt-3" onClick={() => setHistoryFor("")}>বন্ধ করুন</button>
                    </td>
                  </tr>
                ) : null}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
        {canManage ? null : <p className="mt-2 text-xs text-slate-400">ভূমিকা ও অবস্থা বদলাতে OWNER বা ADMIN হতে হয়; সদস্য সরাতে শুধু OWNER পারে।</p>}
      </div>

      {/* GB6 (GC16): custom roles manager */}
      <div className="card p-5">
        <h2 className="mb-1 font-semibold">🎭 কাস্টম রোল</h2>
        <p className="mb-3 text-xs text-slate-400">নাম দেওয়া অনুমতির এলাকার বান্ডল। কোনো সদস্যকে কাস্টম রোল দিলে এলাকা-ভিত্তিক পেজে তার মূল ভূমিকার বদলে এই এলাকাগুলোই প্রযোজ্য হয়। যে রোল কোনো সদস্যের কাছে আছে, সেটি মোছা যাবে না — আগে সদস্যের কাছ থেকে তুলে নিন (সার্ভারের বার্তা 그대로 দেখানো হয়)।</p>
        {roleError ? <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{roleError}</div> : null}
        {customRoles.length === 0 ? <p className="mb-3 text-sm text-slate-500">কোনো কাস্টম রোল নেই।</p> : (
          <div className="mb-4 space-y-2">
            {customRoles.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{r.name}</span>
                  {r.presetKey ? <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">প্রিসেট: {r.presetKey}</span> : null}
                  <span className="ml-2 text-xs text-slate-500">{r.memberCount} জন সদস্য</span>
                  <span className="block text-xs text-slate-400">
                    {r.areas.map((a) => areaCatalog.find((c) => c.key === a)?.labelBn ?? a).join(", ") || "কোনো এলাকা নেই"}
                  </span>
                </span>
                {canManage ? (
                  <span className="flex gap-2">
                    <button className="btn-secondary btn-sm" onClick={() => { setEditingRoleId(r.id); setRoleName(r.name); setRoleAreas([...r.areas]); setRoleError(""); }}>সম্পাদনা</button>
                    <button className="btn-secondary btn-sm text-red-600" disabled={busy === `role-del-${r.id}`} onClick={() => deleteCustomRole(r)}>মুছুন</button>
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {canManage ? (
          <div className="grid gap-4 border-t pt-4 lg:grid-cols-2">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{editingRoleId ? "রোল সম্পাদনা" : "নতুন রোল — নিজে বানান"}</h3>
              <input className="input w-full" placeholder="রোলের নাম (১–৬০ অক্ষর)" value={roleName} onChange={(e) => setRoleName(e.target.value)} maxLength={70} />
              <div className="grid gap-1 sm:grid-cols-2">
                {(areaCatalog.length ? areaCatalog : []).map((a) => (
                  <label key={a.key} className="flex items-start gap-2 rounded bg-slate-50 px-2 py-1.5 text-sm">
                    <input type="checkbox" className="mt-0.5" checked={roleAreas.includes(a.key)}
                      onChange={(e) => setRoleAreas(e.target.checked ? [...roleAreas, a.key] : roleAreas.filter((k) => k !== a.key))} />
                    <span><span className="font-medium">{a.labelBn}</span><span className="block text-[11px] text-slate-400">{a.noteBn}</span></span>
                  </label>
                ))}
                {areaCatalog.length === 0 ? <p className="text-xs text-slate-400">এলাকার তালিকা লোড হয়নি — পেজটি আবার লোড করুন।</p> : null}
              </div>
              <div className="flex gap-2">
                <button className="btn-primary" disabled={busy === "role-save"} onClick={saveCustomRole}>{editingRoleId ? "হালনাগাদ করুন" : "রোল তৈরি করুন"}</button>
                {editingRoleId ? <button className="btn-secondary" onClick={() => { setEditingRoleId(""); setRoleName(""); setRoleAreas([]); }}>বাতিল</button> : null}
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">প্রিসেট থেকে তৈরি</h3>
              <p className="text-xs text-slate-400">প্রিসেট বেছে তৈরি করলে নাম ও এলাকা প্রিসেট থেকেই আসে — তৈরি হওয়ার পর চাইলে সম্পাদনা করে বদলাতে পারবেন।</p>
              <select className="input w-full" value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
                <option value="">প্রিসেট বেছে নিন</option>
                {presetProfiles.map((p) => <option key={p.key} value={p.key}>{p.labelBn} ({p.label})</option>)}
              </select>
              {presetKey ? (
                <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                  {presetProfiles.find((p) => p.key === presetKey)?.noteBn}
                  <span className="block mt-1">এলাকা: {(presetProfiles.find((p) => p.key === presetKey)?.areas ?? []).map((a) => areaCatalog.find((c) => c.key === a)?.labelBn ?? a).join(", ")}</span>
                </p>
              ) : null}
              <button className="btn-primary" disabled={busy === "role-preset" || !presetKey} onClick={createCustomRoleFromPreset}>প্রিসেট থেকে তৈরি করুন</button>
            </div>
          </div>
        ) : <p className="text-xs text-slate-400">কাস্টম রোল বানাতে/বদলাতে OWNER বা ADMIN হতে হয়।</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-1 font-semibold">📧 ইমেইল আমন্ত্রণ (নতুন)</h2>
          <p className="mb-3 text-sm text-slate-500">যার অ্যাকাউন্ট নেই তাকেও আমন্ত্রণ পাঠানো যায়। লিংকের মেয়াদ ৭ দিন; গ্রহণ করতে ওই ইমেইল দিয়েই লগইন/রেজিস্টার করতে হবে।</p>
          <div className="flex flex-wrap gap-2">
            <input id="inv-email" type="email" className="input flex-1" placeholder="teammate@email.com" />
            <select id="inv-role" className="input w-44">{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            <button className="btn-primary" disabled={busy === "email-invite"} onClick={emailInvite}>আমন্ত্রণ তৈরি</button>
          </div>
          {lastLink ? (
            <div className="mt-3 rounded-lg bg-slate-50 p-3">
              <div className="mb-1 text-xs text-slate-500">আমন্ত্রণ লিংক (কপি করে পাঠাতে পারেন):</div>
              <code className="block overflow-x-auto whitespace-nowrap text-xs">{lastLink}</code>
            </div>
          ) : null}
        </div>

        <div className="card p-5">
          <h2 className="mb-1 font-semibold">সরাসরি যোগ (অ্যাকাউন্ট আছে যার)</h2>
          <p className="mb-3 text-sm text-slate-500">আগে থেকে রেজিস্টার করা ব্যবহারকারীকে সরাসরি সদস্য করা যায়।</p>
          <div className="flex flex-wrap gap-2">
            <input id="direct-email" type="email" className="input flex-1" placeholder="user@email.com" />
            <select id="direct-role" className="input w-44">{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            <button className="btn-primary" disabled={busy === "direct"} onClick={directInvite}>যোগ করুন</button>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-semibold">অপেক্ষমাণ আমন্ত্রণ</h2>
        {invitations.length === 0 ? <p className="text-sm text-slate-500">কোনো আমন্ত্রণ নেই।</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500"><th className="py-2">ইমেইল</th><th>ভূমিকা</th><th>অবস্থা</th><th>ইমেইল গেছে</th><th>মেয়াদ</th><th></th></tr></thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id} className="border-t">
                  <td className="py-2">{inv.email}</td>
                  <td>{inv.role}</td>
                  <td>{inv.status}</td>
                  <td>{inv.emailSent ? "হ্যাঁ" : "না"}</td>
                  <td>{new Date(inv.expiresAt).toLocaleDateString("bn-BD")}</td>
                  <td className="space-x-2 text-right">
                    {inv.status === "pending" || inv.status === "expired" ? (
                      <button className="btn-secondary" disabled={busy === `resend-${inv.id}`} onClick={() => resend(inv.id)}>আবার পাঠান</button>
                    ) : null}
                    {inv.status === "pending" ? (
                      <button className="btn-secondary" disabled={busy === `revoke-${inv.id}`} onClick={() => revoke(inv.id)}>বাতিল</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {feed.length ? (
        <div className="card p-5">
          <h2 className="mb-3 font-semibold">সাম্প্রতিক কার্যকলাপ</h2>
          <ul className="space-y-1.5 text-sm">
            {feed.map((f) => (
              <li key={f.id} className="flex flex-wrap items-baseline gap-x-2 border-b border-slate-50 pb-1.5">
                <span className="font-medium">{f.actorName}</span>
                <span className="text-slate-600">{ACTION_LABELS[f.action] ?? f.action}</span>
                <span className="text-xs text-slate-400">{f.entityType} · {agoText(f.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
