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

describe("ProposalsService AP5 (resume / follow-up / quick reply / bulk / dry-run)", () => {
  function setup5() {
    const pausedPlan = { id: "plan-3", organizationId: "org-1", name: "Winter Sale", status: "published", externalCampaignId: "camp-ext-3", metaStatus: "PAUSED" };
    const activePlan = { id: "plan-1", organizationId: "org-1", name: "Eid Sale", status: "published", externalCampaignId: "camp-ext-1", metaStatus: "ACTIVE" };
    const adSet = { id: "adset-1", planId: "plan-3", name: "Winter Ad Set", externalAdSetId: "adset-ext-1" };
    const prisma: any = {
      campaignPlan: makeTable([pausedPlan, activePlan]),
      campaignAdSet: makeTable([adSet]),
      whatsAppTemplate: makeTable(),
      aIActionProposal: makeTable(),
      aIAction: makeTable(),
      lead: makeTable([{ id: "lead-1", organizationId: "org-1", name: "Karim", mergedIntoId: null, nextFollowUpAt: null }]),
      leadActivity: makeTable(),
      quickReply: makeTable(),
    };
    const audit: any = { log: async () => undefined };
    const campaignCalls: any[] = [];
    const campaigns: any = {
      setMetaStatus: async (...args: any[]) => { campaignCalls.push(["setMetaStatus", ...args]); return { id: args[2], metaStatus: args[3] }; },
      setAdSetStatus: async (...args: any[]) => { campaignCalls.push(["setAdSetStatus", ...args]); return { adSetId: args[3], target: args[4] }; },
    };
    const svc = new ProposalsService(prisma, audit, campaigns, undefined);
    return { svc, prisma, campaignCalls };
  }

  it("resume_campaign requires PAUSED and records before → after on execute", async () => {
    const { svc, campaignCalls } = setup5();
    await expect(svc.propose("org-1", "u1", { type: "resume_campaign", planId: "plan-1" })).rejects.toThrow(/PAUSED নয়/);
    const row: any = await svc.propose("org-1", "u1", { type: "resume_campaign", planId: "plan-3" });
    expect(row.preview).toContain("আবার ACTIVE");
    const done: any = await svc.approve("org-1", "owner-1", row.id);
    expect(done.status).toBe("executed");
    expect(done.result.before).toBe("PAUSED");
    expect(done.result.after).toBe("ACTIVE");
    expect(campaignCalls[0][4]).toBe("ACTIVE");
  });

  it("pause_campaign now also records the dry-run before → after", async () => {
    const { svc } = setup5();
    const row: any = await svc.propose("org-1", "u1", { type: "pause_campaign", planId: "plan-1" });
    const done: any = await svc.approve("org-1", "owner-1", row.id);
    expect(done.result.before).toBe("ACTIVE");
    expect(done.result.after).toBe("PAUSED");
  });

  it("create_followup_task sets the CRM follow-up + activity on approval only", async () => {
    const { svc, prisma } = setup5();
    const row: any = await svc.propose("org-1", "u1", { type: "create_followup_task", leadId: "lead-1", dueAt: "2026-10-20", note: "দাম জানাতে হবে" });
    expect(prisma.lead.rows[0].nextFollowUpAt).toBeNull(); // nothing before approval
    const done: any = await svc.approve("org-1", "owner-1", row.id);
    expect(done.status).toBe("executed");
    expect(prisma.lead.rows[0].nextFollowUpAt).toBeInstanceOf(Date);
    expect(prisma.leadActivity.rows).toHaveLength(1);
  });

  it("create_quick_reply saves (never sends) on approval", async () => {
    const { svc, prisma } = setup5();
    const row: any = await svc.propose("org-1", "u1", { type: "create_quick_reply", title: "ডেলিভারি চার্জ", content: "ঢাকায় ৬০ টাকা" });
    expect(prisma.quickReply.rows).toHaveLength(0);
    const done: any = await svc.approve("org-1", "owner-1", row.id);
    expect(done.status).toBe("executed");
    expect(prisma.quickReply.rows[0].title).toBe("ডেলিভারি চার্জ");
  });

  it("approveMany executes each item independently and reports per-item outcomes", async () => {
    const { svc, prisma } = setup5();
    const a: any = await svc.propose("org-1", "u1", { type: "create_quick_reply", title: "A", content: "a" });
    const b: any = await svc.propose("org-1", "u1", { type: "create_followup_task", leadId: "lead-1", dueAt: "2026-10-21" });
    const out = await svc.approveMany("org-1", "owner-1", [a.id, b.id, "missing-id", a.id]);
    expect(out.executed).toBe(2);
    // duplicate ids are de-duplicated up front; the missing id errors per-item
    expect(out.failed).toBe(1);
    expect(out.results.map((r) => r.status)).toEqual(["executed", "executed", "error"]);
    expect(prisma.quickReply.rows).toHaveLength(1);
  });

  it("chat detection: 'চালু করে দাও' + paused plan name creates a resume proposal", async () => {
    const { svc } = setup5();
    const row: any = await svc.detectFromChat("org-1", "u1", "conv-1", "Winter Sale ক্যাম্পেইনটা আবার চালু করে দাও");
    expect(row?.type).toBe("resume_campaign");
  });
});

describe("ProposalsService AP7 autonomy level 2", () => {
  function setup7(level: number) {
    const prisma: any = {
      campaignPlan: makeTable(), campaignAdSet: makeTable(), whatsAppTemplate: makeTable(),
      aIActionProposal: makeTable(), aIAction: makeTable(),
      lead: makeTable([{ id: "lead-1", organizationId: "org-1", name: "Karim", mergedIntoId: null, nextFollowUpAt: null }]),
      leadActivity: makeTable(), quickReply: makeTable(),
      aIProactiveSetting: makeTable([{ id: "st1", organizationId: "org-1", autonomyLevel: level }]),
    };
    const auditCalls: any[] = [];
    const audit: any = { log: async (x: any) => { auditCalls.push(x); } };
    const svc = new ProposalsService(prisma, audit, undefined, undefined);
    return { svc, prisma, auditCalls };
  }

  it("level 2 auto-executes a quick-reply proposal and marks it autonomous", async () => {
    const { svc, prisma, auditCalls } = setup7(2);
    const row: any = await svc.propose("org-1", "u1", { type: "create_quick_reply", title: "দাম", content: "৫০০ টাকা" });
    expect(row.status).toBe("executed");
    expect(row.result.autonomous).toBe(true);
    expect(prisma.quickReply.rows).toHaveLength(1);
    expect(auditCalls.some((a) => a.action === "ai.proposal_approved" && a.metadata?.autonomous === true)).toBe(true);
  });

  it("level 0 (default) leaves the same proposal pending", async () => {
    const { svc, prisma } = setup7(0);
    const row: any = await svc.propose("org-1", "u1", { type: "create_quick_reply", title: "দাম", content: "৫০০ টাকা" });
    expect(row.status).toBe("proposed");
    expect(prisma.quickReply.rows).toHaveLength(0);
  });

  it("level 2 never auto-executes money-affecting types (broadcast draft stays pending)", async () => {
    const { svc } = setup7(2);
    const row: any = await svc.propose("org-1", "u1", { type: "create_broadcast_draft", name: "Offer", channel: "sms", body: "hi" });
    expect(row.status).toBe("proposed");
  });
});
