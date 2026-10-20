"use client";
import React from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { ChannelChip } from "@/components/inbox-extras";
import { useLocale } from "@/lib/i18n/provider";
import { fmtMoneyMinor, fmtNumber, fmtTime } from "@repo/contracts";

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
  const { t, locale } = useLocale();
  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-slate-900">{t("inbox.pipelineBoard")}</span>
            {board && (
              <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-bold text-indigo-700 ring-1 ring-indigo-200">
                {t("inbox.totalActiveLine", { count: fmtNumber(locale, board.totalActive) })}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{t("inbox.dragStageHint")}</p>
        </div>
        <button className="btn-secondary btn-sm" onClick={() => void loadBoard()}>{t("inbox.inbZRefreshBtn")}</button>
      </div>

      {!board ? (
        <p className="py-12 text-center text-sm text-slate-400 font-medium">{t("inbox.boardLoading")}</p>
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
              title={stage === "shipped" ? t("inbox.shippedNote") : undefined}
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
                {t("inbox.inbZOrderValueLabel")} {fmtMoneyMinor(locale, board.stages[stage] ? Number(board.stages[stage].valueMinor) : 0)}
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
                      <span className="truncate text-xs font-bold text-slate-900">{card.contactName ?? card.contactPhone ?? t("inbox.customerFallback")}</span>
                      <ChannelChip channel={card.channel} />
                    </div>
                    <div className="truncate text-xs text-slate-500 mt-1">{card.lastMessagePreview ?? "—"}</div>
                    <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-1.5 text-[10.5px] text-slate-400">
                      <span>{card.lastMessageAt ? fmtTime(locale, card.lastMessageAt) : ""}</span>
                      {card.unreadCount > 0 ? <span className="rounded-full bg-red-500 px-1.5 py-0.2 font-bold text-white text-[10px]">{card.unreadCount}</span> : null}
                      {card.latestOrderTotalMinor ? <span className="font-bold text-emerald-600">{fmtMoneyMinor(locale, Number(card.latestOrderTotalMinor))}</span> : null}
                    </div>
                  </div>
                ))}
                {(board.stages[stage]?.cards ?? []).length === 0 && (
                  <p className="py-6 text-center text-xs text-slate-400 italic">{t("inbox.noChats")}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-slate-400">{t("inbox.inbZBoardNote")}</p>
    </div>
  );
}
