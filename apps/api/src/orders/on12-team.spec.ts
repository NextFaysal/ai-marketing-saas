import "reflect-metadata";
import { OrderTeamPerformanceService } from "./order-team-performance.service";

/**
 * ON12 — Team Performance: ACTIVE-member population (zero-activity
 * members included), per-metric AuditLog sources with exact action
 * strings, PickWaveOrder picks via the wave's org, the current-
 * snapshot assignedOpen (non-terminal, NOT range-bound), range
 * exclusion, totals = member sums, cross-org isolation, from>to
 * 400, and the pinned definition limit that bulk "orders.bulk"
 * rows do NOT inflate statusChanges. Fake-Prisma house style.
 */

function matchWhere(row: any, where: any): boolean {
  for (const [key, cond] of Object.entries(where ?? {})) {
    const val = (row as any)[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c: any = cond;
      if ("in" in c && !c.in.map(String).includes(String(val))) return false;
      continue;
    }
    if (String(val) !== String(cond)) return false;
  }
  return true;
}

function makeTable(rows: any[]) {
  return {
    rows,
    findMany: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where))),
    findFirst: jest.fn(async ({ where }: any = {}) => rows.find((r) => matchWhere(r, where)) ?? null),
    findUnique: jest.fn(async ({ where }: any = {}) => rows.find((r) => matchWhere(r, where)) ?? null),
  };
}

const D = (iso: string) => new Date(iso);
const IN = D("2026-10-10T06:00:00Z"); // Oct 10, 12:00 Dhaka — inside the test range
const OUT = D("2026-10-09T06:00:00Z"); // Oct 9 Dhaka — the day before the range

function audit(userId: string, action: string, createdAt: Date, org = "org-1", entityType = "Order") {
  return { id: `a-${userId}-${action}-${createdAt.getTime()}-${Math.random()}`, organizationId: org, userId, action, entityType, entityId: "o-1", metadata: {}, createdAt };
}

function baseData() {
  const memberships: any[] = [
    { id: "m-1", organizationId: "org-1", userId: "u-active", role: "SUPPORT_AGENT", status: "ACTIVE" },
    { id: "m-2", organizationId: "org-1", userId: "u-zero", role: "VIEWER", status: "ACTIVE" },
    { id: "m-3", organizationId: "org-1", userId: "u-off", role: "ADMIN", status: "SUSPENDED" },
    { id: "m-4", organizationId: "org-2", userId: "u-other", role: "OWNER", status: "ACTIVE" },
  ];
  const users: any[] = [
    { id: "u-active", name: "Ayesha Active", email: "ayesha@example.com" },
    { id: "u-zero", name: "Bilal Zero", email: "bilal@example.com" },
    { id: "u-off", name: "Off Member", email: "off@example.com" },
    { id: "u-other", name: "Other Org", email: "other@example.com" },
  ];
  const orders: any[] = [
    { id: "o-1", organizationId: "org-1", assigneeId: "u-active", status: "processing", isPractice: false },
    { id: "o-2", organizationId: "org-1", assigneeId: "u-active", status: "completed", isPractice: false },
    { id: "o-3", organizationId: "org-1", assigneeId: "u-active", status: "delivered", isPractice: false },
    { id: "o-4", organizationId: "org-1", assigneeId: "u-zero", status: "pending", isPractice: false },
    { id: "o-5", organizationId: "org-1", assigneeId: "u-zero", status: "processing", isPractice: true },
    { id: "o-6", organizationId: "org-1", assigneeId: "u-off", status: "processing", isPractice: false },
    { id: "o-7", organizationId: "org-2", assigneeId: "u-active", status: "processing", isPractice: false },
    { id: "o-8", organizationId: "org-1", assigneeId: null, status: "processing", isPractice: false },
  ];
  const audits: any[] = [
    // u-active, in range — one of every metric.
    audit("u-active", "orders.status_changed", IN),
    audit("u-active", "orders.status_changed", IN),
    audit("u-active", "orders.review_hold_set", IN),
    audit("u-active", "orders.review_hold_released", IN),
    audit("u-active", "orders.cod_call_recorded", IN),
    audit("u-active", "orders.cod_call_recorded", IN),
    audit("u-active", "orders.cod_call_recorded", IN),
    audit("u-active", "orders.comment_created", IN),
    audit("u-active", "orders.comment_created", IN),
    // Bulk ops write ONE orders.bulk row — never a status change.
    audit("u-active", "orders.bulk", IN),
    // Yesterday's status change — outside the range.
    audit("u-active", "orders.status_changed", OUT),
    // Suspended member's activity never surfaces (not in population).
    audit("u-off", "orders.status_changed", IN),
    // Other org's rows — one even names u-active as the actor.
    audit("u-active", "orders.status_changed", IN, "org-2"),
    audit("u-other", "orders.comment_created", IN, "org-2"),
  ];
  const pickWaves: any[] = [
    { id: "w-1", organizationId: "org-1", status: "open" },
    { id: "w-2", organizationId: "org-2", status: "open" },
  ];
  const pickWaveOrders: any[] = [
    { id: "p-1", waveId: "w-1", orderId: "o-1", pickedById: "u-active", pickedAt: IN },
    { id: "p-2", waveId: "w-1", orderId: "o-2", pickedById: "u-active", pickedAt: IN },
    { id: "p-3", waveId: "w-1", orderId: "o-3", pickedById: "u-active", pickedAt: OUT },
    { id: "p-4", waveId: "w-1", orderId: "o-4", pickedById: "u-zero", pickedAt: null },
    { id: "p-5", waveId: "w-2", orderId: "o-7", pickedById: "u-active", pickedAt: IN },
  ];
  return { memberships, users, orders, audits, pickWaves, pickWaveOrders };
}

