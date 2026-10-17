"use client";
import React, { useCallback, useEffect, useState } from "react";
import { getOrganizationId } from "@/lib/org";
import { fmtMoneyBn } from "@/lib/money-bn";
import {
  bookingAction, bookingActions, bookingStatusChip, createBooking, dayRangeUtcIso,
  depositStateLabel, fetchBookings, fetchServices, fetchSlots, fetchStaff,
  groupBookingsByStaff, markDepositPaid, slotTimeLabel, ymdInZone,
  type ServiceBookingView, type ServiceOfferingView, type ServiceStaffView,
} from "@/lib/booking";
import { useToast } from "@repo/ui/client";

// NF4 (FB2) — Bookings day view: pick a date, see the day's
// appointments grouped by staff, run the status flow, mark a
// manual deposit paid, or take a phone booking into a free slot.
// Deposit text comes from the API's depositLabel verbatim —
// staff see exactly what state the deposit is in (manual only).

export default function BookingsPage() {
  const { toast } = useToast();
  const orgId = getOrganizationId();
  const [date, setDate] = useState(() => ymdInZone());
  const [bookings, setBookings] = useState<ServiceBookingView[]>([]);
  const [services, setServices] = useState<ServiceOfferingView[]>([]);
  const [staff, setStaff] = useState<ServiceStaffView[]>([]);
  const [staffFilter, setStaffFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  // Phone-booking form.
  const [formService, setFormService] = useState("");
  const [formStaff, setFormStaff] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [slotPick, setSlotPick] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const range = dayRangeUtcIso(date);
      const [bk, svc, stf] = await Promise.all([
        fetchBookings(orgId, {
          from: range.from, to: range.to,
          staffId: staffFilter || undefined, status: statusFilter || undefined,
        }),
        fetchServices(orgId),
        fetchStaff(orgId),
      ]);
      setBookings(bk);
      setServices(svc);
      setStaff(stf);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "লোড ব্যর্থ হয়েছে", tone: "error" });
    } finally {
      setLoading(false);
    }
  }, [orgId, date, staffFilter, statusFilter, toast]);

  useEffect(() => { void load(); }, [load]);

  const loadSlots = useCallback(async () => {
    if (!orgId || !formService || !formStaff || !date) { setSlots([]); return; }
    try {
      const res = await fetchSlots(orgId, formService, formStaff, date);
      setSlots(res.slots);
    } catch {
      setSlots([]);
    }
  }, [orgId, formService, formStaff, date]);

  useEffect(() => { setSlotPick(""); void loadSlots(); }, [loadSlots]);

  const act = async (b: ServiceBookingView, action: string) => {
    if (!orgId) return;
    setBusy(`${b.id}-${action}`);
    try {
      if (action === "deposit-paid") await markDepositPaid(orgId, b.id);
      else await bookingAction(orgId, b.id, action);
      toast({ title: "হালনাগাদ হয়েছে", tone: "success" });
      await load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "হালনাগাদ ব্যর্থ হয়েছে", tone: "error" });
    } finally { setBusy(""); }
  };

  const submitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    if (!slotPick) { toast({ title: "একটি ফাঁকা স্লট বেছে নিন", tone: "error" }); return; }
    if (!guestName.trim() || !guestPhone.trim()) { toast({ title: "অতিথির নাম ও ফোন দিন", tone: "error" }); return; }
    setBusy("create");
    try {
      const created = await createBooking(orgId, {
        serviceId: formService, staffId: formStaff, startAt: slotPick,
        guestName: guestName.trim(), guestPhone: guestPhone.trim(),
        note: note.trim() || null,
      });
      toast({ title: `বুকিং তৈরি হয়েছে (${bookingStatusChip(created.status).label})`, tone: "success" });
      setGuestName(""); setGuestPhone(""); setNote(""); setSlotPick("");
      await load();
      await loadSlots();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "বুকিং তৈরি ব্যর্থ হয়েছে", tone: "error" });
    } finally { setBusy(""); }
  };

  const groups = groupBookingsByStaff(bookings);

  if (!orgId) return <p className="text-sm text-slate-500">Organization পাওয়া যায়নি।</p>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">বুকিং</h1>
        <p className="text-sm text-slate-500">
          দিনের অ্যাপয়েন্টমেন্ট স্টাফ অনুযায়ী সাজানো। স্ট্যাটাস বদল ও ডিপোজিট নিশ্চিতকরণ এখান থেকেই —
          ডিপোজিট ম্যানুয়াল, কোনো অনলাইন পেমেন্ট এই ফ্লোতে হয় না।
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-500">তারিখ
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-xs text-slate-500">স্টাফ
          <select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">সবাই</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName ?? s.memberName ?? "স্টাফ"}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">অবস্থা
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">সব</option>
            <option value="pending">অপেক্ষমাণ</option>
            <option value="confirmed">নিশ্চিত</option>
            <option value="completed">সম্পন্ন</option>
            <option value="cancelled">বাতিল</option>
            <option value="no_show">আসেননি</option>
          </select>
        </label>
      </div>

      {loading ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : groups.length === 0 ? (
        <p className="text-sm text-slate-500">এই দিনে কোনো বুকিং নেই।</p>
      ) : groups.map((g) => (
        <section key={g.staffId} className="space-y-3">
          <h2 className="text-base font-semibold">{g.staffName}</h2>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">সময়</th><th className="px-4 py-2">অতিথি</th>
                  <th className="px-4 py-2">সার্ভিস</th><th className="px-4 py-2">অবস্থা</th>
                  <th className="px-4 py-2">ডিপোজিট</th><th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {g.bookings.map((b) => {
                  const chip = bookingStatusChip(b.status);
                  return (
                    <tr key={b.id} className="border-t border-slate-100 align-top">
                      <td className="px-4 py-2 whitespace-nowrap">{slotTimeLabel(b.startAt)} – {slotTimeLabel(b.endAt)}</td>
                      <td className="px-4 py-2">
                        <span className="font-medium">{b.guestName}</span>
                        <span className="block text-xs text-slate-500">{b.guestPhone} · {b.source === "storefront" ? "অনলাইন বুকিং" : "ড্যাশবোর্ড"}</span>
                        {b.note ? <span className="block text-xs text-slate-500">📝 {b.note}</span> : null}
                        {b.reminderStatus ? (
                          <span className="block text-xs text-slate-400">
                            রিমাইন্ডার: {b.reminderStatus === "sent" ? "পাঠানো হয়েছে" : b.reminderStatus === "failed_no_channel" ? "পাঠানো যায়নি (SMS চ্যানেল নেই)" : "পাঠাতে ব্যর্থ"}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2">{b.serviceName ?? "—"}</td>
                      <td className="px-4 py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${chip.cls}`}>{chip.label}</span></td>
                      <td className="px-4 py-2">
                        <span className="block">{depositStateLabel(b.depositState)}</span>
                        {b.depositState === "unpaid_manual" && (
                          <span className="block text-xs text-slate-500">
                            {fmtMoneyBn(b.depositRequiredMinor)} — {b.depositLabel}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {bookingActions(b.status).map((a) => (
                            <button key={a.key} onClick={() => void act(b, a.key)} disabled={busy === `${b.id}-${a.key}`}
                              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs disabled:opacity-50">
                              {a.label}
                            </button>
                          ))}
                          {b.depositState === "unpaid_manual" && (
                            <button onClick={() => void act(b, "deposit-paid")} disabled={busy === `${b.id}-deposit-paid`}
                              className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs text-white disabled:opacity-50">
                              ডিপোজিট পেয়েছি
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {/* ---------- Phone booking ---------- */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold">নতুন বুকিং (ফোন/কাউন্টার)</h2>
        <form onSubmit={submitBooking} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs text-slate-500">সার্ভিস
              <select value={formService} onChange={(e) => setFormService(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">— বেছে নিন —</option>
                {services.filter((s) => s.active).map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.durationMinutes} মিনিট, {fmtMoneyBn(s.priceMinor)})</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">স্টাফ
              <select value={formStaff} onChange={(e) => setFormStaff(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">— বেছে নিন —</option>
                {staff.filter((s) => s.active).map((s) => (
                  <option key={s.id} value={s.id}>{s.displayName ?? s.memberName ?? "স্টাফ"}</option>
                ))}
              </select>
            </label>
            <span className="text-xs text-slate-500">তারিখ (উপরে বেছে নেওয়া): <b className="text-slate-700">{date}</b></span>
          </div>
          <div>
            <p className="mb-2 text-xs text-slate-500">ফাঁকা স্লট</p>
            {slots.length === 0 ? (
              <p className="text-sm text-slate-400">সার্ভিস ও স্টাফ বেছে নিলে ফাঁকা স্লট দেখাবে (না থাকলে এই দিনে সময়সূচি/খালি স্লট নেই)।</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {slots.map((s) => (
                  <button type="button" key={s} onClick={() => setSlotPick(s)}
                    className={`rounded-lg px-3 py-1.5 text-sm ${slotPick === s ? "bg-slate-900 text-white" : "border border-slate-300"}`}>
                    {slotTimeLabel(s)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="অতিথির নাম *"
              value={guestName} onChange={(e) => setGuestName(e.target.value)} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="ফোন নম্বর *"
              value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="নোট (ঐচ্ছিক)"
              value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <button type="submit" disabled={busy === "create"}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            বুকিং তৈরি করুন
          </button>
        </form>
      </section>
    </div>
  );
}
