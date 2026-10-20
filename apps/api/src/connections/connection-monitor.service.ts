import { createHash } from "node:crypto";
import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EmailProvider } from "../messaging/email.provider";
import { ConnectionsService } from "./connections.service";
import { ConnectionDoctorService, type DoctorTarget } from "./connection-doctor.service";
import { ProviderHealthService, whatsappQualityRank } from "./provider-health.service";
import { badRequest, notFound } from "../i18n";

/**
 * CC12 (Connect Center Advanced) — connection monitoring sweep +
 * alerts.
 *
 * The sweep is a per-org job (type "connection_health_sweep",
 * installed from the Automations template gallery like every
 * other sweep; see automation.service). Each run re-derives every
 * target's state from REAL stored fields — the same fields the
 * overview's health derivation reads (status / lastError /
 * tokenExpiresAt), plus the Integration row's EC2 webhookStatus
 * record and the recent SyncJob streak. Alerts are STATE-CHANGE
 * ONLY: ConnectionAlertState remembers the last alerted state per
 * target, so the same broken state never alerts twice; a return
 * to ok notifies exactly once ("recovered").
 *
 * Delivery honesty: the in-app ConnectionAlert row is always
 * written (plus AgentNotification rows for OWNER/ADMIN members,
 * the ad-spend-watchdog pattern); email goes through
 * EmailProvider and is counted ONLY per recipient for whom a
 * real message id came back — emailSentCount on the alert row is
 * that count, and a send failure is kept verbatim in emailError.
 * Email failing never fails the sweep and never un-creates the
 * in-app alert.
 */

export interface AlertPreferences {
  emailEnabled: boolean;
  categories: string[] | null; // null = all categories
  doctorEnabled: boolean;
  doctorIntervalHours: number;
}

export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  emailEnabled: true,
  categories: null,
  doctorEnabled: false,
  doctorIntervalHours: 24,
};

const CONNECTED = new Set(["CONNECTED", "connected", "ACTIVE", "active", "CONFIGURED"]);

export function dayBucket(expiresAt: Date | string | null, now: Date): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now.getTime();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/** Webhook breakage from the EC2 webhookStatus record: any
 * recorded topic/overall status that says failed/error/missing.
 * Absence of a record is NOT breakage (null summary). */
export function webhookSummary(webhookStatus: any): { bad: boolean; summary: string | null } {
  if (!webhookStatus || typeof webhookStatus !== "object") return { bad: false, summary: null };
  const statuses: string[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if (k === "status" && typeof v === "string") statuses.push(v);
      else if (v && typeof v === "object") walk(v);
    }
  };
  walk(webhookStatus);
  if (!statuses.length) return { bad: false, summary: null };
  const bad = statuses.some((s) => /fail|error|missing|not_registered/i.test(s));
  return { bad, summary: [...new Set(statuses)].sort().join(",") };
}

export interface FieldState { state: string; hash: string }

export function deriveFieldState(account: any, extras: { syncStreak: number; webhookBad: boolean; webhookSummary: string | null }, now = new Date()): FieldState {
  const status = String(account.status ?? "");
  let state: string;
  if (status && !CONNECTED.has(status)) state = "disconnected";
  else if (account.lastError || account.health === "error") state = "error";
  else if (extras.syncStreak >= 3) state = "sync_failing";
  else if (extras.webhookBad) state = "webhook_error";
  else if (account.expiringSoon) {
    const days = dayBucket(account.tokenExpiresAt, now);
    state = days !== null && days <= 1 ? "expiring_1" : days !== null && days <= 3 ? "expiring_3" : "expiring_7";
  } else state = "ok";
  const hashSource = {
    state,
    lastError: state === "error" ? String(account.lastError ?? "") : null,
    webhook: extras.webhookBad ? extras.webhookSummary : null,
    syncStreak: state === "sync_failing" ? extras.syncStreak : 0,
  };
  const hash = createHash("sha256").update(JSON.stringify(hashSource)).digest("hex").slice(0, 16);
  return { state, hash };
}

