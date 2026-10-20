"use client";
import React from "react";

interface QuickActionsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenOrder: () => void;
  onAddTaskNotice: () => void;
  onAddNote: () => void;
  onToggleResolve: () => void;
}

export function QuickActionsSheet({
  isOpen,
  onClose,
  onOpenOrder,
  onAddTaskNotice,
  onAddNote,
  onToggleResolve,
}: QuickActionsSheetProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 backdrop-blur-xs transition-opacity animate-in fade-in" onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-3xl bg-white p-5 shadow-2xl animate-in slide-in-from-bottom duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <span className="text-base font-bold text-slate-900">দ্রুত অ্যাকশন</span>
          <button className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200" onClick={onClose}>✕</button>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-4">
          <button
            className="flex items-center gap-3 rounded-2xl border border-slate-200/90 bg-white p-3.5 text-left text-xs font-semibold text-slate-800 shadow-2xs hover:bg-blue-50/50 hover:border-blue-300"
            onClick={() => { onClose(); onOpenOrder(); }}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 text-lg">📄</span>
            <div>
              <div className="font-bold text-slate-900">ইনভয়েস পাঠান</div>
              <div className="text-[10px] text-slate-400">চ্যাট থেকে অর্ডার তৈরি</div>
            </div>
          </button>
          <button
            className="flex items-center gap-3 rounded-2xl border border-slate-200/90 bg-white p-3.5 text-left text-xs font-semibold text-slate-800 shadow-2xs hover:bg-blue-50/50 hover:border-blue-300"
            onClick={() => { onClose(); onAddTaskNotice(); }}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 text-lg">📋</span>
            <div>
              <div className="font-bold text-slate-900">টাস্ক তৈরি করুন</div>
              <div className="text-[10px] text-slate-400">রিমাইন্ডার ও ফলোআপ</div>
            </div>
          </button>
          <button
            className="flex items-center gap-3 rounded-2xl border border-slate-200/90 bg-white p-3.5 text-left text-xs font-semibold text-slate-800 shadow-2xs hover:bg-amber-50/50 hover:border-amber-300"
            onClick={() => { onClose(); onAddNote(); }}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600 text-lg">📝</span>
            <div>
              <div className="font-bold text-slate-900">নোট যোগ করুন</div>
              <div className="text-[10px] text-slate-400">টিম প্রাইভেট হুইস্পার</div>
            </div>
          </button>
          <button
            className="flex items-center gap-3 rounded-2xl border border-slate-200/90 bg-white p-3.5 text-left text-xs font-semibold text-slate-800 shadow-2xs hover:bg-emerald-50/50 hover:border-emerald-300"
            onClick={() => { onClose(); onToggleResolve(); }}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 text-lg">✓</span>
            <div>
              <div className="font-bold text-slate-900">মার্ক অ্যাজ রিজলভড</div>
              <div className="text-[10px] text-slate-400">চ্যাট সমাধান করুন</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
