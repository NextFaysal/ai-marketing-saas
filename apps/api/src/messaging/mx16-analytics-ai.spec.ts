process.env.JWT_SECRET = "test-secret";
process.env.WEB_URL = "https://app.example.com";
process.env.API_PUBLIC_URL = "https://api.example.com";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { MessagingService } from "./messaging.service";
import {
  AUTO_WINNER_MIN_SAMPLE, aggregateFunnels, buildAnalyticsCsv, decideAutoWinner,
  recipientSendTimeFromEvents, subjectQualityScore, twoProportionZTest,
  type BroadcastFunnelShape,
} from "./analytics";
import { ScheduledReportsService } from "../finance/scheduled-reports.service";
import { FinanceReportsService } from "../finance/finance-reports.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * MX16 — Analytics & AI v2 specs.
 *
 * Fake-prisma style like mx15/ms9. Covers: the pure z-test /
 * auto-winner decision (every guardrail), funnel aggregation
 * null rules, the heuristic subject score with factors, the
 * per-recipient send-time statistic, the service comparative
 * analytics end-to-end against fixtures (+ CSV matching), the
 * auto-winner on the REAL chunked send path (winner content
 * reaches the loser's pending recipients; OFF sends its own
 * content), the planner/translation guard discipline (kill
 * switch, dev-provider 502, unparseable 502, ZERO writes), and
 * the scheduled messaging_summary report through the existing
 * ScheduledReport system.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) { const ok = v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not; if (!ok) return false; }
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("gt" in v && !(row[k] > v.gt)) return false;
      if ("gte" in v && !(new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      if ("lte" in v && !(new Date(row[k]).getTime() <= new Date(v.lte).getTime())) return false;
      if ("lt" in v && !(new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if ("contains" in v && !String(row[k] ?? "").includes(v.contains)) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}

function sortRows(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  out.sort((a, b) => {
    for (const spec of specs) {
      for (const [key, dir] of Object.entries(spec)) {
        const av = a[key]; const bv = b[key];
        if (av === bv) continue;
        const cmp = av < bv ? -1 : 1;
        return dir === "desc" ? -cmp : cmp;
      }
    }
    return 0;
  });
  return out;
}

function project(row: any, select: any): any {
  if (!select) return row;
  const out: any = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
  return out;
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where, select }: any = {}) => {
      const row = rows.find((r) => matches(r, where ?? {})) ?? null;
      return row ? project(row, select) : null;
    },
    findUnique: async ({ where, select }: any = {}) => {
      const row = rows.find((r) => matches(r, where ?? {})) ?? null;
      return row ? project(row, select) : null;
    },
    findMany: async ({ where, take, orderBy, cursor, skip, select }: any = {}) => {
      let out = sortRows(rows.filter((r) => matches(r, where ?? {})), orderBy);
      if (cursor?.id) {
        const pos = out.findIndex((r) => r.id === cursor.id);
        if (pos >= 0) out = out.slice(pos + (skip ?? 0));
      } else if (skip) {
        out = out.slice(skip);
      }
      if (take) out = out.slice(0, take);
      return out.map((r) => project(r, select));
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) { Object.assign(row, data); row.updatedAt = new Date(); }
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let n = 0;
      for (const row of rows) if (matches(row, where ?? {})) { Object.assign(row, data); row.updatedAt = new Date(); n++; }
      return { count: n };
    },
    deleteMany: async ({ where }: any) => {
      let n = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where ?? {})) { rows.splice(i, 1); n++; }
      return { count: n };
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => r.id === where.id);
      if (i >= 0) rows.splice(i, 1);
      return {};
    },
  };
}

