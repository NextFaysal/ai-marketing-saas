"use client";
import React from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { ChannelChip } from "@/components/inbox-extras";

interface PipelineBoardProps {
  board: any;
  loadBoard: () => void;
  onOpenConversation: (conv: { id: string }) => void;
  onSwitchToList: () => void;
}

export function PipelineBoardView({
  board,
  loadBoard,
  onOpenConversation,
  onSwitchToList,
}: PipelineBoardProps) {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-slate-900">🗂️ সেলস পাইপলাইন বোর্ড</span>
            {board && (
              <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-bold text-indigo-700 ring-1 ring-indigo-200">
                মোট সক্রিয় {board.totalActive}টি
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">ড্র্যাগ করে স্টেজ পরিবর্তন করুন — অটোমেটিক স্টেজ সিঙ্ক হবে</p>
        </div>
        <button className="btn-secondary btn-sm" onClick={() => void loadBoard()}>↻ রিফ্রেশ</button>
      </div>

      {!board ? (
        <p className="py-12 text-center text-sm text-slate-400 font-medium">পাইপলাইন লোড হচ্ছে...</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 pt-1 snap-x">
          {([["new", "🆕 New Lead"], ["talking", "💬 Talking"], ["ordered", "🛒 Order Placed"], ["shipped", "🚚 Shipped"], ["delivered", "✅ Completed"], ["repeat", "🔁 Repeat"]] as const).map(([stage, label]) => (
            <div
              key={stage}
              className={`min-h-[220px] w-72 shrink-0 rounded-2xl p-3 border transition-colors snap-start ${
                stage === "shipped"
                  ? "border-sky-200 bg-sky-50/40"
                  : "border-slate-200/80 bg-slate-50/70"
              }`}
              title={stage === "shipped" ? "Shipped ধাপটি কুরিয়ারের স্ট্যাটাস থেকে নিজে থেকে আসে — এখানে কার্ড ফেলা যায় না" : undefined}
              onDragOver={stage === "shipped" ? undefined : (e) => e.preventDefault()}
              onDrop={stage === "shipped" ? undefined : async (e) => {
                e.preventDefault();
                const convId = e.dataTransfer.getData("text/plain");
                const orgId = getOrganizationId(); if (!convId || !orgId) return;
                await apiFetch(`/organizations/${orgId}/inbox/conversations/${convId}`, { method: "PATCH", body: JSON.stringify({ pipelineStage: stage }) }).catch(() => undefined);
                void loadBoard();
              }}
            >
              <div className="mb-2 flex items-center justify-between border-b border-slate-200/60 pb-2">
                <span className="text-xs font-bold text-slate-800">{label}</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10.5px] font-bold text-slate-600 shadow-xs ring-1 ring-slate-200/60">
                  {board.stages[stage]?.count ?? 0}
                </span>
              </div>
              <div className="text-[11px] font-semibold text-emerald-700 bg-emerald-50/80 px-2 py-1 rounded-lg mb-3">
                অর্ডার মূল্য: ৳{board.stages[stage] ? (Number(board.stages[stage].valueMinor) / 100).toLocaleString("bn-BD") : "০"}
              </div>

              <div className="space-y-2">
                {(board.stages[stage]?.cards ?? []).map((card: any) => (
                  <div
                    key={card.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", card.id)}
                    onClick={() => { onSwitchToList(); void onOpenConversation({ id: card.id }); }}
                    className="cursor-pointer rounded-xl border border-slate-200/90 bg-white p-3 shadow-xs transition hover:border-brand-300 hover:shadow-md hover:-translate-y-0.5 active:scale-98"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="truncate text-xs font-bold text-slate-900">{card.contactName ?? card.contactPhone ?? "গ্রাহক"}</span>
                      <ChannelChip channel={card.channel} />
                    </div>
                    <div className="truncate text-xs text-slate-500 mt-1">{card.lastMessagePreview ?? "—"}</div>
                    <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-1.5 text-[10.5px] text-slate-400">
                      <span>{card.lastMessageAt ? new Date(card.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ""}</span>
                      {card.unreadCount > 0 ? <span className="rounded-full bg-red-500 px-1.5 py-0.2 font-bold text-white text-[10px]">{card.unreadCount}</span> : null}
                      {card.latestOrderTotalMinor ? <span className="font-bold text-emerald-600">৳{(Number(card.latestOrderTotalMinor) / 100).toLocaleString("bn-BD")}</span> : null}
                    </div>
                  </div>
                ))}
                {(board.stages[stage]?.cards ?? []).length === 0 && (
                  <p className="py-6 text-center text-xs text-slate-400 italic">কোনো চ্যাট নেই</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-slate-400">কার্ড Drag করে অন্য কলামে ছাড়লে Stage বদলায়। Stage অটো-এগোয়ও: প্রথম Reply → Talking, Chat Order → Order Placed/Repeat, কুরিয়ার পার্সেল পথে থাকলে → Shipped (এই ধাপটি শুধু কুরিয়ারের আসল স্ট্যাটাস থেকে আসে — হাতে বসানো যায় না), Order Delivered হলে → Completed।</p>
    </div>
  );
}
