import { LeadsService } from "./leads.service";
import { classifyDue, dhakaDayKey, dhakaDayStartUtc } from "./lead-followups";

// Fake Prisma with the operators the C1 code uses (notIn / not /
// lt / gte / in / include user / orderBy nextFollowUpAt).
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("notIn" in v && v.notIn.includes(row[k])) return false;
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("not" in v) { const ok = v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not; if (!ok) return false; }
      if ("lt" in v && !(row[k] != null && new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if ("gte" in v && !(row[k] != null && new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}
function makeTable(name: string, users?: any[]) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where, take, orderBy, include }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.nextFollowUpAt === "asc") f = [...f].sort((a, b) => new Date(a.nextFollowUpAt).getTime() - new Date(b.nextFollowUpAt).getTime());
      if (orderBy?.createdAt === "desc") f = [...f].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (take) f = f.slice(0, take);
      if (include?.user && users) f = f.map((r) => ({ ...r, user: users.find((u) => u.id === r.userId) ?? null }));
      return f;
    },
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}
function fakePrisma() {
  const users = [
    { id: "owner-1", name: "Org Owner", email: "owner@x.com" },
    { id: "admin-1", name: "Admin One", email: "admin@x.com" },
    { id: "agent-1", name: "Agent One", email: "agent@x.com" },
    { id: "gone-1", name: "Gone User", email: "gone@x.com" },
  ];
  const tables: any = {
    lead: makeTable("lead"), leadActivity: makeTable("act"), customer: makeTable("cust"),
    membership: makeTable("mem", users), agentNotification: makeTable("notif"), user: makeTable("user"),
  };
  tables.user.rows.push(...users);
  return tables;
}

// Fixed "now": 2026-10-11 10:00 UTC = 16:00 Dhaka, same Dhaka day.
const NOW = new Date("2026-10-11T10:00:00.000Z");
const dhaka = (dayOffset: number, hourUtc = 3) => new Date(Date.UTC(2026, 9, 11 + dayOffset, hourUtc, 0, 0)); // 09:00 Dhaka by default

async function seedLead(prisma: any, over: Record<string, unknown> = {}) {
  return prisma.lead.create({
    data: {
      organizationId: "org-1", name: "Lead", phone: "01710000000", email: null, source: "manual",
      stage: "contacted", valueMinor: null, currency: "BDT", notes: null, ownerUserId: "agent-1",
      customerId: null, mergedIntoId: null, nextFollowUpAt: dhaka(0), lastContactedAt: null,
      ...over,
    },
  });
}
function seedMemberships(prisma: any) {
  prisma.membership.rows.push(
    { id: "m1", organizationId: "org-1", userId: "owner-1", role: "OWNER", status: "ACTIVE" },
    { id: "m2", organizationId: "org-1", userId: "admin-1", role: "ADMIN", status: "ACTIVE" },
    { id: "m3", organizationId: "org-1", userId: "agent-1", role: "SUPPORT_AGENT", status: "ACTIVE" },
    { id: "m4", organizationId: "org-1", userId: "gone-1", role: "SUPPORT_AGENT", status: "SUSPENDED" },
  );
}

describe("Dhaka day bounds", () => {
  it("Dhaka midnight is 18:00 UTC of the previous day", () => {
    const start = dhakaDayStartUtc(NOW);
    expect(start.toISOString()).toBe("2026-10-10T18:00:00.000Z");
    expect(dhakaDayKey(NOW)).toBe("2026-10-11");
    // 2026-10-10 19:00 UTC is already Oct 11 in Dhaka (01:00).
    expect(dhakaDayKey(new Date("2026-10-10T19:00:00.000Z"))).toBe("2026-10-11");
    // 2026-10-10 17:59 UTC is still Oct 10 in Dhaka (23:59).
    expect(dhakaDayKey(new Date("2026-10-10T17:59:00.000Z"))).toBe("2026-10-10");
  });
});

describe("classifyDue", () => {
  it("due later today (Dhaka) is bucket today", () => {
    expect(classifyDue(dhaka(0, 12), NOW)).toEqual({ bucket: "today", daysOverdue: 0, label: "আজ" });
  });
  it("due earlier today (Dhaka) is still bucket today, not overdue", () => {
    expect(classifyDue(dhaka(0, 0), NOW)?.bucket).toBe("today"); // 06:00 Dhaka today
  });
  it("due yesterday (Dhaka) is 1 day overdue even though <24h ago in UTC terms", () => {
    // Oct 10 20:00 UTC = Oct 11 02:00 Dhaka — same Dhaka day as NOW.
    expect(classifyDue(new Date("2026-10-10T20:00:00.000Z"), NOW)?.bucket).toBe("today");
    // Oct 10 10:00 UTC = Oct 10 16:00 Dhaka — yesterday in Dhaka.
    const d = classifyDue(new Date("2026-10-10T10:00:00.000Z"), NOW);
    expect(d).toEqual({ bucket: "overdue", daysOverdue: 1, label: "1 দিন পেরিয়ে গেছে" });
  });
  it("counts whole Dhaka days overdue", () => {
    expect(classifyDue(dhaka(-4), NOW)?.daysOverdue).toBe(4);
  });
  it("tomorrow (Dhaka) and null are not due", () => {
    expect(classifyDue(dhaka(1), NOW)).toBeNull();
    expect(classifyDue(null, NOW)).toBeNull();
  });
});

