"use client";
import React, { useCallback, useEffect, useState } from "react";
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
      toast({ title: e instanceof Error ? e.message : "লোড ব্যর্থ হয়েছে", tone: "error" });
    } finally {
      setLoading(false);
    }
  }, [orgId, toast]);

  useEffect(() => { void load(); }, [load]);

  const submitService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    const priceNum = Number(price);
    if (!name.trim()) { toast({ title: "সার্ভিসের নাম দিন", tone: "error" }); return; }
    if (!Number.isFinite(priceNum) || priceNum < 0) { toast({ title: "মূল্য সঠিক টাকায় দিন", tone: "error" }); return; }
    setBusy("service-create");
    try {
      await createService(orgId, {
        name: name.trim(),
        description: description.trim() || null,
        durationMinutes: Number(duration),
        priceMinor: String(Math.round(priceNum * 100)),
        bufferMinutes: Number(buffer) || 0,
      });
      toast({ title: "সার্ভিস তৈরি হয়েছে", tone: "success" });
      setName(""); setDescription(""); setPrice(""); setDuration("60"); setBuffer("0");
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "সার্ভিস তৈরি ব্যর্থ হয়েছে", tone: "error" });
    } finally { setBusy(""); }
  };

  const toggleService = async (s: ServiceOfferingView) => {
    if (!orgId) return;
    setBusy(`svc-${s.id}`);
    try {
      await updateService(orgId, s.id, { active: !s.active });
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "হালনাগাদ ব্যর্থ হয়েছে", tone: "error" });
    } finally { setBusy(""); }
  };

  const staffMembershipIds = new Set(staff.map((s) => s.membershipId));
  const addableMembers = members.filter(
    (m) => m.status === "ACTIVE" && !staffMembershipIds.has(m.id),
  );

  const submitStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !memberPick) { toast({ title: "একজন সদস্য বেছে নিন", tone: "error" }); return; }
    setBusy("staff-add");
    try {
      await addStaff(orgId, memberPick, displayName.trim() || undefined);
      toast({ title: "স্টাফ যোগ হয়েছে", tone: "success" });
      setMemberPick(""); setDisplayName("");
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "স্টাফ যোগ ব্যর্থ হয়েছে", tone: "error" });
    } finally { setBusy(""); }
  };

  const toggleStaff = async (s: ServiceStaffView) => {
    if (!orgId) return;
    setBusy(`stf-${s.id}`);
    try {
      await setStaffActive(orgId, s.id, !s.active);
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "হালনাগাদ ব্যর্থ হয়েছে", tone: "error" });
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
      toast({ title: err instanceof Error ? err.message : "সময়সূচি লোড ব্যর্থ হয়েছে", tone: "error" });
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
      toast({ title: "সময়সূচি সংরক্ষিত হয়েছে", tone: "success" });
      setEditorStaffId(null);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "সংরক্ষণ ব্যর্থ হয়েছে", tone: "error" });
    } finally { setBusy(""); }
  };

  if (!orgId) return <p className="text-sm text-slate-500">Organization পাওয়া যায়নি।</p>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">সার্ভিস ও স্টাফ</h1>
        <p className="text-sm text-slate-500">
          বুকিংযোগ্য সার্ভিস, স্টাফ ও তাদের সাপ্তাহিক সময়সূচি। গ্রাহকরা দোকানের পাবলিক বুকিং পেজ থেকে
          ফাঁকা স্লটে বুকিং দিতে পারবেন। ডিপোজিট থাকলে তা ম্যানুয়াল — অনলাইন পেমেন্ট এই ফ্লোতে নেওয়া হয় না।
        </p>
      </div>

      {/* ---------- Offerings ---------- */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold">সার্ভিসসমূহ</h2>
        <form onSubmit={submitService} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-5">
          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="সার্ভিসের নাম *"
            value={name} onChange={(e) => setName(e.target.value)} />
          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="বিবরণ (ঐচ্ছিক)"
            value={description} onChange={(e) => setDescription(e.target.value)} />
          <label className="text-xs text-slate-500">সময়কাল (মিনিট)
            <input type="number" min={5} max={1440} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={duration} onChange={(e) => setDuration(e.target.value)} />
          </label>
          <label className="text-xs text-slate-500">মূল্য (টাকা) *
            <input type="number" min={0} step="0.01" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label className="text-xs text-slate-500">বাফার (মিনিট)
            <input type="number" min={0} max={240} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={buffer} onChange={(e) => setBuffer(e.target.value)} />
          </label>
          <div className="md:col-span-5">
            <button type="submit" disabled={busy === "service-create"}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              সার্ভিস যোগ করুন
            </button>
          </div>
        </form>

        {loading ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : services.length === 0 ? (
          <p className="text-sm text-slate-500">এখনো কোনো সার্ভিস নেই।</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr><th className="px-4 py-2">নাম</th><th className="px-4 py-2">সময়কাল</th><th className="px-4 py-2">মূল্য</th><th className="px-4 py-2">বাফার</th><th className="px-4 py-2">অবস্থা</th><th className="px-4 py-2" /></tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium">{s.name}
                      {s.description ? <span className="block text-xs font-normal text-slate-500">{s.description}</span> : null}
                    </td>
                    <td className="px-4 py-2">{s.durationMinutes} মিনিট</td>
                    <td className="px-4 py-2">{fmtMoneyBn(s.priceMinor)}</td>
                    <td className="px-4 py-2">{s.bufferMinutes} মিনিট</td>
                    <td className="px-4 py-2">{s.active ? "সক্রিয়" : "বন্ধ"}</td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => void toggleService(s)} disabled={busy === `svc-${s.id}`}
                        className="rounded-lg border border-slate-300 px-3 py-1 text-xs disabled:opacity-50">
                        {s.active ? "বন্ধ করুন" : "চালু করুন"}
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
        <h2 className="text-base font-semibold">বুকিংযোগ্য স্টাফ</h2>
        <p className="text-xs text-slate-500">
          স্টাফ মানে টিমের বিদ্যমান সদস্যরাই — নতুন কোনো ব্যবহারকারী তৈরি হয় না। সদস্য তালিকা Team Settings থেকে আসে।
        </p>
        <form onSubmit={submitStaff} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <label className="text-xs text-slate-500">সদস্য বেছে নিন
            <select className="mt-1 block w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={memberPick} onChange={(e) => setMemberPick(e.target.value)}>
              <option value="">— সদস্য —</option>
              {addableMembers.map((m) => (
                <option key={m.id} value={m.id}>{m.user.name} ({m.user.email}) — {m.role}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500">প্রদর্শিত নাম (ঐচ্ছিক)
            <input className="mt-1 block w-52 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="যেমন: রাবেয়া (সিনিয়র)" />
          </label>
          <button type="submit" disabled={busy === "staff-add"}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            স্টাফ যোগ করুন
          </button>
          {addableMembers.length === 0 && (
            <span className="text-xs text-slate-400">সব সক্রিয় সদস্যই ইতিমধ্যে স্টাফ তালিকায় আছেন (বা কোনো সদস্য নেই)।</span>
          )}
        </form>

        <div className="space-y-3">
          {staff.map((s) => (
            <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{s.displayName ?? s.memberName ?? "স্টাফ"}</p>
                  <p className="text-xs text-slate-500">
                    {s.memberName ?? ""}{s.memberEmail ? ` · ${s.memberEmail}` : ""} · {s.active ? "সক্রিয়" : "বন্ধ"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => void openEditor(s)} disabled={busy === `avail-${s.id}`}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50">
                    সময়সূচি {editorStaffId === s.id ? "বন্ধ করুন" : "সম্পাদনা"}
                  </button>
                  <button onClick={() => void toggleStaff(s)} disabled={busy === `stf-${s.id}`}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50">
                    {s.active ? "স্টাফ বন্ধ করুন" : "স্টাফ চালু করুন"}
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
                            এই দিনে আরও {row.extraWindows}টি সময়সীমা আছে — এই সহজ এডিটরে শুধু প্রথমটি দেখানো হচ্ছে; সংরক্ষণ করলে বাকিগুলো মুছে যাবে।
                          </span>
                        )}
                      </div>
                    );
                  })}
                  <button onClick={() => void saveEditor()} disabled={busy === "avail-save"}
                    className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                    সময়সূচি সংরক্ষণ করুন
                  </button>
                </div>
              )}
            </div>
          ))}
          {!loading && staff.length === 0 && <p className="text-sm text-slate-500">এখনো কোনো স্টাফ নেই।</p>}
        </div>
      </section>
    </div>
  );
}
