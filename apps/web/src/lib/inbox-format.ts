import { fmtDate, fmtMoneyMinor } from "@repo/contracts";
import { inboxBn, inboxEn } from "./i18n/inbox";

type Loc = "bn" | "en";
const D = (locale?: string) => (locale === "en" ? inboxEn : inboxBn);

/**
 * Inbox display formatting — pure helpers extracted from the inbox
 * page in IN9c (behaviour unchanged; they were top-of-file pure
 * functions/constants in page.tsx). No state, no fetching: money /
 * time / label formatting shared by the list, thread and context
 * panels.
 */

export const COURIER_RISK_BAND_BN: Record<string, string> = { low: inboxBn.riskLow, medium: inboxBn.riskMedium, high: inboxBn.riskHigh, unknown: inboxBn.riskUnknown };
export const COURIER_RISK_BAND_EN: Record<string, string> = { low: inboxEn.riskLow, medium: inboxEn.riskMedium, high: inboxEn.riskHigh, unknown: inboxEn.riskUnknown };
export const courierRiskBand = (locale?: string): Record<string, string> => (locale === "en" ? COURIER_RISK_BAND_EN : COURIER_RISK_BAND_BN);

export const MOOD_TITLE = inboxBn.moodTitle;
export const moodTitle = (locale?: string): string => D(locale).moodTitle;

export const money = (minor?: string | null, currency = "BDT", locale: Loc = "bn") =>
  minor == null ? "—" : currency === "BDT" ? fmtMoneyMinor(locale, BigInt(Math.round(Number(minor)))) : `${currency} ${(Number(minor) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const clampPane = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v)));

// ---- Unified Inbox U1: channel identity + day separators ----
export const CHANNEL_META: Record<string, { label: string; emoji: string; cls: string }> = {
  whatsapp: { label: "WhatsApp", emoji: "🟢", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  messenger: { label: "Messenger", emoji: "🔵", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
  instagram: { label: "Instagram", emoji: "🟣", cls: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200" },
  webchat: { label: inboxBn.channelLiveChat, emoji: "🌐", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
  tiktok: { label: "TikTok", emoji: "⚫", cls: "bg-slate-900 text-white ring-slate-700" },
  telegram: { label: "Telegram", emoji: "✈️", cls: "bg-cyan-50 text-cyan-700 ring-cyan-200" },
  email: { label: "Email", emoji: "✉️", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
};

export function dayLabel(iso: string, locale: Loc = "bn"): string {
  const d = new Date(iso);
  const today = new Date();
  const yday = new Date(); yday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return D(locale).today;
  if (d.toDateString() === yday.toDateString()) return D(locale).yesterday;
  return fmtDate(locale, d);
}

// ---- Inbox Design v2 display helpers (pure formatting, no data change) ----
export function initialsOf(name?: string | null, locale: Loc = "bn"): string {
  const t = (name ?? "").trim();
  if (!t) return D(locale).initialsFallback;
  const parts = t.split(/\s+/);
  const out = ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).trim();
  return out ? out.toUpperCase() : t.slice(0, 2);
}

export function relTime(iso?: string | null, locale: Loc = "bn"): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const dd = D(locale);
  if (ms < 60000) return dd.justNow;
  const min = Math.floor(ms / 60000);
  if (min < 60) return locale === "en" ? `${min}${dd.minutesAgoSuffix}` : `${min}${dd.minutesAgoSuffix}`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}${dd.hoursAgoSuffix}`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}${dd.daysAgoSuffix}`;
  return new Date(iso).toLocaleDateString(locale === "en" ? "en-IN" : "bn-BD", { day: "numeric", month: "short" });
}

/** CX4/CX5: handover reason labels — one mapping shared by the
 * queue chips (CX4) and the CX5 autopilot-paused banner. */
export const HANDOVER_REASON_LABELS: Record<string, string> = {
  complaint: inboxBn.handoverComplaint, human_requested: inboxBn.handoverHumanRequested, negative_sentiment: inboxBn.handoverNegativeSentiment,
  high_value_order: inboxBn.handoverHighValueOrder, manual_takeover: inboxBn.handoverManualTakeover, order_bot: inboxBn.handoverOrderBot,
};
export const handoverReasonLabels = (locale?: string): Record<string, string> => {
  const dd = D(locale);
  return {
    complaint: dd.handoverComplaint, human_requested: dd.handoverHumanRequested, negative_sentiment: dd.handoverNegativeSentiment,
    high_value_order: dd.handoverHighValueOrder, manual_takeover: dd.handoverManualTakeover, order_bot: dd.handoverOrderBot,
  };
};

export const CHANNEL_DOT: Record<string, string> = {
  whatsapp: "bg-emerald-500", messenger: "bg-sky-500", instagram: "bg-fuchsia-500",
  webchat: "bg-slate-400", tiktok: "bg-slate-900", telegram: "bg-cyan-500", email: "bg-amber-500",
};

/** Quick-reply variable substitution ({{firstName}} / {{contactName}}
 * / {{phone}}) from the conversation's real contact fields only. */
export function renderQuick(content: string, conv: { contactName?: string | null; contactPhone?: string | null }): string {
  const name = conv.contactName ?? "";
  return content
    .replaceAll("{{firstName}}", name.split(" ")[0] ?? "")
    .replaceAll("{{contactName}}", name)
    .replaceAll("{{phone}}", conv.contactPhone ?? "");
}
