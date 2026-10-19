/**
 * AP7 personas — web mirror of the API registry (apps/api
 * src/ai/personas.ts). The server enforces the tool scoping; this
 * list only drives the picker UI and labels.
 *
 * MB2 F2: labels resolve through the `shared` i18n namespace.
 * `labelBn` stays the pinned bn field (existing pickers render
 * it directly); `labelEn` is the additive D7-style companion and
 * `personaLabel(id, locale)` / `personasForLocale(locale)` are
 * the locale-aware accessors.
 */
import type { UiLocale } from "./i18n/dict";
import { sharedBn, sharedEn } from "./i18n/shared";

export interface PersonaUi {
  id: string;
  labelBn: string;
  labelEn: string;
  icon: string;
}

export const PERSONAS_UI: PersonaUi[] = [
  { id: "general", labelBn: sharedBn.personaGeneral, labelEn: sharedEn.personaGeneral, icon: "✦" },
  { id: "ads_analyst", labelBn: sharedBn.personaAdsAnalyst, labelEn: sharedEn.personaAdsAnalyst, icon: "📣" },
  { id: "inbox_coach", labelBn: sharedBn.personaInboxCoach, labelEn: sharedEn.personaInboxCoach, icon: "💬" },
  { id: "finance_analyst", labelBn: sharedBn.personaFinanceAnalyst, labelEn: sharedEn.personaFinanceAnalyst, icon: "💰" },
];

/** Personas with a single resolved `label` for the given locale. */
export function personasForLocale(locale: UiLocale = "bn"): { id: string; label: string; icon: string }[] {
  return PERSONAS_UI.map((p) => ({
    id: p.id,
    label: locale === "en" ? p.labelEn : p.labelBn,
    icon: p.icon,
  }));
}

export function personaLabel(id: string | null | undefined, locale: UiLocale = "bn"): string {
  const found = PERSONAS_UI.find((p) => p.id === id);
  if (!found) return locale === "en" ? sharedEn.personaGeneral : sharedBn.personaGeneral;
  return locale === "en" ? found.labelEn : found.labelBn;
}
