/**
 * MX2 — Smart Channel Routing & Fallback Cascade: the PURE
 * core. No Prisma, no providers, no I/O in this file — every
 * function takes plain data in and returns plain data out, so
 * the routing rules (org order, preferred channel, cheapest-
 * first, circuit breaker, report breakdown) are pinned by unit
 * specs exactly as shipped (delivery-report.ts precedent).
 *
 * Honesty rules baked in here:
 * - Cheapest-first uses ONLY org-entered rates. A missing rate
 *   for any cascade channel means the org order is kept AND
 *   the caller is told (`missingRates`) — never a silent choice
 *   and never an invented price.
 * - A recipient with no engagement history has NO preferred
 *   channel (null) — the org order decides, exactly as if
 *   smart routing were off for them.
 */

export type CascadeChannel = "email" | "sms" | "whatsapp";
export const CASCADE_CHANNELS: readonly CascadeChannel[] = ["email", "sms", "whatsapp"];

export interface CascadeConfig {
  /** Fallback on per-recipient failure is active. */
  enabled: boolean;
  /** The channels this broadcast may use, in the ORG's order.
   * Always includes the broadcast's primary channel. */
  channels: CascadeChannel[];
  /** When true, a recipient's attempt order starts with their
   * most-engaged channel (see preferredChannel). */
  smartRouting: boolean;
  /** "org" = the org's order (default). "cheapest" = order by
   * the org-entered per-message rates, falling back to org
   * order with an explicit note when any rate is missing. */
  ordering: "org" | "cheapest";
  /** Per-channel content for cascade channels that are NOT the
   * broadcast's primary channel (the primary channel uses the
   * broadcast's own subject/body/whatsappTemplateId). A cascade
   * channel without content here (and not the primary) is
   * skipped for the whole broadcast with the reason recorded —
   * never a free-form substitute. */
  smsBody?: string;
  emailSubject?: string;
  emailBody?: string;
  whatsappTemplateId?: string;
}

/** Validate + normalize a raw cascade input (from the create
 * DTO). Returns the config, or throws an Error whose message is
 * the client-facing 400 text (the service wraps it). A null /
 * undefined input returns null — no cascade, the broadcast
 * behaves exactly as pre-MX2. `enabled: false` also normalizes
 * to null: a disabled cascade is not stored, so no later code
 * path has to re-check the flag. */
export function parseCascadeConfig(raw: unknown, primaryChannel: string): CascadeConfig | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("cascade must be an object");
  const r = raw as Record<string, unknown>;
  if (r.enabled !== true) return null;
  const rawChannels = r.channels;
  if (!Array.isArray(rawChannels) || !rawChannels.length) {
    throw new Error("cascade.channels must be a non-empty array of channels (email, sms, whatsapp)");
  }
  const channels: CascadeChannel[] = [];
  for (const c of rawChannels) {
    if (!(CASCADE_CHANNELS as readonly string[]).includes(String(c))) {
      throw new Error(`cascade channel must be email, sms or whatsapp (got ${String(c)})`);
    }
    const ch = c as CascadeChannel;
    if (!channels.includes(ch)) channels.push(ch);
  }
  if (!(channels as string[]).includes(primaryChannel)) {
    throw new Error(`cascade.channels must include the broadcast's primary channel (${primaryChannel})`);
  }
  if (channels.length < 2) {
    throw new Error("cascade needs at least two channels — a single-channel broadcast needs no cascade");
  }
  const ordering = r.ordering === undefined ? "org" : r.ordering;
  if (ordering !== "org" && ordering !== "cheapest") {
    throw new Error('cascade.ordering must be "org" or "cheapest"');
  }
  const str = (v: unknown): string | undefined => {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    return s ? s : undefined;
  };
  return {
    enabled: true,
    channels,
    smartRouting: r.smartRouting === true,
    ordering,
    ...(str(r.smsBody) ? { smsBody: str(r.smsBody) } : {}),
    ...(str(r.emailSubject) ? { emailSubject: str(r.emailSubject) } : {}),
    ...(str(r.emailBody) ? { emailBody: str(r.emailBody) } : {}),
    ...(str(r.whatsappTemplateId) ? { whatsappTemplateId: str(r.whatsappTemplateId) } : {}),
  };
}

/** Read a STORED cascade config (Broadcast.cascadeConfig) back.
 * Stored values were validated at create; anything malformed
 * reads as null (no cascade) rather than crashing a send. */
export function readCascadeConfig(stored: unknown, primaryChannel: string): CascadeConfig | null {
  if (!stored || typeof stored !== "object") return null;
  try {
    return parseCascadeConfig(stored, primaryChannel);
  } catch {
    return null;
  }
}

