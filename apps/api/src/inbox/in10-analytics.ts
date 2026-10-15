/**
 * IN10c: Inbox Analytics v2 — a PURE builder over real rows.
 *
 * Every number here is computed from rows the caller loaded from
 * the real tables (ChannelConversation / ChannelMessage / Order);
 * there is no stored aggregate and no estimate. Definitions are
 * fixed and stated so any figure can be re-derived with a raw
 * query over the same rows:
 *
 *  - Range: the last `days` x 24h ending at `now` (rolling, like
 *    the team report — not calendar days).
 *  - Heatmap / intents: INBOUND messages whose createdAt falls in
 *    the range, bucketed by the ORGANIZATION's timezone.
 *  - Channel conversion: per channel, `activeConversations` =
 *    conversations with lastMessageAt in range (createdAt when
 *    lastMessageAt is null); `convertedConversations` = how many
 *    of those have at least one non-cancelled chat-linked order
 *    (Order.conversationId) created in range;
 *    conversionPct = converted / active x 100 (null on 0 active).
 *  - Trend: one row per timezone day in the range, oldest first.
 *    avgFirstResponseMinutes averages (firstResponseAt - createdAt)
 *    over conversations CREATED that day that have a first
 *    response; avgResolutionMinutes averages (resolvedAt -
 *    createdAt) over conversations RESOLVED that day. Negative
 *    spans (clock noise in source data) are dropped, never
 *    averaged in. Averages are null when the day has no samples.
 *
 * Practice conversations are excluded by the caller AND here
 * (defense in depth). Scan caps are the caller's; the builder
 * reports how many rows it actually saw.
 */

export interface AnalyticsConversationRow {
  id: string;
  channel: string;
  customerId?: string | null;
  isPractice?: boolean | null;
  createdAt: Date | string;
  firstResponseAt?: Date | string | null;
  resolvedAt?: Date | string | null;
  lastMessageAt?: Date | string | null;
}

export interface AnalyticsMessageRow {
  conversationId: string;
  direction: string;
  intent?: string | null;
  createdAt: Date | string;
}