function makeRecipientTable() {
  const table: any = makeTable("bcr");
  table.createMany = async ({ data, skipDuplicates }: any) => {
    let count = 0;
    for (const d of data) {
      const dupe = table.rows.some((r: any) => r.broadcastId === d.broadcastId && r.dedupeKey === d.dedupeKey);
      if (dupe) {
        if (skipDuplicates) continue;
        throw new Error("Unique constraint failed on the fields: (`broadcastId`,`dedupeKey`)");
      }
      table.rows.push({ id: `bcr-${table.rows.length + 1}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date(), updatedAt: new Date(), ...d });
      count++;
    }
    return { count };
  };
  return table;
}

function build(llmFactory?: any) {
  const tables: any = {
    messageTemplate: makeTable("tpl"), broadcast: makeTable("bc"), messageDelivery: makeTable("dlv"),
    customer: makeTable("cust"), lead: makeTable("lead"), whatsAppTemplate: makeTable("wa"),
    messagePreference: makeTable("pref"), messagingSetting: makeTable("mset"),
    messagingSenderConfig: makeTable("scfg"), membership: makeTable("memb"),
    messagingSeedRecipient: makeTable("seed"), messageConsentEvent: makeTable("consent"),
    messagingSavedAudience: makeTable("aud"), messageLinkClick: makeTable("click"),
    product: makeTable("prod"), businessProfile: makeTable("bp"), aIUsageRecord: makeTable("aiuse"),
    order: makeTable("ord"), channelConversation: makeTable("conv"), channelMessage: makeTable("cmsg"),
    scheduledReport: makeTable("srep"), scheduledReportRun: makeTable("srun"),
    broadcastRecipient: makeRecipientTable(),
  };
  tables.customer.rows.push(
    { id: "customer-1", organizationId: "org-1", firstName: "Ayesha", lastName: "Rahman", email: "ayesha@example.com", phone: "01712345671" },
    { id: "customer-2", organizationId: "org-1", firstName: "Tanvir", lastName: null, email: "tanvir@example.com", phone: "01712345672" },
  );
  const settingValues: Record<string, unknown> = {};
  tables.systemSetting = {
    findUnique: async ({ where }: any) => (where.key in settingValues ? { key: where.key, value: settingValues[where.key] } : null),
  };
  tables.organization = {
    findUnique: async () => ({ aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null, timezone: "Asia/Dhaka" }),
  };
  tables.subscription = { findFirst: async () => null };
  const sentEmails: any[] = [];
  const email = {
    isConfigured: () => true,
    send: async (args: any) => { sentEmails.push(args); return { providerMessageId: `em-${sentEmails.length}` }; },
  } as any;
  const sms = { isConfigured: () => false, send: async () => { throw new Error("SMS is not configured"); } } as any;
  const auditCalls: any[] = [];
  const audit = { log: async (x: any) => { auditCalls.push(x); } } as any;
  const svc = new MessagingService(tables as any, audit, email, sms, llmFactory);
  return { svc, tables, auditCalls, sentEmails, settingValues, email, audit };
}

function realProvider(text: string | (() => string), counter?: { calls: number }) {
  return {
    name: "openai", isRealLlm: true,
    complete: async () => {
      if (counter) counter.calls++;
      return { text: typeof text === "function" ? text() : text, model: "gpt-test", inputTokens: 11, outputTokens: 22, tokensEstimated: false };
    },
  };
}
const factoryOf = (provider: any) => ({ getProvider: () => provider });
const statusOf = (e: any) => (typeof e?.getStatus === "function" ? e.getStatus() : e?.status);

const funnel = (over: Partial<BroadcastFunnelShape> = {}): BroadcastFunnelShape => ({
  audience: 100, sent: 100, failed: 0, skipped: 0,
  delivered: null, read: null, opened: null, clickedRecipients: null, totalClicks: null,
  ...over,
});

describe("MX16 pure — two-proportion z-test + auto-winner decision", () => {
  it("computes the documented z and p for a known pair", () => {
    const r = twoProportionZTest({ sent: 100, success: 40 }, { sent: 100, success: 20 });
    expect(r.z).toBeCloseTo(3.086, 2);
    expect(r.pValue).toBeLessThan(0.01);
    expect(r.rateA).toBeCloseTo(0.4);
    expect(r.rateB).toBeCloseTo(0.2);
  });

  const emailPair = (aClicks: number, bClicks: number, aSent = 100, bSent = 100) => ({
    funnelA: funnel({ sent: aSent, audience: aSent, clickedRecipients: aClicks, totalClicks: aClicks }),
    funnelB: funnel({ sent: bSent, audience: bSent, clickedRecipients: bClicks, totalClicks: bClicks }),
  });

  it("decides only when enabled + min sample + significance all hold", () => {
    const d = decideAutoWinner({ enabled: true, alreadyDecided: false, hasCascade: false, channel: "email", ...emailPair(40, 15) });
    expect(d.decided).toBe(true);
    expect(d.winner).toBe("A");
    expect(d.metric).toBe("clickRate");
    expect(Math.abs(d.z ?? 0)).toBeGreaterThanOrEqual(1.96);
  });

  it("never fires when disabled, already decided, on a cascade, below min sample, on a tie, or below significance", () => {
    const base = { alreadyDecided: false, hasCascade: false, channel: "email", ...emailPair(40, 15) };
    expect(decideAutoWinner({ ...base, enabled: false }).reason).toBe("disabled");
    expect(decideAutoWinner({ ...base, enabled: true, alreadyDecided: true }).reason).toBe("already_decided");
    expect(decideAutoWinner({ ...base, enabled: true, hasCascade: true }).reason).toBe("cascade_not_supported");
    const small = decideAutoWinner({ enabled: true, alreadyDecided: false, hasCascade: false, channel: "email", ...emailPair(40, 15, AUTO_WINNER_MIN_SAMPLE - 1, 150) });
    expect(small.decided).toBe(false);
    expect(small.reason).toBe("min_sample_not_met");
    expect(decideAutoWinner({ enabled: true, alreadyDecided: false, hasCascade: false, channel: "email", ...emailPair(30, 30) }).reason).toBe("tie");
    expect(decideAutoWinner({ enabled: true, alreadyDecided: false, hasCascade: false, channel: "email", ...emailPair(52, 48) }).reason).toBe("not_significant");
  });

  it("refuses when the channel honestly reports no metric (push/telegram), and uses read rate for WhatsApp", () => {
    const push = decideAutoWinner({ enabled: true, alreadyDecided: false, hasCascade: false, channel: "push", funnelA: funnel({ sent: 200 }), funnelB: funnel({ sent: 200 }) });
    expect(push.decided).toBe(false);
    expect(push.reason).toBe("metric_unavailable");
    const wa = decideAutoWinner({
      enabled: true, alreadyDecided: false, hasCascade: false, channel: "whatsapp",
      funnelA: funnel({ sent: 120, delivered: 110, read: 60 }),
      funnelB: funnel({ sent: 120, delivered: 108, read: 30 }),
    });
    expect(wa.decided).toBe(true);
    expect(wa.metric).toBe("readRate");
    expect(wa.winner).toBe("A");
  });
});

describe("MX16 pure — funnel aggregation, CSV, subject heuristic, send-time statistic", () => {
  it("aggregates per channel keeping incapable stages null (never 0)", () => {
    const channels = aggregateFunnels([
      { channel: "email", funnel: funnel({ audience: 3, sent: 2, failed: 1, opened: 1, clickedRecipients: 1, totalClicks: 2 }) },
      { channel: "whatsapp", funnel: funnel({ audience: 2, sent: 2, delivered: 2, read: 1 }) },
      { channel: "whatsapp", funnel: funnel({ audience: 2, sent: 2, delivered: 1, read: 0 }) },
    ]);
    const email = channels.find((c) => c.channel === "email")!;
    expect(email.delivered).toBeNull();
    expect(email.read).toBeNull();
    expect(email.opened).toBe(1);
    const wa = channels.find((c) => c.channel === "whatsapp")!;
    expect(wa.broadcasts).toBe(2);
    expect(wa.delivered).toBe(3);
    expect(wa.read).toBe(1);
    expect(wa.clickedRecipients).toBeNull();
  });

  it("the CSV carries the same aggregates and the association label; null stages export empty", () => {
    const channels = aggregateFunnels([
      { channel: "email", funnel: funnel({ audience: 3, sent: 2, failed: 1, opened: 1, clickedRecipients: 1, totalClicks: 2 }) },
    ]);
    const csv = buildAnalyticsCsv({
      range: { from: "2026-10-01", to: "2026-10-16" },
      broadcasts: [{ id: "b1", name: "Eid", channel: "email", status: "sent", sentAt: "2026-10-10T00:00:00.000Z", funnel: funnel({ audience: 3, sent: 2, failed: 1, opened: 1, clickedRecipients: 1, totalClicks: 2 }), revenueAssociation: { orders: 1, totalMinor: "50000" } }],
      channels,
    });
    expect(csv).toContain("সম্পর্ক (association)");
    expect(csv).toContain("50000");
    const waCsv = buildAnalyticsCsv({
      range: { from: "2026-10-01", to: "2026-10-16" },
      broadcasts: [{ id: "b2", name: "WA", channel: "whatsapp", status: "sent", sentAt: null, funnel: funnel({ delivered: 2, read: 1 }), revenueAssociation: null }],
      channels: aggregateFunnels([{ channel: "whatsapp", funnel: funnel({ delivered: 2, read: 1 }) }]),
    });
    const waRow = waCsv.split("\n").find((l) => l.startsWith("b2"))!;
    // clickedRecipients/totalClicks are null for whatsapp → empty cells, never 0.
    expect(waRow.endsWith(",,")).toBe(true);
  });

  it("subject score is a labelled heuristic with factors shown; spam words and shouting cost points", () => {
    const good = subjectQualityScore("ঈদ অফার {{name}} — শুধু আপনার জন্য");
    expect(good.method).toBe("heuristic");
    expect(good.factors).toHaveLength(5);
    expect(good.factors.find((f) => f.code === "PERSONALIZATION")?.points).toBe(20);
    expect(good.score).toBeGreaterThanOrEqual(85);
    expect(good.label).toMatch(/Heuristic/);
    const bad = subjectQualityScore("FREE MONEY!!! YOU WON A CASH PRIZE");
    expect(bad.spamWordsMatched).toContain("free money");
    expect(bad.spamWordsMatched).toContain("cash prize");
    expect(bad.factors.find((f) => f.code === "SPAM_WORDS")?.points).toBe(0);
    expect(bad.score).toBeLessThan(50);
  });

  it("per-recipient send-time: modal Dhaka hour with a minimum-evidence threshold", () => {
    const at = (hour: number, day: number) => new Date(`2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:15:00+06:00`);
    const stat = recipientSendTimeFromEvents([at(19, 1), at(19, 2), at(19, 3), at(19, 4), at(19, 5), at(10, 6)]);
    expect(stat.available).toBe(true);
    expect(stat.modalHour).toBe(19);
    expect(stat.modalHourEvents).toBe(5);
    const thin = recipientSendTimeFromEvents([at(19, 1), at(19, 2), at(19, 3)]);
    expect(thin.available).toBe(false);
    expect(thin.modalHour).toBeNull();
    expect(thin.totalEvents).toBe(3);
  });
});

/** Seed an A/B email pair whose funnels are A: 40/100 clicks,
 * B: 15/100 clicks, with `pendingB` recipients still pending on
 * the loser's recipient-table path. */
function seedPair(tables: any, opts: { override?: boolean | null; pendingB?: number } = {}) {
  const override = opts.override === undefined ? true : opts.override;
  const pendingB = opts.pendingB ?? 10;
  const now = new Date();
  const base: any = {
    organizationId: "org-1", channel: "email", audienceType: "customers", status: "sending",
    abGroupId: "grp-1", recipientSnapshot: null, failedCount: 0, skippedCount: 0,
    createdById: "owner-1", createdAt: now, sentAt: null,
    ...(override !== null ? { abAutoWinnerEnabled: override } : {}),
  };
  tables.broadcast.rows.push(
    { ...base, id: "bc-a", name: "Sale (A)", subject: "Subject A", body: "WINNER BODY A", htmlBody: "<p>A</p>", abVariant: "A", totalRecipients: 100, sentCount: 100 },
    { ...base, id: "bc-b", name: "Sale (B)", subject: "Subject B", body: "LOSER BODY B", htmlBody: null, abVariant: "B", totalRecipients: 100 + pendingB, sentCount: 100 },
  );
  for (let i = 0; i < 100; i++) {
    tables.messageDelivery.rows.push(
      { id: `dlv-a-${String(i).padStart(3, "0")}`, organizationId: "org-1", broadcastId: "bc-a", channel: "email", recipientType: "customer", recipientId: `cust-a-${i}`, address: `a${i}@example.com`, status: "sent", providerMessageId: `pa-${i}`, deliveryStatus: null, createdAt: now },
      { id: `dlv-b-${String(i).padStart(3, "0")}`, organizationId: "org-1", broadcastId: "bc-b", channel: "email", recipientType: "customer", recipientId: `cust-b-${i}`, address: `b${i}@example.com`, status: "sent", providerMessageId: `pb-${i}`, deliveryStatus: null, createdAt: now },
    );
    tables.broadcastRecipient.rows.push(
      { id: `row-a-${i}`, organizationId: "org-1", broadcastId: "bc-a", recipientType: "customer", recipientId: `cust-a-${i}`, dedupeKey: `customer:cust-a-${i}`, name: `A${i}`, email: `a${i}@example.com`, phone: null, address: `a${i}@example.com`, vars: { name: `A${i}` }, status: "sent", attempts: 1, sortIndex: i, createdAt: now, updatedAt: now },
      { id: `row-b-${i}`, organizationId: "org-1", broadcastId: "bc-b", recipientType: "customer", recipientId: `cust-b-${i}`, dedupeKey: `customer:cust-b-${i}`, name: `B${i}`, email: `b${i}@example.com`, phone: null, address: `b${i}@example.com`, vars: { name: `B${i}` }, status: "sent", attempts: 1, sortIndex: i, createdAt: now, updatedAt: now },
    );
  }
  for (let i = 0; i < 40; i++) {
    tables.messageLinkClick.rows.push({ id: `clk-a-${i}`, organizationId: "org-1", broadcastId: "bc-a", recipientKey: `customer:cust-a-${i}`, url: "https://shop.example.com/sale", createdAt: now });
  }
  for (let i = 0; i < 15; i++) {
    tables.messageLinkClick.rows.push({ id: `clk-b-${i}`, organizationId: "org-1", broadcastId: "bc-b", recipientKey: `customer:cust-b-${i}`, url: "https://shop.example.com/sale", createdAt: now });
  }
  for (let i = 0; i < pendingB; i++) {
    tables.broadcastRecipient.rows.push({
      id: `row-b-p${i}`, organizationId: "org-1", broadcastId: "bc-b", recipientType: "customer", recipientId: `cust-b-p${i}`,
      dedupeKey: `customer:cust-b-p${i}`, name: `Pend ${i}`, email: `pend${i}@example.com`, phone: null, address: null,
      vars: { name: `Pend ${i}` }, status: "pending", attempts: 0, sortIndex: 100 + i, createdAt: now, updatedAt: now,
    });
  }
}

describe("MX16 service — auto-winner on the chunked send path", () => {
  it("decides once, records the z-test inputs on BOTH rows, and the loser's pending recipients receive the WINNER's content", async () => {
    const { svc, tables, sentEmails, auditCalls } = build();
    seedPair(tables);
    const result: any = await svc.processBroadcast("org-1", "bc-b");
    expect(result.finalized).toBe(true);
    expect(sentEmails).toHaveLength(10);
    for (const m of sentEmails) {
      expect(m.subject).toBe("Subject A");
      expect(m.text).toContain("WINNER BODY A");
    }
    const a = tables.broadcast.rows.find((r: any) => r.id === "bc-a");
    const b = tables.broadcast.rows.find((r: any) => r.id === "bc-b");
    expect(a.abWinnerVariant).toBe("A");
    expect(b.abWinnerVariant).toBe("A");
    expect(b.abWinnerDetail.metric).toBe("clickRate");
    expect(b.abWinnerDetail.a).toMatchObject({ sent: 100, success: 40 });
    expect(b.abWinnerDetail.b).toMatchObject({ sent: 100, success: 15 });
    expect(Math.abs(b.abWinnerDetail.z)).toBeGreaterThanOrEqual(1.96);
    expect(b.abWinnerDetail.test).toMatch(/two-proportion z-test/);
    expect(auditCalls.some((c: any) => c.action === "broadcast.ab_winner")).toBe(true);
    // Never twice: re-evaluation returns the standing decision.
    const again = await svc.evaluateAbAutoWinner("org-1", "bc-b");
    expect(again.decided).toBe(true);
    expect(again.newlyDecided).toBe(false);
    expect(again.detail.decidedAt).toBe(b.abWinnerDetail.decidedAt);
    // The report surfaces the recorded decision + the rule.
    const report: any = await svc.getBroadcastReport("org-1", "bc-b");
    expect(report.ab.autoWinner.winner).toBe("A");
    expect(report.ab.autoWinner.enabled).toBe(true);
    expect(report.ab.autoWinner.rule).toMatch(/z-test/);
  });

  it("default OFF (no override, no org switch): the loser sends its OWN content and nothing is decided", async () => {
    const { svc, tables, sentEmails } = build();
    seedPair(tables, { override: null });
    await svc.processBroadcast("org-1", "bc-b");
    expect(sentEmails).toHaveLength(10);
    for (const m of sentEmails) {
      expect(m.subject).toBe("Subject B");
      expect(m.text).toContain("LOSER BODY B");
    }
    expect(tables.broadcast.rows.every((r: any) => !r.abWinnerVariant)).toBe(true);
  });

  it("an explicit OFF on the pair beats the org switch ON (the mid-flight disable)", async () => {
    const { svc, tables, sentEmails } = build();
    tables.messagingSetting.rows.push({ id: "mset-1", organizationId: "org-1", abAutoWinnerEnabled: true });
    seedPair(tables, { override: false });
    await svc.processBroadcast("org-1", "bc-b");
    expect(sentEmails.every((m: any) => String(m.text).includes("LOSER BODY B"))).toBe(true);
    expect(tables.broadcast.rows.every((r: any) => !r.abWinnerVariant)).toBe(true);
  });

  it("below the minimum sample the evaluation refuses with the reason", async () => {
    const { svc, tables } = build();
    seedPair(tables);
    // Shrink both variants to 50 sent (counters + a note: the
    // funnel reads progress from the counters).
    for (const r of tables.broadcast.rows) { r.sentCount = 50; r.totalRecipients = 50; }
    const st = await svc.evaluateAbAutoWinner("org-1", "bc-b");
    expect(st.decided).toBe(false);
    expect(st.reason).toBe("min_sample_not_met");
  });

  it("a channel with no honest metric refuses with metric_unavailable (telegram)", async () => {
    const { svc, tables } = build();
    const now = new Date();
    tables.broadcast.rows.push(
      { id: "tg-a", organizationId: "org-1", name: "TG (A)", channel: "telegram", body: "A", audienceType: "telegram_subscribers", status: "sending", abVariant: "A", abGroupId: "grp-tg", abAutoWinnerEnabled: true, recipientSnapshot: null, totalRecipients: 150, sentCount: 150, failedCount: 0, skippedCount: 0, createdById: "owner-1", createdAt: now },
      { id: "tg-b", organizationId: "org-1", name: "TG (B)", channel: "telegram", body: "B", audienceType: "telegram_subscribers", status: "sending", abVariant: "B", abGroupId: "grp-tg", abAutoWinnerEnabled: true, recipientSnapshot: null, totalRecipients: 150, sentCount: 150, failedCount: 0, skippedCount: 0, createdById: "owner-1", createdAt: now },
    );
    const st = await svc.evaluateAbAutoWinner("org-1", "tg-b");
    expect(st.decided).toBe(false);
    expect(st.reason).toBe("metric_unavailable");
  });

  it("the toggle writes BOTH rows, allows null (inherit), and refuses a finished pair", async () => {
    const { svc, tables } = build();
    seedPair(tables, { override: null, pendingB: 0 });
    const out = await svc.setBroadcastAbAutoWinner("org-1", "owner-1", "bc-a", false);
    expect(out.abAutoWinnerEnabled).toBe(false);
    expect(tables.broadcast.rows.every((r: any) => r.abAutoWinnerEnabled === false)).toBe(true);
    await svc.setBroadcastAbAutoWinner("org-1", "owner-1", "bc-a", null);
    expect(tables.broadcast.rows.every((r: any) => r.abAutoWinnerEnabled === null)).toBe(true);
    for (const r of tables.broadcast.rows) r.status = "sent";
    await expect(svc.setBroadcastAbAutoWinner("org-1", "owner-1", "bc-a", true)).rejects.toMatchObject({ code: "messaging.thisBroadcastAlreadyFinishedBroadcastStatusThe" });
  });
});

describe("MX16 service — comparative analytics (fixtures end-to-end)", () => {
  function seedAnalytics(tables: any) {
    const sentAt = new Date(Date.now() - 24 * 3600 * 1000);
    tables.broadcast.rows.push(
      {
        id: "an-e1", organizationId: "org-1", name: "Eid Email", channel: "email", subject: "ঈদ", body: "body",
        htmlBody: "<p>hi</p>", audienceType: "customers", status: "sent", createdById: "owner-1",
        createdAt: sentAt, sentAt, totalRecipients: 3, sentCount: 2, failedCount: 1, skippedCount: 0,
        recipientSnapshot: [
          { type: "customer", id: "customer-1", name: "Ayesha", email: "ayesha@example.com", phone: null, status: "sent", attempts: 1 },
          { type: "customer", id: "customer-2", name: "Tanvir", email: "tanvir@example.com", phone: null, status: "sent", attempts: 1 },
          { type: "customer", id: "customer-2", name: "Tanvir", email: "tanvir@example.com", phone: null, status: "failed", attempts: 1 },
        ],
      },
      {
        id: "an-w1", organizationId: "org-1", name: "WA Promo", channel: "whatsapp", body: "wa",
        audienceType: "customers", status: "sent", createdById: "owner-1",
        createdAt: sentAt, sentAt, totalRecipients: 2, sentCount: 2, failedCount: 0, skippedCount: 0,
        recipientSnapshot: null,
      },
    );
    tables.broadcastRecipient.rows.push(
      { id: "wr-1", organizationId: "org-1", broadcastId: "an-w1", recipientType: "customer", recipientId: "customer-2", dedupeKey: "customer:customer-2", name: "Tanvir", email: null, phone: "01712345672", status: "sent", attempts: 1, sortIndex: 0, createdAt: sentAt, updatedAt: sentAt },
    );
    tables.messageDelivery.rows.push(
      { id: "ad-1", organizationId: "org-1", broadcastId: "an-e1", channel: "email", recipientType: "customer", recipientId: "customer-1", address: "ayesha@example.com", status: "sent", providerMessageId: "e1", deliveryStatus: null, openedAt: new Date(), createdAt: sentAt },
      { id: "ad-2", organizationId: "org-1", broadcastId: "an-e1", channel: "email", recipientType: "customer", recipientId: "customer-2", address: "tanvir@example.com", status: "sent", providerMessageId: "e2", deliveryStatus: null, createdAt: sentAt },
      { id: "ad-3", organizationId: "org-1", broadcastId: "an-e1", channel: "email", recipientType: "customer", recipientId: "customer-2", address: "tanvir@example.com", status: "failed", error: "SMTP 550", createdAt: sentAt },
      { id: "ad-4", organizationId: "org-1", broadcastId: "an-w1", channel: "whatsapp", recipientType: "customer", recipientId: "customer-2", address: "8801712345672", status: "sent", providerMessageId: "w1", deliveryStatus: "read", deliveredAt: new Date(), readAt: new Date(), createdAt: sentAt },
      { id: "ad-5", organizationId: "org-1", broadcastId: "an-w1", channel: "whatsapp", recipientType: "customer", recipientId: "customer-1", address: "8801712345671", status: "sent", providerMessageId: "w2", deliveryStatus: "delivered", deliveredAt: new Date(), createdAt: sentAt },
    );
    tables.messageLinkClick.rows.push(
      { id: "ac-1", organizationId: "org-1", broadcastId: "an-e1", recipientKey: "customer:customer-1", url: "https://shop.example.com", createdAt: sentAt },
      { id: "ac-2", organizationId: "org-1", broadcastId: "an-e1", recipientKey: "customer:customer-1", url: "https://shop.example.com/2", createdAt: sentAt },
      // A click row exists for the WhatsApp broadcast too — the
      // funnel must STILL report clicks as null for that channel.
      { id: "ac-3", organizationId: "org-1", broadcastId: "an-w1", recipientKey: "customer:customer-2", url: "https://shop.example.com", createdAt: sentAt },
    );
    tables.order.rows.push(
      { id: "ord-1", organizationId: "org-1", customerId: "customer-1", totalMinor: 50000n, status: "confirmed", isPractice: false, createdAt: new Date(sentAt.getTime() + 2 * 24 * 3600 * 1000) },
      { id: "ord-2", organizationId: "org-1", customerId: "customer-1", totalMinor: 99000n, status: "cancelled", isPractice: false, createdAt: new Date(sentAt.getTime() + 2 * 24 * 3600 * 1000) },
      { id: "ord-3", organizationId: "org-1", customerId: "customer-1", totalMinor: 77000n, status: "confirmed", isPractice: false, createdAt: new Date(sentAt.getTime() + 10 * 24 * 3600 * 1000) },
    );
    return sentAt;
  }

  it("computes funnels + channel aggregates + labelled association from the fixtures; attribution stays null", async () => {
    const { svc, tables } = build();
    seedAnalytics(tables);
    const r: any = await svc.getComparativeAnalytics("org-1");
    expect(r.broadcasts).toHaveLength(2);
    const e1 = r.broadcasts.find((b: any) => b.id === "an-e1");
    expect(e1.funnel).toMatchObject({ sent: 2, failed: 1, delivered: null, read: null, opened: 1, clickedRecipients: 1, totalClicks: 2 });
    expect(e1.revenueAssociation).toMatchObject({ orders: 1, totalMinor: "50000" });
    const w1 = r.broadcasts.find((b: any) => b.id === "an-w1");
    expect(w1.funnel).toMatchObject({ sent: 2, delivered: 2, read: 1, clickedRecipients: null, totalClicks: null });
    const wa = r.channels.find((c: any) => c.channel === "whatsapp");
    expect(wa).toMatchObject({ broadcasts: 1, delivered: 2, read: 1, clickedRecipients: null });
    expect(r.totals.sent).toBe(4);
    expect(r.association).toMatchObject({ orders: 1, totalMinor: "50000" });
    expect(r.association.label).toMatch(/association/);
    expect(r.attribution).toBeNull();
  });

  it("the CSV export's numbers match the on-screen aggregates", async () => {
    const { svc, tables, auditCalls } = build();
    seedAnalytics(tables);
    const csv = await svc.exportComparativeAnalyticsCsv("org-1", "owner-1");
    const e1Row = csv.split("\n").find((l) => l.startsWith("an-e1"))!;
    expect(e1Row).toContain("50000");
    expect(e1Row).toContain(",2,1,0,,"); // sent 2, failed 1, skipped 0, delivered null (empty)
    expect(csv).toContain("সম্পর্ক (association)");
    expect(auditCalls.some((c: any) => c.action === "messaging.analytics_export")).toBe(true);
  });

  it("per-recipient send-time: real evidence gives the modal hour; thin evidence says insufficient data", async () => {
    const { svc, tables } = build();
    const at = (hour: number, day: number) => new Date(`2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:15:00+06:00`);
    for (let d = 1; d <= 5; d++) {
      tables.messageLinkClick.rows.push({ id: `rt-${d}`, organizationId: "org-1", broadcastId: "an-e1", recipientKey: "customer:customer-9", url: "https://shop.example.com", createdAt: at(19, d) });
    }
    tables.messageDelivery.rows.push({ id: "rt-d1", organizationId: "org-1", broadcastId: "an-e1", channel: "email", recipientType: "customer", recipientId: "customer-9", address: "x@example.com", status: "sent", openedAt: at(20, 6), createdAt: at(20, 6) });
    const rich: any = await svc.recipientSendTimeSuggestion("org-1", "customer", "customer-9");
    expect(rich.available).toBe(true);
    expect(rich.modalHour).toBe(19);
    expect(rich.totalEvents).toBe(6);
    const thin: any = await svc.recipientSendTimeSuggestion("org-1", "customer", "customer-10");
    expect(thin.available).toBe(false);
    expect(thin.modalHour).toBeNull();
    expect(thin.reason).toMatch(/insufficient data/);
  });
});

describe("MX16 service — AI v2 through the MS9 guard path", () => {
  const PLAN_JSON = JSON.stringify({
    audienceDefinition: { entity: "customers", match: "all", conditions: [{ field: "orders_count", op: "gte", value: 1 }] },
    contentDraft: { subject: "ঈদ অফার", body: "হ্যালো {{name}}, ঈদের বিশেষ অফার দেখুন।" },
    channelRecommendation: "email",
    timingSuggestion: "সন্ধ্যা ৭টা–৯টায় পাঠানোর পরামর্শ (গ্যারান্টি নয়)।",
    rationale: "আগের ক্রেতারাই সবচেয়ে সম্ভাব্য ক্রেতা।",
  });

  it("planner returns a validated PROPOSAL and creates NOTHING (zero writes, one usage record)", async () => {
    const counter = { calls: 0 };
    const { svc, tables } = build(factoryOf(realProvider(PLAN_JSON, counter)));
    const r: any = await svc.planCampaign("org-1", "owner-1", { goal: "ঈদ বিক্রি বাড়ানো", channel: "email" });
    expect(counter.calls).toBe(1);
    expect(r.proposal.audienceValid).toBe(true);
    expect(r.proposal.audienceDefinition).toMatchObject({ entity: "customers", match: "all" });
    expect(r.proposal.contentDraft.body).toContain("ঈদের বিশেষ অফার");
    expect(r.proposal.channelRecommendation).toBe("email");
    expect(r.isRealLlm).toBe(true);
    // Zero writes of anything a send could use:
    expect(tables.broadcast.rows).toHaveLength(0);
    expect(tables.messageTemplate.rows).toHaveLength(0);
    expect(tables.messagingSavedAudience.rows).toHaveLength(0);
    expect(tables.messageDelivery.rows).toHaveLength(0);
    // Exactly ONE usage record on the shared ledger:
    expect(tables.aIUsageRecord.rows).toHaveLength(1);
    expect(tables.aIUsageRecord.rows[0].feature).toBe("messaging_copy");
  });

  it("planner: kill switch ⇒ 403 before the provider; dev provider ⇒ honest 502; unparseable ⇒ 502 with NO usage record", async () => {
    const counter = { calls: 0 };
    const killed = build(factoryOf(realProvider(PLAN_JSON, counter)));
    killed.settingValues.killSwitches = { aiDisabledOrgIds: ["org-1"], broadcastsPaused: false };
    const errKill = await killed.svc.planCampaign("org-1", "owner-1", { goal: "x" }).catch((e: any) => e);
    expect(statusOf(errKill)).toBe(403);
    expect(counter.calls).toBe(0);

    const dev = build(factoryOf(new DevTemplateProvider()));
    const errDev = await dev.svc.planCampaign("org-1", "owner-1", { goal: "x" }).catch((e: any) => e);
    expect(statusOf(errDev)).toBe(502);
    expect(dev.tables.aIUsageRecord.rows).toHaveLength(0);

    const garbage = build(factoryOf(realProvider("not json at all")));
    const errGarbage = await garbage.svc.planCampaign("org-1", "owner-1", { goal: "x" }).catch((e: any) => e);
    expect(statusOf(errGarbage)).toBe(502);
    expect(garbage.tables.aIUsageRecord.rows).toHaveLength(0);
    expect(garbage.tables.broadcast.rows).toHaveLength(0);
  });

  it("translation returns a draft only (nothing saved); dev provider ⇒ 502", async () => {
    const json = JSON.stringify({ subject: "Eid Offer", body: "Hello {{name}}, see our Eid offer." });
    const { svc, tables } = build(factoryOf(realProvider(json)));
    const r: any = await svc.translateDraft("org-1", "owner-1", { subject: "ঈদ অফার", body: "হ্যালো {{name}}, ঈদের অফার দেখুন।", targetLanguage: "en" });
    expect(r.subject).toBe("Eid Offer");
    expect(r.body).toContain("{{name}}");
    expect(r.isRealLlm).toBe(true);
    expect(tables.messageTemplate.rows).toHaveLength(0);
    expect(tables.broadcast.rows).toHaveLength(0);
    expect(tables.aIUsageRecord.rows).toHaveLength(1);

    const dev = build(factoryOf(new DevTemplateProvider()));
    const errTr = await dev.svc.translateDraft("org-1", "owner-1", { body: "হ্যালো", targetLanguage: "en" }).catch((e: any) => e);
    expect(statusOf(errTr)).toBe(502);
  });

  it("subject score via the service is the labelled heuristic (no AI usage consumed)", async () => {
    const { svc, tables } = build(factoryOf(realProvider("{}")));
    const r: any = svc.scoreSubjectQuality({ subject: "ঈদ অফার {{name}}" });
    expect(r.method).toBe("heuristic");
    expect(r.score).toBeGreaterThan(0);
    expect(tables.aIUsageRecord.rows).toHaveLength(0);
  });

  it("settings: the auto-winner org switch persists through updateMessagingSetting and the view returns it", async () => {
    const { svc, tables } = build();
    expect(await svc.getAbAutoWinnerEnabled("org-1")).toBe(false);
    const updated: any = await svc.updateMessagingSetting("org-1", "owner-1", { abAutoWinnerEnabled: true });
    expect(updated.abAutoWinnerEnabled).toBe(true);
    const view: any = await svc.getMessagingSettingsView("org-1");
    expect(view.abAutoWinnerEnabled).toBe(true);
    expect(tables.messagingSetting.rows[0].abAutoWinnerEnabled).toBe(true);
  });
});

describe("MX16 finance — scheduled messaging_summary through the existing ScheduledReport system", () => {
  it("registers as a report type, generates from real messaging records and delivers through the system's email path", async () => {
    const { tables, email, audit, sentEmails } = build();
    const reports = { buildReportFile: async () => { throw new Error("commerce builder must not run for messaging_summary"); } } as any;
    const profit = { getProfitReport: async () => { throw new Error("not used"); } } as any;
    const scheduled = new ScheduledReportsService(tables as any, audit, email, reports, profit);
    // The type validates; a bogus type still refuses.
    const cfg = await scheduled.createConfig("org-1", "u-1", { reportType: "messaging_summary", cadence: "daily", recipients: ["owner@example.com"] });
    expect(cfg.reportType).toBe("messaging_summary");
    await expect(scheduled.createConfig("org-1", "u-1", { reportType: "nope", cadence: "daily", recipients: ["a@b.com"] })).rejects.toThrow("তালিকা থেকে");

    const now = new Date();
    const y = FinanceReportsService.yesterdayRange(now);
    const sentAt = new Date(`${y.from}T12:00:00+06:00`);
    tables.broadcast.rows.push({
      id: "sch-1", organizationId: "org-1", name: "Scheduled Eid Email", channel: "email", subject: "ঈদ", body: "b",
      htmlBody: "<p>x</p>", audienceType: "customers", status: "sent", createdById: "u-1", createdAt: sentAt, sentAt,
      recipientSnapshot: [{ type: "customer", id: "customer-1", name: "Ayesha", email: "ayesha@example.com", phone: null, status: "sent", attempts: 1 }],
    });
    tables.messageDelivery.rows.push(
      { id: "sd-1", organizationId: "org-1", broadcastId: "sch-1", channel: "email", recipientType: "customer", recipientId: "customer-1", address: "ayesha@example.com", status: "sent", providerMessageId: "s1", openedAt: new Date(), createdAt: sentAt },
      { id: "sd-2", organizationId: "org-1", broadcastId: "sch-1", channel: "email", recipientType: "customer", recipientId: "customer-2", address: "tanvir@example.com", status: "failed", error: "SMTP 550", createdAt: sentAt },
    );
    tables.messageLinkClick.rows.push({ id: "sc-1", organizationId: "org-1", broadcastId: "sch-1", recipientKey: "customer:customer-1", url: "https://shop.example.com", createdAt: sentAt });
    tables.order.rows.push({ id: "so-1", organizationId: "org-1", customerId: "customer-1", totalMinor: 12300n, status: "confirmed", isPractice: false, createdAt: new Date(sentAt.getTime() + 24 * 3600 * 1000) });

    const before = tables.scheduledReportRun.rows.length;
    const run: any = await scheduled.runOne("org-1", { ...cfg, id: cfg.id }, { test: true, now });
    expect(run.status).toBe("sent");
    expect(tables.scheduledReportRun.rows.length).toBe(before + 1);
    expect(run.detail.attachment).toContain("messaging_summary");
    // The attachment went through the EXISTING email delivery
    // path and carries the real figures + association label.
    const mail = sentEmails[sentEmails.length - 1];
    expect(mail.to).toBe("owner@example.com");
    const attachmentText = Buffer.isBuffer(mail.attachments[0].content)
      ? mail.attachments[0].content.toString("utf8")
      : String(mail.attachments[0].content);
    expect(attachmentText).toContain("Scheduled Eid Email");
    expect(attachmentText).toContain("সম্পর্ক (association)");
    expect(attachmentText).toContain("123"); // 12300 minor = 123.00 taka in the summary rows
  });
});