// ---------- Preferred channel (smart routing) ----------

export interface ChannelEngagement {
  channel: CascadeChannel;
  /** Confirmed (status "sent") deliveries to this recipient. */
  sent: number;
  /** Real engagement events on those deliveries: openedAt /
   * readAt / deliveryStatus read|delivered, plus link clicks
   * attributed to a delivery's broadcast. */
  engaged: number;
}

/**
 * The recipient's most-engaged channel, deterministically:
 * highest `engaged` wins; ties break by ORG cascade order
 * (the earlier channel in `orgOrder` wins). No history at all
 * (no stats, or every channel at engaged 0) → null, meaning
 * "no preference — use the org order".
 */
export function preferredChannel(stats: ChannelEngagement[], orgOrder: CascadeChannel[]): CascadeChannel | null {
  let best: CascadeChannel | null = null;
  let bestEngaged = 0;
  for (const ch of orgOrder) {
    const s = stats.find((x) => x.channel === ch);
    const engaged = s?.engaged ?? 0;
    if (engaged > bestEngaged) {
      best = ch;
      bestEngaged = engaged;
    }
  }
  return best;
}

/** Build per-channel engagement stats from plain delivery rows
 * (+ the set of broadcast ids this recipient clicked in), so
 * the service gathers rows and this stays spec-pure. Only
 * confirmed-sent deliveries count — a failed attempt is not
 * engagement. */
export function engagementStats(
  deliveries: { channel: string; status: string; broadcastId?: string | null; openedAt?: unknown; readAt?: unknown; deliveryStatus?: string | null }[],
  clickedBroadcastIds: ReadonlySet<string>,
): ChannelEngagement[] {
  const byChannel = new Map<CascadeChannel, ChannelEngagement>();
  for (const d of deliveries) {
    if (d.status !== "sent") continue;
    if (!(CASCADE_CHANNELS as readonly string[]).includes(d.channel)) continue;
    const ch = d.channel as CascadeChannel;
    const row = byChannel.get(ch) ?? { channel: ch, sent: 0, engaged: 0 };
    row.sent++;
    const engaged =
      Boolean(d.openedAt) || Boolean(d.readAt) ||
      d.deliveryStatus === "read" || d.deliveryStatus === "delivered" ||
      (d.broadcastId != null && clickedBroadcastIds.has(String(d.broadcastId)));
    if (engaged) row.engaged++;
    byChannel.set(ch, row);
  }
  return [...byChannel.values()];
}

// ---------- Cheapest-first ----------

export interface CheapestResult {
  order: CascadeChannel[];
  /** Channels whose org-entered rate was missing. Non-empty ⇒
   * `order` IS the org order (the honest fallback), and the
   * caller must surface this — never silently reorder. */
  missingRates: CascadeChannel[];
}

/** Order channels by org-entered per-message rates (minor
 * units). Any null/undefined rate for a cascade channel →
 * org order unchanged + the missing channels named. Equal
 * rates keep org order (stable). */
export function cheapestFirstOrder(
  orgOrder: CascadeChannel[],
  ratesMinorPerMessage: Partial<Record<CascadeChannel, number | null | undefined>>,
): CheapestResult {
  const missingRates = orgOrder.filter((ch) => {
    const r = ratesMinorPerMessage[ch];
    return r === null || r === undefined || !Number.isFinite(Number(r));
  });
  if (missingRates.length) return { order: [...orgOrder], missingRates };
  const order = [...orgOrder].sort(
    (a, b) => Number(ratesMinorPerMessage[a]) - Number(ratesMinorPerMessage[b]),
  );
  return { order, missingRates: [] };
}

// ---------- Attempt order resolution ----------

export interface AttemptOrderResult {
  order: CascadeChannel[];
  /** Set when ordering="cheapest" but rates were missing (org
   * order kept). */
  ratesMissing: CascadeChannel[];
  /** The preferred channel that was moved first, if any. */
  preferredApplied: CascadeChannel | null;
}

/** The ONE place a recipient's attempt order is decided:
 * base order (org, or cheapest when rates allow) → smart
 * routing moves the recipient's preferred channel first. */
export function resolveAttemptOrder(input: {
  config: CascadeConfig;
  ratesMinorPerMessage?: Partial<Record<CascadeChannel, number | null | undefined>>;
  engagement?: ChannelEngagement[];
}): AttemptOrderResult {
  let order = [...input.config.channels];
  let ratesMissing: CascadeChannel[] = [];
  if (input.config.ordering === "cheapest") {
    const res = cheapestFirstOrder(order, input.ratesMinorPerMessage ?? {});
    order = res.order;
    ratesMissing = res.missingRates;
  }
  let preferredApplied: CascadeChannel | null = null;
  if (input.config.smartRouting && input.engagement) {
    const pref = preferredChannel(input.engagement, input.config.channels);
    if (pref && order[0] !== pref) {
      order = [pref, ...order.filter((c) => c !== pref)];
      preferredApplied = pref;
    } else if (pref) {
      preferredApplied = pref;
    }
  }
  return { order, ratesMissing, preferredApplied };
}

