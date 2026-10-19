"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
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
  const { dict, t, locale } = useLocale();
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
      toast({ title: e instanceof Error ? e.message : dict.commerce.loadingFailed2, tone: "error" });
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
      toast({ title: dict.commerce.updated, tone: "success" });
      await load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : dict.commerce.updateFailed, tone: "error" });
    } finally { setBusy(""); }
  };

  const submitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    if (!slotPick) { toast({ title: dict.commerce.selectAnEmptySlot, tone: "error" }); return; }
    if (!guestName.trim() || !guestPhone.trim()) { toast({ title: dict.commerce.giveTheGuestSName, tone: "error" }); return; }
    setBusy("create");
    try {
      const created = await createBooking(orgId, {
        serviceId: formService, staffId: formStaff, startAt: slotPick,
        guestName: guestName.trim(), guestPhone: guestPhone.trim(),
        note: note.trim() || null,
      });
      toast({ title: t("commerce.bookingCreated", { label: bookingStatusChip(created.status).label }), tone: "success" });
      setGuestName(""); setGuestPhone(""); setNote(""); setSlotPick("");
      await load();
      await loadSlots();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : dict.commerce.bookingCreationFailed, tone: "error" });
    } finally { setBusy(""); }
  };

  const groups = groupBookingsByStaff(bookings);

  if (!orgId) return <p className="text-sm text-slate-500">{dict.commerce.organizationNotFound}</p>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">{dict.commerce.booking}</h1>
        <p className="text-sm text-slate-500">
          {dict.commerce.theDaySAppointmentsSorted}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-500">{dict.commerce.date}<input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-xs text-slate-500">{dict.commerce.staff}<select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">{dict.commerce.everyone}</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName ?? s.memberName ?? dict.commerce.staff}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">{dict.commerce.status}<select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">{dict.commerce.all}</option>
            <option value="pending">{dict.commerce.pending}</option>
            <option value="confirmed">{dict.commerce.confirmed}</option>
            <option value="completed">{dict.commerce.completed}</option>
            <option value="cancelled">{dict.common.cancel}</option>
            <option value="no_show">{dict.commerce.didNotShowUp}</option>
          </select>
        </label>
      </div>

      {loading ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : groups.length === 0 ? (
        <p className="text-sm text-slate-500">{dict.commerce.noBookingsOnThisDay}</p>
      ) : groups.map((g) => (
        <section key={g.staffId} className="space-y-3">
          <h2 className="text-base font-semibold">{g.staffName}</h2>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">{dict.commerce.time}</th><th className="px-4 py-2">{dict.commerce.guest}</th>
                  <th className="px-4 py-2">{dict.commerce.service}</th><th className="px-4 py-2">{dict.commerce.status}</th>
                  <th className="px-4 py-2">{dict.commerce.deposit}</th><th className="px-4 py-2" />
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
                        <span className="block text-xs text-slate-500">{b.guestPhone} · {b.source === "storefront" ? dict.commerce.onlineBooking : dict.commerce.dashboard}</span>
                        {b.note ? <span className="block text-xs text-slate-500">📝 {b.note}</span> : null}
                        {b.reminderStatus ? (
                          <span className="block text-xs text-slate-400">
                            {dict.commerce.reminder}{b.reminderStatus === "sent" ? dict.commerce.sent : b.reminderStatus === "failed_no_channel" ? dict.commerce.couldNotSendNoSMS : dict.commerce.sendFailed}
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
                              {dict.commerce.depositReceived}</button>
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
        <h2 className="text-base font-semibold">{dict.commerce.newBookingPhoneCounter}</h2>
        <form onSubmit={submitBooking} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs text-slate-500">{dict.commerce.service}<select value={formService} onChange={(e) => setFormService(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">{dict.commerce.select}</option>
                {services.filter((s) => s.active).map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.durationMinutes} {dict.commerce.minutes2}{fmtMoneyBn(s.priceMinor)})</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">{dict.commerce.staff}<select value={formStaff} onChange={(e) => setFormStaff(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">{dict.commerce.select}</option>
                {staff.filter((s) => s.active).map((s) => (
                  <option key={s.id} value={s.id}>{s.displayName ?? s.memberName ?? dict.commerce.staff}</option>
                ))}
              </select>
            </label>
            <span className="text-xs text-slate-500">{dict.commerce.dateSelectedAbove}<b className="text-slate-700">{date}</b></span>
          </div>
          <div>
            <p className="mb-2 text-xs text-slate-500">{dict.commerce.emptySlot}</p>
            {slots.length === 0 ? (
              <p className="text-sm text-slate-400">{dict.commerce.whenAServiceStaffAre}</p>
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
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder={dict.commerce.guestName}
              value={guestName} onChange={(e) => setGuestName(e.target.value)} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder={dict.commerce.phoneNumber2}
              value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder={dict.commerce.noteOptional}
              value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <button type="submit" disabled={busy === "create"}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {dict.commerce.createBooking}</button>
        </form>
      </section>
    </div>
  );
}
