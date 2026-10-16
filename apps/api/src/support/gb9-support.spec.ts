process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "gb9-test-secret";

import { SupportService, slaState, loadSupportSlaHours, SUPPORT_SLA_DEFAULTS } from "./support.service";

/**
 * GB9 (GC23) — support additions:
 * (a) ticket category: tenant create validates the vocabulary
 *     (default "other", invalid → 400); admins can recategorize
 *     through the existing update path (invalid → 400);
 * (b) firstRespondedAt stamps on the FIRST admin reply only,
 *     inside the same update write as the reply bookkeeping;
 * (c) SLA breach is computed on read for ADMIN payloads only:
 *     unresolved + unanswered + past createdAt + slaHours →
 *     slaBreached + slaDueAt; the tenant payload carries neither.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in v) return v.in.includes(row[k]);
      return true;
    }
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {}))[0] ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    findUnique: async ({ where }: any) => rows.filter((r) => matches(r, where ?? {}))[0] ?? null,
    create: async ({ data }: any) => {
      const row = {
        id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(),
        lastMessageAt: new Date(), status: "open", priority: "normal", category: "other",
        firstRespondedAt: null, ...data,
      };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (row) Object.assign(row, data);
      return row;
    },
  };
}

function build() {
  const tables: any = {
    supportTicket: makeTable("ticket"),
    supportTicketMessage: makeTable("msg"),
    organization: makeTable("org"),
    user: makeTable("user"),
    membership: makeTable("membership"),
    systemSetting: makeTable("setting"),
  };
  tables.organization.rows.push({ id: "org-1", name: "Test Shop" });
  const prisma: any = { ...tables };
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new SupportService(prisma, audit as any);
  return { svc, tables, prisma };
}

describe("GB9 support — category", () => {
  it("create defaults to 'other' and accepts a valid category", async () => {
    const { svc, tables } = build();
    const t1: any = await svc.createTicket("org-1", "user-1", { subject: "Help needed", body: "details" });
    expect(t1.category).toBe("other");
    const t2: any = await svc.createTicket("org-1", "user-1", { subject: "Bill question", body: "details", category: "billing" });
    expect(t2.category).toBe("billing");
    expect(tables.supportTicket.rows.map((r: any) => r.category)).toEqual(["other", "billing"]);
  });

  it("create rejects an invalid category with 400", async () => {
    const { svc } = build();
    await expect(svc.createTicket("org-1", "user-1", {
      subject: "Help needed", body: "details", category: "random",
    })).rejects.toMatchObject({ status: 400 });
  });

  it("admin update can recategorize; invalid category → 400", async () => {
    const { svc } = build();
    const t: any = await svc.createTicket("org-1", "user-1", { subject: "Help needed", body: "details" });
    const updated: any = await svc.updateAsAdmin({ id: "admin-1" }, t.id, { category: "technical" });
    expect(updated.category).toBe("technical");
    await expect(svc.updateAsAdmin({ id: "admin-1" }, t.id, { category: "nope" }))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe("GB9 support — first response stamp", () => {
  it("the first admin reply stamps firstRespondedAt; a second reply never moves it", async () => {
    const { svc, tables } = build();
    const t: any = await svc.createTicket("org-1", "user-1", { subject: "Help needed", body: "details" });
    expect(t.firstRespondedAt).toBeNull();
    await svc.replyAsAdmin({ id: "admin-1" }, t.id, "প্রথম উত্তর");
    const afterFirst = tables.supportTicket.rows[0].firstRespondedAt;
    expect(afterFirst).toBeInstanceOf(Date);
    await new Promise((r) => setTimeout(r, 5));
    await svc.replyAsAdmin({ id: "admin-1" }, t.id, "দ্বিতীয় উত্তর");
    expect(tables.supportTicket.rows[0].firstRespondedAt).toBe(afterFirst);
  });

  it("tenant replies do NOT stamp firstRespondedAt", async () => {
    const { svc, tables } = build();
    const t: any = await svc.createTicket("org-1", "user-1", { subject: "Help needed", body: "details" });
    await svc.replyAsTenant("org-1", "user-1", t.id, "আরেকটু তথ্য");
    expect(tables.supportTicket.rows[0].firstRespondedAt).toBeNull();
  });
});

describe("GB9 support — SLA on read", () => {
  it("slaState: unanswered + past due → breached; answered / resolved / within window → not", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    const old = { priority: "normal", status: "open", firstRespondedAt: null, createdAt: new Date("2026-10-13T12:00:00Z") };
    const s = slaState(old, SUPPORT_SLA_DEFAULTS, now);
    expect(s.slaBreached).toBe(true);
    expect(s.slaDueAt).toBe("2026-10-14T12:00:00.000Z");
    expect(slaState({ ...old, firstRespondedAt: new Date() }, SUPPORT_SLA_DEFAULTS, now).slaBreached).toBe(false);
    expect(slaState({ ...old, status: "resolved" }, SUPPORT_SLA_DEFAULTS, now).slaBreached).toBe(false);
    expect(slaState({ ...old, createdAt: new Date("2026-10-15T06:00:00Z") }, SUPPORT_SLA_DEFAULTS, now).slaBreached).toBe(false);
    // high priority: 8h window
    expect(slaState({ ...old, priority: "high", createdAt: new Date("2026-10-15T03:00:00Z") }, SUPPORT_SLA_DEFAULTS, now).slaBreached).toBe(true);
    // unknown priority falls back to normal (24h)
    expect(slaState({ ...old, priority: "urgent-ish", createdAt: new Date("2026-10-15T03:00:00Z") }, SUPPORT_SLA_DEFAULTS, now).slaBreached).toBe(false);
  });

  it("admin list carries slaBreached/slaDueAt + the breached-only filter; tenant list carries neither", async () => {
    const { svc, tables } = build();
    const t: any = await svc.createTicket("org-1", "user-1", { subject: "Old ticket", body: "details" });
    // Age the ticket beyond the normal-priority 24h SLA.
    tables.supportTicket.rows[0].createdAt = new Date(Date.now() - 48 * 3600_000);

    const adminList: any[] = await svc.listTicketsAdmin({});
    expect(adminList).toHaveLength(1);
    expect(adminList[0].slaBreached).toBe(true);
    expect(adminList[0].slaDueAt).toBeTruthy();

    const breachedOnly: any[] = await svc.listTicketsAdmin({ slaBreached: true });
    expect(breachedOnly.map((x) => x.id)).toEqual([t.id]);
    await svc.replyAsAdmin({ id: "admin-1" }, t.id, "উত্তর");
    const afterReply: any[] = await svc.listTicketsAdmin({ slaBreached: true });
    expect(afterReply).toHaveLength(0);

    const tenantList: any[] = await svc.listTickets("org-1");
    expect(tenantList[0].slaBreached).toBeUndefined();
    expect(tenantList[0].slaDueAt).toBeUndefined();
  });

  it("loadSupportSlaHours honors the SystemSetting override and falls back per-key", async () => {
    const { tables, prisma } = build();
    expect(await loadSupportSlaHours(prisma)).toEqual({ low: 72, normal: 24, high: 8, urgent: 4 });
    tables.systemSetting.rows.push({
      id: "setting-1", key: "supportSlaHours", value: { normal: 12, high: "soon", low: -5 },
    });
    expect(await loadSupportSlaHours(prisma)).toEqual({ low: 72, normal: 12, high: 8, urgent: 4 });
  });

  it("admin list filters by category", async () => {
    const { svc } = build();
    await svc.createTicket("org-1", "user-1", { subject: "Bill one", body: "x", category: "billing" });
    await svc.createTicket("org-1", "user-1", { subject: "Tech one", body: "x", category: "technical" });
    const billing: any[] = await svc.listTicketsAdmin({ category: "billing" });
    expect(billing).toHaveLength(1);
    expect(billing[0].subject).toBe("Bill one");
  });
});
