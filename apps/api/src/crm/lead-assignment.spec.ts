import { LeadsService } from "./leads.service";
import { LeadAssignmentService } from "./lead-assignment.service";

// Fake Prisma with the operators the C5 code uses (in / notIn /
// not-null / equality). Mirrors the lead-followups.spec fake.
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("notIn" in v && v.notIn.includes(row[k])) return false;
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("not" in v) { const ok = v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not; if (!ok) return false; }
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    findUnique: async ({ where }: any) => rows.find((r) =>
      (where.id !== undefined && r.id === where.id) ||
      (where.organizationId !== undefined && r.organizationId === where.organizationId)) ?? null,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => (where.id !== undefined && r.id === where.id) || (where.organizationId !== undefined && r.organizationId === where.organizationId));
      Object.assign(row, data); return row;
    },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}
function fakePrisma() {
  const users = [
    { id: "owner-1", name: "Org Owner", email: "owner@x.com" },
    { id: "admin-1", name: "Admin One", email: "admin@x.com" },
    { id: "agent-1", name: "Agent One", email: "agent1@x.com" },
    { id: "agent-2", name: "Agent Two", email: "agent2@x.com" },
    { id: "granted-1", name: "Granted Viewer", email: "granted@x.com" },
  ];
  const tables: any = {
    lead: makeTable("lead"), leadActivity: makeTable("act"), customer: makeTable("cust"),
    membership: makeTable("mem"), crmSetting: makeTable("set"), agentSchedule: makeTable("sched"),
    user: makeTable("user"),
  };
  tables.user.rows.push(...users);
  return tables;
}

const T = (min: number) => new Date(Date.UTC(2026, 0, 1, 0, min, 0));
/** Members of org-1 in a fixed stable order. Eligible (M72
 * "customers" area, ACTIVE) = owner-1, admin-1, agent-1, agent-2,
 * granted-1. Excluded: susp-1 (SUSPENDED), viewer-1 (VIEWER, no
 * access), denied-1 (role passes but a DENY override blocks). */
function seedMembers(prisma: any, orgId = "org-1") {
  const defs: any[] = [
    { userId: "owner-1", role: "OWNER", status: "ACTIVE" },
    { userId: "admin-1", role: "ADMIN", status: "ACTIVE" },
    { userId: "agent-1", role: "SUPPORT_AGENT", status: "ACTIVE" },
    { userId: "agent-2", role: "SUPPORT_AGENT", status: "ACTIVE" },
    { userId: "susp-1", role: "SUPPORT_AGENT", status: "SUSPENDED" },
    { userId: "viewer-1", role: "VIEWER", status: "ACTIVE" },
    { userId: "denied-1", role: "SUPPORT_AGENT", status: "ACTIVE", permissionOverrides: { grants: [], denies: ["customers"] } },
    { userId: "granted-1", role: "VIEWER", status: "ACTIVE", permissionOverrides: { grants: ["customers"], denies: [] } },
  ];
  defs.forEach((d, i) => prisma.membership.rows.push({
    id: `m-${orgId}-${i}`, organizationId: orgId, permissionOverrides: null, createdAt: T(i), ...d,
  }));
}
function services(prisma: any) {
  const assignment = new LeadAssignmentService(prisma as any);
  const leads = new LeadsService(prisma as any, undefined, undefined, undefined, assignment);
  return { assignment, leads };
}
// Monday 2026-10-12, 10:00 in Dhaka (04:00 UTC) — a fixed "now"
// squarely inside a 09:00–17:00 Mon shift and outside a
// 20:00–23:00 Mon shift.
const MON_10AM_DHAKA = new Date("2026-10-12T04:00:00.000Z");
const sched = (userId: string, windows: any) => ({
  id: `s-${userId}`, organizationId: "org-1", userId, timezone: "Asia/Dhaka", windows,
});

