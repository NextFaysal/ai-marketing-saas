import { OrganizationsService } from "./organizations.service";

/**
 * Milestone 67 (Team T1): member lifecycle — role changes,
 * suspend/reactivate with conversation handover, removal
 * with roster cleanup, and the seat picture. Last-OWNER
 * protections are structural: OWNER is never assignable,
 * suspendable, or removable through these endpoints.
 */
type Row = Record<string, any>;
function match(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (k === "userId_organizationId" && v && typeof v === "object") {
      return row.userId === (v as any).userId && row.organizationId === (v as any).organizationId;
    }
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return ((v as any).in as any[]).includes(row[k]);
      if ("not" in v) return row[k] !== (v as any).not;
      if ("gt" in v) return row[k] > (v as any).gt;
      return true;
    }
    return row[k] === v;
  });
}
let seq = 0;
function table(rows: Row[]) {
  return {
    rows,
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.id) return rows.find((r) => r.id === where.id) ?? null;
      return rows.find((r) => match(r, where)) ?? null;
    }),
    findMany: jest.fn(async ({ where }: any = {}) => rows.filter((r) => match(r, where))),
    count: jest.fn(async ({ where }: any = {}) => rows.filter((r) => match(r, where)).length),
    create: jest.fn(async ({ data }: any) => { const r = { id: `row-${++seq}`, ...data }; rows.push(r); return r; }),
    update: jest.fn(async ({ where, data }: any) => {
      const r = rows.find((x) => (where.id ? x.id === where.id : match(x, where)));
      if (r) Object.assign(r, data);
      return r;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows) if (match(r, where)) { Object.assign(r, data); count++; }
      return { count };
    }),
    delete: jest.fn(async ({ where }: any) => {
      const i = rows.findIndex((r) => r.id === where.id);
      if (i >= 0) rows.splice(i, 1);
      return {};
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], where)) { rows.splice(i, 1); count++; }
      return { count };
    }),
  };
}
function setup() {
  const memberships: Row[] = [
    { id: "m-owner", userId: "owner-1", organizationId: "org-1", role: "OWNER", status: "ACTIVE", user: { id: "owner-1", name: "Owner", email: "o@x.com" } },
    { id: "m-agent", userId: "agent-1", organizationId: "org-1", role: "SUPPORT_AGENT", status: "ACTIVE", user: { id: "agent-1", name: "Agent", email: "a@x.com" } },
  ];
  const conversations: Row[] = [
    { id: "c1", organizationId: "org-1", assignedUserId: "agent-1", status: "open" },
    { id: "c2", organizationId: "org-1", assignedUserId: "agent-1", status: "open" },
    { id: "c3", organizationId: "org-1", assignedUserId: "agent-1", status: "closed" },
    { id: "c4", organizationId: "org-1", assignedUserId: "owner-1", status: "open" },
  ];
  const db: any = {
    membership: table(memberships),
    channelConversation: table(conversations),
    agentState: table([{ id: "as-1", organizationId: "org-1", userId: "agent-1", status: "online" }]),
    inboxTeam: table([{ id: "t-1", organizationId: "org-1", name: "Support" }]),
    inboxTeamMember: table([{ id: "tm-1", teamId: "t-1", userId: "agent-1", capacity: 20 }]),
    memberInvitation: table([]),
    organization: table([{ id: "org-1", name: "Org" }]),
    systemSetting: table([]),
    subscription: table([]),
  };
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const svc = new OrganizationsService(db as any, audit as any);
  return { svc, db, audit, memberships, conversations };
}

describe("M67 member lifecycle", () => {
  it("role change works, is audited, and OWNER can never be assigned or changed", async () => {
    const { svc, audit, memberships } = setup();
    const out: any = await svc.updateMemberRole("org-1", "owner-1", "agent-1", "ADMIN");
    expect(out).toMatchObject({ ok: true, role: "ADMIN", from: "SUPPORT_AGENT" });
    expect(memberships.find((m) => m.id === "m-agent")!.role).toBe("ADMIN");
    expect(audit.calls.map((c) => c.action)).toContain("org.member_role_updated");
    await expect(svc.updateMemberRole("org-1", "owner-1", "agent-1", "OWNER")).rejects.toMatchObject({ code: "organizations.roleNotAssignable", status: 400 });
    await expect(svc.updateMemberRole("org-1", "agent-1", "owner-1", "VIEWER")).rejects.toMatchObject({ code: "organizations.ownerRoleImmutable", status: 400 });
  });

  it("suspend hands open conversations back to the pool and marks the agent away; closed ones stay", async () => {
    const { svc, db, memberships } = setup();
    const out: any = await svc.setMemberStatus("org-1", "owner-1", "agent-1", "SUSPENDED");
    expect(out.handedOver).toBe(2);
    expect(db.channelConversation.rows.filter((c: Row) => c.assignedUserId === "agent-1" && c.status === "open")).toHaveLength(0);
    expect(db.channelConversation.rows.find((c: Row) => c.id === "c3")!.assignedUserId).toBe("agent-1"); // closed history untouched
    expect(db.agentState.rows[0].status).toBe("away");
    expect(memberships.find((m) => m.id === "m-agent")!.status).toBe("SUSPENDED");
    // Reactivation is the same door, reversed.
    const back: any = await svc.setMemberStatus("org-1", "owner-1", "agent-1", "ACTIVE");
    expect(back.status).toBe("ACTIVE");
  });

  it("the owner cannot be suspended and nobody can suspend themselves", async () => {
    const { svc } = setup();
    await expect(svc.setMemberStatus("org-1", "agent-1", "owner-1", "SUSPENDED")).rejects.toMatchObject({ code: "organizations.ownerNotSuspendable", status: 400 });
    await expect(svc.setMemberStatus("org-1", "agent-1", "agent-1", "SUSPENDED")).rejects.toMatchObject({ code: "organizations.cannotChangeOwnStatus", status: 400 });
  });

  it("removal hands over conversations and wipes roster residue", async () => {
    const { svc, db, memberships } = setup();
    const out: any = await svc.removeMember("org-1", "owner-1", "agent-1");
    expect(out).toMatchObject({ removed: true, handedOver: 2 });
    expect(memberships.some((m) => m.id === "m-agent")).toBe(false);
    expect(db.inboxTeamMember.rows).toHaveLength(0);
    expect(db.agentState.rows).toHaveLength(0);
    await expect(svc.removeMember("org-1", "agent-1", "owner-1")).rejects.toMatchObject({ code: "organizations.ownerCannotBeRemoved", status: 400 });
  });

  it("seat usage reports limit, used and pending from real rows", async () => {
    const { svc } = setup();
    const usage: any = await svc.seatUsage("org-1");
    expect(usage.activeMembers).toBe(2);
    expect(usage.suspendedMembers).toBe(0);
    expect(usage.pendingInvites).toBe(0);
    // FREE plan default (2 seats) or an override resolves a limit.
    expect(usage.limit === null || typeof usage.limit === "number").toBe(true);
    if (usage.limit != null) expect(usage.available).toBe(Math.max(0, usage.limit - 2));
  });
});
