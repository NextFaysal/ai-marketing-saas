import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { OrderChaseService, chaseText, isChaseQuietHour, matchesChaseStopWord } from "./order-chase.service";
import { JOB_TEMPLATES, JOB_TYPES } from "../automation/automation.service";
import { UpdateInboxSettingsDto } from "../inbox/inbox.dto";

/**
 * CX7 — "To Chase" stalled order-bot session nudges.
 * All sends are proven ONLY via a fake sender at the
 * sendAutomatedMessage seam — no real chat send is claimed.
 * `now` is injected into the sweep so delay/interval/quiet-hour
 * behaviour is deterministic: NOW = 12:00 in Asia/Dhaka.
 */
const ORG = "org-1";
const NOW = new Date("2026-10-12T06:00:00.000Z"); // 12:00 Asia/Dhaka
const H = 3600 * 1000;
const M = 60 * 1000;

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const ops = v as any;
      if ("in" in ops) { if (!ops.in.includes(row[k])) return false; continue; }
      if ("lte" in ops) { if (!(new Date(row[k]).getTime() <= new Date(ops.lte).getTime())) return false; continue; }
      if ("lt" in ops) { if (!(new Date(row[k]).getTime() < new Date(ops.lt).getTime())) return false; continue; }
      if ("gte" in ops) { if (!(new Date(row[k]).getTime() >= new Date(ops.gte).getTime())) return false; continue; }
      if ("gt" in ops) { if (!(new Date(row[k]).getTime() > new Date(ops.gt).getTime())) return false; continue; }
      return false;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function makeChase(opts: {
  settings?: Record<string, any>;
  sessions?: any[];
  conversations?: any[];
  messages?: any[];
  orders?: any[];
  products?: any[];
  chases?: any[];
  failSend?: boolean;
  rereadStatus?: string;
} = {}) {
  const setting = {
    organizationId: ORG, chaseEnabled: true, chaseFirstDelayMinutes: 60, chaseIntervalMinutes: 240,
    chaseMaxAttempts: 3, chaseQuietHoursRespect: true, chaseQuietStartHour: 22, chaseQuietEndHour: 8,
    ...(opts.settings ?? {}),
  };
  const sessions: any[] = opts.sessions ?? [
    { id: "ses-1", organizationId: ORG, conversationId: "conv-1", state: "ask_address", status: "active", data: { productId: "prod-1" }, createdAt: new Date(NOW.getTime() - 3 * H), updatedAt: new Date(NOW.getTime() - 2 * H) },
  ];
  const conversations: any[] = opts.conversations ?? [
    { id: "conv-1", organizationId: ORG, status: "open", autoReplyPaused: false },
  ];
  const messages: any[] = opts.messages ?? [];
  const orders: any[] = opts.orders ?? [];
  const products: any[] = opts.products ?? [{ id: "prod-1", organizationId: ORG, name: "কটন পাঞ্জাবি" }];
  const chases: any[] = (opts.chases ?? []).map((c: any) => ({ attempts: 0, lastChasedAt: null, lastFailedAt: null, stoppedReason: null, lastEvent: null, createdAt: new Date(NOW.getTime() - H), updatedAt: new Date(NOW.getTime() - H), ...c }));

  const prisma = {
    inboxSetting: { findUnique: async ({ where }: any) => (where.organizationId === ORG ? setting : null) },
    organization: { findUnique: async () => ({ id: ORG, timezone: "Asia/Dhaka" }) },
    botSession: {
      findMany: async ({ where, orderBy, take }: any) => {
        let rows = sessions.filter((s) => matchWhere(s, where));
        if (orderBy?.updatedAt === "asc") rows = rows.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
        return take ? rows.slice(0, take) : rows;
      },
      findUnique: async ({ where }: any) => {
        const s = sessions.find((x) => x.id === where.id) ?? null;
        return s && opts.rereadStatus ? { ...s, status: opts.rereadStatus } : s;
      },
    },
    orderChase: {
      findUnique: async ({ where }: any) => chases.find((c) => c.sessionId === where.sessionId) ?? null,
      findMany: async ({ where }: any) => chases.filter((c) => matchWhere(c, where)),
      create: async ({ data }: any) => {
        if (chases.some((c) => c.sessionId === data.sessionId)) throw new Error("P2002 unique sessionId");
        const row = { id: `chase-${chases.length + 1}`, attempts: 0, lastChasedAt: null, lastFailedAt: null, stoppedReason: null, lastEvent: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        chases.push(row);
        return row;
      },
      update: async ({ where, data }: any) => { const r = chases.find((x) => x.id === where.id)!; Object.assign(r, data); r.updatedAt = new Date(); return r; },
    },
    order: {
      findFirst: async ({ where }: any) => orders.find((o) => matchWhere(o, where)) ?? null,
    },
    channelConversation: {
      findFirst: async ({ where }: any) => conversations.find((c) => matchWhere(c, where)) ?? null,
    },
    channelMessage: {
      findFirst: async ({ where }: any) => messages.find((m) => matchWhere(m, where)) ?? null,
      findMany: async ({ where, orderBy }: any) => {
        let rows = messages.filter((m) => matchWhere(m, where));
        if (orderBy?.createdAt === "asc") rows = rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        return rows;
      },
    },
    product: {
      findFirst: async ({ where }: any) => products.find((p) => matchWhere(p, where)) ?? null,
      findMany: async ({ where }: any) => products.filter((p) => matchWhere(p, where)),
    },
  };
  const svc = new OrderChaseService(prisma as any);
  const calls: any[] = [];
  const sender = {
    sendAutomatedMessage: async (...a: any[]) => {
      calls.push(a);
      if (opts.failSend) throw new Error("platform send failed");
      return { id: "m1" };
    },
  };
  return { svc, sender, calls, chases, sessions, setting };
}

describe("CX7 quiet-hours helper", () => {
  it("overnight window 22->8 in org tz", () => {
    // Asia/Dhaka = UTC+6.
    expect(isChaseQuietHour(new Date("2026-10-12T17:00:00Z"), "Asia/Dhaka", 22, 8)).toBe(true); // 23:00
    expect(isChaseQuietHour(new Date("2026-10-12T01:00:00Z"), "Asia/Dhaka", 22, 8)).toBe(true); // 07:00
    expect(isChaseQuietHour(new Date("2026-10-12T02:00:00Z"), "Asia/Dhaka", 22, 8)).toBe(false); // 08:00 — window end is exclusive
    expect(isChaseQuietHour(new Date("2026-10-12T06:00:00Z"), "Asia/Dhaka", 22, 8)).toBe(false); // 12:00
    expect(isChaseQuietHour(new Date("2026-10-12T15:59:00Z"), "Asia/Dhaka", 22, 8)).toBe(false); // 21:59
    expect(isChaseQuietHour(new Date("2026-10-12T16:00:00Z"), "Asia/Dhaka", 22, 8)).toBe(true); // 22:00 — start inclusive
  });
  it("same-day window and start==end (no window)", () => {
    expect(isChaseQuietHour(new Date("2026-10-12T06:00:00Z"), "Asia/Dhaka", 9, 17)).toBe(true); // 12:00
    expect(isChaseQuietHour(new Date("2026-10-12T14:00:00Z"), "Asia/Dhaka", 9, 17)).toBe(false); // 20:00
    expect(isChaseQuietHour(new Date("2026-10-12T17:00:00Z"), "Asia/Dhaka", 22, 22)).toBe(false);
  });
});

describe("CX7 stop-word matcher (conservative, whole-message-ish)", () => {
  it("matches equals / starts-with / ends-with with boundaries", () => {
    for (const t of ["থামুন", "থামান", "stop", "STOP", "stop please", "please stop", "থামুন প্লিজ", "লাগবে না", "আমার লাগবে না", "চাই না", "আমি চাই না", "দরকার নেই", "আর দরকার নেই।"]) {
      expect(matchesChaseStopWord(t)).toBe(true);
    }
  });
  it("does not match lookalikes or ordinary replies", () => {
    for (const t of ["", "stopwatch", "আমি চাই", "লাগবে", "ঠিক আছে", "দাম কত?", "stops"]) {
      expect(matchesChaseStopWord(t)).toBe(false);
    }
  });
});

describe("CX7 chase text", () => {
  it("references the resolved product name; generic otherwise; never a price", () => {
    expect(chaseText("কটন পাঞ্জাবি")).toContain("কটন পাঞ্জাবি");
    expect(chaseText(null)).toContain("আপনার অর্ডারটি এখনো সম্পূর্ণ হয়নি");
    expect(chaseText("কটন পাঞ্জাবি")).not.toMatch(/৳|টাকা|price/i);
  });
});

describe("CX7 sweep — gating + candidate selection", () => {
  it("disabled -> no-op: no sends, no chase rows", async () => {
    const { svc, sender, calls, chases } = makeChase({ settings: { chaseEnabled: false } });
    const out = await svc.runOrderChaseSweep(ORG, sender, NOW);
    expect(out.skippedReason).toBe("order_chase_disabled");
    expect(calls.length).toBe(0);
    expect(chases.length).toBe(0);
  });

  it("a session younger than the first delay is not considered", async () => {
    const fresh = { id: "ses-new", organizationId: ORG, conversationId: "conv-1", state: "ask_name", status: "active", data: {}, createdAt: new Date(NOW.getTime() - 40 * M), updatedAt: new Date(NOW.getTime() - 30 * M) };
    const { svc, sender, calls } = makeChase({ sessions: [fresh] });
    const out = await svc.runOrderChaseSweep(ORG, sender, NOW);
    expect(out.considered).toBe(0);
    expect(calls.length).toBe(0);
  });

  it("another org's sessions are never touched (tenant isolation)", async () => {
    const other = { id: "ses-x", organizationId: "org-2", conversationId: "conv-9", state: "ask_name", status: "active", data: {}, createdAt: new Date(NOW.getTime() - 3 * H), updatedAt: new Date(NOW.getTime() - 2 * H) };
    const { svc, sender, calls, chases } = makeChase({ sessions: [other] });
    const out = await svc.runOrderChaseSweep(ORG, sender, NOW);
    expect(out.considered).toBe(0);
    expect(calls.length).toBe(0);
    expect(chases.length).toBe(0);
  });

  it("quiet hours respected -> silent skip (no state change); not respected -> sends", async () => {
    const quietNow = new Date("2026-10-12T17:00:00Z"); // 23:00 Dhaka
    const on = makeChase();
    const outOn = await on.svc.runOrderChaseSweep(ORG, on.sender, quietNow);
    expect(outOn).toMatchObject({ considered: 1, sent: 0, skipped: 1 });
    expect(on.calls.length).toBe(0);
    expect(on.chases[0].attempts).toBe(0);
    expect(on.chases[0].stoppedReason).toBeNull();

    const off = makeChase({ settings: { chaseQuietHoursRespect: false } });
    const outOff = await off.svc.runOrderChaseSweep(ORG, off.sender, quietNow);
    expect(outOff.sent).toBe(1);
  });
});

describe("CX7 sweep — send path", () => {
  it("confirmed send: product referenced, attempts=1, lastChasedAt stamped, tag order_chase", async () => {
    const { svc, sender, calls, chases } = makeChase();
    const out = await svc.runOrderChaseSweep(ORG, sender, NOW);
    expect(out).toEqual({ considered: 1, sent: 1, stopped: 0, skipped: 0, failed: 0 });
    expect(calls.length).toBe(1);
    expect(calls[0][1]).toBe("conv-1");
    expect(calls[0][2]).toContain("কটন পাঞ্জাবি");
    expect(calls[0][3]).toBe("order_chase");
    expect(chases.length).toBe(1);
    expect(chases[0].attempts).toBe(1);
    expect(chases[0].lastChasedAt).toEqual(NOW);
    expect(chases[0].stoppedReason).toBeNull();
  });

  it("generic fallback when the session has no product, and when the productId does not resolve", async () => {
    const noProduct = { id: "ses-2", organizationId: ORG, conversationId: "conv-1", state: "ask_name", status: "active", data: {}, createdAt: new Date(NOW.getTime() - 3 * H), updatedAt: new Date(NOW.getTime() - 2 * H) };
    const a = makeChase({ sessions: [noProduct] });
    await a.svc.runOrderChaseSweep(ORG, a.sender, NOW);
    expect(a.calls[0][2]).toContain("আপনার অর্ডারটি এখনো সম্পূর্ণ হয়নি");
    expect(a.calls[0][2]).not.toContain("কটন পাঞ্জাবি");

    const ghost = { ...noProduct, id: "ses-3", data: { productId: "prod-ghost" } };
    const b = makeChase({ sessions: [ghost] });
    await b.svc.runOrderChaseSweep(ORG, b.sender, NOW);
    expect(b.calls[0][2]).toContain("আপনার অর্ডারটি এখনো সম্পূর্ণ হয়নি");
  });

  it("failed send does NOT consume an attempt; lastFailedAt stamped; next sweep retries and succeeds", async () => {
    const failing = makeChase({ failSend: true });
    const out1 = await failing.svc.runOrderChaseSweep(ORG, failing.sender, NOW);
    expect(out1).toMatchObject({ sent: 0, failed: 1 });
    expect(failing.chases[0].attempts).toBe(0);
    expect(failing.chases[0].lastFailedAt).toEqual(NOW);
    expect(failing.chases[0].lastChasedAt).toBeNull();

    const retry = makeChase({ chases: failing.chases });
    const out2 = await retry.svc.runOrderChaseSweep(ORG, retry.sender, new Date(NOW.getTime() + 5 * M));
    expect(out2.sent).toBe(1);
    expect(retry.chases[0].attempts).toBe(1);
  });

  it("interval gating: a second chase waits chaseIntervalMinutes after the last confirmed one", async () => {
    const row = { id: "chase-1", organizationId: ORG, sessionId: "ses-1", conversationId: "conv-1", attempts: 1, lastChasedAt: new Date(NOW.getTime() - 1 * H) };
    const a = makeChase({ chases: [row] });
    const outA = await a.svc.runOrderChaseSweep(ORG, a.sender, NOW);
    expect(outA).toMatchObject({ sent: 0, skipped: 1 });
    expect(a.calls.length).toBe(0);

    const later = { ...row, lastChasedAt: new Date(NOW.getTime() - 5 * H) };
    const b = makeChase({ chases: [later] });
    const outB = await b.svc.runOrderChaseSweep(ORG, b.sender, NOW);
    expect(outB.sent).toBe(1);
    expect(b.chases[0].attempts).toBe(2);
  });

  it("cap: attempts at max -> max_attempts, no send", async () => {
    const row = { id: "chase-1", organizationId: ORG, sessionId: "ses-1", conversationId: "conv-1", attempts: 3, lastChasedAt: new Date(NOW.getTime() - 10 * H) };
    const { svc, sender, calls, chases } = makeChase({ chases: [row] });
    const out = await svc.runOrderChaseSweep(ORG, sender, NOW);
    expect(out).toMatchObject({ sent: 0, stopped: 1 });
    expect(calls.length).toBe(0);
    expect(chases[0].stoppedReason).toBe("max_attempts");
  });
});

describe("CX7 sweep — stop conditions", () => {
  it("session no longer active on fresh re-read -> session_ended", async () => {
    const { svc, sender, calls, chases } = makeChase({ rereadStatus: "expired" });
    const out = await svc.runOrderChaseSweep(ORG, sender, NOW);
    expect(out.stopped).toBe(1);
    expect(calls.length).toBe(0);
    expect(chases[0].stoppedReason).toBe("session_ended");
  });

  it("an order exists for the conversation -> completed (the other org's order does not count)", async () => {
    const mine = makeChase({ orders: [{ id: "ord-1", organizationId: ORG, conversationId: "conv-1" }] });
    await mine.svc.runOrderChaseSweep(ORG, mine.sender, NOW);
    expect(mine.chases[0].stoppedReason).toBe("completed");
    expect(mine.calls.length).toBe(0);

    const theirs = makeChase({ orders: [{ id: "ord-9", organizationId: "org-2", conversationId: "conv-1" }] });
    const out = await theirs.svc.runOrderChaseSweep(ORG, theirs.sender, NOW);
    expect(out.sent).toBe(1);
  });

  it("closed conversation -> human_took_over; paused autopilot -> human_took_over", async () => {
    const closed = makeChase({ conversations: [{ id: "conv-1", organizationId: ORG, status: "closed", autoReplyPaused: false }] });
    await closed.svc.runOrderChaseSweep(ORG, closed.sender, NOW);
    expect(closed.chases[0].stoppedReason).toBe("human_took_over");
    expect(closed.calls.length).toBe(0);

    const paused = makeChase({ conversations: [{ id: "conv-1", organizationId: ORG, status: "open", autoReplyPaused: true }] });
    await paused.svc.runOrderChaseSweep(ORG, paused.sender, NOW);
    expect(paused.chases[0].stoppedReason).toBe("human_took_over");
  });

  it("a human outbound after session start -> human_took_over; a bot/automated outbound does not", async () => {
    const humanMsg = { id: "m-h", conversationId: "conv-1", direction: "out", autoReply: false, sentByUserId: "user-1", content: "আমি দেখছি", createdAt: new Date(NOW.getTime() - 90 * M) };
    const a = makeChase({ messages: [humanMsg] });
    await a.svc.runOrderChaseSweep(ORG, a.sender, NOW);
    expect(a.chases[0].stoppedReason).toBe("human_took_over");
    expect(a.calls.length).toBe(0);

    const botMsg = { id: "m-b", conversationId: "conv-1", direction: "out", autoReply: true, sentByUserId: null, content: "কয়টি নিতে চান?", createdAt: new Date(NOW.getTime() - 90 * M) };
    const b = makeChase({ messages: [botMsg] });
    const out = await b.svc.runOrderChaseSweep(ORG, b.sender, NOW);
    expect(out.sent).toBe(1);
  });

  it("customer stop word -> stop_word, never chased", async () => {
    const stopMsg = { id: "m-s", conversationId: "conv-1", direction: "in", autoReply: false, content: "থামুন", createdAt: new Date(NOW.getTime() - 100 * M) };
    const { svc, sender, calls, chases } = makeChase({ messages: [stopMsg] });
    const out = await svc.runOrderChaseSweep(ORG, sender, NOW);
    expect(out.stopped).toBe(1);
    expect(calls.length).toBe(0);
    expect(chases[0].stoppedReason).toBe("stop_word");
  });

  it("customer reply (non-stop) -> customer_replied trail, no send now; fresh quiet period later -> chase resumes", async () => {
    // The reply arrived 10 minutes ago but the bot did not bump
    // the session (updatedAt is 2h old) — the reply itself is the
    // activity baseline.
    const reply = { id: "m-r", conversationId: "conv-1", direction: "in", autoReply: false, content: "একটু ভেবে জানাচ্ছি", createdAt: new Date(NOW.getTime() - 10 * M) };
    const a = makeChase({ messages: [reply] });
    const outA = await a.svc.runOrderChaseSweep(ORG, a.sender, NOW);
    expect(outA).toMatchObject({ sent: 0, skipped: 1 });
    expect(a.calls.length).toBe(0);
    expect(a.chases[0].lastEvent).toBe("customer_replied");
    expect(a.chases[0].stoppedReason).toBeNull();

    // Two hours later the reply is older than the first-delay
    // quiet period -> the chain is eligible again.
    const b = makeChase({ messages: [reply], chases: a.chases });
    const outB = await b.svc.runOrderChaseSweep(ORG, b.sender, new Date(NOW.getTime() + 2 * H));
    expect(outB.sent).toBe(1);
    expect(b.chases[0].attempts).toBe(1);
  });
});

describe("CX7 list", () => {
  it("listChases is org-scoped and enriches session state + product name", async () => {
    const row = { id: "chase-1", organizationId: ORG, sessionId: "ses-1", conversationId: "conv-1", attempts: 1, lastChasedAt: NOW };
    const foreign = { id: "chase-9", organizationId: "org-2", sessionId: "ses-9", conversationId: "conv-9", attempts: 2 };
    const { svc } = makeChase({ chases: [row, foreign] });
    const list = await svc.listChases(ORG);
    expect(list.length).toBe(1);
    expect(list[0].sessionState).toBe("ask_address");
    expect(list[0].sessionStatus).toBe("active");
    expect(list[0].productName).toBe("কটন পাঞ্জাবি");
  });
});

describe("CX7 job registration", () => {
  it("order_chase_sweep is a creatable type with an org template (60 min)", () => {
    expect(JOB_TYPES).toContain("order_chase_sweep");
    const tpl = JOB_TEMPLATES.find((t) => t.type === "order_chase_sweep");
    expect(tpl?.targetKind).toBe("org");
    expect(tpl?.intervalMinutes).toBe(60);
  });
});

describe("CX7 settings DTO bounds", () => {
  const check = (patch: Record<string, unknown>) => validateSync(plainToInstance(UpdateInboxSettingsDto, patch)).length;
  it("accepts in-bounds chase settings", () => {
    expect(check({ chaseEnabled: true, chaseFirstDelayMinutes: 15, chaseIntervalMinutes: 60, chaseMaxAttempts: 1, chaseQuietHoursRespect: true, chaseQuietStartHour: 0, chaseQuietEndHour: 23 })).toBe(0);
    expect(check({ chaseFirstDelayMinutes: 1440, chaseIntervalMinutes: 2880, chaseMaxAttempts: 5 })).toBe(0);
    expect(check({})).toBe(0);
  });
  it("rejects out-of-bounds chase settings", () => {
    expect(check({ chaseFirstDelayMinutes: 14 })).toBeGreaterThan(0);
    expect(check({ chaseFirstDelayMinutes: 1441 })).toBeGreaterThan(0);
    expect(check({ chaseIntervalMinutes: 59 })).toBeGreaterThan(0);
    expect(check({ chaseIntervalMinutes: 2881 })).toBeGreaterThan(0);
    expect(check({ chaseMaxAttempts: 0 })).toBeGreaterThan(0);
    expect(check({ chaseMaxAttempts: 6 })).toBeGreaterThan(0);
    expect(check({ chaseQuietStartHour: 24 })).toBeGreaterThan(0);
    expect(check({ chaseQuietEndHour: -1 })).toBeGreaterThan(0);
  });
});
