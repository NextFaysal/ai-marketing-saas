import "reflect-metadata";
import { CopilotService, CopilotLlmNotConfiguredError, COPILOT_FEATURE } from "./copilot.service";
import { CopilotController } from "./copilot.controller";
import { ROLES_KEY } from "../common/decorators";
import { ActionEngineService } from "./actions/action-engine.service";
import { ActionExecutorsService } from "./actions/action-executors.service";
import { InboxService } from "../inbox/inbox.service";
import { SocialCommentsService } from "../inbox/social-comments.service";

/**
 * SA-B21 (G3) — Owner Copilot:
 * - grounded Q&A: the prompt pack is assembled ONLY from the
 *   org's own deterministic digests (performance snapshots,
 *   ads/competitor digests, creative report) + Brain internal
 *   facts; answers quote pack numbers only.
 * - the shared number guard: an invented number triggers ONE
 *   regeneration; a second invention withholds the prose and
 *   returns the verified fact sections (facts always available,
 *   prose is the bonus — the SA-B14 discipline).
 * - unknown/absent data: an org with NO data gets a
 *   deterministic no-data answer with ZERO LLM calls; a
 *   compliant "জানি না" passes through untouched.
 * - actions are DETERMINISTIC: a unique campaign name match
 *   files exactly one engine proposal (real engine + real
 *   SA-B15 builders) and execute() is never called; ambiguous
 *   or missing targets create NOTHING and ask, listing the real
 *   campaigns; budget stays a money-adjacent proposal; refund
 *   and conversation/comment acts are honestly refused with the
 *   real path named — all with zero LLM involvement.
 * - cross-org isolation: org A's prompt pack and campaign
 *   candidates contain none of org B's sentinels.
 * - role gate: OWNER/ADMIN only (recorded narrowing).
 * - no real LLM: Q&A is the typed 503, while the deterministic
 *   action path keeps working.
 */

const ORG = "org-a";
const ORG_B = "org-b";
const ORG_C = "org-c"; // no data at all
const OWNER = "user-owner";

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "gte" in (v as any)) {
      return new Date(row[k]) >= (v as any).gte;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "in" in (v as any)) {
      return (v as any).in.includes(row[k]);
    }
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take, orderBy }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      const field = orderBy ? Object.keys(orderBy)[0] : null;
      if (field && (orderBy as any)[field] === "desc") {
        f = [...f].sort((a, b) => new Date(b[field]).getTime() - new Date(a[field]).getTime());
      }
      return take ? f.slice(0, take) : f;
    },
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
  };
}

const metrics7 = {
  windowDays: 7,
  periodStart: "2026-10-10",
  periodEnd: "2026-10-17",
  inbox: { conversationsHandled: 41, closed: 30, aiResolved: 12, aiResolvedShare: 0.4, ordersFromInbox: 3, ordersFromInboxValueMinor: "150000" },
  sales: { orders: 42, revenueMinor: "987600", topProducts: [{ name: "Sentinel Shoes", qty: 9 }] },
  ads: { spendMinor: "500000", currency: "BDT", topCampaigns: [{ name: "Eid Sale", roas: 2.5 }] },
  social: {},
};
const metrics30 = {
  windowDays: 30,
  periodStart: "2026-09-17",
  periodEnd: "2026-10-17",
  inbox: { conversationsHandled: 130, closed: 98 },
  sales: { orders: 150, revenueMinor: "3000000", topProducts: [{ name: "Sentinel Shoes", qty: 30 }] },
  ads: {},
  social: {},
};
const metricsB = {
  windowDays: 7,
  periodStart: "2026-10-10",
  periodEnd: "2026-10-17",
  inbox: {},
  sales: { orders: 99, revenueMinor: "77777700", topProducts: [] },
  ads: {},
  social: {},
};

function makeProvider(script: Array<string | Error>, isReal = true) {
  const calls: any[] = [];
  let i = 0;
  return {
    name: "test-llm",
    isRealLlm: isReal,
    calls,
    complete: jest.fn(async (messages: any[]) => {
      calls.push(messages);
      const item = script[Math.min(i++, Math.max(0, script.length - 1))];
      if (item instanceof Error) throw item;
      return { text: item as string, model: "test-model", inputTokens: 10, outputTokens: 5, tokensEstimated: false };
    }),
  };
}

