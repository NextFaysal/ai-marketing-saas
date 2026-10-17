"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { fmtMoneyBn } from "@/lib/money-bn";
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
      if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); setLoading(false); return; }
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
        setError(e instanceof Error ? e.message : "লোড করা যায়নি");
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
    catch (e) { setError(e instanceof Error ? e.message : "সেশন লোড করা যায়নি"); }
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
      toast({ title: "সেশন তৈরি হয়েছে", tone: "success" });
      await selectSession(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "সেশন তৈরি করা যায়নি");
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
      setError(e instanceof Error ? e.message : "করা যায়নি");
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
      toast({ title: "পিন তালিকা সংরক্ষণ হয়েছে", tone: "success" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "পিন সংরক্ষণ করা যায়নি");
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
      setError(e instanceof Error ? e.message : "এখন দেখানো হচ্ছে সেট করা যায়নি");
    } finally { setBusy(""); }
  };

  const addManualComment = async () => {
    const orgId = getOrganizationId();
    if (!orgId || !selectedId || busy) return;
    if (!commenterName.trim() || !commentMessage.trim()) {
      setError("কমেন্টকারীর নাম ও মেসেজ আবশ্যক");
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
      setError(e instanceof Error ? e.message : "কমেন্ট যোগ করা যায়নি");
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
    if (!product) { setError("অর্ডারের জন্য একটি পণ্য বেছে নিন"); return; }
    if (!orderForm.customerPhone.trim()) { setError("ক্রেতার ফোন নম্বর আবশ্যক"); return; }
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
      setOrderNotice(commentOrderNotice(res));
      const r = await apiFetch<LiveRecap>(`/organizations/${orgId}/live-sessions/${selectedId}/recap`).catch(() => null);
      if (r) setRecap(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "অর্ডার তৈরি করা যায়নি");
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
      setError(e instanceof Error ? e.message : "ফলো-আপ অডিয়েন্স তৈরি করা যায়নি");
    } finally { setBusy(""); }
  };

  const modeNotice = commentsModeNotice(commentsRes);
  const showingId = nowShowingProductId(detail?.products);
  const comments: LiveComment[] = commentsRes?.comments ?? [];

  return (
    <div className="space-y-6">
      <h1 className="page-title">লাইভ কমার্স</h1>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* ---------- left: create + session list ---------- */}
        <section className="space-y-4">
          <div className="space-y-3 rounded-xl border bg-white p-4">
            <h2 className="text-sm font-semibold">নতুন লাইভ সেশন</h2>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="সেশনের শিরোনাম"
              className="w-full rounded-lg border px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => setSource("manual")} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${source === "manual" ? "border-amber-600 bg-amber-50 text-amber-700" : "text-slate-600"}`}>ম্যানুয়াল</button>
              <button type="button" onClick={() => setSource("meta")} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${source === "meta" ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "text-slate-600"}`}>Meta</button>
            </div>
            {source === "meta" ? (
              <>
                <select value={socialAccountId} onChange={(e) => setSocialAccountId(e.target.value)} className="w-full rounded-lg border px-2 py-2 text-sm">
                  <option value="">Social অ্যাকাউন্ট বেছে নিন</option>
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
                <p className="text-xs text-slate-500">Meta সেশনে দুটোই আবশ্যক — Live Video ID-টি Meta-তে লাইভ শুরু করার পর পাওয়া যায়।</p>
              </>
            ) : (
              <p className="text-xs text-slate-500">ম্যানুয়াল সেশনে কমেন্ট হাতে যোগ করতে হয় — Meta থেকে স্বয়ংক্রিয় কমেন্ট আসে না।</p>
            )}
            <button type="button" className="btn-primary w-full" disabled={!title.trim() || busy === "create"} onClick={createSession}>
              {busy === "create" ? "তৈরি হচ্ছে…" : "সেশন তৈরি করুন"}
            </button>
          </div>

          <div className="rounded-xl border bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold">সেশনসমূহ</h2>
            {loading ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : sessions.length === 0 ? (
              <p className="text-sm text-slate-500">এখনো কোনো লাইভ সেশন নেই।</p>
            ) : (
              <ul className="divide-y">
                {sessions.map((s) => {
                  const chip = sessionStatusChip(s.status);
                  const badge = sessionSourceBadge(s);
                  return (
                    <li key={s.id}>
                      <button type="button" className={`w-full py-2.5 text-left ${selectedId === s.id ? "font-semibold" : ""}`} onClick={() => selectSession(s.id)}>
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm">{s.title}</span>
                          <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${chip.cls}`}>{chip.label}</span>
                          <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}>{badge.label}</span>
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          কমেন্ট {s.commentCount ?? 0} · অর্ডার {s.orderCount ?? 0} · পিন {s.productCount ?? 0}
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
              বাম থেকে একটি সেশন বেছে নিন, অথবা নতুন সেশন তৈরি করুন।
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{detail.title}</div>
                  <div className="text-xs text-slate-500">
                    {new Date(detail.createdAt).toLocaleString("bn-BD")}
                    {detail.externalLiveVideoId ? ` · Live Video: ${detail.externalLiveVideoId}` : ""}
                  </div>
                </div>
                <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${sessionStatusChip(detail.status).cls}`}>{sessionStatusChip(detail.status).label}</span>
                <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${sessionSourceBadge(detail).cls}`}>{sessionSourceBadge(detail).label}</span>
                {detail.status !== "live" && detail.status !== "ended" ? (
                  <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={busy === "start"} onClick={() => changeLifecycle("start")}>লাইভ শুরু করুন</button>
                ) : null}
                {detail.status === "live" ? (
                  <button type="button" className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600" disabled={busy === "end"} onClick={() => changeLifecycle("end")}>সেশন শেষ করুন</button>
                ) : null}
              </div>

              {/* Recap — numbers come from the recap endpoint only. */}
              {recap ? (
                <div className="rounded-xl border bg-white p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">সারসংক্ষেপ (Recap)</h2>
                    <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={busy === "followup"} onClick={buildFollowUp}>
                      {busy === "followup" ? "তৈরি হচ্ছে…" : "ফলো-আপ অডিয়েন্স তৈরি করুন"}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {recapRows(recap).map((row) => (
                      <div key={row.label} className="rounded-lg bg-slate-50 p-3 text-center">
                        <div className="text-lg font-bold">{row.value}</div>
                        <div className="text-xs text-slate-500">{row.label}</div>
                      </div>
                    ))}
                  </div>
                  {followUp ? (
                    <p className="mt-3 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900">{followUpSummary(followUp)}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-4 xl:grid-cols-2">
                {/* Pinned products */}
                <div className="rounded-xl border bg-white p-4">
                  <h2 className="mb-3 text-sm font-semibold">পিন করা পণ্য</h2>
                  {pinIds.length === 0 ? (
                    <p className="text-sm text-slate-500">কোনো পণ্য পিন করা নেই।</p>
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
                              <button type="button" className="rounded border px-2 py-1 text-xs" disabled={idx === 0} onClick={() => setPinIds((prev) => movePin(prev, productId, -1))}>↑ উপরে</button>
                              <button type="button" className="rounded border px-2 py-1 text-xs" disabled={idx === pinIds.length - 1} onClick={() => setPinIds((prev) => movePin(prev, productId, 1))}>↓ নিচে</button>
                              {pin ? (
                                <button
                                  type="button"
                                  className={`rounded px-2 py-1 text-xs font-semibold ${isShowing ? "bg-emerald-600 text-white" : "border"}`}
                                  disabled={busy === "showing"}
                                  onClick={() => setNowShowing(productId)}
                                >
                                  {isShowing ? "এখন দেখানো হচ্ছে" : "এখন দেখানো হচ্ছে করুন"}
                                </button>
                              ) : null}
                              <button type="button" className="ml-auto text-xs font-semibold text-red-600 hover:underline" onClick={() => setPinIds((prev) => togglePin(prev, productId))}>সরান</button>
                            </div>
                            {!pin ? <p className="mt-1 text-[11px] text-amber-600">সংরক্ষণের পর “এখন দেখানো হচ্ছে” চালু করা যাবে।</p> : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div className="mt-3 flex gap-2">
                    <select value={pinPickerId} onChange={(e) => setPinPickerId(e.target.value)} className="min-w-0 flex-1 rounded-lg border px-2 py-2 text-sm">
                      <option value="">পণ্য বেছে নিন…</option>
                      {catalog.filter((p) => !pinIds.includes(p.id)).map((p) => (
                        <option key={p.id} value={p.id}>{p.name} — {fmtMoneyBn(p.priceMinor)}</option>
                      ))}
                    </select>
                    <button type="button" className="rounded-lg border px-3 py-2 text-sm font-semibold" disabled={!pinPickerId} onClick={() => { setPinIds((prev) => togglePin(prev, pinPickerId)); setPinPickerId(""); }}>
                      + পিন করুন
                    </button>
                  </div>
                  <button type="button" className="btn-primary mt-3 w-full" disabled={busy === "pins"} onClick={savePins}>
                    {busy === "pins" ? "সংরক্ষণ হচ্ছে…" : "পিন তালিকা সংরক্ষণ করুন"}
                  </button>
                </div>

                {/* Comment feed */}
                <div className="rounded-xl border bg-white p-4">
                  <h2 className="mb-2 text-sm font-semibold">কমেন্ট ফিড</h2>
                  {modeNotice ? (
                    <p className="mb-3 rounded-lg bg-amber-50 p-2.5 text-xs font-medium text-amber-800">
                      {modeNotice}
                      {commentsRes?.providerReason ? <span className="block font-normal">{commentsRes.providerReason}</span> : null}
                    </p>
                  ) : (
                    <p className="mb-3 rounded-lg bg-emerald-50 p-2.5 text-xs font-medium text-emerald-800">Meta থেকে লাইভ কমেন্ট আসছে</p>
                  )}
                  {comments.length === 0 ? (
                    <p className="text-sm text-slate-500">এখনো কোনো কমেন্ট নেই।</p>
                  ) : (
                    <ul className="max-h-96 space-y-2 overflow-y-auto">
                      {comments.map((c) => (
                        <li key={c.id} className="rounded-lg bg-slate-50 p-2.5 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{c.commenterName}</span>
                            <span className="text-[11px] text-slate-400">{new Date(c.commentedAt).toLocaleTimeString("bn-BD")}</span>
                            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{c.source === "meta" ? "Meta" : "ম্যানুয়াল"}</span>
                            <button type="button" className="ml-auto text-xs font-semibold text-indigo-600 hover:underline" onClick={() => openOrderForm(c)}>
                              অর্ডার করুন
                            </button>
                          </div>
                          <p className="mt-0.5 whitespace-pre-wrap">{c.message}</p>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-4 space-y-2 border-t pt-3">
                    <h3 className="text-xs font-semibold text-slate-600">ম্যানুয়াল কমেন্ট যোগ করুন</h3>
                    <input value={commenterName} onChange={(e) => setCommenterName(e.target.value)} placeholder="কমেন্টকারীর নাম" className="w-full rounded-lg border px-3 py-2 text-sm" />
                    <textarea value={commentMessage} onChange={(e) => setCommentMessage(e.target.value)} placeholder="কমেন্টের মেসেজ" rows={2} className="w-full rounded-lg border px-3 py-2 text-sm" />
                    <button type="button" className="btn-primary w-full" disabled={busy === "comment"} onClick={addManualComment}>
                      {busy === "comment" ? "যোগ হচ্ছে…" : "কমেন্ট যোগ করুন"}
                    </button>
                  </div>

                  {orderComment ? (
                    <div className="mt-4 space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
                      <h3 className="text-sm font-semibold">কমেন্ট থেকে অর্ডার — {orderComment.commenterName}</h3>
                      <p className="text-xs text-slate-600">“{orderComment.message}”</p>
                      <select value={orderForm.productId} onChange={(e) => setOrderForm((f) => ({ ...f, productId: e.target.value }))} className="w-full rounded-lg border bg-white px-2 py-2 text-sm">
                        <option value="">পণ্য বেছে নিন…</option>
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
                        <label className="text-sm">পরিমাণ
                          <input type="number" min={1} max={999} value={orderForm.quantity} onChange={(e) => setOrderForm((f) => ({ ...f, quantity: Number(e.target.value) }))} className="mt-1 w-24 rounded-lg border bg-white px-2 py-2 text-sm" />
                        </label>
                        <label className="flex-1 text-sm">ক্রেতার নাম
                          <input value={orderForm.customerName} onChange={(e) => setOrderForm((f) => ({ ...f, customerName: e.target.value }))} className="mt-1 w-full rounded-lg border bg-white px-2 py-2 text-sm" />
                        </label>
                      </div>
                      <input value={orderForm.customerPhone} onChange={(e) => setOrderForm((f) => ({ ...f, customerPhone: e.target.value }))} placeholder="ক্রেতার ফোন নম্বর *" className="w-full rounded-lg border bg-white px-3 py-2 text-sm" />
                      <input value={orderForm.address} onChange={(e) => setOrderForm((f) => ({ ...f, address: e.target.value }))} placeholder="ঠিকানা (ঐচ্ছিক)" className="w-full rounded-lg border bg-white px-3 py-2 text-sm" />
                      {orderNotice ? (
                        <p className={`rounded-lg p-2.5 text-sm ${orderNotice.startsWith("এই কমেন্ট") ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{orderNotice}</p>
                      ) : null}
                      <div className="flex gap-2">
                        <button type="button" className="btn-primary flex-1" disabled={busy === "order"} onClick={submitCommentOrder}>
                          {busy === "order" ? "অর্ডার হচ্ছে…" : "অর্ডার তৈরি করুন"}
                        </button>
                        <button type="button" className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold" onClick={() => setOrderComment(null)}>বন্ধ করুন</button>
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
