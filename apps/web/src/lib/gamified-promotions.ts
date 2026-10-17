// NF6 (FB3) — Gamified promotions page helpers.
// Pure logic (labels, payload builders, public shapes) + the
// thin API wrappers the dashboard page and the storefront
// overlay share — same split as lib/booking.ts: pages own
// fetching/state, everything testable lives here.
import { apiFetch, API_URL } from "./api";

// ---------- Types (mirror the API service shapes) ----------

export type PromoKind = "spin_wheel" | "quiz" | "group_buy";

export interface PromoCampaignView {
  id: string;
  organizationId: string;
  kind: PromoKind;
  name: string;
  active: boolean;
  trigger: string;
  delaySeconds: number;
  scrollPercent: number;
  frequencyDays: number;
  showOn: string;
  startsAt: string | null;
  endsAt: string | null;
  config: Record<string, any>;
  createdAt: string | null;
  updatedAt: string | null;
  stats?: Record<string, number>;
}

export interface PromoPlayView {
  id: string;
  campaignId: string;
  phone: string;
  customerName: string | null;
  outcome: string;
  segmentLabel: string | null;
  resultKey: string | null;
  couponCode: string | null;
  createdAt: string | null;
}

export interface PromoJoinView {
  id: string;
  campaignId: string;
  phone: string;
  customerName: string | null;
  status: string;
  couponCode: string | null;
  createdAt: string | null;
}

export interface PublicPromoCampaign {
  id: string;
  kind: PromoKind;
  name: string;
  placement: {
    trigger: string;
    delaySeconds: number;
    scrollPercent: number;
    frequencyDays: number;
    showOn: string;
    startsAt: string | null;
    endsAt: string | null;
  };
  segments?: Array<{ label: string }>;
  questions?: Array<{ text: string; options: Array<{ text: string }> }>;
  completionCouponLabel?: string | null;
  product?: { id: string; name: string; slug: string | null; priceMinor: string; imageUrl: string | null } | null;
  requiredBuyers?: number;
  joinedCount?: number;
  groupStatus?: string;
  discountLabel?: string;
  noPrepaymentNote?: string;
}

// ---------- Labels ----------

export const PROMO_KIND_LABELS: Record<string, string> = {
  spin_wheel: "স্পিন হুইল",
  quiz: "পণ্য-খোঁজ কুইজ",
  group_buy: "গ্রুপ বাই",
};

export const PLAY_OUTCOME_LABELS: Record<string, string> = {
  won: "জিতেছেন",
  lost: "জেতেননি",
  completed: "সম্পন্ন",
};

export const JOIN_STATUS_LABELS: Record<string, string> = {
  joined: "যোগ দিয়েছেন",
  unlocked: "ছাড় চালু হয়েছে",
  expired: "মেয়াদ শেষ (লক্ষ্য পূরণ হয়নি)",
};

export const GROUP_STATUS_LABELS: Record<string, string> = {
  open: "চলমান",
  unlocked: "ছাড় চালু হয়েছে",
  expired_unmet: "মেয়াদ শেষ — লক্ষ্য পূরণ হয়নি",
};

/** Same honest copy the API sends (kept in sync deliberately):
 * group buy never takes a prepayment in v1. */
export const GROUP_BUY_NO_PREPAYMENT_NOTE =
  "গ্রুপ বাইয়ে কোনো অগ্রিম পেমেন্ট নেওয়া হয় না। নির্দিষ্ট সংখ্যক ক্রেতা যোগ দিলেই ছাড়ের কুপন চালু হবে — কুপন কোডটি দিয়ে চেকআউটের সময় নিজে অর্ডার সম্পন্ন করবেন।";

// ---------- Payload builders (dashboard forms → API DTO) ----------

export interface WheelSegmentForm {
  label: string;
  weight: number;
  prizeKind: "none" | "percent" | "fixed";
  prizeValue: number;
}

export function buildWheelConfig(segments: WheelSegmentForm[], couponExpiryHours: number) {
  return {
    segments: segments.map((s) => ({
      label: s.label.trim(),
      weight: Math.max(0, Math.trunc(s.weight) || 0),
      prizeKind: s.prizeKind,
      prizeValue: s.prizeKind === "none" ? 0 : Math.max(0, Math.trunc(s.prizeValue) || 0),
    })),
    couponExpiryHours,
  };
}

export interface QuizOptionForm {
  text: string;
  categoryId?: string;
  categoryName?: string;
  tagSlug?: string;
}

