import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** The one inbox capability the sweep needs — typed structurally
 * so this service never imports InboxService (InboxModule imports
 * OrdersModule; a reverse import would cycle). AutomationService
 * passes its InboxService, which satisfies this shape. Same pattern
 * as CX12b's ReviewChatSender. */
export interface ChaseChatSender {
  sendAutomatedMessage(organizationId: string, conversationId: string, content: string, sourceTag: string): Promise<any>;
}

export interface ChaseSettings {
  enabled: boolean;
  firstDelayMinutes: number;
  intervalMinutes: number;
  maxAttempts: number;
  quietHoursRespect: boolean;
  quietStartHour: number;
  quietEndHour: number;
}

const DEFAULT_CHASE_SETTINGS: ChaseSettings = {
  enabled: false, firstDelayMinutes: 60, intervalMinutes: 240, maxAttempts: 3,
  quietHoursRespect: true, quietStartHour: 22, quietEndHour: 8,
};

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * CX7 — is `now` inside the chase quiet window in `timeZone`?
 * Pure helper. Hours are whole hours in the org's timezone.
 * - startHour === endHour means NO window (never quiet).
 * - startHour < endHour: quiet is [start, end) on the same day.
 * - startHour > endHour: overnight — quiet is [start, 24) ∪ [0, end)
 *   (e.g. 22 -> 8 covers 22:00 through 07:59 local).
 * An unreadable timezone degrades Asia/Dhaka -> UTC (the
 * ai-schedule.ts localPartsSafe discipline), never a throw.
 */
