"use client";
import React from "react";

interface NewMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: { channel: string; recipient: string; message: string };
  setForm: React.Dispatch<React.SetStateAction<{ channel: string; recipient: string; message: string }>>;
  onSend: (channel: string) => void;
}

export function NewMessageModal({
  isOpen,
  onClose,
  form,
  setForm,
  onSend,
}: NewMessageModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in" onClick={onClose}>
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl animate-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600 text-sm">✉️</span>
            <span className="text-base font-bold text-slate-900">নতুন বার্তা পাঠান</span>
          </div>
          <button className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200" onClick={onClose}>✕</button>
        </div>

        <div className="space-y-4 pt-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">কোন চ্যানেলে পাঠাবেন?</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                { id: "whatsapp", label: "WhatsApp", icon: "🟢", cls: "border-emerald-200 bg-emerald-50/60 text-emerald-800" },
                { id: "messenger", label: "Messenger", icon: "🔵", cls: "border-sky-200 bg-sky-50/60 text-sky-800" },
                { id: "instagram", label: "Instagram", icon: "🟣", cls: "border-fuchsia-200 bg-fuchsia-50/60 text-fuchsia-800" },
                { id: "telegram", label: "Telegram", icon: "✈️", cls: "border-cyan-200 bg-cyan-50/60 text-cyan-800" },
              ] as const).map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => setForm({ ...form, channel: ch.id })}
                  className={`flex items-center justify-center gap-1.5 rounded-2xl border p-2.5 text-xs font-bold transition ${
                    form.channel === ch.id
                      ? `${ch.cls} ring-2 ring-blue-500/30 shadow-xs`
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span>{ch.icon}</span>
                  <span>{ch.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">প্রাপক (ফোন নম্বর / ইউজার আইডি)</label>
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="যেমন: +8801712345678"
              value={form.recipient}
              onChange={(e) => setForm({ ...form, recipient: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">মেসেজের বিষয়বস্তু</label>
            <textarea
              rows={4}
              className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="নমস্কার! আমরা আপনার জন্য একটি বিশেষ অফার নিয়ে এসেছি..."
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              onClick={onClose}
            >
              বাতিল
            </button>
            <button
              type="button"
              disabled={!form.recipient.trim() || !form.message.trim()}
              className="flex items-center gap-1.5 rounded-2xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-blue-700 disabled:opacity-50 transition"
              onClick={() => onSend(form.channel)}
            >
              <span>পাঠান</span>
              <span>🚀</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
