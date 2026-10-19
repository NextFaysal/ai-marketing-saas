"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { fmtMoneyBn } from "@/lib/money-bn";
import {
  WEEKDAY_ROWS, addStaff, apiRowsToEditor, availabilityError, createService,
  editorRowsToApi, fetchAvailability, fetchServices, fetchStaff, saveAvailability,
  setStaffActive, updateService,
  type AvailabilityRow, type ServiceOfferingView, type ServiceStaffView,
} from "@/lib/booking";
import { useToast } from "@repo/ui/client";

// NF4 (FB2) — Services & staff setup for the Service &
// Appointment business type: offerings (CRUD-lite), bookable
// staff (existing team members only — no new user records), and
// each staff member's weekly availability editor.

interface Member {
  id: string; role: string; status: string;
  user: { id: string; name: string; email: string };
}

interface EditorRow { weekday: number; enabled: boolean; start: string; end: string; extraWindows: number }

export default function ServicesPage() {
  const { dict, t, locale } = useLocale();
  const { toast } = useToast();
  const orgId = getOrganizationId();
  const [services, setServices] = useState<ServiceOfferingView[]>([]);
  const [staff, setStaff] = useState<ServiceStaffView[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  // Create-service form (price typed in taka, sent as paisa).
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("60");
  const [price, setPrice] = useState("");
  const [buffer, setBuffer] = useState("0");

  // Add-staff picker.
  const [memberPick, setMemberPick] = useState("");
  const [displayName, setDisplayName] = useState("");

  // Availability editor (one staff at a time).
  const [editorStaffId, setEditorStaffId] = useState<string | null>(null);
  const [editorRows, setEditorRows] = useState<EditorRow[]>([]);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [svc, stf, mem] = await Promise.all([
        fetchServices(orgId),
        fetchStaff(orgId),
        apiFetch<Member[]>(`/organizations/${orgId}/members`).catch(() => [] as Member[]),
      ]);
      setServices(svc);
      setStaff(stf);
      setMembers(mem);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : dict.commerce.loadingFailed2, tone: "error" });
    } finally {
      setLoading(false);
    }
  }, [orgId, toast]);

  useEffect(() => { void load(); }, [load]);

  const submitService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    const priceNum = Number(price);
    if (!name.trim()) { toast({ title: dict.commerce.giveTheServiceAName, tone: "error" }); return; }
    if (!Number.isFinite(priceNum) || priceNum < 0) { toast({ title: dict.commerce.giveThePriceInCorrect, tone: "error" }); return; }
    setBusy("service-create");
    try {
      await createService(orgId, {
        name: name.trim(),
        description: description.trim() || null,
        durationMinutes: Number(duration),
        priceMinor: String(Math.round(priceNum * 100)),
        bufferMinutes: Number(buffer) || 0,
      });
      toast({ title: dict.commerce.serviceCreated, tone: "success" });
      setName(""); setDescription(""); setPrice(""); setDuration("60"); setBuffer("0");
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : dict.commerce.serviceCreationFailed, tone: "error" });
    } finally { setBusy(""); }
  };

  const toggleService = async (s: ServiceOfferingView) => {
    if (!orgId) return;
    setBusy(`svc-${s.id}`);
    try {
      await updateService(orgId, s.id, { active: !s.active });
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : dict.commerce.updateFailed, tone: "error" });
    } finally { setBusy(""); }
  };

  const staffMembershipIds = new Set(staff.map((s) => s.membershipId));
  const addableMembers = members.filter(
    (m) => m.status === "ACTIVE" && !staffMembershipIds.has(m.id),
  );

  const submitStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !memberPick) { toast({ title: dict.commerce.selectAMember2, tone: "error" }); return; }
    setBusy("staff-add");
    try {
      await addStaff(orgId, memberPick, displayName.trim() || undefined);
      toast({ title: dict.commerce.staffAdded, tone: "success" });
      setMemberPick(""); setDisplayName("");
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : dict.commerce.staffAddFailed, tone: "error" });
    } finally { setBusy(""); }
  };

  const toggleStaff = async (s: ServiceStaffView) => {
    if (!orgId) return;
    setBusy(`stf-${s.id}`);
    try {
      await setStaffActive(orgId, s.id, !s.active);
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : dict.commerce.updateFailed, tone: "error" });
    } finally { setBusy(""); }
  };

  const openEditor = async (s: ServiceStaffView) => {
    if (!orgId) return;
    if (editorStaffId === s.id) { setEditorStaffId(null); return; }
    setBusy(`avail-${s.id}`);
    try {
      const res = await fetchAvailability(orgId, s.id);
      setEditorRows(apiRowsToEditor(res.rows));
      setEditorStaffId(s.id);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : dict.commerce.scheduleLoadingFailed, tone: "error" });
    } finally { setBusy(""); }
  };

  const saveEditor = async () => {
    if (!orgId || !editorStaffId) return;
    const rows: AvailabilityRow[] = editorRowsToApi(editorRows);
    const err = availabilityError(rows);
    if (err) { toast({ title: err, tone: "error" }); return; }
    setBusy("avail-save");
    try {
      await saveAvailability(orgId, editorStaffId, rows);
      toast({ title: dict.commerce.scheduleSaved, tone: "success" });
      setEditorStaffId(null);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : dict.commerce.saveFailed2, tone: "error" });
    } finally { setBusy(""); }
  };

  if (!orgId) return <p className="text-sm text-slate-500">{dict.commerce.organizationNotFound}</p>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">{dict.commerce.servicesStaff}</h1>
        <p className="text-sm text-slate-500">
          {dict.commerce.bookableServicesStaffTheirWeekly}</p>
      </div>

      {/* ---------- Offerings ---------- */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold">{dict.commerce.services}</h2>
        <form onSubmit={submitService} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-5">
          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder={dict.commerce.serviceName}
            value={name} onChange={(e) => setName(e.target.value)} />
          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder={dict.commerce.descriptionOptional}
            value={description} onChange={(e) => setDescription(e.target.value)} />
          <label className="text-xs text-slate-500">{dict.commerce.durationMinutes}<input type="number" min={5} max={1440} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={duration} onChange={(e) => setDuration(e.target.value)} />
          </label>
          <label className="text-xs text-slate-500">{dict.commerce.priceTaka}<input type="number" min={0} step="0.01" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label className="text-xs text-slate-500">{dict.commerce.bufferMinutes}<input type="number" min={0} max={240} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={buffer} onChange={(e) => setBuffer(e.target.value)} />
          </label>
          <div className="md:col-span-5">
            <button type="submit" disabled={busy === "service-create"}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {dict.commerce.addService}</button>
          </div>
        </form>

        {loading ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : services.length === 0 ? (
          <p className="text-sm text-slate-500">{dict.commerce.noServicesYet}</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr><th className="px-4 py-2">{dict.commerce.name}</th><th className="px-4 py-2">{dict.commerce.period}</th><th className="px-4 py-2">{dict.commerce.price}</th><th className="px-4 py-2">{dict.commerce.buffer}</th><th className="px-4 py-2">{dict.commerce.status}</th><th className="px-4 py-2" /></tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium">{s.name}
                      {s.description ? <span className="block text-xs font-normal text-slate-500">{s.description}</span> : null}
                    </td>
                    <td className="px-4 py-2">{s.durationMinutes} {dict.commerce.minutes}</td>
                    <td className="px-4 py-2">{fmtMoneyBn(s.priceMinor)}</td>
                    <td className="px-4 py-2">{s.bufferMinutes} {dict.commerce.minutes}</td>
                    <td className="px-4 py-2">{s.active ? dict.commerce.active : dict.commerce.closed}</td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => void toggleService(s)} disabled={busy === `svc-${s.id}`}
                        className="rounded-lg border border-slate-300 px-3 py-1 text-xs disabled:opacity-50">
                        {s.active ? dict.commerce.close : dict.commerce.enable}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------- Staff ---------- */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold">{dict.commerce.bookableStaff}</h2>
        <p className="text-xs text-slate-500">
          {dict.commerce.staffMeansTheTeamS}</p>
        <form onSubmit={submitStaff} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <label className="text-xs text-slate-500">{dict.commerce.selectAMember}<select className="mt-1 block w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={memberPick} onChange={(e) => setMemberPick(e.target.value)}>
              <option value="">{dict.commerce.member}</option>
              {addableMembers.map((m) => (
                <option key={m.id} value={m.id}>{m.user.name} ({m.user.email}) — {m.role}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500">{dict.commerce.displayNameOptional}<input className="mt-1 block w-52 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={dict.commerce.eGRabeyaSenior} />
          </label>
          <button type="submit" disabled={busy === "staff-add"}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {dict.commerce.addStaff}</button>
          {addableMembers.length === 0 && (
            <span className="text-xs text-slate-400">{dict.commerce.allActiveMembersAreAlready}</span>
          )}
        </form>

        <div className="space-y-3">
          {staff.map((s) => (
            <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{s.displayName ?? s.memberName ?? dict.commerce.staff}</p>
                  <p className="text-xs text-slate-500">
                    {s.memberName ?? ""}{s.memberEmail ? ` · ${s.memberEmail}` : ""} · {s.active ? dict.commerce.active : dict.commerce.closed}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => void openEditor(s)} disabled={busy === `avail-${s.id}`}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50">
                    {dict.commerce.schedule}{editorStaffId === s.id ? dict.commerce.close : dict.commerce.edit}
                  </button>
                  <button onClick={() => void toggleStaff(s)} disabled={busy === `stf-${s.id}`}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50">
                    {s.active ? dict.commerce.disableStaff : dict.commerce.enableStaff}
                  </button>
                </div>
              </div>

              {editorStaffId === s.id && (
                <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                  {WEEKDAY_ROWS.map(({ weekday, label }) => {
                    const row = editorRows.find((r) => r.weekday === weekday);
                    if (!row) return null;
                    const patch = (p: Partial<EditorRow>) =>
                      setEditorRows((prev) => prev.map((r) => (r.weekday === weekday ? { ...r, ...p } : r)));
                    return (
                      <div key={weekday} className="flex flex-wrap items-center gap-3 text-sm">
                        <label className="flex w-28 items-center gap-2">
                          <input type="checkbox" checked={row.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
                          {label}
                        </label>
                        <input type="time" disabled={!row.enabled} value={row.start}
                          onChange={(e) => patch({ start: e.target.value })}
                          className="rounded-lg border border-slate-300 px-2 py-1 text-sm disabled:opacity-40" />
                        <span className="text-slate-400">—</span>
                        <input type="time" disabled={!row.enabled} value={row.end}
                          onChange={(e) => patch({ end: e.target.value })}
                          className="rounded-lg border border-slate-300 px-2 py-1 text-sm disabled:opacity-40" />
                        {row.extraWindows > 0 && (
                          <span className="text-xs text-amber-600">
                            {dict.commerce.moreOnThisDay}{row.extraWindows}{dict.commerce.timeRangesExistOnlyThe}</span>
                        )}
                      </div>
                    );
                  })}
                  <button onClick={() => void saveEditor()} disabled={busy === "avail-save"}
                    className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                    {dict.commerce.saveSchedule}</button>
                </div>
              )}
            </div>
          ))}
          {!loading && staff.length === 0 && <p className="text-sm text-slate-500">{dict.commerce.noStaffYet}</p>}
        </div>
      </section>
    </div>
  );
}
