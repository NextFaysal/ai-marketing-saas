"use client";
import React from "react";
import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS, TEMPLATE_VARIABLE_HELP, notificationChannelLabel, notificationEventLabel } from "@/lib/orders-on5";
import type { NotifConfig } from "./types";

export interface NotificationSettingsPanelProps {
  notifPanelOpen: boolean;
  setNotifPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  notifPanelError: string;
  notifPanelNotice: string;
  notifConfig: NotifConfig | null;
  setNotifConfig: React.Dispatch<React.SetStateAction<NotifConfig | null>>;
  notifPanelBusy: string;
  toggleNotifChannel: (eventKey: string, channel: string) => void;
  saveNotifSettings: () => Promise<void>;
}

export function NotificationSettingsPanel({ notifPanelOpen, setNotifPanelOpen, notifPanelError, notifPanelNotice, notifConfig, setNotifConfig, notifPanelBusy, toggleNotifChannel, saveNotifSettings }: NotificationSettingsPanelProps) {
  return (
    <>
      {/* ON5: customer notification settings panel. */}
      {notifPanelOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="বিজ্ঞপ্তি সেটিংস">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">🔔 বিজ্ঞপ্তি সেটিংস</h2>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setNotifPanelOpen(false)}>বন্ধ করুন</button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              অর্ডারের প্রতিটি ধাপে গ্রাহককে কোন চ্যানেলে বার্তা যাবে তা এখানে ঠিক করুন। চ্যানেলগুলো দেখানো ক্রমেই চেষ্টা করা হয়
              (SMS → WhatsApp → Email) — আগের চ্যানেল ব্যর্থ হলে পরেরটি চেষ্টা হবে। টেমপ্লেট খালি রাখলে ডিফল্ট বার্তা ব্যবহার হবে।
            </p>
            <p className="mt-2 text-xs text-slate-500">ব্যবহারযোগ্য ভেরিয়েবল: <span className="font-mono">{TEMPLATE_VARIABLE_HELP}</span></p>
            {notifPanelError ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{notifPanelError}</p> : null}
            {notifPanelNotice ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notifPanelNotice}</p> : null}
            {!notifConfig ? (
              <p className="mt-4 text-sm text-slate-400">{notifPanelError ? "সেটিংস লোড হয়নি — আবার খুলে চেষ্টা করুন।" : "লোড হচ্ছে…"}</p>
            ) : (
              <div className="mt-4 space-y-3">
                {NOTIFICATION_EVENTS.map((eventKey) => {
                  const ev = notifConfig[eventKey];
                  if (!ev) return null;
                  return (
                    <div key={eventKey} className="space-y-2 rounded-xl border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="flex items-center gap-2 text-sm font-semibold">
                          <input type="checkbox" checked={ev.enabled}
                            onChange={(e) => setNotifConfig({ ...notifConfig, [eventKey]: { ...ev, enabled: e.target.checked } })} />
                          {notificationEventLabel(eventKey)}
                        </label>
                        <div className="flex flex-wrap items-center gap-1">
                          {NOTIFICATION_CHANNELS.map((ch) => {
                            const on = ev.channels.includes(ch);
                            return (
                              <button key={ch} type="button" aria-pressed={on}
                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${on ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-500 ring-slate-200"}`}
                                onClick={() => toggleNotifChannel(eventKey, ch)}>
                                {notificationChannelLabel(ch)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <details>
                        <summary className="cursor-pointer text-xs font-semibold text-slate-600">টেমপ্লেট সম্পাদনা</summary>
                        <div className="mt-2 space-y-2">
                          {NOTIFICATION_CHANNELS.map((ch) => (
                            <label key={ch} className="block text-xs font-medium text-slate-600">{notificationChannelLabel(ch)} টেমপ্লেট
                              <textarea className="input mt-1 w-full" rows={2} placeholder="ডিফল্ট বার্তা ব্যবহার হবে"
                                value={ev.templates[ch] ?? ""}
                                onChange={(e) => setNotifConfig({
                                  ...notifConfig,
                                  [eventKey]: { ...ev, templates: { ...ev.templates, [ch]: e.target.value === "" ? null : e.target.value } },
                                })} />
                            </label>
                          ))}
                          <p className="text-[11px] text-slate-400">ভেরিয়েবল: <span className="font-mono">{TEMPLATE_VARIABLE_HELP}</span> — এর বাইরের ভেরিয়েবল দিলে সংরক্ষণে সার্ভারের ত্রুটি দেখাবে।</p>
                        </div>
                      </details>
                    </div>
                  );
                })}
                <button type="button" className="btn-primary btn-sm" disabled={notifPanelBusy !== ""} onClick={() => void saveNotifSettings()}>
                  {notifPanelBusy === "save" ? "সংরক্ষণ হচ্ছে…" : "সেটিংস সংরক্ষণ করুন"}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
