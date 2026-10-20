"use client";
import React, { useCallback, useEffect, useState } from "react";
import { shopT } from "@/lib/shop-i18n";
import { useParams } from "next/navigation";
import { formatMinor, fmtNumber } from "@repo/contracts";
import {
  bookingStatusChip, fetchPublicServices, fetchPublicSlots, fetchPublicStaff,
  slotTimeLabel, submitPublicBooking, ymdInZone,
  type PublicStaffList, type ServiceBookingView, type ServiceOfferingView,
} from "@/lib/booking";

// NF4 (FB2) — public storefront booking page: pick a service →
// staff → date → a free slot → name/phone → book. The API only
// ever returns free slots (never other customers' bookings).
// A fresh booking starts "pending" (অপেক্ষমাণ) — the shop
// confirms it; when the shop's deposit config asks for a manual
// deposit, the confirmation panel shows the API's depositLabel
// verbatim (manual payment only, nothing is charged online).

function money(minor: string): string {
  try { return formatMinor(BigInt(minor)); } catch { return minor; }
}

export default function PublicBookingPage() {
  // MB4 (CD-3): the shop's locale arrives on the public services
  // payload; until it loads the page renders in bn (the platform
  // default), then re-renders in the shop's language.
  const [locale, setLocale] = useState<string>("bn");
  const t = shopT(locale);
  const params = useParams<{ orgSlug: string }>();
  const orgSlug = String(params?.orgSlug ?? "");

  const [orgName, setOrgName] = useState("");
  const [services, setServices] = useState<ServiceOfferingView[]>([]);
  const [staffList, setStaffList] = useState<PublicStaffList["staff"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(() => ymdInZone());
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsTz, setSlotsTz] = useState("Asia/Dhaka");
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotPick, setSlotPick] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<ServiceBookingView | null>(null);

  useEffect(() => {
    if (!orgSlug) return;
    let alive = true;
    (async () => {
      try {
        const [svc, stf] = await Promise.all([
          fetchPublicServices(orgSlug),
          fetchPublicStaff(orgSlug),
        ]);
        if (!alive) return;
        setOrgName(svc.orgName);
        if (svc.locale) setLocale(svc.locale);
        setServices(svc.services);
        setStaffList(stf.staff);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : t.booking.loadFailed);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [orgSlug]);

  const loadSlots = useCallback(async () => {
    if (!serviceId || !staffId || !date) { setSlots([]); return; }
    setSlotsLoading(true);
    try {
      const res = await fetchPublicSlots(orgSlug, serviceId, staffId, date);
      setSlots(res.slots);
      if (res.timezone) setSlotsTz(res.timezone);
    } catch {
      setSlots([]);
    } finally {
      setSlotsLoading(false);
    }
  }, [orgSlug, serviceId, staffId, date]);

  useEffect(() => { setSlotPick(""); void loadSlots(); }, [loadSlots]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!slotPick) { setError(t.booking.pickSlot); return; }
    if (!guestName.trim()) { setError(t.booking.nameRequired); return; }
    const startTime = slotTimeLabel(slotPick, slotsTz);
    setSubmitting(true);
    try {
      const booking = await submitPublicBooking(orgSlug, {
        serviceId, staffId, date, startTime,
        guestName: guestName.trim(), guestPhone: guestPhone.trim(),
        note: note.trim() || null,
      });
      setDone(booking);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.booking.bookingFailed);
      void loadSlots();
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-slate-500">{t.booking.loading}</div>;

  if (done) {
    const chip = bookingStatusChip(done.status);
    const service = services.find((s) => s.id === done.serviceId);
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <p className="text-2xl">✅</p>
          <h1 className="mt-2 text-lg font-semibold">{t.booking.receivedTitle}</h1>
          <p className="mt-2 text-sm text-slate-600">
            {t.booking.bookingSummary.replace("{service}", service?.name ?? t.booking.serviceFallback).replace("{date}", date).replace("{time}", slotTimeLabel(done.startAt, slotsTz))}
          </p>
          <p className="mt-2 text-sm">
            {t.booking.statusLabel}<span className={`rounded-full px-2 py-0.5 text-xs ${chip.cls}`}>{chip.label}</span>
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {t.booking.confirmNote}
          </p>
          {done.depositState !== "not_required" && (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{done.depositLabel}</p>
          )}
          <button onClick={() => { setDone(null); setSlotPick(""); void loadSlots(); }}
            className="mt-5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm">
            {t.booking.bookAnother}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-semibold">{t.booking.pageTitle}{orgName ? ` — ${orgName}` : ""}</h1>
      <p className="mt-1 text-sm text-slate-500">{t.booking.pageSub}</p>

      {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <form onSubmit={submit} className="mt-6 space-y-6">
        <section>
          <h2 className="mb-2 text-sm font-semibold">{t.booking.step1Prefix}{t.booking.step1}</h2>
          {services.length === 0 ? (
            <p className="text-sm text-slate-500">{t.booking.noServices}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {services.map((s) => (
                <button type="button" key={s.id} onClick={() => setServiceId(s.id)}
                  className={`rounded-xl border px-4 py-3 text-left ${serviceId === s.id ? "border-slate-900 bg-slate-50" : "border-slate-200"}`}>
                  <span className="block text-sm font-medium">{s.name}</span>
                  <span className="block text-xs text-slate-500">
                    {fmtNumber("bn", s.durationMinutes)}{t.booking.minutesSuffix}{money(s.priceMinor)}
                  </span>
                  {s.description ? <span className="mt-1 block text-xs text-slate-500">{s.description}</span> : null}
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">{t.booking.step2Prefix}{t.booking.step2}</h2>
          {staffList.length === 0 ? (
            <p className="text-sm text-slate-500">{t.booking.noStaff}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {staffList.map((s) => (
                <button type="button" key={s.id} onClick={() => setStaffId(s.id)}
                  className={`rounded-lg px-3 py-1.5 text-sm ${staffId === s.id ? "bg-slate-900 text-white" : "border border-slate-300"}`}>
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">{t.booking.step3Prefix}{t.booking.step3}</h2>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <div className="mt-3">
            {!serviceId || !staffId ? (
              <p className="text-sm text-slate-400">{t.booking.pickServiceFirst}</p>
            ) : slotsLoading ? (
              <p className="text-sm text-slate-400">{t.booking.searchingSlots}</p>
            ) : slots.length === 0 ? (
              <p className="text-sm text-slate-500">{t.booking.noSlots}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {slots.map((s) => (
                  <button type="button" key={s} onClick={() => setSlotPick(s)}
                    className={`rounded-lg px-3 py-1.5 text-sm ${slotPick === s ? "bg-slate-900 text-white" : "border border-slate-300"}`}>
                    {slotTimeLabel(s, slotsTz)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">{t.booking.step4Prefix}{t.booking.step4}</h2>
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder={t.booking.namePlaceholder}
            value={guestName} onChange={(e) => setGuestName(e.target.value)} />
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder={t.booking.phonePlaceholder}
            inputMode="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} />
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder={t.booking.notePlaceholder}
            value={note} onChange={(e) => setNote(e.target.value)} />
        </section>

        <button type="submit" disabled={submitting || !slotPick}
          className="w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50">
          {submitting ? t.booking.submitting : t.booking.confirmButton}
        </button>
        <p className="text-center text-xs text-slate-400">
          {t.booking.pendingNote}
        </p>
      </form>
    </div>
  );
}
