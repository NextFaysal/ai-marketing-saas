import { ProposalsService } from "./proposals.service";

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "in" in (v as any)) return (v as any).in.includes(row[k]);
    return row[k] === v;
  });
}
function makeTable(seed: any[] = []) {
  const rows: any[] = [...seed];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where, take }: any = {}) => { const out = rows.filter((r) => matches(r, where)); return take ? out.slice(0, take) : out; },
    create: async ({ data }: any) => { const row = { id: `row-${++seq}-${rows.length}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return row; },
    updateMany: async ({ where, data }: any) => { const hit = rows.filter((r) => matches(r, where)); for (const r of hit) Object.assign(r, data); return { count: hit.length }; },
  };
}
function setup(opts: { metaError?: string } = {}) {
  const plan = { id: "plan-1", organizationId: "org-1", name: "Eid Sale", status: "published", externalCampaignId: "camp-ext-1", metaStatus: "ACTIVE" };
  const draftPlan = { id: "plan-2", organizationId: "org-1", name: "Draft Plan", status: "draft", externalCampaignId: null, metaStatus: null };
  const adSet = { id: "adset-1", planId: "plan-1", name: "Eid Ad Set", externalAdSetId: "adset-ext-1" };
  const prisma: any = {
    campaignPlan: makeTable([plan, draftPlan]),
    campaignAdSet: makeTable([adSet]),
    whatsAppTemplate: makeTable([{ id: "tpl-1", organizationId: "org-1", name: "Offer", bodyText: "Hi" }]),
    aIActionProposal: makeTable(),
    aIAction: makeTable(),
  };
  const auditCalls: any[] = [];
  const audit: any = { log: async (x: any) => { auditCalls.push(x); } };
  const campaignCalls: any[] = [];
  const campaigns: any = {
    setMetaStatus: async (...args: any[]) => { campaignCalls.push(["setMetaStatus", ...args]); if (opts.metaError) throw new Error(opts.metaError); return { id: "plan-1", metaStatus: "PAUSED" }; },
    setAdSetStatus: async (...args: any[]) => { campaignCalls.push(["setAdSetStatus", ...args]); if (opts.metaError) throw new Error(opts.metaError); return { adSetId: "adset-1", target: "PAUSED" }; },
  };
  const broadcastCalls: any[] = [];
  const messaging: any = {
    createBroadcast: async (_org: string, _actor: string, dto: any) => { broadcastCalls.push(dto); return { id: "bcast-1", status: "draft", ...dto }; },
  };
  const svc = new ProposalsService(prisma, audit, campaigns, messaging);
  return { svc, prisma, auditCalls, campaignCalls, broadcastCalls };
}

describe("ProposalsService (M47 write actions with approval)", () => {
  it("refuses to propose pausing an unpublished plan and executes nothing", async () => {
    const { svc, campaignCalls, prisma } = setup();
    await expect(svc.propose("org-1", "user-1", { type: "pause_campaign", planId: "plan-2" })).rejects.toThrow(/published/);
    expect(prisma.aIActionProposal.rows.length).toBe(0);
    expect(campaignCalls.length).toBe(0);
  });

  it("proposing executes NOTHING; approval executes once via the Meta-confirmed path", async () => {
    const { svc, campaignCalls, prisma, auditCalls } = setup();
    const proposal = await svc.propose("org-1", "user-1", { type: "pause_campaign", planId: "plan-1" });
    expect(proposal.status).toBe("proposed");
    expect(proposal.preview).toContain("Eid Sale");
    expect(campaignCalls.length).toBe(0); // <- the whole point of M47
    const done = await svc.approve("org-1", "owner-1", proposal.id);
    expect(done.status).toBe("executed");
    expect(done.result.confirmedBy).toBe("meta");
    expect(campaignCalls).toEqual([["setMetaStatus", "org-1", "owner-1", "plan-1", "PAUSED"]]);
    expect(prisma.aIAction.rows.some((r: any) => r.toolName === "execute.pause_campaign" && r.status === "success")).toBe(true);
    expect(auditCalls.map((c: any) => c.action)).toContain("ai.proposal_executed");
  });

  it("dedupes an identical still-open proposal", async () => {
    const { svc, prisma } = setup();
    const a = await svc.propose("org-1", "user-1", { type: "pause_campaign", planId: "plan-1" });
    const b = await svc.propose("org-1", "user-2", { type: "pause_campaign", planId: "plan-1" });
    expect(b.id).toBe(a.id);
    expect(prisma.aIActionProposal.rows.length).toBe(1);
  });

  it("records FAILED with the platform error verbatim when Meta does not confirm", async () => {
    const { svc, prisma } = setup({ metaError: "Meta did NOT confirm the status change: (#100) invalid. Local status is unchanged." });
    const proposal = await svc.propose("org-1", "user-1", { type: "pause_campaign", planId: "plan-1" });
    const done = await svc.approve("org-1", "owner-1", proposal.id);
    expect(done.status).toBe("failed");
    expect(done.error).toContain("Meta did NOT confirm");
    expect(prisma.aIActionProposal.rows[0].status).toBe("failed"); // never "executed"
    expect(prisma.aIAction.rows.some((r: any) => r.toolName === "execute.pause_campaign" && r.status === "error")).toBe(true);
  });

  it("rejection never executes and a rejected proposal cannot be approved", async () => {
    const { svc, campaignCalls } = setup();
    const proposal = await svc.propose("org-1", "user-1", { type: "pause_campaign", planId: "plan-1" });
    const rejected = await svc.reject("org-1", "owner-1", proposal.id);
    expect(rejected.status).toBe("rejected");
    expect(campaignCalls.length).toBe(0);
    await expect(svc.approve("org-1", "owner-1", proposal.id)).rejects.toThrow(/already decided/);
    expect(campaignCalls.length).toBe(0);
  });

  it("broadcast draft: validation at proposal time, draft-only creation at approval time", async () => {
    const { svc, broadcastCalls } = setup();
    await expect(svc.propose("org-1", "user-1", { type: "create_broadcast_draft", name: "Offer", channel: "email", body: "Hello" })).rejects.toThrow(/subject/);
    const proposal = await svc.propose("org-1", "user-1", { type: "create_broadcast_draft", name: "Offer Mail", channel: "email", subject: "Eid Offer", body: "Hello customers", audienceType: "customers" });
    expect(proposal.preview).toContain("DRAFT");
    expect(broadcastCalls.length).toBe(0);
    const done = await svc.approve("org-1", "owner-1", proposal.id);
    expect(done.status).toBe("executed");
    expect(done.result).toEqual({ broadcastId: "bcast-1", status: "draft" });
    expect(broadcastCalls.length).toBe(1);
  });

  it("ad set pause goes through setAdSetStatus on approval", async () => {
    const { svc, campaignCalls } = setup();
    const proposal = await svc.propose("org-1", "user-1", { type: "pause_ad_set", adSetId: "adset-1" });
    const done = await svc.approve("org-1", "owner-1", proposal.id);
    expect(done.status).toBe("executed");
    expect(campaignCalls).toEqual([["setAdSetStatus", "org-1", "owner-1", "plan-1", "adset-1", "PAUSED"]]);
  });

  it("chat detection: names a real published target or creates nothing", async () => {
    const { svc, campaignCalls } = setup();
    const hit = await svc.detectFromChat("org-1", "user-1", "conv-1", "Eid Sale ক্যাম্পেইনটা pause করে দাও");
    expect(hit?.type).toBe("pause_campaign");
    expect(hit?.status).toBe("proposed");
    expect(campaignCalls.length).toBe(0);
    expect(await svc.detectFromChat("org-1", "user-1", "conv-1", "গত সপ্তাহে বিক্রি কেমন ছিল?")).toBeNull();
    expect(await svc.detectFromChat("org-1", "user-1", "conv-1", "সব ক্যাম্পেইন pause করে দাও")).toBeNull(); // no named target
  });

  it("unknown proposal id is a 404", async () => {
    const { svc } = setup();
    await expect(svc.approve("org-1", "owner-1", "nope")).rejects.toThrow(/not found/i);
  });
});
