"use client";

/**
 * NF5 (FB3) — translation panel inside the dashboard product
 * edit modal (+ the shop-level display-currency rates editor).
 *
 * Honesty rules rendered, not just enforced server-side:
 * - every row shows its status: a draft says plainly "দোকানে
 *   দেখাবে না" — only an explicit অনুমোদন makes it public;
 * - AI generation is labelled AI খসড়া and lands as a draft;
 *   when the org has no working AI model the API's Bengali error
 *   is shown as-is (no fake translation appears);
 * - currency rates are typed by a human with a source note; the
 *   panel states no live rate is ever fetched and checkout is
 *   always charged in the base currency.
 */

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import {
  PRODUCT_TRANSLATION_FIELDS, STOREFRONT_STRING_FIELDS, TRANSLATION_LOCALES,
  canApprove, deleteCurrencyRate, fetchCurrencyRates, fetchProductTranslations,
  fetchStorefrontStringTranslations, findTranslation, generateProductAiDraft,
  generateStringsAiDraft, sourceLabel, statusLabel, updateTranslation, upsertCurrencyRate,
  upsertTranslation,
  type CurrencyRateView, type TranslationView,
} from "@/lib/translations";

function FieldEditor(props: {
  orgId: string;
  entityType: string;
  entityId: string;
  field: string;
  label: string;
  locale: string;
  existing: TranslationView | null;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const { dict, t, locale } = useLocale();
  const [text, setText] = useState(props.existing?.text ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(props.existing?.text ?? ""); }, [props.existing?.id, props.existing?.text, props.locale]);

  async function save() {
    setBusy(true);
    try {
      await upsertTranslation(props.orgId, {
        entityType: props.entityType, entityId: props.entityId,
        field: props.field, locale: props.locale, text: text.trim(),
        // Editing keeps the current approval state only when the
        // text is unchanged; a changed text goes back to draft —
        // new words are never silently public.
        status: props.existing && props.existing.text === text.trim() ? props.existing.status : "draft",
      });
      props.onChanged();
    } catch (e: any) {
      props.onError(e?.message ?? dict.products.couldNotSave);
    } finally { setBusy(false); }
  }

  async function setStatus(status: string) {
    if (!props.existing) return;
    setBusy(true);
    try {
      await updateTranslation(props.orgId, props.existing.id, { status });
      props.onChanged();
    } catch (e: any) {
      props.onError(e?.message ?? dict.products.couldNotUpdate);
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold text-slate-700">{props.label}</span>
        {props.existing ? (
          <>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${props.existing.status === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
              {statusLabel(props.existing.status)}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
              {sourceLabel(props.existing.source)}
            </span>
          </>
        ) : (
          <span className="text-[10px] text-slate-400">{dict.products.noTranslationYetTheShop}</span>
        )}
      </div>
      <textarea
        rows={props.field === "name" ? 1 : 3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={dict.products.writeTheTranslationOrGenerate}
        className="w-full rounded-lg border px-2.5 py-1.5 text-xs"
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !text.trim()} onClick={save}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
          {dict.common.save}</button>
        {canApprove(props.existing) && props.existing!.text === text.trim() ? (
          <button type="button" disabled={busy} onClick={() => setStatus("approved")}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
            {dict.products.approveWillShowInThe}</button>
        ) : null}
        {props.existing?.status === "approved" ? (
          <button type="button" disabled={busy} onClick={() => setStatus("draft")}
            className="rounded-lg border px-3 py-1.5 text-[11px] font-semibold text-slate-600 disabled:opacity-50">
            {dict.products.moveBackToDraft}</button>
        ) : null}
      </div>
    </div>
  );
}

export function ProductTranslationsPanel({ orgId, productId }: { orgId: string; productId: string }) {
  const { dict, t } = useLocale();
  const [locale, setLocale] = useState<string>("hi");
  const [productItems, setProductItems] = useState<TranslationView[]>([]);
  const [stringItems, setStringItems] = useState<TranslationView[]>([]);
  const [rates, setRates] = useState<{ baseCurrency: string; items: CurrencyRateView[] }>({ baseCurrency: "BDT", items: [] });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [rateForm, setRateForm] = useState({ currency: "", ratePerUnit: "", sourceNote: "" });

  const reload = useCallback(async () => {
    if (!orgId || !productId) return;
    const [p, s, r] = await Promise.all([
      fetchProductTranslations(orgId, productId).catch(() => ({ items: [] as TranslationView[] })),
      fetchStorefrontStringTranslations(orgId).catch(() => ({ items: [] as TranslationView[] })),
      fetchCurrencyRates(orgId).catch(() => ({ baseCurrency: "BDT", items: [] as CurrencyRateView[] })),
    ]);
    setProductItems(p.items);
    setStringItems(s.items);
    setRates(r);
  }, [orgId, productId]);

  useEffect(() => { void reload(); }, [reload]);

  async function aiDraft(kind: "product" | "strings") {
    setAiBusy(true); setError(""); setNotice("");
    try {
      const out = kind === "product"
        ? await generateProductAiDraft(orgId, productId, locale)
        : await generateStringsAiDraft(orgId, locale);
      setNotice(out.note);
      await reload();
    } catch (e: any) {
      setError(e?.message ?? dict.products.couldNotGenerateTheAI);
    } finally { setAiBusy(false); }
  }

  async function saveRate() {
    setError("");
    try {
      await upsertCurrencyRate(orgId, {
        currency: rateForm.currency.trim().toUpperCase(),
        ratePerUnit: rateForm.ratePerUnit.trim(),
        sourceNote: rateForm.sourceNote.trim(),
      });
      setRateForm({ currency: "", ratePerUnit: "", sourceNote: "" });
      await reload();
    } catch (e: any) {
      setError(e?.message ?? dict.products.couldNotSaveTheRate);
    }
  }

  async function removeRate(currency: string) {
    setError("");
    try {
      await deleteCurrencyRate(orgId, currency);
      await reload();
    } catch (e: any) {
      setError(e?.message ?? dict.products.couldNotDeleteTheRate);
    }
  }

  return (
    <div className="rounded-xl border border-teal-300 bg-teal-50/40 p-3.5 space-y-3">
      <div className="text-xs font-bold text-teal-950">{dict.products.translationsMultilingualShop}</div>
      <p className="text-[11px] text-slate-500">
        {dict.products.onlyApprovedTranslationsShowIn}<code>?locale=hi</code> {dict.products.buyersCanViewInThat}</p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] font-semibold text-slate-600" htmlFor="nf5-locale">{dict.products.language}</label>
        <select id="nf5-locale" value={locale} onChange={(e) => setLocale(e.target.value)}
          className="rounded-lg border px-2 py-1.5 text-xs">
          {TRANSLATION_LOCALES.map((l) => (
            <option key={l.code} value={l.code}>{l.label} ({l.code})</option>
          ))}
        </select>
        <button type="button" disabled={aiBusy} onClick={() => aiDraft("product")}
          className="rounded-lg bg-teal-700 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
          {aiBusy ? dict.products.creating : dict.products.generateAnAIDraftFor}
        </button>
        <button type="button" disabled={aiBusy} onClick={() => aiDraft("strings")}
          className="rounded-lg border border-teal-700 px-3 py-1.5 text-[11px] font-semibold text-teal-800 disabled:opacity-50">
          {dict.products.aIDraftOfTheShop}</button>
      </div>

      {notice ? <p className="rounded-lg bg-sky-50 px-2.5 py-1.5 text-[11px] text-sky-900">{notice}</p> : null}
      {error ? <p className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">{error}</p> : null}

      <div className="space-y-2">
        {PRODUCT_TRANSLATION_FIELDS.map((f) => (
          <FieldEditor key={`p-${f.field}-${locale}`} orgId={orgId} entityType="product" entityId={productId}
            field={f.field} label={f.label} locale={locale}
            existing={findTranslation(productItems, f.field, locale)}
            onChanged={reload} onError={setError} />
        ))}
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-bold text-slate-600">{dict.products.shopTextInThisLanguage}</div>
        {STOREFRONT_STRING_FIELDS.map((f) => (
          <FieldEditor key={`s-${f.field}-${locale}`} orgId={orgId} entityType="storefront_string" entityId="shop"
            field={f.field} label={f.label} locale={locale}
            existing={findTranslation(stringItems, f.field, locale)}
            onChanged={reload} onError={setError} />
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-2">
        <div className="text-[11px] font-bold text-slate-700">{dict.products.displayCurrencyForDisplayOnly}</div>
        <p className="text-[11px] text-slate-500">
          {dict.products.youEnterTheRateYourself}{rates.baseCurrency}{dict.products.withoutARateNoConverted}</p>
        {rates.items.map((r) => (
          <div key={r.currency} className="flex flex-wrap items-center gap-2 text-[11px] text-slate-700">
            <span className="font-bold">{r.currency}</span>
            <span>{dict.products.text1yf}{r.currency} = {r.ratePerUnit} {rates.baseCurrency}</span>
            <span className="text-slate-400">{dict.products.source}{r.sourceNote}</span>
            <button type="button" onClick={() => removeRate(r.currency)} className="text-red-600 font-semibold">{dict.products.delete}</button>
          </div>
        ))}
        <div className="grid grid-cols-3 gap-2">
          <input value={rateForm.currency} onChange={(e) => setRateForm({ ...rateForm, currency: e.target.value })}
            placeholder={dict.products.currencyUSD} className="rounded-lg border px-2 py-1.5 text-xs" />
          <input value={rateForm.ratePerUnit} onChange={(e) => setRateForm({ ...rateForm, ratePerUnit: e.target.value })}
            placeholder={t("products.rate1UnitHowMany", { baseCurrency: rates.baseCurrency })} className="rounded-lg border px-2 py-1.5 text-xs" />
          <input value={rateForm.sourceNote} onChange={(e) => setRateForm({ ...rateForm, sourceNote: e.target.value })}
            placeholder={dict.products.rateSourceRequired} className="rounded-lg border px-2 py-1.5 text-xs" />
        </div>
        <button type="button" onClick={saveRate}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-white">
          {dict.products.saveRate}</button>
      </div>
    </div>
  );
}
