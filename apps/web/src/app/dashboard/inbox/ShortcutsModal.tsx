"use client";
import React from "react";

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 transition-all animate-in fade-in duration-150" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-900/10" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 text-xs">⌨️</span>
            <span>কীবোর্ড শর্টকাট</span>
          </div>
          <button className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition" onClick={onClose}>✕</button>
        </div>
        <ul className="divide-y divide-slate-100 text-xs text-slate-600">
          <li className="flex items-center justify-between py-2">
            <span>Command Palette খুলুন</span>
            <span className="flex items-center gap-1 font-mono">
              <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-2xs">⌘K</kbd>
              <span className="text-slate-400">বা</span>
              <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-2xs">Ctrl+K</kbd>
            </span>
          </li>
          <li className="flex items-center justify-between py-2">
            <span>তালিকায় নিচে / ওপরে যান</span>
            <span className="flex items-center gap-1 font-mono">
              <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-2xs">J</kbd>
              <span className="text-slate-400">/</span>
              <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-2xs">K</kbd>
            </span>
          </li>
          <li className="flex items-center justify-between py-2">
            <span>বেছে নেওয়া কথোপকথন খুলুন</span>
            <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold font-mono text-slate-700 shadow-2xs">Enter</kbd>
          </li>
          <li className="flex items-center justify-between py-2">
            <span>খোঁজার বক্সে ফোকাস করুন</span>
            <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold font-mono text-slate-700 shadow-2xs">/</kbd>
          </li>
          <li className="flex items-center justify-between py-2">
            <span>উত্তরের ঘরে (Composer) যান</span>
            <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold font-mono text-slate-700 shadow-2xs">R</kbd>
          </li>
          <li className="flex items-center justify-between py-2">
            <span>বর্তমান কথোপকথন নিজেকে অ্যাসাইন করুন</span>
            <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold font-mono text-slate-700 shadow-2xs">E</kbd>
          </li>
          <li className="flex items-center justify-between py-2">
            <span>শর্টকাট গাইড দেখুন</span>
            <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold font-mono text-slate-700 shadow-2xs">?</kbd>
          </li>
          <li className="flex items-center justify-between py-2">
            <span>প্যানেল বা মোডাল বন্ধ করুন</span>
            <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold font-mono text-slate-700 shadow-2xs">Esc</kbd>
          </li>
        </ul>
        <div className="mt-4 rounded-xl bg-slate-50 p-2.5 text-[11px] text-slate-500 text-center">
          💡 কোনো লেখার ঘরে (Input/Textarea) থাকা অবস্থায় ⌘K ছাড়া অন্যান্য শর্টকাট ট্রিগার হয় না।
        </div>
      </div>
    </div>
  );
}