export function isChaseQuietHour(now: Date, timeZone: string, startHour: number, endHour: number): boolean {
  const start = clampInt(startHour, 22, 0, 23);
  const end = clampInt(endHour, 8, 0, 23);
  if (start === end) return false;
  const hour = localHourSafe(now, timeZone);
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

function localHour(at: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  return Number(parts.hour ?? 0) % 24;
}

function localHourSafe(at: Date, timeZone: string): number {
  try {
    return localHour(at, timeZone || "Asia/Dhaka");
  } catch {
    try { return localHour(at, "UTC"); } catch { return at.getUTCHours(); }
  }
}

/**
 * CX7 stop words. A customer who says one of these is never chased
 * again on this session. The matcher is deliberately conservative
 * ("whole-message-ish"): after trim + lowercase, the message must
 * EQUAL the phrase, or START with it, or END with it, with a
 * word boundary (end / whitespace / punctuation) on the joined
 * side for Latin phrases — so "stop" matches "stop", "stop please"
 * and "please stop", but not "stopwatch". Bengali phrases are
 * matched the same way (their boundaries are spaces/punctuation
 * in practice).
 */
export const CHASE_STOP_WORDS = ["থামুন", "থামান", "stop", "লাগবে না", "চাই না", "দরকার নেই"] as const;

const BOUNDARY_AFTER = /^[\s.,!?;:'"()\-—]/;
const BOUNDARY_BEFORE = /[\s.,!?;:'"()\-—]$/;

export function matchesChaseStopWord(text: string): boolean {
  // Trailing sentence punctuation (incl. the Bengali danda ।)
  // is stripped first: "দরকার নেই।" is the phrase "দরকার নেই".
  const t = String(text ?? "").trim().toLowerCase().replace(/[।.!?]+$/, "").trim();
  if (!t) return false;
  for (const raw of CHASE_STOP_WORDS) {
    const p = raw.toLowerCase();
    if (t === p) return true;
    if (t.startsWith(p)) {
      const rest = t.slice(p.length);
      if (rest === "" || BOUNDARY_AFTER.test(rest)) return true;
    }
    if (t.endsWith(p)) {
      const before = t.slice(0, t.length - p.length);
      if (before === "" || BOUNDARY_BEFORE.test(before)) return true;
    }
  }
  return false;
}

/** The chase nudge text. The product name comes ONLY from the
 * Product table (org-scoped) when session.data carries a
 * productId that resolves; anything else gets the generic text.
 * A price is never mentioned — never invented. */
export function chaseText(productName: string | null): string {
  const tail = "শেষ করতে চাইলে উত্তর দিন, আমরা সাহায্য করছি 🙂 আর মেসেজ না চাইলে “থামুন” লিখুন।";
  if (productName) return `আসসালামু আলাইকুম! আপনি “${productName}” অর্ডার করছিলেন — অর্ডারটি এখনো সম্পূর্ণ হয়নি। ${tail}`;
  return `আসসালামু আলাইকুম! আপনার অর্ডারটি এখনো সম্পূর্ণ হয়নি। ${tail}`;
}

/**
 * CX7 — "To Chase": gentle follow-up nudges to customers whose
 * order-bot session stalled before completion.
 *
 * Shape justification: one OrderChase row per BotSession
 * (sessionId UNIQUE). The session is the unit of stalling — it
 * owns the collected product/quantity/contact data and its
 * status IS the completion signal — so the chain hangs off the
 * session, not the conversation (a conversation can host several
 * sessions over time) and not an order (by definition there is
 * none yet; an order appearing is a stop condition).
 *
 * Honesty rules (CX12b discipline):
 * - Opt-in: chaseEnabled (InboxSetting, default OFF — this
 *   messages customers). Disabled = the sweep is a no-op.
 * - attempts counts CONFIRMED sends only: sendAutomatedMessage
 *   throws unless the platform confirmed, and only a confirmed
 *   send increments attempts + stamps lastChasedAt. A failed
 *   send stamps lastFailedAt and leaves the session eligible
 *   for the next sweep.
 * - Stop conditions are checked BEFORE any send, in the fixed
 *   order documented on runOrderChaseSweep, and recorded on the
 *   row. customer_replied is NOT terminal: it is a lastEvent
 *   trail entry and the reply becomes the new activity baseline.
 */
@Injectable()
export class OrderChaseService {
  private readonly logger = new Logger(OrderChaseService.name);

  constructor(private readonly prisma: PrismaService) {}

  private p(): any { return this.prisma as any; }

  async chaseSettings(organizationId: string): Promise<ChaseSettings> {
    // Defensive (ReviewsService pattern): a partial fake or a
    // stale generated client without the fields reads as
    // DISABLED — never a throw inside a sweep.
    try {
      const row = await this.p().inboxSetting?.findUnique({ where: { organizationId } }).catch(() => null);
      if (!row) return { ...DEFAULT_CHASE_SETTINGS };
      return {
        enabled: row.chaseEnabled === true,
        firstDelayMinutes: clampInt(row.chaseFirstDelayMinutes, 60, 15, 1440),
        intervalMinutes: clampInt(row.chaseIntervalMinutes, 240, 60, 2880),
        maxAttempts: clampInt(row.chaseMaxAttempts, 3, 1, 5),
        quietHoursRespect: row.chaseQuietHoursRespect !== false,
        quietStartHour: clampInt(row.chaseQuietStartHour, 22, 0, 23),
        quietEndHour: clampInt(row.chaseQuietEndHour, 8, 0, 23),
      };
    } catch { return { ...DEFAULT_CHASE_SETTINGS }; }
  }

  private async orgTimezone(organizationId: string): Promise<string> {
    try {
      const org = await this.p().organization?.findUnique?.({ where: { id: organizationId }, select: { timezone: true } })?.catch?.(() => null);
      return org?.timezone || "Asia/Dhaka";
    } catch { return "Asia/Dhaka"; }
  }

  /**
   * The order_chase_sweep job body.
   *
   * Candidates: BotSessions of THIS org with status "active"
   * whose updatedAt is older than chaseFirstDelayMinutes (the
   * bot bumps updatedAt whenever it processes a customer reply,
   * so updatedAt is the session-quiet clock), oldest first,
   * bounded at 100 per run.
   *
   * Per candidate, BEFORE any send, stop conditions in order
   * (the first hit wins and is recorded on the OrderChase row,
   * which is created lazily on first consideration):
   *   1. session no longer active (fresh re-read) -> session_ended
   *   2. an Order exists for this conversation (Order.conversationId
   *      is the chat-order pipeline's own linkage) -> completed
   *   3. conversation closed, OR autoReplyPaused (human handover),
   *      OR an outbound HUMAN message (direction "out",
   *      autoReply=false — sendAutomatedMessage always sets
   *      autoReply=true, so a non-autoReply outbound is an
   *      agent's send by construction) after session start
   *      -> human_took_over
   *   4. customer inbound after max(session start, lastChasedAt):
   *      a stop word -> stop_word; any other reply ->
   *      lastEvent="customer_replied", no send now; the reply is
   *      the new activity baseline, so the chain only becomes
   *      eligible again after a fresh quiet period measured from
   *      max(session.updatedAt, last inbound time) — firstDelay
   *      before the first chase, interval afterwards.
   *   5. attempts >= chaseMaxAttempts -> max_attempts
   *   6. quiet hours (when respected) -> skip silently
   *   7. interval since lastChasedAt not yet elapsed -> skip
   *
   * Returns { considered, sent, stopped, skipped, failed };
   * the early-outs add `skippedReason: "order_chase_disabled" |
   * "chase_sender_unavailable"` with all counts zero.
   */
  async runOrderChaseSweep(organizationId: string, sender?: ChaseChatSender, now: Date = new Date()) {
    const settings = await this.chaseSettings(organizationId);
    if (!settings.enabled) return { skippedReason: "order_chase_disabled", considered: 0, sent: 0, stopped: 0, skipped: 0, failed: 0 };
    if (!sender) return { skippedReason: "chase_sender_unavailable", considered: 0, sent: 0, stopped: 0, skipped: 0, failed: 0 };
    const tz = await this.orgTimezone(organizationId);
    const cutoff = new Date(now.getTime() - settings.firstDelayMinutes * 60000);
    const sessions = await (this.p().botSession?.findMany({
      where: { organizationId, status: "active", updatedAt: { lte: cutoff } },
      orderBy: { updatedAt: "asc" }, take: 100,
    }).catch(() => []) ?? []);
    let sent = 0; let stopped = 0; let skippedCount = 0; let failed = 0;
    for (const candidate of sessions) {
      try {
        const outcome = await this.processCandidate(organizationId, candidate, settings, tz, sender, now);
        if (outcome === "sent") sent++;
        else if (outcome === "stopped") stopped++;
        else if (outcome === "failed") failed++;
        else skippedCount++;
      } catch (e) {
        failed++;
        this.logger.warn(`order chase failed for session ${candidate?.id}: ${e instanceof Error ? e.message : "unknown"}`);
      }
    }
    return { considered: sessions.length, sent, stopped, skipped: skippedCount, failed };
  }

  private async ensureChaseRow(organizationId: string, session: any): Promise<any> {
    const existing = await this.p().orderChase?.findUnique({ where: { sessionId: session.id } }).catch(() => null);
    if (existing) return existing;
    try {
      return await this.p().orderChase.create({
        data: { organizationId, sessionId: session.id, conversationId: session.conversationId },
      });
    } catch {
      // Unique guard: a concurrent sweep created it first.
      return this.p().orderChase?.findUnique({ where: { sessionId: session.id } }).catch(() => null);
    }
  }

  private async stopChase(row: any, reason: string): Promise<"stopped"> {
    await this.p().orderChase.update({ where: { id: row.id }, data: { stoppedReason: reason } });
    return "stopped";
  }

  private async processCandidate(
    organizationId: string, candidate: any, settings: ChaseSettings, tz: string,
    sender: ChaseChatSender, now: Date,
  ): Promise<"sent" | "stopped" | "skipped" | "failed"> {
    const row = await this.ensureChaseRow(organizationId, candidate);
    if (!row) return "skipped";
    if (row.stoppedReason) return "skipped"; // already terminal — never revived

    // 1) Session ended (fresh re-read: the candidate list is a snapshot).
    const session = await this.p().botSession?.findUnique({ where: { id: candidate.id } }).catch(() => null);
    if (!session || session.status !== "active") return this.stopChase(row, "session_ended");
    const sessionStart = new Date(session.createdAt);

    // 2) Completed: the chat-order pipeline links its orders via
    // Order.conversationId — an order for this conversation means
    // the stall resolved into a purchase.
    const order = await this.p().order?.findFirst({
      where: { organizationId, conversationId: session.conversationId },
      select: { id: true },
    }).catch(() => null);
    if (order) return this.stopChase(row, "completed");

    // 3) Human took over: conversation closed, autopilot paused
    // for a human, or a human (non-autoReply) outbound send after
    // the session started.
    const conv = await this.p().channelConversation?.findFirst({
      where: { id: session.conversationId, organizationId },
    }).catch(() => null);
    if (!conv) return this.stopChase(row, "session_ended");
    // CX12a: practice conversations are never chased — the chase
    // nudge is a customer-facing send and practice has no customer.
    // Terminal stop, recorded on the chain like every other stop.
    if ((conv as any).isPractice) return this.stopChase(row, "practice");
    if (conv.status === "closed" || conv.autoReplyPaused === true) return this.stopChase(row, "human_took_over");
    const humanOut = await this.p().channelMessage?.findFirst({
      where: { conversationId: session.conversationId, direction: "out", autoReply: false, createdAt: { gte: sessionStart } },
    }).catch(() => null);
    if (humanOut) return this.stopChase(row, "human_took_over");

    // 4) Customer replies since the later of session start / last chase.
    const since = row.lastChasedAt && new Date(row.lastChasedAt).getTime() > sessionStart.getTime()
      ? new Date(row.lastChasedAt) : sessionStart;
    const inbound = await (this.p().channelMessage?.findMany({
      where: { conversationId: session.conversationId, direction: "in", createdAt: { gt: since } },
      orderBy: { createdAt: "asc" },
    }).catch(() => []) ?? []);
    if (inbound.length) {
      if (inbound.some((m: any) => matchesChaseStopWord(m.content ?? ""))) return this.stopChase(row, "stop_word");
      // Any other reply: non-terminal. Record the trail and treat
      // the reply as the new activity baseline — no send until a
      // fresh quiet period has passed since the latest activity.
      // (BotSession.updatedAt moves when the bot processes the
      // reply, which usually equals the reply time; the explicit
      // last-inbound term covers replies the bot did not consume.)
      const lastInboundAt = new Date(inbound[inbound.length - 1].createdAt);
      const baseline = Math.max(new Date(session.updatedAt).getTime(), lastInboundAt.getTime());
      const quietNeededMs = (row.attempts > 0 ? settings.intervalMinutes : settings.firstDelayMinutes) * 60000;
      await this.p().orderChase.update({ where: { id: row.id }, data: { lastEvent: "customer_replied" } }).catch(() => undefined);
      if (now.getTime() - baseline < quietNeededMs) return "skipped";
    }

    // 5) Attempt cap.
    if (row.attempts >= settings.maxAttempts) return this.stopChase(row, "max_attempts");

    // 6) Quiet hours — skip silently, no state change.
    if (settings.quietHoursRespect && isChaseQuietHour(now, tz, settings.quietStartHour, settings.quietEndHour)) return "skipped";

    // 7) Interval since the last confirmed chase.
    if (row.lastChasedAt && now.getTime() - new Date(row.lastChasedAt).getTime() < settings.intervalMinutes * 60000) return "skipped";
    // First-chase delay, defensively re-checked against the
    // session-quiet clock (the candidate query already filters
    // on it; a hand-built caller might not).
    if (row.attempts === 0 && now.getTime() - new Date(session.updatedAt).getTime() < settings.firstDelayMinutes * 60000) return "skipped";

    // Send. The product name is resolved from the Product table,
    // org-scoped; unresolved / absent -> generic text. No price,
    // ever.
    let productName: string | null = null;
    const productId = (session.data as any)?.productId;
    if (productId) {
      const product = await this.p().product?.findFirst({
        where: { id: productId, organizationId }, select: { name: true },
      }).catch(() => null);
      productName = product?.name ?? null;
    }
    try {
      await sender.sendAutomatedMessage(organizationId, session.conversationId, chaseText(productName), "order_chase");
    } catch (e) {
      // Failed-send rule: a throw means NO confirmed send — the
      // attempt is NOT consumed; stamp lastFailedAt and leave the
      // session eligible for the next sweep.
      await this.p().orderChase.update({ where: { id: row.id }, data: { lastFailedAt: now } }).catch(() => undefined);
      this.logger.warn(`order chase send failed for session ${session.id}: ${e instanceof Error ? e.message : "unknown"}`);
      return "failed";
    }
    await this.p().orderChase.update({
      where: { id: row.id },
      data: { attempts: row.attempts + 1, lastChasedAt: now },
    });
    return "sent";
  }

  /**
   * Tenant chase list (orders page "To Chase" section), newest
   * activity first. Chase RECORDS only — sessions that are
   * eligible but have never been considered by a sweep have no
   * row yet and are intentionally not listed (the sweep creates
   * the row on first consideration; inventing a row at read time
   * would misstate the chain's history). Enriched with the
   * session's live state/status and the collected product name
   * from the Product table when it resolves.
   */
  async listChases(organizationId: string) {
    const rows = await (this.p().orderChase?.findMany({
      where: { organizationId }, orderBy: { updatedAt: "desc" }, take: 200,
    }).catch(() => []) ?? []);
    if (!rows.length) return [];
    const sessionIds = [...new Set(rows.map((r: any) => r.sessionId))];
    const sessions = await (this.p().botSession?.findMany({
      where: { organizationId, id: { in: sessionIds } },
    }).catch(() => []) ?? []);
    const sessionById = new Map<string, any>(sessions.map((s: any) => [s.id, s] as [string, any]));
    const productIds = [...new Set(sessions.map((s: any) => (s.data as any)?.productId).filter(Boolean))];
    const products = productIds.length
      ? await (this.p().product?.findMany({ where: { organizationId, id: { in: productIds } }, select: { id: true, name: true } }).catch(() => []) ?? [])
      : [];
    const productById = new Map<string, string>(products.map((pr: any) => [pr.id, pr.name] as [string, string]));
    return rows.map((r: any) => {
      const s = sessionById.get(r.sessionId);
      const pid = (s?.data as any)?.productId;
      return {
        ...r,
        sessionState: s?.state ?? null,
        sessionStatus: s?.status ?? null,
        productName: pid ? (productById.get(pid) ?? null) : null,
      };
    });
  }
}