function setup(script: Array<string | Error> = ["ঠিক আছে।"], opts: { realLlm?: boolean } = {}) {
  const db: any = {
    performanceSnapshot: makeTable("snap"),
    businessProfile: makeTable("bp"),
    campaignPlan: makeTable("plan"),
    adCampaign: makeTable("adcampaign"),
    adAccount: makeTable("account"),
    crossPlatformDraft: makeTable("draft"),
    aIUsageRecord: makeTable("usage"),
    aIActionProposal: makeTable("proposal"),
    aiAutonomySetting: makeTable("autonomy"),
    aIAction: makeTable("aiaction"),
    channelConversation: makeTable("conv"),
    socialComment: makeTable("comment"),
    membership: makeTable("member"),
    order: makeTable("order"),
    systemSetting: makeTable("setting"),
    organization: makeTable("org"),
    subscription: makeTable("sub"),
  };
  db.performanceSnapshot.rows.push(
    { id: "snap-a30", organizationId: ORG, metrics: metrics30, computedAt: new Date("2026-10-16T00:00:00Z") },
    { id: "snap-a7", organizationId: ORG, metrics: metrics7, computedAt: new Date("2026-10-17T00:00:00Z") },
    { id: "snap-b7", organizationId: ORG_B, metrics: metricsB, computedAt: new Date("2026-10-17T00:00:00Z") },
  );
  db.businessProfile.rows.push({ id: "bp-a", organizationId: ORG, aiReplyLanguage: "bn" });
  db.adAccount.rows.push(
    { id: "acct-meta", organizationId: ORG, platform: "meta", name: "Meta Main", currency: "BDT", integrationId: "int-1" },
    { id: "acct-b", organizationId: ORG_B, platform: "meta", name: "Meta B", currency: "BDT", integrationId: "int-2" },
  );
  db.campaignPlan.rows.push(
    { id: "plan-eid", organizationId: ORG, name: "Eid Sale", status: "published", externalCampaignId: "ext-eid", adAccountId: "acct-meta", metaStatus: "ACTIVE", campaignDailyBudgetMinor: 200000 },
    { id: "plan-ws", organizationId: ORG, name: "Winter Sale", status: "published", externalCampaignId: "ext-ws", adAccountId: "acct-meta", metaStatus: "ACTIVE" },
    { id: "plan-wo", organizationId: ORG, name: "Winter Offer", status: "published", externalCampaignId: "ext-wo", adAccountId: "acct-meta", metaStatus: "ACTIVE" },
    { id: "plan-b", organizationId: ORG_B, name: "Eid Sale B", status: "published", externalCampaignId: "ext-b", adAccountId: "acct-b", metaStatus: "ACTIVE", campaignDailyBudgetMinor: 100000 },
  );

  const audit = { log: jest.fn(async () => undefined) };
  const inbox = new InboxService(db as any, audit as any, { getProvider: () => { throw new Error("no provider"); } } as any);
  const social = new SocialCommentsService(db as any, audit as any);
  const executors = new ActionExecutorsService(db as any, inbox, social);
  const engine = new ActionEngineService(db as any, audit as any, executors);
  const executeSpy = jest.spyOn(engine, "execute");

  const brain = {
    getContext: jest.fn(async (orgId: string) => {
      if (orgId === ORG_B) {
        return {
          orgName: "Shop B",
          internalProfile: { goals: "GoalSentinelB", monthlyBudgetMinor: null, budgetCurrency: null, businessModel: null, uniqueSellingPoints: null, targetCustomers: null },
          ownerInstructions: null,
          knowledgeMatches: [],
        };
      }
      if (orgId === ORG_C) {
        return { orgName: "Shop C", internalProfile: null, ownerInstructions: null, knowledgeMatches: [] };
      }
      return {
        orgName: "Shop A",
        internalProfile: {
          goals: "GoalSentinelA",
          monthlyBudgetMinor: "30000000",
          budgetCurrency: "BDT",
          businessModel: null,
          uniqueSellingPoints: null,
          targetCustomers: null,
        },
        ownerInstructions: null,
        knowledgeMatches: [
          { docId: "d1", kind: "note", title: "নীতি", content: "KnowledgeSentinelA তথ্য", visibility: "internal", score: 1 },
        ],
      };
    }),
  };
  const ads = {
    computeDigest: jest.fn(async (orgId: string) =>
      orgId === ORG
        ? { hasData: true, windowDays: 7, factLines: ["বিজ্ঞাপন: গত ৭ দিনে মোট ব্যয় ৳5,000, ROAS 2.5।", "সেরা campaign “Eid Sale”।"] }
        : { hasData: false, windowDays: 7, factLines: [] },
    ),
  };
  const competitor = {
    computeDigest: jest.fn(async (orgId: string) =>
      orgId === ORG
        ? { hasData: true, factLines: ["প্রতিদ্বন্দ্বী RivalSentinel: গত ৩০ দিনে ৬টি নতুন বিজ্ঞাপন দিয়েছে।"] }
        : { hasData: false, factLines: [] },
    ),
  };
  const creative = {
    computeReport: jest.fn(async (orgId: string) =>
      orgId === ORG
        ? {
            windowDays: 30,
            creativesWithText: 4,
            creativesQualifying: 3,
            creativesBelowFloor: 1,
            adsWithoutLocalText: 0,
            baseline: { impressions: 9000, clicks: 450, ctrPercent: 5, roas: null },
            patterns: [{ statement: "প্রশ্ন-আকারের headline: CTR 8% বনাম গড় 5%।" }],
            exemplars: [],
          }
        : { windowDays: 30, creativesWithText: 0, creativesQualifying: 0, creativesBelowFloor: 0, adsWithoutLocalText: 0, baseline: { impressions: 0, clicks: 0, ctrPercent: null, roas: null }, patterns: [], exemplars: [] },
    ),
  };

  const provider = makeProvider(script, opts.realLlm !== false);
  const llm = { forOrg: async () => provider, getProvider: () => provider };

  const copilot = new CopilotService(
    db as any,
    llm as any,
    brain as any,
    ads as any,
    competitor as any,
    creative as any,
    engine,
    audit as any,
  );
  return { db, copilot, engine, executeSpy, provider, brain, ads, competitor, creative, audit };
}

