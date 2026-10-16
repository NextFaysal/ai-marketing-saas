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
const RISK_LABEL: Record<string, { text: string; cls: string }> = {
  high: { text: "ঝুঁকি: উচ্চ", cls: "bg-red-100 text-red-700" },
  medium: { text: "ঝুঁকি: মাঝারি", cls: "bg-amber-100 text-amber-700" },
  low: { text: "ঝুঁকি: কম", cls: "bg-emerald-100 text-emerald-700" },
  unknown: { text: "ঝুঁকি: তথ্য নেই", cls: "bg-slate-100 text-slate-500" },
};

const money = (minor?: string | null, currency = "BDT") =>
  minor == null ? "—" : `${currency === "BDT" ? "৳" : currency + " "}${(Number(minor) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function CustomersPage() {
  const confirm = useConfirm();
  const { toast } = useToast();
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string; platform?: string; syncMode?: string }[]>([]);
  const [q, setQ] = useState("");
  // ON7: due-only filter + the খাতা (ledger) section state.
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
  // AB5 (AX7): খাতা overdue-only filter (?overdue=1).
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
        toast({ title: "সেগমেন্ট হালনাগাদ হয়েছে।", tone: "success" });
      } else {
        await apiFetch(`/organizations/${orgId}/customers/segments`, {
          method: "POST", body: JSON.stringify(payload),
        });
        toast({ title: "সেগমেন্ট তৈরি হয়েছে।", tone: "success" });
      }
      setSegName(""); setSegDraft(EMPTY_SEGMENT_DRAFT); setSegTagInput(""); setEditingSegmentId("");
      await loadSegments();
    } catch (e) { setSegError(e instanceof Error ? e.message : "সেগমেন্ট সংরক্ষণ ব্যর্থ"); }
    finally { setSegBusy(""); }
  }

  function editSegment(s: CrmSegment) {
    setEditingSegmentId(s.id); setSegName(s.name);
    setSegDraft(segmentCriteriaToDraft(s.criteria)); setSegTagInput("");
    setSegError("");
  }

  async function deleteSegment(s: CrmSegment) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: `“${s.name}” সেগমেন্টটি মুছে ফেলবেন?`, body: `গ্রাহকদের কোনো তথ্য মুছবে না — শুধু এই সেগমেন্টের সংজ্ঞাটি যাবে।`, danger: true, confirmLabel: "মুছে ফেলুন" }))) return;
    setSegBusy(`del-${s.id}`); setSegError("");
    try {
      await apiFetch(`/organizations/${orgId}/customers/segments/${s.id}`, { method: "DELETE" });
      if (segmentId === s.id) setSegmentId("");
      if (editingSegmentId === s.id) { setEditingSegmentId(""); setSegName(""); setSegDraft(EMPTY_SEGMENT_DRAFT); }
      toast({ title: "সেগমেন্ট মুছে ফেলা হয়েছে।", tone: "success" });
      await loadSegments();
    } catch (e) { setSegError(e instanceof Error ? e.message : "সেগমেন্ট মোছা ব্যর্থ"); }
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
    if (crmBlockedReason.length > 300) { setCrmError("ব্লকের কারণ সর্বোচ্চ ৩০০ অক্ষরের হতে হবে।"); return; }
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
      toast({ title: "CRM তথ্য সেভ হয়েছে।", tone: "success" });
      await load();
      await loadSegments();
    } catch (e) { setCrmError(e instanceof Error ? e.message : "CRM সেভ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  function addCrmTag() {
    const err = validateNewTag(crmTags, crmTagInput);
    if (err) { setCrmTagError(err); return; }
    setCrmTags(normalizeTags([...crmTags, crmTagInput]));
    setCrmTagInput(""); setCrmTagError("");
  }

  /** ON7: load the customer's খাতা (ledger) — open orders with
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
      setKhataError(e instanceof Error ? e.message : "খাতা লোড ব্যর্থ");
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
    if (!groupName.trim()) { setGroupError("গ্রুপের নাম দিন।"); return; }
    setGroupBusy("save"); setGroupError("");
    try {
      if (editingGroupId) {
        await apiFetch(`/organizations/${orgId}/commerce/customer-groups/${editingGroupId}`, {
          method: "PATCH", body: JSON.stringify({ name: groupName.trim() }),
        });
        toast({ title: "গ্রুপের নাম বদলানো হয়েছে।", tone: "success" });
      } else {
        await apiFetch(`/organizations/${orgId}/commerce/customer-groups`, {
          method: "POST", body: JSON.stringify({ name: groupName.trim() }),
        });
        toast({ title: "গ্রুপ তৈরি হয়েছে।", tone: "success" });
      }
      setGroupName(""); setEditingGroupId("");
      await loadGroups();
    } catch (e) { setGroupError(e instanceof Error ? e.message : "গ্রুপ সংরক্ষণ ব্যর্থ"); }
    finally { setGroupBusy(""); }
  }

  async function deleteGroup(g: CustomerGroup) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: `“${g.name}” গ্রুপটি মুছে ফেলবেন?`, body: `এই গ্রুপের ${g.memberCount} জন সদস্য গ্রুপছাড়া হয়ে যাবেন (কাস্টমার মোছা হবে না) এবং গ্রুপের প্রাইস লিস্টও মুছে যাবে।`, danger: true, confirmLabel: "মুছে ফেলুন" }))) return;
    setGroupBusy(`del-${g.id}`); setGroupError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/customer-groups/${g.id}`, { method: "DELETE" });
      if (plGroupId === g.id) { setPlGroupId(""); setPlItems([]); }
      if (editingGroupId === g.id) { setEditingGroupId(""); setGroupName(""); }
      toast({ title: "গ্রুপ মুছে ফেলা হয়েছে — সদস্যরা গ্রুপছাড়া হয়েছেন।", tone: "success" });
      await loadGroups();
    } catch (e) { setGroupError(e instanceof Error ? e.message : "গ্রুপ মোছা ব্যর্থ"); }
    finally { setGroupBusy(""); }
  }

  const loadPriceList = useCallback(async (groupId: string) => {
    const orgId = getOrganizationId(); if (!orgId || !groupId) return;
    setPlLoading(true);
    try {
      const out = await apiFetch<{ items: PriceListItemRow[] }>(`/organizations/${orgId}/commerce/customer-groups/${groupId}/price-list`);
      setPlItems(out.items ?? []);
    } catch (e) { setGroupError(e instanceof Error ? e.message : "প্রাইস লিস্ট লোড ব্যর্থ"); }
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
    if (!plProductId) { setGroupError("আইটেম যোগ করতে পণ্য বেছে নিন।"); return; }
    const priceMinor = takaToMinor(plPriceTaka.trim());
    if (priceMinor === null) { setGroupError("দাম টাকায় ঠিকভাবে লিখুন (যেমন: 450 বা 450.50)।"); return; }
    setGroupBusy("pl-add"); setGroupError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/customer-groups/${plGroupId}/price-list/items`, {
        method: "POST",
        body: JSON.stringify({ productId: plProductId, variantId: plVariantId || null, priceMinor }),
      });
      setPlPriceTaka("");
      await loadPriceList(plGroupId);
      await loadGroups();
    } catch (e) { setGroupError(e instanceof Error ? e.message : "আইটেম যোগ ব্যর্থ"); }
    finally { setGroupBusy(""); }
  }

  async function removePlItem(item: PriceListItemRow) {
    const orgId = getOrganizationId(); if (!orgId || !plGroupId) return;
    setGroupBusy(`pl-del-${item.id}`); setGroupError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/customer-groups/${plGroupId}/price-list/items/${item.id}`, { method: "DELETE" });
      await loadPriceList(plGroupId);
      await loadGroups();
    } catch (e) { setGroupError(e instanceof Error ? e.message : "আইটেম সরানো ব্যর্থ"); }
    finally { setGroupBusy(""); }
  }

  async function applyBulkPercent() {
    const orgId = getOrganizationId(); if (!orgId || !plGroupId) return;
    const percentOff = Number(bulkPercent);
    if (!Number.isInteger(percentOff) || percentOff < 1 || percentOff > 99) {
      setGroupError("ছাড়ের হার ১–৯৯ শতাংশের পূর্ণ সংখ্যা হতে হবে।"); return;
    }
    setGroupBusy("bulk"); setGroupError(""); setBulkResult("");
    try {
      const out = await apiFetch<{ written: number }>(`/organizations/${orgId}/commerce/customer-groups/${plGroupId}/price-list/bulk-percent`, {
        method: "POST", body: JSON.stringify({ percentOff }),
      });
      setBulkResult(`${out.written}টি পণ্যে ${percentOff}% ছাড়ের দাম লেখা হয়েছে।`);
      await loadPriceList(plGroupId);
      await loadGroups();
    } catch (e) { setGroupError(e instanceof Error ? e.message : "বাল্ক ছাড় ব্যর্থ"); }
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
      setLoyaltyError(e instanceof Error ? e.message : "লয়্যালটি লোড ব্যর্থ");
    }
  }, []);

  /** AB1: staff point adjustment — delta is a non-zero integer
   * and the note is REQUIRED (the API enforces both; the button
   * stays disabled until both are present). On success the
   * section is refetched and the server's new balance shown. */
  async function adjustLoyalty() {
    const orgId = getOrganizationId(); if (!orgId || !detail) return;
    const delta = Number(adjustDelta);
    if (!Number.isInteger(delta) || delta === 0) { setAdjustError("পয়েন্টের পরিমাণ শূন্য নয় এমন পূর্ণ সংখ্যা দিন (যোগ করতে ধনাত্মক, কাটতে ঋণাত্মক)।"); return; }
    if (!adjustNote.trim()) { setAdjustError("সমন্বয়ের নোট দেওয়া বাধ্যতামূলক।"); return; }
    setAdjustBusy(true); setAdjustError("");
    try {
      const out = await apiFetch<{ balance: number }>(`/organizations/${orgId}/commerce/loyalty/customers/${detail.customer.id}/adjust`, {
        method: "POST",
        body: JSON.stringify({ deltaPoints: delta, note: adjustNote.trim() }),
      });
      toast({ title: `সমন্বয় সম্পন্ন — নতুন ব্যালেন্স ${out.balance} পয়েন্ট।`, tone: "success" });
      setAdjustDelta(""); setAdjustNote("");
      await loadLoyalty(detail.customer.id);
    } catch (e) { setAdjustError(e instanceof Error ? e.message : "সমন্বয় ব্যর্থ"); }
    finally { setAdjustBusy(false); }
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
      if (m === null) { setCreditError("ক্রেডিট সীমা টাকায় ঠিকভাবে লিখুন (যেমন: 5000 বা 5000.50)।"); return; }
      creditLimitMinor = m;
    }
    setCreditBusy(true); setCreditError("");
    try {
      await apiFetch(`/organizations/${orgId}/customers/${detail.customer.id}`, {
        method: "PATCH", body: JSON.stringify({ creditLimitMinor }),
      });
      toast({ title: creditLimitMinor === null ? "ক্রেডিট সীমা তুলে নেওয়া হয়েছে।" : "ক্রেডিট সীমা সংরক্ষণ হয়েছে।", tone: "success" });
      await loadKhata(detail.customer.id);
      await load();
    } catch (e) { setCreditError(e instanceof Error ? e.message : "ক্রেডিট সীমা সংরক্ষণ ব্যর্থ"); }
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
      toast({ title: "Push Outbox-এ জমা হয়েছে — Sync Center-এ ফলাফল দেখা যাবে।", tone: "success" });
    } catch (e) { setError(e instanceof Error ? e.message : "Push ব্যর্থ"); }
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
    } catch (e) { setError(e instanceof Error ? e.message : "এক্সপোর্ট ব্যর্থ"); }
  }

  async function open(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setKhata(null); setKhataError(""); setCreditError("");
    void loadKhata(id);
    setLoyalty(null); setLoyaltyError(""); setAdjustDelta(""); setAdjustNote(""); setAdjustError("");
    void loadLoyalty(id);
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
      toast({ title: "কাস্টমারের তথ্য সেভ হয়েছে।", tone: "success" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "সেভ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  // CP6: GDPR deep erasure — irreversible PII removal. Order
  // financial records stay; the confirm dialog says so plainly.
  async function doErase() {
    const orgId = getOrganizationId(); if (!orgId || !detail) return;
    if (!(await confirm({ title: "ব্যক্তিগত তথ্য স্থায়ীভাবে মুছে ফেলবেন?", body: "এই কাস্টমারের ব্যক্তিগত তথ্য (নাম, ফোন, ইমেইল, ঠিকানা) স্থায়ীভাবে মুছে ফেলা হবে — এটি ফেরত আনা যাবে না। অর্ডারের আর্থিক রেকর্ড (টাকার হিসাব) থেকে যাবে, কিন্তু অর্ডারের ঠিকানা মুছে যাবে।", danger: true, confirmLabel: "স্থায়ীভাবে মুছে ফেলুন" }))) return;
    setBusy("erase"); setError(""); setEraseReport(null);
    try {
      const report = await apiFetch<{ customerId: string; ordersAnonymized: number; identitiesDeleted: number; reviewsRedacted: number; abandonedCheckoutsDeleted: number }>(
        `/organizations/${orgId}/customers/${detail.customer.id}/erase`, { method: "POST" },
      );
      setEraseReport(report);
      toast({ title: "কাস্টমারের ব্যক্তিগত তথ্য মুছে ফেলা হয়েছে।", tone: "success" });
      await load();
      await open(report.customerId);
    } catch (e) { setError(e instanceof Error ? e.message : "মুছে ফেলা ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function doMerge() {
    const orgId = getOrganizationId(); if (!orgId || !detail || !mergeTarget) return;
    if (!(await confirm({ title: "কাস্টমার রেকর্ড মার্জ করবেন?", body: "এই কাস্টমার রেকর্ডটি নির্বাচিত রেকর্ডে মার্জ হবে। অর্ডার ও কথোপকথন সরে যাবে; মূল রেকর্ডটি লুকানো থাকবে (মুছে যাবে না)।", confirmLabel: "মার্জ করুন" }))) return;
    setBusy("merge");
    try {
      const merged = await apiFetch<Detail>(`/organizations/${orgId}/customers/merge`, {
        method: "POST", body: JSON.stringify({ sourceId: detail.customer.id, targetId: mergeTarget }),
      });
      setDetail(merged);
      toast({ title: "মার্জ সম্পন্ন হয়েছে।", tone: "success" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Merge ব্যর্থ"); }
    finally { setBusy(""); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="page-title">Customers 360 & LTV Retention</h1>
          <p className="text-slate-500">প্রতিটি গ্রাহকের সম্পূর্ণ ছবি: অর্ডার, কথোপকথন, পার্সেল, RFM সেগমেন্টেশন ও গ্রাহক ধরে রাখার বিজ্ঞানসম্মত টুলস।</p>
        </div>
      </div>
      {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-xl bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p> : null}

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
          <span>👥 কাস্টমার ডিরেক্টরি (360 ভিউ)</span>
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
          <span>💎 RFM সেগমেন্টেশন ও LTV Retention Studio</span>
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
            <input className="input w-72" placeholder="নাম, ফোন বা ইমেইল দিয়ে খুঁজুন" aria-label="নাম, ফোন বা ইমেইল দিয়ে খুঁজুন" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={hasDue} onChange={(e) => setHasDue(e.target.checked)} />
              শুধু বকেয়া আছে
            </label>
            <button className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold" onClick={downloadExport}>📤 CSV এক্সপোর্ট</button>
          </div>
          {/* GB6 (GC15): CRM filters — type / exact tag / segment, all
              wired to the real list query params. */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm">গ্রাহকের ধরন
              <select className="input w-40" value={customerType} onChange={(e) => setCustomerType(e.target.value)}>
                {CUSTOMER_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <input className="input w-52" placeholder="ট্যাগ দিয়ে ফিল্টার (হুবহু মিল)" aria-label="ট্যাগ দিয়ে ফিল্টার (হুবহু মিল)" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} />
            <label className="flex items-center gap-2 text-sm">সেগমেন্ট
              <select className="input w-56" value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
                <option value="">সব সেগমেন্ট</option>
                {segments.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.memberCount} জন)</option>)}
              </select>
            </label>
            {(customerType !== "all" || tagFilter || segmentId) ? (
              <button className="rounded-lg border bg-white px-3 py-2 text-sm" onClick={() => { setCustomerType("all"); setTagFilter(""); setSegmentId(""); }}>ফিল্টার পরিষ্কার করুন</button>
            ) : null}
          </div>
          <div className="grid gap-4 lg:grid-cols-5">
        <div className="card overflow-hidden p-0 lg:col-span-2">
          {loading ? <p className="p-4 text-sm text-slate-400">লোড হচ্ছে...</p> : rows.length === 0 ? (
            <div className="p-4"><EmptyState title="কোনো কাস্টমার নেই" description="অর্ডার Sync বা চ্যাট থেকে কাস্টমার তৈরি হলে এখানে দেখা যাবে।" /></div>
          ) : rows.map((c) => (
            <button key={c.id} onClick={() => open(c.id)} className={`block w-full border-b px-4 py-3 text-left transition hover:bg-slate-50 ${detail?.customer.id === c.id ? "bg-indigo-50/60" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{c.name || "নাম নেই"}</span>
                <span className="text-sm font-semibold">{money(c.totalSpentMinor)}</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-500">{c.phone ?? c.email ?? "—"} · {c.orderCount}টি অর্ডার · {c.source}</div>
              {/* GB6 (GC15): sold-bucket figures — sold orders,
                  lifetime value and AOV ("—" when no sold order). */}
              <div className="mt-0.5 text-xs text-slate-500">
                বিক্রি সম্পন্ন: {c.soldOrderCount ?? 0}টি · লাইফটাইম মূল্য: {money(c.lifetimeValueMinor ?? "0")} · গড় অর্ডার মূল্য (AOV): {c.aovMinor != null ? money(c.aovMinor) : "—"}
              </div>
              {(c.isRepeat || c.isVip || c.isBlocked || (c.tags ?? []).length > 0) ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.isRepeat ? <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">পুনরাবৃত্ত</span> : null}
                  {c.isVip ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">⭐ VIP</span> : null}
                  {c.isBlocked ? <span className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">ব্লক করা</span> : null}
                  {(c.tags ?? []).map((t) => <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">#{t}</span>)}
                </div>
              ) : null}
              {/* ON7: বকেয়া (open due) on the list row — "—" when nothing is due. */}
              <div className="mt-0.5 text-xs">
                <span className="text-slate-500">বকেয়া: </span>
                {(() => { let due = 0n; try { due = BigInt(c.dueMinor ?? "0"); } catch { due = 0n; } return due > 0n
                  ? <span className="font-bold text-red-600">{money(c.dueMinor)}</span>
                  : <span className="text-slate-500">—</span>; })()}
                {c.creditLimitMinor ? <span className="ml-2 text-slate-500">· ক্রেডিট সীমা: {money(c.creditLimitMinor)}</span> : null}
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
                    <h2 className="text-lg font-bold">{detail.customer.name || "নাম নেই"}</h2>
                    <p className="text-sm text-slate-500">{detail.customer.phone ?? "—"} · {detail.customer.email ?? "—"}</p>
                    <p className="text-xs text-slate-500">সূত্র: {detail.customer.source} · যোগ দিয়েছেন {new Date(detail.customer.createdAt).toLocaleDateString()}{detail.lead ? ` · Lead: ${detail.lead.stage}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-black">{money(detail.lifetime.totalSpentMinor, detail.lifetime.currency)}</div>
                    <div className="text-xs text-slate-500">মোট কেনাকাটা (বাতিল ছাড়া) · {detail.lifetime.orderCount}টি অর্ডার</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
                  <label className="block text-sm">এই রেকর্ডটি মার্জ করুন যার মধ্যে:
                    <select className="input ml-2 w-56" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
                      <option value="">কাস্টমার বেছে নিন</option>
                      {rows.filter((r) => r.id !== detail.customer.id).map((r) => <option key={r.id} value={r.id}>{r.name || r.phone || r.id.slice(0, 8)} ({r.orderCount} অর্ডার)</option>)}
                    </select>
                  </label>
                  <button className="btn-warning" disabled={!mergeTarget || busy !== ""} onClick={doMerge}>{busy === "merge" ? "মার্জ হচ্ছে..." : "মার্জ করুন"}</button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-red-100 pt-3">
                  <button className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={doErase}>
                    {busy === "erase" ? "মোছা হচ্ছে..." : "🗑️ ব্যক্তিগত তথ্য মুছে ফেলুন (GDPR)"}
                  </button>
                  <span className="text-xs text-slate-500">শুধু Owner/Admin পারবেন। অর্ডারের আর্থিক রেকর্ড থেকে যাবে, ব্যক্তিগত তথ্য থাকবে না।</span>
                </div>
                {eraseReport ? (
                  <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    মোছার হিসাব: অর্ডার ঠিকানা মোছা হয়েছে {eraseReport.ordersAnonymized}টি · স্টোর পরিচিতি মোছা {eraseReport.identitiesDeleted}টি · রিভিউ পরিচয় গোপন {eraseReport.reviewsRedacted}টি · Abandoned checkout মোছা {eraseReport.abandonedCheckoutsDeleted}টি
                  </p>
                ) : null}
              </div>
              <div className="card space-y-3">
                <h3 className="font-semibold">✏️ তথ্য সম্পাদনা</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block text-sm">নামের প্রথম অংশ
                    <input className="input mt-1" value={editForm.firstName} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })} />
                  </label>
                  <label className="block text-sm">নামের শেষ অংশ
                    <input className="input mt-1" value={editForm.lastName} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })} />
                  </label>
                  <label className="block text-sm">ফোন
                    <input className="input mt-1" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                  </label>
                  <label className="block text-sm">ইমেইল
                    <input className="input mt-1" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                  </label>
                  <CustomFieldsEditor defs={custDefs} raw={editCf} onChange={(k, v) => setEditCf({ ...editCf, [k]: v })} />
                  <label className="flex items-center gap-2 text-sm md:col-span-2">
                    <input type="checkbox" checked={editWholesale} onChange={(e) => setEditWholesale(e.target.checked)} />
                    পাইকারি ক্রেতা (দোকানে চেকআউটে পাইকারি স্তরের দাম প্রযোজ্য হবে)
                  </label>
                  {/* AB5 (AX7): B2B group + net credit terms. */}
                  <label className="block text-sm">কাস্টমার গ্রুপ (B2B)
                    <select className="input mt-1" value={editGroupId} onChange={(e) => setEditGroupId(e.target.value)}>
                      <option value="">কোনো গ্রুপ নয়</option>
                      {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                    <span className="mt-1 block text-xs font-normal text-slate-500">গ্রুপের প্রাইস লিস্ট থাকলে চেকআউটে ওই দামই প্রযোজ্য হবে।</span>
                  </label>
                  <label className="block text-sm">ক্রেডিট শর্ত (বকেয়ার মেয়াদ)
                    <select className="input mt-1" value={editCreditTerms} onChange={(e) => setEditCreditTerms(e.target.value)}>
                      <option value="0">০ দিন (শর্ত নেই)</option>
                      <option value="7">৭ দিন</option>
                      <option value="14">১৪ দিন</option>
                      <option value="30">৩০ দিন</option>
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button className="btn-primary" disabled={busy !== ""} onClick={saveEdit}>{busy === "edit" ? "সেভ হচ্ছে..." : "সেভ করুন"}</button>
                  <span className="text-xs text-slate-500">কাস্টম ফিল্ডের সংজ্ঞা <a className="underline" href="/dashboard/leads">Leads & CRM পেজের</a> “কাস্টম ফিল্ড” অংশ থেকে ম্যানেজ করা হয়।</span>
                </div>
              </div>
              {/* GB6 (GC15): CRM — tags / VIP / staff notes / block. */}
              <div className="card space-y-3">
                <h3 className="font-semibold">🏷️ CRM — ট্যাগ, VIP, নোট ও ব্লক</h3>
                {detail.customer.isBlocked ? (
                  <div className="rounded-xl bg-red-600 px-3 py-2 text-sm font-semibold text-white">
                    🚫 এই গ্রাহক ব্লক করা{detail.customer.blockedReason ? ` — কারণ: ${detail.customer.blockedReason}` : ""}। ব্লক থাকলে দোকানে চেকআউট আটকে যাবে।
                  </div>
                ) : null}
                {crmError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{crmError}</p> : null}
                <div>
                  <div className="mb-1 text-sm font-medium">ট্যাগ (সর্বোচ্চ ১০টি, প্রতিটি ১–৩০ অক্ষর)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {crmTags.map((t) => (
                      <span key={t} className="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                        #{t}
                        <button type="button" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center font-bold text-slate-400 hover:text-red-600" aria-label={`${t} ট্যাগ সরান`}
                          onClick={() => setCrmTags(crmTags.filter((x) => x !== t))}>×</button>
                      </span>
                    ))}
                    {crmTags.length === 0 ? <span className="text-xs text-slate-500">কোনো ট্যাগ নেই</span> : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input className="input w-56" placeholder="নতুন ট্যাগ লিখুন" aria-label="নতুন ট্যাগ লিখুন" value={crmTagInput}
                      onChange={(e) => setCrmTagInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCrmTag(); } }} />
                    <button type="button" className="btn-secondary btn-sm" onClick={addCrmTag}>ট্যাগ যোগ করুন</button>
                  </div>
                  {crmTagError ? <p className="mt-1 text-xs text-red-600">{crmTagError}</p> : null}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={crmVip} onChange={(e) => setCrmVip(e.target.checked)} />
                  ⭐ VIP গ্রাহক
                </label>
                <label className="block text-sm font-medium">অভ্যন্তরীণ নোট
                  <span className="mb-1 block text-xs font-normal text-amber-700">শুধুমাত্র কর্মীদের জন্য — গ্রাহক এটি দেখতে পান না</span>
                  <textarea className="input mt-1 w-full" rows={3} value={crmNotes} onChange={(e) => setCrmNotes(e.target.value)}
                    placeholder="যেমন: সবসময় COD পছন্দ করেন, সন্ধ্যায় ফোন ধরেন…" />
                </label>
                <div className="space-y-2 rounded-xl bg-red-50/60 p-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-red-700">
                    <input type="checkbox" checked={crmBlocked} onChange={(e) => setCrmBlocked(e.target.checked)} />
                    🚫 এই গ্রাহককে ব্লক করুন (চেকআউট আটকে যাবে)
                  </label>
                  {crmBlocked ? (
                    <label className="block text-sm">ব্লকের কারণ (সর্বোচ্চ ৩০০ অক্ষর)
                      <input className="input mt-1 w-full" value={crmBlockedReason} onChange={(e) => setCrmBlockedReason(e.target.value)}
                        placeholder="যেমন: বারবার ভুয়া অর্ডার" maxLength={320} />
                      <span className="mt-1 block text-xs font-normal text-slate-500">কারণটিও শুধুমাত্র কর্মীরা দেখতে পান — গ্রাহককে সাধারণ বার্তা দেখানো হয়। ব্লক তুললে কারণ মুছে যাবে।</span>
                    </label>
                  ) : null}
                </div>
                <button className="btn-primary" disabled={busy !== ""} onClick={saveCrm}>{busy === "crm" ? "সেভ হচ্ছে..." : "CRM সেভ করুন"}</button>
              </div>
              <div className="card space-y-3">
                <h3 className="font-semibold">🏪 স্টোর পরিচিতি (Store Identities)</h3>
                <p className="text-xs text-slate-500">একই মানুষ একাধিক স্টোরে আলাদা customer id-তে থাকতে পারেন — পরিচিতিগুলো এখানে একসাথে দেখা যায়। Push কখনো স্বয়ংক্রিয় নয়; বোতাম চাপলেই Outbox-এ যায় (mirror মোডের স্টোরে push হয় না)।</p>
                {(detail.storeIdentities ?? []).length === 0 ? (
                  <p className="text-sm text-slate-400">কোনো স্টোর পরিচিতি নেই — স্টোর থেকে Customer Sync হলে বা নিচে Push করলে তৈরি হবে।</p>
                ) : (detail.storeIdentities ?? []).map((si) => (
                  <div key={si.storeId} className="flex flex-wrap items-center justify-between gap-2 border-b py-1.5 text-sm last:border-0">
                    <span><span className="font-medium">{si.storeName ?? "স্টোর"}</span> <span className="badge-slate ml-1">{si.platform ?? ""}</span>
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
                        title={mode === "mirror" ? "Mirror মোডে push হয় না — Sync Center থেকে মোড বদলান" : undefined}
                        onClick={() => pushToStore(s.id)}>
                        {busy === `push-${s.id}` ? "যাচ্ছে…" : has ? `🔄 ${s.name}-এ আপডেট Push` : `➕ ${s.name}-এ Push`}
                        {mode === "mirror" ? " (mirror — হবে না)" : ""}
                      </button>
                    );
                  })}
                  {stores.length === 0 ? <span className="text-xs text-slate-500">কোনো স্টোর সংযুক্ত নেই</span> : null}
                </div>
              </div>
              {detail.risk ? (
                <div className="card space-y-1">
                  <h3 className="font-semibold">↩️ রিটার্ন ঝুঁকি <span className={`ml-2 rounded px-2 py-0.5 text-xs font-semibold ${RISK_LABEL[detail.risk.band]?.cls ?? ""}`}>{RISK_LABEL[detail.risk.band]?.text ?? detail.risk.band}{detail.risk.score != null ? ` · স্কোর ${detail.risk.score}/১০০` : ""}</span></h3>
                  <p className="text-sm text-slate-600">মোট {detail.risk.history.total}টি অর্ডার · ডেলিভারি {detail.risk.history.delivered}টি · রিটার্ন {detail.risk.history.returned}টি · বাতিল/ব্যর্থ {detail.risk.history.cancelledOrFailed}টি · রিফান্ড {detail.risk.history.refunded}টি</p>
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
                    <p className="text-sm text-slate-500">এখনো কোনো ডেলিভারি ইতিহাস নেই</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-3xl font-bold text-emerald-700">{detail.courierRecord.successRatePct}%</span>
                        <span className="text-sm font-medium text-slate-600">ডেলিভারি সফলতার হার</span>
                        <span className="text-xs text-slate-500">(সিদ্ধান্ত হয়েছে এমন {detail.courierRecord.decided}টি অর্ডারের মধ্যে ডেলিভারি {detail.courierRecord.delivered}টি — এই হারটি রিটার্ন ঝুঁকির স্কোরের উল্টো নয়, দুটি আলাদা হিসাব)</span>
                      </div>
                      <p className="text-sm text-slate-600">রিটার্ন {detail.courierRecord.returned}টি · বাতিল/ব্যর্থ {detail.courierRecord.cancelledOrFailed}টি · রিফান্ড {detail.courierRecord.refunded}টি · মোট শিপমেন্ট {detail.courierRecord.totalShipments}টি{detail.courierRecord.lastDeliveryAt ? ` · সর্বশেষ ডেলিভারি: ${new Date(detail.courierRecord.lastDeliveryAt).toLocaleDateString("bn-BD")}` : ""}</p>
                      {detail.courierRecord.perCourier.length > 0 ? (
                        <ResponsiveTable
                          table={
                            <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-xs text-slate-500"><th className="py-1 font-medium">কুরিয়ার</th><th className="py-1 font-medium">সিদ্ধান্ত হয়েছে</th><th className="py-1 font-medium">ডেলিভারি</th><th className="py-1 font-medium">সফলতার হার</th></tr>
                          </thead>
                          <tbody>
                            {detail.courierRecord.perCourier.map((p) => (
                              <tr key={p.provider} className="border-b last:border-0">
                                <td className="py-1 font-medium">{p.provider}</td>
                                <td className="py-1">{p.decided}টি</td>
                                <td className="py-1">{p.delivered}টি</td>
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
                                  <dt className="w-28 shrink-0 text-xs font-semibold text-slate-500">সিদ্ধান্ত হয়েছে</dt>
                                  <dd>{p.decided}টি</dd>
                                </div>
                                <div className="flex gap-2">
                                  <dt className="w-28 shrink-0 text-xs font-semibold text-slate-500">ডেলিভারি</dt>
                                  <dd>{p.delivered}টি</dd>
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
                  <h3 className="font-semibold">⭐ গ্রাহকের রিভিউ</h3>
                  {custReviews.filter((r) => r.rating != null).map((r) => (
                    <div key={r.id} className="border-b py-1.5 text-sm last:border-0">
                      <span className="text-amber-500">{"★★★★★".slice(0, r.rating ?? 0)}{"☆☆☆☆☆".slice(0, 5 - (r.rating ?? 0))}</span>
                      <span className="ml-2 font-medium">#{r.orderNumber ?? r.orderId.slice(0, 8)}</span>
                      {r.comment ? <span className="ml-2 text-slate-700">“{r.comment}”</span> : null}
                      {r.receivedAt ? <span className="ml-2 text-xs text-slate-500">{new Date(r.receivedAt).toLocaleDateString("bn-BD")}</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {/* ON7: খাতা — the customer's ledger: total due,
                  aging buckets, credit limit and the open
                  orders behind the numbers. */}
              <div className="card space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">📒 খাতা (বকেয়ার হিসাব)</h3>
                  {/* AB5 (AX7): net terms in the header + overdue-only filter. */}
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    {khata ? (
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        ক্রেডিট শর্ত: {(khata.creditTermsDays ?? 0) > 0 ? `${khata.creditTermsDays} দিন` : "নেই (০ দিন)"}
                      </span>
                    ) : null}
                    <label className="flex items-center gap-2 text-xs font-medium">
                      <input type="checkbox" checked={khataOverdueOnly} onChange={(e) => {
                        setKhataOverdueOnly(e.target.checked);
                        if (detail) void loadKhata(detail.customer.id, e.target.checked);
                      }} />
                      শুধু মেয়াদোত্তীর্ণ
                    </label>
                  </div>
                </div>
                {khataError ? (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{khataError}</p>
                ) : !khata ? (
                  <p className="text-sm text-slate-400">লোড হচ্ছে…</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <div>
                        <div className="text-2xl font-black text-red-600">{money(khata.totalDueMinor)}</div>
                        <div className="text-xs text-slate-500">মোট বকেয়া</div>
                      </div>
                      {isOverLimit(khata) ? (
                        <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold text-white">⚠️ ক্রেডিট সীমা ছাড়িয়ে গেছে</span>
                      ) : null}
                      {khata.availableCreditMinor != null ? (
                        <div className="text-sm">
                          <span className="text-slate-500">ব্যবহারযোগ্য ক্রেডিট: </span>
                          <b className={isOverLimit(khata) ? "text-red-600" : "text-emerald-700"}>{money(khata.availableCreditMinor)}</b>
                        </div>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {agingRows(khata).map((r) => (
                        <div key={r.key} className="rounded-lg bg-slate-50 px-3 py-2 text-center">
                          <div className="text-sm font-bold">{money(r.amountMinor)}</div>
                          <div className="text-[11px] text-slate-500">{r.label}</div>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2 border-t pt-3">
                      <label className="block text-sm font-medium">ক্রেডিট সীমা (৳) — খালি রাখলে সীমা থাকবে না
                        <span className="mt-1 flex flex-wrap items-center gap-2">
                          <input className="input w-44" inputMode="decimal" placeholder="যেমন: 5000" value={creditTaka} onChange={(e) => setCreditTaka(e.target.value)} />
                          <button type="button" className="btn-primary btn-sm" disabled={creditBusy} onClick={() => void saveCreditLimit()}>
                            {creditBusy ? "সংরক্ষণ হচ্ছে…" : "সীমা সংরক্ষণ করুন"}
                          </button>
                          <span className="text-xs text-slate-500">বর্তমান: {khata.creditLimitMinor ? money(khata.creditLimitMinor) : "সীমা নির্ধারণ করা নেই"}</span>
                        </span>
                      </label>
                      {creditError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{creditError}</p> : null}
                    </div>
                    {khata.orders.length === 0 ? (
                      <p className="text-sm text-slate-400">{khataOverdueOnly ? "মেয়াদোত্তীর্ণ কোনো বকেয়া অর্ডার নেই।" : "এই কাস্টমারের কোনো অর্ডার খাতায় নেই।"}</p>
                    ) : (
                      <ResponsiveTable
                        table={
                          <div>
                            <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b text-xs text-slate-500">
                              <th className="py-1.5 pr-2 font-semibold">অর্ডার</th>
                              <th className="py-1.5 pr-2 font-semibold">তারিখ</th>
                              <th className="py-1.5 pr-2 font-semibold">মোট</th>
                              <th className="py-1.5 pr-2 font-semibold">পরিশোধিত</th>
                              <th className="py-1.5 pr-2 font-semibold">বকেয়া</th>
                              <th className="py-1.5 pr-2 font-semibold">পরিশোধের শেষ তারিখ</th>
                              <th className="py-1.5 font-semibold">স্ট্যাটাস</th>
                            </tr>
                          </thead>
                          <tbody>
                            {khata.orders.map((o) => (
                              <tr key={o.id} className="border-b last:border-0">
                                <td className="py-1.5 pr-2 font-medium">#{o.number ?? o.id.slice(0, 8)}</td>
                                <td className="py-1.5 pr-2">{o.placedAt ? new Date(o.placedAt).toLocaleDateString("bn-BD") : "—"}</td>
                                <td className="py-1.5 pr-2">{money(o.totalMinor)}</td>
                                <td className="py-1.5 pr-2">{money(o.paidMinor)}</td>
                                <td className="py-1.5 pr-2">{(() => { let d = 0n; try { d = BigInt(o.dueMinor); } catch { d = 0n; } return d > 0n
                                  ? <span className="font-bold text-red-600">{money(o.dueMinor)}</span>
                                  : <span className="text-slate-400">—</span>; })()}</td>
                                <td className="py-1.5 pr-2">{o.creditDueDate ? new Date(o.creditDueDate).toLocaleDateString("bn-BD") : "—"}</td>
                                <td className="py-1.5">
                                  <span className="badge-slate">{o.status}</span>
                                  {o.overdue ? <span className="ml-1 rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white">মেয়াদ উত্তীর্ণ</span> : null}
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
                                {o.overdue ? <span className="ml-1 rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white">মেয়াদ উত্তীর্ণ</span> : null}
                              </span>
                            </div>
                            <dl className="mt-2 space-y-1.5 text-sm">
                              <div className="flex gap-2">
                                <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">তারিখ</dt>
                                <dd>{o.placedAt ? new Date(o.placedAt).toLocaleDateString("bn-BD") : "—"}</dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">মোট</dt>
                                <dd>{money(o.totalMinor)}</dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">পরিশোধিত</dt>
                                <dd>{money(o.paidMinor)}</dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">বকেয়া</dt>
                                <dd>{(() => { let d = 0n; try { d = BigInt(o.dueMinor); } catch { d = 0n; } return d > 0n
                                  ? <span className="font-bold text-red-600">{money(o.dueMinor)}</span>
                                  : <span className="text-slate-500">—</span>; })()}</dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">পরিশোধের শেষ তারিখ</dt>
                                <dd>{o.creditDueDate ? new Date(o.creditDueDate).toLocaleDateString("bn-BD") : "—"}</dd>
                              </div>
                            </dl>
                          </div>
                        ))}
                      />
                    )}
                    {khata.ordersTruncated ? (
                      <p className="text-xs text-amber-700">আরও অর্ডার আছে — খাতায় শুধু সাম্প্রতিকগুলো দেখানো হচ্ছে; মোট বকেয়া সব অর্ডার মিলিয়েই হিসাব করা।</p>
                    ) : null}
                  </>
                )}
              </div>
              {/* AB1: loyalty — balance + value, ledger history,
                  referral reward coupons and the staff adjust
                  form (note required). */}
              <div className="card space-y-3">
                <h3 className="font-semibold">⭐ লয়্যালটি পয়েন্ট</h3>
                {loyaltyError ? (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{loyaltyError}</p>
                ) : !loyalty ? (
                  <p className="text-sm text-slate-400">লোড হচ্ছে…</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <div>
                        <div className={`text-2xl font-black ${loyalty.balance < 0 ? "text-red-600" : ""}`}>{loyalty.balance} পয়েন্ট</div>
                        <div className="text-xs text-slate-500">বর্তমান ব্যালেন্স · মূল্য {formatPaisaNumber(loyalty.balanceValueMinor)} (১ পয়েন্ট = {formatPaisaNumber(loyalty.redeemValueMinorPerPoint)})</div>
                      </div>
                      {!loyalty.enabled ? (
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">লয়্যালটি প্রোগ্রাম বর্তমানে বন্ধ</span>
                      ) : null}
                      {loyalty.balance < 0 ? (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">ঋণাত্মক ব্যালেন্স — অর্জন করে শোধ না করা পর্যন্ত পয়েন্ট খরচ বন্ধ</span>
                      ) : null}
                    </div>
                    {loyalty.entries.length === 0 ? (
                      <p className="text-sm text-slate-400">এখনো কোনো পয়েন্টের লেনদেন নেই।</p>
                    ) : (
                      <ResponsiveTable
                        table={
                          <div>
                            <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b text-xs text-slate-500">
                              <th className="py-1.5 pr-2 font-semibold">ধরন</th>
                              <th className="py-1.5 pr-2 font-semibold">পয়েন্ট</th>
                              <th className="py-1.5 pr-2 font-semibold">ব্যালেন্স (পরে)</th>
                              <th className="py-1.5 pr-2 font-semibold">অর্ডার</th>
                              <th className="py-1.5 font-semibold">তারিখ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {loyalty.entries.map((en) => (
                              <tr key={en.id} className="border-b last:border-0 align-top">
                                <td className="py-1.5 pr-2">
                                  <span className="font-medium">{loyaltyEntryLabel(en)}</span>
                                  {loyaltyEntryNote(en) ? <span className="block text-xs text-slate-500">{loyaltyEntryNote(en)}</span> : null}
                                  {en.expiresAt ? <span className="block text-xs text-slate-500">মেয়াদ: {new Date(en.expiresAt).toLocaleDateString("bn-BD")}{en.remainingPoints != null ? ` · অবশিষ্ট ${en.remainingPoints}` : ""}</span> : null}
                                </td>
                                <td className={`py-1.5 pr-2 font-semibold ${en.deltaPoints < 0 ? "text-red-600" : "text-emerald-700"}`}>{formatPointsDelta(en.deltaPoints)}</td>
                                <td className="py-1.5 pr-2">{en.balanceAfter}</td>
                                <td className="py-1.5 pr-2">{en.orderNumber ? `#${en.orderNumber}` : en.orderId ? `#${en.orderId.slice(0, 8)}` : "—"}</td>
                                <td className="py-1.5 text-slate-500">{new Date(en.createdAt).toLocaleDateString("bn-BD")}</td>
                              </tr>
                            ))}
                            </tbody>
                            </table>
                          </div>
                        }
                        cards={loyalty.entries.map((en) => (
                          <div key={en.id} className="rounded-lg border p-3">
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-medium">{loyaltyEntryLabel(en)}</span>
                              <span className={`font-semibold ${en.deltaPoints < 0 ? "text-red-600" : "text-emerald-700"}`}>{formatPointsDelta(en.deltaPoints)}</span>
                            </div>
                            {loyaltyEntryNote(en) ? <div className="mt-0.5 text-xs text-slate-500">{loyaltyEntryNote(en)}</div> : null}
                            {en.expiresAt ? <div className="mt-0.5 text-xs text-slate-500">মেয়াদ: {new Date(en.expiresAt).toLocaleDateString("bn-BD")}{en.remainingPoints != null ? ` · অবশিষ্ট ${en.remainingPoints}` : ""}</div> : null}
                            <dl className="mt-2 space-y-1.5 text-sm">
                              <div className="flex gap-2">
                                <dt className="w-28 shrink-0 text-xs font-semibold text-slate-500">ব্যালেন্স (পরে)</dt>
                                <dd>{en.balanceAfter}</dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="w-28 shrink-0 text-xs font-semibold text-slate-500">অর্ডার</dt>
                                <dd>{en.orderNumber ? `#${en.orderNumber}` : en.orderId ? `#${en.orderId.slice(0, 8)}` : "—"}</dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="w-28 shrink-0 text-xs font-semibold text-slate-500">তারিখ</dt>
                                <dd className="text-slate-500">{new Date(en.createdAt).toLocaleDateString("bn-BD")}</dd>
                              </div>
                            </dl>
                          </div>
                        ))}
                      />
                    )}
                    {(loyalty.referralRewards?.coupons ?? []).length > 0 ? (
                      <div className="space-y-1 border-t pt-3">
                        <div className="text-sm font-semibold">🎁 রেফারেল পুরস্কারে পাওয়া কুপন</div>
                        {(loyalty.referralRewards?.coupons ?? []).map((c) => (
                          <div key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                            <span className="font-mono font-semibold">{c.code}</span>
                            <span>{c.kind === "percent" ? `${c.value}% ছাড়` : c.value}</span>
                            {c.sourceOrderNumber ? <span className="text-xs text-slate-500">রেফার করা অর্ডার #{c.sourceOrderNumber}</span> : null}
                            {c.endsAt ? <span className="text-xs text-slate-500">মেয়াদ: {new Date(c.endsAt).toLocaleDateString("bn-BD")}</span> : null}
                            {!c.active ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">বাতিল/নিষ্ক্রিয়</span>
                              : c.usedCount > 0 ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">ব্যবহৃত ({c.usedCount}বার)</span>
                              : <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">সক্রিয়</span>}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="space-y-2 border-t pt-3">
                      <div className="text-sm font-semibold">পয়েন্ট সমন্বয় (স্টাফ)</div>
                      <p className="text-xs text-slate-500">ধনাত্মক সংখ্যা = পয়েন্ট যোগ, ঋণাত্মক = পয়েন্ট কাটা। নোট দেওয়া বাধ্যতামূলক — নোটটি লেজারে থেকে যাবে।</p>
                      {adjustError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{adjustError}</p> : null}
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="block text-sm">পয়েন্ট (+/−)
                          <input className="input mt-1 w-36" type="number" step="1" value={adjustDelta} onChange={(e) => setAdjustDelta(e.target.value)} placeholder="যেমন: ৫০ বা −২০" />
                        </label>
                        <label className="block flex-1 text-sm">নোট (বাধ্যতামূলক)
                          <input className="input mt-1 w-full" value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} placeholder="সমন্বয়ের কারণ লিখুন" />
                        </label>
                        <button type="button" className="btn-primary" disabled={adjustBusy || !adjustNote.trim() || !adjustDelta.trim() || Number(adjustDelta) === 0} onClick={() => void adjustLoyalty()}>
                          {adjustBusy ? "হচ্ছে…" : "সমন্বয় করুন"}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="card">
                <h3 className="mb-2 font-semibold">অর্ডারসমূহ</h3>
                {detail.orders.length === 0 ? <p className="text-sm text-slate-400">কোনো অর্ডার নেই</p> : detail.orders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
                    <span>#{o.externalNumber ?? o.id.slice(0, 8)} <span className="badge-slate ml-1">{o.status}</span>{o.isCod ? <span className="badge-amber ml-1">COD</span> : null}</span>
                    <span className="font-medium">{money(o.totalMinor)}</span>
                  </div>
                ))}
                {detail.shipments.map((s) => (
                  <div key={s.id} className="py-1 text-xs text-slate-500">🚚 {s.provider}: {s.status}{s.trackingCode ? ` · ${s.trackingCode}` : ""}</div>
                ))}
              </div>
              <div className="card">
                <h3 className="mb-2 font-semibold">কথোপকথন</h3>
                {detail.conversations.length === 0 ? <p className="text-sm text-slate-400">কোনো কথোপকথন নেই</p> : detail.conversations.map((c) => (
                  <a key={c.id} href="/dashboard/inbox" className="block border-b py-2 text-sm last:border-0 hover:bg-slate-50">
                    <span className="badge-indigo">{c.channel}</span> <span className="badge-slate ml-1">{c.status}</span>
                    <span className="ml-2 text-slate-600">{c.lastMessagePreview ?? ""}</span>
                    {c.unreadCount > 0 ? <span className="badge-red ml-1">{c.unreadCount} অপঠিত</span> : null}
                  </a>
                ))}
              </div>
            </div>
          ) : (
            <div className="card"><EmptyState title="কাস্টমার বেছে নিন" description="বাম দিকের তালিকা থেকে একজন কাস্টমারে ক্লিক করলে তার সম্পূর্ণ প্রোফাইল এখানে দেখা যাবে।" /></div>
          )}
        </div>
      </div>

      {/* AB5 (AX7): B2B customer groups + per-group price list.
          A group's price list holds explicit prices only; the
          bulk %-off helper materializes rows server-side. */}
      <div className="card space-y-3">
        <h2 className="font-semibold">👥 কাস্টমার গ্রুপ (B2B) ও প্রাইস লিস্ট</h2>
        <p className="text-xs text-slate-500">পাইকারি/B2B ক্রেতাদের গ্রুপে ভাগ করুন। প্রতিটি গ্রুপের নিজস্ব প্রাইস লিস্ট থাকতে পারে — গ্রুপের সদস্যের চেকআউটে ক্যাটালগ দামের বদলে প্রাইস লিস্টের দামই প্রযোজ্য হবে। গ্রুপ মুছলে সদস্যরা গ্রুপছাড়া হয়ে যান, কাস্টমার মোছা হয় না।</p>
        {groupError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{groupError}</p> : null}
        {groups.length === 0 ? <p className="text-sm text-slate-400">কোনো গ্রুপ নেই — নিচে প্রথমটি বানান।</p> : groups.map((g) => (
          <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0">
            <span>
              <span className="font-medium">{g.name}</span>
              <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">{g.memberCount} জন সদস্য</span>
              <span className={`ml-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${g.hasPriceList ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                {g.hasPriceList ? "প্রাইস লিস্ট আছে" : "প্রাইস লিস্ট নেই"}
              </span>
            </span>
            <span className="flex gap-2">
              <button className="btn-secondary btn-sm" onClick={() => { setPlGroupId(g.id); setBulkResult(""); void loadPriceList(g.id); }}>প্রাইস লিস্ট</button>
              <button className="btn-secondary btn-sm" onClick={() => { setEditingGroupId(g.id); setGroupName(g.name); setGroupError(""); }}>নাম বদলান</button>
              <button className="btn-secondary btn-sm text-red-600" disabled={groupBusy !== ""} onClick={() => deleteGroup(g)}>মুছুন</button>
            </span>
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-2 border-t pt-3">
          <label className="block text-sm">{editingGroupId ? "গ্রুপের নতুন নাম" : "নতুন গ্রুপের নাম"}
            <input className="input mt-1 w-72" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="যেমন: ঢাকার পাইকারি ক্রেতা" maxLength={200} />
          </label>
          <button className="btn-primary" disabled={groupBusy !== "" || !groupName.trim()} onClick={saveGroup}>
            {groupBusy === "save" ? "সংরক্ষণ হচ্ছে…" : editingGroupId ? "নাম সংরক্ষণ করুন" : "গ্রুপ তৈরি করুন"}
          </button>
          {editingGroupId ? (
            <button className="btn-secondary" onClick={() => { setEditingGroupId(""); setGroupName(""); }}>বাতিল</button>
          ) : null}
        </div>

        {plGroupId ? (
          <div className="space-y-3 rounded-xl bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">💲 প্রাইস লিস্ট — {groups.find((g) => g.id === plGroupId)?.name ?? ""}</h3>
              <button className="btn-secondary btn-sm" onClick={() => { setPlGroupId(""); setPlItems([]); }}>বন্ধ করুন</button>
            </div>
            {plLoading ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : plItems.length === 0 ? (
              <p className="text-sm text-slate-400">এই লিস্টে এখনো কোনো আইটেম নেই — নিচে পণ্য যোগ করুন অথবা বাল্ক ছাড় চালান।</p>
            ) : (
              <ResponsiveTable
                table={
                  <div>
                    <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-xs text-slate-500">
                      <th className="py-1.5 pr-2 font-semibold">পণ্য</th>
                      <th className="py-1.5 pr-2 font-semibold">ভ্যারিয়েন্ট</th>
                      <th className="py-1.5 pr-2 font-semibold">গ্রুপ দাম</th>
                      <th className="py-1.5 font-semibold"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {plItems.map((it) => (
                      <tr key={it.id} className="border-b last:border-0">
                        <td className="py-1.5 pr-2 font-medium">{it.productName ?? it.productId}</td>
                        <td className="py-1.5 pr-2">{it.variantName ?? "সব ভ্যারিয়েন্ট"}</td>
                        <td className="py-1.5 pr-2 font-semibold">{money(it.priceMinor)}</td>
                        <td className="py-1.5 text-right">
                          <button className="btn-secondary btn-sm min-h-[44px] text-red-600" disabled={groupBusy !== ""} onClick={() => removePlItem(it)}>সরান</button>
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
                      <span className="font-semibold">{money(it.priceMinor)}</span>
                    </div>
                    <dl className="mt-2 space-y-1.5 text-sm">
                      <div className="flex gap-2">
                        <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">ভ্যারিয়েন্ট</dt>
                        <dd>{it.variantName ?? "সব ভ্যারিয়েন্ট"}</dd>
                      </div>
                    </dl>
                    <div className="mt-2 text-right">
                      <button className="btn-secondary btn-sm min-h-[44px] text-red-600" disabled={groupBusy !== ""} onClick={() => removePlItem(it)}>সরান</button>
                    </div>
                  </div>
                ))}
              />
            )}
            <div className="flex flex-wrap items-end gap-2 border-t pt-3">
              <label className="block text-sm">পণ্য
                <select className="input mt-1 w-64" value={plProductId} onChange={(e) => void onPlProductChange(e.target.value)}>
                  <option value="">— পণ্য বেছে নিন —</option>
                  {orgProducts.map((p) => <option key={p.id} value={p.id}>{p.name} ({money(p.priceMinor)})</option>)}
                </select>
              </label>
              <label className="block text-sm">ভ্যারিয়েন্ট (ঐচ্ছিক)
                <select className="input mt-1 w-48" value={plVariantId} onChange={(e) => setPlVariantId(e.target.value)} disabled={!plProductId || plVariants.length === 0}>
                  <option value="">সব ভ্যারিয়েন্ট</option>
                  {plVariants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </label>
              <label className="block text-sm">গ্রুপ দাম (৳)
                <input className="input mt-1 w-36" inputMode="decimal" placeholder="যেমন: 450" value={plPriceTaka} onChange={(e) => setPlPriceTaka(e.target.value)} />
              </label>
              <button className="btn-primary btn-sm" disabled={groupBusy !== "" || !plProductId || !plPriceTaka.trim()} onClick={addPlItem}>
                {groupBusy === "pl-add" ? "যোগ হচ্ছে…" : "আইটেম যোগ করুন"}
              </button>
            </div>
            <div className="flex flex-wrap items-end gap-2 border-t pt-3">
              <label className="block text-sm">সব সক্রিয় পণ্যে বাল্ক ছাড় (%)
                <input className="input mt-1 w-32" type="number" min="1" max="99" placeholder="যেমন: 10" value={bulkPercent} onChange={(e) => setBulkPercent(e.target.value)} />
              </label>
              <button className="btn-secondary btn-sm" disabled={groupBusy !== "" || !bulkPercent.trim()} onClick={applyBulkPercent}>
                {groupBusy === "bulk" ? "প্রয়োগ হচ্ছে…" : "ছাড় প্রয়োগ করুন"}
              </button>
              <span className="text-xs text-slate-500">ছাড়টি প্রতিটি পণ্যের জন্য আলাদা দাম হিসেবে লিস্টে লেখা হবে (পণ্য-স্তরের দাম বদলে যাবে, ভ্যারিয়েন্টের দাম নয়)।</span>
              {bulkResult ? <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">{bulkResult}</span> : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* GB6 (GC15): segments manager — definitions with live
          member counts; selecting one above filters the list. */}
      <div className="card space-y-3">
        <h2 className="font-semibold">🧩 গ্রাহক সেগমেন্ট</h2>
        <p className="text-xs text-slate-500">শর্ত মিলিয়ে গ্রাহকদের দল বানান। সব শর্ত একসাথে মিলতে হবে; কোনো শর্ত না দিলে সব গ্রাহকই এই সেগমেন্টে পড়বে। সদস্য সংখ্যা প্রতিবার লাইভ হিসাব হয়। শুধু Owner/Admin সেগমেন্ট তৈরি/বদল/মুছতে পারেন।</p>
        {segError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{segError}</p> : null}
        {segments.length === 0 ? <p className="text-sm text-slate-400">কোনো সেগমেন্ট নেই — নিচে প্রথমটি বানান।</p> : segments.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0">
            <span>
              <span className="font-medium">{s.name}</span>
              <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">{s.memberCount} জন সদস্য</span>
              <span className="block text-xs text-slate-500">{segmentCriteriaSummary(s.criteria)}</span>
            </span>
            <span className="flex gap-2">
              <button className="btn-secondary btn-sm" onClick={() => setSegmentId(s.id)}>তালিকায় দেখুন</button>
              <button className="btn-secondary btn-sm" onClick={() => editSegment(s)}>সম্পাদনা</button>
              <button className="btn-secondary btn-sm text-red-600" disabled={segBusy !== ""} onClick={() => deleteSegment(s)}>মুছুন</button>
            </span>
          </div>
        ))}
        <div className="space-y-3 border-t pt-3">
          <h3 className="text-sm font-semibold">{editingSegmentId ? "সেগমেন্ট সম্পাদনা" : "নতুন সেগমেন্ট"}</h3>
          <label className="block text-sm">সেগমেন্টের নাম
            <input className="input mt-1 w-full max-w-md" value={segName} onChange={(e) => setSegName(e.target.value)} placeholder="যেমন: ঢাকার বড় ক্রেতা" maxLength={130} />
          </label>
          <div>
            <div className="mb-1 text-sm font-medium">ট্যাগ — যেকোনো একটি থাকলেই চলবে (tagsAny)</div>
            <div className="flex flex-wrap gap-1.5">
              {segDraft.tagsAny.map((t) => (
                <span key={t} className="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                  #{t}
                  <button type="button" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center font-bold text-slate-400 hover:text-red-600" aria-label={`${t} ট্যাগ সরান`}
                    onClick={() => setSegDraft({ ...segDraft, tagsAny: segDraft.tagsAny.filter((x) => x !== t) })}>×</button>
                </span>
              ))}
              {segDraft.tagsAny.length === 0 ? <span className="text-xs text-slate-500">কোনো ট্যাগ শর্ত নেই</span> : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <input className="input w-56" placeholder="ট্যাগ লিখুন" aria-label="সেগমেন্টের ট্যাগ লিখুন" value={segTagInput} onChange={(e) => setSegTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSegTag(); } }} />
              <button type="button" className="btn-secondary btn-sm" onClick={addSegTag}>যোগ করুন</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={segDraft.vipOnly} onChange={(e) => setSegDraft({ ...segDraft, vipOnly: e.target.checked })} />
              শুধু VIP
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={segDraft.repeatOnly} onChange={(e) => setSegDraft({ ...segDraft, repeatOnly: e.target.checked })} />
              শুধু পুনরাবৃত্ত (কমপক্ষে ২টি বিক্রি সম্পন্ন অর্ডার)
            </label>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="block text-sm">সর্বনিম্ন মোট কেনাকাটা (৳) — লাইফটাইম মূল্য
              <input className="input mt-1 w-44" inputMode="decimal" placeholder="যেমন: 10000" value={segDraft.minSpentTaka}
                onChange={(e) => setSegDraft({ ...segDraft, minSpentTaka: e.target.value })} />
            </label>
            <label className="block text-sm">জেলা
              <input className="input mt-1 w-44" placeholder="যেমন: খুলনা" value={segDraft.district}
                onChange={(e) => setSegDraft({ ...segDraft, district: e.target.value })} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={segBusy !== ""} onClick={saveSegment}>
              {segBusy === "save" ? "সংরক্ষণ হচ্ছে…" : editingSegmentId ? "সেগমেন্ট হালনাগাদ করুন" : "সেগমেন্ট তৈরি করুন"}
            </button>
            {editingSegmentId ? (
              <button className="btn-secondary" onClick={() => { setEditingSegmentId(""); setSegName(""); setSegDraft(EMPTY_SEGMENT_DRAFT); setSegError(""); }}>বাতিল</button>
            ) : null}
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
