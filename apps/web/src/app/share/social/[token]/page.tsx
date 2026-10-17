"use client";

/**
 * SN2 — public client-approval page for a Social Posts share link.
 *
 * No login: the unguessable token in the URL is the only credential.
 * Data comes ONLY from the public whitelist endpoint
 * (GET /public/social/share/:token) — caption, media, platform,
 * account display name, status and the effective client review.
 * The client can approve or request changes per post; every review
 * is recorded server-side (timeline + audit) and a later review
 * supersedes an earlier one.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import {
  CLIENT_REVIEW_META,
  type ClientReviewDecision,
  type PublicSharePost,
  type PublicSharePreview,
} from "@/lib/social-posts-sn";

const PLATFORM_LABEL: Record<string, string> = {
  meta_page: "Facebook Page",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; preview: PublicSharePreview };

export default function SocialSharePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [names, setNames] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busyPost, setBusyPost] = useState("");
  const [formError, setFormError] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/public/social/share/${token}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setState({
          kind: "error",
          message: body?.message
            ?? (res.status === 404 ? "লিংকটি পাওয়া যায়নি।" : "লিংকটি আর ব্যবহার করা যাচ্ছে না।"),
        });
        return;
      }
      setState({ kind: "ready", preview: (await res.json()) as PublicSharePreview });
    } catch {
      setState({ kind: "error", message: "সার্ভারের সঙ্গে যোগাযোগ করা যায়নি — একটু পরে আবার চেষ্টা করুন।" });
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  async function submitReview(post: PublicSharePost, decision: ClientReviewDecision) {
    const reviewerName = (names[post.postId] ?? "").trim();
    if (!reviewerName) {
      setFormError((s) => ({ ...s, [post.postId]: "আপনার নাম লেখা আবশ্যক।" }));
      return;
    }
    setFormError((s) => ({ ...s, [post.postId]: "" }));
    setBusyPost(post.postId);
    try {
      const res = await fetch(`${API_URL}/public/social/share/${token}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: post.postId,
          reviewerName,
          decision,
          comment: (comments[post.postId] ?? "").trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setFormError((s) => ({ ...s, [post.postId]: body?.message ?? "সিদ্ধান্ত পাঠানো যায়নি — আবার চেষ্টা করুন।" }));
        return;
      }
      // Reflect the new effective review locally (the server record
      // is the source of truth; a reload shows the same state).
      setState((prev) => {
        if (prev.kind !== "ready") return prev;
        return {
          kind: "ready",
          preview: {
            posts: prev.preview.posts.map((p) => p.postId === post.postId
              ? {
                  ...p,
                  clientReview: {
                    decision,
                    reviewerName,
                    comment: (comments[post.postId] ?? "").trim() || null,
                    createdAt: new Date().toISOString(),
                  },
                }
              : p),
          },
        };
      });
    } catch {
      setFormError((s) => ({ ...s, [post.postId]: "সার্ভারের সঙ্গে যোগাযোগ করা যায়নি — আবার চেষ্টা করুন।" }));
    } finally { setBusyPost(""); }
  }

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-bold">📣 পোস্ট অনুমোদন</h1>
        <p className="text-sm text-slate-500">নিচের পোস্টগুলো দেখে প্রতিটির জন্য অনুমোদন দিন অথবা পরিবর্তন চান। আপনার সিদ্ধান্ত সঙ্গে সঙ্গে রেকর্ড হয়ে যাবে।</p>
      </header>

      {state.kind === "loading" ? (
        <p className="py-10 text-center text-sm text-slate-400">লোড হচ্ছে…</p>
      ) : state.kind === "error" ? (
        <div className="rounded-xl bg-red-50 px-4 py-6 text-center text-sm text-red-700">{state.message}</div>
      ) : state.preview.posts.length === 0 ? (
        <div className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">এই লিংকে কোনো পোস্ট নেই।</div>
      ) : state.preview.posts.map((post) => (
        <article key={post.postId} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{PLATFORM_LABEL[post.platform] ?? post.platform}</span>
            <span className="text-slate-500">· {post.accountDisplayName}</span>
          </div>

          {post.media.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {post.media.map((m, i) => m.kind === "video" ? (
                <video key={i} src={m.publicUrl} controls preload="metadata" className="max-h-80 w-auto rounded-lg" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={m.publicUrl} alt="" className="max-h-80 w-auto rounded-lg object-contain" />
              ))}
            </div>
          ) : null}

          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">{post.caption}</p>

          {post.clientReview ? (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${CLIENT_REVIEW_META[post.clientReview.decision].pillCls}`}>
                {CLIENT_REVIEW_META[post.clientReview.decision].label}
              </span>
              <span className="text-slate-600">{post.clientReview.reviewerName}</span>
              <span className="text-slate-400"> · {new Date(post.clientReview.createdAt).toLocaleString("bn-BD")}</span>
              {post.clientReview.comment ? <p className="mt-1 text-slate-600">“{post.clientReview.comment}”</p> : null}
            </div>
          ) : (
            <p className="text-sm text-slate-400">এখনো কোনো সিদ্ধান্ত দেওয়া হয়নি।</p>
          )}

          <div className="space-y-2 border-t border-slate-100 pt-3">
            <label className="block text-sm">আপনার নাম (আবশ্যক)
              <input className="input mt-1 w-full" value={names[post.postId] ?? ""}
                onChange={(e) => setNames((s) => ({ ...s, [post.postId]: e.target.value }))}
                placeholder="যেমন: Rahim Uddin" />
            </label>
            <label className="block text-sm">মন্তব্য (ঐচ্ছিক)
              <textarea className="input mt-1 w-full" rows={2} value={comments[post.postId] ?? ""}
                onChange={(e) => setComments((s) => ({ ...s, [post.postId]: e.target.value }))}
                placeholder="পরিবর্তন চাইলে কী বদলাতে হবে লিখুন" />
            </label>
            {formError[post.postId] ? <p className="text-sm text-red-600">{formError[post.postId]}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary disabled:opacity-50" disabled={busyPost !== ""}
                onClick={() => void submitReview(post, "approved")}>
                {busyPost === post.postId ? "পাঠানো হচ্ছে…" : "✓ অনুমোদন দিন"}
              </button>
              <button type="button" className="btn-secondary disabled:opacity-50" disabled={busyPost !== ""}
                onClick={() => void submitReview(post, "changes_requested")}>
                পরিবর্তন চান
              </button>
            </div>
          </div>
        </article>
      ))}
    </main>
  );
}
