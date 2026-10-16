export type AspectRatio = "1:1" | "9:16";
export type TemplateStyle = "minimal" | "flash_sale" | "cod_trust" | "festive";

export interface ColorPalette {
  id: string;
  name: string;
  bgStart: string;
  bgEnd: string;
  accent: string;
  badgeBg: string;
  badgeText: string;
  textPrimary: string;
  textMuted: string;
  glow: string;
}

export const BANNER_PALETTES: ColorPalette[] = [
  {
    id: "navy",
    name: "রয়্যাল নেভি",
    bgStart: "#0a1128",
    bgEnd: "#1c2a4f",
    accent: "#38bdf8",
    badgeBg: "#0284c7",
    badgeText: "#ffffff",
    textPrimary: "#ffffff",
    textMuted: "#94a3b8",
    glow: "rgba(56, 189, 248, 0.25)",
  },
  {
    id: "crimson",
    name: "ধামাকা রুবি",
    bgStart: "#3b0716",
    bgEnd: "#881337",
    accent: "#f43f5e",
    badgeBg: "#e11d48",
    badgeText: "#ffffff",
    textPrimary: "#ffffff",
    textMuted: "#fda4af",
    glow: "rgba(244, 63, 94, 0.3)",
  },
  {
    id: "emerald",
    name: "ট্রাস্ট এমারেল্ড",
    bgStart: "#022c22",
    bgEnd: "#065f46",
    accent: "#34d399",
    badgeBg: "#059669",
    badgeText: "#ffffff",
    textPrimary: "#ffffff",
    textMuted: "#a7f3d0",
    glow: "rgba(52, 211, 153, 0.25)",
  },
  {
    id: "violet",
    name: "লাক্সারি ভায়োলেট",
    bgStart: "#2e1065",
    bgEnd: "#581c87",
    accent: "#a855f7",
    badgeBg: "#7e22ce",
    badgeText: "#ffffff",
    textPrimary: "#ffffff",
    textMuted: "#d8b4fe",
    glow: "rgba(168, 85, 247, 0.28)",
  },
  {
    id: "gold",
    name: "ফেস্টিভ গোল্ড",
    bgStart: "#271704",
    bgEnd: "#78350f",
    accent: "#fbbf24",
    badgeBg: "#d97706",
    badgeText: "#ffffff",
    textPrimary: "#ffffff",
    textMuted: "#fde68a",
    glow: "rgba(251, 191, 36, 0.3)",
  },
  {
    id: "obsidian",
    name: "মডার্ন ব্ল্যাক",
    bgStart: "#09090b",
    bgEnd: "#27272a",
    accent: "#e4e4e7",
    badgeBg: "#3f3f46",
    badgeText: "#ffffff",
    textPrimary: "#ffffff",
    textMuted: "#a1a1aa",
    glow: "rgba(255, 255, 255, 0.15)",
  },
];

export const BANNER_TEMPLATES: { id: TemplateStyle; label: string; icon: string }[] = [
  { id: "minimal", label: "প্রিমিয়াম মিনিমাল", icon: "✨" },
  { id: "flash_sale", label: "ধামাকা অফার", icon: "⚡" },
  { id: "cod_trust", label: "ক্যাশ অন ডেলিভারি", icon: "🚚" },
  { id: "festive", label: "উৎসবের স্পেশাল", icon: "🎉" },
];

export function getPaletteById(id: string): ColorPalette {
  return BANNER_PALETTES.find((p) => p.id === id) ?? BANNER_PALETTES[0];
}

export function calculateDiscountPercent(priceMinor: bigint | number, compareAtMinor?: bigint | number | null): number | null {
  if (!compareAtMinor) return null;
  const p = Number(priceMinor);
  const cp = Number(compareAtMinor);
  if (cp <= 0 || p >= cp) return null;
  return Math.round(((cp - p) / cp) * 100);
}

export function formatBannerDimensions(ratio: AspectRatio): { width: number; height: number; label: string } {
  if (ratio === "9:16") {
    return { width: 1080, height: 1920, label: "রিলস ও স্টোরিজ (1080×1920)" };
  }
  return { width: 1080, height: 1080, label: "ফিড ও ক্যারোসেল (1080×1080)" };
}