// ---------- SMS gateway circuit breaker ----------

/** MX2: after this many CONSECUTIVE provider failures, a SMS
 * gateway is skipped for the rest of the broadcast run. A
 * success resets that gateway's counter. */
export const SMS_CIRCUIT_BREAKER_THRESHOLD = 5;

export interface SmsBreakerEvent {
  gatewayKey: string;
  failures: number;
  at: string;
}

/** Per-run circuit breaker state for SMS gateways. Pure
 * in-memory state — one instance per broadcast process run. */
export class SmsCircuitBreaker {
  private consecutive = new Map<string, number>();
  private open = new Set<string>();
  readonly events: SmsBreakerEvent[] = [];

  isOpen(gatewayKey: string): boolean {
    return this.open.has(gatewayKey);
  }

  recordSuccess(gatewayKey: string): void {
    this.consecutive.set(gatewayKey, 0);
  }

  /** Returns true when this failure TRIPPED the breaker. */
  recordFailure(gatewayKey: string): boolean {
    const n = (this.consecutive.get(gatewayKey) ?? 0) + 1;
    this.consecutive.set(gatewayKey, n);
    if (n >= SMS_CIRCUIT_BREAKER_THRESHOLD && !this.open.has(gatewayKey)) {
      this.open.add(gatewayKey);
      this.events.push({ gatewayKey, failures: n, at: new Date().toISOString() });
      return true;
    }
    return false;
  }
}

// ---------- Report breakdown ----------

export interface CascadeChannelBreakdown {
  channel: string;
  attempts: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Recipients whose FINAL attempt (highest attemptIndex in
   * their chain) was on this channel and succeeded. */
  finalSuccesses: number;
}

export interface CascadeBreakdown {
  channels: CascadeChannelBreakdown[];
  /** Per-recipient chains, in delivery order: the linked
   * attempts of one recipient (recipientRowId when present,
   * else the MS7 recipient key) with each attempt's channel +
   * outcome. Capped by the caller when serializing. */
  chains: {
    key: string;
    attempts: { channel: string; status: string; attemptIndex: number | null; error: string | null }[];
    finalChannel: string | null;
    finalStatus: string;
  }[];
}

/** Group delivery rows into per-channel attempt counts and
 * per-recipient chains. The chain key is the MX2 linking
 * field (`recipientRowId`) when the row carries one, falling
 * back to the MS7 delivery recipient key for legacy rows. */
export function cascadeBreakdown(deliveries: {
  channel: string; status: string; error?: string | null;
  recipientType: string; recipientId?: string | null; address: string;
  recipientRowId?: string | null; attemptIndex?: number | null;
}[]): CascadeBreakdown {
  const byChannel = new Map<string, CascadeChannelBreakdown>();
  const byKey = new Map<string, { channel: string; status: string; attemptIndex: number | null; error: string | null }[]>();
  for (const d of deliveries) {
    const c = byChannel.get(d.channel) ?? { channel: d.channel, attempts: 0, sent: 0, failed: 0, skipped: 0, finalSuccesses: 0 };
    c.attempts++;
    if (d.status === "sent") c.sent++;
    else if (d.status === "failed") c.failed++;
    else if (d.status === "skipped") c.skipped++;
    byChannel.set(d.channel, c);
    const key = d.recipientRowId
      ? `row:${d.recipientRowId}`
      : d.recipientId
        ? `${d.recipientType}:${d.recipientId}`
        : `${d.recipientType}:${d.address}`;
    const list = byKey.get(key) ?? [];
    list.push({ channel: d.channel, status: d.status, attemptIndex: d.attemptIndex ?? null, error: d.error ?? null });
    byKey.set(key, list);
  }
  const chains: CascadeBreakdown["chains"] = [];
  for (const [key, attempts] of byKey) {
    const sorted = [...attempts].sort((a, b) => (a.attemptIndex ?? 0) - (b.attemptIndex ?? 0));
    const last = sorted[sorted.length - 1];
    chains.push({
      key,
      attempts: sorted,
      finalChannel: last?.channel ?? null,
      finalStatus: last?.status ?? "unknown",
    });
    if (last && last.status === "sent") {
      const c = byChannel.get(last.channel);
      if (c) c.finalSuccesses++;
    }
  }
  return { channels: [...byChannel.values()], chains };
}
