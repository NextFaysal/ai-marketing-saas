import "reflect-metadata";
import { ActionEngineService } from "./action-engine.service";
import { ActionExecutorsService } from "./action-executors.service";
import { CompetitorActionProposerService } from "./competitor-action-proposer.service";
import { CompetitorIntelligenceService } from "../competitor-intelligence.service";
import { EventsService } from "../../common/events.service";

/**
 * SA-B18 (Smart AI Phase 4, C2) — the ONE adopted
 * competitor→engine bridge: launch burst → resume_campaign.
 *
 * Guarantees proven here:
 *  - the rule fires exactly as stated in Step 0: a burst at
 *    C1's threshold (>=5 new ads in 7d, from the digest) AND
 *    an own CampaignPlan whose metaStatus is "PAUSED" (the
 *    Meta-confirmed paused state — SA-B15) -> ONE
 *    resume_campaign proposal naming the burst in sourceRef;
 *  - it proposes at the engine's default L1 and executes
 *    NOTHING (the hub lifecycle stub is never called); at L2
 *    a medium-risk resume STILL does not auto-execute;
 *  - no burst -> nothing; burst with no paused plan ->
 *    nothing; a paused plan without an externalCampaignId is
 *    not a bridge target (no honest platform identity);
 *  - the freshest paused plan is the target; ACTIVE plans are
 *    never proposed; repeat evaluations dedupe through the
 *    engine's open-proposal wall;
 *  - cross-org: org A's paused plan is never proposed from
 *    org B's burst, and an org with no competitors proposes
 *    nothing;
 *  - the findings path drives it end-to-end on the bus.
 *
 * Fake prisma only — no live DB, no live platform call.
 */
type Row = Record<string, any>;

function eqVal(a: any, b: any): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  return a === b;
}
function match(row: Row, where: any = {}): boolean {
  return Object.entries(where ?? {}).every(([k, raw]) => {
    const v = raw as any;
    if (k === "organizationId_actionId" && v && typeof v === "object") {
      return row.organizationId === v.organizationId && row.actionId === v.actionId;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("gte" in v || "gt" in v || "lte" in v || "lt" in v) {
        const t = row[k] instanceof Date ? row[k].getTime() : new Date(row[k]).getTime();
        if ("gte" in v && !(t >= new Date(v.gte).getTime())) return false;
        if ("gt" in v && !(t > new Date(v.gt).getTime())) return false;
        if ("lte" in v && !(t <= new Date(v.lte).getTime())) return false;
        if ("lt" in v && !(t < new Date(v.lt).getTime())) return false;
        return true;
      }
      if ("in" in v) return (v.in as any[]).some((x) => eqVal(x, row[k]));
      if ("not" in v) {
        if (v.not === null) return row[k] !== null && row[k] !== undefined;
        return !eqVal(row[k], v.not);
      }
      return true;
    }
    return eqVal(row[k], v);
  });
}
function table(store: Row[]) {
  const findFirst = jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null);
  return {
    findMany: jest.fn(async ({ where, take, orderBy }: any = {}) => {
      let rows = store.filter((r) => match(r, where));
      const spec = Array.isArray(orderBy) ? orderBy[0] : orderBy;
      if (spec) {
        const [field, dir] = Object.entries(spec)[0] as [string, string];
        rows = [...rows].sort((a, b) => {
          const av = a[field] instanceof Date ? a[field].getTime() : a[field];
          const bv = b[field] instanceof Date ? b[field].getTime() : b[field];
          return dir === "desc" ? (bv > av ? 1 : bv < av ? -1 : 0) : av > bv ? 1 : av < bv ? -1 : 0;
        });
      }
      return take ? rows.slice(0, take) : rows;
    }),
    findFirst,
    findUnique: findFirst,
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      store.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((r) => r.id === where.id || match(r, where));
      if (!row) throw new Error("nf");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let n = 0;
      for (const r of store) if (match(r, where)) { Object.assign(r, data, { updatedAt: new Date() }); n++; }
      return { count: n };
    }),
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const row = store.find((r) => match(r, where));
      if (row) { Object.assign(row, update, { updatedAt: new Date() }); return row; }
      const created = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      store.push(created);
      return created;
    }),
    count: jest.fn(async ({ where }: any = {}) => store.filter((r) => match(r, where)).length),
  };
}

const ORG = "org-1";
const ORG_B = "org-2";
const NOW = new Date("2026-10-17T12:00:00.000Z");
const D = (iso: string) => new Date(iso);

let adSeq = 0;
function burstAds(competitorId: string, n: number) {
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    adSeq++;
    rows.push({
      id: `cad-${adSeq}`, competitorId, externalAdId: `ext-${adSeq}`,
      pageId: "pg1", pageName: "Page", startedAt: D(`2026-10-${12 + i}T10:00:00.000Z`), stoppedAt: null,
      isActive: true, platforms: ["facebook"], creativeText: "ad copy", linkUrl: null, snapshotUrl: null,
      firstSeenAt: D(`2026-10-${12 + i}T10:00:00.000Z`), lastSeenAt: D(`2026-10-${12 + i}T10:00:00.000Z`), raw: null,
    });
  }
  return rows;
}

