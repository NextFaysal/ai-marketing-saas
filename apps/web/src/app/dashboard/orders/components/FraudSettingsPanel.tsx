"use client";
import React from "react";
import { fmtDateTime, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
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
  const { dict, t, locale } = useLocale();
  return (
    <>
      {fraudPanelOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={dict.orders.fraudProtection2}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{dict.orders.fraudProtection}</h2>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setFraudPanelOpen(false)}>{dict.orders.close}</button>
            </div>
            <p className="mt-1 text-xs text-slate-500">{dict.orders.everyNewOrderGetsA}</p>
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{dict.orders.theDeviceSignalIsWeak}</p>
            {fraudPanelError ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{fraudPanelError}</p> : null}
            {fraudPanelNotice ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{fraudPanelNotice}</p> : null}
            {!fraudSettings ? (
              <p className="mt-4 text-sm text-slate-400">{fraudPanelError ? dict.orders.settingsDidNotLoadReopen : dict.common.loading}</p>
            ) : (
              <div className="mt-4 space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={fraudSettings.enabled} onChange={(e) => setFraudSettings({ ...fraudSettings, enabled: e.target.checked })} />
                  {dict.orders.fraudCheckActive}</label>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={fraudSettings.autoHoldEnabled} onChange={(e) => setFraudSettings({ ...fraudSettings, autoHoldEnabled: e.target.checked })} />
                  {dict.orders.automaticHold}</label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">{dict.orders.holdAutomaticallyFromWhichRisk}<select className="input mt-1" value={fraudSettings.autoHoldBand} onChange={(e) => setFraudSettings({ ...fraudSettings, autoHoldBand: e.target.value })}>
                      <option value="medium">{dict.orders.fromMediumRisk}</option>
                      <option value="high">{dict.orders.highRiskOnly}</option>
                    </select>
                  </label>
                  <label className="text-sm">{dict.orders.largeOrderLimit}<input className="input mt-1" inputMode="decimal" placeholder={dict.orders.eG5000} value={fraudHighTaka} onChange={(e) => setFraudHighTaka(e.target.value)} />
                  </label>
                  <label className="text-sm">{dict.orders.burstHowManyOrdersLook}<input className="input mt-1" type="number" min={0} value={fraudSettings.burstCount} onChange={(e) => setFraudSettings({ ...fraudSettings, burstCount: Number(e.target.value) })} />
                  </label>
                  <label className="text-sm">{dict.orders.burstWindowHours}<input className="input mt-1" type="number" min={0} value={fraudSettings.burstWindowHours} onChange={(e) => setFraudSettings({ ...fraudSettings, burstWindowHours: Number(e.target.value) })} />
                  </label>
                </div>
                {/* GB3 (GC9): open-order policy + window */}
                <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
                  <label className="text-sm">{dict.orders.openOrderPolicy}<select className="input mt-1" value={fraudSettings.openOrderPolicy ?? "off"} onChange={(e) => setFraudSettings({ ...fraudSettings, openOrderPolicy: e.target.value })}>
                      <option value="off">{dict.orders.off2}</option>
                      <option value="warn">{dict.orders.warningHoldWarn}</option>
                      <option value="block">{dict.orders.block2}</option>
                    </select>
                  </label>
                  <label className="text-sm">{dict.orders.openOrderWindowHours}<input className="input mt-1" type="number" min={0} value={fraudSettings.openOrderWindowHours ?? 0} onChange={(e) => setFraudSettings({ ...fraudSettings, openOrderWindowHours: Number(e.target.value) })} />
                  </label>
                </div>
                {/* GB3 (GC9): rate limits (0 = off) */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">{dict.orders.rateLimitWaitBetweenTwo}<input className="input mt-1" type="number" min={0} value={fraudSettings.waitingPeriodMinutes ?? 0} onChange={(e) => setFraudSettings({ ...fraudSettings, waitingPeriodMinutes: Number(e.target.value) })} />
                  </label>
                  <label className="text-sm">{dict.orders.rateLimitMaxOrdersPer}<input className="input mt-1" type="number" min={0} value={fraudSettings.maxOrdersPerPhonePerDay ?? 0} onChange={(e) => setFraudSettings({ ...fraudSettings, maxOrdersPerPhonePerDay: Number(e.target.value) })} />
                  </label>
                </div>
                {/* GB3 (GC9): Cloudflare Turnstile CAPTCHA */}
                <div className="space-y-2 border-t pt-3">
                  <div className="text-sm font-semibold">CAPTCHA (Cloudflare Turnstile)</div>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={!!fraudSettings.captchaEnabled} onChange={(e) => setFraudSettings({ ...fraudSettings, captchaEnabled: e.target.checked })} />
                    {dict.orders.cAPTCHAOn}</label>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={!!fraudSettings.captchaOnCheckout} onChange={(e) => setFraudSettings({ ...fraudSettings, captchaOnCheckout: e.target.checked })} />
                    {dict.orders.cAPTCHAAtCheckout}</label>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={!!fraudSettings.captchaOnOtp} onChange={(e) => setFraudSettings({ ...fraudSettings, captchaOnOtp: e.target.checked })} />
                    {dict.orders.cAPTCHAOnOTPRequests}</label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">Turnstile Site Key
                      <input className="input mt-1" value={fraudSettings.turnstileSiteKey ?? ""} onChange={(e) => setFraudSettings({ ...fraudSettings, turnstileSiteKey: e.target.value })} placeholder="0x4AAAA…" />
                    </label>
                    <label className="text-sm">Turnstile Secret
                      <input className="input mt-1" type="password" autoComplete="new-password" value={turnstileSecret} onChange={(e) => setTurnstileSecret(e.target.value)} placeholder={fraudSettings.turnstileSecretSet ? dict.orders.setGiveANewSecret : dict.orders.enterSecret} />
                    </label>
                  </div>
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{dict.orders.ifCloudflareTurnstileIsOn}</p>
                </div>
                <button type="button" className="btn-primary btn-sm" disabled={fraudPanelBusy !== ""} onClick={() => void saveFraudSettings()}>
                  {fraudPanelBusy === "save" ? dict.orders.saving : dict.orders.saveSettings}
                </button>
              </div>
            )}
            {/* NF13 (FB5): platform fraud network opt-in card —
                self-contained; renders its honest explainer
                before the OWNER-only toggle. */}
            <FraudNetworkCard />
            <div className="mt-6 space-y-3 border-t pt-4">
              <div className="flex flex-wrap gap-2" role="tablist" aria-label={dict.orders.identifierLists}>
                {([["phone", dict.orders.phoneBlockPreviousList], ["blocked", dict.orders.emailIPDeviceBlock], ["trusted", dict.orders.trustedList]] as const).map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={identTab === key}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${identTab === key ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-600 ring-slate-200"}`}
                    onClick={() => setIdentTab(key)}>
                    {label}
                  </button>
                ))}
              </div>
              {identTab === "phone" ? (<>
              <h3 className="font-semibold">{dict.orders.blockedPhoneNumbers}</h3>
              <p className="text-xs text-slate-500">{dict.orders.ifAnOrderComesFrom}</p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm">{dict.orders.phoneNumber}<input className="input mt-1 w-44" placeholder="01XXXXXXXXX" value={blockForm.phone} onChange={(e) => setBlockForm({ ...blockForm, phone: e.target.value })} />
                </label>
                <label className="text-sm">{dict.orders.reasonOptional}<input className="input mt-1 w-52" placeholder={dict.orders.eGRepeatedFakeOrders} value={blockForm.reason} onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })} />
                </label>
                <button type="button" className="btn-primary btn-sm" disabled={fraudPanelBusy !== "" || !blockForm.phone.trim()} onClick={() => void addBlockedPhone()}>
                  {fraudPanelBusy === "block-add" ? dict.orders.adding : dict.orders.block}
                </button>
              </div>
              {blockedPhones.length === 0 ? (
                <p className="text-sm text-slate-400">{dict.orders.noNumbersBlocked}</p>
              ) : (
                <ul className="space-y-1.5">
                  {blockedPhones.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span>
                        <span className="font-mono font-medium">{b.phone}</span>
                        {b.reason ? <span className="ml-2 text-slate-500">{b.reason}</span> : null}
                        <span className="block text-xs text-slate-400">{dict.orders.blocked}{fmtDateTime(locale, new Date(b.createdAt))}</span>
                      </span>
                      <button type="button" className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50" disabled={fraudPanelBusy !== ""} onClick={() => void deleteBlockedPhone(b)}>
                        {fraudPanelBusy === `block-del-${b.id}` ? dict.orders.removing : dict.orders.remove2}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              </>) : null}
              {identTab === "blocked" ? (<>
              <h3 className="font-semibold">{dict.orders.emailIPDeviceBlocks}</h3>
              <p className="text-xs text-slate-500">{dict.orders.forDevicesGiveTheFull}</p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm">{dict.orders.type}<select className="input mt-1 w-36" value={blockedIdentForm.kind} onChange={(e) => setBlockedIdentForm({ ...blockedIdentForm, kind: e.target.value })}>
                    <option value="email">{dict.orders.email}</option>
                    <option value="ip">IP</option>
                    <option value="device">{dict.orders.deviceHash}</option>
                  </select>
                </label>
                <label className="text-sm">{dict.orders.value}<input className="input mt-1 w-52 font-mono" placeholder={blockedIdentForm.kind === "email" ? "name@example.com" : blockedIdentForm.kind === "device" ? dict.orders.text11n0vcb : "203.0.113.10"} value={blockedIdentForm.value} onChange={(e) => setBlockedIdentForm({ ...blockedIdentForm, value: e.target.value })} />
                </label>
                <label className="text-sm">{dict.orders.reasonOptional}<input className="input mt-1 w-52" placeholder={dict.orders.eGRepeatedFakeOrders} value={blockedIdentForm.reason} onChange={(e) => setBlockedIdentForm({ ...blockedIdentForm, reason: e.target.value })} />
                </label>
                <button type="button" className="btn-primary btn-sm" disabled={fraudPanelBusy !== "" || !blockedIdentForm.value.trim()} onClick={() => void addBlockedIdent()}>
                  {fraudPanelBusy === "ident-add" ? dict.orders.adding : dict.orders.block}
                </button>
              </div>
              {blockedIdents.length === 0 ? (
                <p className="text-sm text-slate-400">{dict.orders.noEmailIPDeviceBlocks}</p>
              ) : (
                <ul className="space-y-1.5">
                  {blockedIdents.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span>
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-bold">{identifierKindLabel(b.kind, locale)}</span>{" "}
                        <span className="font-mono font-medium">{b.value}</span>
                        {b.reason ? <span className="ml-2 text-slate-500">{b.reason}</span> : null}
                        <span className="block text-xs text-slate-400">{dict.orders.blocked}{fmtDateTime(locale, new Date(b.createdAt))}</span>
                      </span>
                      <button type="button" className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50" disabled={fraudPanelBusy !== ""} onClick={() => void deleteBlockedIdent(b)}>
                        {fraudPanelBusy === `ident-del-${b.id}` ? dict.orders.removing : dict.orders.remove2}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              </>) : null}
              {identTab === "trusted" ? (<>
              <h3 className="font-semibold">{dict.orders.trustedList2}</h3>
              <p className="text-xs text-slate-500">{dict.orders.trustedNumbersAreExemptFrom}</p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm">{dict.orders.type}<select className="input mt-1 w-28" value={trustedForm.kind} onChange={(e) => setTrustedForm({ ...trustedForm, kind: e.target.value })}>
                    <option value="phone">{dict.orders.phone}</option>
                    <option value="email">{dict.orders.email}</option>
                    <option value="ip">IP</option>
                  </select>
                </label>
                <label className="text-sm">{dict.orders.value}<input className="input mt-1 w-52" placeholder="01XXXXXXXXX / name@example.com / IP" value={trustedForm.value} onChange={(e) => setTrustedForm({ ...trustedForm, value: e.target.value })} />
                </label>
                <label className="text-sm">{dict.orders.reasonOptional}<input className="input mt-1 w-52" placeholder={dict.orders.eGRegularBuyer} value={trustedForm.reason} onChange={(e) => setTrustedForm({ ...trustedForm, reason: e.target.value })} />
                </label>
                <button type="button" className="btn-primary btn-sm" disabled={fraudPanelBusy !== "" || !trustedForm.value.trim()} onClick={() => void addTrustedIdent()}>
                  {fraudPanelBusy === "trusted-add" ? dict.orders.adding : dict.orders.add}
                </button>
              </div>
              {trustedIdents.length === 0 ? (
                <p className="text-sm text-slate-400">{dict.orders.nothingInTheTrustedList}</p>
              ) : (
                <ul className="space-y-1.5">
                  {trustedIdents.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span>
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700">{identifierKindLabel(b.kind, locale)}</span>{" "}
                        <span className="font-mono font-medium">{b.value}</span>
                        {b.reason ? <span className="ml-2 text-slate-500">{b.reason}</span> : null}
                        <span className="block text-xs text-slate-400">{dict.orders.added}{fmtDateTime(locale, new Date(b.createdAt))}</span>
                      </span>
                      <button type="button" className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50" disabled={fraudPanelBusy !== ""} onClick={() => void deleteTrustedIdent(b)}>
                        {fraudPanelBusy === `trusted-del-${b.id}` ? dict.orders.removing : dict.orders.remove2}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              </>) : null}
            </div>
            {/* GB3 (GC9): blocked attempts log (newest first, as served). */}
            <div className="mt-6 space-y-3 border-t pt-4">
              <h3 className="font-semibold">{dict.orders.blockedAttempts}</h3>
              {fraudAttempts.length === 0 ? (
                <p className="text-sm text-slate-400">{dict.orders.noAttemptsBlockedYet}</p>
              ) : (
                <ul className="space-y-1.5">
                  {fraudAttempts.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span>
                        <span className="font-medium">{fraudAttemptKindLabel(a.kind, locale)}</span>
                        <span className="ml-2 text-slate-500">{a.channel}</span>
                        {a.identifierSummary ? <span className="ml-2 font-mono text-xs text-slate-500">{a.identifierSummary}</span> : null}
                      </span>
                      <span className="text-xs text-slate-400">{fmtDateTime(locale, new Date(a.createdAt))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {/* GB3 (GC9): fraud rules */}
            <div className="mt-6 space-y-3 border-t pt-4">
              <h3 className="font-semibold">{dict.orders.rules}</h3>
              {fraudRules.length === 0 ? (
                <p className="text-sm text-slate-400">{dict.orders.noRulesCreated}</p>
              ) : (
                <ul className="space-y-1.5">
                  {fraudRules.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span>
                        <span className="font-medium">{r.name}</span>
                        <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-bold">{FRAUD_RULE_ACTION_LABEL[r.action] ?? r.action}{r.action === "tag" && r.tagValue ? `: ${r.tagValue}` : ""}</span>
                        <span className="ml-2 text-xs text-slate-500">{dict.orders.hits}{r.hitCount}{dict.orders.times}</span>
                        <span className="block font-mono text-[11px] text-slate-400">{JSON.stringify(r.conditions ?? {})}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-xs font-medium">
                          <input type="checkbox" checked={r.enabled} disabled={fraudPanelBusy !== ""} onChange={(e) => void toggleFraudRule(r, e.target.checked)} />
                          {dict.orders.on}</label>
                        <button type="button" className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50" disabled={fraudPanelBusy !== ""} onClick={() => void deleteFraudRule(r)}>
                          {fraudPanelBusy === `rule-del-${r.id}` ? dict.orders.deleting : dict.orders.delete}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="space-y-2 rounded-xl border p-3">
                <div className="text-sm font-semibold">{dict.orders.newRule}</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">{dict.orders.ruleName2}<input className="input mt-1" value={ruleDraft.name} onChange={(e) => setRuleDraft({ ...ruleDraft, name: e.target.value })} placeholder={dict.orders.eGLargeCODOrder} />
                  </label>
                  <label className="text-sm">{dict.orders.action}<select className="input mt-1" value={ruleDraft.action} onChange={(e) => setRuleDraft({ ...ruleDraft, action: e.target.value })}>
                      <option value="hold">{dict.orders.hold2}</option>
                      <option value="tag">{dict.orders.tag2}</option>
                      <option value="block_checkout">{dict.orders.checkoutBlockBlockCheckout}</option>
                    </select>
                  </label>
                  {ruleDraft.action === "tag" ? (
                    <label className="text-sm">{dict.orders.tagValue}<input className="input mt-1" value={ruleDraft.tagValue} onChange={(e) => setRuleDraft({ ...ruleDraft, tagValue: e.target.value })} placeholder={dict.orders.eGSuspicious} />
                    </label>
                  ) : null}
                  <label className="text-sm">{dict.orders.minimumTotalTaka}<input className="input mt-1" inputMode="decimal" value={ruleDraft.minTotalTaka} onChange={(e) => setRuleDraft({ ...ruleDraft, minTotalTaka: e.target.value })} placeholder={dict.orders.eG5000} />
                  </label>
                  <label className="text-sm">{dict.orders.districtsCommaSeparated2}<input className="input mt-1" value={ruleDraft.districtsText} onChange={(e) => setRuleDraft({ ...ruleDraft, districtsText: e.target.value })} placeholder={dict.orders.khulnaBarishal} />
                  </label>
                  <label className="text-sm">{dict.orders.openOrders}<input className="input mt-1" type="number" min={0} value={ruleDraft.phoneOpenOrdersGte} onChange={(e) => setRuleDraft({ ...ruleDraft, phoneOpenOrdersGte: e.target.value })} />
                  </label>
                  <label className="text-sm">{dict.orders.minimumRiskScore}<input className="input mt-1" type="number" min={0} value={ruleDraft.minRiskScore} onChange={(e) => setRuleDraft({ ...ruleDraft, minRiskScore: e.target.value })} />
                  </label>
                </div>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={ruleDraft.isCod} onChange={(e) => setRuleDraft({ ...ruleDraft, isCod: e.target.checked })} />
                  {dict.orders.cODOnly}</label>
                <p className="text-[11px] text-slate-400">{dict.orders.theRiskScoreConditionIs}</p>
                <button type="button" className="btn-primary btn-sm" disabled={fraudPanelBusy !== ""} onClick={() => void createFraudRule()}>
                  {fraudPanelBusy === "rule-add" ? dict.orders.creating : dict.orders.createRule}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
