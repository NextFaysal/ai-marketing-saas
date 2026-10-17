import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { OrganizationsService } from "./organizations.service";

/**
 * Organization Next OB1 — org lifecycle cluster:
 * ORG1 ownership transfer (transactional role swap, ADMIN-only
 * target, audit org.ownership_transferred), ORG2 self-leave
 * (owner refused until transfer), ORG3 archive/restore
 * (archivedAt semantics, OWNER only), ORG4 listMine payload
 * (platform status + archivedAt ride along for the switcher /
 * suspended + archived screens).
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
  const org: Row = { id: "org-1", name: "Acme", slug: "acme", status: "ACTIVE", archivedAt: null, creditMinor: 0n };
  const memberships: Row[] = [
    { id: "m-owner", userId: "owner-1", organizationId: "org-1", role: "OWNER", status: "ACTIVE", user: { id: "owner-1", name: "Owner", email: "o@x.com" } },
    { id: "m-admin", userId: "admin-1", organizationId: "org-1", role: "ADMIN", status: "ACTIVE", user: { id: "admin-1", name: "Admin", email: "a@x.com" } },
    { id: "m-agent", userId: "agent-1", organizationId: "org-1", role: "SUPPORT_AGENT", status: "ACTIVE", user: { id: "agent-1", name: "Agent", email: "s@x.com" } },
    { id: "m-susp", userId: "susp-1", organizationId: "org-1", role: "ADMIN", status: "SUSPENDED", user: { id: "susp-1", name: "Susp", email: "su@x.com" } },
  ];
  // listMine reads m.organization (Prisma include) — the fake
  // rows carry the same org object so mutations show through.
  for (const m of memberships) (m as any).organization = org;
  const db: any = {
    membership: table(memberships),
    organization: table([org]),
    channelConversation: table([
      { id: "c1", organizationId: "org-1", assignedUserId: "agent-1", status: "open" },
    ]),
    agentState: table([]),
    inboxTeam: table([]),
    inboxTeamMember: table([]),
    memberInvitation: table([]),
    subscription: table([]),
    systemSetting: table([]),
  };
  db.$transaction = jest.fn(async (fn: any) => fn(db));
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const svc = new OrganizationsService(db, audit as any);
  return { svc, db, audit, memberships, org };
}

describe("ORG1 — ownership transfer", () => {
  it("swaps roles atomically: target ADMIN → OWNER, old owner → ADMIN, with audit", async () => {
    const { svc, audit, memberships, db } = setup();
    const out = await svc.transferOwnership("org-1", "owner-1", "admin-1", "1.2.3.4");
    expect(out.ok).toBe(true);
    expect(memberships.find((m) => m.id === "m-admin")!.role).toBe("OWNER");
    expect(memberships.find((m) => m.id === "m-owner")!.role).toBe("ADMIN");
    // exactly one OWNER in the org afterwards
    expect(memberships.filter((m) => m.role === "OWNER")).toHaveLength(1);
    // the swap ran inside one transaction
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const entry = audit.calls.find((c) => c.action === "org.ownership_transferred");
    expect(entry).toBeTruthy();
    expect(entry.metadata).toMatchObject({ fromUserId: "owner-1", toUserId: "admin-1" });
    expect(entry.organizationId).toBe("org-1");
    // SMTP is not configured in tests — notification is honestly false, transfer stands
    expect(out.notified).toEqual({ newOwner: false, previousOwner: false });
  });

  it("non-owner actor is refused (403)", async () => {
    const { svc } = setup();
    await expect(svc.transferOwnership("org-1", "admin-1", "agent-1")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("target who is not a member fails", async () => {
    const { svc } = setup();
    await expect(svc.transferOwnership("org-1", "owner-1", "ghost-1")).rejects.toThrow(/not a member/);
  });

  it("target who is not an ADMIN fails with a clear message", async () => {
    const { svc } = setup();
    await expect(svc.transferOwnership("org-1", "owner-1", "agent-1")).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.transferOwnership("org-1", "owner-1", "agent-1")).rejects.toThrow(/ADMIN/);
  });

  it("suspended ADMIN target fails (must be ACTIVE)", async () => {
    const { svc } = setup();
    await expect(svc.transferOwnership("org-1", "owner-1", "susp-1")).rejects.toThrow(/ACTIVE/);
  });

  it("transferring to yourself fails", async () => {
    const { svc } = setup();
    await expect(svc.transferOwnership("org-1", "owner-1", "owner-1")).rejects.toThrow(/already the owner/);
  });

  it("the ordinary role endpoint still refuses to assign OWNER (rule unchanged)", async () => {
    const { svc } = setup();
    await expect(svc.updateMemberRole("org-1", "owner-1", "admin-1", "OWNER")).rejects.toThrow(/never assignable/);
  });
});

describe("ORG2 — self-leave", () => {
  it("a member can leave: membership removed, conversations handed over, audit written", async () => {
    const { svc, audit, memberships } = setup();
    const out = await svc.leaveOrganization("org-1", "agent-1", "1.2.3.4");
    expect(out.left).toBe(true);
    expect(out.handedOver).toBe(1);
    expect(memberships.some((m) => m.userId === "agent-1")).toBe(false);
    const entry = audit.calls.find((c) => c.action === "org.member_left");
    expect(entry).toBeTruthy();
    expect(entry.userId).toBe("agent-1");
  });

  it("the OWNER cannot leave — told to transfer first", async () => {
    const { svc, memberships } = setup();
    await expect(svc.leaveOrganization("org-1", "owner-1")).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.leaveOrganization("org-1", "owner-1")).rejects.toThrow(/transfer ownership/i);
    // owner membership untouched
    expect(memberships.some((m) => m.userId === "owner-1" && m.role === "OWNER")).toBe(true);
  });

  it("after an ORG1 transfer, the old owner (now ADMIN) can leave and the new owner remains", async () => {
    const { svc, memberships } = setup();
    await svc.transferOwnership("org-1", "owner-1", "admin-1");
    const out = await svc.leaveOrganization("org-1", "owner-1");
    expect(out.left).toBe(true);
    // the org is never memberless/ownerless: the new owner remains
    expect(memberships).toHaveLength(3);
    expect(memberships.filter((m) => m.role === "OWNER").map((m) => m.userId)).toEqual(["admin-1"]);
  });

  it("a non-member cannot leave", async () => {
    const { svc } = setup();
    await expect(svc.leaveOrganization("org-1", "ghost-1")).rejects.toThrow(/not a member/);
  });
});

describe("ORG3 — archive / restore (service level)", () => {
  it("OWNER archives: archivedAt set + audit; restore clears it + audit", async () => {
    const { svc, audit, org } = setup();
    const out = await svc.archiveOrganization("org-1", "owner-1");
    expect(out.archivedAt).toBeInstanceOf(Date);
    expect(org.archivedAt).toBeInstanceOf(Date);
    expect(audit.calls.some((c) => c.action === "org.archived")).toBe(true);
    const back = await svc.restoreOrganization("org-1", "owner-1");
    expect(back.archivedAt).toBeNull();
    expect(org.archivedAt).toBeNull();
    expect(audit.calls.some((c) => c.action === "org.restored")).toBe(true);
  });

  it("archiving an already archived org is an unchanged no-op", async () => {
    const { svc } = setup();
    await svc.archiveOrganization("org-1", "owner-1");
    const again = await svc.archiveOrganization("org-1", "owner-1");
    expect(again.unchanged).toBe(true);
  });

  it("non-owner archive is refused (403)", async () => {
    const { svc, org } = setup();
    await expect(svc.archiveOrganization("org-1", "admin-1")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.restoreOrganization("org-1", "admin-1")).rejects.toBeInstanceOf(ForbiddenException);
    expect(org.archivedAt).toBeNull();
  });
});

describe("ORG4 — listMine payload", () => {
  it("carries the platform status and archivedAt so the client can mark suspended/archived orgs", async () => {
    const { svc, org } = setup();
    org.status = "SUSPENDED";
    const mine = await svc.listMine("owner-1");
    expect(mine).toHaveLength(1);
    expect(mine[0].status).toBe("SUSPENDED");
    expect(mine[0].archivedAt).toBeNull();
    expect(mine[0].myRole).toBe("OWNER");
    org.status = "ACTIVE";
    org.archivedAt = new Date("2026-10-16T00:00:00Z");
    const mine2 = await svc.listMine("owner-1");
    expect(mine2[0].archivedAt).toBeInstanceOf(Date);
  });
});
