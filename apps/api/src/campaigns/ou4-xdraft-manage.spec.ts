import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * OU4 (part 1): cross-platform draft status sync + lifecycle.
 * CampaignsService is driven with an in-memory prisma (CN9
 * harness style) and a STUBBED publishing object — the stub
 * records every provider call, returns a fresh-sync status
 * reflecting the last confirmed target, and can be told to
 * fail, so the tests pin: sync available true/false, the
 * no-external-id path, pause success + publish log, the
 * resume access gate blocking the provider call, and a
 * provider failure leaving local state unchanged.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("not" in v) return row[k] !== (v as any).not;
      return true;
    }
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findUnique: async ({ where }: any = {}) => rows.find((r) => r.id === where.id) ?? null,
    findMany: async ({ where, take }: any = {}) => { const f = rows.filter((r) => matches(r, where ?? {})); return take ? f.slice(0, take) : f; },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
  };
}

function setup(opts: { statusError?: string; setError?: string; freshSyncFails?: boolean } = {}) {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "crossPlatformDraft", "platformPublication", "membership"]) tables[n] = makeTable(n);
  tables.campaignPlan.rows.push({ id: "plan-1", organizationId: "org", adAccountId: "acc-1", name: "Launch", objective: "OUTCOME_SALES", status: "approved", createdById: "u1" });
  tables.crossPlatformDraft.rows.push(
    { id: "xd-g", organizationId: "org", planId: "plan-1", platform: "google", targetAdAccountId: "acc-g", status: "created", externalCampaignId: "g-camp-1", fields: { name: "Sale" }, createdById: "u1", createdAt: new Date() },
    { id: "xd-noext", organizationId: "org", planId: "plan-1", platform: "tiktok", targetAdAccountId: "acc-t", status: "mapped", externalCampaignId: null, fields: { name: "Draft only" }, createdById: "u1", createdAt: new Date() },
  );
  const calls: any[] = [];
  let current = "paused";
  const publishing = {
    calls,
    crossPlatformCampaignStatus: async (_org: string, adAccountId: string, platform: string, externalCampaignId: string) => {
      calls.push({ kind: "status", adAccountId, platform, externalCampaignId });
      if (opts.statusError) throw new Error(opts.statusError);
      if (opts.freshSyncFails && calls.some((c: any) => c.kind === "set")) throw new Error("fresh read down");
      return {
        platform, externalCampaignId, name: "Sale",
        providerStatus: current,
        providerStatusRaw: platform === "google" ? (current === "active" ? "ENABLED" : "PAUSED") : (current === "active" ? "ENABLE" : "DISABLE"),
      };
    },
    crossPlatformSetCampaignStatus: async (_org: string, _actor: string, adAccountId: string, platform: string, externalCampaignId: string, target: string) => {
      calls.push({ kind: "set", adAccountId, platform, externalCampaignId, target });
      if (opts.setError) throw new Error(opts.setError);
      current = target === "ACTIVE" ? "active" : "paused";
      return { platform, externalCampaignId, providerStatus: current, providerStatusRaw: target };
    },
  };
  const auditCalls: any[] = [];
  const audit = { log: async (e: any) => { auditCalls.push(e); } } as any;
  const svc = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any, publishing as any);
  return { tables, svc, calls, auditCalls, publishing };
}

describe("OU4 syncCrossPlatformDraftStatus — real provider read", () => {
  it("available:true carries the mapped + raw provider status and a syncedAt", async () => {
    const { svc } = setup();
    const out: any = await svc.syncCrossPlatformDraftStatus("org", "plan-1", "xd-g");
    expect(out.available).toBe(true);
    expect(out.providerStatus).toBe("paused");
    expect(out.providerStatusRaw).toBe("PAUSED");
    expect(out.name).toBe("Sale");
    expect(out.status).toBe("created");
    expect(out.externalCampaignId).toBe("g-camp-1");
    expect(typeof out.syncedAt).toBe("string");
    expect(() => new Date(out.syncedAt).toISOString()).not.toThrow();
  });

  it("provider/config errors come back available:false with the message verbatim — sync does not throw", async () => {
    const msg = "Google Ads campaign status failed (403): developer token not approved";
    const { svc } = setup({ statusError: msg });
    const out: any = await svc.syncCrossPlatformDraftStatus("org", "plan-1", "xd-g");
    expect(out.available).toBe(false);
    expect(out.reason).toBe(msg);
    expect(out.status).toBe("created");
    expect(out.externalCampaignId).toBe("g-camp-1");
  });

  it("no externalCampaignId → specific Bengali reason and the provider is never called", async () => {
    const { svc, calls } = setup();
    const out: any = await svc.syncCrossPlatformDraftStatus("org", "plan-1", "xd-noext");
    expect(out.available).toBe(false);
    expect(out.reason).toContain("External Campaign ID নেই");
    expect(out.externalCampaignId).toBeNull();
    expect(calls.length).toBe(0);
  });

  it("no publishing service → available:false, still no throw", async () => {
    const { tables } = setup();
    const svc = new CampaignsService(tables as any, { log: async () => undefined } as any, { getProvider: () => new DevTemplateProvider() } as any);
    const out: any = await svc.syncCrossPlatformDraftStatus("org", "plan-1", "xd-g");
    expect(out.available).toBe(false);
    expect(out.reason).toContain("উপলব্ধ নয়");
    expect(out.statusLabel).toBe("as_created");
  });
});