function makeService(data: any) {
  const prisma: any = {
    membership: makeTable(data.memberships ?? []),
    user: makeTable(data.users ?? []),
    order: makeTable(data.orders ?? []),
    auditLog: makeTable(data.audits ?? []),
    pickWave: makeTable(data.pickWaves ?? []),
    pickWaveOrder: makeTable(data.pickWaveOrders ?? []),
  };
  return new OrderTeamPerformanceService(prisma);
}

describe("ON12 team performance", () => {
  it("active member carries every metric; bulk rows do NOT inflate statusChanges; out-of-range rows excluded", async () => {
    const svc = makeService(baseData());
    const out = await svc.getTeamPerformance("org-1", "2026-10-10", "2026-10-10");
    expect(out.from).toBe("2026-10-10");
    expect(out.to).toBe("2026-10-10");
    const active = out.members.find((m: any) => m.userId === "u-active")!;
    expect(active.name).toBe("Ayesha Active");
    expect(active.email).toBe("ayesha@example.com");
    expect(active.role).toBe("SUPPORT_AGENT");
    expect(active.assignedOpen).toBe(1); // o-1 only — completed + delivered are terminal
    expect(active.statusChanges).toBe(2); // NOT 3: the orders.bulk row and yesterday's row never count
    expect(active.holdsPlaced).toBe(1);
    expect(active.holdsReleased).toBe(1);
    expect(active.codCalls).toBe(3);
    expect(active.picksDone).toBe(2); // NOT 3: yesterday's pick and the org-2 wave pick never count
    expect(active.commentsPosted).toBe(2);
  });

  it("zero-activity member appears with zeros + their real assignedOpen", async () => {
    const svc = makeService(baseData());
    const out = await svc.getTeamPerformance("org-1", "2026-10-10", "2026-10-10");
    const zero = out.members.find((m: any) => m.userId === "u-zero")!;
    expect(zero).toBeDefined();
    expect(zero.assignedOpen).toBe(1); // o-4 (the practice order o-5 never counts)
    expect(zero.statusChanges).toBe(0);
    expect(zero.holdsPlaced).toBe(0);
    expect(zero.holdsReleased).toBe(0);
    expect(zero.codCalls).toBe(0);
    expect(zero.picksDone).toBe(0); // p-4 has pickedAt null — not picked
    expect(zero.commentsPosted).toBe(0);
  });

  it("population is ACTIVE org members only; totals = member sums", async () => {
    const svc = makeService(baseData());
    const out = await svc.getTeamPerformance("org-1", "2026-10-10", "2026-10-10");
    expect(out.members.map((m: any) => m.userId).sort()).toEqual(["u-active", "u-zero"]);
    expect(out.totals).toEqual({
      assignedOpen: 2, statusChanges: 2, holdsPlaced: 1, holdsReleased: 1,
      codCalls: 3, picksDone: 2, commentsPosted: 2,
    });
    const sum = (k: string) => out.members.reduce((s: number, m: any) => s + m[k], 0);
    for (const k of Object.keys(out.totals)) expect((out.totals as any)[k]).toBe(sum(k));
  });

  it("assignedOpen is a current snapshot — the range never shrinks it", async () => {
    const svc = makeService(baseData());
    // A range in the far past changes the range-bound metrics to 0
    // but assignedOpen (right now) stays exactly the same.
    const out = await svc.getTeamPerformance("org-1", "2020-01-01", "2020-01-31");
    const active = out.members.find((m: any) => m.userId === "u-active")!;
    expect(active.assignedOpen).toBe(1);
    expect(active.statusChanges).toBe(0);
    expect(active.picksDone).toBe(0);
  });

  it("cross-org isolation: org-2 sees only its own members and rows", async () => {
    const svc = makeService(baseData());
    const out = await svc.getTeamPerformance("org-2", "2026-10-10", "2026-10-10");
    expect(out.members.map((m: any) => m.userId)).toEqual(["u-other"]);
    expect(out.members[0].commentsPosted).toBe(1);
    expect(out.members[0].assignedOpen).toBe(0);
    expect(out.totals.statusChanges).toBe(0); // u-active's org-2 audit row belongs to no org-2 member
  });

  it("rejects from > to with the ON9 Bengali 400", async () => {
    const svc = makeService(baseData());
    await expect(svc.getTeamPerformance("org-1", "2026-10-11", "2026-10-10")).rejects.toThrow(/শুরুর তারিখ/);
  });
});