describe("LeadsService.followUps board", () => {
  it("selects due + overdue, excludes won/lost/merged/future, groups and orders oldest first", async () => {
    const prisma = fakePrisma();
    seedMemberships(prisma);
    const svc = new LeadsService(prisma as any);
    await seedLead(prisma, { name: "Today A", nextFollowUpAt: dhaka(0, 5) });
    await seedLead(prisma, { name: "Old B", nextFollowUpAt: dhaka(-5) });
    await seedLead(prisma, { name: "Old C", nextFollowUpAt: dhaka(-2) });
    await seedLead(prisma, { name: "Won", stage: "won", nextFollowUpAt: dhaka(-1) });
    await seedLead(prisma, { name: "Lost", stage: "lost", nextFollowUpAt: dhaka(-1) });
    await seedLead(prisma, { name: "Merged", mergedIntoId: "lead-x", nextFollowUpAt: dhaka(-1) });
    await seedLead(prisma, { name: "Future", nextFollowUpAt: dhaka(2) });
    await seedLead(prisma, { name: "None", nextFollowUpAt: null });
    await seedLead(prisma, { name: "OtherOrg", organizationId: "org-2", nextFollowUpAt: dhaka(-1) });
    const board = await svc.followUps("org-1", NOW);
    expect(board.dueToday.map((l: any) => l.name)).toEqual(["Today A"]);
    expect(board.overdue.map((l: any) => l.name)).toEqual(["Old B", "Old C"]);
    expect(board.counts).toEqual({ dueToday: 1, overdue: 2 });
    expect(board.dueToday[0].ownerName).toBe("Agent One");
    expect(board.overdue[0].due.daysOverdue).toBe(5);
  });
});

describe("LeadsService.sweepFollowUpReminders", () => {
  it("notifies the active owner only, writes the dedupe marker, and a second run the same day is a no-op", async () => {
    const prisma = fakePrisma();
    seedMemberships(prisma);
    const svc = new LeadsService(prisma as any);
    const lead = await seedLead(prisma, { name: "Due Lead", nextFollowUpAt: dhaka(-1) });
    const first = await svc.sweepFollowUpReminders("org-1", NOW);
    expect(first).toMatchObject({ candidates: 1, notified: 1, notifications: 1, deduped: 0 });
    const notifs = prisma.agentNotification.rows;
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toMatchObject({ userId: "agent-1", type: "lead_followup", organizationId: "org-1" });
    expect(notifs[0].title).toContain("Due Lead");
    expect(notifs[0].body).toContain("1 দিন পেরিয়ে গেছে");
    expect(prisma.leadActivity.rows.some((a: any) => a.leadId === lead.id && a.type === "followup_reminded")).toBe(true);

    const second = await svc.sweepFollowUpReminders("org-1", NOW);
    expect(second).toMatchObject({ notified: 0, notifications: 0, deduped: 1 });
    expect(prisma.agentNotification.rows).toHaveLength(1);
  });

  it("falls back to OWNER/ADMIN when the lead is unassigned or the owner is no longer active", async () => {
    const prisma = fakePrisma();
    seedMemberships(prisma);
    const svc = new LeadsService(prisma as any);
    await seedLead(prisma, { name: "Unassigned", ownerUserId: null, nextFollowUpAt: dhaka(0) });
    await seedLead(prisma, { name: "OwnerGone", ownerUserId: "gone-1", nextFollowUpAt: dhaka(0) });
    await seedLead(prisma, { name: "OwnerUnknown", ownerUserId: "stranger", nextFollowUpAt: dhaka(0) });
    const res = await svc.sweepFollowUpReminders("org-1", NOW);
    expect(res.notified).toBe(3);
    // 3 leads x (owner-1 + admin-1) = 6 notifications, none to agent/gone/stranger.
    expect(res.notifications).toBe(6);
    const recipients = new Set(prisma.agentNotification.rows.map((n: any) => n.userId));
    expect([...recipients].sort()).toEqual(["admin-1", "owner-1"]);
  });

  it("skips won/lost/merged/future leads entirely", async () => {
    const prisma = fakePrisma();
    seedMemberships(prisma);
    const svc = new LeadsService(prisma as any);
    await seedLead(prisma, { stage: "won", nextFollowUpAt: dhaka(-3) });
    await seedLead(prisma, { stage: "lost", nextFollowUpAt: dhaka(-3) });
    await seedLead(prisma, { mergedIntoId: "lead-x", nextFollowUpAt: dhaka(-3) });
    await seedLead(prisma, { nextFollowUpAt: dhaka(1) });
    const res = await svc.sweepFollowUpReminders("org-1", NOW);
    expect(res.candidates).toBe(0);
    expect(prisma.agentNotification.rows).toHaveLength(0);
  });

  it("a marker from a previous Dhaka day does not block today's reminder", async () => {
    const prisma = fakePrisma();
    seedMemberships(prisma);
    const svc = new LeadsService(prisma as any);
    const lead = await seedLead(prisma, { nextFollowUpAt: dhaka(-2) });
    prisma.leadActivity.rows.push({ id: "old-marker", leadId: lead.id, userId: null, type: "followup_reminded", content: "old", createdAt: new Date("2026-10-09T05:00:00.000Z") });
    const res = await svc.sweepFollowUpReminders("org-1", NOW);
    expect(res.notified).toBe(1);
    expect(prisma.agentNotification.rows).toHaveLength(1);
  });
});
