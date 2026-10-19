"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState, ResponsiveTable } from "@repo/ui";
import { useConfirm, useToast } from "@repo/ui/client";
import {
  CustomFieldsEditor, buildCustomFieldsPayload, customFieldsToRaw, fetchCustomFieldDefs,
  type CustomFieldDef,
} from "@/components/custom-fields";
import { minorToTaka, takaToMinor } from "@/lib/orders-on1";
import {
  formatPaisaNumber, formatPointsDelta, loyaltyEntryLabel, loyaltyEntryNote,
  type CustomerLoyalty,
} from "@/lib/loyalty";
import { agingRows, isOverLimit, type CustomerKhata } from "@/lib/orders-on7";
import {
  buildGrantPayload, buildTierPayload, creditDeltaLabel, creditReasonLabel,
  type CustomerCreditView, type CustomerTierView, type TierView,
} from "@/lib/membership";
import RfmRetentionStudio from "./components/RfmRetentionStudio";
import {
  CUSTOMER_TYPE_OPTIONS, EMPTY_SEGMENT_DRAFT, buildCustomerListParams, buildSegmentPayload,
  normalizeTags, segmentCriteriaSummary, segmentCriteriaToDraft, validateNewTag, validateTags,
  type CrmSegment, type SegmentCriteriaDraft,
} from "@/lib/gb6-crm";

interface CustomerRow {
  id: string; name?: string | null; phone?: string | null; email?: string | null;
  source: string; createdAt: string; orderCount: number; totalSpentMinor: string;
  // ON7: list rows now carry the open due + credit limit.
  dueMinor?: string; creditLimitMinor?: string | null;
  // GB6 (GC15): EC33 sold-bucket figures + CRM flags/tags.
  soldOrderCount?: number; lifetimeValueMinor?: string; aovMinor?: string | null;
  isRepeat?: boolean; tags?: string[]; isVip?: boolean; isBlocked?: boolean;
}
interface Detail {
  customer: {
    id: string; name?: string | null; firstName?: string | null; lastName?: string | null;
    phone?: string | null; email?: string | null; source: string; createdAt: string; mergedIntoId?: string | null;
    customFields?: Record<string, unknown> | null;
    // EC24d: staff-set wholesale flag.
    isWholesale?: boolean;
    // GB6 (GC15): CRM depth — staff-only fields (detail payload only).
    tags?: string[]; notes?: string | null; isVip?: boolean; isBlocked?: boolean; blockedReason?: string | null;
    // AB5 (AX7): B2B group + net terms.
    groupId?: string | null; creditTermsDays?: number;
  };
  orders: { id: string; externalNumber?: string | null; status: string; source: string; isCod: boolean; totalMinor: string; createdAt: string }[];
  conversations: { id: string; channel: string; status: string; lastMessagePreview?: string | null; lastMessageAt?: string | null; unreadCount: number }[];
  shipments: { id: string; trackingCode?: string | null; status: string; provider: string }[];
  lead: { id: string; stage: string; source: string } | null;
  lifetime: { orderCount: number; totalSpentMinor: string; currency: string };
  storeIdentities?: { storeId: string; storeName?: string | null; platform?: string | null; externalId: string; emailSnapshot?: string | null; phoneSnapshot?: string | null }[];
  risk?: { band: string; score: number | null; history: { total: number; delivered: number; returned: number; cancelledOrFailed: number; refunded: number }; reasons: string[]; suggestion: string | null } | null;
  courierRecord?: { decided: number; delivered: number; returned: number; cancelledOrFailed: number; refunded: number; successRatePct: number | null; perCourier: { provider: string; decided: number; delivered: number; successRatePct: number | null }[]; lastDeliveryAt: string | null; totalShipments: number; riskBand: string; riskScore: number | null } | null;
}
import { useLocale } from "@/lib/i18n/provider";
import { crmBn, crmEn } from "@/lib/i18n/crm";
import { fmtNumber, fmtMoneyMinor, fmtDate } from "@repo/contracts";
import type { UiLocale } from "@repo/contracts";

const CD = (locale?: string) => (locale === "en" ? crmEn : crmBn);
const RISK_KEY: Record<string, keyof typeof crmBn> = { high: "riskHigh", medium: "riskMedium", low: "riskLow", unknown: "riskNone" };

/** Badge classes per risk band. The label TEXT always comes from the
 * crm dictionary (both locales) via RISK_KEY — no bn literals here. */
const RISK_LABEL_BASE: Record<string, { cls: string }> = {
  high: { cls: "bg-red-100 text-red-700" },
  medium: { cls: "bg-amber-100 text-amber-700" },
  low: { cls: "bg-emerald-100 text-emerald-700" },
  unknown: { cls: "bg-slate-100 text-slate-500" },
};
function riskLabelFor(locale: string): Record<string, { text: string; cls: string }> {
  const out: Record<string, { text: string; cls: string }> = {};
  for (const [k, v] of Object.entries(RISK_LABEL_BASE)) out[k] = { text: RISK_KEY[k] ? CD(locale)[RISK_KEY[k]] : k, cls: v.cls };
  return out;
}

const money = (minor?: string | null, currency = "BDT", locale: UiLocale = "bn") =>
  minor == null ? "—" : fmtMoneyMinor(locale, Number(minor), { currency });

