"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import {
  PAYROLL_RECORD_NOTE,
  attendanceSourceLabel,
  leavePaidLabel,
  leaveStatusLabel,
  minutesLabel,
  parseTimeToMinutes,
  runStatusLabel,
  weekdayLabel,
  type AttendanceRecordView,
  type HrSettingView,
  type LeaveRequestView,
  type PayrollLineView,
  type PayrollRunView,
  type ShiftPatternView,
  type StaffRow,
} from "@/lib/hr-nf11";

// NF11 (FB4) — HR lite: salary profiles, attendance, shift
// roster, leave and payroll for the org's EXISTING Membership
// team. Every member sees the "আমার HR" (my) section scoped to
// their own records; OWNER/ADMIN additionally manage the team.
// Payroll mark-paid is a RECORD only — the banner says so and
// the API repeats it in every run payload.

const fmtM = (minor?: string | null): string => {
  if (minor == null) return "—";
  try { return formatMinor(BigInt(minor)); } catch { return minor; }
};

/** BDT major text ("31000" / "31000.50") → minor-unit string. */
function bdtToMinor(v: string): string | null {
  const s = String(v ?? "").trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  return (BigInt(w) * 100n + BigInt((f + "00").slice(0, 2))).toString();
}

const inputCls = "w-full rounded-lg border px-3 py-2 text-sm";
const labelCls = "mb-1 block text-xs font-semibold text-slate-700";
const thCls = "py-2 pr-2 text-left font-semibold";
const tdCls = "py-2 pr-2 align-top";
const btnCls = "rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50";
const btnGhost = "rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50";

