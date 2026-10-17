import "reflect-metadata";
import { formatMinor } from "@repo/contracts";
import { ActionEngineService } from "./action-engine.service";
import { ActionExecutorsService } from "./action-executors.service";
import { AdsActionProposerService } from "./ads-action-proposer.service";
import { AdsIntelligenceService } from "../ads-intelligence.service";
import { performancePeriod } from "../performance-learning.service";
import { EventsService } from "../../common/events.service";
import { ACTION_CATALOG, catalogAction } from "./action-catalog";

/**
 * SA-B15 (Smart AI Phase 3, A2) — Ads Actions through the
 * Action Engine:
 *  - pause/resume execute through the HUB'S OWN lifecycle
 *    paths (CampaignsService.setMetaStatus for plan campaigns,
 *    the account-scoped Meta pair for synced ones,
 *    PublishingService / draft lifecycle for Google + TikTok) —
 *    the hub services are stubbed at the service boundary in
 *    this spec (the codebase pattern: the platform client is
 *    what gets stubbed, one layer down, in the services' own
 *    suites); production code paths stay real;
 *  - the verifier re-reads platform-confirmed state: a state
 *    that does not match the target is FAILED with reason
 *    verification_mismatch and the observed state recorded —
 *    never a hopeful success; a platform failure is FAILED
 *    with the error verbatim;
 *  - set_campaign_budget is proposal-only by law (L5): approve
 *    records proposal_only, execute() refuses at L1 AND L2,
 *    and no executor exists for it at all;
 *  - the deterministic proposers (no LLM): zero-conversion
 *    spend and ROAS collapse at campaign grain propose a pause
 *    for THAT campaign only; a healthy campaign in the same
 *    digest gets none; a spend-spike-only campaign gets none;
 *    repeated digest runs dedupe through the engine;
 *  - cross-org: org B cannot approve org A's campaign
 *    proposal (404), and org A's proposer never reads org B's
 *    campaigns;
 *  - autonomy: L1 default (a pause waits for a human); at L2 a
 *    medium-risk pause still does NOT auto-execute.
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
      if ("in" in v) return (v.in as any[]).includes(row[k]);
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
      if (orderBy?.createdAt === "desc") rows = [...rows].reverse();
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
const OWNER = "owner-1";

function setup() {
  const accounts: Row[] = [
    { id: "acct-meta", organizationId: ORG, platform: "meta", integrationId: "int-meta", externalId: "act_111", name: "Meta Main", currency: "BDT", status: "ACTIVE" },
    { id: "acct-google", organizationId: ORG, platform: "google", integrationId: "int-google", externalId: "123-456", name: "Google Main", currency: "BDT", status: "ACTIVE" },
    { id: "acct-tiktok", organizationId: ORG, platform: "tiktok", integrationId: "int-tiktok", externalId: "adv-9", name: "TikTok Main", currency: "BDT", status: "ACTIVE" },
    { id: "acct-csv", organizationId: ORG, platform: "meta", integrationId: null, externalId: null, name: "CSV Meta", currency: "BDT", status: "ACTIVE" },
  ];
  const acctById = (id: string) => accounts.find((a) => a.id === id);
  const plans: Row[] = [
    {
      id: "plan-1", organizationId: ORG, name: "Eid Push", status: "published",
      externalCampaignId: "mc-plan-1", adAccountId: "acct-meta",
      metaStatus: "ACTIVE", metaEffectiveStatus: "ACTIVE",
      campaignDailyBudgetMinor: 500_000n, campaignLifetimeBudgetMinor: null, budgetMode: "cbo",
    },
    {
      id: "plan-abo", organizationId: ORG, name: "ABO Plan", status: "published",
      externalCampaignId: "mc-plan-abo", adAccountId: "acct-meta",
      metaStatus: "ACTIVE", metaEffectiveStatus: "ACTIVE",
      campaignDailyBudgetMinor: null, campaignLifetimeBudgetMinor: null, budgetMode: "abo",
    },
  ];
  const adSets: Row[] = [
    { id: "as-1", planId: "plan-abo", externalAdSetId: "as-ext-1", dailyBudgetMinor: 100_000n, lifetimeBudgetMinor: null },
    { id: "as-2", planId: "plan-abo", externalAdSetId: "as-ext-2", dailyBudgetMinor: 150_000n, lifetimeBudgetMinor: null },
  ];
  const adCampaigns: Row[] = [
    { id: "ac-g1", organizationId: ORG, adAccountId: "acct-google", externalId: "gc-1", name: "Google Search BD", status: null, adAccount: acctById("acct-google") },
    { id: "ac-t1", organizationId: ORG, adAccountId: "acct-tiktok", externalId: "tc-1", name: "TikTok Views", status: null, adAccount: acctById("acct-tiktok") },
    { id: "ac-m1", organizationId: ORG, adAccountId: "acct-meta", externalId: "mc-synced-1", name: "Ads Manager Campaign", status: null, adAccount: acctById("acct-meta") },
    { id: "ac-csv1", organizationId: ORG, adAccountId: "acct-csv", externalId: "mc-csv-1", name: "CSV Campaign", status: null, adAccount: acctById("acct-csv") },
    { id: "ac-x", organizationId: ORG, adAccountId: "acct-meta", externalId: "mx-zero", name: "Zero Conv Campaign", status: null, adAccount: acctById("acct-meta") },
    { id: "ac-w", organizationId: ORG, adAccountId: "acct-meta", externalId: "mx-collapse", name: "Collapsing Campaign", status: null, adAccount: acctById("acct-meta") },
  ];
  const drafts: Row[] = [];
  const metrics: Row[] = [];
  const proposals: Row[] = [];
  const settings: Row[] = [];
  const aiActions: Row[] = [];
  const db = {
    campaignPlan: table(plans),
    campaignAdSet: table(adSets),
    adAccount: table(accounts),
    adCampaign: table(adCampaigns),
    crossPlatformDraft: table(drafts),
    dailyAdMetric: table(metrics),
    businessProfile: table([] as Row[]),
    aIActionProposal: table(proposals),
    aiAutonomySetting: table(settings),
    aIAction: table(aiActions),
  };
  const audit = { log: jest.fn(async () => undefined) };

  // --- hub service stubs (the service boundary) ---
  // Meta plan path: mirrors setMetaStatus — Meta confirms
  // first, THEN the local record moves. `metaPlanMode` lets a
  // test simulate an unconfirmed write or a platform failure.
  const metaPlan = { mode: "write" as "write" | "nowrite" | "fail", message: "" };
  // PublishingService state: the platform's own status, keyed
  // account::platform::campaign.
  const pubState = new Map<string, string>();
  const pubKey = (acct: string, platform: string, ext: string) => `${acct}::${platform}::${ext}`;
  const pub = { mode: "write" as "write" | "nowrite" | "fail", message: "" };
  const metaAcctState = new Map<string, string>();
  const metaAcct = { mode: "write" as "write" | "nowrite" | "fail", message: "" };

  const campaigns = {
    setMetaStatus: jest.fn(async (org: string, _actor: string, planId: string, target: "ACTIVE" | "PAUSED") => {
      if (metaPlan.mode === "fail") throw new Error(metaPlan.message);
      const plan = plans.find((p) => p.id === planId && p.organizationId === org);
      if (!plan) throw new Error("plan nf");
      if (metaPlan.mode === "write") plan.metaStatus = target;
      return { ...plan };
    }),
    setMetaCampaignStatusByAccount: jest.fn(async (_org: string, _actor: string, _acct: string, ext: string, target: "ACTIVE" | "PAUSED") => {
      if (metaAcct.mode === "fail") throw new Error(metaAcct.message);
      if (metaAcct.mode === "write") metaAcctState.set(ext, target);
      return { platform: "meta", externalCampaignId: ext, status: target };
    }),
    getMetaCampaignStatusByAccount: jest.fn(async (_org: string, _acct: string, ext: string) => ({
      platform: "meta",
      externalCampaignId: ext,
      status: metaAcctState.get(ext) ?? null,
      effectiveStatus: metaAcctState.get(ext) ?? null,
    })),
    setCrossPlatformDraftLifecycle: jest.fn(async (org: string, _actor: string, planId: string, draftId: string, action: "pause" | "resume") => {
      const draft = drafts.find((d) => d.id === draftId && d.planId === planId && d.organizationId === org);
      if (!draft) throw new Error("draft nf");
      const mapped = action === "pause" ? "paused" : "active";
      pubState.set(pubKey(draft.targetAdAccountId, draft.platform, draft.externalCampaignId), mapped);
      return { providerStatus: mapped, providerStatusSource: "fresh_sync" };
    }),
  };
  const publishing = {
    crossPlatformSetCampaignStatus: jest.fn(async (_org: string, _actor: string, acct: string, platform: string, ext: string, target: "ACTIVE" | "PAUSED") => {
      if (pub.mode === "fail") throw new Error(pub.message);
      const mapped = target === "PAUSED" ? "paused" : "active";
      if (pub.mode === "write") pubState.set(pubKey(acct, platform, ext), mapped);
      return { platform, externalCampaignId: ext, providerStatus: mapped, providerStatusRaw: target === "PAUSED" ? "PAUSED" : "ENABLED" };
    }),
    crossPlatformCampaignStatus: jest.fn(async (_org: string, acct: string, platform: string, ext: string) => {
      const s = pubState.get(pubKey(acct, platform, ext));
      if (!s) throw new Error(`${platform} returned no campaign with id ${ext}; status is NOT confirmed`);
      return {
        platform,
        externalCampaignId: ext,
        providerStatus: s,
        providerStatusRaw: platform === "google" ? (s === "paused" ? "PAUSED" : "ENABLED") : s === "paused" ? "DISABLE" : "ENABLE",
      };
    }),
  };

  const executors = new ActionExecutorsService(db as any, {} as any, {} as any, campaigns as any, publishing as any);
  const engine = new ActionEngineService(db as any, audit as any, executors);
  return {
    db, engine, executors, campaigns, publishing, audit,
    plans, adCampaigns, drafts, metrics, proposals, settings,
    metaPlan, pub, metaAcct, pubState, pubKey, metaAcctState,
  };
}

type S = ReturnType<typeof setup>;

async function proposeAndApprove(s: S, actionId: string, payload: any) {
  const res: any = await s.engine.propose(ORG, actionId, payload, { proposedBy: "staff", actorUserId: OWNER });
  expect(res.ok).toBe(true);
  const finalRow: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
  return { proposed: res.proposal, finalRow };
}

describe("SA-B15 ads actions — lifecycle through the hub paths", () => {
  it("catalog integrity: b15 entries fully wired; budget is builder-only (no executor/verifier anywhere)", () => {
    const s = setup();
    for (const id of ["pause_campaign", "resume_campaign"]) {
      const entry = catalogAction(id);
      expect(entry?.surface).toBe("ads");
      expect(entry?.riskClass).toBe("medium");
      expect(entry?.moneyAdjacent).toBe(false);
      expect(entry?.undoable).toBe(true);
      expect(entry?.wiring).toBe("b15");
      expect(s.executors.builders.has(id)).toBe(true);
      expect(s.executors.executors.has(entry!.executorKey as string)).toBe(true);
      expect(s.executors.verifiers.has(entry!.verifierKey as string)).toBe(true);
    }
    const budget = catalogAction("set_campaign_budget");
    expect(budget?.moneyAdjacent).toBe(true);
    expect(budget?.executorKey).toBeNull();
    expect(budget?.verifierKey).toBeNull();
    expect(budget?.wiring).toBe("never");
    expect(s.executors.builders.has("set_campaign_budget")).toBe(true);
    expect(s.executors.executors.has("ads.set_campaign_budget")).toBe(false);
    expect(ACTION_CATALOG.filter((a) => a.surface === "ads")).toHaveLength(3);
  });

  it("Meta plan pause: executes via CampaignsService.setMetaStatus; verifier reads the confirmed plan record", async () => {
    const s = setup();
    const { proposed, finalRow } = await proposeAndApprove(s, "pause_campaign", { platform: "meta", campaignExternalId: "mc-plan-1" });
    expect(proposed.payload.route).toBe("meta_plan");
    expect(proposed.payload.campaignKey).toBe("meta::acct-meta::mc-plan-1");
    expect(s.campaigns.setMetaStatus).toHaveBeenCalledWith(ORG, OWNER, "plan-1", "PAUSED");
    expect(finalRow.status).toBe("executed");
    expect(finalRow.result.outcome).toBe("verified_success");
    expect(finalRow.verification.detail.observedStatus).toBe("PAUSED");
    expect(s.plans[0].metaStatus).toBe("PAUSED");
  });

  it("unconfirmed state → FAILED verification_mismatch with the observed state recorded (never hopeful success)", async () => {
    const s = setup();
    s.metaPlan.mode = "nowrite"; // the call resolves, but the hub record never moves
    const { finalRow } = await proposeAndApprove(s, "pause_campaign", { platform: "meta", campaignExternalId: "mc-plan-1" });
    expect(finalRow.status).toBe("failed");
    expect(finalRow.error).toBe("verification_mismatch");
    expect(finalRow.result.outcome).toBe("verification_mismatch");
    expect(finalRow.verification.detail.observedStatus).toBe("ACTIVE");
  });

  it("platform failure → FAILED with the hub's error verbatim", async () => {
    const s = setup();
    s.metaPlan.mode = "fail";
    s.metaPlan.message = "Meta did NOT confirm the status change: (#100) Graph exploded. Local status is unchanged.";
    const { finalRow } = await proposeAndApprove(s, "pause_campaign", { platform: "meta", campaignExternalId: "mc-plan-1" });
    expect(finalRow.status).toBe("failed");
    expect(finalRow.error).toBe("Meta did NOT confirm the status change: (#100) Graph exploded. Local status is unchanged.");
    expect(s.plans[0].metaStatus).toBe("ACTIVE"); // untouched
  });

  it("Google pause via PublishingService; verifier reads the live provider status back", async () => {
    const s = setup();
    s.pubState.set(s.pubKey("acct-google", "google", "gc-1"), "active");
    const { proposed, finalRow } = await proposeAndApprove(s, "pause_campaign", { platform: "google", campaignExternalId: "gc-1" });
    expect(proposed.payload.route).toBe("cross_platform");
    expect(s.publishing.crossPlatformSetCampaignStatus).toHaveBeenCalledWith(ORG, OWNER, "acct-google", "google", "gc-1", "PAUSED");
    expect(finalRow.status).toBe("executed");
    expect(finalRow.verification.detail.observedStatus).toBe("paused");
    expect(finalRow.verification.detail.observedStatusRaw).toBe("PAUSED");
  });

  it("Google unconfirmed (provider still reports active) → FAILED verification_mismatch", async () => {
    const s = setup();
    s.pubState.set(s.pubKey("acct-google", "google", "gc-1"), "active");
    s.pub.mode = "nowrite";
    const { finalRow } = await proposeAndApprove(s, "pause_campaign", { platform: "google", campaignExternalId: "gc-1" });
    expect(finalRow.status).toBe("failed");
    expect(finalRow.error).toBe("verification_mismatch");
    expect(finalRow.verification.detail.observedStatus).toBe("active");
  });

  it("TikTok resume mirrors pause (target ACTIVE, provider read-back active)", async () => {
    const s = setup();
    s.pubState.set(s.pubKey("acct-tiktok", "tiktok", "tc-1"), "paused");
    const { finalRow } = await proposeAndApprove(s, "resume_campaign", { platform: "tiktok", campaignExternalId: "tc-1" });
    expect(s.publishing.crossPlatformSetCampaignStatus).toHaveBeenCalledWith(ORG, OWNER, "acct-tiktok", "tiktok", "tc-1", "ACTIVE");
    expect(finalRow.status).toBe("executed");
    expect(finalRow.verification.detail.observedStatus).toBe("active");
  });

  it("Meta synced (non-plan) campaign rides the account-scoped hub pair; live read-back verifies", async () => {
    const s = setup();
    s.metaAcctState.set("mc-synced-1", "ACTIVE");
    const { proposed, finalRow } = await proposeAndApprove(s, "pause_campaign", { platform: "meta", campaignExternalId: "mc-synced-1" });
    expect(proposed.payload.route).toBe("meta_account");
    expect(s.campaigns.setMetaCampaignStatusByAccount).toHaveBeenCalledWith(ORG, OWNER, "acct-meta", "mc-synced-1", "PAUSED");
    expect(s.campaigns.getMetaCampaignStatusByAccount).toHaveBeenCalledWith(ORG, "acct-meta", "mc-synced-1");
    expect(finalRow.status).toBe("executed");
    expect(finalRow.verification.detail.observedStatus).toBe("PAUSED");
  });

  it("plan-created Google draft rides the draft lifecycle (the dashboard path)", async () => {
    const s = setup();
    s.drafts.push({ id: "draft-1", organizationId: ORG, planId: "plan-g1", platform: "google", targetAdAccountId: "acct-google", status: "created", externalCampaignId: "gc-draft-1", fields: {} });
    s.pubState.set(s.pubKey("acct-google", "google", "gc-draft-1"), "active");
    const { proposed, finalRow } = await proposeAndApprove(s, "pause_campaign", { platform: "google", campaignExternalId: "gc-draft-1" });
    expect(proposed.payload.route).toBe("cross_draft");
    expect(s.campaigns.setCrossPlatformDraftLifecycle).toHaveBeenCalledWith(ORG, OWNER, "plan-g1", "draft-1", "pause");
    expect(finalRow.status).toBe("executed");
  });

  it("builder refusals name the gap: CSV account, unknown campaign, already-paused plan, foreign org target", async () => {
    const s = setup();
    await expect(
      s.engine.propose(ORG, "pause_campaign", { platform: "meta", campaignExternalId: "mc-csv-1" }, { proposedBy: "staff", actorUserId: OWNER }),
    ).rejects.toThrow(/API দিয়ে connected নয়/);
    await expect(
      s.engine.propose(ORG, "pause_campaign", { platform: "meta", campaignExternalId: "nope" }, { proposedBy: "staff", actorUserId: OWNER }),
    ).rejects.toThrow(/কোনো record নেই/);
    s.plans[0].metaStatus = "PAUSED";
    await expect(
      s.engine.propose(ORG, "pause_campaign", { platform: "meta", campaignExternalId: "mc-plan-1" }, { proposedBy: "staff", actorUserId: OWNER }),
    ).rejects.toThrow(/ইতিমধ্যে বন্ধ/);
    // org B cannot even build a proposal against org A's campaign
    await expect(
      s.engine.propose(ORG_B, "pause_campaign", { platform: "meta", campaignExternalId: "mc-synced-1" }, { proposedBy: "staff", actorUserId: "owner-b" }),
    ).rejects.toThrow(/কোনো record নেই/);
    expect(s.proposals).toHaveLength(0);
  });
});

describe("SA-B15 ads actions — the budget wall (L5) + autonomy in this context", () => {
  it("budget proposal: preview states current (hub record) + requested; approve → proposal_only; execute() refuses at L1 and L2", async () => {
    const s = setup();
    const res: any = await s.engine.propose(
      ORG,
      "set_campaign_budget",
      { platform: "meta", campaignExternalId: "mc-plan-1", requestedBudgetMinor: "800000" },
      { proposedBy: "staff", actorUserId: OWNER },
    );
    expect(res.ok).toBe(true);
    expect(res.proposal.payload.currentBudgetMinor).toBe("500000");
    expect(res.proposal.payload.currentBudgetSource).toBe("campaign_plan_record");
    expect(res.proposal.preview).toContain(formatMinor(500_000n, "BDT"));
    expect(res.proposal.preview).toContain(formatMinor(800_000n, "BDT"));
    expect(res.proposal.preview).toContain("শুধুমাত্র একটি প্রস্তাব");

    const approved: any = await s.engine.approve(ORG, OWNER, res.proposal.id);
    expect(approved.status).toBe("approved"); // never "executed"
    expect(approved.result.outcome).toBe("proposal_only");

    const exec1: any = await s.engine.execute(ORG, OWNER, res.proposal.id);
    expect(exec1).toMatchObject({ ok: false, reason: "money_adjacent_proposal_only" });

    // L2 changes nothing for money (the wall is not an autonomy setting).
    await s.engine.setAutonomy(ORG, "set_campaign_budget", 2, OWNER);
    const res2: any = await s.engine.propose(
      ORG,
      "set_campaign_budget",
      { platform: "meta", campaignExternalId: "mc-plan-1", requestedBudgetMinor: "900000" },
      { proposedBy: "staff", actorUserId: OWNER },
    );
    expect(res2.ok).toBe(true);
    expect(res2.autoExecuted).toBe(false);
    const approved2: any = await s.engine.approve(ORG, OWNER, res2.proposal.id);
    expect(approved2.result.outcome).toBe("proposal_only");
    const exec2: any = await s.engine.execute(ORG, OWNER, res2.proposal.id);
    expect(exec2).toMatchObject({ ok: false, reason: "money_adjacent_proposal_only" });
    // and no budget executor was ever invoked into existence
    expect(s.proposals.every((p) => p.status !== "executed")).toBe(true);
  });

  it("budget current read falls back to the plan's ad-set sum (ABO), and refuses targets with no honest budget source", async () => {
    const s = setup();
    const res: any = await s.engine.propose(
      ORG,
      "set_campaign_budget",
      { platform: "meta", campaignExternalId: "mc-plan-abo", requestedBudgetMinor: 300_000 },
      { proposedBy: "staff", actorUserId: OWNER },
    );
    expect(res.ok).toBe(true);
    expect(res.proposal.payload.currentBudgetMinor).toBe("250000"); // 100_000 + 150_000
    expect(res.proposal.payload.currentBudgetSource).toBe("campaign_plan_ad_sets_record");
    // synced non-plan campaign: no budget read exists on this line → named refusal, no invented number
    await expect(
      s.engine.propose(
        ORG,
        "set_campaign_budget",
        { platform: "meta", campaignExternalId: "mc-synced-1", requestedBudgetMinor: "100000" },
        { proposedBy: "staff", actorUserId: OWNER },
      ),
    ).rejects.toThrow(/বর্তমান বাজেট এই system-এ পড়ার কোনো পথ নেই/);
    await expect(
      s.engine.propose(
        ORG,
        "set_campaign_budget",
        { platform: "google", campaignExternalId: "gc-1", requestedBudgetMinor: "100000" },
        { proposedBy: "staff", actorUserId: OWNER },
      ),
    ).rejects.toThrow(/বর্তমান বাজেট এই system-এ পড়ার কোনো পথ নেই/);
  });

  it("autonomy in the ads context: L1 default waits; L2 never auto-executes a medium pause; L0 refuses", async () => {
    const s = setup();
    // L1 (default): propose only.
    const r1: any = await s.engine.propose(ORG, "pause_campaign", { platform: "google", campaignExternalId: "gc-1" }, { proposedBy: "ai", actorUserId: null });
    expect(r1.ok).toBe(true);
    expect(r1.autoExecuted).toBe(false);
    expect(r1.proposal.status).toBe("proposed");
    expect(s.publishing.crossPlatformSetCampaignStatus).not.toHaveBeenCalled();
    // L2: medium risk still waits for a human.
    await s.engine.setAutonomy(ORG, "pause_campaign", 2, OWNER);
    const r2: any = await s.engine.propose(ORG, "pause_campaign", { platform: "tiktok", campaignExternalId: "tc-1" }, { proposedBy: "ai", actorUserId: null });
    expect(r2.ok).toBe(true);
    expect(r2.autoExecuted).toBe(false);
    expect(r2.proposal.status).toBe("proposed");
    expect(r2.proposal.autonomyLevel).toBe(2);
    expect(s.publishing.crossPlatformSetCampaignStatus).not.toHaveBeenCalled();
    // L0: refused, no row.
    await s.engine.setAutonomy(ORG, "resume_campaign", 0, OWNER);
    const r3: any = await s.engine.propose(ORG, "resume_campaign", { platform: "google", campaignExternalId: "gc-1" }, { proposedBy: "ai", actorUserId: null });
    expect(r3).toMatchObject({ ok: false, reason: "autonomy_off" });
  });

  it("cross-org: org B cannot approve or execute org A's campaign proposal (404 by design)", async () => {
    const s = setup();
    const res: any = await s.engine.propose(ORG, "pause_campaign", { platform: "google", campaignExternalId: "gc-1" }, { proposedBy: "staff", actorUserId: OWNER });
    await expect(s.engine.approve(ORG_B, "owner-b", res.proposal.id)).rejects.toThrow(/not found/i);
    await expect(s.engine.execute(ORG_B, "owner-b", res.proposal.id)).rejects.toThrow(/not found/i);
    expect(await s.engine.listProposals(ORG_B)).toHaveLength(0);
    expect(s.proposals[0].status).toBe("proposed"); // untouched
  });
});

// ---------------- proposer fixtures ----------------

function metric(org: string, acct: string, platform: string, ext: string, date: Date, spend: number, conv: number, value: number, extra: Partial<Row> = {}): Row {
  return {
    organizationId: org, adAccountId: acct, adCampaignId: null, platform, source: "api",
    campaignExternalId: ext, adSetExternalId: "", adExternalId: "", campaignName: ext,
    date, currency: "BDT", spendMinor: BigInt(spend), impressions: 5000, clicks: 100,
    platformConversions: conv, platformConversionValueMinor: BigInt(value), ...extra,
  };
}

function seedDigestMetrics(s: S) {
  const now = new Date();
  const cur = performancePeriod(7, now);
  const curDay = new Date(cur.start.getTime() + 36 * 3600 * 1000);
  const priorDay = new Date(cur.start.getTime() - 36 * 3600 * 1000);
  // X — zero-conversion burner: ৳2,000 spent, 0 conversions (campaign-level rows only count).
  s.metrics.push(metric(ORG, "acct-meta", "meta", "mx-zero", curDay, 200_000, 0, 0));
  s.metrics.push(metric(ORG, "acct-meta", "meta", "mx-zero", curDay, 999_999, 0, 0, { adSetExternalId: "set-1" })); // ad-set row — must be ignored
  s.metrics.push(metric(ORG, "acct-meta", "meta", "mx-zero", priorDay, 50_000, 2, 100_000));
  // Y — healthy: strong ROAS both windows → no proposal.
  s.metrics.push(metric(ORG, "acct-meta", "meta", "mx-healthy", curDay, 300_000, 10, 900_000));
  s.metrics.push(metric(ORG, "acct-meta", "meta", "mx-healthy", priorDay, 280_000, 9, 840_000));
  // Z — spend spike ONLY: spend doubled, conversions + ROAS intact → NO pause (legitimate growth shape).
  s.metrics.push(metric(ORG, "acct-meta", "meta", "mx-spike", curDay, 200_000, 10, 600_000));
  s.metrics.push(metric(ORG, "acct-meta", "meta", "mx-spike", priorDay, 100_000, 5, 300_000));
  // W — ROAS collapse: 2.0 → 1.0 (−50%), both windows ≥ ৳1,000 → pause proposed.
  s.metrics.push(metric(ORG, "acct-meta", "meta", "mx-collapse", curDay, 200_000, 4, 200_000));
  s.metrics.push(metric(ORG, "acct-meta", "meta", "mx-collapse", priorDay, 200_000, 8, 400_000));
  // Org B's burner — org A's evaluation must never see it.
  s.metrics.push(metric(ORG_B, "acct-b", "meta", "mb-zero", curDay, 500_000, 0, 0));
}

describe("SA-B15 ads proposers — deterministic, campaign-grain, deduped, org-isolated", () => {
  it("proposes pause for the flagged campaigns only (zero-conv + collapse); healthy and spike-only get none", async () => {
    const s = setup();
    seedDigestMetrics(s);
    const proposer = new AdsActionProposerService(s.db as any, s.engine, new EventsService());
    const candidates = await proposer.evaluateCampaigns(ORG, { days: 7 });
    expect(candidates.map((c) => `${c.campaignExternalId}:${c.rule}`).sort()).toEqual([
      "mx-collapse:roas_collapse",
      "mx-zero:zero_conversion_spend",
    ]);
    // the ad-set-level row never inflates the campaign evidence
    const zero = candidates.find((c) => c.campaignExternalId === "mx-zero");
    expect(zero?.evidence.spendMinor).toBe("200000");

    const r = await proposer.evaluateAndPropose(ORG, { days: 7 });
    expect(r).toEqual({ candidates: 2, proposed: 2 });
    const rows = s.proposals.filter((p) => p.actionId === "pause_campaign");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.proposedBy).toBe("ai");
      expect(row.status).toBe("proposed"); // L1: waits for a human
      expect(row.sourceRef.source).toBe("ads_digest");
      expect(row.sourceRef.periodStart).toBeTruthy();
      expect(row.sourceRef.periodEnd).toBeTruthy();
    }
    expect(rows.map((p) => p.sourceRef.rule).sort()).toEqual(["roas_collapse", "zero_conversion_spend"]);
    expect(rows.map((p) => p.payload.campaignExternalId).sort()).toEqual(["mx-collapse", "mx-zero"]);
    // nothing executed: no hub lifecycle call was made by proposing
    expect(s.campaigns.setMetaStatus).not.toHaveBeenCalled();
    expect(s.campaigns.setMetaCampaignStatusByAccount).not.toHaveBeenCalled();
  });

  it("dedupe on repeated digest runs: the second run files nothing new", async () => {
    const s = setup();
    seedDigestMetrics(s);
    const proposer = new AdsActionProposerService(s.db as any, s.engine, new EventsService());
    const first = await proposer.evaluateAndPropose(ORG, { days: 7 });
    expect(first.proposed).toBe(2);
    const second = await proposer.evaluateAndPropose(ORG, { days: 7 });
    expect(second.candidates).toBe(2);
    expect(second.proposed).toBe(0); // engine dedupe returned the open rows
    expect(s.proposals.filter((p) => p.actionId === "pause_campaign")).toHaveLength(2);
  });

  it("org isolation: org A's proposer never reads org B's campaigns; org B's unresolvable burner files nothing", async () => {
    const s = setup();
    seedDigestMetrics(s);
    const proposer = new AdsActionProposerService(s.db as any, s.engine, new EventsService());
    const aCandidates = await proposer.evaluateCampaigns(ORG, { days: 7 });
    expect(aCandidates.some((c) => c.campaignExternalId === "mb-zero")).toBe(false);
    const bResult = await proposer.evaluateAndPropose(ORG_B, { days: 7 });
    expect(bResult.candidates).toBe(1); // org B's own burner IS evaluated for org B…
    expect(bResult.proposed).toBe(0); // …but it has no AdCampaign record, so the builder refuses — no fake proposal
    expect(s.proposals.filter((p) => p.organizationId === ORG_B)).toHaveLength(0);
  });

  it("end-to-end on the digest path: suggestFindings announces → proposer files the pauses (fire-and-forget safe)", async () => {
    const s = setup();
    seedDigestMetrics(s);
    const events = new EventsService();
    const proposer = new AdsActionProposerService(s.db as any, s.engine, events);
    proposer.onModuleInit();
    const learning = {
      createSuggestion: jest.fn(async () => ({ created: false })),
      saveState: jest.fn(async () => undefined),
    };
    const intel = new AdsIntelligenceService(s.db as any, learning as any, undefined, events);
    const out = await intel.suggestFindings(ORG, { now: new Date() });
    expect(out.digest.hasData).toBe(true);
    // the bus dispatches asynchronously — give the handler its ticks
    await new Promise((r) => setTimeout(r, 30));
    const rows = s.proposals.filter((p) => p.actionId === "pause_campaign" && p.organizationId === ORG);
    expect(rows.map((p) => p.payload.campaignExternalId).sort()).toEqual(["mx-collapse", "mx-zero"]);
  });
});
