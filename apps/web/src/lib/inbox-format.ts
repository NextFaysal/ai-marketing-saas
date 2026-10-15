/**
 * Inbox display formatting — pure helpers extracted from the inbox
 * page in IN9c (behaviour unchanged; they were top-of-file pure
 * functions/constants in page.tsx). No state, no fetching: money /
 * time / label formatting shared by the list, thread and context
 * panels.
 */

export const COURIER_RISK_BAND_BN: Record<string, string> = { low: "কম", medium: "মাঝারি", high: "উচ্চ", unknown: "তথ্য নেই" };

export const MOOD_TITLE = "কীওয়ার্ড-ভিত্তিক আনুমানিক সংকেত — সাম্প্রতিক গ্রাহক-বার্তার শব্দ দেখে হিসাব করা, মনের অবস্থা নয়";

export const money = (minor?: string | null, currency = "BDT") =>
  minor == null ? "—" : `${currency === "BDT" ? "৳" : currency + " "}${(Number(minor) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const clampPane = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v)));

// ---- Unified Inbox U1: channel identity + day separators ----
export const CHANNEL_META: Record<string, { label: string; emoji: string; cls: string }> = {
  whatsapp: { label: "WhatsApp", emoji: "🟢", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  messenger: { label: "Messenger", emoji: "🔵", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
  instagram: { label: "Instagram", emoji: "🟣", cls: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200" },
  webchat: { label: "Live Chat", emoji: "🌐", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
  tiktok: { label: "TikTok", emoji: "⚫", cls: "bg-slate-900 text-white ring-slate-700" },
  telegram: { label: "Telegram", emoji: "✈️", cls: "bg-cyan-50 text-cyan-700 ring-cyan-200" },
  email: { label: "Email", emoji: "✉️", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
};

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yday = new Date(); yday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "আজ";
  if (d.toDateString() === yday.toDateString()) return "গতকাল";
  return d.toLocaleDateString("bn-BD", { day: "numeric", month: "long", year: "numeric" });
}

// ---- Inbox Design v2 display helpers (pure formatting, no data change) ----
export function initialsOf(name?: string | null): string {
  const t = (name ?? "").trim();
  if (!t) return "গ্র";
  const parts = t.split(/\s+/);
  const out = ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).trim();
  return out ? out.toUpperCase() : t.slice(0, 2);
}

export function relTime(iso?: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  if (ms < 60000) return "এখনই";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}মি আগে`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}ঘ আগে`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}দিন আগে`;
  return new Date(iso).toLocaleDateString("bn-BD", { day: "numeric", month: "short" });
}

/** CX4/CX5: handover reason labels — one mapping shared by the
 * queue chips (CX4) and the CX5 autopilot-paused banner. */
export const HANDOVER_REASON_LABELS: Record<string, string> = {
  complaint: "😠 অভিযোগ", human_requested: "🙋 মানুষ চেয়েছে", negative_sentiment: "😞 নেতিবাচক মনোভাব",
  high_value_order: "⭐ বড় অর্ডার", manual_takeover: "🙋 টেকওভার", order_bot: "🤖 অর্ডার বট",
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