/** CC21: the healing seam (ConnectionHealingService in
 * production, bound via the CONNECTION_HEALING token in the
 * module so this file never imports it — the healing service
 * imports webhookSummary from HERE). */
export interface ConnectionHealingSeam {
  autoHealCommerceWebhooks(organizationId: string, now?: Date): Promise<{ attempted: number; healed: number; results: any[] }>;
  /** CC21a (B10.5): Meta long-lived-token exchange pass.
   * Optional on the seam so older stubs stay valid; the
   * production ConnectionHealingService implements it. */
  autoHealMetaTokens?(organizationId: string, now?: Date): Promise<{ attempted: number; healed: number; skippedNoAppCredentials: number; results: any[] }>;
}

/** CC23: the rejected-IPN kinds that count as anomalies.
 * A verified IPN records NO event (verified payloads live in
 * ipnPayload), so legitimate traffic can never be counted. */
export const IPN_ANOMALY_KINDS = ["signature_invalid", "amount_mismatch"] as const;
export const IPN_ANOMALY_THRESHOLD = 3;

export function countIpnAnomalies(txns: any[], sinceMs: number): { count: number; byKind: Record<string, number> } {
  const byKind: Record<string, number> = {};
  let count = 0;
  for (const txn of txns ?? []) {
    const events: any[] = Array.isArray(txn?.ipnEvents) ? txn.ipnEvents : [];
    for (const ev of events) {
      if (!ev || !(IPN_ANOMALY_KINDS as readonly string[]).includes(String(ev.kind))) continue;
      const at = new Date(ev.at ?? 0).getTime();
      if (!Number.isFinite(at) || at < sinceMs) continue;
      count++;
      byKind[String(ev.kind)] = (byKind[String(ev.kind)] ?? 0) + 1;
    }
  }
  return { count, byKind };
}

const STATE_TITLES: Record<string, string> = {
  disconnected: "কানেকশন বিচ্ছিন্ন অবস্থায় আছে",
  error: "কানেকশনে ত্রুটি দেখা দিয়েছে",
  sync_failing: "পরপর sync ব্যর্থ হচ্ছে",
  webhook_error: "Webhook subscription-এ সমস্যা ধরা পড়েছে",
  doctor_fail: "Connection Doctor-এর live পরীক্ষা ব্যর্থ হয়েছে",
};

