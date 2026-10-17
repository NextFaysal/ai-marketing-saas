"use client";
import React from "react";
import { FRAUD_RULE_ACTION_LABEL, fraudAttemptKindLabel, identifierKindLabel, type FraudRuleDraft } from "@/lib/orders-gb3";
import type { BlockedPhoneRow, FraudAttemptRow, FraudRuleRow, FraudSettings, IdentifierRow } from "./types";
import { FraudNetworkCard } from "./FraudNetworkCard";

export interface FraudSettingsPanelProps {
  fraudPanelOpen: boolean;
  setFraudPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  fraudPanelError: string;
  fraudPanelNotice: string;
  fraudSettings: FraudSettings | null;
  setFraudSettings: React.Dispatch<React.SetStateAction<FraudSettings | null>>;
  fraudHighTaka: string;
  setFraudHighTaka: React.Dispatch<React.SetStateAction<string>>;
  fraudPanelBusy: string;
  saveFraudSettings: () => Promise<void>;
  blockForm: { phone: string; reason: string };
  setBlockForm: React.Dispatch<React.SetStateAction<{ phone: string; reason: string }>>;
  blockedPhones: BlockedPhoneRow[];
  addBlockedPhone: () => Promise<void>;
  deleteBlockedPhone: (row: BlockedPhoneRow) => Promise<void>;
  identTab: "phone" | "blocked" | "trusted";
  setIdentTab: React.Dispatch<React.SetStateAction<"phone" | "blocked" | "trusted">>;
  blockedIdents: IdentifierRow[];
  trustedIdents: IdentifierRow[];
  blockedIdentForm: { kind: string; value: string; reason: string };
  setBlockedIdentForm: React.Dispatch<React.SetStateAction<{ kind: string; value: string; reason: string }>>;
  trustedForm: { kind: string; value: string; reason: string };
  setTrustedForm: React.Dispatch<React.SetStateAction<{ kind: string; value: string; reason: string }>>;
  addBlockedIdent: () => Promise<void>;
  deleteBlockedIdent: (row: IdentifierRow) => Promise<void>;
  addTrustedIdent: () => Promise<void>;
  deleteTrustedIdent: (row: IdentifierRow) => Promise<void>;
  turnstileSecret: string;
  setTurnstileSecret: React.Dispatch<React.SetStateAction<string>>;
  fraudAttempts: FraudAttemptRow[];
  fraudRules: FraudRuleRow[];
  ruleDraft: FraudRuleDraft;
  setRuleDraft: React.Dispatch<React.SetStateAction<FraudRuleDraft>>;
  createFraudRule: () => Promise<void>;
  toggleFraudRule: (row: FraudRuleRow, enabled: boolean) => Promise<void>;
  deleteFraudRule: (row: FraudRuleRow) => Promise<void>;
}

