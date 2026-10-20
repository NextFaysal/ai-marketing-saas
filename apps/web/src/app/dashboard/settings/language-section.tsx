"use client";
import React, { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { useLocale } from "@/lib/i18n/provider";
import type { UiLocale } from "@/lib/i18n/dict";

const BTN = "rounded-lg border px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50";

/**
 * ML1/ML3 (Multi-Language MB1) — Organization Settings → Language.
 *
 * Two levels of the ML-L3 resolution order are controlled here:
 *  1. Personal preference (User.preferredLocale): three radios —
 *     follow the organization default (null), বাংলা, English.
 *     Saving is immediate, through the LocaleProvider's
 *     setUserPref (PATCH /auth/me/preferences).
 *  2. Organization default (Organization.dashboardLocale):
 *     a bn/en select + Save → PATCH /organizations/:id/locale.
 *     Only OWNER/ADMIN may change it; a 403 from the API surfaces
 *     the dictionary's read-only note instead of a raw error.
 *
 * All copy comes from the unified dictionary via useLocale —
 * no hardcoded UI strings in this component.
 */
export function LanguageSection() {
  const { locale, dict, userPref, orgDefault, setUserPref, refresh } = useLocale();
  const s = dict.settingsLanguage;
  const c = dict.common;

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [busy, setBusy] = useState("");
  // Local copy of the org default: initialized from the context
  // once it loads, and updated in place after a successful save
  // (the context is also refreshed, but this section never
  // depends on a page reload to reflect the saved value).
  const [localOrgDefault, setLocalOrgDefault] = useState<UiLocale | null>(null);
  const [orgChoice, setOrgChoice] = useState<UiLocale>("bn");

  useEffect(() => {
    if (orgDefault) {
      setLocalOrgDefault(orgDefault);
      setOrgChoice(orgDefault);
    }
  }, [orgDefault]);

  const effectiveOrgDefault: UiLocale = localOrgDefault ?? orgDefault ?? "bn";
  const languageName = (loc: UiLocale) => (loc === "en" ? c.languageEn : c.languageBn);
  const personalValue: "org" | UiLocale = userPref ?? "org";

  async function changePersonal(value: "org" | UiLocale) {
    setBusy("personal");
    setError("");
    setNotice("");
    try {
      await setUserPref(value === "org" ? null : value);
      setNotice(s.saved);
    } catch {
      setError(s.saveError);
    } finally {
      setBusy("");
    }
  }

  async function saveOrgDefault() {
    const orgId = getOrganizationId();
    if (!orgId) {
      setError(s.noOrg);
      return;
    }
    setBusy("org");
    setError("");
    setNotice("");
    setReadOnly(false);
    try {
      await apiFetch(`/organizations/${orgId}/locale`, {
        method: "PATCH",
        body: JSON.stringify({ dashboardLocale: orgChoice }),
      });
      setLocalOrgDefault(orgChoice);
      setNotice(s.saved);
      // Best-effort context refresh so the provider's orgDefault
      // (and anything else reading it) catches up without a reload.
      void refresh().catch(() => undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      if (/403|forbidden/i.test(message)) {
        setReadOnly(true);
      } else {
        setError(s.saveError);
      }
    } finally {
      setBusy("");
    }
  }

  const personalOptions: { value: "org" | UiLocale; label: string }[] = [
    { value: "org", label: `${c.followOrg} (${languageName(effectiveOrgDefault)})` },
    { value: "bn", label: c.languageBn },
    { value: "en", label: c.languageEn },
  ];

  return (
    <section id="hub-language" className="card scroll-mt-24 p-5 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="stat-icon stat-icon-brand !h-10 !w-10 text-lg">🌐</span>
        <div className="min-w-0">
          <h2 className="font-semibold leading-tight text-slate-900">{s.title}</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-slate-500">{s.description}</p>
        </div>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {notice ? <p className="mb-3 text-sm text-green-600">{notice}</p> : null}

      <p className="mb-6 text-sm text-slate-600">
        <span className="font-medium">{s.currentEffective}:</span> {languageName(locale)}
      </p>

      {/* ---- Personal preference ---- */}
      <div>
        <div className="font-semibold">{s.personalTitle}</div>
        <p className="mt-1 text-[13px] text-slate-500">{s.personalHelp}</p>
        <div className="mt-3 space-y-2">
          {personalOptions.map((opt) => (
            <label
              key={opt.value}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg bg-slate-50 px-3 py-2.5 text-sm"
            >
              <input
                type="radio"
                name="personal-language"
                value={opt.value}
                checked={personalValue === opt.value}
                disabled={busy === "personal"}
                onChange={() => void changePersonal(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* ---- Organization default ---- */}
      <div className="border-t border-slate-100 pt-6 mt-6">
        <div className="font-semibold">{s.orgTitle}</div>
        <p className="mt-1 text-[13px] text-slate-500">{s.orgHelp}</p>
        {readOnly ? (
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-[13px] text-amber-800">{s.readOnlyNote}</p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              className="rounded-lg border px-3 py-2 text-sm"
              value={orgChoice}
              onChange={(e) => setOrgChoice(e.target.value === "en" ? "en" : "bn")}
              aria-label={s.orgTitle}
            >
              <option value="bn">{c.languageBn}</option>
              <option value="en">{c.languageEn}</option>
            </select>
            <button className={BTN} disabled={busy === "org"} onClick={() => void saveOrgDefault()}>
              {s.orgSave}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