async function downloadPdf(path: string, filename: string) {
  const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
  if (!res.ok) throw new Error(`PDF ডাউনলোড ব্যর্থ (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function HrPage() {
  const orgId = getOrganizationId();
  const [myRole, setMyRole] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // my section
  const [myProfile, setMyProfile] = useState<{ profile: StaffRow["salaryProfile"] } | null>(null);
  const [myAttendance, setMyAttendance] = useState<AttendanceRecordView[]>([]);
  const [myShifts, setMyShifts] = useState<ShiftPatternView[]>([]);
  const [myLeave, setMyLeave] = useState<LeaveRequestView[]>([]);
  const [myPayslips, setMyPayslips] = useState<(PayrollLineView & { period?: { year: number; month: number } | null; runStatus?: string | null })[]>([]);
  const [leaveFrom, setLeaveFrom] = useState("");
  const [leaveTo, setLeaveTo] = useState("");
  const [leavePaid, setLeavePaid] = useState("unpaid");
  const [leaveReason, setLeaveReason] = useState("");

  // admin section
  const [setting, setSetting] = useState<HrSettingView | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [salaryNote, setSalaryNote] = useState("");
  const [attDate, setAttDate] = useState("");
  const [attendance, setAttendance] = useState<AttendanceRecordView[]>([]);
  const [corrMember, setCorrMember] = useState("");
  const [corrIn, setCorrIn] = useState("");
  const [corrOut, setCorrOut] = useState("");
  const [corrNote, setCorrNote] = useState("");
  const [shiftMember, setShiftMember] = useState("");
  const [shiftRows, setShiftRows] = useState<{ weekday: string; start: string; end: string }[]>([]);
  const [leaveQueue, setLeaveQueue] = useState<LeaveRequestView[]>([]);
  const [runYear, setRunYear] = useState(() => new Date().getFullYear());
  const [runMonth, setRunMonth] = useState(() => new Date().getMonth() + 1);
  const [runs, setRuns] = useState<PayrollRunView[]>([]);
  const [runDetail, setRunDetail] = useState<PayrollRunView | null>(null);
  const [adjDrafts, setAdjDrafts] = useState<Record<string, { label: string; amount: string; note: string }>>({});

  const isAdmin = myRole === "OWNER" || myRole === "ADMIN";
  const isOwner = myRole === "OWNER";

  const loadMine = useCallback(async () => {
    if (!orgId) return;
    const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const [prof, att, sh, lv, slips] = await Promise.all([
      apiFetch<any>(`/organizations/${orgId}/hr/me/salary-profile`).catch(() => null),
      apiFetch<{ items: AttendanceRecordView[] }>(`/organizations/${orgId}/hr/me/attendance?month=${month}`).catch(() => ({ items: [] })),
      apiFetch<{ items: ShiftPatternView[] }>(`/organizations/${orgId}/hr/me/shifts`).catch(() => ({ items: [] })),
      apiFetch<{ items: LeaveRequestView[] }>(`/organizations/${orgId}/hr/me/leave`).catch(() => ({ items: [] })),
      apiFetch<{ items: any[] }>(`/organizations/${orgId}/hr/me/payslips`).catch(() => ({ items: [] })),
    ]);
    setMyProfile(prof); setMyAttendance(att.items ?? []); setMyShifts(sh.items ?? []);
    setMyLeave(lv.items ?? []); setMyPayslips(slips.items ?? []);
  }, [orgId]);

  const loadAdmin = useCallback(async () => {
    if (!orgId || !isAdmin) return;
    const [st, set] = await Promise.all([
      apiFetch<{ items: StaffRow[]; setting: HrSettingView }>(`/organizations/${orgId}/hr/staff`).catch(() => null),
      apiFetch<HrSettingView>(`/organizations/${orgId}/hr/setting`).catch(() => null),
    ]);
    if (st) { setStaff(st.items ?? []); setSetting(st.setting ?? set); }
    const [att, lv, rn] = await Promise.all([
      apiFetch<{ items: AttendanceRecordView[]; date: string }>(`/organizations/${orgId}/hr/attendance${attDate ? `?date=${attDate}` : ""}`).catch(() => ({ items: [] as AttendanceRecordView[], date: "" })),
      apiFetch<{ items: LeaveRequestView[] }>(`/organizations/${orgId}/hr/leave`).catch(() => ({ items: [] })),
      apiFetch<{ items: PayrollRunView[] }>(`/organizations/${orgId}/hr/payroll/runs`).catch(() => ({ items: [] })),
    ]);
    setAttendance(att.items ?? []); setLeaveQueue(lv.items ?? []); setRuns(rn.items ?? []);
  }, [orgId, isAdmin, attDate]);

  useEffect(() => {
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
    apiFetch<{ id: string; myRole: string }[]>(`/organizations`)
      .then((orgs) => { const mine = orgs.find((o) => o.id === orgId); if (mine) setMyRole(mine.myRole); })
      .catch(() => {});
    void loadMine();
  }, [orgId, loadMine]);

  useEffect(() => { void loadAdmin(); }, [loadAdmin]);

  const act = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setError(""); setMsg("");
    try { await fn(); setMsg(ok); await loadMine(); await loadAdmin(); }
    catch (e) { setError(e instanceof Error ? e.message : "ব্যর্থ হয়েছে"); }
    finally { setBusy(false); }
  };

  const todayKey = new Date().toLocaleDateString("en-CA");
  const todayRecord = myAttendance.find((r) => r.date === todayKey);

  const loadRunDetail = async (runId: string) => {
    if (!orgId) return;
    const { run } = await apiFetch<{ run: PayrollRunView }>(`/organizations/${orgId}/hr/payroll/runs/${runId}`);
    setRunDetail(run);
  };

  const loadShiftsFor = async (membershipId: string) => {
    if (!orgId || !membershipId) { setShiftRows([]); return; }
    const { items } = await apiFetch<{ items: ShiftPatternView[] }>(`/organizations/${orgId}/hr/shifts/${membershipId}`);
    setShiftRows((items ?? []).map((p) => ({ weekday: String(p.weekday), start: minutesLabel(p.startMinute), end: minutesLabel(p.endMinute) })));
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4">
      <div>
        <h1 className="text-xl font-bold">মানবসম্পদ (HR Lite)</h1>
        <p className="mt-1 text-sm text-slate-600">বেতন প্রোফাইল, হাজিরা, শিফট, ছুটি ও পে-রোল — টিমের সদস্যরাই (Membership) এখানে স্টাফ; আলাদা কোনো তালিকা নেই।</p>
        <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{PAYROLL_RECORD_NOTE}</p>
      </div>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {msg && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</p>}

      {/* ---------------- আমার HR ---------------- */}
      <section className="rounded-xl border p-4">
        <h2 className="font-bold">আমার HR</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg bg-slate-50 p-3">
            <h3 className="text-sm font-semibold">আমার বেতন প্রোফাইল</h3>
            {myProfile?.profile ? (
              <p className="mt-1 text-sm">মূল বেতন: <b>{fmtM(myProfile.profile.baseSalaryMinor)}</b> · কার্যকর: {myProfile.profile.effectiveFrom}{myProfile.profile.payoutNote ? ` · পে-আউট নোট: ${myProfile.profile.payoutNote}` : ""}</p>
            ) : <p className="mt-1 text-sm text-slate-500">এখনো বেতন প্রোফাইল সেট করা হয়নি।</p>}
            <h3 className="mt-4 text-sm font-semibold">আজকের হাজিরা ({todayKey})</h3>
            <p className="mt-1 text-sm">
              {todayRecord?.checkInAt ? `চেক-ইন: ${new Date(todayRecord.checkInAt).toLocaleTimeString()}` : "চেক-ইন হয়নি"}
              {todayRecord?.checkOutAt ? ` · চেক-আউট: ${new Date(todayRecord.checkOutAt).toLocaleTimeString()}` : ""}
              {todayRecord ? ` · ${attendanceSourceLabel(todayRecord.source)}` : ""}
            </p>
            <div className="mt-2 flex gap-2">
              <button className={btnCls} disabled={busy || !!todayRecord?.checkInAt} onClick={() => act(async () => { await apiFetch(`/organizations/${orgId}/hr/me/attendance/check-in`, { method: "POST" }); }, "চেক-ইন হয়েছে")}>চেক-ইন</button>
              <button className={btnGhost} disabled={busy || !todayRecord?.checkInAt || !!todayRecord?.checkOutAt} onClick={() => act(async () => { await apiFetch(`/organizations/${orgId}/hr/me/attendance/check-out`, { method: "POST" }); }, "চেক-আউট হয়েছে")}>চেক-আউট</button>
            </div>
            {myAttendance.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-slate-600">
                {myAttendance.slice(0, 10).map((r) => (
                  <li key={r.id}>{r.date}: {r.checkInAt ? new Date(r.checkInAt).toLocaleTimeString() : "—"} → {r.checkOutAt ? new Date(r.checkOutAt).toLocaleTimeString() : "—"} ({attendanceSourceLabel(r.source)})</li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <h3 className="text-sm font-semibold">আমার শিফট রোস্টার</h3>
            {myShifts.length ? (
              <ul className="mt-1 space-y-1 text-sm">
                {myShifts.map((p) => <li key={p.id}>{weekdayLabel(p.weekday)}: {minutesLabel(p.startMinute)} – {minutesLabel(p.endMinute)}{p.active ? "" : " (বন্ধ)"}</li>)}
              </ul>
            ) : <p className="mt-1 text-sm text-slate-500">কোনো শিফট প্যাটার্ন নেই।</p>}
            <h3 className="mt-4 text-sm font-semibold">আমার পে-স্লিপ</h3>
            {myPayslips.length ? (
              <ul className="mt-1 space-y-1 text-sm">
                {myPayslips.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2">
                    <span>{l.period ? `${l.period.year}-${String(l.period.month).padStart(2, "0")}` : ""} · {fmtM(l.totalMinor)} · {runStatusLabel(l.runStatus)}</span>
                    <button className={btnGhost} onClick={() => downloadPdf(`/organizations/${orgId}/hr/me/payslips/${l.id}/pdf`, `payslip-${l.id}.pdf`).catch((e) => setError(e.message))}>PDF</button>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1 text-sm text-slate-500">এখনো কোনো পে-স্লিপ নেই।</p>}
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <form className="rounded-lg bg-slate-50 p-3" onSubmit={(e) => { e.preventDefault(); void act(async () => { await apiFetch(`/organizations/${orgId}/hr/me/leave`, { method: "POST", body: JSON.stringify({ fromDate: leaveFrom, toDate: leaveTo, paid: leavePaid, reason: leaveReason || null }) }); setLeaveFrom(""); setLeaveTo(""); setLeaveReason(""); }, "ছুটির আবেদন জমা হয়েছে"); }}>
            <h3 className="text-sm font-semibold">ছুটির আবেদন</h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div><label className={labelCls}>শুরু</label><input className={inputCls} type="date" required value={leaveFrom} onChange={(e) => setLeaveFrom(e.target.value)} /></div>
              <div><label className={labelCls}>শেষ</label><input className={inputCls} type="date" required value={leaveTo} onChange={(e) => setLeaveTo(e.target.value)} /></div>
            </div>
            <div className="mt-2"><label className={labelCls}>ধরন</label>
              <select className={inputCls} value={leavePaid} onChange={(e) => setLeavePaid(e.target.value)}>
                <option value="unpaid">বেতনবিহীন ছুটি</option>
                <option value="paid">বেতনসহ ছুটি</option>
              </select>
            </div>
            <div className="mt-2"><label className={labelCls}>কারণ</label><input className={inputCls} value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} /></div>
            <button className={`${btnCls} mt-3`} disabled={busy}>আবেদন করুন</button>
          </form>
          <div className="rounded-lg bg-slate-50 p-3">
            <h3 className="text-sm font-semibold">আমার ছুটির আবেদনসমূহ</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {myLeave.map((l) => <li key={l.id}>{l.fromDate} → {l.toDate} ({l.days} দিন) · {leavePaidLabel(l.paid)} · <b>{leaveStatusLabel(l.status)}</b></li>)}
              {!myLeave.length && <li className="text-slate-500">কোনো আবেদন নেই।</li>}
            </ul>
          </div>
        </div>
      </section>

      {/* ---------------- অ্যাডমিন ---------------- */}
      {isAdmin && (
        <>
          <section className="rounded-xl border p-4">
            <h2 className="font-bold">পে-রোল নিয়ম (HrSetting — সংরক্ষিত ও স্পষ্ট)</h2>
            {setting && (
              <div className="mt-2 space-y-1 text-sm">
                <p><b>বেতনবিহীন ছুটির নিয়ম:</b> {setting.unpaidLeaveRule} — {setting.unpaidLeaveRuleText}</p>
                <p><b>কমিশনের নিয়ম:</b> {setting.commissionRule} — {setting.commissionRuleText}</p>
              </div>
            )}
          </section>

          <section className="rounded-xl border p-4">
            <h2 className="font-bold">স্টাফ ও বেতন প্রোফাইল</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className={thCls}>নাম</th><th className={thCls}>ভূমিকা</th><th className={thCls}>অবস্থা</th><th className={thCls}>মূল বেতন</th><th className={thCls}>কার্যকর</th><th className={thCls}>পে-আউট নোট</th><th className={thCls}>বেতন (৳)</th><th className={thCls}>কার্যকর তারিখ</th><th className={thCls}></th></tr></thead>
                <tbody>
                  {staff.map((s) => (
                    <tr key={s.membershipId} className="border-t">
                      <td className={tdCls}>{s.name ?? "—"}<br /><span className="text-xs text-slate-500">{s.email}</span></td>
                      <td className={tdCls}>{s.role}</td>
                      <td className={tdCls}>{s.status}</td>
                      <td className={tdCls}>{s.salaryProfile ? fmtM(s.salaryProfile.baseSalaryMinor) : "—"}</td>
                      <td className={tdCls}>{s.salaryProfile?.effectiveFrom ?? "—"}</td>
                      <td className={tdCls}>{s.salaryProfile?.payoutNote ?? "—"}</td>
                      <td className={tdCls}><input className="w-28 rounded border px-2 py-1" placeholder="31000" id={`sal-${s.membershipId}`} /></td>
                      <td className={tdCls}><input className="rounded border px-2 py-1" type="date" id={`salfrom-${s.membershipId}`} /></td>
                      <td className={tdCls}>
                        <button className={btnGhost} disabled={busy} onClick={() => {
                          const bdt = (document.getElementById(`sal-${s.membershipId}`) as HTMLInputElement)?.value ?? "";
                          const from = (document.getElementById(`salfrom-${s.membershipId}`) as HTMLInputElement)?.value ?? "";
                          const minor = bdtToMinor(bdt);
                          if (!minor || !from) { setError("বেতন (৳) ও কার্যকর তারিখ দিন"); return; }
                          void act(async () => {
                            await apiFetch(`/organizations/${orgId}/hr/salary-profiles/${s.membershipId}`, { method: "PUT", body: JSON.stringify({ baseSalaryMinor: minor, effectiveFrom: from, payoutNote: salaryNote || s.salaryProfile?.payoutNote || null }) });
                          }, "বেতন প্রোফাইল সংরক্ষিত");
                        }}>সংরক্ষণ</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 max-w-xs"><label className={labelCls}>পে-আউট নোট (সংরক্ষণের সময় প্রযোজ্য — কোনো গোপন তথ্য নয়)</label><input className={inputCls} value={salaryNote} onChange={(e) => setSalaryNote(e.target.value)} placeholder="যেমন: bKash personal" /></div>
          </section>

          <section className="rounded-xl border p-4">
            <h2 className="font-bold">হাজিরা — আজ/নির্বাচিত দিন</h2>
            <div className="mt-2 flex items-end gap-2">
              <div><label className={labelCls}>তারিখ</label><input className={inputCls} type="date" value={attDate} onChange={(e) => setAttDate(e.target.value)} /></div>
            </div>
            <ul className="mt-3 space-y-1 text-sm">
              {attendance.map((r) => <li key={r.id}>{r.member?.name ?? r.membershipId}: {r.checkInAt ? new Date(r.checkInAt).toLocaleTimeString() : "—"} → {r.checkOutAt ? new Date(r.checkOutAt).toLocaleTimeString() : "—"} · {attendanceSourceLabel(r.source)}{r.correctionNote ? ` · নোট: ${r.correctionNote}` : ""}</li>)}
              {!attendance.length && <li className="text-slate-500">এই দিনে কোনো হাজিরা নেই।</li>}
            </ul>
            <form className="mt-4 grid gap-2 md:grid-cols-5" onSubmit={(e) => { e.preventDefault(); void act(async () => {
              await apiFetch(`/organizations/${orgId}/hr/attendance/correction`, { method: "POST", body: JSON.stringify({ membershipId: corrMember, date: attDate || todayKey, checkInAt: corrIn ? new Date(corrIn).toISOString() : null, checkOutAt: corrOut ? new Date(corrOut).toISOString() : null, correctionNote: corrNote }) });
            }, "সংশোধন সংরক্ষিত হয়েছে (অডিট লগসহ)"); }}>
              <div><label className={labelCls}>সদস্য</label>
                <select className={inputCls} required value={corrMember} onChange={(e) => setCorrMember(e.target.value)}>
                  <option value="">বেছে নিন</option>
                  {staff.map((s) => <option key={s.membershipId} value={s.membershipId}>{s.name ?? s.email}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>চেক-ইন</label><input className={inputCls} type="datetime-local" value={corrIn} onChange={(e) => setCorrIn(e.target.value)} /></div>
              <div><label className={labelCls}>চেক-আউট</label><input className={inputCls} type="datetime-local" value={corrOut} onChange={(e) => setCorrOut(e.target.value)} /></div>
              <div><label className={labelCls}>সংশোধনের কারণ (আবশ্যক)</label><input className={inputCls} required value={corrNote} onChange={(e) => setCorrNote(e.target.value)} /></div>
              <div className="flex items-end"><button className={btnCls} disabled={busy}>সংশোধন</button></div>
            </form>
          </section>

          <section className="rounded-xl border p-4">
            <h2 className="font-bold">শিফট রোস্টার</h2>
            <div className="mt-2 max-w-xs"><label className={labelCls}>সদস্য</label>
              <select className={inputCls} value={shiftMember} onChange={(e) => { setShiftMember(e.target.value); void loadShiftsFor(e.target.value); }}>
                <option value="">বেছে নিন</option>
                {staff.map((s) => <option key={s.membershipId} value={s.membershipId}>{s.name ?? s.email}</option>)}
              </select>
            </div>
            {shiftRows.map((r, i) => (
              <div key={i} className="mt-2 flex flex-wrap items-end gap-2">
                <div><label className={labelCls}>বার</label>
                  <select className={inputCls} value={r.weekday} onChange={(e) => setShiftRows(shiftRows.map((x, j) => j === i ? { ...x, weekday: e.target.value } : x))}>
                    {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{weekdayLabel(d)}</option>)}
                  </select>
                </div>
                <div><label className={labelCls}>শুরু</label><input className={inputCls} type="time" value={r.start} onChange={(e) => setShiftRows(shiftRows.map((x, j) => j === i ? { ...x, start: e.target.value } : x))} /></div>
                <div><label className={labelCls}>শেষ</label><input className={inputCls} type="time" value={r.end} onChange={(e) => setShiftRows(shiftRows.map((x, j) => j === i ? { ...x, end: e.target.value } : x))} /></div>
                <button className={btnGhost} onClick={() => setShiftRows(shiftRows.filter((_, j) => j !== i))}>মুছুন</button>
              </div>
            ))}
            <div className="mt-3 flex gap-2">
              <button className={btnGhost} onClick={() => setShiftRows([...shiftRows, { weekday: "0", start: "09:00", end: "17:00" }])}>+ সারি</button>
              <button className={btnCls} disabled={busy || !shiftMember} onClick={() => void act(async () => {
                const patterns = shiftRows.map((r) => {
                  const s = parseTimeToMinutes(r.start); const en = parseTimeToMinutes(r.end);
                  if (s == null || en == null) throw new Error("শিফটের সময় সঠিক নয়");
                  return { weekday: Number(r.weekday), startMinute: s, endMinute: en, active: true };
                });
                await apiFetch(`/organizations/${orgId}/hr/shifts/${shiftMember}`, { method: "PUT", body: JSON.stringify({ patterns }) });
              }, "শিফট রোস্টার সংরক্ষিত")}>সংরক্ষণ</button>
            </div>
          </section>

          <section className="rounded-xl border p-4">
            <h2 className="font-bold">ছুটির আবেদনের সারি</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {leaveQueue.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-2">
                  <span>{l.member?.name ?? l.membershipId} · {l.fromDate} → {l.toDate} ({l.days} দিন) · {leavePaidLabel(l.paid)} · <b>{leaveStatusLabel(l.status)}</b>{l.reason ? ` · ${l.reason}` : ""}</span>
                  {l.status === "pending" && (
                    <span className="flex gap-2">
                      <button className={btnCls} disabled={busy} onClick={() => void act(async () => { await apiFetch(`/organizations/${orgId}/hr/leave/${l.id}/decide`, { method: "POST", body: JSON.stringify({ decision: "approved" }) }); }, "অনুমোদিত হয়েছে")}>অনুমোদন</button>
                      <button className={btnGhost} disabled={busy} onClick={() => void act(async () => { await apiFetch(`/organizations/${orgId}/hr/leave/${l.id}/decide`, { method: "POST", body: JSON.stringify({ decision: "rejected" }) }); }, "প্রত্যাখ্যান করা হয়েছে")}>প্রত্যাখ্যান</button>
                    </span>
                  )}
                </li>
              ))}
              {!leaveQueue.length && <li className="text-slate-500">কোনো আবেদন নেই।</li>}
            </ul>
          </section>

          <section className="rounded-xl border p-4">
            <h2 className="font-bold">পে-রোল রান</h2>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div><label className={labelCls}>বছর</label><input className={inputCls} type="number" value={runYear} onChange={(e) => setRunYear(Number(e.target.value))} /></div>
              <div><label className={labelCls}>মাস</label>
                <select className={inputCls} value={runMonth} onChange={(e) => setRunMonth(Number(e.target.value))}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <button className={btnCls} disabled={busy} onClick={() => void act(async () => {
                const { run } = await apiFetch<{ run: PayrollRunView }>(`/organizations/${orgId}/hr/payroll/runs`, { method: "POST", body: JSON.stringify({ year: runYear, month: runMonth }) });
                setRunDetail(run);
              }, "খসড়া রান তৈরি হয়েছে")}>খসড়া রান তৈরি / পুনরায় তৈরি</button>
            </div>
            <ul className="mt-3 space-y-1 text-sm">
              {runs.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-2">
                  <span>{r.year}-{String(r.month).padStart(2, "0")} · মোট {fmtM(r.totalMinor)} · <b>{runStatusLabel(r.status)}</b>{r.journalEntryId ? " · জার্নাল এন্ট্রি আছে" : ""}</span>
                  <button className={btnGhost} onClick={() => void loadRunDetail(r.id)}>বিস্তারিত</button>
                </li>
              ))}
              {!runs.length && <li className="text-slate-500">কোনো রান নেই।</li>}
            </ul>

            {runDetail && (
              <div className="mt-4 rounded-lg border p-3">
                <h3 className="font-semibold">{runDetail.year}-{String(runDetail.month).padStart(2, "0")} · {runStatusLabel(runDetail.status)} · মোট {fmtM(runDetail.totalMinor)}</h3>
                <p className="mt-1 text-xs text-slate-600">{PAYROLL_RECORD_NOTE}</p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-semibold">নিয়মের স্ন্যাপশট (Rule Snapshot — হুবহু)</summary>
                  <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(runDetail.ruleSnapshot, null, 2)}</pre>
                </details>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr><th className={thCls}>সদস্য</th><th className={thCls}>মূল বেতন</th><th className={thCls}>বেতনবিহীন ছুটি</th><th className={thCls}>কর্তন</th><th className={thCls}>কমিশন (রেকর্ডকৃত)</th><th className={thCls}>সমন্বয়</th><th className={thCls}>মোট</th><th className={thCls}></th></tr></thead>
                    <tbody>
                      {(runDetail.lines ?? []).map((l) => (
                        <tr key={l.id} className="border-t">
                          <td className={tdCls}>{l.member?.name ?? l.membershipId}</td>
                          <td className={tdCls}>{fmtM(l.baseMinor)}</td>
                          <td className={tdCls}>{l.unpaidLeaveDays} দিন</td>
                          <td className={tdCls}>{fmtM(l.deductionMinor)}</td>
                          <td className={tdCls}>{fmtM(l.commissionMinor)}</td>
                          <td className={tdCls}>
                            {l.adjustments.map((a, i) => <div key={i}>{a.label}: {fmtM(a.amountMinor)} <span className="text-xs text-slate-500">({a.note})</span></div>)}
                            {runDetail.status === "draft" && (
                              <div className="mt-1 space-y-1">
                                <input className="w-full rounded border px-2 py-1" placeholder="Label (যেমন বোনাস)" value={adjDrafts[l.id]?.label ?? ""} onChange={(e) => setAdjDrafts({ ...adjDrafts, [l.id]: { ...(adjDrafts[l.id] ?? { label: "", amount: "", note: "" }), label: e.target.value } })} />
                                <input className="w-full rounded border px-2 py-1" placeholder="পরিমাণ (minor, ঋণাত্মক হতে পারে)" value={adjDrafts[l.id]?.amount ?? ""} onChange={(e) => setAdjDrafts({ ...adjDrafts, [l.id]: { ...(adjDrafts[l.id] ?? { label: "", amount: "", note: "" }), amount: e.target.value } })} />
                                <input className="w-full rounded border px-2 py-1" placeholder="নোট (আবশ্যক)" value={adjDrafts[l.id]?.note ?? ""} onChange={(e) => setAdjDrafts({ ...adjDrafts, [l.id]: { ...(adjDrafts[l.id] ?? { label: "", amount: "", note: "" }), note: e.target.value } })} />
                                <button className={btnGhost} disabled={busy} onClick={() => {
                                  const d = adjDrafts[l.id];
                                  if (!d?.label || !d?.amount || !d?.note) { setError("সমন্বয়ের label, পরিমাণ ও নোট — তিনটিই আবশ্যক"); return; }
                                  void act(async () => {
                                    await apiFetch(`/organizations/${orgId}/hr/payroll/runs/${runDetail.id}/lines/${l.id}`, { method: "PATCH", body: JSON.stringify({ adjustments: [...l.adjustments, { label: d.label, amountMinor: d.amount, note: d.note }] }) });
                                    await loadRunDetail(runDetail.id);
                                  }, "সমন্বয় যোগ হয়েছে");
                                }}>+ সমন্বয় যোগ</button>
                              </div>
                            )}
                          </td>
                          <td className={tdCls}><b>{fmtM(l.totalMinor)}</b></td>
                          <td className={tdCls}>
                            <button className={btnGhost} onClick={() => downloadPdf(`/organizations/${orgId}/hr/payroll/runs/${runDetail.id}/lines/${l.id}/payslip/pdf`, `payslip-${l.id}.pdf`).catch((e) => setError(e.message))}>পে-স্লিপ PDF</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {runDetail.status === "draft" && isOwner && (
                  <button className={`${btnCls} mt-3`} disabled={busy} onClick={() => void act(async () => {
                    const r = await apiFetch<any>(`/organizations/${orgId}/hr/payroll/runs/${runDetail.id}/mark-paid`, { method: "POST" });
                    setRunDetail(r.run);
                  }, "পরিশোধের রেকর্ড করা হয়েছে (জার্নাল এন্ট্রিসহ)")}>পরিশোধিত হিসেবে রেকর্ড করুন (শুধু OWNER)</button>
                )}
                {runDetail.status === "draft" && !isOwner && <p className="mt-3 text-sm text-slate-500">Mark-paid শুধু OWNER করতে পারবেন।</p>}
                {runDetail.status === "paid" && <p className="mt-3 text-sm text-emerald-700">পরিশোধের রেকর্ড: {runDetail.paidBy} · {runDetail.paidAt ? new Date(runDetail.paidAt).toLocaleString() : ""}{runDetail.journalEntryId ? ` · NF10 জার্নাল এন্ট্রি: ${runDetail.journalEntryId}` : ""}</p>}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