function setup() {
  const competitors: Row[] = [];
  const competitorAds: Row[] = [];
  const observations: Row[] = [];
  const accounts: Row[] = [
    { id: "acct-meta", organizationId: ORG, platform: "meta", integrationId: "int-meta", externalId: "act_111", name: "Meta Main", currency: "BDT", status: "ACTIVE" },
  ];
  const plans: Row[] = [];
  const proposals: Row[] = [];
  const settings: Row[] = [];
  const aiActions: Row[] = [];
  const db = {
    competitor: table(competitors),
    competitorAd: table(competitorAds),
    competitorPriceObservation: table(observations),
    campaignPlan: table(plans),
    campaignAdSet: table([] as Row[]),
    adAccount: table(accounts),
    adCampaign: table([] as Row[]),
    crossPlatformDraft: table([] as Row[]),
    dailyAdMetric: table([] as Row[]),
    businessProfile: table([] as Row[]),
    aIActionProposal: table(proposals),
    aiAutonomySetting: table(settings),
    aIAction: table(aiActions),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const campaigns = {
    setMetaStatus: jest.fn(async () => ({ ok: true })),
    setMetaCampaignStatusByAccount: jest.fn(async () => ({ ok: true })),
    getMetaCampaignStatusByAccount: jest.fn(async () => ({ status: "PAUSED" })),
  };
  const publishing = {
    crossPlatformSetCampaignStatus: jest.fn(async () => ({ ok: true })),
    crossPlatformCampaignStatus: jest.fn(async () => ({ providerStatus: "paused" })),
  };
  const executors = new ActionExecutorsService(db as any, {} as any, {} as any, campaigns as any, publishing as any);
  const engine = new ActionEngineService(db as any, audit as any, executors);
  const intelligence = new CompetitorIntelligenceService(db as any);
  const events = new EventsService();
  const proposer = new CompetitorActionProposerService(db as any, engine, events, intelligence);
  return { db, engine, intelligence, events, proposer, campaigns, proposals, settings, plans, competitors, competitorAds };
}

function seedBurst(s: ReturnType<typeof setup>, org = ORG, ads = 6) {
  s.competitors.push({ id: "comp-1", organizationId: org, name: "Loud Rival", facebookPageId: null, facebookPageUrl: null, websiteUrl: null, notes: null, createdAt: D("2026-08-01T00:00:00.000Z"), updatedAt: D("2026-08-01T00:00:00.000Z") });
  s.competitorAds.push(...burstAds("comp-1", ads));
}
function seedPausedPlan(s: ReturnType<typeof setup>, over: Row = {}) {
  s.plans.push({
    id: "plan-paused", organizationId: ORG, name: "Paused Push", status: "published",
    externalCampaignId: "mc-paused", adAccountId: "acct-meta",
    metaStatus: "PAUSED", metaEffectiveStatus: "PAUSED",
    campaignDailyBudgetMinor: 300_000n, campaignLifetimeBudgetMinor: null, budgetMode: "cbo",
    createdAt: D("2026-09-01T00:00:00.000Z"), updatedAt: D("2026-10-10T00:00:00.000Z"),
    ...over,
  });
}

describe("CompetitorActionProposerService — launch burst -> resume_campaign", () => {
  it("burst + Meta-confirmed paused plan -> ONE resume proposal at L1, nothing executed", async () => {
    const s = setup();
    seedBurst(s);
    seedPausedPlan(s);
    const out = await s.proposer.evaluateAndPropose(ORG, { now: NOW });
    expect(out).toEqual({ bursts: 1, pausedPlans: 1, proposed: 1 });
    expect(s.proposals).toHaveLength(1);
    const p = s.proposals[0];
    expect(p.organizationId).toBe(ORG);
    expect(p.actionId).toBe("resume_campaign");
    expect(p.proposedBy).toBe("ai");
    expect(p.status).toBe("proposed"); // L1 default: a human decides
    expect(p.payload.campaignExternalId).toBe("mc-paused");
    expect(p.payload.campaignKey).toBe("meta::acct-meta::mc-paused");
    expect(p.sourceRef).toMatchObject({
      source: "competitor_burst", rule: "launch_burst",
      competitorId: "comp-1", competitorName: "Loud Rival", newAds7d: 6, planId: "plan-paused",
    });
    // Nothing executed: the hub lifecycle path was never touched.
    expect(s.campaigns.setMetaStatus).not.toHaveBeenCalled();
    expect(s.plans[0].metaStatus).toBe("PAUSED");
  });

  it("targets the freshest paused plan; an ACTIVE plan is never the target", async () => {
    const s = setup();
    seedBurst(s);
    seedPausedPlan(s, { id: "plan-old", externalCampaignId: "mc-old", updatedAt: D("2026-09-15T00:00:00.000Z") });
    s.plans.push({
      id: "plan-new", organizationId: ORG, name: "Newer Paused", status: "published",
      externalCampaignId: "mc-new", adAccountId: "acct-meta",
      metaStatus: "PAUSED", metaEffectiveStatus: "PAUSED",
      campaignDailyBudgetMinor: null, campaignLifetimeBudgetMinor: null, budgetMode: "cbo",
      createdAt: D("2026-09-02T00:00:00.000Z"), updatedAt: D("2026-10-16T00:00:00.000Z"),
    });
    s.plans.push({
      id: "plan-live", organizationId: ORG, name: "Live One", status: "published",
      externalCampaignId: "mc-live", adAccountId: "acct-meta",
      metaStatus: "ACTIVE", metaEffectiveStatus: "ACTIVE",
      campaignDailyBudgetMinor: null, campaignLifetimeBudgetMinor: null, budgetMode: "cbo",
      createdAt: D("2026-09-03T00:00:00.000Z"), updatedAt: D("2026-10-17T00:00:00.000Z"),
    });
    const out = await s.proposer.evaluateAndPropose(ORG, { now: NOW });
    expect(out.proposed).toBe(1);
    expect(s.proposals).toHaveLength(1);
    expect(s.proposals[0].payload.campaignExternalId).toBe("mc-new");
    expect(s.proposals[0].sourceRef.planId).toBe("plan-new");
  });

  it("burst with NO paused plan proposes nothing", async () => {
    const s = setup();
    seedBurst(s);
    const out = await s.proposer.evaluateAndPropose(ORG, { now: NOW });
    expect(out).toEqual({ bursts: 1, pausedPlans: 0, proposed: 0, reason: "no_paused_campaign" });
    expect(s.proposals).toHaveLength(0);
  });

  it("a paused plan without an externalCampaignId is not a bridge target", async () => {
    const s = setup();
    seedBurst(s);
    seedPausedPlan(s, { externalCampaignId: null });
    const out = await s.proposer.evaluateAndPropose(ORG, { now: NOW });
    expect(out.reason).toBe("no_paused_campaign");
    expect(s.proposals).toHaveLength(0);
  });

  it("below the burst threshold (4 new ads) nothing is proposed, paused plan or not", async () => {
    const s = setup();
    seedBurst(s, ORG, 4);
    seedPausedPlan(s);
    const out = await s.proposer.evaluateAndPropose(ORG, { now: NOW });
    expect(out).toEqual({ bursts: 0, pausedPlans: 0, proposed: 0, reason: "no_launch_burst" });
    expect(s.proposals).toHaveLength(0);
  });

  it("repeat evaluations dedupe through the engine's open-proposal wall", async () => {
    const s = setup();
    seedBurst(s);
    seedPausedPlan(s);
    const first = await s.proposer.evaluateAndPropose(ORG, { now: NOW });
    const second = await s.proposer.evaluateAndPropose(ORG, { now: NOW });
    expect(first.proposed).toBe(1);
    expect(second.proposed).toBe(0);
    expect(s.proposals).toHaveLength(1);
  });

  it("at L2 a medium-risk resume STILL waits for a human (no auto-execution)", async () => {
    const s = setup();
    seedBurst(s);
    seedPausedPlan(s);
    s.settings.push({ id: "set-1", organizationId: ORG, actionId: "resume_campaign", level: 2, createdAt: new Date(), updatedAt: new Date() });
    const out = await s.proposer.evaluateAndPropose(ORG, { now: NOW });
    expect(out.proposed).toBe(1);
    expect(s.proposals[0].status).toBe("proposed");
    expect(s.campaigns.setMetaStatus).not.toHaveBeenCalled();
  });

  it("cross-org: org B's burst never proposes org A's paused plan; no competitors -> nothing", async () => {
    const s = setup();
    seedBurst(s, ORG_B);
    seedPausedPlan(s); // org A's plan
    const outB = await s.proposer.evaluateAndPropose(ORG_B, { now: NOW });
    expect(outB).toEqual({ bursts: 1, pausedPlans: 0, proposed: 0, reason: "no_paused_campaign" });
    const outA = await s.proposer.evaluateAndPropose(ORG, { now: NOW });
    expect(outA.reason).toBe("no_competitors_tracked");
    expect(s.proposals).toHaveLength(0);
  });

  it("end-to-end on the findings path: suggestFindings announces -> the bridge files the proposal", async () => {
    const s = setup();
    seedBurst(s);
    seedPausedPlan(s);
    s.proposer.onModuleInit();
    const learning = {
      createSuggestion: jest.fn(async () => ({ created: true })),
      saveState: jest.fn(async () => undefined),
    };
    const intel = new CompetitorIntelligenceService(s.db as any, learning as any, s.events);
    const out = await intel.suggestFindings(ORG, { now: NOW });
    expect(out.digest.hasData).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(s.proposals).toHaveLength(1);
    expect(s.proposals[0].actionId).toBe("resume_campaign");
    expect(s.proposals[0].status).toBe("proposed");
  });
});
