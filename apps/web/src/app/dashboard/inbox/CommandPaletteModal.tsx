"use client";
import React from "react";
import { ContactAvatar } from "@/components/inbox-avatar";
import { ChannelChip } from "@/components/inbox-extras";

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: any[];
  active: any;
  myId: string | null;
  filters: any;
  onFilter: (patch: any) => void;
  onOpenConversation: (c: any) => void;
  onPatchConversation: (patch: any) => void;
  onOpenShortcuts: () => void;
}

export function CommandPaletteModal({
  isOpen,
  onClose,
  conversations,
  active,
  myId,
  filters,
  onFilter,
  onOpenConversation,
  onPatchConversation,
  onOpenShortcuts,
}: CommandPaletteModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/60 backdrop-blur-sm p-4 pt-20 transition-all animate-in fade-in duration-150" onClick={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-3 text-sm font-semibold text-slate-800">
          <span className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-100 text-xs font-bold text-indigo-600">⌘</span>
            <span>দ্রুত অ্যাকশন ও কমান্ড প্যালেট</span>
          </span>
          <kbd className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 shadow-2xs">ESC</kbd>
        </div>
        <div className="max-h-84 overflow-y-auto p-2 space-y-1">
          <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">অপঠিত কথোপকথন</div>
          {conversations.filter((c) => c.unreadCount > 0).slice(0, 5).map((c) => (
            <button key={c.id} className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-50 transition" onClick={() => { onClose(); void onOpenConversation(c); }}>
              <div className="flex items-center gap-2 min-w-0">
                <ContactAvatar name={c.contactName ?? c.contactPhone} channel={c.channel} size="sm" />
                <span className="truncate font-medium text-slate-800">{c.contactName ?? c.contactPhone ?? "গ্রাহক"}</span>
              </div>
              <span className="shrink-0 flex items-center gap-1.5">
                <ChannelChip channel={c.channel} />
                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200">{c.unreadCount} অপঠিত</span>
              </span>
            </button>
          ))}
          <div className="my-1.5 border-t border-slate-100" />
          <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">কুইক ফিল্টার ও অ্যাকশন</div>
          <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 transition" onClick={() => { onClose(); onFilter({ unreadOnly: !filters.unreadOnly }); }}>
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-50 text-blue-600 text-xs font-bold">📬</span>
            <span>{filters.unreadOnly ? "সব কথোপকথন দেখুন" : "শুধু অপঠিত বার্তাগুলো ফিল্টার করুন"}</span>
          </button>
          {(["whatsapp", "messenger", "instagram", "webchat"] as const).map((ch) => (
            <button key={ch} className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 transition" onClick={() => { onClose(); onFilter({ channel: filters.channel === ch ? "" : ch }); }}>
              <span className="flex items-center gap-2">
                <ChannelChip channel={ch} />
                <span className="font-medium capitalize">{ch} এর চ্যাট ফিল্টার</span>
              </span>
              <span className="text-xs text-slate-400 font-medium">{filters.channel === ch ? "সক্রিয় ✓" : "ফিল্টার"}</span>
            </button>
          ))}
          {active && myId ? (
            <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-indigo-700 hover:bg-indigo-50 transition" onClick={() => { onClose(); void onPatchConversation({ assignedUserId: myId }); }}>
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 text-xs font-bold">👤</span>
              <span>বর্তমান কথোপকথন নিজেকে অ্যাসাইন করুন</span>
              <kbd className="ml-auto rounded-md border border-indigo-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 shadow-2xs">E</kbd>
            </button>
          ) : null}
          <button className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 transition" onClick={() => { onClose(); onOpenShortcuts(); }}>
            <span className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100 text-slate-600 text-xs font-bold">⌨️</span>
              <span>কীবোর্ড শর্টকাট তালিকা</span>
            </span>
            <kbd className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 shadow-2xs">?</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