export default function CustomersPage() {
  const { t: tr, locale } = useLocale();
  const RISK_LABEL = riskLabelFor(locale);
  const moneyL = (minor?: string | null, currency = "BDT") => money(minor, currency, locale);
  const confirm = useConfirm();
  const { toast } = useToast();
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string; platform?: string; syncMode?: string }[]>([]);
  const [q, setQ] = useState("");
  // ON7: due-only filter + the khata (ledger) section state.
  const [hasDue, setHasDue] = useState(false);
  // GB6 (GC15): type / tag / segment list filters + segments manager.
  const [customerType, setCustomerType] = useState("all");
  const [tagFilter, setTagFilter] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [segments, setSegments] = useState<CrmSegment[]>([]);
  const [segName, setSegName] = useState("");
  const [segDraft, setSegDraft] = useState<SegmentCriteriaDraft>(EMPTY_SEGMENT_DRAFT);
  const [segTagInput, setSegTagInput] = useState("");
  const [editingSegmentId, setEditingSegmentId] = useState("");
  const [segError, setSegError] = useState("");
  const [segBusy, setSegBusy] = useState("");
  // GB6 (GC15): detail CRM editor state (tags / VIP / notes / block).
  const [crmTags, setCrmTags] = useState<string[]>([]);
  const [crmTagInput, setCrmTagInput] = useState("");
  const [crmTagError, setCrmTagError] = useState("");
  const [crmNotes, setCrmNotes] = useState("");
  const [crmVip, setCrmVip] = useState(false);
  const [crmBlocked, setCrmBlocked] = useState(false);
  const [crmBlockedReason, setCrmBlockedReason] = useState("");
  const [crmError, setCrmError] = useState("");
  const [khata, setKhata] = useState<CustomerKhata | null>(null);
  const [khataError, setKhataError] = useState("");
  // AB5 (AX7): khata overdue-only filter (?overdue=1).
  const [khataOverdueOnly, setKhataOverdueOnly] = useState(false);
  // AB5 (AX7): B2B customer groups + per-group price list editor.
  interface CustomerGroup { id: string; name: string; memberCount: number; hasPriceList: boolean }
  interface PriceListItemRow { id: string; productId: string; variantId: string | null; priceMinor: string; productName: string | null; variantName: string | null }
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [groupName, setGroupName] = useState("");
  const [editingGroupId, setEditingGroupId] = useState("");
  const [groupError, setGroupError] = useState("");
  const [groupBusy, setGroupBusy] = useState("");
  const [plGroupId, setPlGroupId] = useState("");
  const [plItems, setPlItems] = useState<PriceListItemRow[]>([]);
  const [plLoading, setPlLoading] = useState(false);
  const [orgProducts, setOrgProducts] = useState<{ id: string; name: string; priceMinor: string }[]>([]);
  const [plProductId, setPlProductId] = useState("");
  const [plVariants, setPlVariants] = useState<{ id: string; name: string }[]>([]);
  const [plVariantId, setPlVariantId] = useState("");
  const [plPriceTaka, setPlPriceTaka] = useState("");
  const [bulkPercent, setBulkPercent] = useState("");
  const [bulkResult, setBulkResult] = useState("");
  // AB5 (AX7): group + credit terms in the customer edit form.
  const [editGroupId, setEditGroupId] = useState("");
  const [editCreditTerms, setEditCreditTerms] = useState("0");
  // AB1: loyalty section in the detail (balance, ledger, referral
  // coupons, staff adjust) — lazy-fetched when the detail opens.
  const [loyalty, setLoyalty] = useState<CustomerLoyalty | null>(null);
  const [loyaltyError, setLoyaltyError] = useState("");
  const [adjustDelta, setAdjustDelta] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustError, setAdjustError] = useState("");
  // NF7 (FB3): membership tier + store credit in the detail,
  // plus the tier-definitions manager below the groups card.
  const [custTier, setCustTier] = useState<CustomerTierView | null>(null);
  const [custCredit, setCustCredit] = useState<CustomerCreditView | null>(null);
  const [membershipError, setMembershipError] = useState("");
  const [grantTaka, setGrantTaka] = useState("");
  const [grantNote, setGrantNote] = useState("");
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantError, setGrantError] = useState("");
  const [tiers, setTiers] = useState<TierView[]>([]);
  const [tierError, setTierError] = useState("");
  const [tierName, setTierName] = useState("");
  const [tierMinTaka, setTierMinTaka] = useState("");
  const [tierSort, setTierSort] = useState("0");
  const [tierBusy, setTierBusy] = useState("");
  const [tierPlTierId, setTierPlTierId] = useState("");
  const [tierPlItems, setTierPlItems] = useState<PriceListItemRow[]>([]);
  const [tierPlProductId, setTierPlProductId] = useState("");
  const [tierPlPriceTaka, setTierPlPriceTaka] = useState("");
  const [creditTaka, setCreditTaka] = useState("");
  const [creditBusy, setCreditBusy] = useState(false);
  const [creditError, setCreditError] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  // CX12b: the open customer's reviews for the 360 view.
  const [custReviews, setCustReviews] = useState<{ id: string; orderId: string; rating: number | null; comment: string | null; status: string; receivedAt: string | null; orderNumber: string | null }[]>([]);
  const [mergeTarget, setMergeTarget] = useState("");
  const [custDefs, setCustDefs] = useState<CustomFieldDef[]>([]);
  const [editForm, setEditForm] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  // EC24d: wholesale toggle in the customer edit form.
  const [editWholesale, setEditWholesale] = useState(false);
  const [editCf, setEditCf] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  // CP6: GDPR erasure report for the last erased customer.
  const [eraseReport, setEraseReport] = useState<{ customerId: string; ordersAnonymized: number; identitiesDeleted: number; reviewsRedacted: number; abandonedCheckoutsDeleted: number } | null>(null);
  const [activeTab, setActiveTab] = useState<"directory" | "rfm">("directory");

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const params = buildCustomerListParams({ q, hasDue, customerType, tag: tagFilter, segmentId });
      const qs = params.toString();
      setRows(await apiFetch<CustomerRow[]>(`/organizations/${orgId}/customers${qs ? `?${qs}` : ""}`));
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  }, [q, hasDue, customerType, tagFilter, segmentId]);

  // GB6 (GC15): segments list — memberCount is computed live by
  // the API on every GET, so a plain refetch keeps counts honest.
  const loadSegments = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try { setSegments(await apiFetch<CrmSegment[]>(`/organizations/${orgId}/customers/segments`)); }
    catch { /* the segments panel shows its own empty state */ }
  }, []);
  useEffect(() => { loadSegments(); }, [loadSegments]);

  async function saveSegment() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const { payload, errors } = buildSegmentPayload(segName, segDraft);
    if (!payload) { setSegError(errors.join(" ")); return; }
    setSegBusy("save"); setSegError("");
    try {
      if (editingSegmentId) {
        await apiFetch(`/organizations/${orgId}/customers/segments/${editingSegmentId}`, {
          method: "PATCH", body: JSON.stringify(payload),
        });
        toast({ title: tr("crm.segUpdated"), tone: "success" });
      } else {
        await apiFetch(`/organizations/${orgId}/customers/segments`, {
          method: "POST", body: JSON.stringify(payload),
        });
        toast({ title: tr("crm.segCreated"), tone: "success" });
      }
      setSegName(""); setSegDraft(EMPTY_SEGMENT_DRAFT); setSegTagInput(""); setEditingSegmentId("");
      await loadSegments();
    } catch (e) { setSegError(e instanceof Error ? e.message : tr("crm.segSaveFailed")); }
    finally { setSegBusy(""); }
  }

  function editSegment(s: CrmSegment) {
    setEditingSegmentId(s.id); setSegName(s.name);
    setSegDraft(segmentCriteriaToDraft(s.criteria)); setSegTagInput("");
    setSegError("");
  }

  async function deleteSegment(s: CrmSegment) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: tr("crm.segDeleteConfirm", { name: s.name }), body: tr("crm.segDeleteNote"), danger: true, confirmLabel: tr("crm.deleteIt") }))) return;
    setSegBusy(`del-${s.id}`); setSegError("");
    try {
      await apiFetch(`/organizations/${orgId}/customers/segments/${s.id}`, { method: "DELETE" });
      if (segmentId === s.id) setSegmentId("");
      if (editingSegmentId === s.id) { setEditingSegmentId(""); setSegName(""); setSegDraft(EMPTY_SEGMENT_DRAFT); }
      toast({ title: tr("crm.segDeleted"), tone: "success" });
      await loadSegments();
    } catch (e) { setSegError(e instanceof Error ? e.message : tr("crm.segDeleteFailed")); }
    finally { setSegBusy(""); }
  }

  function addSegTag() {
    const err = validateNewTag(segDraft.tagsAny, segTagInput);
    if (err) { setSegError(err); return; }
    setSegDraft({ ...segDraft, tagsAny: normalizeTags([...segDraft.tagsAny, segTagInput]) });
    setSegTagInput(""); setSegError("");
  }

  // GB6 (GC15): save the detail CRM fields via the customer PATCH.
  // Tags use REPLACE semantics (the whole array is sent); notes
  // empty -> null (clear); unblocking clears the reason server-side.
  async function saveCrm() {
    const orgId = getOrganizationId(); if (!orgId || !detail) return;
    const tagError = validateTags(crmTags);
    if (tagError) { setCrmError(tagError); return; }
    if (crmBlockedReason.length > 300) { setCrmError(tr("crm.blockReasonTooLong")); return; }
    setBusy("crm"); setCrmError("");
    try {
      const out = await apiFetch<Detail>(`/organizations/${orgId}/customers/${detail.customer.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          tags: normalizeTags(crmTags),
          notes: crmNotes.trim() ? crmNotes : null,
          isVip: crmVip,
          isBlocked: crmBlocked,
          blockedReason: crmBlocked ? (crmBlockedReason.trim() || null) : null,
        }),
      });
      setDetail(out);
      setCrmTags(out.customer.tags ?? []);
      setCrmNotes(out.customer.notes ?? "");
      setCrmVip(!!out.customer.isVip);
      setCrmBlocked(!!out.customer.isBlocked);
      setCrmBlockedReason(out.customer.blockedReason ?? "");
      toast({ title: tr("crm.crmSaved"), tone: "success" });
      await load();
      await loadSegments();
    } catch (e) { setCrmError(e instanceof Error ? e.message : tr("crm.crmSaveFailed")); }
    finally { setBusy(""); }
  }

  function addCrmTag() {
    const err = validateNewTag(crmTags, crmTagInput);
    if (err) { setCrmTagError(err); return; }
    setCrmTags(normalizeTags([...crmTags, crmTagInput]));
    setCrmTagInput(""); setCrmTagError("");
  }

  /** ON7: load the customer's khata (ledger) — open orders with
   * paid/due split, aging buckets and the credit limit. A failed
   * load says so; it never renders as "no dues". */
  const loadKhata = useCallback(async (customerId: string, overdueOnly = false) => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const k = await apiFetch<CustomerKhata>(`/organizations/${orgId}/customers/${customerId}/khata${overdueOnly ? "?overdue=1" : ""}`);
      setKhata(k); setKhataError("");
      setCreditTaka(k.creditLimitMinor ? minorToTaka(k.creditLimitMinor) : "");
    } catch (e) {
      setKhata(null);
      setKhataError(e instanceof Error ? e.message : tr("crm.khataLoadFailed"));
    }
  }, []);

  // AB5 (AX7): customer groups (B2B) — list / create / rename /
  // delete + the selected group's price list. Deleting a group
  // ungroups its members server-side (they are NOT deleted).
  const loadGroups = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const out = await apiFetch<{ items: CustomerGroup[] }>(`/organizations/${orgId}/commerce/customer-groups`);
      setGroups(out.items ?? []);
    } catch { /* the groups card shows its own empty state */ }
  }, []);
  useEffect(() => { loadGroups(); }, [loadGroups]);
  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    apiFetch<{ items: { id: string; name: string; priceMinor: string }[] }>(`/organizations/${orgId}/products?pageSize=100`)
      .then((d) => setOrgProducts(d.items ?? [])).catch(() => undefined);
  }, []);

  async function saveGroup() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!groupName.trim()) { setGroupError(tr("crm.groupNameRequired")); return; }
    setGroupBusy("save"); setGroupError("");
    try {
      if (editingGroupId) {
        await apiFetch(`/organizations/${orgId}/commerce/customer-groups/${editingGroupId}`, {
          method: "PATCH", body: JSON.stringify({ name: groupName.trim() }),
        });
        toast({ title: tr("crm.groupRenamed"), tone: "success" });
      } else {
        await apiFetch(`/organizations/${orgId}/commerce/customer-groups`, {
          method: "POST", body: JSON.stringify({ name: groupName.trim() }),
        });
        toast({ title: tr("crm.groupCreated"), tone: "success" });
      }
      setGroupName(""); setEditingGroupId("");
      await loadGroups();
    } catch (e) { setGroupError(e instanceof Error ? e.message : tr("crm.groupSaveFailed")); }
    finally { setGroupBusy(""); }
  }

  async function deleteGroup(g: CustomerGroup) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: tr("crm.groupDeleteConfirm", { name: g.name }), body: tr("crm.groupDeleteBody", { count: fmtNumber(locale, g.memberCount) }), danger: true, confirmLabel: tr("crm.deleteIt") }))) return;
    setGroupBusy(`del-${g.id}`); setGroupError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/customer-groups/${g.id}`, { method: "DELETE" });
      if (plGroupId === g.id) { setPlGroupId(""); setPlItems([]); }
      if (editingGroupId === g.id) { setEditingGroupId(""); setGroupName(""); }
      toast({ title: tr("crm.groupDeleted"), tone: "success" });
      await loadGroups();
    } catch (e) { setGroupError(e instanceof Error ? e.message : tr("crm.groupDeleteFailed")); }
    finally { setGroupBusy(""); }
  }

  const loadPriceList = useCallback(async (groupId: string) => {
    const orgId = getOrganizationId(); if (!orgId || !groupId) return;
    setPlLoading(true);
    try {
      const out = await apiFetch<{ items: PriceListItemRow[] }>(`/organizations/${orgId}/commerce/customer-groups/${groupId}/price-list`);
      setPlItems(out.items ?? []);
    } catch (e) { setGroupError(e instanceof Error ? e.message : tr("crm.priceListLoadFailed")); }
    finally { setPlLoading(false); }
  }, []);

  async function onPlProductChange(productId: string) {
    setPlProductId(productId); setPlVariantId(""); setPlVariants([]);
    const orgId = getOrganizationId(); if (!orgId || !productId) return;
    try {
      const detail = await apiFetch<{ variants?: { id: string; name: string }[] }>(`/organizations/${orgId}/products/${productId}`);
      setPlVariants(detail.variants ?? []);
    } catch { /* variant picker simply stays product-level */ }
  }

  async function addPlItem() {
    const orgId = getOrganizationId(); if (!orgId || !plGroupId) return;
    if (!plProductId) { setGroupError(tr("crm.pickProductFirst")); return; }
    const priceMinor = takaToMinor(plPriceTaka.trim());
    if (priceMinor === null) { setGroupError(tr("crm.priceInvalid")); return; }
    setGroupBusy("pl-add"); setGroupError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/customer-groups/${plGroupId}/price-list/items`, {
        method: "POST",
        body: JSON.stringify({ productId: plProductId, variantId: plVariantId || null, priceMinor }),
      });
      setPlPriceTaka("");
      await loadPriceList(plGroupId);
      await loadGroups();
    } catch (e) { setGroupError(e instanceof Error ? e.message : tr("crm.itemAddFailed")); }
    finally { setGroupBusy(""); }
  }

  async function removePlItem(item: PriceListItemRow) {
    const orgId = getOrganizationId(); if (!orgId || !plGroupId) return;
    setGroupBusy(`pl-del-${item.id}`); setGroupError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/customer-groups/${plGroupId}/price-list/items/${item.id}`, { method: "DELETE" });
      await loadPriceList(plGroupId);
      await loadGroups();
    } catch (e) { setGroupError(e instanceof Error ? e.message : tr("crm.itemRemoveFailed")); }
    finally { setGroupBusy(""); }
  }

  async function applyBulkPercent() {
    const orgId = getOrganizationId(); if (!orgId || !plGroupId) return;
    const percentOff = Number(bulkPercent);
    if (!Number.isInteger(percentOff) || percentOff < 1 || percentOff > 99) {
      setGroupError(tr("crm.discountInvalid")); return;
    }
    setGroupBusy("bulk"); setGroupError(""); setBulkResult("");
    try {
      const out = await apiFetch<{ written: number }>(`/organizations/${orgId}/commerce/customer-groups/${plGroupId}/price-list/bulk-percent`, {
        method: "POST", body: JSON.stringify({ percentOff }),
      });
      setBulkResult(tr("crm.bulkDiscountDone", { count: fmtNumber(locale, out.written), pct: fmtNumber(locale, percentOff) }));
      await loadPriceList(plGroupId);
      await loadGroups();
    } catch (e) { setGroupError(e instanceof Error ? e.message : tr("crm.bulkDiscountFailed")); }
    finally { setGroupBusy(""); }
  }

  /** AB1: load the customer's loyalty balance + ledger +
   * referral reward coupons. A failed load says so — it never
   * renders as a zero balance. */
  const loadLoyalty = useCallback(async (customerId: string) => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const l = await apiFetch<CustomerLoyalty>(`/organizations/${orgId}/commerce/loyalty/customers/${customerId}`);
      setLoyalty(l); setLoyaltyError("");
    } catch (e) {
      setLoyalty(null);
      setLoyaltyError(e instanceof Error ? e.message : tr("crm.loyaltyLoadFailed"));
    }
  }, []);

  /** AB1: staff point adjustment — delta is a non-zero integer
   * and the note is REQUIRED (the API enforces both; the button
   * stays disabled until both are present). On success the
   * section is refetched and the server's new balance shown. */
  async function adjustLoyalty() {
    const orgId = getOrganizationId(); if (!orgId || !detail) return;
    const delta = Number(adjustDelta);
    if (!Number.isInteger(delta) || delta === 0) { setAdjustError(tr("crm.pointsInvalid")); return; }
    if (!adjustNote.trim()) { setAdjustError(tr("crm.adjustNoteRequired")); return; }
    setAdjustBusy(true); setAdjustError("");
    try {
      const out = await apiFetch<{ balance: number }>(`/organizations/${orgId}/commerce/loyalty/customers/${detail.customer.id}/adjust`, {
        method: "POST",
        body: JSON.stringify({ deltaPoints: delta, note: adjustNote.trim() }),
      });
      toast({ title: tr("crm.adjustDone", { balance: fmtNumber(locale, out.balance) }), tone: "success" });
      setAdjustDelta(""); setAdjustNote("");
      await loadLoyalty(detail.customer.id);
    } catch (e) { setAdjustError(e instanceof Error ? e.message : tr("crm.adjustFailed")); }
    finally { setAdjustBusy(false); }
  }

  /** NF7: load the customer's derived tier + store-credit
   * balance/ledger. A failed load says so — never a fake zero. */
  const loadMembership = useCallback(async (customerId: string) => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const [t, c] = await Promise.all([
        apiFetch<{ tier: CustomerTierView }>(`/organizations/${orgId}/customers/${customerId}/membership`),
        apiFetch<CustomerCreditView>(`/organizations/${orgId}/customers/${customerId}/store-credit`),
      ]);
      setCustTier(t.tier); setCustCredit(c); setMembershipError("");
    } catch (e) {
      setCustTier(null); setCustCredit(null);
      setMembershipError(e instanceof Error ? e.message : tr("crm.membershipLoadFailed"));
    }
  }, []);

  /** NF7: manual store-credit grant — amount + reason required
   * (the API enforces both); on success the section refetches
   * and shows the server's derived balance. */
  async function grantCredit() {
    const orgId = getOrganizationId(); if (!orgId || !detail) return;
    const payload = buildGrantPayload({ amountTaka: grantTaka, note: grantNote });
    if (!payload) { setGrantError(tr("crm.creditAmountReasonRequired")); return; }
    setGrantBusy(true); setGrantError("");
    try {
      const out = await apiFetch<{ balanceMinor: string }>(`/organizations/${orgId}/customers/${detail.customer.id}/store-credit/grant`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      toast({ title: `__X__`, tone: "success" });
      setGrantTaka(""); setGrantNote("");
      await loadMembership(detail.customer.id);
    } catch (e) { setGrantError(e instanceof Error ? e.message : tr("crm.creditFailed")); }
    finally { setGrantBusy(false); }
  }

  /** NF7: tier definitions manager (CRUD + tier price list). */
  const loadTiers = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const out = await apiFetch<{ items: TierView[] }>(`/organizations/${orgId}/membership/tiers`);
      setTiers(out.items ?? []); setTierError("");
    } catch (e) { setTierError(e instanceof Error ? e.message : tr("crm.tierLoadFailed")); }
  }, []);

  useEffect(() => { void loadTiers(); }, [loadTiers]);

  async function createTier() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const payload = buildTierPayload({ name: tierName, minSpendTaka: tierMinTaka, sortOrder: tierSort });
    if (!payload) { setTierError(tr("crm.tierNameSpendRequired")); return; }
    setTierBusy("create"); setTierError("");
    try {
      await apiFetch(`/organizations/${orgId}/membership/tiers`, { method: "POST", body: JSON.stringify(payload) });
      toast({ title: tr("crm.tierCreated"), tone: "success" });
      setTierName(""); setTierMinTaka(""); setTierSort("0");
      await loadTiers();
      if (detail) await loadMembership(detail.customer.id);
    } catch (e) { setTierError(e instanceof Error ? e.message : tr("crm.tierCreateFailed")); }
    finally { setTierBusy(""); }
  }

  async function deleteTier(t: TierView) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: tr("crm.tierDeleteConfirm", { name: t.name }), body: tr("crm.tierDeleteBody"), danger: true, confirmLabel: tr("crm.deleteIt") }))) return;
    setTierBusy(t.id); setTierError("");
    try {
      await apiFetch(`/organizations/${orgId}/membership/tiers/${t.id}`, { method: "DELETE" });
      toast({ title: tr("crm.tierDeleted"), tone: "success" });
      if (tierPlTierId === t.id) { setTierPlTierId(""); setTierPlItems([]); }
      await loadTiers();
      if (detail) await loadMembership(detail.customer.id);
    } catch (e) { setTierError(e instanceof Error ? e.message : tr("crm.tierDeleteFailed")); }
    finally { setTierBusy(""); }
  }

  const loadTierPriceList = useCallback(async (tierId: string) => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setTierPlTierId(tierId);
    try {
      const out = await apiFetch<{ items: PriceListItemRow[] }>(`/organizations/${orgId}/commerce/tiers/${tierId}/price-list`);
      setTierPlItems(out.items ?? []);
    } catch (e) { setTierError(e instanceof Error ? e.message : tr("crm.tierPriceListLoadFailed")); }
  }, []);

  async function addTierPlItem() {
    const orgId = getOrganizationId(); if (!orgId || !tierPlTierId) return;
    const minor = takaToMinor(tierPlPriceTaka);
    if (!tierPlProductId.trim() || minor === null) { setTierError(tr("crm.productPriceRequired")); return; }
    setTierBusy("pl-add"); setTierError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/tiers/${tierPlTierId}/price-list/items`, {
        method: "POST",
        body: JSON.stringify({ productId: tierPlProductId.trim(), priceMinor: minor }),
      });
      setTierPlProductId(""); setTierPlPriceTaka("");
      await loadTierPriceList(tierPlTierId);
    } catch (e) { setTierError(e instanceof Error ? e.message : tr("crm.itemAddFailed")); }
    finally { setTierBusy(""); }
  }

  async function removeTierPlItem(item: PriceListItemRow) {
    const orgId = getOrganizationId(); if (!orgId || !tierPlTierId) return;
    setTierBusy(item.id); setTierError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/tiers/${tierPlTierId}/price-list/items/${item.id}`, { method: "DELETE" });
      await loadTierPriceList(tierPlTierId);
    } catch (e) { setTierError(e instanceof Error ? e.message : tr("crm.itemDeleteFailed")); }
    finally { setTierBusy(""); }
  }

  /** ON7: save the credit limit via the existing customer PATCH
   * (taka input -> minor string; an empty input clears the
   * limit to null). The server's reply is shown verbatim. */
  async function saveCreditLimit() {
    const orgId = getOrganizationId(); if (!orgId || !detail) return;
    const raw = creditTaka.trim();
    let creditLimitMinor: string | null = null;
    if (raw) {
      const m = takaToMinor(raw);
      if (m === null) { setCreditError(tr("crm.creditLimitInvalid")); return; }
      creditLimitMinor = m;
    }
    setCreditBusy(true); setCreditError("");
    try {
      await apiFetch(`/organizations/${orgId}/customers/${detail.customer.id}`, {
        method: "PATCH", body: JSON.stringify({ creditLimitMinor }),
      });
      toast({ title: creditLimitMinor === null ? tr("crm.creditLimitRemoved") : tr("crm.creditLimitSaved"), tone: "success" });
      await loadKhata(detail.customer.id);
      await load();
    } catch (e) { setCreditError(e instanceof Error ? e.message : tr("crm.creditLimitSaveFailed")); }
    finally { setCreditBusy(false); }
  }
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchCustomFieldDefs("customer").then(setCustDefs).catch(() => undefined); }, []);
  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    apiFetch<{ id: string; name: string; platform?: string; syncMode?: string }[]>(`/organizations/${orgId}/stores`).then(setStores).catch(() => undefined);
  }, []);

  // EC6: explicit, opt-in push of this customer to one store —
  // never automatic. The server refuses mirror-mode stores with a
  // reason, which is surfaced verbatim.
  async function pushToStore(storeId: string) {
    const orgId = getOrganizationId(); if (!orgId || !detail) return;
    setBusy(`push-${storeId}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/customers/${detail.customer.id}/push-to-store/${storeId}`, { method: "POST" });
      toast({ title: tr("crm.pushQueued"), tone: "success" });
    } catch (e) { setError(e instanceof Error ? e.message : tr("crm.pushFailed")); }
    finally { setBusy(""); }
  }

  // CRM C3: CSV export — blob download with the auth header (same
  // pattern as the orders PDF / scorecard CSV downloads).
  async function downloadExport() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError("");
    try {
      const res = await fetch(`${API_URL}/organizations/${orgId}/customers/export`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      if (!res.ok) { const body: any = await res.json().catch(() => ({})); throw new Error(body?.message ?? `HTTP ${res.status}`); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "customers-export.csv"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { setError(e instanceof Error ? e.message : tr("crm.exportFailed")); }
  }

  async function open(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setKhata(null); setKhataError(""); setCreditError("");
    void loadKhata(id);
    setLoyalty(null); setLoyaltyError(""); setAdjustDelta(""); setAdjustNote(""); setAdjustError("");
    void loadLoyalty(id);
    setCustTier(null); setCustCredit(null); setMembershipError(""); setGrantTaka(""); setGrantNote(""); setGrantError("");
    void loadMembership(id);
    try {
      const d = await apiFetch<Detail>(`/organizations/${orgId}/customers/${id}`);
      setDetail(d); setMergeTarget("");
      // CX12b: this customer's reviews (360 surface).
      apiFetch<{ id: string; orderId: string; rating: number | null; comment: string | null; status: string; receivedAt: string | null; orderNumber: string | null }[]>(`/organizations/${orgId}/reviews?customerId=${id}`).then(setCustReviews).catch(() => setCustReviews([]));
      setEditForm({
        firstName: d.customer.firstName ?? "", lastName: d.customer.lastName ?? "",
        email: d.customer.email ?? "", phone: d.customer.phone ?? "",
      });
      setEditWholesale(!!d.customer.isWholesale);
      // AB5 (AX7): seed group + credit terms from the detail payload.
      setEditGroupId(d.customer.groupId ?? "");
      setEditCreditTerms(String(d.customer.creditTermsDays ?? 0));
      setKhataOverdueOnly(false);
      setEditCf(customFieldsToRaw(custDefs, d.customer.customFields));
      // GB6 (GC15): seed the CRM editor from the detail payload.
      setCrmTags(d.customer.tags ?? []);
      setCrmTagInput(""); setCrmTagError("");
      setCrmNotes(d.customer.notes ?? "");
      setCrmVip(!!d.customer.isVip);
      setCrmBlocked(!!d.customer.isBlocked);
      setCrmBlockedReason(d.customer.blockedReason ?? "");
      setCrmError("");
    }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  // CRM C4: the first customer edit path — contact basics + custom
  // fields via PATCH /customers/:id (audited server-side).
  async function saveEdit() {
    const orgId = getOrganizationId(); if (!orgId || !detail) return;
    setBusy("edit"); setError("");
    try {
      const customFields = buildCustomFieldsPayload(custDefs, editCf, detail.customer.customFields);
      const out = await apiFetch<Detail>(`/organizations/${orgId}/customers/${detail.customer.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          firstName: editForm.firstName || null, lastName: editForm.lastName || null,
          email: editForm.email || null, phone: editForm.phone || null,
          isWholesale: editWholesale,
          // AB5 (AX7): B2B group (empty select = no group) + net terms.
          groupId: editGroupId || null,
          creditTermsDays: Number(editCreditTerms) || 0,
          ...(Object.keys(customFields).length ? { customFields } : {}),
        }),
      });
      setDetail(out);
      setEditCf(customFieldsToRaw(custDefs, out.customer.customFields));
      toast({ title: tr("crm.customerSaved"), tone: "success" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : tr("crm.saveFailed")); }
    finally { setBusy(""); }
  }

  // CP6: GDPR deep erasure — irreversible PII removal. Order
  // financial records stay; the confirm dialog says so plainly.
  async function doErase() {
    const orgId = getOrganizationId(); if (!orgId || !detail) return;
    if (!(await confirm({ title: tr("crm.eraseConfirmTitle"), body: tr("crm.eraseConfirmBody"), danger: true, confirmLabel: tr("crm.eraseIt") }))) return;
    setBusy("erase"); setError(""); setEraseReport(null);
    try {
      const report = await apiFetch<{ customerId: string; ordersAnonymized: number; identitiesDeleted: number; reviewsRedacted: number; abandonedCheckoutsDeleted: number }>(
        `/organizations/${orgId}/customers/${detail.customer.id}/erase`, { method: "POST" },
      );
      setEraseReport(report);
      toast({ title: tr("crm.erasedDone"), tone: "success" });
      await load();
      await open(report.customerId);
    } catch (e) { setError(e instanceof Error ? e.message : tr("crm.eraseFailed")); }
    finally { setBusy(""); }
  }

  async function doMerge() {
    const orgId = getOrganizationId(); if (!orgId || !detail || !mergeTarget) return;
    if (!(await confirm({ title: tr("crm.mergeConfirmTitle"), body: tr("crm.mergeBody"), confirmLabel: tr("crm.mergeIt") }))) return;
    setBusy("merge");
    try {
      const merged = await apiFetch<Detail>(`/organizations/${orgId}/customers/merge`, {
        method: "POST", body: JSON.stringify({ sourceId: detail.customer.id, targetId: mergeTarget }),
      });
      setDetail(merged);
      toast({ title: tr("crm.mergeDone"), tone: "success" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : tr("crm.mergeFailed")); }
    finally { setBusy(""); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="page-title">Customers 360 & LTV Retention</h1>
          <p className="text-slate-500">{tr("crm.pageIntro")}</p>
        </div>
      </div>
      {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      {/* Main Mode Navigation Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab("directory")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-bold transition ${
            activeTab === "directory"
              ? "border-indigo-600 text-indigo-600 bg-indigo-50/20"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>{tr("crm.directoryTitle")}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{rows.length}</span>
        </button>

        <button
          onClick={() => setActiveTab("rfm")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-bold transition ${
            activeTab === "rfm"
              ? "border-indigo-600 text-indigo-600 bg-indigo-50/20"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>{tr("crm.rfmStudioTitle")}</span>
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-black text-indigo-700">
            AI CRM
          </span>
        </button>
      </div>
      {activeTab === "rfm" ? (
        <RfmRetentionStudio
          onSelectCustomer={(id) => {
            setActiveTab("directory");
            open(id);
          }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input w-72" placeholder={tr("crm.searchPlaceholder")} aria-label={tr("crm.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={hasDue} onChange={(e) => setHasDue(e.target.checked)} />
              {tr("crm.dueOnlyLabel")}
            </label>
            <button className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold" onClick={downloadExport}>{tr("crm.csvExport")}</button>
          </div>
          {/* GB6 (GC15): CRM filters — type / exact tag / segment, all
              wired to the real list query params. */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm">{tr("crm.customerTypeLabel")}
              <select className="input w-40" value={customerType} onChange={(e) => setCustomerType(e.target.value)}>
                {CUSTOMER_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <input className="input w-52" placeholder={tr("crm.tagFilterLabel")} aria-label={tr("crm.tagFilterLabel")} value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} />
            <label className="flex items-center gap-2 text-sm">{tr("crm.segmentLabel")}
              <select className="input w-56" value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
                <option value="">{tr("crm.allSegments")}</option>
                {segments.map((s) => <option key={s.id} value={s.id}>{s.name} ({tr("crm.membersSuffix", { count: fmtNumber(locale, s.memberCount) })})</option>)}
              </select>
            </label>
            {(customerType !== "all" || tagFilter || segmentId) ? (
              <button className="rounded-lg border bg-white px-3 py-2 text-sm" onClick={() => { setCustomerType("all"); setTagFilter(""); setSegmentId(""); }}>{tr("crm.clearFilters")}</button>
            ) : null}
          </div>
          <div className="grid gap-4 lg:grid-cols-5">
        <div className="card overflow-hidden p-0 lg:col-span-2">
          {loading ? <p className="p-4 text-sm text-slate-400">{tr("crm.loading")}</p> : rows.length === 0 ? (
            <div className="p-4"><EmptyState title={tr("crm.noCustomers")} description={tr("crm.noCustomersHint")} /></div>
          ) : rows.map((c) => (
            <button key={c.id} onClick={() => open(c.id)} className={`block w-full border-b px-4 py-3 text-left transition hover:bg-slate-50 ${detail?.customer.id === c.id ? "bg-indigo-50/60" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{c.name || tr("crm.noName")}</span>
                <span className="text-sm font-semibold">{moneyL(c.totalSpentMinor)}</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-500">{c.phone ?? c.email ?? "—"} · {tr("crm.ordersSuffix", { count: fmtNumber(locale, c.orderCount) })} · {c.source}</div>
              {/* GB6 (GC15): sold-bucket figures — sold orders,
                  lifetime value and AOV ("—" when no sold order). */}
              <div className="mt-0.5 text-xs text-slate-500">
                {tr("crm.soldLine")} {tr("crm.countTi", { count: fmtNumber(locale, c.soldOrderCount ?? 0) })} · {tr("crm.lifetimeValueLabel")} {moneyL(c.lifetimeValueMinor ?? "0")} · {tr("crm.aovLabel")} {c.aovMinor != null ? moneyL(c.aovMinor) : "—"}
              </div>
              {(c.isRepeat || c.isVip || c.isBlocked || (c.tags ?? []).length > 0) ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.isRepeat ? <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">{tr("crm.repeatBadge")}</span> : null}
                  {c.isVip ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">⭐ VIP</span> : null}
                  {c.isBlocked ? <span className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">{tr("crm.blockedBadge")}</span> : null}
                  {(c.tags ?? []).map((t) => <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">#{t}</span>)}
                </div>
              ) : null}
              {/* ON7: due (open due) on the list row — "—" when nothing is due. */}
              <div className="mt-0.5 text-xs">
                <span className="text-slate-500">{tr("crm.dueLabel")} </span>
                {(() => { let due = 0n; try { due = BigInt(c.dueMinor ?? "0"); } catch { due = 0n; } return due > 0n
                  ? <span className="font-bold text-red-600">{moneyL(c.dueMinor)}</span>
                  : <span className="text-slate-500">—</span>; })()}
                {c.creditLimitMinor ? <span className="ml-2 text-slate-500">· {tr("crm.creditLimitSuffix")} {moneyL(c.creditLimitMinor)}</span> : null}
              </div>
            </button>
          ))}
        </div>
        <div className="lg:col-span-3">
          {detail ? (
            <div className="space-y-4">
              <div className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold">{detail.customer.name || tr("crm.noName")}</h2>
                    <p className="text-sm text-slate-500">{detail.customer.phone ?? "—"} · {detail.customer.email ?? "—"}</p>
                    <p className="text-xs text-slate-500">{tr("crm.sourcePrefix")} {detail.customer.source} · {tr("crm.joinedPrefix")} {fmtDate(locale, detail.customer.createdAt)}{detail.lead ? ` · Lead: ${detail.lead.stage}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-black">{moneyL(detail.lifetime.totalSpentMinor, detail.lifetime.currency)}</div>
                    <div className="text-xs text-slate-500">{tr("crm.lifetimeLine")} · {tr("crm.ordersSuffix", { count: fmtNumber(locale, detail.lifetime.orderCount) })}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
                  <label className="block text-sm">{tr("crm.mergeIntoLabel")}
                    <select className="input ml-2 w-56" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
                      <option value="">{tr("crm.pickCustomer")}</option>
                      {rows.filter((r) => r.id !== detail.customer.id).map((r) => <option key={r.id} value={r.id}>{r.name || r.phone || r.id.slice(0, 8)} ({tr("crm.ordersCountSuffix", { count: fmtNumber(locale, r.orderCount) })})</option>)}
                    </select>
                  </label>
                  <button className="btn-warning" disabled={!mergeTarget || busy !== ""} onClick={doMerge}>{busy === "merge" ? tr("crm.merging") : tr("crm.mergeIt")}</button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-red-100 pt-3">
                  <button className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={doErase}>
                    {busy === "erase" ? tr("crm.erasing") : tr("crm.eraseBtn")}
                  </button>
                  <span className="text-xs text-slate-500">{tr("crm.eraseOwnerNote")}</span>
                </div>
                {eraseReport ? (
                  <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    {tr("crm.eraseReportLine", { orders: fmtNumber(locale, eraseReport.ordersAnonymized), identities: fmtNumber(locale, eraseReport.identitiesDeleted) })}</p>
                ) : null}
              </div>
              <div className="card space-y-3">
                <h3 className="font-semibold">{tr("crm.editInfo")}</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block text-sm">{tr("crm.firstNameLabel")}
                    <input className="input mt-1" value={editForm.firstName} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })} />
                  </label>
                  <label className="block text-sm">{tr("crm.lastNameLabel")}
                    <input className="input mt-1" value={editForm.lastName} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })} />
                  </label>
                  <label className="block text-sm">{tr("crm.phoneLabel")}
                    <input className="input mt-1" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                  </label>
                  <label className="block text-sm">{tr("crm.emailLabel")}
                    <input className="input mt-1" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                  </label>
                  <CustomFieldsEditor defs={custDefs} raw={editCf} onChange={(k, v) => setEditCf({ ...editCf, [k]: v })} />
                  <label className="flex items-center gap-2 text-sm md:col-span-2">
                    <input type="checkbox" checked={editWholesale} onChange={(e) => setEditWholesale(e.target.checked)} />
                    {tr("crm.wholesaleLabel")}
                  </label>
                  {/* AB5 (AX7): B2B group + net credit terms. */}
                  <label className="block text-sm">{tr("crm.groupLabelB2b")}
                    <select className="input mt-1" value={editGroupId} onChange={(e) => setEditGroupId(e.target.value)}>
                      <option value="">{tr("crm.noGroup")}</option>
                      {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                    <span className="mt-1 block text-xs font-normal text-slate-500">{tr("crm.groupPriceNote")}</span>
                  </label>
                  <label className="block text-sm">{tr("crm.creditTermsLabel")}
                    <select className="input mt-1" value={editCreditTerms} onChange={(e) => setEditCreditTerms(e.target.value)}>
                      <option value="0">{tr("crm.terms0")}</option>
                      <option value="7">{tr("crm.terms7")}</option>
                      <option value="14">{tr("crm.terms14")}</option>
                      <option value="30">{tr("crm.terms30")}</option>
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button className="btn-primary" disabled={busy !== ""} onClick={saveEdit}>{busy === "edit" ? tr("crm.saving") : tr("crm.audSave")}</button>
                  <span className="text-xs text-slate-500">{tr("crm.customFieldsNote1")} <a className="underline" href="/dashboard/leads">Leads & CRM {tr("crm.customFieldsNote2")}</a> {tr("crm.customFieldsWord")} {tr("crm.customFieldsNote3")}</span>
                </div>
              </div>
              {/* GB6 (GC15): CRM — tags / VIP / staff notes / block. */}
              <div className="card space-y-3">
                <h3 className="font-semibold">{tr("crm.crmSectionTitle")}</h3>
                {detail.customer.isBlocked ? (
                  <div className="rounded-xl bg-red-600 px-3 py-2 text-sm font-semibold text-white">
                    {tr("crm.blockedBanner")}{detail.customer.blockedReason ? ` — ${tr("crm.blockedReasonPrefix")} ${detail.customer.blockedReason}` : ""}{tr("crm.blockedBannerSuffix")} {tr("crm.blockedCheckoutNote")}
                  </div>
                ) : null}
                {crmError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{crmError}</p> : null}
                <div>
                  <div className="mb-1 text-sm font-medium">{tr("crm.tagsLabel")}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {crmTags.map((t) => (
                      <span key={t} className="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                        #{t}
                        <button type="button" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center font-bold text-slate-400 hover:text-red-600" aria-label={tr("crm.tagRemoveTitle", { tag: t })}
                          onClick={() => setCrmTags(crmTags.filter((x) => x !== t))}>×</button>
                      </span>
                    ))}
                    {crmTags.length === 0 ? <span className="text-xs text-slate-500">{tr("crm.noTags")}</span> : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input className="input w-56" placeholder={tr("crm.newTagPlaceholder")} aria-label={tr("crm.newTagPlaceholder")} value={crmTagInput}
                      onChange={(e) => setCrmTagInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCrmTag(); } }} />
                    <button type="button" className="btn-secondary btn-sm" onClick={addCrmTag}>{tr("crm.addTag")}</button>
                  </div>
                  {crmTagError ? <p className="mt-1 text-xs text-red-600">{crmTagError}</p> : null}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={crmVip} onChange={(e) => setCrmVip(e.target.checked)} />
                  {tr("crm.vipLabel")}
                </label>
                <label className="block text-sm font-medium">{tr("crm.internalNoteLabel")}
                  <span className="mb-1 block text-xs font-normal text-amber-700">{tr("crm.internalNoteNote")}</span>
                  <textarea className="input mt-1 w-full" rows={3} value={crmNotes} onChange={(e) => setCrmNotes(e.target.value)}
                    placeholder={tr("crm.internalNotePlaceholder")} />
                </label>
                <div className="space-y-2 rounded-xl bg-red-50/60 p-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-red-700">
                    <input type="checkbox" checked={crmBlocked} onChange={(e) => setCrmBlocked(e.target.checked)} />
                    {tr("crm.blockLabel")}
                  </label>
                  {crmBlocked ? (
                    <label className="block text-sm">{tr("crm.blockReasonLabel")}
                      <input className="input mt-1 w-full" value={crmBlockedReason} onChange={(e) => setCrmBlockedReason(e.target.value)}
                        placeholder={tr("crm.blockReasonPlaceholder")} maxLength={320} />
                      <span className="mt-1 block text-xs font-normal text-slate-500">{tr("crm.blockReasonNote")}</span>
                    </label>
                  ) : null}
                </div>
                <button className="btn-primary" disabled={busy !== ""} onClick={saveCrm}>{busy === "crm" ? tr("crm.saving") : tr("crm.crmSave")}</button>
              </div>
              <div className="card space-y-3">
                <h3 className="font-semibold">{tr("crm.identitiesTitle")}</h3>
                <p className="text-xs text-slate-500">{tr("crm.identitiesNote")}</p>
                {(detail.storeIdentities ?? []).length === 0 ? (
                  <p className="text-sm text-slate-400">{tr("crm.noIdentities")}</p>
                ) : (detail.storeIdentities ?? []).map((si) => (
                  <div key={si.storeId} className="flex flex-wrap items-center justify-between gap-2 border-b py-1.5 text-sm last:border-0">
                    <span><span className="font-medium">{si.storeName ?? tr("crm.storeFallback")}</span> <span className="badge-slate ml-1">{si.platform ?? ""}</span>
                      <span className="ml-2 text-slate-500">ID: {si.externalId}</span>
                      {si.emailSnapshot ? <span className="ml-2 text-xs text-slate-500">{si.emailSnapshot}</span> : null}
                    </span>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  {stores.map((s) => {
                    const mode = s.syncMode ?? "mirror";
                    const has = (detail.storeIdentities ?? []).some((si) => si.storeId === s.id);
                    return (
                      <button key={s.id} className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                        disabled={busy !== "" || mode === "mirror"}
                        title={mode === "mirror" ? tr("crm.mirrorNoPush") : undefined}
                        onClick={() => pushToStore(s.id)}>
                        {busy === `push-${s.id}` ? tr("crm.pushingLabel") : has ? tr("crm.pushUpdateLabel", { name: s.name }) : tr("crm.pushNewLabel", { name: s.name })}
                        {mode === "mirror" ? tr("crm.mirrorSuffix") : ""}
                      </button>
                    );
                  })}
                  {stores.length === 0 ? <span className="text-xs text-slate-500">{tr("crm.noStoreConnected")}</span> : null}
                </div>
              </div>
              {detail.risk ? (
                <div className="card space-y-1">
                  <h3 className="font-semibold">{tr("crm.returnRisk")} <span className={`ml-2 rounded px-2 py-0.5 text-xs font-semibold ${RISK_LABEL[detail.risk.band]?.cls ?? ""}`}>{RISK_LABEL[detail.risk.band]?.text ?? detail.risk.band}{detail.risk.score != null ? ` · ${tr("crm.scoreSuffix", { score: fmtNumber(locale, detail.risk.score) })}/${fmtNumber(locale, 100)}` : ""}</span></h3>
                  <p className="text-sm text-slate-600">{tr("crm.riskHistoryLine", { total: fmtNumber(locale, detail.risk.history.total), delivered: fmtNumber(locale, detail.risk.history.delivered), returned: fmtNumber(locale, detail.risk.history.returned), cancelled: fmtNumber(locale, detail.risk.history.cancelledOrFailed), refunded: fmtNumber(locale, detail.risk.history.refunded) })}</p>
                  <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-500">
                    {detail.risk.reasons.slice(0, 4).map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                  {detail.risk.suggestion ? <p className="text-xs font-medium text-amber-700">{detail.risk.suggestion}</p> : null}
                </div>
              ) : null}
              {detail.courierRecord ? (
                <div className="card space-y-2">
                  <h3 className="font-semibold">🚚 Courier Record</h3>
                  {detail.courierRecord.decided === 0 ? (
                    <p className="text-sm text-slate-500">{tr("crm.noDeliveryHistory")}</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-3xl font-bold text-emerald-700">{detail.courierRecord.successRatePct}%</span>
                        <span className="text-sm font-medium text-slate-600">{tr("crm.deliveryRateTitle")}</span>
                        <span className="text-xs text-slate-500">{tr("crm.courierDecidedNote", { decided: fmtNumber(locale, detail.courierRecord.decided), delivered: fmtNumber(locale, detail.courierRecord.delivered) })}</span>
                      </div>
                      <p className="text-sm text-slate-600">{tr("crm.courierLine2", { returned: fmtNumber(locale, detail.courierRecord.returned), cancelled: fmtNumber(locale, detail.courierRecord.cancelledOrFailed), refunded: fmtNumber(locale, detail.courierRecord.refunded) })} · {tr("crm.totalShipmentsSuffix", { count: fmtNumber(locale, detail.courierRecord.totalShipments) })}{detail.courierRecord.lastDeliveryAt ? ` · ${tr("crm.lastDeliverySuffix")} ${fmtDate(locale, detail.courierRecord.lastDeliveryAt)}` : ""}</p>
                      {detail.courierRecord.perCourier.length > 0 ? (
                        <ResponsiveTable
                          table={
                            <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-xs text-slate-500"><th className="py-1 font-medium">{tr("crm.courierCol")}</th><th className="py-1 font-medium">{tr("crm.decidedCol")}</th><th className="py-1 font-medium">{tr("crm.deliveredCol")}</th><th className="py-1 font-medium">{tr("crm.successRateCol")}</th></tr>
                          </thead>
                          <tbody>
                            {detail.courierRecord.perCourier.map((p) => (
                              <tr key={p.provider} className="border-b last:border-0">
                                <td className="py-1 font-medium">{p.provider}</td>
                                <td className="py-1">{tr("crm.countTi", { count: fmtNumber(locale, p.decided) })}</td>
                                <td className="py-1">{tr("crm.countTi", { count: fmtNumber(locale, p.delivered) })}</td>
                                <td className="py-1">{p.successRatePct != null ? `${p.successRatePct}%` : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                            </table>
                          }
                          cards={detail.courierRecord.perCourier.map((p) => (
                            <div key={p.provider} className="rounded-lg border p-3">
                              <div className="flex items-start justify-between gap-2">
                                <span className="font-medium">{p.provider}</span>
                                <span className="font-semibold">{p.successRatePct != null ? `${p.successRatePct}%` : "—"}</span>
                              </div>
                              <dl className="mt-2 space-y-1.5 text-sm">
                                <div className="flex gap-2">
                                  <dt className="w-28 shrink-0 text-xs font-semibold text-slate-500">{tr("crm.decidedCol")}</dt>
                                  <dd>{tr("crm.countTi", { count: fmtNumber(locale, p.decided) })}</dd>
                                </div>
                                <div className="flex gap-2">
                                  <dt className="w-28 shrink-0 text-xs font-semibold text-slate-500">{tr("crm.deliveredCol")}</dt>
                                  <dd>{tr("crm.countTi", { count: fmtNumber(locale, p.delivered) })}</dd>
                                </div>
                              </dl>
                            </div>
                          ))}
                        />
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
              {custReviews.filter((r) => r.rating != null).length > 0 ? (
                <div className="card space-y-1">
                  <h3 className="font-semibold">{tr("crm.reviewsTitle")}</h3>
                  {custReviews.filter((r) => r.rating != null).map((r) => (
                    <div key={r.id} className="border-b py-1.5 text-sm last:border-0">
                      <span className="text-amber-500">{"★★★★★".slice(0, r.rating ?? 0)}{"☆☆☆☆☆".slice(0, 5 - (r.rating ?? 0))}</span>
                      <span className="ml-2 font-medium">#{r.orderNumber ?? r.orderId.slice(0, 8)}</span>
                      {r.comment ? <span className="ml-2 text-slate-700">“{r.comment}”</span> : null}
                      {r.receivedAt ? <span className="ml-2 text-xs text-slate-500">{fmtDate(locale, r.receivedAt)}</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {/* ON7: khata — the customer's ledger: total due,
                  aging buckets, credit limit and the open
                  orders behind the numbers. */}
              <div className="card space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{tr("crm.khataTitle")}</h3>
                  {/* AB5 (AX7): net terms in the header + overdue-only filter. */}
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    {khata ? (
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        {tr("crm.creditTermsLabel")}: {(khata.creditTermsDays ?? 0) > 0 ? tr("crm.creditTermsSuffix", { days: fmtNumber(locale, khata.creditTermsDays ?? 0) }) : tr("crm.noTerms")}
                      </span>
                    ) : null}
                    <label className="flex items-center gap-2 text-xs font-medium">
                      <input type="checkbox" checked={khataOverdueOnly} onChange={(e) => {
                        setKhataOverdueOnly(e.target.checked);
                        if (detail) void loadKhata(detail.customer.id, e.target.checked);
                      }} />
                      {tr("crm.overdueOnly")}
                    </label>
                  </div>
                </div>
                {khataError ? (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{khataError}</p>
                ) : !khata ? (
                  <p className="text-sm text-slate-400">{tr("crm.loadingEllipsis")}</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <div>
                        <div className="text-2xl font-black text-red-600">{moneyL(khata.totalDueMinor)}</div>
                        <div className="text-xs text-slate-500">{tr("crm.totalDue")}</div>
                      </div>
                      {isOverLimit(khata) ? (
                        <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold text-white">{tr("crm.creditLimitExceeded")}</span>
                      ) : null}
                      {khata.availableCreditMinor != null ? (
                        <div className="text-sm">
                          <span className="text-slate-500">{tr("crm.usableCredit")} </span>
                          <b className={isOverLimit(khata) ? "text-red-600" : "text-emerald-700"}>{moneyL(khata.availableCreditMinor)}</b>
                        </div>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {agingRows(khata).map((r) => (
                        <div key={r.key} className="rounded-lg bg-slate-50 px-3 py-2 text-center">
                          <div className="text-sm font-bold">{moneyL(r.amountMinor)}</div>
                          <div className="text-[11px] text-slate-500">{r.label}</div>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2 border-t pt-3">
                      <label className="block text-sm font-medium">{tr("crm.creditLimitFormLabel")}
                        <span className="mt-1 flex flex-wrap items-center gap-2">
                          <input className="input w-44" inputMode="decimal" placeholder={tr("crm.exAmount5000")} value={creditTaka} onChange={(e) => setCreditTaka(e.target.value)} />
                          <button type="button" className="btn-primary btn-sm" disabled={creditBusy} onClick={() => void saveCreditLimit()}>
                            {creditBusy ? tr("crm.savingEllipsis") : tr("crm.saveLimit")}
                          </button>
                          <span className="text-xs text-slate-500">{tr("crm.currentPrefix")} {khata.creditLimitMinor ? moneyL(khata.creditLimitMinor) : tr("crm.noLimitSet")}</span>
                        </span>
                      </label>
                      {creditError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{creditError}</p> : null}
                    </div>
                    {khata.orders.length === 0 ? (
                      <p className="text-sm text-slate-400">{khataOverdueOnly ? tr("crm.khataEmptyOverdue") : tr("crm.khataEmpty")}</p>
                    ) : (
                      <ResponsiveTable
                        table={
                          <div>
                            <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b text-xs text-slate-500">
                              <th className="py-1.5 pr-2 font-semibold">{tr("crm.colOrder")}</th>
                              <th className="py-1.5 pr-2 font-semibold">{tr("crm.colDate")}</th>
                              <th className="py-1.5 pr-2 font-semibold">{tr("crm.sourceTotal")}</th>
                              <th className="py-1.5 pr-2 font-semibold">{tr("crm.colPaid")}</th>
                              <th className="py-1.5 pr-2 font-semibold">{tr("crm.colDue")}</th>
                              <th className="py-1.5 pr-2 font-semibold">{tr("crm.colDueDate")}</th>
                              <th className="py-1.5 font-semibold">{tr("crm.colStatus")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {khata.orders.map((o) => (
                              <tr key={o.id} className="border-b last:border-0">
                                <td className="py-1.5 pr-2 font-medium">#{o.number ?? o.id.slice(0, 8)}</td>
                                <td className="py-1.5 pr-2">{o.placedAt ? fmtDate(locale, o.placedAt) : "—"}</td>
                                <td className="py-1.5 pr-2">{moneyL(o.totalMinor)}</td>
                                <td className="py-1.5 pr-2">{moneyL(o.paidMinor)}</td>
                                <td className="py-1.5 pr-2">{(() => { let d = 0n; try { d = BigInt(o.dueMinor); } catch { d = 0n; } return d > 0n
                                  ? <span className="font-bold text-red-600">{moneyL(o.dueMinor)}</span>
                                  : <span className="text-slate-400">—</span>; })()}</td>
                                <td className="py-1.5 pr-2">{o.creditDueDate ? fmtDate(locale, o.creditDueDate) : "—"}</td>
                                <td className="py-1.5">
                                  <span className="badge-slate">{o.status}</span>
                                  {o.overdue ? <span className="ml-1 rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white">{tr("crm.overdueBadge")}</span> : null}
                                </td>
                              </tr>
                            ))}
                            </tbody>
                            </table>
                          </div>
                        }
                        cards={khata.orders.map((o) => (
                          <div key={o.id} className="rounded-lg border p-3">
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-medium">#{o.number ?? o.id.slice(0, 8)}</span>
                              <span>
                                <span className="badge-slate">{o.status}</span>
                                {o.overdue ? <span className="ml-1 rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white">{tr("crm.overdueBadge")}</span> : null}
                              </span>
                            </div>
                            <dl className="mt-2 space-y-1.5 text-sm">
                              <div className="flex gap-2">
                                <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">{tr("crm.colDate")}</dt>
                                <dd>{o.placedAt ? fmtDate(locale, o.placedAt) : "—"}</dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">{tr("crm.sourceTotal")}</dt>
                                <dd>{moneyL(o.totalMinor)}</dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">{tr("crm.colPaid")}</dt>
                                <dd>{moneyL(o.paidMinor)}</dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">{tr("crm.colDue")}</dt>
                                <dd>{(() => { let d = 0n; try { d = BigInt(o.dueMinor); } catch { d = 0n; } return d > 0n
                                  ? <span className="font-bold text-red-600">{moneyL(o.dueMinor)}</span>
                                  : <span className="text-slate-500">—</span>; })()}</dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">{tr("crm.colDueDate")}</dt>
                                <dd>{o.creditDueDate ? fmtDate(locale, o.creditDueDate) : "—"}</dd>
                              </div>
                            </dl>
                          </div>
                        ))}
                      />
                    )}
                    {khata.ordersTruncated ? (
                      <p className="text-xs text-amber-700">{tr("crm.khataMoreNote")}</p>
                    ) : null}
                  </>
                )}
              </div>
              {/* AB1: loyalty — balance + value, ledger history,
                  referral reward coupons and the staff adjust
                  form (note required). */}
              <div className="card space-y-3">
                <h3 className="font-semibold">{tr("crm.loyaltyTitle")}</h3>
                {loyaltyError ? (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{loyaltyError}</p>
                ) : !loyalty ? (
                  <p className="text-sm text-slate-400">{tr("crm.loadingEllipsis")}</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <div>
                        <div className={`text-2xl font-black ${loyalty.balance < 0 ? "text-red-600" : ""}`}>{tr("crm.pointsSuffix", { count: fmtNumber(locale, loyalty.balance) })}</div>
                        <div className="text-xs text-slate-500">{tr("crm.balanceValueLine", { value: formatPaisaNumber(loyalty.balanceValueMinor), rate: formatPaisaNumber(loyalty.redeemValueMinorPerPoint) })}</div>
                      </div>
                      {!loyalty.enabled ? (
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{tr("crm.loyaltyOff")}</span>
                      ) : null}
                      {loyalty.balance < 0 ? (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">{tr("crm.negativeBalance")}</span>
                      ) : null}
                    </div>
                    {loyalty.entries.length === 0 ? (
                      <p className="text-sm text-slate-400">{tr("crm.noPointTx")}</p>
                    ) : (
                      <ResponsiveTable
                        table={
                          <div>
                            <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b text-xs text-slate-500">
                              <th className="py-1.5 pr-2 font-semibold">{tr("crm.cfTypeLabel")}</th>
                              <th className="py-1.5 pr-2 font-semibold">{tr("crm.colPoints")}</th>
                              <th className="py-1.5 pr-2 font-semibold">{tr("crm.colBalanceAfter")}</th>
                              <th className="py-1.5 pr-2 font-semibold">{tr("crm.colOrder")}</th>
                              <th className="py-1.5 font-semibold">{tr("crm.colDate")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {loyalty.entries.map((en) => (
                              <tr key={en.id} className="border-b last:border-0 align-top">
                                <td className="py-1.5 pr-2">
                                  <span className="font-medium">{loyaltyEntryLabel(en, locale)}</span>
                                  {loyaltyEntryNote(en) ? <span className="block text-xs text-slate-500">{loyaltyEntryNote(en)}</span> : null}
                                  {en.expiresAt ? <span className="block text-xs text-slate-500">{tr("crm.expiryPrefix")} {fmtDate(locale, en.expiresAt)}{en.remainingPoints != null ? ` · ${tr("crm.remainingPointsSuffix", { count: fmtNumber(locale, en.remainingPoints) })}` : ""}</span> : null}
                                </td>
                                <td className={`py-1.5 pr-2 font-semibold ${en.deltaPoints < 0 ? "text-red-600" : "text-emerald-700"}`}>{formatPointsDelta(en.deltaPoints)}</td>
                                <td className="py-1.5 pr-2">{en.balanceAfter}</td>
                                <td className="py-1.5 pr-2">{en.orderNumber ? `#${en.orderNumber}` : en.orderId ? `#${en.orderId.slice(0, 8)}` : "—"}</td>
                                <td className="py-1.5 text-slate-500">{fmtDate(locale, en.createdAt)}</td>
                              </tr>
                            ))}
                            </tbody>
                            </table>
                          </div>
                        }
                        cards={loyalty.entries.map((en) => (
                          <div key={en.id} className="rounded-lg border p-3">
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-medium">{loyaltyEntryLabel(en, locale)}</span>
                              <span className={`font-semibold ${en.deltaPoints < 0 ? "text-red-600" : "text-emerald-700"}`}>{formatPointsDelta(en.deltaPoints)}</span>
                            </div>
                            {loyaltyEntryNote(en) ? <div className="mt-0.5 text-xs text-slate-500">{loyaltyEntryNote(en)}</div> : null}
                            {en.expiresAt ? <div className="mt-0.5 text-xs text-slate-500">{tr("crm.expiryPrefix")} {fmtDate(locale, en.expiresAt)}{en.remainingPoints != null ? ` · ${tr("crm.remainingPointsSuffix", { count: fmtNumber(locale, en.remainingPoints) })}` : ""}</div> : null}
                            <dl className="mt-2 space-y-1.5 text-sm">
                              <div className="flex gap-2">
                                <dt className="w-28 shrink-0 text-xs font-semibold text-slate-500">{tr("crm.colBalanceAfter")}</dt>
                                <dd>{en.balanceAfter}</dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="w-28 shrink-0 text-xs font-semibold text-slate-500">{tr("crm.colOrder")}</dt>
                                <dd>{en.orderNumber ? `#${en.orderNumber}` : en.orderId ? `#${en.orderId.slice(0, 8)}` : "—"}</dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="w-28 shrink-0 text-xs font-semibold text-slate-500">{tr("crm.colDate")}</dt>
                                <dd className="text-slate-500">{fmtDate(locale, en.createdAt)}</dd>
                              </div>
                            </dl>
                          </div>
                        ))}
                      />
                    )}
                    {(loyalty.referralRewards?.coupons ?? []).length > 0 ? (
                      <div className="space-y-1 border-t pt-3">
                        <div className="text-sm font-semibold">{tr("crm.referralCouponsTitle")}</div>
                        {(loyalty.referralRewards?.coupons ?? []).map((c) => (
                          <div key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                            <span className="font-mono font-semibold">{c.code}</span>
                            <span>{c.kind === "percent" ? tr("crm.percentOffSuffix", { pct: fmtNumber(locale, c.value) }) : c.value}</span>
                            {c.sourceOrderNumber ? <span className="text-xs text-slate-500">{tr("crm.referredOrderPrefix")} #{c.sourceOrderNumber}</span> : null}
                            {c.endsAt ? <span className="text-xs text-slate-500">{tr("crm.expiryPrefix")} {fmtDate(locale, c.endsAt)}</span> : null}
                            {!c.active ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">{tr("crm.couponInactive")}</span>
                              : c.usedCount > 0 ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">{tr("crm.couponUsed", { count: fmtNumber(locale, c.usedCount) })}</span>
                              : <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">{tr("crm.couponActive")}</span>}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="space-y-2 border-t pt-3">
                      <div className="text-sm font-semibold">{tr("crm.adjustTitle")}</div>
                      <p className="text-xs text-slate-500">{tr("crm.adjustNote")}</p>
                      {adjustError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{adjustError}</p> : null}
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="block text-sm">{tr("crm.pointsPmLabel")}
                          <input className="input mt-1 w-36" type="number" step="1" value={adjustDelta} onChange={(e) => setAdjustDelta(e.target.value)} placeholder={tr("crm.exPoints")} />
                        </label>
                        <label className="block flex-1 text-sm">{tr("crm.noteRequiredLabel")}
                          <input className="input mt-1 w-full" value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} placeholder={tr("crm.adjustReasonPlaceholder")} />
                        </label>
                        <button type="button" className="btn-primary" disabled={adjustBusy || !adjustNote.trim() || !adjustDelta.trim() || Number(adjustDelta) === 0} onClick={() => void adjustLoyalty()}>
                          {adjustBusy ? tr("crm.doingEllipsis") : tr("crm.adjustBtn")}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
              {/* NF7 (FB3): membership tier (derived from sold
                  orders only) + store credit (ledger-derived
                  balance, history, staff grant with required
                  reason). */}
              <div className="card space-y-3">
                <h3 className="font-semibold">{tr("crm.membershipTitle")}</h3>
                {membershipError ? (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{membershipError}</p>
                ) : !custCredit ? (
                  <p className="text-sm text-slate-400">{tr("crm.loadingEllipsis")}</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <div>
                        <div className="text-2xl font-black">{moneyL(custCredit.balanceMinor)}</div>
                        <div className="text-xs text-slate-500">{tr("crm.storeCreditBalance")}</div>
                      </div>
                      {custTier?.tierName ? (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">🏅 {tr("crm.tierSuffix", { name: custTier.tierName })}</span>
                      ) : (
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{tr("crm.noTier")}</span>
                      )}
                      <span className="text-xs text-slate-500">{tr("crm.lifetimeSpendPrefix")} {moneyL(custTier?.lifetimeSpendMinor ?? "0")} {tr("crm.completedOnlyNote")}</span>
                    </div>
                    {custCredit.entries.length === 0 ? (
                      <p className="text-sm text-slate-400">{tr("crm.noCreditTx")}</p>
                    ) : (
                      <div className="space-y-1">
                        {custCredit.entries.map((en) => (
                          <div key={en.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-1.5 text-sm last:border-0">
                            <span>
                              <span className="font-medium">{creditReasonLabel(en.reason)}</span>
                              {en.note ? <span className="block text-xs text-slate-500">{en.note}</span> : null}
                              <span className="block text-xs text-slate-400">{en.createdAt ? fmtDate(locale, en.createdAt) : ""}</span>
                            </span>
                            <span className={`font-semibold ${en.deltaMinor.startsWith("-") ? "text-red-600" : "text-emerald-700"}`}>
                              {creditDeltaLabel(en.deltaMinor)} {tr("crm.paisaWord")} · {tr("crm.balanceWord")} {moneyL(en.balanceAfter)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="space-y-2 border-t pt-3">
                      <div className="text-sm font-semibold">{tr("crm.creditGiveTitle")}</div>
                      <p className="text-xs text-slate-500">{tr("crm.creditGiveNote")}</p>
                      {grantError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{grantError}</p> : null}
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="block text-sm">{tr("crm.amountTakaLabel")}
                          <input className="input mt-1 w-36" inputMode="decimal" value={grantTaka} onChange={(e) => setGrantTaka(e.target.value)} placeholder={tr("crm.ex250")} />
                        </label>
                        <label className="block flex-1 text-sm">{tr("crm.reasonRequiredLabel")}
                          <input className="input mt-1 w-full" value={grantNote} onChange={(e) => setGrantNote(e.target.value)} placeholder={tr("crm.creditReasonPlaceholder")} />
                        </label>
                        <button type="button" className="btn-primary" disabled={grantBusy || !grantNote.trim() || !grantTaka.trim()} onClick={() => void grantCredit()}>
                          {grantBusy ? tr("crm.doingEllipsis") : tr("crm.creditGiveBtn")}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="card">
                <h3 className="mb-2 font-semibold">{tr("crm.ordersTitle")}</h3>
                {detail.orders.length === 0 ? <p className="text-sm text-slate-400">{tr("crm.noOrders")}</p> : detail.orders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
                    <span>#{o.externalNumber ?? o.id.slice(0, 8)} <span className="badge-slate ml-1">{o.status}</span>{o.isCod ? <span className="badge-amber ml-1">COD</span> : null}</span>
                    <span className="font-medium">{moneyL(o.totalMinor)}</span>
                  </div>
                ))}
                {detail.shipments.map((s) => (
                  <div key={s.id} className="py-1 text-xs text-slate-500">🚚 {s.provider}: {s.status}{s.trackingCode ? ` · ${s.trackingCode}` : ""}</div>
                ))}
              </div>
              <div className="card">
                <h3 className="mb-2 font-semibold">{tr("crm.conversationsTitle")}</h3>
                {detail.conversations.length === 0 ? <p className="text-sm text-slate-400">{tr("crm.noConversations")}</p> : detail.conversations.map((c) => (
                  <a key={c.id} href="/dashboard/inbox" className="block border-b py-2 text-sm last:border-0 hover:bg-slate-50">
                    <span className="badge-indigo">{c.channel}</span> <span className="badge-slate ml-1">{c.status}</span>
                    <span className="ml-2 text-slate-600">{c.lastMessagePreview ?? ""}</span>
                    {c.unreadCount > 0 ? <span className="badge-red ml-1">{tr("crm.unreadSuffix", { count: fmtNumber(locale, c.unreadCount) })}</span> : null}
                  </a>
                ))}
              </div>
            </div>
          ) : (
            <div className="card"><EmptyState title={tr("crm.pickCustomer")} description={tr("crm.selectCustomerHint")} /></div>
          )}
        </div>
      </div>

      {/* AB5 (AX7): B2B customer groups + per-group price list.
          A group's price list holds explicit prices only; the
          bulk %-off helper materializes rows server-side. */}
      <div className="card space-y-3">
        <h2 className="font-semibold">{tr("crm.groupsTitle")}</h2>
        <p className="text-xs text-slate-500">{tr("crm.groupsIntro")} {tr("crm.groupsIntro2")}</p>
        {groupError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{groupError}</p> : null}
        {groups.length === 0 ? <p className="text-sm text-slate-400">{tr("crm.noGroups")}</p> : groups.map((g) => (
          <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0">
            <span>
              <span className="font-medium">{g.name}</span>
              <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">{tr("crm.membersLine", { count: fmtNumber(locale, g.memberCount) })}</span>
              <span className={`ml-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${g.hasPriceList ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                {g.hasPriceList ? tr("crm.priceListYes") : tr("crm.priceListNo")}
              </span>
            </span>
            <span className="flex gap-2">
              <button className="btn-secondary btn-sm" onClick={() => { setPlGroupId(g.id); setBulkResult(""); void loadPriceList(g.id); }}>{tr("crm.priceListBtn")}</button>
              <button className="btn-secondary btn-sm" onClick={() => { setEditingGroupId(g.id); setGroupName(g.name); setGroupError(""); }}>{tr("crm.renameBtn")}</button>
              <button className="btn-secondary btn-sm text-red-600" disabled={groupBusy !== ""} onClick={() => deleteGroup(g)}>{tr("crm.audDelete")}</button>
            </span>
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-2 border-t pt-3">
          <label className="block text-sm">{editingGroupId ? tr("crm.groupNewNameLabel") : tr("crm.newGroupNameLabel")}
            <input className="input mt-1 w-72" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder={tr("crm.exGroupName")} maxLength={200} />
          </label>
          <button className="btn-primary" disabled={groupBusy !== "" || !groupName.trim()} onClick={saveGroup}>
            {groupBusy === "save" ? tr("crm.savingEllipsis") : editingGroupId ? tr("crm.saveName") : tr("crm.createGroup")}
          </button>
          {editingGroupId ? (
            <button className="btn-secondary" onClick={() => { setEditingGroupId(""); setGroupName(""); }}>{tr("crm.cancelBtn")}</button>
          ) : null}
        </div>

        {plGroupId ? (
          <div className="space-y-3 rounded-xl bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{tr("crm.priceListTitlePrefix")} {groups.find((g) => g.id === plGroupId)?.name ?? ""}</h3>
              <button className="btn-secondary btn-sm" onClick={() => { setPlGroupId(""); setPlItems([]); }}>{tr("crm.closeBtn")}</button>
            </div>
            {plLoading ? <p className="text-sm text-slate-400">{tr("crm.loadingEllipsis")}</p> : plItems.length === 0 ? (
              <p className="text-sm text-slate-400">{tr("crm.priceListEmpty")}</p>
            ) : (
              <ResponsiveTable
                table={
                  <div>
                    <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-xs text-slate-500">
                      <th className="py-1.5 pr-2 font-semibold">{tr("crm.colProduct")}</th>
                      <th className="py-1.5 pr-2 font-semibold">{tr("crm.colVariant")}</th>
                      <th className="py-1.5 pr-2 font-semibold">{tr("crm.colGroupPrice")}</th>
                      <th className="py-1.5 font-semibold"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {plItems.map((it) => (
                      <tr key={it.id} className="border-b last:border-0">
                        <td className="py-1.5 pr-2 font-medium">{it.productName ?? it.productId}</td>
                        <td className="py-1.5 pr-2">{it.variantName ?? tr("crm.allVariants")}</td>
                        <td className="py-1.5 pr-2 font-semibold">{moneyL(it.priceMinor)}</td>
                        <td className="py-1.5 text-right">
                          <button className="btn-secondary btn-sm min-h-[44px] text-red-600" disabled={groupBusy !== ""} onClick={() => removePlItem(it)}>{tr("crm.removeBtn")}</button>
                        </td>
                      </tr>
                    ))}
                    </tbody>
                    </table>
                  </div>
                }
                cards={plItems.map((it) => (
                  <div key={it.id} className="rounded-lg border bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">{it.productName ?? it.productId}</span>
                      <span className="font-semibold">{moneyL(it.priceMinor)}</span>
                    </div>
                    <dl className="mt-2 space-y-1.5 text-sm">
                      <div className="flex gap-2">
                        <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">{tr("crm.colVariant")}</dt>
                        <dd>{it.variantName ?? tr("crm.allVariants")}</dd>
                      </div>
                    </dl>
                    <div className="mt-2 text-right">
                      <button className="btn-secondary btn-sm min-h-[44px] text-red-600" disabled={groupBusy !== ""} onClick={() => removePlItem(it)}>{tr("crm.removeBtn")}</button>
                    </div>
                  </div>
                ))}
              />
            )}
            <div className="flex flex-wrap items-end gap-2 border-t pt-3">
              <label className="block text-sm">{tr("crm.productLabel")}
                <select className="input mt-1 w-64" value={plProductId} onChange={(e) => void onPlProductChange(e.target.value)}>
                  <option value="">{tr("crm.pickProductOption")}</option>
                  {orgProducts.map((p) => <option key={p.id} value={p.id}>{p.name} ({moneyL(p.priceMinor)})</option>)}
                </select>
              </label>
              <label className="block text-sm">{tr("crm.variantOptionalLabel")}
                <select className="input mt-1 w-48" value={plVariantId} onChange={(e) => setPlVariantId(e.target.value)} disabled={!plProductId || plVariants.length === 0}>
                  <option value="">{tr("crm.allVariants")}</option>
                  {plVariants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </label>
              <label className="block text-sm">{tr("crm.groupPriceLabel")}
                <input className="input mt-1 w-36" inputMode="decimal" placeholder={tr("crm.ex450")} value={plPriceTaka} onChange={(e) => setPlPriceTaka(e.target.value)} />
              </label>
              <button className="btn-primary btn-sm" disabled={groupBusy !== "" || !plProductId || !plPriceTaka.trim()} onClick={addPlItem}>
                {groupBusy === "pl-add" ? tr("crm.addingEllipsis") : tr("crm.addItemBtn")}
              </button>
            </div>
            <div className="flex flex-wrap items-end gap-2 border-t pt-3">
              <label className="block text-sm">{tr("crm.bulkDiscountLabel")}
                <input className="input mt-1 w-32" type="number" min="1" max="99" placeholder={tr("crm.ex10")} value={bulkPercent} onChange={(e) => setBulkPercent(e.target.value)} />
              </label>
              <button className="btn-secondary btn-sm" disabled={groupBusy !== "" || !bulkPercent.trim()} onClick={applyBulkPercent}>
                {groupBusy === "bulk" ? tr("crm.applyingEllipsis") : tr("crm.applyDiscountBtn")}
              </button>
              <span className="text-xs text-slate-500">{tr("crm.bulkDiscountNote")}</span>
              {bulkResult ? <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">{bulkResult}</span> : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* NF7 (FB3): membership tier definitions + per-tier
          price list. Tiers are DERIVED from each customer's
          lifetime sold spend (completed/delivered only) — staff
          never assign a tier by hand. A tier's price list uses
          the same PriceList machinery as group lists; at
          checkout a group list wins over a tier list. */}
      <div className="card space-y-3">
        <h2 className="font-semibold">{tr("crm.tiersTitle")}</h2>
        <p className="text-xs text-slate-500">{tr("crm.tiersIntro")}</p>
        {tierError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{tierError}</p> : null}
        {tiers.length === 0 ? <p className="text-sm text-slate-400">{tr("crm.noTiers")}</p> : tiers.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0">
            <span>
              <span className="font-medium">{t.name}</span>
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">{tr("crm.minSpendPrefix")} {moneyL(t.minSpendMinor)}</span>
              <span className="ml-1 rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">{tr("crm.membersLine", { count: fmtNumber(locale, t.memberCount ?? 0) })}</span>
              <span className={`ml-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${t.hasPriceList ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                {t.hasPriceList ? tr("crm.priceListYes") : tr("crm.priceListNo")}
              </span>
            </span>
            <span className="flex gap-2">
              <button type="button" className="btn-secondary btn-sm" onClick={() => void loadTierPriceList(t.id)}>{tr("crm.priceListBtn")}</button>
              <button type="button" className="btn-ghost btn-sm text-red-600" disabled={tierBusy === t.id} onClick={() => void deleteTier(t)}>{tr("crm.audDelete")}</button>
            </span>
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-2 border-t pt-3">
          <label className="block text-sm">{tr("crm.tierNameLabel")}
            <input className="input mt-1 w-44" value={tierName} onChange={(e) => setTierName(e.target.value)} placeholder={tr("crm.exGold")} />
          </label>
          <label className="block text-sm">{tr("crm.minSpendTakaLabel")}
            <input className="input mt-1 w-40" inputMode="decimal" value={tierMinTaka} onChange={(e) => setTierMinTaka(e.target.value)} placeholder={tr("crm.exAmount5000")} />
          </label>
          <label className="block text-sm">{tr("crm.sortOrderLabel")}
            <input className="input mt-1 w-20" type="number" step="1" value={tierSort} onChange={(e) => setTierSort(e.target.value)} />
          </label>
          <button type="button" className="btn-primary" disabled={tierBusy === "create" || !tierName.trim() || !tierMinTaka.trim()} onClick={() => void createTier()}>
            {tierBusy === "create" ? tr("crm.creatingEllipsis") : tr("crm.createTierBtn")}
          </button>
        </div>
        {tierPlTierId ? (
          <div className="space-y-2 border-t pt-3">
            <div className="text-sm font-semibold">{tr("crm.tierPriceListTitle")} {tiers.find((t) => t.id === tierPlTierId)?.name ?? ""}</div>
            {tierPlItems.length === 0 ? <p className="text-sm text-slate-400">{tr("crm.tierListEmpty")}</p> : tierPlItems.map((it) => (
              <div key={it.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-1.5 text-sm last:border-0">
                <span>{it.productName ?? it.productId}{it.variantName ? ` · ${it.variantName}` : ""}</span>
                <span className="flex items-center gap-2">
                  <span className="font-medium">{moneyL(it.priceMinor)}</span>
                  <button type="button" className="btn-ghost btn-sm text-red-600" disabled={tierBusy === it.id} onClick={() => void removeTierPlItem(it)}>{tr("crm.removeBtn")}</button>
                </span>
              </div>
            ))}
            <div className="flex flex-wrap items-end gap-2">
              <label className="block text-sm">{tr("crm.productIdLabel")}
                <input className="input mt-1 w-64" value={tierPlProductId} onChange={(e) => setTierPlProductId(e.target.value)} placeholder="product id" />
              </label>
              <label className="block text-sm">{tr("crm.priceTakaLabel")}
                <input className="input mt-1 w-36" inputMode="decimal" value={tierPlPriceTaka} onChange={(e) => setTierPlPriceTaka(e.target.value)} placeholder={tr("crm.ex800")} />
              </label>
              <button type="button" className="btn-primary btn-sm" disabled={tierBusy === "pl-add" || !tierPlProductId.trim() || !tierPlPriceTaka.trim()} onClick={() => void addTierPlItem()}>
                {tierBusy === "pl-add" ? tr("crm.addingEllipsis") : tr("crm.addItemBtn")}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* GB6 (GC15): segments manager — definitions with live
          member counts; selecting one above filters the list. */}
      <div className="card space-y-3">
        <h2 className="font-semibold">{tr("crm.segmentsTitle")}</h2>
        <p className="text-xs text-slate-500">{tr("crm.segmentsIntro")}</p>
        {segError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{segError}</p> : null}
        {segments.length === 0 ? <p className="text-sm text-slate-400">{tr("crm.noSegments")}</p> : segments.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0">
            <span>
              <span className="font-medium">{s.name}</span>
              <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">{tr("crm.membersLine", { count: fmtNumber(locale, s.memberCount) })}</span>
              <span className="block text-xs text-slate-500">{segmentCriteriaSummary(s.criteria, locale)}</span>
            </span>
            <span className="flex gap-2">
              <button className="btn-secondary btn-sm" onClick={() => setSegmentId(s.id)}>{tr("crm.viewInList")}</button>
              <button className="btn-secondary btn-sm" onClick={() => editSegment(s)}>{tr("crm.editBtn")}</button>
              <button className="btn-secondary btn-sm text-red-600" disabled={segBusy !== ""} onClick={() => deleteSegment(s)}>{tr("crm.audDelete")}</button>
            </span>
          </div>
        ))}
        <div className="space-y-3 border-t pt-3">
          <h3 className="text-sm font-semibold">{editingSegmentId ? tr("crm.segEditTitle") : tr("crm.segNewTitle")}</h3>
          <label className="block text-sm">{tr("crm.segNameLabel")}
            <input className="input mt-1 w-full max-w-md" value={segName} onChange={(e) => setSegName(e.target.value)} placeholder={tr("crm.exSegName")} maxLength={130} />
          </label>
          <div>
            <div className="mb-1 text-sm font-medium">{tr("crm.segTagsAnyLabel")}</div>
            <div className="flex flex-wrap gap-1.5">
              {segDraft.tagsAny.map((t) => (
                <span key={t} className="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                  #{t}
                  <button type="button" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center font-bold text-slate-400 hover:text-red-600" aria-label={tr("crm.tagRemoveTitle", { tag: t })}
                    onClick={() => setSegDraft({ ...segDraft, tagsAny: segDraft.tagsAny.filter((x) => x !== t) })}>×</button>
                </span>
              ))}
              {segDraft.tagsAny.length === 0 ? <span className="text-xs text-slate-500">{tr("crm.noTagCondition")}</span> : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <input className="input w-56" placeholder={tr("crm.tagWritePlaceholder")} aria-label={tr("crm.segTagAria")} value={segTagInput} onChange={(e) => setSegTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSegTag(); } }} />
              <button type="button" className="btn-secondary btn-sm" onClick={addSegTag}>{tr("crm.addBtn")}</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={segDraft.vipOnly} onChange={(e) => setSegDraft({ ...segDraft, vipOnly: e.target.checked })} />
              {tr("crm.vipOnlyLabel")}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={segDraft.repeatOnly} onChange={(e) => setSegDraft({ ...segDraft, repeatOnly: e.target.checked })} />
              {tr("crm.repeatOnlyLabel")}
            </label>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="block text-sm">{tr("crm.minLifetimeLabel")}
              <input className="input mt-1 w-44" inputMode="decimal" placeholder={tr("crm.ex10000")} value={segDraft.minSpentTaka}
                onChange={(e) => setSegDraft({ ...segDraft, minSpentTaka: e.target.value })} />
            </label>
            <label className="block text-sm">{tr("crm.districtLabel")}
              <input className="input mt-1 w-44" placeholder={tr("crm.exKhulna")} value={segDraft.district}
                onChange={(e) => setSegDraft({ ...segDraft, district: e.target.value })} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={segBusy !== ""} onClick={saveSegment}>
              {segBusy === "save" ? tr("crm.savingEllipsis") : editingSegmentId ? tr("crm.segUpdateBtn") : tr("crm.segCreateBtn")}
            </button>
            {editingSegmentId ? (
              <button className="btn-secondary" onClick={() => { setEditingSegmentId(""); setSegName(""); setSegDraft(EMPTY_SEGMENT_DRAFT); setSegError(""); }}>{tr("crm.cancelBtn")}</button>
            ) : null}
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
