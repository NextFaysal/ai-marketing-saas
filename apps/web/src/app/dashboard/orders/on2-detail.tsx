"use client";
import React, { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  DELIVERY_ATTEMPT_OUTCOMES, deliveryAttemptOutcomeLabel,
  notificationChannelLabel, notificationEventLabel, notificationStatusLabel,
  DEFAULT_TEMPLATES, renderNotificationTemplate, generateWhatsAppTrackingShareUrl,
  type NotificationEventKey,
} from "@/lib/orders-on5";
import { fmtDate, fmtDateTime, fmtNumber, formatMinor } from "@repo/contracts";
import {
  formatPointsDelta, loyaltyEntryLabel, loyaltyEntryNote, type OrderLoyalty,
} from "@/lib/loyalty";
import {
  allocationStatusLabel, groupAllocationsByItem, hasActiveAllocations,
  type OrderAllocation,
} from "@/lib/warehouse-ab3";

export type { OrderAllocation };

/** Org staff row from GET /organizations/:id/members — the same
 * endpoint + shape the inbox and team pages use. The assignee id
 * everywhere in the dashboard is the USER id (m.user.id), never
 * the membership row id. */
export interface MemberRow { id: string; role: string; user: { id: string; name?: string | null; email: string } }
export const memberName = (members: MemberRow[], userId?: string | null, fallbackLabel = "টিম সদস্য"): string => {
  if (!userId) return "—";
  const m = members.find((x) => x.user.id === userId);
  return m ? (m.user.name ?? m.user.email) : fallbackLabel;
};

interface TimelineEntry { at: string; kind: string; title: string; detail?: string | null; actor?: string | null }
interface Customer360 {
  customer: { id: string; name?: string | null; phone?: string | null; email?: string | null } | null;
  orderCount: number; deliveredCount: number; cancelledCount: number; returnedCount: number;
  lifetimeValueMinor: string; reliabilityPercent: number | null;
  openDueMinor: string; openReturns: number;
  lastOrders: { id: string; externalNumber?: string | null; status: string; totalMinor: string; placedAt?: string | null }[];
}
interface OrderComment { id: string; authorId: string; authorName?: string | null; body: string; createdAt: string }
// ON6: staff-recorded delivery attempts (GET /orders/:id/delivery-attempts).
interface DeliveryAttempt { id: string; outcome: string; note?: string | null; rescheduleDate?: string | null; attemptedAt?: string | null; createdAt: string }
// ON5: per-order notification log rows (GET /orders/:id/notification-logs).
interface NotificationLog { id?: string; event: string; channel: string; status: string; providerMessageId?: string | null; error?: string | null; createdAt: string }

const KIND_ICON: Record<string, string> = {
  created: "🆕", order_created: "🆕", status: "🔄", status_change: "🔄",
  payment: "💳", advance: "💳", shipment: "🚚", courier: "🚚",
  comment: "💬", assign: "👤", assignment: "👤", tag: "🏷️",
  refund: "↩️", return: "↩️", note: "📝",
  notification: "🔔", delivery_attempt: "🏠",
};
const kindIcon = (kind: string) => KIND_ICON[kind] ?? "•";
const money = (minor?: string | null) => {
  if (minor == null) return "—";
  try { return formatMinor(BigInt(minor)); } catch { return String(minor); }
};

/** GC12: one payment attempt as the Payment Ops API reports it. */
interface PaymentAttemptRow {
  id: string; orderId: string; orderNumber: string | null; provider: string; source: string;
  amountMinor: string; currency: string; status: string; displayStatus: string;
  failureReason: string | null; feeMinor: string | null; netMinor: string | null; createdAt: string;
}

// ML5 i18n: values are dict.orders keys, resolved at render.
const ATTEMPT_STATUS_LABEL = {
  verified_paid: "verifiedPaymentReceived",
  initiated: "started",
  expired: "expiredInitiated",
  failed: "failed",
  cancelled: "cancel",
} as const satisfies Record<string, string>;

/**
 * GC12 — compact online-payment section for the order detail:
 * the latest attempt's status/provider/amount/failureReason and
 * the recovery resend button (defaulting provider/source from
 * the latest attempt). FAILURE-ISOLATED by design: a failed or
 * empty load hides the section entirely and never breaks the
 * detail page.
 */