export function FraudSettingsPanel({ fraudPanelOpen, setFraudPanelOpen, fraudPanelError, fraudPanelNotice, fraudSettings, setFraudSettings, fraudHighTaka, setFraudHighTaka, fraudPanelBusy, saveFraudSettings, blockForm, setBlockForm, blockedPhones, addBlockedPhone, deleteBlockedPhone, identTab, setIdentTab, blockedIdents, trustedIdents, blockedIdentForm, setBlockedIdentForm, trustedForm, setTrustedForm, addBlockedIdent, deleteBlockedIdent, addTrustedIdent, deleteTrustedIdent, turnstileSecret, setTurnstileSecret, fraudAttempts, fraudRules, ruleDraft, setRuleDraft, createFraudRule, toggleFraudRule, deleteFraudRule }: FraudSettingsPanelProps) {
  return (
    <>
      {fraudPanelOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="জালিয়াতি সুরক্ষা">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">🛡️ জালিয়াতি সুরক্ষা</h2>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setFraudPanelOpen(false)}>বন্ধ করুন</button>
            </div>
            <p className="mt-1 text-xs text-slate-500">প্রতিটি নতুন অর্ডারে জালিয়াতি ঝুঁকি যাচাই হয়। সেটিংস বদলালে পরের যাচাই থেকে তা কার্যকর হবে — আগের স্কোর নিজে থেকে বদলায় না, চাইলে অর্ডারের চিপ থেকে আবার যাচাই করুন।</p>
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">ডিভাইস সংকেত দুর্বল — পরিবারের সবাই একই ফোন ব্যবহার করতে পারেন; এটি একা কোনো অর্ডার আটকাবে না</p>
            {fraudPanelError ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{fraudPanelError}</p> : null}
            {fraudPanelNotice ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{fraudPanelNotice}</p> : null}
            {!fraudSettings ? (
              <p className="mt-4 text-sm text-slate-400">{fraudPanelError ? "সেটিংস লোড হয়নি — আবার খুলে চেষ্টা করুন।" : "লোড হচ্ছে…"}</p>
            ) : (
              <div className="mt-4 space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={fraudSettings.enabled} onChange={(e) => setFraudSettings({ ...fraudSettings, enabled: e.target.checked })} />
                  জালিয়াতি যাচাই সক্রিয়
                </label>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={fraudSettings.autoHoldEnabled} onChange={(e) => setFraudSettings({ ...fraudSettings, autoHoldEnabled: e.target.checked })} />
                  স্বয়ংক্রিয় আটকানো
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">কোন ঝুঁকি থেকে স্বয়ংক্রিয় আটকাবে
                    <select className="input mt-1" value={fraudSettings.autoHoldBand} onChange={(e) => setFraudSettings({ ...fraudSettings, autoHoldBand: e.target.value })}>
                      <option value="medium">মাঝারি ঝুঁকি থেকে</option>
                      <option value="high">শুধু উচ্চ ঝুঁকি</option>
                    </select>
                  </label>
                  <label className="text-sm">বড় অর্ডারের সীমা (৳)
                    <input className="input mt-1" inputMode="decimal" placeholder="যেমন: 5000" value={fraudHighTaka} onChange={(e) => setFraudHighTaka(e.target.value)} />
                  </label>
                  <label className="text-sm">বার্স্ট: কয়টি অর্ডার হলে সন্দেহজনক
                    <input className="input mt-1" type="number" min={0} value={fraudSettings.burstCount} onChange={(e) => setFraudSettings({ ...fraudSettings, burstCount: Number(e.target.value) })} />
                  </label>
                  <label className="text-sm">বার্স্ট সময়সীমা (ঘণ্টা)
                    <input className="input mt-1" type="number" min={0} value={fraudSettings.burstWindowHours} onChange={(e) => setFraudSettings({ ...fraudSettings, burstWindowHours: Number(e.target.value) })} />
                  </label>
                </div>
                {/* GB3 (GC9): open-order policy + window */}
                <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
                  <label className="text-sm">খোলা অর্ডার নীতি
                    <select className="input mt-1" value={fraudSettings.openOrderPolicy ?? "off"} onChange={(e) => setFraudSettings({ ...fraudSettings, openOrderPolicy: e.target.value })}>
                      <option value="off">বন্ধ (off)</option>
                      <option value="warn">সতর্কতা + আটক (warn)</option>
                      <option value="block">ব্লক (block)</option>
                    </select>
                  </label>
                  <label className="text-sm">খোলা অর্ডারের সময়সীমা (ঘণ্টা)
                    <input className="input mt-1" type="number" min={0} value={fraudSettings.openOrderWindowHours ?? 0} onChange={(e) => setFraudSettings({ ...fraudSettings, openOrderWindowHours: Number(e.target.value) })} />
                  </label>
                </div>
                {/* GB3 (GC9): rate limits (0 = off) */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">হার সীমা — দুই অর্ডারের মধ্যে অপেক্ষা (মিনিট, ০ = বন্ধ)
                    <input className="input mt-1" type="number" min={0} value={fraudSettings.waitingPeriodMinutes ?? 0} onChange={(e) => setFraudSettings({ ...fraudSettings, waitingPeriodMinutes: Number(e.target.value) })} />
                  </label>
                  <label className="text-sm">হার সীমা — এক ফোনে দিনে সর্বোচ্চ অর্ডার (০ = বন্ধ)
                    <input className="input mt-1" type="number" min={0} value={fraudSettings.maxOrdersPerPhonePerDay ?? 0} onChange={(e) => setFraudSettings({ ...fraudSettings, maxOrdersPerPhonePerDay: Number(e.target.value) })} />
                  </label>
                </div>
                {/* GB3 (GC9): Cloudflare Turnstile CAPTCHA */}
                <div className="space-y-2 border-t pt-3">
                  <div className="text-sm font-semibold">CAPTCHA (Cloudflare Turnstile)</div>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={!!fraudSettings.captchaEnabled} onChange={(e) => setFraudSettings({ ...fraudSettings, captchaEnabled: e.target.checked })} />
                    CAPTCHA চালু
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={!!fraudSettings.captchaOnCheckout} onChange={(e) => setFraudSettings({ ...fraudSettings, captchaOnCheckout: e.target.checked })} />
                    Checkout-এ CAPTCHA
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={!!fraudSettings.captchaOnOtp} onChange={(e) => setFraudSettings({ ...fraudSettings, captchaOnOtp: e.target.checked })} />
                    OTP অনুরোধে CAPTCHA
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">Turnstile Site Key
                      <input className="input mt-1" value={fraudSettings.turnstileSiteKey ?? ""} onChange={(e) => setFraudSettings({ ...fraudSettings, turnstileSiteKey: e.target.value })} placeholder="0x4AAAA…" />
                    </label>
                    <label className="text-sm">Turnstile Secret
                      <input className="input mt-1" type="password" autoComplete="new-password" value={turnstileSecret} onChange={(e) => setTurnstileSecret(e.target.value)} placeholder={fraudSettings.turnstileSecretSet ? "সেট করা আছে — বদলাতে নতুন সিক্রেট দিন" : "সিক্রেট দিন"} />
                    </label>
                  </div>
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Cloudflare Turnstile চালু থাকলে যাচাই সেবা বন্ধ থাকলে checkout আটকে যাবে; site key/secret দুটোই না দিলে CAPTCHA কার্যকর হবে না।</p>
                </div>
                <button type="button" className="btn-primary btn-sm" disabled={fraudPanelBusy !== ""} onClick={() => void saveFraudSettings()}>
                  {fraudPanelBusy === "save" ? "সংরক্ষণ হচ্ছে…" : "সেটিংস সংরক্ষণ করুন"}
                </button>
              </div>
            )}
            {/* NF13 (FB5): platform fraud network opt-in card —
                self-contained; renders its honest explainer
                before the OWNER-only toggle. */}
            <FraudNetworkCard />
            <div className="mt-6 space-y-3 border-t pt-4">
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="শনাক্তকারী তালিকা">
                {([["phone", "ফোন ব্লক (আগের তালিকা)"], ["blocked", "ইমেইল/IP/ডিভাইস ব্লক"], ["trusted", "বিশ্বস্ত তালিকা"]] as const).map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={identTab === key}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${identTab === key ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-600 ring-slate-200"}`}
                    onClick={() => setIdentTab(key)}>
                    {label}
                  </button>
                ))}
              </div>
              {identTab === "phone" ? (<>
              <h3 className="font-semibold">🚫 ব্লক করা ফোন নম্বর</h3>
              <p className="text-xs text-slate-500">ব্লক করা নম্বর থেকে অর্ডার এলে ঝুঁকি যাচাইয়ে তা ধরা পড়বে। নম্বরটি যেভাবে লিখবেন সেভাবেই সংরক্ষণ হবে।</p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm">ফোন নম্বর
                  <input className="input mt-1 w-44" placeholder="01XXXXXXXXX" value={blockForm.phone} onChange={(e) => setBlockForm({ ...blockForm, phone: e.target.value })} />
                </label>
                <label className="text-sm">কারণ (ঐচ্ছিক)
                  <input className="input mt-1 w-52" placeholder="যেমন: বারবার ভুয়া অর্ডার" value={blockForm.reason} onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })} />
                </label>
                <button type="button" className="btn-primary btn-sm" disabled={fraudPanelBusy !== "" || !blockForm.phone.trim()} onClick={() => void addBlockedPhone()}>
                  {fraudPanelBusy === "block-add" ? "যোগ হচ্ছে…" : "ব্লক করুন"}
                </button>
              </div>
              {blockedPhones.length === 0 ? (
                <p className="text-sm text-slate-400">কোনো নম্বর ব্লক করা নেই।</p>
              ) : (
                <ul className="space-y-1.5">
                  {blockedPhones.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span>
                        <span className="font-mono font-medium">{b.phone}</span>
                        {b.reason ? <span className="ml-2 text-slate-500">{b.reason}</span> : null}
                        <span className="block text-xs text-slate-400">ব্লক করা হয়েছে: {new Date(b.createdAt).toLocaleString("bn-BD")}</span>
                      </span>
                      <button type="button" className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50" disabled={fraudPanelBusy !== ""} onClick={() => void deleteBlockedPhone(b)}>
                        {fraudPanelBusy === `block-del-${b.id}` ? "সরানো হচ্ছে…" : "সরিয়ে দিন"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              </>) : null}
              {identTab === "blocked" ? (<>
              <h3 className="font-semibold">🚫 ইমেইল/IP/ডিভাইস ব্লক</h3>
              <p className="text-xs text-slate-500">ডিভাইসের ক্ষেত্রে পুরো ৬৪ অক্ষরের ডিভাইস হ্যাশটি দিন (শুধু শুরুটা নয়)।</p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm">ধরন
                  <select className="input mt-1 w-36" value={blockedIdentForm.kind} onChange={(e) => setBlockedIdentForm({ ...blockedIdentForm, kind: e.target.value })}>
                    <option value="email">ইমেইল</option>
                    <option value="ip">IP</option>
                    <option value="device">ডিভাইস হ্যাশ</option>
                  </select>
                </label>
                <label className="text-sm">মান
                  <input className="input mt-1 w-52 font-mono" placeholder={blockedIdentForm.kind === "email" ? "name@example.com" : blockedIdentForm.kind === "device" ? "৬৪ অক্ষরের hex হ্যাশ" : "203.0.113.10"} value={blockedIdentForm.value} onChange={(e) => setBlockedIdentForm({ ...blockedIdentForm, value: e.target.value })} />
                </label>
                <label className="text-sm">কারণ (ঐচ্ছিক)
                  <input className="input mt-1 w-52" placeholder="যেমন: বারবার ভুয়া অর্ডার" value={blockedIdentForm.reason} onChange={(e) => setBlockedIdentForm({ ...blockedIdentForm, reason: e.target.value })} />
                </label>
                <button type="button" className="btn-primary btn-sm" disabled={fraudPanelBusy !== "" || !blockedIdentForm.value.trim()} onClick={() => void addBlockedIdent()}>
                  {fraudPanelBusy === "ident-add" ? "যোগ হচ্ছে…" : "ব্লক করুন"}
                </button>
              </div>
              {blockedIdents.length === 0 ? (
                <p className="text-sm text-slate-400">কোনো ইমেইল/IP/ডিভাইস ব্লক করা নেই।</p>
              ) : (
                <ul className="space-y-1.5">
                  {blockedIdents.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span>
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-bold">{identifierKindLabel(b.kind)}</span>{" "}
                        <span className="font-mono font-medium">{b.value}</span>
                        {b.reason ? <span className="ml-2 text-slate-500">{b.reason}</span> : null}
                        <span className="block text-xs text-slate-400">ব্লক করা হয়েছে: {new Date(b.createdAt).toLocaleString("bn-BD")}</span>
                      </span>
                      <button type="button" className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50" disabled={fraudPanelBusy !== ""} onClick={() => void deleteBlockedIdent(b)}>
                        {fraudPanelBusy === `ident-del-${b.id}` ? "সরানো হচ্ছে…" : "সরিয়ে দিন"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              </>) : null}
              {identTab === "trusted" ? (<>
              <h3 className="font-semibold">✅ বিশ্বস্ত তালিকা</h3>
              <p className="text-xs text-slate-500">বিশ্বস্ত নম্বর fraud score, খোলা-অর্ডার ব্লক ও হার-সীমা থেকে মুক্ত — CAPTCHA থেকে নয়।</p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm">ধরন
                  <select className="input mt-1 w-28" value={trustedForm.kind} onChange={(e) => setTrustedForm({ ...trustedForm, kind: e.target.value })}>
                    <option value="phone">ফোন</option>
                    <option value="email">ইমেইল</option>
                    <option value="ip">IP</option>
                  </select>
                </label>
                <label className="text-sm">মান
                  <input className="input mt-1 w-52" placeholder="01XXXXXXXXX / name@example.com / IP" value={trustedForm.value} onChange={(e) => setTrustedForm({ ...trustedForm, value: e.target.value })} />
                </label>
                <label className="text-sm">কারণ (ঐচ্ছিক)
                  <input className="input mt-1 w-52" placeholder="যেমন: নিয়মিত ক্রেতা" value={trustedForm.reason} onChange={(e) => setTrustedForm({ ...trustedForm, reason: e.target.value })} />
                </label>
                <button type="button" className="btn-primary btn-sm" disabled={fraudPanelBusy !== "" || !trustedForm.value.trim()} onClick={() => void addTrustedIdent()}>
                  {fraudPanelBusy === "trusted-add" ? "যোগ হচ্ছে…" : "যোগ করুন"}
                </button>
              </div>
              {trustedIdents.length === 0 ? (
                <p className="text-sm text-slate-400">বিশ্বস্ত তালিকায় কিছু নেই।</p>
              ) : (
                <ul className="space-y-1.5">
                  {trustedIdents.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span>
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700">{identifierKindLabel(b.kind)}</span>{" "}
                        <span className="font-mono font-medium">{b.value}</span>
                        {b.reason ? <span className="ml-2 text-slate-500">{b.reason}</span> : null}
                        <span className="block text-xs text-slate-400">যোগ করা হয়েছে: {new Date(b.createdAt).toLocaleString("bn-BD")}</span>
                      </span>
                      <button type="button" className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50" disabled={fraudPanelBusy !== ""} onClick={() => void deleteTrustedIdent(b)}>
                        {fraudPanelBusy === `trusted-del-${b.id}` ? "সরানো হচ্ছে…" : "সরিয়ে দিন"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              </>) : null}
            </div>
            {/* GB3 (GC9): blocked attempts log (newest first, as served). */}
            <div className="mt-6 space-y-3 border-t pt-4">
              <h3 className="font-semibold">🧾 আটকানো চেষ্টা</h3>
              {fraudAttempts.length === 0 ? (
                <p className="text-sm text-slate-400">এখনো কোনো চেষ্টা আটকানো হয়নি।</p>
              ) : (
                <ul className="space-y-1.5">
                  {fraudAttempts.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span>
                        <span className="font-medium">{fraudAttemptKindLabel(a.kind)}</span>
                        <span className="ml-2 text-slate-500">{a.channel}</span>
                        {a.identifierSummary ? <span className="ml-2 font-mono text-xs text-slate-500">{a.identifierSummary}</span> : null}
                      </span>
                      <span className="text-xs text-slate-400">{new Date(a.createdAt).toLocaleString("bn-BD")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {/* GB3 (GC9): fraud rules */}
            <div className="mt-6 space-y-3 border-t pt-4">
              <h3 className="font-semibold">📏 নিয়ম</h3>
              {fraudRules.length === 0 ? (
                <p className="text-sm text-slate-400">কোনো নিয়ম তৈরি করা হয়নি।</p>
              ) : (
                <ul className="space-y-1.5">
                  {fraudRules.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span>
                        <span className="font-medium">{r.name}</span>
                        <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-bold">{FRAUD_RULE_ACTION_LABEL[r.action] ?? r.action}{r.action === "tag" && r.tagValue ? `: ${r.tagValue}` : ""}</span>
                        <span className="ml-2 text-xs text-slate-500">হিট: {r.hitCount}বার</span>
                        <span className="block font-mono text-[11px] text-slate-400">{JSON.stringify(r.conditions ?? {})}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-xs font-medium">
                          <input type="checkbox" checked={r.enabled} disabled={fraudPanelBusy !== ""} onChange={(e) => void toggleFraudRule(r, e.target.checked)} />
                          চালু
                        </label>
                        <button type="button" className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50" disabled={fraudPanelBusy !== ""} onClick={() => void deleteFraudRule(r)}>
                          {fraudPanelBusy === `rule-del-${r.id}` ? "মোছা হচ্ছে…" : "মুছুন"}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="space-y-2 rounded-xl border p-3">
                <div className="text-sm font-semibold">নতুন নিয়ম</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">নিয়মের নাম
                    <input className="input mt-1" value={ruleDraft.name} onChange={(e) => setRuleDraft({ ...ruleDraft, name: e.target.value })} placeholder="যেমন: বড় COD অর্ডার" />
                  </label>
                  <label className="text-sm">অ্যাকশন
                    <select className="input mt-1" value={ruleDraft.action} onChange={(e) => setRuleDraft({ ...ruleDraft, action: e.target.value })}>
                      <option value="hold">আটকাও (hold)</option>
                      <option value="tag">ট্যাগ (tag)</option>
                      <option value="block_checkout">checkout ব্লক (block_checkout)</option>
                    </select>
                  </label>
                  {ruleDraft.action === "tag" ? (
                    <label className="text-sm">ট্যাগের মান
                      <input className="input mt-1" value={ruleDraft.tagValue} onChange={(e) => setRuleDraft({ ...ruleDraft, tagValue: e.target.value })} placeholder="যেমন: সন্দেহজনক" />
                    </label>
                  ) : null}
                  <label className="text-sm">সর্বনিম্ন মোট (টাকা)
                    <input className="input mt-1" inputMode="decimal" value={ruleDraft.minTotalTaka} onChange={(e) => setRuleDraft({ ...ruleDraft, minTotalTaka: e.target.value })} placeholder="যেমন: 5000" />
                  </label>
                  <label className="text-sm">জেলা (কমা দিয়ে আলাদা)
                    <input className="input mt-1" value={ruleDraft.districtsText} onChange={(e) => setRuleDraft({ ...ruleDraft, districtsText: e.target.value })} placeholder="খুলনা, বরিশাল" />
                  </label>
                  <label className="text-sm">খোলা অর্ডার ≥
                    <input className="input mt-1" type="number" min={0} value={ruleDraft.phoneOpenOrdersGte} onChange={(e) => setRuleDraft({ ...ruleDraft, phoneOpenOrdersGte: e.target.value })} />
                  </label>
                  <label className="text-sm">সর্বনিম্ন risk score
                    <input className="input mt-1" type="number" min={0} value={ruleDraft.minRiskScore} onChange={(e) => setRuleDraft({ ...ruleDraft, minRiskScore: e.target.value })} />
                  </label>
                </div>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={ruleDraft.isCod} onChange={(e) => setRuleDraft({ ...ruleDraft, isCod: e.target.checked })} />
                  শুধু COD
                </label>
                <p className="text-[11px] text-slate-400">risk score শর্তটি অর্ডার তৈরি হওয়ার পরে যাচাই হয় — checkout ব্লক হয় না, hold/tag প্রযোজ্য হয়।</p>
                <button type="button" className="btn-primary btn-sm" disabled={fraudPanelBusy !== ""} onClick={() => void createFraudRule()}>
                  {fraudPanelBusy === "rule-add" ? "তৈরি হচ্ছে…" : "নিয়ম তৈরি করুন"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