describe("OU4 setCrossPlatformDraftLifecycle", () => {
  it("pause success: provider called with PAUSED, success publish log + audit, fresh-sync status returned", async () => {
    const { svc, tables, calls, auditCalls } = setup();
    const out: any = await svc.setCrossPlatformDraftLifecycle("org", "u1", "plan-1", "xd-g", "pause");
    expect(calls.find((c: any) => c.kind === "set")).toMatchObject({ platform: "google", externalCampaignId: "g-camp-1", target: "PAUSED", adAccountId: "acc-g" });
    expect(out.providerStatus).toBe("paused");
    expect(out.providerStatusRaw).toBe("PAUSED");
    expect(out.providerStatusSource).toBe("fresh_sync");
    expect(out.draft.id).toBe("xd-g");
    const log = tables.campaignPublishLog.rows.find((r: any) => r.step === "google_pause");
    expect(log).toMatchObject({ status: "success", externalId: "g-camp-1", planId: "plan-1" });
    expect(auditCalls.some((a: any) => a.action === "campaign.xdraft_paused" && a.entityId === "xd-g")).toBe(true);
  });

  it("resume success returns the fresh active status and audits xdraft_resumed", async () => {
    const { svc, auditCalls } = setup();
    const out: any = await svc.setCrossPlatformDraftLifecycle("org", "u1", "plan-1", "xd-g", "resume");
    expect(out.providerStatus).toBe("active");
    expect(out.providerStatusSource).toBe("fresh_sync");
    expect(auditCalls.some((a: any) => a.action === "campaign.xdraft_resumed")).toBe(true);
  });

  it("resume is gated: a denied member is blocked BEFORE any provider call", async () => {
    const { svc, tables, calls } = setup();
    tables.membership.rows.push({ id: "m-1", organizationId: "org", userId: "u-denied", status: "ACTIVE", role: "MARKETING_MANAGER", deniedConnections: ["acc-g"] });
    await expect(svc.setCrossPlatformDraftLifecycle("org", "u-denied", "plan-1", "xd-g", "resume")).rejects.toThrow(/অনুমতি/);
    expect(calls.length).toBe(0);
    // ...while pause for the same denied member is never gated
    const out: any = await svc.setCrossPlatformDraftLifecycle("org", "u-denied", "plan-1", "xd-g", "pause");
    expect(out.providerStatus).toBe("paused");
    expect(calls.some((c: any) => c.kind === "set")).toBe(true);
  });

  it("provider failure: error publish log, 'did NOT confirm' BadRequest, local draft unchanged", async () => {
    const { svc, tables } = setup({ setError: "TikTok campaign status change failed: Advertiser not authorized" });
    await expect(svc.setCrossPlatformDraftLifecycle("org", "u1", "plan-1", "xd-g", "pause")).rejects.toThrow(/did NOT confirm the status change: TikTok campaign status change failed/);
    await expect(svc.setCrossPlatformDraftLifecycle("org", "u1", "plan-1", "xd-g", "pause")).rejects.toThrow(/Local status is unchanged/);
    const log = tables.campaignPublishLog.rows.find((r: any) => r.step === "google_pause" && r.status === "error");
    expect(log).toBeTruthy();
    expect(log.error).toContain("Advertiser not authorized");
    const draft = tables.crossPlatformDraft.rows.find((d: any) => d.id === "xd-g");
    expect(draft.status).toBe("created");
    expect(draft.externalCampaignId).toBe("g-camp-1");
  });

  it("a non-created draft (no external id) is refused before any provider call", async () => {
    const { svc, calls } = setup();
    await expect(svc.setCrossPlatformDraftLifecycle("org", "u1", "plan-1", "xd-noext", "pause")).rejects.toThrow(/created/);
    expect(calls.length).toBe(0);
  });

  it("when the fresh sync after a confirmed change fails, the target-mapped status is returned and labelled as such", async () => {
    const { svc } = setup({ freshSyncFails: true });
    const out: any = await svc.setCrossPlatformDraftLifecycle("org", "u1", "plan-1", "xd-g", "resume");
    expect(out.providerStatus).toBe("active");
    expect(out.providerStatusSource).toBe("target_mapped");
    expect(out.providerStatusRaw).toBeUndefined();
  });
});