@Injectable()
export class ConnectionMonitorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly connections: ConnectionsService,
    @Optional() private readonly doctor?: ConnectionDoctorService,
    @Optional() private readonly email?: EmailProvider,
    @Optional() private readonly providerHealth?: ProviderHealthService,
    @Optional() @Inject("CONNECTION_HEALING") private readonly healing?: ConnectionHealingSeam,
  ) {}

  private emailProvider(): EmailProvider {
    return this.email ?? new EmailProvider();
  }

  // ---------- preferences ----------

  async getPreferences(organizationId: string): Promise<AlertPreferences> {
    const row = await (this.prisma as any).connectionAlertPreference.findUnique({
      where: { organizationId },
    }).catch(() => null);
    if (!row) return { ...DEFAULT_ALERT_PREFERENCES };
    return {
      emailEnabled: row.emailEnabled !== false,
      categories: Array.isArray(row.categories) ? row.categories.map(String) : null,
      doctorEnabled: row.doctorEnabled === true,
      doctorIntervalHours: Number(row.doctorIntervalHours ?? 24) || 24,
    };
  }

  async updatePreferences(organizationId: string, actorId: string, dto: Partial<AlertPreferences>) {
    const data: Record<string, unknown> = {};
    if (dto.emailEnabled !== undefined) data.emailEnabled = dto.emailEnabled === true;
    if (dto.categories !== undefined) {
      if (dto.categories !== null && !Array.isArray(dto.categories)) throw badRequest("connections.categoriesMustBeArrayOrNull");
      data.categories = dto.categories === null ? null : dto.categories.map(String);
    }
    if (dto.doctorEnabled !== undefined) data.doctorEnabled = dto.doctorEnabled === true;
    if (dto.doctorIntervalHours !== undefined) {
      const hours = Number(dto.doctorIntervalHours);
      if (!Number.isFinite(hours) || hours < 1 || hours > 168) throw badRequest("connections.doctorIntervalRange");
      data.doctorIntervalHours = Math.floor(hours);
    }
    const existing = await (this.prisma as any).connectionAlertPreference.findUnique({
      where: { organizationId },
    }).catch(() => null);
    const row = existing
      ? await (this.prisma as any).connectionAlertPreference.update({ where: { id: existing.id }, data })
      : await (this.prisma as any).connectionAlertPreference.create({ data: { organizationId, ...data } });
    await this.audit.log({
      organizationId, userId: actorId, action: "connection.alert_preferences_updated",
      entityType: "ConnectionAlertPreference", entityId: row.id, metadata: { ...data },
    });
    return this.getPreferences(organizationId);
  }

  // ---------- alerts (read side) ----------

  async listAlerts(organizationId: string, opts: { unreadOnly?: boolean; limit?: number } = {}) {
    const rows = await (this.prisma as any).connectionAlert.findMany({
      where: { organizationId, ...(opts.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" }, take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
    }).catch(() => []);
    return { alerts: rows };
  }

  async unreadCount(organizationId: string): Promise<number> {
    const rows = await (this.prisma as any).connectionAlert.findMany({
      where: { organizationId, readAt: null }, select: { id: true },
    }).catch(() => []);
    return Array.isArray(rows) ? rows.length : 0;
  }

  async markAlertRead(organizationId: string, alertId: string) {
    const row = await (this.prisma as any).connectionAlert.findFirst({
      where: { id: alertId, organizationId },
    }).catch(() => null);
    if (!row) throw notFound("connections.alertNotFound");
    if (row.readAt) return row;
    return (this.prisma as any).connectionAlert.update({ where: { id: row.id }, data: { readAt: new Date() } });
  }

  async markAllAlertsRead(organizationId: string) {
    const rows = await (this.prisma as any).connectionAlert.findMany({
      where: { organizationId, readAt: null }, select: { id: true },
    }).catch(() => []);
    for (const r of rows ?? []) {
      await (this.prisma as any).connectionAlert.update({ where: { id: r.id }, data: { readAt: new Date() } }).catch(() => undefined);
    }
    return { marked: (rows ?? []).length };
  }

  // ---------- snooze ----------

  async snoozeTarget(organizationId: string, actorId: string, targetType: string, targetId: string, hours: number) {
    const target = await this.doctorTargetFor(organizationId, targetType, targetId);
    const targetKey = `${targetType}:${targetId}`;
    const existing = await (this.prisma as any).connectionAlertState.findFirst({
      where: { organizationId, targetKey },
    }).catch(() => null);
    const snoozedUntil = hours > 0 ? new Date(Date.now() + hours * 60 * 60 * 1000) : null;
    const data = {
      organizationId, targetKey, targetType, targetId,
      provider: target.provider, category: target.category, displayName: target.displayName,
      ...(existing ? {} : { state: "ok", stateHash: "" }),
      snoozedUntil,
    };
    const row = existing
      ? await (this.prisma as any).connectionAlertState.update({ where: { id: existing.id }, data })
      : await (this.prisma as any).connectionAlertState.create({ data });
    await this.audit.log({
      organizationId, userId: actorId, action: snoozedUntil ? "connection.alert_snoozed" : "connection.alert_unsnoozed",
      entityType: "ConnectionAlertState", entityId: row.id,
      metadata: { targetKey, hours },
    });
    return { targetKey, snoozedUntil: row.snoozedUntil ?? null };
  }

  private async doctorTargetFor(organizationId: string, targetType: string, targetId: string): Promise<DoctorTarget> {
    if (this.doctor) return this.doctor.findTarget(organizationId, targetType, targetId);
    const overview = await this.connections.getOverview(organizationId);
    for (const c of overview.categories) {
      const a = (c.accounts ?? []).find((x: any) => x.source === targetType && x.id === targetId);
      if (a) return { targetType, targetId, provider: a.provider, category: a.category, displayName: a.displayName };
    }
    throw notFound("connections.connectionTargetNotFound");
  }

  // ---------- the sweep ----------

  /**
   * One org's monitoring pass. Returns a run summary (the job
   * result). Never throws for a single bad target — a broken
   * target is exactly what this job exists to report.
   */
  async runSweep(organizationId: string) {
    const prefs = await this.getPreferences(organizationId);
    const overview = await this.connections.getOverview(organizationId);
    const accounts: any[] = overview.categories.flatMap((c: any) => c.accounts ?? []);
    const now = new Date();

    // Extras for integration-source targets: webhook record +
    // consecutive failed sync streak, from the real rows.
    const integrations = await (this.prisma as any).integration.findMany({
      where: { organizationId },
    }).catch(() => []);
    const integrationById = new Map<string, any>((integrations ?? []).map((i: any) => [i.id, i]));
    const streakByIntegration = new Map<string, number>();
    for (const integration of integrations ?? []) {
      const jobs = await (this.prisma as any).syncJob.findMany({
        where: { integrationId: integration.id }, orderBy: { startedAt: "desc" }, take: 3,
      }).catch(() => []);
      let streak = 0;
      for (const j of jobs ?? []) { if (String(j.status) === "FAILED") streak++; else break; }
      streakByIntegration.set(integration.id, streak);
    }

    let alertsCreated = 0;
    let doctorRuns = 0;
    let checked = 0;
    let whatsappRefreshes = 0;

    for (const account of accounts) {
      checked++;
      const targetType = String(account.source);
      const targetId = String(account.id);
      const targetKey = `${targetType}:${targetId}`;
      const existing = await (this.prisma as any).connectionAlertState.findFirst({
        where: { organizationId, targetKey },
      }).catch(() => null);
      // CC14: the sweep refreshes WhatsApp deep health for every
      // connected number — DATA only (the snapshot on the
      // Integration row; a failed fetch records its error there).
      // Snooze freezes alerts, not data, so this runs before the
      // snooze check; the quality-drop ALERT machine below runs
      // only for targets that are not snoozed.
      let waQuality: { previous: string | null; current: string | null } | null = null;
      if (this.providerHealth && targetType === "integration") {
        const integ = integrationById.get(targetId);
        if (integ?.provider === "whatsapp" && CONNECTED.has(String(account.status ?? ""))) {
          const r = await this.providerHealth.refreshWhatsAppHealth(organizationId, targetId).catch(() => null);
          if (r?.ok) {
            whatsappRefreshes++;
            waQuality = { previous: r.previousQualityRating, current: r.qualityRating };
          }
        }
      }

      // Snoozed: frozen — no state update, no notification. When
      // the snooze expires the frozen state is compared against
      // reality again, so a still-broken target alerts then.
      if (existing?.snoozedUntil && new Date(existing.snoozedUntil).getTime() > now.getTime()) continue;

      const integration = targetType === "integration" ? integrationById.get(targetId) : undefined;
      const wh = webhookSummary(integration?.webhookStatus);
      const { state, hash } = deriveFieldState(account, {
        syncStreak: integration ? (streakByIntegration.get(integration.id) ?? 0) : 0,
        webhookBad: wh.bad, webhookSummary: wh.summary,
      }, now);
      const categoryEnabled = !prefs.categories || prefs.categories.includes(String(account.category));

      let row = existing;
      const baseData = {
        organizationId, targetKey, targetType, targetId,
        provider: account.provider, category: account.category, displayName: account.displayName,
      };
      if (!row) {
        row = await (this.prisma as any).connectionAlertState.create({
          data: { ...baseData, state: "ok", stateHash: "" },
        });
      }

      // --- field-state machine ---
      const prevState = String(row.state ?? "ok");
      const prevHash = String(row.stateHash ?? "");
      let lastAlertAt = row.lastAlertAt ?? null;
      if (state === "ok" && prevState !== "ok") {
        if (categoryEnabled) {
          await this.notify(organizationId, baseData, {
            kind: "recovered", state: prevState, prefs,
            title: `কানেকশন আবার ঠিক হয়েছে: ${account.displayName}`,
            body: `“${account.displayName}” (${account.provider}) আবার স্বাভাবিক অবস্থায় ফিরেছে — আগের অবস্থা ছিল: ${prevState}।`,
          });
          alertsCreated++;
        }
        lastAlertAt = new Date();
      } else if (state !== "ok" && (state !== prevState || hash !== prevHash)) {
        if (categoryEnabled) {
          const expiring = state.startsWith("expiring_");
          await this.notify(organizationId, baseData, {
            kind: expiring ? "expiring" : "broke", state, prefs,
            title: expiring
              ? `টোকেনের মেয়াদ শেষ হতে চলেছে: ${account.displayName}`
              : `${STATE_TITLES[state] ?? "কানেকশনে সমস্যা"}: ${account.displayName}`,
            body: this.stateBody(account, state, wh.summary),
          });
          alertsCreated++;
        }
        lastAlertAt = new Date();
      }
      row = await (this.prisma as any).connectionAlertState.update({
        where: { id: row.id },
        data: { ...baseData, state, stateHash: hash, lastAlertAt },
      });

      // --- CC14 WhatsApp quality-drop machine ---
      if (waQuality) {
        alertsCreated += await this.processWhatsAppQuality(organizationId, baseData, waQuality, categoryEnabled, prefs);
      }

      // --- sweep doctor mini-machine (opt-in, conservative) ---
      if (prefs.doctorEnabled && this.doctor && ["integration", "store", "social_account"].includes(targetType)) {
        const lastRun = await (this.prisma as any).connectionHealthCheck.findFirst({
          where: { organizationId, targetType, targetId },
          orderBy: { createdAt: "desc" },
        }).catch(() => null);
        const due = !lastRun || (now.getTime() - new Date(lastRun.createdAt).getTime() >= prefs.doctorIntervalHours * 60 * 60 * 1000);
        if (due) {
          const target: DoctorTarget = { targetType, targetId, provider: account.provider, category: account.category, displayName: account.displayName };
          const run = await this.doctor.diagnoseTarget(organizationId, target, { runById: null, trigger: "sweep" }).catch(() => null);
          if (run) {
            doctorRuns++;
            const prevDoctor = row.doctorState ?? null;
            let doctorState = prevDoctor;
            if (run.overall === "fail" && prevDoctor !== "fail") {
              doctorState = "fail";
              if (categoryEnabled) {
                await this.notify(organizationId, baseData, {
                  kind: "broke", state: "doctor_fail", prefs,
                  title: `${STATE_TITLES.doctor_fail}: ${account.displayName}`,
                  body: `“${account.displayName}” (${account.provider})-এর live পরীক্ষায় ব্যর্থ ধাপ: ${run.steps.filter((s: any) => s.status === "fail").map((s: any) => `${s.label} — ${s.message}`).join("; ") || "বিস্তারিত কানেক্ট সেন্টারে"}`,
                });
                alertsCreated++;
              }
            } else if (run.overall === "pass" && prevDoctor === "fail") {
              doctorState = "pass";
              if (categoryEnabled) {
                await this.notify(organizationId, baseData, {
                  kind: "recovered", state: "doctor_fail", prefs,
                  title: `কানেকশন আবার ঠিক হয়েছে: ${account.displayName}`,
                  body: `“${account.displayName}” (${account.provider})-এর live পরীক্ষা এবার সম্পূর্ণ পাস করেছে।`,
                });
                alertsCreated++;
              }
            } else if (run.overall === "pass" || run.overall === "fail") {
              doctorState = run.overall;
            }
            // "partial" is inconclusive — it never moves the
            // doctor state machine.
            if (doctorState !== prevDoctor) {
              row = await (this.prisma as any).connectionAlertState.update({
                where: { id: row.id }, data: { doctorState },
              });
            }
          }
        }
      }
    }

    // --- CC21 auto-healing (commerce webhooks) ---
    // Runs after the state machines: the alert state above was
    // derived from the pre-heal records, so a heal that succeeds
    // shows up as a "recovered" transition on the NEXT sweep —
    // never as a heal that silently swallowed an alert.
    let healing = { attempted: 0, healed: 0 };
    if (this.healing) {
      const h = await this.healing.autoHealCommerceWebhooks(organizationId, now).catch(() => null);
      if (h) healing = { attempted: h.attempted, healed: h.healed };
    }

    // --- CC21a auto-healing (Meta token exchange, B10.5) ---
    // Same placement discipline as the webhook pass: after the
    // state machines, so a token healed in this run still shows
    // its pre-heal expiring alert from THIS sweep and surfaces
    // as "recovered" on the NEXT one — never silently swallowed.
    // skippedNoAppCredentials is part of the summary on purpose:
    // a target that could not even be attempted because neither
    // the tenant's own app nor the platform app yields
    // credentials is an honest, countable skip — not a silent
    // no-op.
    let metaTokenHealing = { attempted: 0, healed: 0, skippedNoAppCredentials: 0 };
    if (this.healing?.autoHealMetaTokens) {
      const m = await this.healing.autoHealMetaTokens(organizationId, now).catch(() => null);
      if (m) metaTokenHealing = { attempted: m.attempted, healed: m.healed, skippedNoAppCredentials: m.skippedNoAppCredentials ?? 0 };
    }

    // --- CC23 IPN anomaly watch ---
    let ipnAnomalies = 0;
    const anomaly = await this.checkIpnAnomalies(organizationId, prefs, now).catch(() => null);
    if (anomaly) {
      ipnAnomalies = anomaly.count;
      if (anomaly.alerted) alertsCreated++;
    }

    return { checked, alertsCreated, doctorRuns, whatsappRefreshes, healing, metaTokenHealing, ipnAnomalies, at: now };
  }

  /**
   * CC23 — rejected-IPN anomaly watch. Counts the org's
   * recorded ipnEvents (written by the CC23 IPN paths when a
   * notification fails signature verification or its
   * gateway-confirmed amount mismatches) over the last 24h.
   * At >= IPN_ANOMALY_THRESHOLD, ONE alert per org per day
   * fires through the same notify() delivery as every other
   * connection alert; the per-day dedupe is a REAL recorded
   * ConnectionAlertState row (state = "ipn_anomaly:<date>"),
   * not a process flag. Legitimate verified IPNs record no
   * events and can never trip this.
   */
  async checkIpnAnomalies(organizationId: string, prefs: AlertPreferences, now = new Date()): Promise<{ count: number; byKind: Record<string, number>; alerted: boolean }> {
    const since = now.getTime() - 24 * 60 * 60 * 1000;
    const txns = await (this.prisma as any).tenantPaymentTransaction.findMany({
      where: { organizationId, updatedAt: { gte: new Date(since) } },
      orderBy: { updatedAt: "desc" }, take: 500,
    }).catch(() => []);
    const { count, byKind } = countIpnAnomalies(txns ?? [], since);
    if (count < IPN_ANOMALY_THRESHOLD) return { count, byKind, alerted: false };

    const targetKey = `payment_security:${organizationId}`;
    const stateValue = `ipn_anomaly:${now.toISOString().slice(0, 10)}`;
    const existing = await (this.prisma as any).connectionAlertState.findFirst({
      where: { organizationId, targetKey },
    }).catch(() => null);
    if (existing && String(existing.state) === stateValue) return { count, byKind, alerted: false };

    const baseData = {
      targetKey, targetType: "payment_security", targetId: organizationId,
      provider: "payments", category: "payment", displayName: "পেমেন্ট গেটওয়ে (IPN নিরাপত্তা)",
    };
    const categoryEnabled = !prefs.categories || prefs.categories.includes("payment");
    let alerted = false;
    if (categoryEnabled) {
      await this.notify(organizationId, baseData, {
        kind: "broke", state: "ipn_anomaly", prefs,
        title: "সন্দেহজনক পেমেন্ট নোটিফিকেশন (IPN) ধরা পড়েছে",
        body: `গত ২৪ ঘণ্টায় ${count}টি পেমেন্ট নোটিফিকেশন যাচাইয়ে বাতিল হয়েছে (ভুয়া স্বাক্ষর: ${byKind.signature_invalid ?? 0}টি · পরিমাণ অমিল: ${byKind.amount_mismatch ?? 0}টি)। কোনো টাকাই এতে পেইড হয়নি — তবে কেউ আপনার গেটওয়েতে জাল নোটিফিকেশন পাঠানোর চেষ্টা করছে কিনা দেখুন। বিস্তারিত: কানেক্ট সেন্টারের পেমেন্ট লেনদেন ইতিহাস।`,
      });
      alerted = true;
    }
    const data = { organizationId, ...baseData, state: stateValue, stateHash: stateValue, ...(alerted ? { lastAlertAt: new Date() } : {}) };
    if (existing) {
      await (this.prisma as any).connectionAlertState.update({ where: { id: existing.id }, data }).catch(() => undefined);
    } else {
      await (this.prisma as any).connectionAlertState.create({ data }).catch(() => undefined);
    }
    return { count, byKind, alerted };
  }

  /**
   * CC14 — WhatsApp quality state machine. Its alert state lives
   * under a derived targetKey (`<target>#whatsapp_quality`) so
   * the CC12 dedup discipline applies unchanged: a drop alerts
   * exactly once, staying at the lower rating never re-alerts,
   * and a recovery after a recorded drop notifies once. Ratings
   * without a known rank (anything outside GREEN/YELLOW/RED) are
   * stored verbatim by the fetch but never move this machine —
   * no ordering is guessed for them. The fetch's own
   * previous/current pair is NOT trusted for alerting: the
   * comparison is against the last RECORDED rating here, so a
   * drop that happened across several sweeps still alerts once.
   */
  private async processWhatsAppQuality(
    organizationId: string,
    baseData: { targetKey: string; targetType: string; targetId: string; provider?: string | null; category?: string | null; displayName?: string | null },
    quality: { previous: string | null; current: string | null },
    categoryEnabled: boolean,
    prefs: AlertPreferences,
  ): Promise<number> {
    const current = quality.current;
    const currentRank = whatsappQualityRank(current);
    if (!current || currentRank === null) return 0;
    const qKey = `${baseData.targetKey}#whatsapp_quality`;
    const existing = await (this.prisma as any).connectionAlertState.findFirst({
      where: { organizationId, targetKey: qKey },
    }).catch(() => null);
    if (!existing) {
      await (this.prisma as any).connectionAlertState.create({
        data: {
          organizationId, targetKey: qKey, targetType: baseData.targetType, targetId: baseData.targetId,
          provider: baseData.provider ?? null, category: baseData.category ?? null, displayName: baseData.displayName ?? null,
          state: current, stateHash: `${current}:0`,
        },
      }).catch(() => undefined);
      return 0;
    }
    const prev = String(existing.state ?? "");
    const prevRank = whatsappQualityRank(prev);
    const dropped = String(existing.stateHash ?? "").endsWith(":1");
    let created = 0;
    let nextHash = `${current}:${dropped ? 1 : 0}`;
    if (prevRank !== null && currentRank < prevRank) {
      if (categoryEnabled) {
        await this.notify(organizationId, baseData, {
          kind: "broke", state: "whatsapp_quality_drop", prefs,
          title: `WhatsApp নম্বরের quality কমেছে: ${baseData.displayName}`,
          body: `“${baseData.displayName}” নম্বরের quality rating ${prev} থেকে কমে ${current} হয়েছে। Quality আরও কমলে Meta messaging limit কমিয়ে দিতে পারে — কানেক্ট সেন্টারে নম্বরের health দেখুন।`,
        });
        created++;
      }
      nextHash = `${current}:1`;
    } else if (prevRank !== null && currentRank > prevRank) {
      if (dropped && categoryEnabled) {
        await this.notify(organizationId, baseData, {
          kind: "recovered", state: "whatsapp_quality_drop", prefs,
          title: `WhatsApp নম্বরের quality আবার বেড়েছে: ${baseData.displayName}`,
          body: `“${baseData.displayName}” নম্বরের quality rating ${prev} থেকে বেড়ে ${current} হয়েছে।`,
        });
        created++;
      }
      nextHash = `${current}:0`;
    }
    if (prev !== current || String(existing.stateHash ?? "") !== nextHash) {
      await (this.prisma as any).connectionAlertState.update({
        where: { id: existing.id },
        data: { state: current, stateHash: nextHash, ...(created ? { lastAlertAt: new Date() } : {}) },
      }).catch(() => undefined);
    }
    return created;
  }

  private stateBody(account: any, state: string, webhookDetail: string | null): string {
    const name = `“${account.displayName}” (${account.provider})`;
    switch (state) {
      case "disconnected": return `${name} DISCONNECTED অবস্থায় পাওয়া গেছে। কানেক্ট সেন্টার থেকে আবার কানেক্ট করুন।`;
      case "error": return `${name}-তে ত্রুটি রেকর্ড হয়েছে${account.lastError ? `: ${account.lastError}` : ""}। কানেক্ট সেন্টারে বিস্তারিত দেখুন।`;
      case "sync_failing": return `${name}-এর পরপর অন্তত ৩টি sync ব্যর্থ হয়েছে। কানেক্ট সেন্টারের টাইমলাইনে sync ইতিহাস দেখুন।`;
      case "webhook_error": return `${name}-এর webhook subscription অবস্থা: ${webhookDetail ?? "সমস্যা"}।`;
      default: {
        const days = dayBucket(account.tokenExpiresAt, new Date());
        return `${name}-এর টোকেনের মেয়াদ ${days !== null ? `প্রায় ${days} দিনের মধ্যে` : "শীঘ্রই"} শেষ হবে। মেয়াদ শেষ হওয়ার আগেই আবার কানেক্ট করুন।`;
      }
    }
  }

  /**
   * Deliver one alert: the in-app ConnectionAlert row (always),
   * AgentNotification rows for OWNER/ADMIN members (the existing
   * in-app surface), and email via EmailProvider counted ONLY by
   * real message ids.
   */
  private async notify(
    organizationId: string,
    target: { targetKey: string; targetType: string; targetId: string; provider?: string | null; category?: string | null; displayName?: string | null },
    input: { kind: string; state: string; title: string; body: string; prefs: AlertPreferences },
  ) {
    const alert = await (this.prisma as any).connectionAlert.create({
      data: {
        organizationId, targetKey: target.targetKey, targetType: target.targetType, targetId: target.targetId,
        provider: target.provider ?? null, category: target.category ?? null, displayName: target.displayName ?? null,
        kind: input.kind, state: input.state, title: input.title, body: input.body,
      },
    });
    const memberships = await (this.prisma as any).membership.findMany({
      where: { organizationId, status: "ACTIVE" },
      include: { user: true },
    }).catch(() => []);
    const recipients = (memberships ?? []).filter((m: any) => ["OWNER", "ADMIN"].includes(m.role));
    for (const m of recipients) {
      await (this.prisma as any).agentNotification.create({
        data: { organizationId, userId: m.userId, type: "connection_alert", title: input.title, body: input.body, conversationId: null },
      }).catch(() => undefined);
    }
    let emailSentCount = 0;
    let emailError: string | null = null;
    if (input.prefs.emailEnabled) {
      const provider = this.emailProvider();
      for (const m of recipients) {
        const to = m.user?.email;
        if (!to) continue;
        try {
          const res = await provider.send({ to, subject: input.title, text: input.body });
          if (res?.providerMessageId) emailSentCount++;
        } catch (e) {
          emailError = e instanceof Error ? e.message : String(e);
        }
      }
      // Always recorded — including the 0 case: a provider that
      // returned no message id sent nothing, and the row says so.
      await (this.prisma as any).connectionAlert.update({
        where: { id: alert.id }, data: { emailSentCount, emailError },
      }).catch(() => undefined);
      alert.emailSentCount = emailSentCount;
      alert.emailError = emailError;
    }
    await this.audit.log({
      organizationId, action: "connection.alert",
      entityType: "ConnectionAlert", entityId: alert.id,
      metadata: { targetKey: target.targetKey, kind: input.kind, state: input.state, emailSentCount, recipients: recipients.length },
    }).catch(() => undefined);
    return alert;
  }
}