export interface AnalyticsOrderRow {
  conversationId?: string | null;
  status: string;
  createdAt: Date | string;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", hour12: false, weekday: "short",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

/** The day key (YYYY-MM-DD), hour (0-23) and weekday (0=Sun) of an
 * instant IN the given timezone. Exported for direct testing. */
export function tzParts(date: Date, tz: string): { dayKey: string; hour: number; weekday: number } {
  const parts = formatter(tz).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hourRaw = Number(get("hour"));
  return {
    dayKey: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number.isFinite(hourRaw) ? hourRaw % 24 : 0,
    weekday: WEEKDAYS[get("weekday")] ?? 0,
  };
}

const t = (v: Date | string | null | undefined): number => (v ? new Date(v).getTime() : NaN);
const round1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export function buildInboxAnalytics(input: {
  conversations: AnalyticsConversationRow[];
  messages: AnalyticsMessageRow[];
  orders: AnalyticsOrderRow[];
  days: number;
  now: Date;
  timezone: string;
}) {
  const { days, now, timezone } = input;
  const rangeStart = now.getTime() - days * 86400000;
  const inRange = (v: Date | string | null | undefined) => {
    const ms = t(v);
    return Number.isFinite(ms) && ms >= rangeStart && ms <= now.getTime();
  };
  const convs = (input.conversations ?? []).filter((c) => !c.isPractice);
  const convById = new Map(convs.map((c) => [c.id, c]));

  // --- Heatmap + intents (inbound messages in range) ----------
  const matrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  const hourTotals = Array(24).fill(0);
  const intentCounts = new Map<string, number>();
  let inboundTotal = 0;
  let classifiedTotal = 0;
  for (const m of input.messages ?? []) {
    if (m.direction !== "in" || !inRange(m.createdAt)) continue;
    if (!convById.has(m.conversationId)) continue;
    inboundTotal++;
    const p = tzParts(new Date(m.createdAt), timezone);
    matrix[p.weekday][p.hour]++;
    hourTotals[p.hour]++;
    if (m.intent) {
      classifiedTotal++;
      intentCounts.set(m.intent, (intentCounts.get(m.intent) ?? 0) + 1);
    }
  }
  let peakHour: { hour: number; count: number } | null = null;
  hourTotals.forEach((count, hour) => { if (count > 0 && (!peakHour || count > peakHour.count)) peakHour = { hour, count }; });
  let peakSlot: { weekday: number; hour: number; count: number } | null = null;
  matrix.forEach((row, weekday) => row.forEach((count, hour) => {
    if (count > 0 && (!peakSlot || count > peakSlot.count)) peakSlot = { weekday, hour, count };
  }));

  // --- Channel conversion --------------------------------------
  const orderConvIds = new Set<string>();
  let chatOrdersInRange = 0;
  for (const o of input.orders ?? []) {
    if (!o.conversationId || o.status === "cancelled" || !inRange(o.createdAt)) continue;
    if (!convById.has(o.conversationId)) continue;
    chatOrdersInRange++;
    orderConvIds.add(o.conversationId);
  }
  const byChannel = new Map<string, { channel: string; active: number; converted: number; started: number }>();
  const chanRow = (channel: string) => {
    const r = byChannel.get(channel) ?? { channel, active: 0, converted: 0, started: 0 };
    byChannel.set(channel, r);
    return r;
  };
  for (const c of convs) {
    const r = chanRow(c.channel);
    if (inRange(c.createdAt)) r.started++;
    if (inRange(c.lastMessageAt ?? c.createdAt)) {
      r.active++;
      if (orderConvIds.has(c.id)) r.converted++;
    }
  }
  const channels = [...byChannel.values()]
    .map((r) => ({
      channel: r.channel,
      activeConversations: r.active,
      convertedConversations: r.converted,
      conversationsStarted: r.started,
      conversionPct: r.active > 0 ? round1((r.converted / r.active) * 100) : null,
    }))
    .sort((a, b) => b.activeConversations - a.activeConversations);

  // --- Daily trend ----------------------------------------------
  const dayKeys: string[] = [];
  for (let i = days - 1; i >= 0; i--) dayKeys.push(tzParts(new Date(now.getTime() - i * 86400000), timezone).dayKey);
  const trend = dayKeys.map((dayKey) => {
    const created = convs.filter((c) => tzParts(new Date(c.createdAt), timezone).dayKey === dayKey);
    const resp = created
      .filter((c) => c.firstResponseAt)
      .map((c) => (t(c.firstResponseAt) - t(c.createdAt)) / 60000)
      .filter((m) => Number.isFinite(m) && m >= 0);
    const resolved = convs.filter((c) => c.resolvedAt && tzParts(new Date(c.resolvedAt), timezone).dayKey === dayKey);
    const res = resolved
      .map((c) => (t(c.resolvedAt) - t(c.createdAt)) / 60000)
      .filter((m) => Number.isFinite(m) && m >= 0);
    return {
      date: dayKey,
      newConversations: created.length,
      inboundMessages: 0, // filled below
      avgFirstResponseMinutes: avg(resp),
      resolvedCount: resolved.length,
      avgResolutionMinutes: avg(res),
    };
  });
  const trendByKey = new Map(trend.map((r) => [r.date, r]));
  for (const m of input.messages ?? []) {
    if (m.direction !== "in" || !inRange(m.createdAt) || !convById.has(m.conversationId)) continue;
    const row = trendByKey.get(tzParts(new Date(m.createdAt), timezone).dayKey);
    if (row) row.inboundMessages++;
  }

  const intents = [...intentCounts.entries()]
    .map(([intent, count]) => ({ intent, count, pct: classifiedTotal > 0 ? round1((count / classifiedTotal) * 100) : null }))
    .sort((a, b) => b.count - a.count);

  return {
    days, timezone, generatedAt: now.toISOString(),
    heatmap: { matrix, hourTotals, peakHour, peakSlot },
    channels,
    trend,
    intents,
    totals: {
      inboundMessages: inboundTotal,
      classifiedMessages: classifiedTotal,
      conversationsStarted: convs.filter((c) => inRange(c.createdAt)).length,
      chatOrders: chatOrdersInRange,
    },
    scan: { conversations: convs.length, messages: (input.messages ?? []).length },
  };
}