describe("SA-B21 Copilot — grounded Q&A", () => {
  it("answers from the pack only: prompt carries the labelled sections, answer quoting pack numbers passes the guard", async () => {
    const s = setup(["গত ৭ দিনে মোট ৪২টি অর্ডার হয়েছে এবং বিজ্ঞাপনে ব্যয় ৳5,000।"]);
    const res: any = await s.copilot.ask(ORG, OWNER, { question: "গত সপ্তাহে বিক্রি কেমন ছিল?" });
    expect(res.kind).toBe("answer");
    expect(res.guardNote).toBeNull();
    expect(res.answer).toContain("৪২টি");
    const sources = res.sections.map((x: any) => `${x.source}:${x.window}`);
    expect(sources).toContain("performance_snapshot:7d");
    expect(sources).toContain("performance_snapshot:30d");
    expect(sources).toContain("ads_digest:7d");
    expect(sources).toContain("competitor_digest:30d");
    expect(sources).toContain("creative_report:30d");
    expect(sources).toContain("brain_internal:null");
    // The exact prompt the model saw carries the org's own facts.
    const prompt = JSON.stringify(s.provider.calls[0]);
    expect(prompt).toContain("GoalSentinelA");
    expect(prompt).toContain("RivalSentinel");
    expect(prompt).toContain("KnowledgeSentinelA");
    // One usage row in the copilot bucket.
    const usage = s.db.aIUsageRecord.rows.filter((r: any) => r.feature === COPILOT_FEATURE);
    expect(usage.length).toBe(1);
  });

  it("cross-org isolation: org A's prompt contains none of org B's sentinels or numbers", async () => {
    const s = setup(["গত ৭ দিনে মোট ৪২টি অর্ডার হয়েছে।"]);
    await s.copilot.ask(ORG, OWNER, { question: "বিক্রি কেমন?" });
    const prompt = JSON.stringify(s.provider.calls[0]);
    expect(prompt).not.toContain("GoalSentinelB");
    expect(prompt).not.toContain("777777");
    expect(prompt).not.toContain("Eid Sale B");
  });

  it("an invented number triggers ONE regeneration; a clean rewrite is served with guardNote regenerated", async () => {
    const s = setup([
      "গত ৭ দিনে মোট ৭৭৭টি অর্ডার হয়েছে।",
      "গত ৭ দিনে মোট ৪২টি অর্ডার হয়েছে।",
    ]);
    const res: any = await s.copilot.ask(ORG, OWNER, { question: "কয়টি অর্ডার হয়েছে?" });
    expect(res.kind).toBe("answer");
    expect(res.guardNote).toBe("regenerated");
    expect(res.answer).toContain("৪২টি");
    expect(s.provider.complete).toHaveBeenCalledTimes(2);
    // Both real calls are accounted in the copilot bucket.
    expect(s.db.aIUsageRecord.rows.filter((r: any) => r.feature === COPILOT_FEATURE).length).toBe(2);
  });

  it("a second invention withholds the prose: verified sections are returned with the dropped numbers named", async () => {
    const s = setup(["মোট ৭৭৭টি অর্ডার।", "মোট ৮৮৮টি অর্ডার।"]);
    const res: any = await s.copilot.ask(ORG, OWNER, { question: "কয়টি অর্ডার হয়েছে?" });
    expect(res.kind).toBe("answer");
    expect(res.guardNote).toBe("dropped_unsupported_numbers");
    expect(res.droppedNumbers).toContain("888");
    expect(res.answer).not.toContain("৭৭৭");
    expect(res.answer).not.toContain("৮৮৮");
    expect(res.sections.length).toBeGreaterThan(0);
    expect(s.provider.complete).toHaveBeenCalledTimes(2);
  });

  it("unknown question: a compliant 'জানি না' passes through; an org with NO data gets a deterministic no-data answer with zero LLM calls", async () => {
    const s = setup(["এই তথ্যটা আমার কাছে নেই।"]);
    const res: any = await s.copilot.ask(ORG, OWNER, { question: "আমার দোকানে কয়জন কর্মচারী আছে?" });
    expect(res.kind).toBe("answer");
    expect(res.answer).toContain("আমার কাছে নেই");

    const empty = setup(["কিছু"]);
    const resC: any = await empty.copilot.ask(ORG_C, OWNER, { question: "বিক্রি কেমন?" });
    expect(resC.kind).toBe("answer");
    expect(resC.sections).toEqual([]);
    expect(resC.answer).toContain("জমা হয়নি");
    expect(empty.provider.complete).not.toHaveBeenCalled();
  });

  it("no real LLM: Q&A is the typed 503 (LLM_NOT_CONFIGURED), nothing is templated", async () => {
    const s = setup(["x"], { realLlm: false });
    await expect(s.copilot.ask(ORG, OWNER, { question: "বিক্রি কেমন?" })).rejects.toMatchObject({
      status: 503,
    });
    const err = await s.copilot.ask(ORG, OWNER, { question: "বিক্রি কেমন?" }).catch((e) => e);
    expect(err).toBeInstanceOf(CopilotLlmNotConfiguredError);
    expect(err.getResponse().code).toBe("LLM_NOT_CONFIGURED");
  });
});