describe("CRM C5 — lead auto-assignment", () => {
  it("setting defaults to off with no row, and rejects unknown strategies", async () => {
    const prisma = fakePrisma();
    const { assignment } = services(prisma);
    expect(await assignment.getSetting("org-1")).toEqual({ leadAssignStrategy: "off", rrCursorUserId: null });
    await expect(assignment.updateSetting("org-1", "random")).rejects.toThrow("off | round_robin | least_open_leads");
    const view = await assignment.updateSetting("org-1", "round_robin");
    expect(view.leadAssignStrategy).toBe("round_robin");
    expect(prisma.crmSetting.rows).toHaveLength(1);
  });

  it("eligibility = ACTIVE + M72 effective access to the customers area, in stable order", async () => {
    const prisma = fakePrisma();
    seedMembers(prisma);
    const { assignment } = services(prisma);
    const eligible = await assignment.eligibleMembers("org-1");
    expect(eligible.map((m) => m.userId)).toEqual(["owner-1", "admin-1", "agent-1", "agent-2", "granted-1"]);
  });

  it("strategy off: zero behaviour change — the creator owns the lead, no assigned activity", async () => {
    const prisma = fakePrisma();
    seedMembers(prisma);
    const { leads } = services(prisma);
    const lead = await leads.create("org-1", "admin-1", { name: "Off Lead" });
    expect(lead.ownerUserId).toBe("admin-1");
    expect(prisma.leadActivity.rows.some((a: any) => a.type === "assigned")).toBe(false);
    expect(prisma.crmSetting.rows).toHaveLength(0);
  });

  it("round_robin rotates through the eligible set in stable order and persists the cursor", async () => {
    const prisma = fakePrisma();
    seedMembers(prisma);
    const { assignment, leads } = services(prisma);
    await assignment.updateSetting("org-1", "round_robin");
    const owners: (string | null)[] = [];
    for (let i = 0; i < 6; i++) {
      const lead = await leads.create("org-1", "owner-1", { name: `RR ${i}` });
      owners.push(lead.ownerUserId);
    }
    expect(owners).toEqual(["owner-1", "admin-1", "agent-1", "agent-2", "granted-1", "owner-1"]);
    const setting = await assignment.getSetting("org-1");
    expect(setting.rrCursorUserId).toBe("owner-1");
    const assigned = prisma.leadActivity.rows.filter((a: any) => a.type === "assigned");
    expect(assigned).toHaveLength(6);
    expect(assigned[0].content).toContain("পালাক্রমে (Round Robin)");
    expect(assigned[0].userId).toBeNull();
  });

  it("an explicit owner always wins and never moves the cursor", async () => {
    const prisma = fakePrisma();
    seedMembers(prisma);
    const { assignment, leads } = services(prisma);
    await assignment.updateSetting("org-1", "round_robin");
    const first = await leads.create("org-1", "owner-1", { name: "Auto 1" });
    expect(first.ownerUserId).toBe("owner-1"); // cursor now owner-1
    const explicit = await leads.create("org-1", "owner-1", { name: "Manual", ownerUserId: "agent-2" });
    expect(explicit.ownerUserId).toBe("agent-2");
    const explicitNull = await leads.create("org-1", "owner-1", { name: "Deliberately unassigned", ownerUserId: null });
    expect(explicitNull.ownerUserId).toBeNull();
    expect((await assignment.getSetting("org-1")).rrCursorUserId).toBe("owner-1"); // unmoved
    const next = await leads.create("org-1", "owner-1", { name: "Auto 2" });
    expect(next.ownerUserId).toBe("admin-1"); // rotation resumes after the cursor
    expect(prisma.leadActivity.rows.filter((a: any) => a.type === "assigned")).toHaveLength(2);
  });

  it("least_open_leads picks the member with the fewest open leads; ties break by stable order", async () => {
    const prisma = fakePrisma();
    seedMembers(prisma);
    const { assignment, leads } = services(prisma);
    await assignment.updateSetting("org-1", "least_open_leads");
    const seed = async (owner: string, stage: string, merged = false) => {
      const row = await prisma.lead.create({ data: { organizationId: "org-1", name: "seed", source: "manual", stage, ownerUserId: owner, mergedIntoId: merged ? "x" : null, customerId: null } });
      return row;
    };
    await seed("owner-1", "new"); await seed("owner-1", "contacted");       // owner-1: 2 open
    await seed("agent-1", "qualified");                                      // agent-1: 1 open
    await seed("agent-1", "won");                                            // won does not count
    await seed("agent-1", "new", true);                                      // merged does not count
    // admin-1 / agent-2 / granted-1: 0 open -> tie -> earliest stable = admin-1
    const first = await leads.create("org-1", "owner-1", { name: "L1" });
    expect(first.ownerUserId).toBe("admin-1");
    // admin-1 now has 1 open -> next tie is agent-2 vs granted-1 -> agent-2
    const second = await leads.create("org-1", "owner-1", { name: "L2" });
    expect(second.ownerUserId).toBe("agent-2");
  });

  it("empty eligible set: no assignment happens — the lead stays unassigned", async () => {
    const prisma = fakePrisma();
    // org-2 has only a plain VIEWER and a suspended agent.
    prisma.membership.rows.push(
      { id: "mx1", organizationId: "org-2", userId: "viewer-1", role: "VIEWER", status: "ACTIVE", permissionOverrides: null, createdAt: T(0) },
      { id: "mx2", organizationId: "org-2", userId: "susp-1", role: "SUPPORT_AGENT", status: "SUSPENDED", permissionOverrides: null, createdAt: T(1) },
    );
    const { assignment, leads } = services(prisma);
    await assignment.updateSetting("org-2", "round_robin");
    const lead = await leads.create("org-2", "viewer-1", { name: "Nobody eligible" });
    expect(lead.ownerUserId).toBeNull();
    expect(prisma.lead.rows.find((l: any) => l.id === lead.id).ownerUserId).toBeNull();
    expect(prisma.leadActivity.rows.some((a: any) => a.type === "assigned")).toBe(false);
    // The ingestion-path helper agrees: a pre-created unassigned
    // lead stays unassigned.
    const raw = await prisma.lead.create({ data: { organizationId: "org-2", name: "ingested", source: "facebook_lead_ads", stage: "new", ownerUserId: null } });
    const outcome = await assignment.assignNewLead("org-2", raw.id);
    expect(outcome.kind).toBe("none");
    expect(prisma.lead.rows.find((l: any) => l.id === raw.id).ownerUserId).toBeNull();
  });

  it("off-shift members are skipped while at least one eligible member is on-shift", async () => {
    const prisma = fakePrisma();
    seedMembers(prisma);
    // At Mon 10:00 Dhaka: owner-1/admin-1/granted-1 are off-shift
    // (20:00-23:00 windows), agent-1 is on-shift (09:00-17:00),
    // agent-2 has no schedule (always available).
    prisma.agentSchedule.rows.push(
      sched("owner-1", { mon: [["20:00", "23:00"]] }),
      sched("admin-1", { mon: [["20:00", "23:00"]] }),
      sched("agent-1", { mon: [["09:00", "17:00"]] }),
      sched("granted-1", { mon: [["20:00", "23:00"]] }),
    );
    const { assignment } = services(prisma);
    await assignment.updateSetting("org-1", "round_robin");
    const first = await assignment.resolveAutoAssignment("org-1", MON_10AM_DHAKA);
    expect(first).toEqual({ kind: "picked", userId: "agent-1", strategy: "round_robin" });
    const second = await assignment.resolveAutoAssignment("org-1", MON_10AM_DHAKA);
    expect(second).toEqual({ kind: "picked", userId: "agent-2", strategy: "round_robin" });
    const third = await assignment.resolveAutoAssignment("org-1", MON_10AM_DHAKA);
    expect(third).toEqual({ kind: "picked", userId: "agent-1", strategy: "round_robin" });
  });

  it("when NOBODY is on-shift the full eligible set is used (no lead stuck at night)", async () => {
    const prisma = fakePrisma();
    seedMembers(prisma);
    for (const u of ["owner-1", "admin-1", "agent-1", "agent-2", "granted-1"]) {
      prisma.agentSchedule.rows.push(sched(u, { mon: [["20:00", "23:00"]] }));
    }
    const { assignment } = services(prisma);
    await assignment.updateSetting("org-1", "round_robin");
    const outcome = await assignment.resolveAutoAssignment("org-1", MON_10AM_DHAKA);
    expect(outcome).toEqual({ kind: "picked", userId: "owner-1", strategy: "round_robin" });
  });

  it("assignNewLead writes the owner + an 'assigned' system activity (ingestion paths)", async () => {
    const prisma = fakePrisma();
    seedMembers(prisma);
    const { assignment } = services(prisma);
    await assignment.updateSetting("org-1", "least_open_leads");
    const raw = await prisma.lead.create({ data: { organizationId: "org-1", name: "Lead Ads", source: "facebook_lead_ads", stage: "new", ownerUserId: null } });
    const outcome = await assignment.assignNewLead("org-1", raw.id);
    expect(outcome.kind).toBe("picked");
    const stored = prisma.lead.rows.find((l: any) => l.id === raw.id);
    expect(stored.ownerUserId).toBe("owner-1"); // all at 0 open -> earliest stable member
    const act = prisma.leadActivity.rows.find((a: any) => a.type === "assigned");
    expect(act).toBeTruthy();
    expect(act.content).toContain("স্বয়ংক্রিয়ভাবে");
    expect(act.content).toContain("Org Owner");
  });
});