export function buildQuizConfig(
  questions: Array<{ text: string; options: QuizOptionForm[] }>,
  completionCoupon: { kind: "percent" | "fixed"; value: number } | null,
  couponExpiryHours: number,
) {
  return {
    questions: questions.map((q) => ({
      text: q.text.trim(),
      options: q.options.map((o) => {
        const out: Record<string, string> = { text: o.text.trim() };
        if (o.categoryId) out.categoryId = o.categoryId;
        else if (o.tagSlug) out.tagSlug = o.tagSlug;
        else if (o.categoryName) out.categoryName = o.categoryName;
        return out;
      }),
    })),
    completionCoupon,
    couponExpiryHours,
  };
}

export function buildGroupBuyConfig(input: {
  productId: string;
  requiredBuyers: number;
  discountKind: "percent" | "fixed";
  discountValue: number;
  couponExpiryHours: number;
}) {
  return {
    productId: input.productId,
    requiredBuyers: Math.max(2, Math.trunc(input.requiredBuyers) || 2),
    discountKind: input.discountKind,
    discountValue: Math.max(0, Math.trunc(input.discountValue) || 0),
    couponExpiryHours: input.couponExpiryHours,
  };
}

/** Wheel display helper: a segment's share of the wheel as a
 * percentage of total weight — DISPLAY ONLY (the server never
 * sends weights to shoppers; staff see them in their own
 * config). The spin outcome is always decided server-side. */
export function segmentSharePercent(segments: WheelSegmentForm[], index: number): number {
  const total = segments.reduce((a, s) => a + (s.weight || 0), 0);
  if (total <= 0) return 0;
  return Math.round(((segments[index]?.weight || 0) / total) * 1000) / 10;
}

// ---------- Staff API ----------

const base = (orgId: string) => `/organizations/${orgId}/promotions`;

export async function fetchPromoCampaigns(orgId: string): Promise<PromoCampaignView[]> {
  const res = await apiFetch<{ campaigns: PromoCampaignView[] }>(`${base(orgId)}/campaigns`);
  return res.campaigns ?? [];
}

export async function fetchPromoCampaign(
  orgId: string,
  id: string,
): Promise<{ campaign: PromoCampaignView; plays?: PromoPlayView[]; joins?: PromoJoinView[] }> {
  return apiFetch(`${base(orgId)}/campaigns/${id}`);
}

export function createPromoCampaign(orgId: string, payload: Record<string, unknown>) {
  return apiFetch<{ campaign: PromoCampaignView }>(`${base(orgId)}/campaigns`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function setPromoCampaignActive(orgId: string, id: string, active: boolean) {
  return apiFetch<{ campaign: PromoCampaignView }>(`${base(orgId)}/campaigns/${id}/active`, {
    method: "POST",
    body: JSON.stringify({ active }),
  });
}

// ---------- Public (storefront) API ----------

async function publicFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    throw new Error(typeof data?.message === "string" ? data.message : "কিছু একটা সমস্যা হয়েছে");
  }
  return data as T;
}

export async function fetchPublicPromotions(orgSlug: string): Promise<PublicPromoCampaign[]> {
  const res = await publicFetch<{ campaigns: PublicPromoCampaign[] }>(
    `/public/promotions/${encodeURIComponent(orgSlug)}/active`,
  );
  return res.campaigns ?? [];
}

export function publicSpinPlay(orgSlug: string, campaignId: string, phone: string, name?: string) {
  return publicFetch<{ play: { outcome: string; segmentLabel: string | null; couponCode: string | null; alreadyPlayed: boolean } }>(
    `/public/promotions/${encodeURIComponent(orgSlug)}/spin/${campaignId}/play`,
    { method: "POST", body: JSON.stringify({ phone, name: name || undefined }) },
  );
}

export function publicQuizComplete(
  orgSlug: string,
  campaignId: string,
  phone: string,
  answers: number[],
  name?: string,
) {
  return publicFetch<{
    play: { outcome: string; couponCode: string | null; alreadyPlayed: boolean };
    resultKey: string | null;
    products: Array<{ id: string; name: string; slug: string | null; priceMinor: string; imageUrl: string | null }>;
  }>(
    `/public/promotions/${encodeURIComponent(orgSlug)}/quiz/${campaignId}/complete`,
    { method: "POST", body: JSON.stringify({ phone, answers, name: name || undefined }) },
  );
}

export function publicGroupBuyJoin(orgSlug: string, campaignId: string, phone: string, name?: string) {
  return publicFetch<{
    join: { status: string; couponCode: string | null; alreadyJoined: boolean };
    status: string;
    joinedCount: number;
    requiredBuyers: number;
    noPrepaymentNote: string;
  }>(
    `/public/promotions/${encodeURIComponent(orgSlug)}/group-buy/${campaignId}/join`,
    { method: "POST", body: JSON.stringify({ phone, name: name || undefined }) },
  );
}
