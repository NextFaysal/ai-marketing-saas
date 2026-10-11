/**
 * Inbox Next-Gen P3 (Team & AI) — API half.
 *
 * Covers: ghost completion (grounded continuation + usage row,
 * invented-number guard, dev-template silence, provider-failure
 * silence, prefix stripping), AI enforcement parity (kill switch
 * + per-feature daily cap across ghost / draft / summary /
 * translate), tone rewrite (number preservation, honest dev
 * refusal, tone validation), the notes no-leak proof for visitor
 * payloads, read-time mood on get/list conversation payloads, and
 * webchat visitor presence (token discipline + 30s lastSeenAt
 * write throttle + typing fan-out).
 */
import { createHash } from "crypto";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { BadRequestException, HttpException, UnauthorizedException } from "@nestjs/common";
import { InboxService } from "./inbox.service";
import { WebchatService } from "./webchat.service";
import { RealtimeService } from "./realtime.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const auditStub = { log: async () => undefined } as any;

function matchesWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries<any>(where ?? {})) {
    if (v === undefined) continue;
    if (k === "AND") { if (!v.every((w: any) => matchesWhere(row, w))) return false; continue; }
    if (k === "OR") { if (!v.some((w: any) => matchesWhere(row, w))) return false; continue; }
    if (v === null) { if (row[k] != null) return false; continue; }
    if (typeof v === "object" && !(v instanceof Date)) {
      if (v.in !== undefined && !v.in.includes(row[k])) return false;
      if (v.not !== undefined && row[k] === v.not) return false;
      if (v.gte !== undefined && !(new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      if (v.gt !== undefined && !(row[k] > v.gt)) return false;
      if (v.lt !== undefined && !(new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if (v.has !== undefined && !(row[k] ?? []).includes(v.has)) return false;
      if (v.contains !== undefined && !String(row[k] ?? "").toLowerCase().includes(String(v.contains).toLowerCase())) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function makeTable(name: string, seed: any[] = []) {
  const rows: any[] = [...seed];
  let seq = 0;
  const applyOrder = (list: any[], orderBy: any) => {
    if (!orderBy) return list;
    const [key, dir] = Object.entries(orderBy)[0] as [string, string];
    return [...list].sort((a, b) => {
      const av = a[key] instanceof Date ? a[key].getTime() : a[key];
      const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
      return dir === "desc" ? (bv > av ? 1 : bv < av ? -1 : 0) : (av > bv ? 1 : av < bv ? -1 : 0);
    });
  };
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matchesWhere(r, where)) ?? null,
    findMany: async ({ where, take, orderBy }: any = {}) => {
      const f = applyOrder(rows.filter((r) => matchesWhere(r, where)), orderBy);
      return take ? f.slice(0, take) : f;
    },
    findUnique: async ({ where }: any = {}) => rows.find((r) => matchesWhere(r, where)) ?? null,
    count: async ({ where }: any = {}) => rows.filter((r) => matchesWhere(r, where)).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchesWhere(r, where));
      if (row) Object.assign(row, data);
      return row;
    },
  };
}

const CONV = {
  id: "conv-1", organizationId: "org-1", channel: "whatsapp", status: "open",
  externalContactId: "8801711111111", contactName: "Karim", customerId: null, leadId: null,
  tags: [], unreadCount: 1, lastMessageAt: new Date(), lastCustomerMessageAt: new Date(),
};

function fakePrisma(opts: { killOrg?: boolean; usageSeed?: any[] } = {}) {
  const tables: Record<string, any> = {
    channelConversation: makeTable("conv", [{ ...CONV }]),
    channelMessage: makeTable("msg", [
      { id: "m-in-1", conversationId: "conv-1", direction: "in", type: "text", content: "Cotton Panjabi এর দাম কত?", status: "received", createdAt: new Date(Date.now() - 60_000) },
    ]),
    conversationNote: makeTable("note"),
    messageDraft: makeTable("draft"),
    businessPolicy: makeTable("policy", [
      { id: "pol-1", organizationId: "org-1", type: "shipping", title: "Shipping", content: "ঢাকার ভিতরে ডেলিভারি চার্জ ৬০ টাকা।" },
    ]),
    product: makeTable("product", [
      { id: "p1", organizationId: "org-1", status: "ACTIVE", name: "Cotton Panjabi", priceMinor: 150000n, currency: "BDT", stockQuantity: 12 },
    ]),
    aIUsageRecord: makeTable("usage", opts.usageSeed ?? []),
    membership: makeTable("membership"),
    agentPresence: makeTable("presence"),
    liveChatSession: makeTable("session"),
    systemSetting: makeTable("setting", opts.killOrg
      ? [{ id: "set-1", key: "killSwitches", value: { aiDisabledOrgIds: ["org-1"], broadcastsPaused: false } }]
      : []),
    subscription: makeTable("sub"), // no row -> FREE plan (aiDaily 20)
    organization: makeTable("org"),
  };
  tables.businessProfile = { findUnique: async () => ({ industry: "fashion", description: "Clothing store", brandVoice: "friendly" }) };
  return tables;
}

function fakeLlm(text: string | (() => string)) {
  const provider = {
    name: "fake-llm", isRealLlm: true,
    complete: async () => ({ text: typeof text === "function" ? text() : text, inputTokens: 10, outputTokens: 5, tokensEstimated: false }),
  };
  return { getProvider: () => provider } as any;
}
const devLlm = { getProvider: () => new DevTemplateProvider() } as any;

function svc(tables: any, llm: any) {
  return new InboxService(tables as any, auditStub, llm);
}

async function errorOf(p: Promise<any>): Promise<any> {
  try { await p; return null; } catch (e) { return e; }
}

describe("P3 ghost completion", () => {
  it("returns a grounded continuation and records usage (feature ghost_complete)", async () => {
    const tables = fakePrisma();
    const out = await svc(tables, fakeLlm("BDT 1500.00 টাকা, স্টকে আছে।")).ghostComplete("org-1", "agent-1", "conv-1", "জি স্যার, পণ্যটির দাম");
    expect(out.completion).toContain("1500");
    expect(tables.aIUsageRecord.rows).toHaveLength(1);
    expect(tables.aIUsageRecord.rows[0]).toMatchObject({ feature: "ghost_complete", userId: "agent-1", provider: "fake-llm" });
  });

  it("strips a repeated partial prefix from the model output", async () => {
    const tables = fakePrisma();
    const out = await svc(tables, fakeLlm("জি স্যার, পণ্যটির দাম BDT 1500.00 টাকা।")).ghostComplete("org-1", "agent-1", "conv-1", "জি স্যার, পণ্যটির দাম");
    expect(out.completion).toBe("BDT 1500.00 টাকা।");
  });

  it("an invented price number drops the completion to empty (usage still recorded)", async () => {
    const tables = fakePrisma();
    const out = await svc(tables, fakeLlm("মাত্র ৯৯৯ টাকায় পেয়ে যাবেন!")).ghostComplete("org-1", "agent-1", "conv-1", "জি স্যার, অফারটি হলো");
    expect(out).toEqual({ completion: "" });
    expect(tables.aIUsageRecord.rows).toHaveLength(1); // the call consumed quota
  });

  it("dev provider: silent empty completion and NO usage row", async () => {
    const tables = fakePrisma();
    const out = await svc(tables, devLlm).ghostComplete("org-1", "agent-1", "conv-1", "জি স্যার, পণ্যটির দাম");
    expect(out).toEqual({ completion: "" });
    expect(tables.aIUsageRecord.rows).toHaveLength(0);
  });

  it("a provider exception resolves to an empty completion — the composer never breaks", async () => {
    const tables = fakePrisma();
    const throwing = { getProvider: () => ({ name: "fake-llm", isRealLlm: true, complete: async () => { throw new Error("provider down"); } }) } as any;
    await expect(svc(tables, throwing).ghostComplete("org-1", "agent-1", "conv-1", "জি স্যার, বলছি")).resolves.toEqual({ completion: "" });
  });

  it("a too-short partial completes nothing — no enforcement, no LLM call, no usage", async () => {
    const tables = fakePrisma({ killOrg: true }); // even with the kill switch ON
    const out = await svc(tables, fakeLlm("whatever")).ghostComplete("org-1", "agent-1", "conv-1", "a");
    expect(out).toEqual({ completion: "" });
    expect(tables.aIUsageRecord.rows).toHaveLength(0);
  });
});

describe("P3 AI enforcement parity (kill switch + daily cap)", () => {
  it("kill switch: ghost, draft, summary and translate all refuse with 403", async () => {
    const tables = fakePrisma({ killOrg: true });
    const s = svc(tables, fakeLlm("কিছু একটা"));
    const is403 = (e: any) => e instanceof HttpException && e.getStatus() === 403;
    expect(is403(await errorOf(s.ghostComplete("org-1", "agent-1", "conv-1", "জি স্যার, বলছি")))).toBe(true);
    expect(is403(await errorOf(s.suggestDraft("org-1", "agent-1", "conv-1")))).toBe(true);
    expect(is403(await errorOf(s.summarizeConversation("org-1", "agent-1", "conv-1")))).toBe(true);
    expect(is403(await errorOf(s.translateMessage("org-1", "conv-1", "m-in-1", "en")))).toBe(true);
    expect(tables.aIUsageRecord.rows).toHaveLength(0); // nothing ran
  });

  it("daily cap: 20 ghost_complete rows today on the FREE plan -> 429", async () => {
    const usageSeed = Array.from({ length: 20 }, (_, i) => ({
      id: `u-${i}`, organizationId: "org-1", feature: "ghost_complete", createdAt: new Date(),
    }));
    const tables = fakePrisma({ usageSeed });
    const s = svc(tables, fakeLlm("BDT 1500.00 টাকা"));
    const err = await errorOf(s.ghostComplete("org-1", "agent-1", "conv-1", "জি স্যার, দাম"));
    expect(err instanceof HttpException && err.getStatus() === 429).toBe(true);
    // The cap is PER FEATURE: draft (0 rows today) still works.
    const draft = await s.suggestDraft("org-1", "agent-1", "conv-1");
    expect(draft.status).toBe("suggested");
  });

  it("under the cap, agent-initiated features proceed (draft + summary + translate)", async () => {
    const tables = fakePrisma();
    const s = svc(tables, fakeLlm("Translated text"));
    const draft = await s.suggestDraft("org-1", "agent-1", "conv-1");
    expect(draft.content).toBe("Translated text");
    const summary = await s.summarizeConversation("org-1", "agent-1", "conv-1");
    expect(summary.summaryText).toBe("Translated text");
    const tr = await s.translateMessage("org-1", "conv-1", "m-in-1", "en");
    expect(tr.translatedText).toBe("Translated text");
    expect(tables.aIUsageRecord.rows.map((r: any) => r.feature).sort()).toEqual(["draft", "summary", "translate"]);
  });
});

describe("P3 tone rewrite", () => {
  it("returns the rewrite when every number is preserved, and records usage", async () => {
    const tables = fakePrisma();
    const out = await svc(tables, fakeLlm("সম্মানিত গ্রাহক, পণ্যটির দাম ১৫০০ টাকা এবং ডেলিভারি চার্জ ৬০ টাকা।"))
      .toneRewrite("org-1", "agent-1", "conv-1", "দাম ১৫০০ টাকা, ডেলিভারি ৬০ টাকা", "polite");
    expect(out.text).toContain("১৫০০");
    expect(tables.aIUsageRecord.rows[0]).toMatchObject({ feature: "tone_rewrite" });
  });

  it("a changed number refuses the rewrite with BadRequest", async () => {
    const tables = fakePrisma();
    await expect(svc(tables, fakeLlm("দাম মাত্র ১২০০ টাকা!")).toneRewrite("org-1", "agent-1", "conv-1", "দাম ১৫০০ টাকা", "sales"))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it("dev provider refuses honestly instead of faking a rewrite", async () => {
    const tables = fakePrisma();
    await expect(svc(tables, devLlm).toneRewrite("org-1", "agent-1", "conv-1", "দাম ১৫০০ টাকা", "polite"))
      .rejects.toThrow("আসল LLM provider দরকার");
  });

  it("invalid tone and empty text are BadRequest at the service level", async () => {
    const tables = fakePrisma();
    const s = svc(tables, fakeLlm("x"));
    await expect(s.toneRewrite("org-1", "agent-1", "conv-1", "কিছু লেখা", "rude")).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.toneRewrite("org-1", "agent-1", "conv-1", "   ", "polite")).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.toneRewrite("org-1", "agent-1", "conv-1", "x".repeat(2001), "polite")).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("P3 notes never leak to visitors", () => {
  const SECRET_NOTE = "অভ্যন্তরীণ নোট: গ্রাহককে ৫০০ টাকা ছাড় দেওয়া যেতে পারে";
  function webchatSetup() {
    const tables = fakePrisma();
    tables.channelConversation.rows.push({ ...CONV, id: "conv-w", channel: "webchat" });
    tables.channelMessage.rows.push(
      { id: "m-w-1", conversationId: "conv-w", direction: "in", type: "text", content: "দাম কত?", status: "received", createdAt: new Date(Date.now() - 30_000), mediaStorageKey: null },
      { id: "m-w-2", conversationId: "conv-w", direction: "out", type: "text", content: "BDT 1500.00", status: "sent", createdAt: new Date(Date.now() - 20_000), mediaStorageKey: null },
    );
    tables.conversationNote.rows.push({
      id: "note-1", organizationId: "org-1", conversationId: "conv-w", authorUserId: "agent-1", content: SECRET_NOTE, createdAt: new Date(),
    });
    tables.widgetSite = makeTable("site", [{ id: "site-1", organizationId: "org-1", enabled: true, widgetKey: "wc_test" }]);
    tables.liveChatSession = makeTable("session", [{
      id: "sess-1", widgetSiteId: "site-1", conversationId: "conv-w", visitorId: "v-1",
      visitorTokenHash: tokenHash("visitor-token"), lastSeenAt: new Date(),
    }]);
    return tables;
  }

  it("listMessages returns only channel messages — no note text, no note-shaped entries", async () => {
    const tables = webchatSetup();
    const webchat = new WebchatService(tables as any, auditStub, {} as any, undefined);
    const out = await webchat.listMessages("wc_test", "visitor-token");
    expect(out).toHaveLength(2);
    expect(JSON.stringify(out)).not.toContain(SECRET_NOTE);
    expect(JSON.stringify(out)).not.toContain("অভ্যন্তরীণ");
    for (const row of out) {
      expect(row).not.toHaveProperty("authorUserId");
      expect(["m-w-1", "m-w-2"]).toContain(row.id);
    }
  });

  it("the visitor stream projection carries messages only — never notes", async () => {
    const tables = webchatSetup();
    const realtime = new RealtimeService();
    const received: any[] = [];
    const sub = realtime.streamVisitor("conv-w").subscribe((e: any) => { if (e.data) received.push(e.data); });
    const inbox = new InboxService(tables as any, auditStub, devLlm, undefined, realtime);
    inbox.emitInboxEvent("org-1", {
      type: "message.created", conversationId: "conv-w",
      message: tables.channelMessage.rows.find((m: any) => m.id === "m-w-2"),
    });
    await new Promise((r) => setTimeout(r, 20));
    sub.unsubscribe();
    expect(received).toHaveLength(1);
    expect(JSON.stringify(received)).not.toContain(SECRET_NOTE);
    expect(received[0].message.content).toBe("BDT 1500.00");
  });

  it("agents DO see the note through listNotes (the leak boundary is visitor-side only)", async () => {
    const tables = webchatSetup();
    const notes = await svc(tables, devLlm).listNotes("org-1", "conv-w");
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toBe(SECRET_NOTE);
  });
});

describe("P3 mood on conversation payloads", () => {
  function moodTables(contents: { direction: string; content: string }[]) {
    const tables = fakePrisma();
    tables.channelMessage.rows.length = 0;
    contents.forEach((c, i) => tables.channelMessage.rows.push({
      id: `mm-${i}`, conversationId: "conv-1", direction: c.direction, type: "text",
      content: c.content, status: "received", createdAt: new Date(Date.now() - (contents.length - i) * 1000),
    }));
    return tables;
  }

  it("positive inbound thread -> mood positive, per-message sentiment attached", async () => {
    const tables = moodTables([
      { direction: "in", content: "ধন্যবাদ! পণ্যটা দারুণ 😊" },
      { direction: "out", content: "আপনাকেও ধন্যবাদ স্যার" },
      { direction: "in", content: "খুব খুশি হলাম, চমৎকার সার্ভিস" },
    ]);
    const detail = await svc(tables, devLlm).getConversation("org-1", "conv-1");
    expect(detail.conversation.mood).toBe("positive");
    const inbound = detail.messages.filter((m: any) => m.direction === "in");
    expect(inbound.every((m: any) => m.sentiment === "positive")).toBe(true);
    expect(detail.messages.find((m: any) => m.direction === "out").sentiment).toBeNull();
  });

  it("negative inbound thread -> mood negative", async () => {
    const tables = moodTables([{ direction: "in", content: "খুব খারাপ সার্ভিস, হতাশ হলাম" }]);
    const detail = await svc(tables, devLlm).getConversation("org-1", "conv-1");
    expect(detail.conversation.mood).toBe("negative");
    expect(detail.messages[0].sentiment).toBe("negative");
  });

  it("equal positive + negative -> neutral; no inbound at all -> null", async () => {
    const mixed = await svc(moodTables([
      { direction: "in", content: "ধন্যবাদ!" },
      { direction: "in", content: "খুব খারাপ" },
    ]), devLlm).getConversation("org-1", "conv-1");
    expect(mixed.conversation.mood).toBe("neutral");
    const none = await svc(moodTables([{ direction: "out", content: "হ্যালো" }]), devLlm).getConversation("org-1", "conv-1");
    expect(none.conversation.mood).toBeNull();
  });

  it("listConversations attaches mood + visitorLastSeenAt (webchat only)", async () => {
    const tables = fakePrisma();
    tables.channelConversation.rows.push({
      ...CONV, id: "conv-w", channel: "webchat", lastCustomerMessageAt: new Date(),
    });
    tables.channelMessage.rows.push({
      id: "m-wp", conversationId: "conv-w", direction: "in", type: "text",
      content: "অনেক ধন্যবাদ, দারুণ!", status: "received", createdAt: new Date(),
    });
    const seenAt = new Date(Date.now() - 5 * 60_000);
    tables.liveChatSession.rows.push({ id: "sess-1", conversationId: "conv-w", lastSeenAt: seenAt });
    const rows = await svc(tables, devLlm).listConversations("org-1", {});
    const webchatRow = rows.find((r: any) => r.id === "conv-w");
    expect(webchatRow.mood).toBe("positive");
    expect(webchatRow.visitorLastSeenAt).toBe(seenAt.toISOString());
    const waRow = rows.find((r: any) => r.id === "conv-1");
    expect(waRow.visitorLastSeenAt).toBeNull();
    expect(waRow.mood).toBe("neutral"); // its only inbound asks a price — texts exist, no sentiment signal
  });
});

describe("P3 webchat visitor presence", () => {
  function presenceSetup(lastSeenAt: Date) {
    const tables = fakePrisma();
    tables.widgetSite = makeTable("site", [{ id: "site-1", organizationId: "org-1", enabled: true, widgetKey: "wc_test" }]);
    const sessionRow = {
      id: "sess-1", widgetSiteId: "site-1", conversationId: "conv-w", visitorId: "v-1",
      visitorTokenHash: tokenHash("visitor-token"), lastSeenAt,
    };
    tables.liveChatSession = makeTable("session", [sessionRow]);
    const updateCalls: any[] = [];
    const origUpdate = tables.liveChatSession.update;
    tables.liveChatSession.update = async (args: any) => { updateCalls.push(args); return origUpdate(args); };
    const presenceCalls: any[] = [];
    const inboxStub = { emitVisitorPresence: (org: string, conv: string, typing: boolean) => { presenceCalls.push({ org, conv, typing }); } } as any;
    const webchat = new WebchatService(tables as any, auditStub, inboxStub, undefined);
    return { webchat, updateCalls, presenceCalls, sessionRow };
  }

  it("a bad token is a 401 before anything is recorded", async () => {
    const { webchat, updateCalls, presenceCalls } = presenceSetup(new Date());
    await expect(webchat.visitorPresence("wc_test", { token: "someone-elses-token" })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(updateCalls).toHaveLength(0);
    expect(presenceCalls).toHaveLength(0);
  });

  it("a fresh lastSeenAt (<30s) is NOT rewritten, but presence + typing are reported", async () => {
    const { webchat, updateCalls, presenceCalls } = presenceSetup(new Date());
    const out = await webchat.visitorPresence("wc_test", { token: "visitor-token", typing: true });
    expect(out).toEqual({ ok: true });
    expect(updateCalls).toHaveLength(0);
    expect(presenceCalls).toEqual([{ org: "org-1", conv: "conv-w", typing: true }]);
  });

  it("a stale lastSeenAt (61s) IS rewritten", async () => {
    const stale = new Date(Date.now() - 61_000);
    const { webchat, updateCalls, sessionRow } = presenceSetup(stale);
    const out = await webchat.visitorPresence("wc_test", { token: "visitor-token" });
    expect(out).toEqual({ ok: true });
    expect(updateCalls).toHaveLength(1);
    expect(sessionRow.lastSeenAt.getTime()).toBeGreaterThan(stale.getTime());
  });

  it("agent typing on a webchat thread reaches the visitor stream (typing frame)", async () => {
    const tables = fakePrisma();
    tables.channelConversation.rows.push({ ...CONV, id: "conv-w", channel: "webchat" });
    const realtime = new RealtimeService();
    const received: any[] = [];
    const sub = realtime.streamVisitor("conv-w").subscribe((e: any) => { if (e.data) received.push(e.data); });
    const inbox = new InboxService(tables as any, auditStub, devLlm, undefined, realtime);
    await inbox.heartbeatPresence("org-1", "agent-1", "conv-w", true);
    await new Promise((r) => setTimeout(r, 20));
    sub.unsubscribe();
    expect(received.some((f: any) => f.type === "typing" && f.typing === true)).toBe(true);
  });
});