describe("SA-B21 Copilot — deterministic action path", () => {
  it("unique campaign match files exactly ONE pause proposal through the real engine; execute() is never called", async () => {
    const s = setup();
    const res: any = await s.copilot.ask(ORG, OWNER, { question: "Eid Sale campaign-টা pause করো" });
    expect(res.kind).toBe("proposal");
    expect(res.proposal.actionId).toBe("pause_campaign");
    expect(res.proposal.status).toBe("proposed");
    expect(res.proposal.moneyAdjacent).toBe(false);
    expect(res.answer).toContain("Control Center");
    const rows = s.db.aIActionProposal.rows.filter((r: any) => r.organizationId === ORG);
    expect(rows.length).toBe(1);
    expect(rows[0].actionId).toBe("pause_campaign");
    expect(rows[0].proposedBy).toBe("staff");
    expect(rows[0].sourceRef).toMatchObject({ via: "copilot" });
    expect(s.executeSpy).not.toHaveBeenCalled();
    expect(s.provider.complete).not.toHaveBeenCalled();
  });

  it("a repeat ask dedupes against the open proposal — still one row", async () => {
    const s = setup();
    await s.copilot.ask(ORG, OWNER, { question: "Eid Sale campaign pause করো" });
    const res2: any = await s.copilot.ask(ORG, OWNER, { question: "Eid Sale campaign pause করো" });
    expect(res2.kind).toBe("proposal");
    expect(res2.proposal.deduped).toBe(true);
    expect(s.db.aIActionProposal.rows.filter((r: any) => r.organizationId === ORG).length).toBe(1);
  });

  it("ambiguous name remainder: clarification listing the real matches, zero proposals, zero LLM calls", async () => {
    const s = setup();
    const res: any = await s.copilot.ask(ORG, OWNER, { question: "winter campaign pause করো" });
    expect(res.kind).toBe("clarification");
    expect(res.candidates.map((c: any) => c.name).sort()).toEqual(["Winter Offer", "Winter Sale"]);
    expect(s.db.aIActionProposal.rows.length).toBe(0);
    expect(s.provider.complete).not.toHaveBeenCalled();
  });

  it("missing target: clarification lists only the asker's own campaigns (org B's never appear)", async () => {
    const s = setup();
    const res: any = await s.copilot.ask(ORG, OWNER, { question: "Monsoon Sale campaign pause করো" });
    expect(res.kind).toBe("clarification");
    const names = res.candidates.map((c: any) => c.name);
    expect(names).toContain("Eid Sale");
    expect(names).not.toContain("Eid Sale B");
    expect(s.db.aIActionProposal.rows.length).toBe(0);
  });

  it("budget ask stays a money-adjacent PROPOSAL (the engine wall), with the amount parsed past the campaign name", async () => {
    const s = setup();
    const res: any = await s.copilot.ask(ORG, OWNER, { question: "Eid Sale campaign-এর বাজেট ৫০০০ টাকা করো" });
    expect(res.kind).toBe("proposal");
    expect(res.proposal.actionId).toBe("set_campaign_budget");
    expect(res.proposal.moneyAdjacent).toBe(true);
    expect(res.proposal.status).toBe("proposed");
    const row = s.db.aIActionProposal.rows.find((r: any) => r.organizationId === ORG);
    expect(row.payload.requestedBudgetMinor).toBe("500000");
    expect(row.payload.currentBudgetMinor).toBe("200000");
    expect(s.executeSpy).not.toHaveBeenCalled();
  });

  it("budget ask without an amount asks for it and creates nothing", async () => {
    const s = setup();
    const res: any = await s.copilot.ask(ORG, OWNER, { question: "Eid Sale campaign-এর বাজেট বদলাও" });
    expect(res.kind).toBe("clarification");
    expect(res.candidates).toEqual([{ name: "Eid Sale", platform: "meta" }]);
    expect(s.db.aIActionProposal.rows.length).toBe(0);
  });

  it("refund ask: proposal-only wall explained, the Inbox path named, nothing created, no LLM call", async () => {
    const s = setup();
    const res: any = await s.copilot.ask(ORG, OWNER, { question: "এই customer-কে refund দাও" });
    expect(res.kind).toBe("refusal");
    expect(res.answer).toContain("Inbox");
    expect(res.answer).toContain("L5");
    expect(s.db.aIActionProposal.rows.length).toBe(0);
    expect(s.provider.complete).not.toHaveBeenCalled();
    expect(s.executeSpy).not.toHaveBeenCalled();
  });

  it("conversation act ask: deterministic refusal naming the real surface, nothing created", async () => {
    const s = setup();
    const res: any = await s.copilot.ask(ORG, OWNER, { question: "এই কথোপকথনটা বন্ধ করে দাও" });
    expect(res.kind).toBe("refusal");
    expect(res.answer).toContain("Inbox");
    expect(s.db.aIActionProposal.rows.length).toBe(0);
    expect(s.provider.complete).not.toHaveBeenCalled();
  });

  it("the action path works with NO LLM configured (it never needed one)", async () => {
    const s = setup(["x"], { realLlm: false });
    const res: any = await s.copilot.ask(ORG, OWNER, { question: "Eid Sale campaign pause করো" });
    expect(res.kind).toBe("proposal");
    expect(s.db.aIActionProposal.rows.filter((r: any) => r.organizationId === ORG).length).toBe(1);
  });
});

describe("SA-B21 Copilot — role gate", () => {
  it("the ask endpoint is OWNER/ADMIN only (MARKETING_MANAGER deliberately excluded)", () => {
    const roles = Reflect.getMetadata(ROLES_KEY, CopilotController.prototype.ask);
    expect(roles).toEqual(["OWNER", "ADMIN"]);
    expect(roles).not.toContain("MARKETING_MANAGER");
  });
});