export function OnlinePaymentSection({ orderId }: { orderId: string }) {
  const { dict, t, locale } = useLocale();
  const [items, setItems] = useState<PaymentAttemptRow[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendLink, setResendLink] = useState("");
  const [resendNote, setResendNote] = useState("");
  const [resendError, setResendError] = useState("");

  const load = React.useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setHidden(true); return; }
    try {
      const res = await apiFetch<{ items: PaymentAttemptRow[] }>(`/organizations/${orgId}/connections/payment-attempts?orderId=${encodeURIComponent(orderId)}&pageSize=5`);
      setItems(res.items ?? []);
    } catch { setHidden(true); }
  }, [orderId]);

  useEffect(() => { void load(); }, [load]);

  if (hidden || items === null || items.length === 0) return null;
  const latest = items[0];
  const paid = items.some((i) => i.status === "verified_paid");
  const labelKey = ATTEMPT_STATUS_LABEL[latest.displayStatus as keyof typeof ATTEMPT_STATUS_LABEL] ?? ATTEMPT_STATUS_LABEL[latest.status as keyof typeof ATTEMPT_STATUS_LABEL];
  const label = labelKey ? dict.orders[labelKey] : latest.status;

  async function resend() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setResendBusy(true); setResendError(""); setResendNote(""); setResendLink("");
    try {
      const out = await apiFetch<{ link: string; sendNote: string }>(`/organizations/${orgId}/orders/${orderId}/payment-link-resend`, {
        method: "POST",
        body: JSON.stringify({ provider: latest.provider, source: latest.source }),
      });
      setResendLink(out.link);
      setResendNote(out.sendNote);
      await load();
    } catch (e) {
      setResendError(e instanceof Error ? e.message : dict.orders.couldNotResend);
    } finally { setResendBusy(false); }
  }

  return (
    <div className="space-y-2 rounded-xl border bg-white p-3">
      <h4 className="text-sm font-semibold">{dict.orders.onlinePayment}</h4>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${latest.status === "verified_paid" ? "bg-green-100 text-green-700" : latest.status === "failed" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{label}</span>
        <span>{latest.provider} · {latest.source === "platform" ? dict.orders.platformGateway : dict.orders.ownGateway}</span>
        <span className="font-semibold">{money(latest.amountMinor)}</span>
        <span className="text-xs text-slate-400">{fmtDateTime(locale, new Date(latest.createdAt))}</span>
      </div>
      {latest.failureReason ? <p className="text-xs font-medium text-red-600">{dict.orders.failureReason2}{latest.failureReason}</p> : null}
      {!paid ? (
        <div className="space-y-1.5">
          <button type="button" disabled={resendBusy} onClick={() => void resend()} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {resendBusy ? dict.orders.sending : dict.orders.resendPaymentLink}
          </button>
          {resendError ? <p className="text-xs font-medium text-red-600">{resendError}</p> : null}
          {resendNote ? (
            <div className="space-y-1 text-xs">
              <p className="font-medium text-slate-600">{resendNote}</p>
              {resendLink ? <a href={resendLink} target="_blank" rel="noreferrer" className="block truncate font-medium text-indigo-600 hover:underline">{resendLink}</a> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * AB1 — compact loyalty section for the order detail: what this
 * order earned, redeemed, rewarded (referral) and had clawed
 * back, plus its ledger entries. FAILURE-ISOLATED like the GC12
 * payment section above, and renders NOTHING when the order has
 * no loyalty activity (all totals 0 and no entries) — most
 * orders have none, so the panel stays uncluttered.
 */
export function OrderLoyaltySection({ orderId }: { orderId: string }) {
  const { dict, t, locale } = useLocale();
  const [data, setData] = useState<OrderLoyalty | null>(null);

  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    let alive = true;
    setData(null);
    apiFetch<OrderLoyalty>(`/organizations/${orgId}/commerce/loyalty/orders/${orderId}`)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [orderId]);

  if (!data) return null;
  const totals = data.totals;
  const hasTotals = totals.earned !== 0 || totals.redeemed !== 0 || totals.referralReward !== 0 || totals.clawedBack !== 0;
  if (!hasTotals && data.entries.length === 0) return null;

  return (
    <div className="space-y-2 rounded-xl border bg-white p-3">
      <h4 className="text-sm font-semibold">{dict.orders.loyaltyPointsOnThisOrder}</h4>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
        <span>{dict.orders.earned}<b className="text-emerald-700">{totals.earned}</b></span>
        <span>{dict.orders.spent}<b className="text-red-600">{totals.redeemed}</b></span>
        <span>{dict.orders.referralReward}<b>{totals.referralReward}</b></span>
        <span>{dict.orders.deductionClawback}<b className="text-red-600">{totals.clawedBack}</b></span>
      </div>
      {data.entries.length > 0 ? (
        <ul className="space-y-1 border-t pt-2">
          {data.entries.map((en) => (
            <li key={en.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-medium">{loyaltyEntryLabel(en, locale)}</span>
              <span className={`font-semibold ${en.deltaPoints < 0 ? "text-red-600" : "text-emerald-700"}`}>{formatPointsDelta(en.deltaPoints)} {dict.orders.points}</span>
              <span className="text-xs text-slate-500">{dict.orders.balanceAfter}{en.balanceAfter}</span>
              {loyaltyEntryNote(en) ? <span className="text-xs text-slate-500">{loyaltyEntryNote(en)}</span> : null}
              <span className="ml-auto text-[11px] text-slate-400">{fmtDateTime(locale, new Date(en.createdAt))}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * AB3 (AX4) — this order's stock allocations: which warehouse /
 * bin each item's already-deducted units are attributed to,
 * grouped per item, plus the staff re-allocation action (move
 * the active claims to another warehouse; no stock is deducted
 * again — the API Bengali errors are shown as-is).
 *
 * NOTE on the reallocate response: POST .../reallocate returns
 * { moved, allocations } where `allocations` are the RAW new
 * allocation rows (no warehouseName/binCode labels, settled rows
 * absent) — so after a successful move this section asks the
 * parent to refetch the order detail instead of trusting the
 * response rows for display.
 */
export function OrderAllocationsSection({ orderId, allocations, items, onRefresh }: {
  orderId: string;
  allocations?: OrderAllocation[] | null;
  items?: { id: string; name: string }[] | null;
  onRefresh: () => void | Promise<void>;
}) {
  const { dict, t, locale } = useLocale();
  const [warehouses, setWarehouses] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [targetWh, setTargetWh] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const active = hasActiveAllocations(allocations);

  useEffect(() => {
    if (!active) return;
    const orgId = getOrganizationId(); if (!orgId) return;
    let alive = true;
    apiFetch<{ items: { id: string; name: string; active: boolean }[] }>(`/organizations/${orgId}/commerce/warehouses`)
      .then((d) => { if (alive) setWarehouses((d.items ?? []).filter((w) => w.active)); })
      .catch(() => { if (alive) setWarehouses([]); });
    return () => { alive = false; };
  }, [orderId, active]);

  if (!allocations || allocations.length === 0) return null;
  const groups = groupAllocationsByItem(allocations);
  const itemName = (id: string | null) => (id ? items?.find((i) => i.id === id)?.name : null);

  async function reallocate() {
    const orgId = getOrganizationId(); if (!orgId || !targetWh) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const out = await apiFetch<{ moved: number }>(`/organizations/${orgId}/commerce/orders/${orderId}/reallocate`, {
        method: "POST", body: JSON.stringify({ warehouseId: targetWh }),
      });
      setNotice(t("orders.allocationRemovedUnitsHaveBeen", { moved: out.moved }));
      setTargetWh("");
      await onRefresh();
    } catch (e) { setError(e instanceof Error ? e.message : dict.orders.allocationCouldNotBeRemoved); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-2 rounded-xl border bg-white p-3">
      <h4 className="text-sm font-semibold">{dict.orders.allocationWhichWarehouseBinThe}</h4>
      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g.key} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <p className="font-medium">{g.orderItemId ? (itemName(g.orderItemId) ?? dict.orders.item) : dict.orders.bundleComponent} <span className="text-xs text-slate-400">{dict.orders.total4}{g.totalQty}</span></p>
            <ul className="mt-1 space-y-1">
              {g.allocations.map((a) => (
                <li key={a.id} className={`flex flex-wrap items-center gap-x-2 text-xs ${a.status === "settled" ? "text-slate-400" : "text-slate-600"}`}>
                  <span>{a.warehouseName ?? dict.orders.warehouseUnknown}</span>
                  <span className="font-mono">{a.binCode ?? "—"}</span>
                  <span className="font-semibold">×{a.qty}</span>
                  {a.status === "settled" ? <span className="rounded bg-slate-200 px-1.5 py-0.5 font-semibold text-slate-500">{allocationStatusLabel(a.status)}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {active ? (
        <div className="space-y-1.5 border-t pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <select className="input w-auto" value={targetWh} onChange={(e) => setTargetWh(e.target.value)} aria-label={dict.orders.targetWarehouse}>
              <option value="">{dict.orders.chooseAWarehouse}</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <button type="button" className="btn-primary btn-sm" disabled={busy || !targetWh} onClick={() => void reallocate()}>
              {busy ? dict.orders.removing : dict.orders.removeAllocation}
            </button>
          </div>
          <p className="text-[11px] text-slate-400">{dict.orders.activeAllocationsWillMoveTo}</p>
          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p> : null}
          {notice ? <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">{notice}</p> : null}
        </div>
      ) : (
        <p className="text-xs text-slate-400">{dict.orders.allAllocationsAreSettledNothing}</p>
      )}
    </div>
  );
}

/**
 * ON2 (Orders Next): the detail-panel additions — unified
 * timeline, Customer 360, assignee picker, tag editor and the
 * internal comments thread. Everything renders ONLY what the
 * server returns; a failed load says so instead of rendering an
 * empty-but-confident panel.
 */
export function OrderDetailOn2({ orderId, orderLabel, assigneeId, tags, members, onPatch, onOpenOrder }: {
  orderId: string;
  orderLabel: string;
  assigneeId?: string | null;
  tags?: string[] | null;
  members: MemberRow[];
  /** Let the parent page sync its actOrder / list row after an
   * assign or tag change made from here. */
  onPatch: (patch: { assigneeId?: string | null; tags?: string[] }) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const { dict, t, locale } = useLocale();
  const [timeline, setTimeline] = useState<{ entries: TimelineEntry[]; truncated: boolean } | null>(null);
  const [timelineError, setTimelineError] = useState("");
  const [c360, setC360] = useState<Customer360 | null>(null);
  const [c360Error, setC360Error] = useState("");
  const [comments, setComments] = useState<OrderComment[]>([]);
  const [commentsError, setCommentsError] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [myId, setMyId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  // ON6 delivery attempts + ON5 notification logs.
  const [attempts, setAttempts] = useState<DeliveryAttempt[] | null>(null);
  const [attemptsError, setAttemptsError] = useState("");
  const [attemptOutcome, setAttemptOutcome] = useState("customer_unavailable");
  const [attemptNote, setAttemptNote] = useState("");
  const [attemptDate, setAttemptDate] = useState("");
  const [logs, setLogs] = useState<NotificationLog[] | null>(null);
  const [logsError, setLogsError] = useState("");
  const [notifModalOpen, setNotifModalOpen] = useState(false);
  const [selectedNotifEvent, setSelectedNotifEvent] = useState<NotificationEventKey>("handed_to_courier");
  const [customMsgText, setCustomMsgText] = useState("");
  const [notifCopied, setNotifCopied] = useState(false);

  // Sync the tag draft when the order changes OR its tags arrive
  // late (the parent enriches actOrder from GET /:orderId after
  // the panel mounts). Keyed on the joined string so a re-render
  // with identical tags never clobbers what staff are typing.
  const tagsKey = (tags ?? []).join(",");
  useEffect(() => { setTagDraft(tagsKey); }, [orderId, tagsKey]);

  useEffect(() => {
    apiFetch<any>("/auth/me").then((j) => setMyId(j?.id ?? j?.user?.id ?? null)).catch(() => undefined);
  }, []);

  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    let alive = true;
    setTimeline(null); setTimelineError("");
    apiFetch<{ entries: TimelineEntry[]; truncated: boolean }>(`/organizations/${orgId}/orders/${orderId}/timeline`)
      .then((t) => { if (alive) setTimeline(t); })
      .catch((e) => { if (alive) setTimelineError(e instanceof Error ? e.message : dict.orders.timelineLoadFailed); });
    setC360(null); setC360Error("");
    apiFetch<Customer360>(`/organizations/${orgId}/orders/${orderId}/customer-360`)
      .then((c) => { if (alive) setC360(c); })
      .catch((e) => { if (alive) setC360Error(e instanceof Error ? e.message : dict.orders.customerInfoLoadFailed); });
    setComments([]); setCommentsError("");
    apiFetch<OrderComment[]>(`/organizations/${orgId}/orders/${orderId}/comments`)
      .then((c) => { if (alive) setComments(c ?? []); })
      .catch((e) => { if (alive) setCommentsError(e instanceof Error ? e.message : dict.orders.commentLoadFailed); });
    setAttempts(null); setAttemptsError("");
    apiFetch<DeliveryAttempt[]>(`/organizations/${orgId}/orders/${orderId}/delivery-attempts`)
      .then((a) => { if (alive) setAttempts(a ?? []); })
      .catch((e) => { if (alive) setAttemptsError(e instanceof Error ? e.message : dict.orders.deliveryAttemptLoadFailed); });
    setLogs(null); setLogsError("");
    apiFetch<NotificationLog[]>(`/organizations/${orgId}/orders/${orderId}/notification-logs`)
      .then((l) => { if (alive) setLogs(l ?? []); })
      .catch((e) => { if (alive) setLogsError(e instanceof Error ? e.message : dict.orders.notificationLogLoadFailed); });
    return () => { alive = false; };
  }, [orderId]);

  /** Record what the courier reported. This is a STAFF record
   * only — nothing is sent back to the courier's system. Server
   * errors (no shipment, rescheduled without a date) are shown
   * verbatim. */
  async function recordAttempt() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (attemptOutcome === "rescheduled" && !attemptDate) {
      setAttemptsError(dict.orders.aNewDateIsRequired);
      return;
    }
    setBusy("attempt"); setAttemptsError("");
    try {
      const created = await apiFetch<DeliveryAttempt>(`/organizations/${orgId}/orders/${orderId}/delivery-attempts`, {
        method: "POST",
        body: JSON.stringify({
          outcome: attemptOutcome,
          note: attemptNote.trim() || undefined,
          rescheduleDate: attemptOutcome === "rescheduled" ? attemptDate : undefined,
        }),
      });
      setAttempts((prev) => [created, ...(prev ?? [])]);
      setAttemptNote(""); setAttemptDate("");
    } catch (e) { setAttemptsError(e instanceof Error ? e.message : dict.orders.deliveryAttemptRecordFailed); }
    finally { setBusy(""); }
  }

  async function assign(userId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("assign"); setCommentsError("");
    try {
      await apiFetch(`/organizations/${orgId}/orders/${orderId}/assign`, {
        method: "PATCH", body: JSON.stringify({ assigneeId: userId || null }),
      });
      onPatch({ assigneeId: userId || null });
    } catch (e) { setCommentsError(e instanceof Error ? e.message : dict.orders.responsibilityAssignmentFailed); }
    finally { setBusy(""); }
  }

  async function saveTags() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const next = [...new Set(tagDraft.split(",").map((t) => t.trim()).filter(Boolean))];
    setBusy("tags"); setCommentsError("");
    try {
      await apiFetch(`/organizations/${orgId}/orders/${orderId}/tags`, {
        method: "POST", body: JSON.stringify({ tags: next }),
      });
      onPatch({ tags: next });
    } catch (e) { setCommentsError(e instanceof Error ? e.message : dict.orders.tagSaveFailed); }
    finally { setBusy(""); }
  }

  async function postComment() {
    const orgId = getOrganizationId(); if (!orgId || !draft.trim()) return;
    setBusy("comment"); setCommentsError("");
    try {
      const created = await apiFetch<OrderComment>(`/organizations/${orgId}/orders/${orderId}/comments`, {
        method: "POST", body: JSON.stringify({ body: draft.trim() }),
      });
      setComments((prev) => [...prev, created]);
      setDraft("");
    } catch (e) { setCommentsError(e instanceof Error ? e.message : dict.orders.commentSendingFailed); }
    finally { setBusy(""); }
  }

  async function deleteComment(c: OrderComment) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`del-${c.id}`); setCommentsError("");
    try {
      await apiFetch(`/organizations/${orgId}/orders/${orderId}/comments/${c.id}`, { method: "DELETE" });
      setComments((prev) => prev.filter((x) => x.id !== c.id));
    } catch (e) { setCommentsError(e instanceof Error ? e.message : dict.orders.commentDeleteFailed); }
    finally { setBusy(""); }
  }

  return (
    <div className="space-y-3">
      {/* GC12: online payment summary + resend (hides itself on
          any load failure — never breaks the detail page). */}
      <OnlinePaymentSection orderId={orderId} />
      {/* AB1: this order's loyalty totals + entries (renders
          nothing when the order has no loyalty activity). */}
      <OrderLoyaltySection orderId={orderId} />
      <div className="grid gap-3 lg:grid-cols-2">
        {/* Customer 360 */}
        <div className="space-y-2 rounded-xl border bg-white p-3">
          <h4 className="text-sm font-semibold">{dict.orders.customer360Order}{orderLabel}</h4>
          {c360Error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{c360Error}</p> : !c360 ? (
            <p className="text-xs text-slate-400">{dict.common.loading}</p>
          ) : !c360.customer ? (
            <p className="text-sm text-slate-500">{dict.orders.guestCustomerNoCustomerRecord}</p>
          ) : (
            <div className="space-y-2 text-sm">
              <p className="font-medium">{c360.customer.name ?? dict.orders.noName}
                {c360.customer.phone ? <span className="ml-2 font-mono text-xs text-slate-500">{c360.customer.phone}</span> : null}
                {c360.customer.email ? <span className="ml-2 text-xs text-slate-500">{c360.customer.email}</span> : null}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                <span>{dict.orders.totalOrders2}<b>{c360.orderCount}</b></span>
                <span>{dict.orders.delivered3}<b>{c360.deliveredCount}</b></span>
                <span>{dict.orders.cancelled}<b>{c360.cancelledCount}</b></span>
                <span>{dict.orders.returns}<b>{c360.returnedCount}</b></span>
                <span>{dict.orders.totalPurchases}<b>{money(c360.lifetimeValueMinor)}</b></span>
                <span>{dict.orders.reliability}<b>{c360.reliabilityPercent == null ? "—" : `${c360.reliabilityPercent}%`}</b></span>
                <span>{dict.orders.openDue}<b className={c360.openDueMinor && c360.openDueMinor !== "0" ? "text-red-600" : ""}>{money(c360.openDueMinor)}</b></span>
                <span>{dict.orders.openReturns}<b>{c360.openReturns}</b></span>
              </div>
              {c360.lastOrders.length > 0 ? (
                <div className="space-y-1 border-t pt-2">
                  <p className="text-xs font-semibold text-slate-600">{dict.orders.recentOrders}</p>
                  {c360.lastOrders.map((lo) => (
                    <button key={lo.id} type="button" disabled={lo.id === orderId}
                      className="flex w-full flex-wrap items-baseline gap-x-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-left text-xs hover:bg-slate-100 disabled:opacity-60"
                      onClick={() => onOpenOrder(lo.id)}>
                      <span className="font-medium">#{lo.externalNumber ?? lo.id.slice(0, 8)}</span>
                      <span className="rounded bg-slate-200 px-1.5 py-0.5">{lo.status}</span>
                      <span className="font-semibold">{money(lo.totalMinor)}</span>
                      {lo.placedAt ? <span className="text-slate-400">{fmtDate(locale, new Date(lo.placedAt))}</span> : null}
                      {lo.id === orderId ? <span className="text-slate-400">{dict.orders.thisOrder}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Assignee + tags */}
        <div className="space-y-3 rounded-xl border bg-white p-3">
          <div className="space-y-1.5">
            <label className="text-sm font-semibold">{dict.orders.responsibility}</label>
            <div className="flex flex-wrap items-center gap-2">
              <select className="input w-auto" value={assigneeId ?? ""} disabled={busy !== ""} onChange={(e) => void assign(e.target.value)}>
                <option value="">{dict.orders.nobody}</option>
                {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name ?? m.user.email} ({m.role})</option>)}
              </select>
              <span className="text-xs text-slate-500">{dict.orders.current2}{memberName(members, assigneeId, dict.orders.teamMember)}</span>
            </div>
          </div>
          <div className="space-y-1.5 border-t pt-3">
            <label className="text-sm font-semibold">{dict.orders.tags}</label>
            <div className="flex flex-wrap items-center gap-2">
              <input className="input flex-1" placeholder={dict.orders.tagsCommaSeparatedEG} value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} />
              <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => void saveTags()}>{busy === "tags" ? dict.orders.ing : dict.orders.saveTags}</button>
            </div>
            {(tags ?? []).length > 0 ? (
              <div className="flex flex-wrap gap-1">{(tags ?? []).map((t) => <span key={t} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{t}</span>)}</div>
            ) : <p className="text-xs text-slate-400">{dict.orders.noTags}</p>}
          </div>
          {commentsError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{commentsError}</p> : null}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Timeline */}
        <div className="space-y-2 rounded-xl border bg-white p-3">
          <h4 className="text-sm font-semibold">{dict.orders.timelineTheOrderSFull}</h4>
          {timelineError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{timelineError}</p> : !timeline ? (
            <p className="text-xs text-slate-400">{dict.common.loading}</p>
          ) : timeline.entries.length === 0 ? (
            <p className="text-xs text-slate-400">{dict.orders.noEventsRecordedYet}</p>
          ) : (
            <>
              <ul className="space-y-0">
                {timeline.entries.map((e, i) => (
                  <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
                    <span className="flex flex-col items-center">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px]">{kindIcon(e.kind)}</span>
                      {i < timeline.entries.length - 1 ? <span className="mt-0.5 w-px flex-1 bg-slate-200" /> : null}
                    </span>
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{e.title}</span>
                      {e.detail ? <span className="block text-xs text-slate-600">{e.detail}</span> : null}
                      <span className="block text-[11px] text-slate-400">
                        {fmtDateTime(locale, new Date(e.at))}{e.actor ? ` · ${e.actor}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {timeline.truncated ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{dict.orders.thereWereMoreShowingThe}</p> : null}
            </>
          )}
        </div>

        {/* Internal comments */}
        <div className="space-y-2 rounded-xl border bg-white p-3">
          <h4 className="text-sm font-semibold">{dict.orders.internalCommentsTheCustomerWon}</h4>
          {comments.length === 0 ? (
            <p className="text-xs text-slate-400">{dict.orders.noCommentsYet}</p>
          ) : (
            <ul className="space-y-2">
              {comments.map((c) => (
                <li key={c.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700">{c.authorName ?? memberName(members, c.authorId, dict.orders.teamMember)}</span>
                    <span className="text-[11px] text-slate-400">{fmtDateTime(locale, new Date(c.createdAt))}</span>
                  </span>
                  <span className="mt-0.5 block whitespace-pre-wrap text-slate-700">{c.body}</span>
                  {/* Delete is shown for the author's own comments
                      (myId from /auth/me); the server also allows
                      admins and its error is shown verbatim. */}
                  {(myId === null || c.authorId === myId) ? (
                    <button type="button" className="mt-1 text-[11px] font-semibold text-red-600 hover:underline" disabled={busy !== ""} onClick={() => void deleteComment(c)}>
                      {busy === `del-${c.id}` ? dict.orders.deleting2 : dict.orders.delete}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2 border-t pt-2">
            <input className="input flex-1" placeholder={dict.orders.writeACommentForThe} value={draft} maxLength={2000}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void postComment(); } }} />
            <button type="button" className="btn-primary btn-sm" disabled={busy !== "" || !draft.trim()} onClick={() => void postComment()}>
              {busy === "comment" ? dict.orders.sending3 : dict.orders.add}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* ON6: delivery attempts — staff records of courier reports */}
        <div className="space-y-2 rounded-xl border bg-white p-3">
          <h4 className="text-sm font-semibold">{dict.orders.deliveryAttempts}</h4>
          <p className="text-[11px] text-slate-400">{dict.orders.aRecordOfWhatThe}</p>
          {attemptsError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{attemptsError}</p> : null}
          {attempts === null && !attemptsError ? (
            <p className="text-xs text-slate-400">{dict.common.loading}</p>
          ) : (attempts ?? []).length === 0 ? (
            <p className="text-xs text-slate-400">{dict.orders.noDeliveryAttemptsRecordedYet}</p>
          ) : (
            <ul className="space-y-1.5">
              {(attempts ?? []).map((a) => (
                <li key={a.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{deliveryAttemptOutcomeLabel(a.outcome, locale)}</span>
                    <span className="text-[11px] text-slate-400">{fmtDateTime(locale, new Date(a.attemptedAt ?? a.createdAt))}</span>
                  </span>
                  {a.rescheduleDate ? <span className="block text-xs text-slate-600">{dict.orders.newDate}{a.rescheduleDate}</span> : null}
                  {a.note ? <span className="block whitespace-pre-wrap text-xs text-slate-600">{a.note}</span> : null}
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-2 border-t pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <select className="input w-auto" value={attemptOutcome} onChange={(e) => setAttemptOutcome(e.target.value)} aria-label={dict.orders.deliveryAttemptOutcome}>
                {DELIVERY_ATTEMPT_OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              {attemptOutcome === "rescheduled" ? (
                <input className="input w-auto" type="date" value={attemptDate} onChange={(e) => setAttemptDate(e.target.value)} aria-label={dict.orders.rescheduledDate} required />
              ) : null}
            </div>
            <div className="flex gap-2">
              <input className="input flex-1" placeholder={dict.orders.noteOptionalWhatTheCourier} value={attemptNote} maxLength={1000}
                onChange={(e) => setAttemptNote(e.target.value)} />
              <button type="button" className="btn-primary btn-sm" disabled={busy !== ""} onClick={() => void recordAttempt()}>
                {busy === "attempt" ? dict.orders.recording : dict.orders.record}
              </button>
            </div>
          </div>
        </div>

        {/* ON5: notification log for this order */}
        <div className="space-y-2 rounded-xl border bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">{dict.orders.notificationLogMessagesSentTo}</h4>
            <button
              type="button"
              onClick={() => {
                setCustomMsgText("");
                setNotifModalOpen(true);
              }}
              className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-700 shadow-xs transition"
            >
              {dict.orders.sendWhatsAppSMS}</button>
          </div>

          {logsError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{logsError}</p> : logs === null ? (
            <p className="text-xs text-slate-400">{dict.common.loading}</p>
          ) : logs.length === 0 ? (
            <p className="text-xs text-slate-400">{dict.orders.noNotificationLogForThis}</p>
          ) : (
            <ul className="space-y-1.5">
              {logs.map((l, i) => (
                <li key={l.id ?? i} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{notificationEventLabel(l.event, locale)}</span>
                    <span className="text-[11px] text-slate-400">{fmtDateTime(locale, new Date(l.createdAt))}</span>
                  </span>
                  <span className="block text-xs text-slate-600">
                    {notificationChannelLabel(l.channel, locale)} · {notificationStatusLabel(l.status, locale)}
                    {l.providerMessageId ? <span className="ml-1 font-mono text-[11px] text-slate-400">{l.providerMessageId}</span> : null}
                  </span>
                  {l.error ? <span className="block text-xs text-red-600">{l.error}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Quick Send WhatsApp / SMS Modal */}
        {notifModalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
          >
            <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b pb-2">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <span>{dict.orders.sendTrackingMessageToThe}</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setNotifModalOpen(false)}
                  className="text-xs text-slate-400 hover:text-slate-600 font-bold"
                >
                  {dict.orders.close2}</button>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  <div>
                    <span className="text-slate-400 block text-[10px]">{dict.orders.customerNamePhone2}</span>
                    <strong className="text-slate-800">
                      {c360?.customer?.name || dict.orders.customer} ({c360?.customer?.phone || dict.orders.noPhoneNumber})
                    </strong>
                  </div>
                  <span className="font-mono font-bold text-slate-600">{orderLabel}</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {dict.orders.chooseAMessageEvent}</label>
                  <select
                    value={selectedNotifEvent}
                    onChange={(e) => {
                      setSelectedNotifEvent(e.target.value as NotificationEventKey);
                      setCustomMsgText("");
                    }}
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs bg-white text-slate-800"
                  >
                    <option value="handed_to_courier">{dict.orders.handedToCourierTrackingCode}</option>
                    <option value="out_for_delivery">{dict.orders.outForDeliveryRiderHas}</option>
                    <option value="order_placed">{dict.orders.orderReceivedConfirmation}</option>
                    <option value="delivered">{dict.orders.successfulDeliveryComplete}</option>
                    <option value="delivery_failed">{dict.orders.deliveryFailedCustomerNotReceived}</option>
                    <option value="delivery_rescheduled">{dict.orders.deliveryRescheduled}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {dict.orders.messagePreviewToSend}</label>
                  <textarea
                    rows={4}
                    value={
                      customMsgText.trim()
                        ? customMsgText
                        : renderNotificationTemplate(DEFAULT_TEMPLATES[selectedNotifEvent], {
                            customerName: c360?.customer?.name || dict.orders.customer,
                            orderNumber: orderLabel,
                            total: c360?.openDueMinor ? money(c360.openDueMinor) : dict.orders.text1oyl,
                            due: c360?.openDueMinor ? money(c360.openDueMinor) : dict.orders.text1oyl,
                            trackingUrl: `https://shop.com/track/${orderId.slice(0, 8)}`,
                            shopName: dict.orders.ourShop,
                            courierName: dict.orders.courier,
                            trackingCode: orderId.slice(0, 8).toUpperCase(),
                            rescheduleDate: dict.orders.tomorrow,
                          })
                    }
                    onChange={(e) => setCustomMsgText(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 p-2.5 text-xs text-slate-800 leading-relaxed"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2">
                <a
                  href={generateWhatsAppTrackingShareUrl(
                    c360?.customer?.phone || "",
                    customMsgText.trim()
                      ? customMsgText
                      : renderNotificationTemplate(DEFAULT_TEMPLATES[selectedNotifEvent], {
                          customerName: c360?.customer?.name || dict.orders.customer,
                          orderNumber: orderLabel,
                          total: c360?.openDueMinor ? money(c360.openDueMinor) : dict.orders.text1oyl,
                          due: c360?.openDueMinor ? money(c360.openDueMinor) : dict.orders.text1oyl,
                          trackingUrl: `https://shop.com/track/${orderId.slice(0, 8)}`,
                          shopName: dict.orders.ourShop,
                          courierName: dict.orders.courier,
                          trackingCode: orderId.slice(0, 8).toUpperCase(),
                          rescheduleDate: dict.orders.tomorrow,
                        })
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl bg-[#25D366] p-2.5 text-center text-xs font-bold text-white shadow hover:bg-[#20ba5a] transition"
                >
                  {dict.orders.sendOnWhatsApp}</a>

                <button
                  type="button"
                  onClick={async () => {
                    const txt = customMsgText.trim()
                      ? customMsgText
                      : renderNotificationTemplate(DEFAULT_TEMPLATES[selectedNotifEvent], {
                          customerName: c360?.customer?.name || dict.orders.customer,
                          orderNumber: orderLabel,
                          total: c360?.openDueMinor ? money(c360.openDueMinor) : dict.orders.text1oyl,
                          due: c360?.openDueMinor ? money(c360.openDueMinor) : dict.orders.text1oyl,
                          trackingUrl: `https://shop.com/track/${orderId.slice(0, 8)}`,
                          shopName: dict.orders.ourShop,
                          courierName: dict.orders.courier,
                          trackingCode: orderId.slice(0, 8).toUpperCase(),
                          rescheduleDate: dict.orders.tomorrow,
                        });
                    await navigator.clipboard.writeText(txt);
                    setNotifCopied(true);
                    setTimeout(() => setNotifCopied(false), 2000);
                  }}
                  className="rounded-xl border border-slate-300 bg-white p-2.5 text-center text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                >
                  {notifCopied ? dict.orders.copied2 : dict.orders.copy2}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
