"use client";
import React, { useCallback, useEffect, useState } from "react";
import { fmtDateTime, fmtMoneyMinor, fmtNumber, fmtTime } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  COMMENT_POLL_MS, buildCommentOrderPayload, commentOrderNotice, commentsModeNotice,
  followUpSummary, movePin, nowShowingProductId, recapRows, sessionSourceBadge,
  sessionStatusChip, shouldPollComments, togglePin,
  type CommentOrderResult, type FollowUpSegmentResult, type LiveCatalogProduct,
  type LiveComment, type LiveCommentsResponse, type LiveRecap, type LiveSessionView,
} from "@/lib/live-commerce";
import type { SocialAccount } from "../social-posts/components/shared";
import { useToast } from "@repo/ui/client";

// NF1 (FB1 Part C) — Live Commerce cockpit. Sessions, pinned
// products, the comment feed (polled while live), comment→order
// and the recap all ride the Part-A API exactly as returned:
// when the comments response says mode "manual" / provider
// "unavailable" the page shows that state plainly — it never
// implies Meta comments are syncing when they are not.

interface OrderFormState {
  productId: string;
  quantity: number;
  customerName: string;
  customerPhone: string;
  address: string;
}

export default function LiveCommercePage() {
  const { dict, t, locale } = useLocale();
  // MB6: locale-aware replacement for the bn-only money-bn helper
  // (campaigns-page shadow pattern, same route as bookings/services —
  // no page spec pins this page's money output).
  const fmtMoneyBn = (minor: string | bigint | number | null | undefined): string =>
    minor === null || minor === undefined || minor === "" ? "—" : fmtMoneyMinor(locale, typeof minor === "bigint" ? minor : BigInt(String(minor).trim()));
  const { toast } = useToast();
  const [sessions, setSessions] = useState<LiveSessionView[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [catalog, setCatalog] = useState<LiveCatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  // Create-session form.
  const [title, setTitle] = useState("");
  const [source, setSource] = useState<"manual" | "meta">("manual");
  const [socialAccountId, setSocialAccountId] = useState("");
  const [externalLiveVideoId, setExternalLiveVideoId] = useState("");

  // Selected session (cockpit).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LiveSessionView | null>(null);
  const [commentsRes, setCommentsRes] = useState<LiveCommentsResponse | null>(null);
  const [recap, setRecap] = useState<LiveRecap | null>(null);
  const [pinIds, setPinIds] = useState<string[]>([]);
  const [pinPickerId, setPinPickerId] = useState("");

  // Manual comment form.
  const [commenterName, setCommenterName] = useState("");
  const [commentMessage, setCommentMessage] = useState("");

  // Comment→order form (one open comment at a time).
  const [orderComment, setOrderComment] = useState<LiveComment | null>(null);
  const [orderForm, setOrderForm] = useState<OrderFormState>({
    productId: "", quantity: 1, customerName: "", customerPhone: "", address: "",
  });
  const [orderNotice, setOrderNotice] = useState("");

  // Follow-up segment result.
  const [followUp, setFollowUp] = useState<FollowUpSegmentResult | null>(null);

  const loadSessions = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setSessions(await apiFetch<LiveSessionView[]>(`/organizations/${orgId}/live-sessions`));
  }, []);

  const loadDetail = useCallback(async (sessionId: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const [d, c, r] = await Promise.all([
      apiFetch<LiveSessionView>(`/organizations/${orgId}/live-sessions/${sessionId}`),
      apiFetch<LiveCommentsResponse>(`/organizations/${orgId}/live-sessions/${sessionId}/comments`),
      apiFetch<LiveRecap>(`/organizations/${orgId}/live-sessions/${sessionId}/recap`),
    ]);
    setDetail(d);
    setPinIds((d.products ?? []).map((p) => p.productId));
    setCommentsRes(c);
    setRecap(r);
  }, []);

  const loadComments = useCallback(async (sessionId: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setCommentsRes(await apiFetch<LiveCommentsResponse>(`/organizations/${orgId}/live-sessions/${sessionId}/comments`));
  }, []);

  useEffect(() => {
    (async () => {
      const orgId = getOrganizationId();
      if (!orgId) { setError(dict.commerce.noOrganizationSelected); setLoading(false); return; }
      try {
        await loadSessions();
        const [acc, prod] = await Promise.all([
          apiFetch<SocialAccount[]>(`/organizations/${orgId}/social/accounts`).catch(() => [] as SocialAccount[]),
          apiFetch<unknown>(`/organizations/${orgId}/products?pageSize=100`).catch(() => null),
        ]);
        setAccounts(acc);
        const list: unknown[] = Array.isArray(prod) ? prod
          : Array.isArray((prod as { items?: unknown[] })?.items) ? (prod as { items: unknown[] }).items : [];
        setCatalog(list.filter((p): p is LiveCatalogProduct =>
          !!p && typeof p === "object" && typeof (p as LiveCatalogProduct).id === "string"
          && typeof (p as LiveCatalogProduct).name === "string"));
      } catch (e) {
        setError(e instanceof Error ? e.message : dict.commerce.couldNotLoad);
      } finally { setLoading(false); }
    })();
  }, [loadSessions]);

  // Poll the comments endpoint on an interval while the selected
  // session is live (the response's own mode fields decide what
  // the banner says — polling a manual-mode response just keeps
  // the stored comments fresh, it is never presented as sync).
  useEffect(() => {
    if (!selectedId || !shouldPollComments(detail)) return;
    const t = setInterval(() => { loadComments(selectedId).catch(() => undefined); }, COMMENT_POLL_MS);
    return () => clearInterval(t);
  }, [selectedId, detail, loadComments]);

  const selectSession = async (sessionId: string) => {
    setSelectedId(sessionId);
    setFollowUp(null);
    setOrderNotice("");
    setOrderComment(null);
    try { await loadDetail(sessionId); }
    catch (e) { setError(e instanceof Error ? e.message : dict.commerce.couldNotLoadTheSession); }
  };

  const createSession = async () => {
    const orgId = getOrganizationId();
    if (!orgId || !title.trim() || busy) return;
    setBusy("create"); setError("");
    try {
      const created = await apiFetch<LiveSessionView>(`/organizations/${orgId}/live-sessions`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          source,
          ...(source === "meta" ? {
            socialAccountId: socialAccountId || undefined,
            externalLiveVideoId: externalLiveVideoId.trim() || undefined,
          } : {}),
        }),
      });
      setTitle(""); setExternalLiveVideoId("");
      await loadSessions();
      toast({ title: dict.commerce.sessionCreated, tone: "success" });
      await selectSession(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.couldNotCreateTheSession);
    } finally { setBusy(""); }
  };

  const changeLifecycle = async (action: "start" | "end") => {
    const orgId = getOrganizationId();
    if (!orgId || !selectedId || busy) return;
    setBusy(action); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/live-sessions/${selectedId}/${action}`, { method: "POST" });
      await loadSessions();
      await loadDetail(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.couldNotBeDone);
    } finally { setBusy(""); }
  };

  const savePins = async () => {
    const orgId = getOrganizationId();
    if (!orgId || !selectedId || busy) return;
    setBusy("pins"); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/live-sessions/${selectedId}/products`, {
        method: "PUT",
        body: JSON.stringify({ productIds: pinIds }),
      });
      await loadDetail(selectedId);
      toast({ title: dict.commerce.pinListSaved, tone: "success" });
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.couldNotSavePins);
    } finally { setBusy(""); }
  };

  const setNowShowing = async (productId: string) => {
    const orgId = getOrganizationId();
    if (!orgId || !selectedId || busy) return;
    setBusy("showing"); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/live-sessions/${selectedId}/products/${productId}/now-showing`, { method: "POST" });
      await loadDetail(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.couldNotSetNowShowing);
    } finally { setBusy(""); }
  };

  const addManualComment = async () => {
    const orgId = getOrganizationId();
    if (!orgId || !selectedId || busy) return;
    if (!commenterName.trim() || !commentMessage.trim()) {
      setError(dict.commerce.commenterNameMessageAreRequired);
      return;
    }
    setBusy("comment"); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/live-sessions/${selectedId}/comments`, {
        method: "POST",
        body: JSON.stringify({ commenterName: commenterName.trim(), message: commentMessage.trim() }),
      });
      setCommentMessage("");
      await loadComments(selectedId);
      const r = await apiFetch<LiveRecap>(`/organizations/${orgId}/live-sessions/${selectedId}/recap`).catch(() => null);
      if (r) setRecap(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.couldNotAddTheComment);
    } finally { setBusy(""); }
  };

  const openOrderForm = (comment: LiveComment) => {
    const showingId = nowShowingProductId(detail?.products);
    const fallback = detail?.products?.[0]?.productId ?? catalog[0]?.id ?? "";
    setOrderComment(comment);
    setOrderNotice("");
    setOrderForm({
      productId: showingId ?? fallback,
      quantity: 1,
      customerName: comment.commenterName,
      customerPhone: "",
      address: "",
    });
  };

  const submitCommentOrder = async () => {
    const orgId = getOrganizationId();
    if (!orgId || !selectedId || !orderComment || busy) return;
    const pin = detail?.products?.find((p) => p.productId === orderForm.productId);
    const product = pin?.product
      ? { name: pin.product.name, sku: pin.product.sku, priceMinor: pin.product.priceMinor }
      : (() => {
          const c = catalog.find((p) => p.id === orderForm.productId);
          return c ? { name: c.name, sku: c.sku ?? null, priceMinor: c.priceMinor } : null;
        })();
    if (!product) { setError(dict.commerce.selectAProductForThe); return; }
    if (!orderForm.customerPhone.trim()) { setError(dict.commerce.buyerPhoneNumberIsRequired); return; }
    setBusy("order"); setError("");
    try {
      const res = await apiFetch<CommentOrderResult>(
        `/organizations/${orgId}/live-sessions/${selectedId}/comments/${orderComment.id}/order`,
        {
          method: "POST",
          body: JSON.stringify(buildCommentOrderPayload({
            customerPhone: orderForm.customerPhone,
            customerName: orderForm.customerName,
            address: orderForm.address,
            product,
            quantity: orderForm.quantity,
          })),
        },
      );
      // alreadyExisted=true → the API returned the EXISTING
      // order (exactly-once); the notice says so plainly.
      setOrderNotice(commentOrderNotice(res, locale));
      const r = await apiFetch<LiveRecap>(`/organizations/${orgId}/live-sessions/${selectedId}/recap`).catch(() => null);
      if (r) setRecap(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.couldNotCreateTheOrder);
    } finally { setBusy(""); }
  };

  const buildFollowUp = async () => {
    const orgId = getOrganizationId();
    if (!orgId || !selectedId || busy) return;
    setBusy("followup"); setError("");
    try {
      setFollowUp(await apiFetch<FollowUpSegmentResult>(
        `/organizations/${orgId}/live-sessions/${selectedId}/follow-up-segment`, { method: "POST" },
      ));
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.couldNotCreateTheFollow);
    } finally { setBusy(""); }
  };

  const modeNotice = commentsModeNotice(commentsRes, locale);
  const showingId = nowShowingProductId(detail?.products);
  const comments: LiveComment[] = commentsRes?.comments ?? [];

  return (
    <div className="space-y-6">
      <h1 className="page-title">{dict.commerce.liveCommerce}</h1>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* ---------- left: create + session list ---------- */}
        <section className="space-y-4">
          <div className="space-y-3 rounded-xl border bg-white p-4">
            <h2 className="text-sm font-semibold">{dict.commerce.newLiveSession}</h2>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={dict.commerce.sessionTitle}
              className="w-full rounded-lg border px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => setSource("manual")} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${source === "manual" ? "border-amber-600 bg-amber-50 text-amber-700" : "text-slate-600"}`}>{dict.commerce.manual}</button>
              <button type="button" onClick={() => setSource("meta")} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${source === "meta" ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "text-slate-600"}`}>Meta</button>
            </div>
            {source === "meta" ? (
              <>
                <select value={socialAccountId} onChange={(e) => setSocialAccountId(e.target.value)} className="w-full rounded-lg border px-2 py-2 text-sm">
                  <option value="">{dict.commerce.selectASocialAccount}</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.platform})</option>
                  ))}
                </select>
                <input
                  value={externalLiveVideoId}
                  onChange={(e) => setExternalLiveVideoId(e.target.value)}
                  placeholder="Live Video ID (Meta)"
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
                <p className="text-xs text-slate-500">{dict.commerce.bothAreRequiredForMeta}</p>
              </>
            ) : (
              <p className="text-xs text-slate-500">{dict.commerce.inManualSessionsCommentsMust}</p>
            )}
            <button type="button" className="btn-primary w-full" disabled={!title.trim() || busy === "create"} onClick={createSession}>
              {busy === "create" ? dict.commerce.creating : dict.commerce.createSession}
            </button>
          </div>

          <div className="rounded-xl border bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold">{dict.commerce.sessions}</h2>
            {loading ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : sessions.length === 0 ? (
              <p className="text-sm text-slate-500">{dict.commerce.noLiveSessionsYet}</p>
            ) : (
              <ul className="divide-y">
                {sessions.map((s) => {
                  const chip = sessionStatusChip(s.status, locale);
                  const badge = sessionSourceBadge(s, locale);
                  return (
                    <li key={s.id}>
                      <button type="button" className={`w-full py-2.5 text-left ${selectedId === s.id ? "font-semibold" : ""}`} onClick={() => selectSession(s.id)}>
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm">{s.title}</span>
                          <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${chip.cls}`}>{chip.label}</span>
                          <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}>{badge.label}</span>
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {dict.commerce.comments}{s.commentCount ?? 0} {dict.commerce.orders4}{s.orderCount ?? 0} {dict.commerce.pins}{s.productCount ?? 0}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* ---------- right: cockpit ---------- */}
        <section className="space-y-4">
          {!detail ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">
              {dict.commerce.selectASessionFromThe}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{detail.title}</div>
                  <div className="text-xs text-slate-500">
                    {fmtDateTime(locale, new Date(detail.createdAt))}
                    {detail.externalLiveVideoId ? ` · Live Video: ${detail.externalLiveVideoId}` : ""}
                  </div>
                </div>
                <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${sessionStatusChip(detail.status, locale).cls}`}>{sessionStatusChip(detail.status, locale).label}</span>
                <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${sessionSourceBadge(detail, locale).cls}`}>{sessionSourceBadge(detail, locale).label}</span>
                {detail.status !== "live" && detail.status !== "ended" ? (
                  <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={busy === "start"} onClick={() => changeLifecycle("start")}>{dict.commerce.startLive}</button>
                ) : null}
                {detail.status === "live" ? (
                  <button type="button" className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600" disabled={busy === "end"} onClick={() => changeLifecycle("end")}>{dict.commerce.endSession}</button>
                ) : null}
              </div>

              {/* Recap — numbers come from the recap endpoint only. */}
              {recap ? (
                <div className="rounded-xl border bg-white p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">{dict.commerce.recap}</h2>
                    <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={busy === "followup"} onClick={buildFollowUp}>
                      {busy === "followup" ? dict.commerce.creating : dict.commerce.createFollowUpAudience}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {recapRows(recap, locale).map((row) => (
                      <div key={row.label} className="rounded-lg bg-slate-50 p-3 text-center">
                        <div className="text-lg font-bold">{row.value}</div>
                        <div className="text-xs text-slate-500">{row.label}</div>
                      </div>
                    ))}
                  </div>
                  {followUp ? (
                    <p className="mt-3 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900">{followUpSummary(followUp, locale)}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-4 xl:grid-cols-2">
                {/* Pinned products */}
                <div className="rounded-xl border bg-white p-4">
                  <h2 className="mb-3 text-sm font-semibold">{dict.commerce.pinnedProducts}</h2>
                  {pinIds.length === 0 ? (
                    <p className="text-sm text-slate-500">{dict.commerce.noProductsPinned}</p>
                  ) : (
                    <ul className="space-y-2">
                      {pinIds.map((productId, idx) => {
                        const pin = detail.products?.find((p) => p.productId === productId);
                        const cat = catalog.find((p) => p.id === productId);
                        const name = pin?.product?.name ?? cat?.name ?? productId;
                        const price = pin?.product?.priceMinor ?? cat?.priceMinor ?? null;
                        const isShowing = showingId === productId;
                        return (
                          <li key={productId} className="rounded-lg border p-2.5 text-sm">
                            <div className="flex items-center gap-2">
                              <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                              <span className="text-slate-600">{price != null ? fmtMoneyBn(price) : "—"}</span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <button type="button" className="rounded border px-2 py-1 text-xs" disabled={idx === 0} onClick={() => setPinIds((prev) => movePin(prev, productId, -1))}>{dict.commerce.up}</button>
                              <button type="button" className="rounded border px-2 py-1 text-xs" disabled={idx === pinIds.length - 1} onClick={() => setPinIds((prev) => movePin(prev, productId, 1))}>{dict.commerce.down}</button>
                              {pin ? (
                                <button
                                  type="button"
                                  className={`rounded px-2 py-1 text-xs font-semibold ${isShowing ? "bg-emerald-600 text-white" : "border"}`}
                                  disabled={busy === "showing"}
                                  onClick={() => setNowShowing(productId)}
                                >
                                  {isShowing ? dict.commerce.nowShowing : dict.commerce.makeNowShowing}
                                </button>
                              ) : null}
                              <button type="button" className="ml-auto text-xs font-semibold text-red-600 hover:underline" onClick={() => setPinIds((prev) => togglePin(prev, productId))}>{dict.commerce.remove}</button>
                            </div>
                            {!pin ? <p className="mt-1 text-[11px] text-amber-600">{dict.commerce.afterSavingNowShowingCan}</p> : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div className="mt-3 flex gap-2">
                    <select value={pinPickerId} onChange={(e) => setPinPickerId(e.target.value)} className="min-w-0 flex-1 rounded-lg border px-2 py-2 text-sm">
                      <option value="">{dict.commerce.selectAProduct2}</option>
                      {catalog.filter((p) => !pinIds.includes(p.id)).map((p) => (
                        <option key={p.id} value={p.id}>{p.name} — {fmtMoneyBn(p.priceMinor)}</option>
                      ))}
                    </select>
                    <button type="button" className="rounded-lg border px-3 py-2 text-sm font-semibold" disabled={!pinPickerId} onClick={() => { setPinIds((prev) => togglePin(prev, pinPickerId)); setPinPickerId(""); }}>
                      {dict.commerce.pin}</button>
                  </div>
                  <button type="button" className="btn-primary mt-3 w-full" disabled={busy === "pins"} onClick={savePins}>
                    {busy === "pins" ? dict.commerce.saving : dict.commerce.savePinList}
                  </button>
                </div>

                {/* Comment feed */}
                <div className="rounded-xl border bg-white p-4">
                  <h2 className="mb-2 text-sm font-semibold">{dict.commerce.commentFeed}</h2>
                  {modeNotice ? (
                    <p className="mb-3 rounded-lg bg-amber-50 p-2.5 text-xs font-medium text-amber-800">
                      {modeNotice}
                      {commentsRes?.providerReason ? <span className="block font-normal">{commentsRes.providerReason}</span> : null}
                    </p>
                  ) : (
                    <p className="mb-3 rounded-lg bg-emerald-50 p-2.5 text-xs font-medium text-emerald-800">{dict.commerce.liveCommentsAreComingFrom}</p>
                  )}
                  {comments.length === 0 ? (
                    <p className="text-sm text-slate-500">{dict.commerce.noCommentsYet}</p>
                  ) : (
                    <ul className="max-h-96 space-y-2 overflow-y-auto">
                      {comments.map((c) => (
                        <li key={c.id} className="rounded-lg bg-slate-50 p-2.5 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{c.commenterName}</span>
                            <span className="text-[11px] text-slate-400">{fmtTime(locale, new Date(c.commentedAt))}</span>
                            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{c.source === "meta" ? "Meta" : dict.commerce.manual}</span>
                            <button type="button" className="ml-auto text-xs font-semibold text-indigo-600 hover:underline" onClick={() => openOrderForm(c)}>
                              {dict.commerce.order5}</button>
                          </div>
                          <p className="mt-0.5 whitespace-pre-wrap">{c.message}</p>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-4 space-y-2 border-t pt-3">
                    <h3 className="text-xs font-semibold text-slate-600">{dict.commerce.addManualComment}</h3>
                    <input value={commenterName} onChange={(e) => setCommenterName(e.target.value)} placeholder={dict.commerce.commenterName} className="w-full rounded-lg border px-3 py-2 text-sm" />
                    <textarea value={commentMessage} onChange={(e) => setCommentMessage(e.target.value)} placeholder={dict.commerce.commentMessage} rows={2} className="w-full rounded-lg border px-3 py-2 text-sm" />
                    <button type="button" className="btn-primary w-full" disabled={busy === "comment"} onClick={addManualComment}>
                      {busy === "comment" ? dict.commerce.adding : dict.commerce.addComment}
                    </button>
                  </div>

                  {orderComment ? (
                    <div className="mt-4 space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
                      <h3 className="text-sm font-semibold">{dict.commerce.orderFromComment}{orderComment.commenterName}</h3>
                      <p className="text-xs text-slate-600">“{orderComment.message}”</p>
                      <select value={orderForm.productId} onChange={(e) => setOrderForm((f) => ({ ...f, productId: e.target.value }))} className="w-full rounded-lg border bg-white px-2 py-2 text-sm">
                        <option value="">{dict.commerce.selectAProduct2}</option>
                        {(detail.products ?? []).map((p) => (
                          <option key={p.productId} value={p.productId}>
                            {p.product?.name ?? p.productId}{p.product?.priceMinor != null ? ` — ${fmtMoneyBn(p.product.priceMinor)}` : ""}
                          </option>
                        ))}
                        {catalog.filter((p) => !(detail.products ?? []).some((pin) => pin.productId === p.id)).map((p) => (
                          <option key={p.id} value={p.id}>{p.name} — {fmtMoneyBn(p.priceMinor)}</option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <label className="text-sm">{dict.commerce.quantity}<input type="number" min={1} max={999} value={orderForm.quantity} onChange={(e) => setOrderForm((f) => ({ ...f, quantity: Number(e.target.value) }))} className="mt-1 w-24 rounded-lg border bg-white px-2 py-2 text-sm" />
                        </label>
                        <label className="flex-1 text-sm">{dict.commerce.buyerName}<input value={orderForm.customerName} onChange={(e) => setOrderForm((f) => ({ ...f, customerName: e.target.value }))} className="mt-1 w-full rounded-lg border bg-white px-2 py-2 text-sm" />
                        </label>
                      </div>
                      <input value={orderForm.customerPhone} onChange={(e) => setOrderForm((f) => ({ ...f, customerPhone: e.target.value }))} placeholder={dict.commerce.buyerPhoneNumber} className="w-full rounded-lg border bg-white px-3 py-2 text-sm" />
                      <input value={orderForm.address} onChange={(e) => setOrderForm((f) => ({ ...f, address: e.target.value }))} placeholder={dict.commerce.addressOptional} className="w-full rounded-lg border bg-white px-3 py-2 text-sm" />
                      {orderNotice ? (
                        <p className={`rounded-lg p-2.5 text-sm ${orderNotice.startsWith(dict.commerce.thisComment) ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{orderNotice}</p>
                      ) : null}
                      <div className="flex gap-2">
                        <button type="button" className="btn-primary flex-1" disabled={busy === "order"} onClick={submitCommentOrder}>
                          {busy === "order" ? dict.commerce.ordering : dict.commerce.createOrder}
                        </button>
                        <button type="button" className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold" onClick={() => setOrderComment(null)}>{dict.commerce.close}</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
