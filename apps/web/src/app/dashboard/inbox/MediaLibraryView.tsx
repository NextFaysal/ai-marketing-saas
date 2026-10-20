"use client";
import React from "react";

interface MediaLibraryProps {
  mediaItems: any[];
  mediaQ: string;
  setMediaQ: (q: string) => void;
  mediaType: string;
  setMediaType: (t: string) => void;
  loadMedia: () => void;
  onOpenConversation: (conv: { id: string }) => void;
  onSwitchToList: () => void;
}

export function MediaLibraryView({
  mediaItems,
  mediaQ,
  setMediaQ,
  mediaType,
  setMediaType,
  loadMedia,
  onOpenConversation,
  onSwitchToList,
}: MediaLibraryProps) {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <div className="text-base font-bold text-slate-900">🖼️ মিডিয়া লাইব্রেরি (শেষ ৯০ দিন)</div>
          <p className="text-xs text-slate-400 mt-0.5">সব চ্যানেল থেকে আসা ছবি, অডিও, ভিডিও ও ডকুমেন্ট</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input !w-48 !text-xs !py-1.5"
            placeholder="নাম বা ফোন খুঁজুন…"
            value={mediaQ}
            onChange={(e) => setMediaQ(e.target.value)}
          />
          <select
            className="input !w-32 !text-xs !py-1.5"
            value={mediaType}
            onChange={(e) => setMediaType(e.target.value)}
          >
            <option value="">সব ধরন</option>
            <option value="image">🖼️ ছবি</option>
            <option value="audio">🎙️ ভয়েস</option>
            <option value="video">🎬 ভিডিও</option>
            <option value="document">📄 ডকুমেন্ট</option>
          </select>
          <button className="btn-secondary btn-sm" onClick={() => void loadMedia()}>↻ রিফ্রেশ</button>
        </div>
      </div>

      {mediaItems.length === 0 ? (
        <div className="py-16 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-xl">🖼️</div>
          <p className="text-sm font-semibold text-slate-700">কোনো মিডিয়া পাওয়া যায়নি</p>
          <p className="text-xs text-slate-400 mt-0.5">গ্রাহক বা এজেন্টের পাঠানো ছবি ও ভয়েস ফাইল এখানে জমা থাকবে</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {mediaItems.map((m: any) => (
            <button
              key={m.id}
              className="group rounded-2xl border border-slate-200/80 bg-white p-3.5 text-left shadow-xs transition hover:border-brand-300 hover:shadow-md hover:-translate-y-0.5"
              onClick={() => { onSwitchToList(); void onOpenConversation({ id: m.conversationId }); }}
            >
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-lg group-hover:scale-105 transition-transform">
                  {m.type === "image" ? "🖼️" : m.type === "audio" ? "🎙️" : m.type === "video" ? "🎬" : "📄"}
                </span>
                {m.stored ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                    💾 সুরক্ষিত ক্লাউড
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
                    প্ল্যাটফর্মে
                  </span>
                )}
              </div>
              <div className="mt-3 truncate text-xs font-bold text-slate-900 group-hover:text-brand-600 transition-colors">
                {m.contactName ?? "গ্রাহক"} · <span className="capitalize">{m.channel}</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-400 flex items-center justify-between">
                <span>{new Date(m.createdAt).toLocaleDateString("bn-BD")}</span>
                {m.sizeBytes ? <span>{(m.sizeBytes / 1024).toFixed(0)} KB</span> : null}
              </div>
            </button>
          ))}
        </div>
      )}
      <p className="text-[11px] text-slate-400">&quot;💾 সুরক্ষিত ক্লাউড&quot; মানে ছবি/ভয়েস আমাদের মিডিয়া পাইপলাইনে জমা আছে — মূল প্ল্যাটফর্ম থেকে লিংক মেয়াদ শেষ হলেও ফাইল মুছে যাবে না।</p>
    </div>
  );
}
