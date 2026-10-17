import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { AgencyConsoleService, agencyDateRanges } from "./agency.service";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * NF15 (FB5) — Agency / reseller console specs. Fake-prisma
 * harness in the nf13 pattern (in-memory tables, `matches`
 * org-scoped filtering). OrganizationsService is the REAL
 * service over the same fake prisma, so listMine (the
 * membership basis) and create() (TD1 slug governance + the
 * ORG12 cap) are exercised on their production code paths —
 * including the $transaction shape the ob4 spec uses.
 * AnalyticsService is a recording stub returning known totals:
 * the console must reuse overview() and pass its numbers
 * through exactly.
 */

type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "userId_organizationId") {
      const c = v as any;
      return row.userId === c.userId && row.organizationId === c.organizationId;
    }
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub));
    if (k === "AND") return (v as any[]).every((sub) => matches(row, sub));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.map(String).includes(String(row[k]));
      if ("notIn" in v) return !(v as any).notIn.map(String).includes(String(row[k]));
      return true;
    }
    return String(row[k]) === String(v);
  });
}

let seq = 0;
function makeTable(rows: Row[]) {
  const api: any = {
    rows,
    async findFirst({ where }: any = {}) {
      return rows.find((r) => matches(r, where)) ?? null;
    },
    async findMany({ where, orderBy }: any = {}) {
      let out = rows.filter((r) => matches(r, where));
      const spec = Array.isArray(orderBy) ? orderBy[0] : orderBy;
      if (spec) {
        const [key, dir] = Object.entries(spec)[0] as [string, string];
        out = [...out].sort((a, b) => {
          const av = a[key] instanceof Date ? a[key].getTime() : String(a[key] ?? "");
          const bv = b[key] instanceof Date ? b[key].getTime() : String(b[key] ?? "");
          const c = av < bv ? -1 : av > bv ? 1 : 0;
          return dir === "desc" ? -c : c;
        });
      }
      return out;
    },
    async create({ data }: any) {
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    async update({ where, data }: any) {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error("Record not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    async count({ where }: any = {}) {
      return rows.filter((r) => matches(r, where)).length;
    },
  };
  api.findUnique = api.findFirst;
  return api;
}

function makeAnalyticsStub(
  byOrg: Record<string, { today: any; month: any }>,
  failing: Set<string> = new Set(),
) {
  const calls: { organizationId: string; from?: string; to?: string }[] = [];
  return {
    calls,
    async overview(organizationId: string, from?: string, to?: string) {
      calls.push({ organizationId, from, to });
      if (failing.has(organizationId)) throw new Error("analytics down");
      const v = byOrg[organizationId];
      if (!v) return { totals: { orders: 0, revenueMinor: "0" } };
      return from === to ? v.today : v.month;
    },
  };
}

const USER = "user-1";

function makeWorld(opts: {
  analytics?: ReturnType<typeof makeAnalyticsStub>;
  settings?: Row[];
} = {}) {
  const db: Record<string, Row[]> = {
    organization: [
      { id: "org-a", name: "Agency HQ", slug: "agency-hq", creditMinor: 0n, tags: ["internal"], status: "ACTIVE", archivedAt: null },
      { id: "org-b", name: "Client Shop B", slug: "client-b", creditMinor: 0n, tags: [], status: "ACTIVE", archivedAt: null },
      { id: "org-c", name: "Secret Shop C", slug: "secret-c", creditMinor: 0n, tags: [], status: "ACTIVE", archivedAt: null },
    ],
    membership: [
      { id: "m-a", userId: USER, organizationId: "org-a", role: "OWNER", status: "ACTIVE", createdAt: new Date(1) },
      { id: "m-b", userId: USER, organizationId: "org-b", role: "ADMIN", status: "ACTIVE", createdAt: new Date(2) },
      // org-c belongs to someone else entirely.
      { id: "m-c", userId: "user-2", organizationId: "org-c", role: "OWNER", status: "ACTIVE", createdAt: new Date(3) },
    ],
    order: [],
    channelConversation: [],
    agencyCommissionEntry: [],
    systemSetting: opts.settings ?? [],
    businessProfile: [],
    subscription: [],
    walletAccount: [],
    walletTransaction: [],
  };
  const walletCalls: string[] = [];
  const instrument = (name: string, table: any) => {
    const wrapped: any = { rows: table.rows };
    for (const m of ["findFirst", "findUnique", "findMany", "create", "update", "count"]) {
      wrapped[m] = async (...args: any[]) => { walletCalls.push(`${name}.${m}`); return table[m](...args); };
    }
    return wrapped;
  };
  const prisma: any = {
    organization: makeTable(db.organization),
    membership: makeTable(db.membership),
    order: makeTable(db.order),
    channelConversation: makeTable(db.channelConversation),
    agencyCommissionEntry: makeTable(db.agencyCommissionEntry),
    systemSetting: makeTable(db.systemSetting),
    businessProfile: makeTable(db.businessProfile),
    subscription: makeTable(db.subscription),
    walletAccount: instrument("walletAccount", makeTable(db.walletAccount)),
    walletTransaction: instrument("walletTransaction", makeTable(db.walletTransaction)),
  };
  prisma.$transaction = async (fn: any) => fn(prisma);
  // listMine reads memberships with `include: { organization }`.
  const origMembershipFindMany = prisma.membership.findMany;
  prisma.membership.findMany = async (args: any = {}) => {
    const rows = await origMembershipFindMany(args);
    if (args?.include?.organization) {
      return rows.map((r: Row) => ({
        ...r,
        organization: db.organization.find((o) => o.id === r.organizationId) ?? null,
      }));
    }
    return rows;
  };
  const audit: any = { log: async () => undefined };
  const orgs = new OrganizationsService(prisma, audit);
  const analytics = opts.analytics ?? makeAnalyticsStub({});
  const svc = new AgencyConsoleService(prisma, orgs as any, analytics as any, audit);
  return { db, prisma, orgs, analytics, svc, audit, walletCalls };
}

function seedOrgData(w: ReturnType<typeof makeWorld>, orgId: string, pending: number, unread: number[]) {
  for (let i = 0; i < pending; i++) {
    w.db.order.push({ id: `${orgId}-pend-${i}`, organizationId: orgId, status: "pending" });
  }
  w.db.order.push({ id: `${orgId}-proc`, organizationId: orgId, status: "processing" });
  unread.forEach((n, i) => {
    w.db.channelConversation.push({ id: `${orgId}-conv-${i}`, organizationId: orgId, unreadCount: n });
  });
}

describe("NF15 agency console", () => {
  it("date ranges: today is from==to==today; month starts on the 1st (dashboard overview semantics)", () => {
    const r = agencyDateRanges(new Date("2026-10-17T05:00:00.000Z"));
    expect(r).toEqual({
      todayFrom: "2026-10-17", todayTo: "2026-10-17",
      monthFrom: "2026-10-01", monthTo: "2026-10-17",
    });
  });

  it("1. non-member org NEVER appears: B exists with orders, the user is not a member — its id/name/numbers are nowhere in the payload", async () => {
    const analytics = makeAnalyticsStub({
      "org-a": { today: { totals: { orders: 1, revenueMinor: "1000" } }, month: { totals: { orders: 2, revenueMinor: "2000" } } },
      "org-b": { today: { totals: { orders: 1, revenueMinor: "3000" } }, month: { totals: { orders: 2, revenueMinor: "4000" } } },
      "org-c": { today: { totals: { orders: 77, revenueMinor: "777777" } }, month: { totals: { orders: 88, revenueMinor: "888888" } } },
    });
    const w = makeWorld({ analytics });
    // A world where the user is a member of A only: drop the B membership.
    w.db.membership.splice(w.db.membership.findIndex((m) => m.id === "m-b"), 1);
    seedOrgData(w, "org-c", 9, [42]);
    seedOrgData(w, "org-a", 1, [1]);

    const out: any = await w.svc.getConsole(USER);
    expect(out.orgs).toHaveLength(1);
    expect(out.orgs[0].organization.id).toBe("org-a");
    const payload = JSON.stringify(out);
    expect(payload).not.toContain("org-c");
    expect(payload).not.toContain("Secret Shop C");
    expect(payload).not.toContain("secret-c");
    expect(payload).not.toContain("777777");
    expect(payload).not.toContain("888888");
    // Analytics was never even queried for the non-member org.
    expect(analytics.calls.map((c) => c.organizationId)).not.toContain("org-c");
    expect(out.totals.orgCount).toBe(1);
  });

  it("2. per-org numbers match the direct per-org path exactly; role shown is the caller's role in that org", async () => {
    const analytics = makeAnalyticsStub({
      "org-a": { today: { totals: { orders: 3, revenueMinor: "150000" } }, month: { totals: { orders: 20, revenueMinor: "900000" } } },
      "org-b": { today: { totals: { orders: 5, revenueMinor: "250000" } }, month: { totals: { orders: 40, revenueMinor: "1800000" } } },
    });
    const w = makeWorld({ analytics });
    seedOrgData(w, "org-a", 2, [3, 4]); // pending 2, unread 7
    seedOrgData(w, "org-b", 1, [2]);    // pending 1, unread 2

    const out: any = await w.svc.getConsole(USER);
    const a = out.orgs.find((o: any) => o.organization.id === "org-a");
    const b = out.orgs.find((o: any) => o.organization.id === "org-b");
    expect(a.myRole).toBe("OWNER");
    expect(b.myRole).toBe("ADMIN");
    expect(a.summary).toEqual({
      ordersToday: 3, revenueTodayMinor: "150000",
      ordersMonth: 20, revenueMonthMinor: "900000",
      pendingOrders: 2, unreadInbox: 7,
    });
    expect(b.summary).toEqual({
      ordersToday: 5, revenueTodayMinor: "250000",
      ordersMonth: 40, revenueMonthMinor: "1800000",
      pendingOrders: 1, unreadInbox: 2,
    });
    // Both ranges went through overview() with the dashboard's
    // from/to semantics (today: from==to; month: from the 1st).
    const aCalls = analytics.calls.filter((c) => c.organizationId === "org-a");
    expect(aCalls).toHaveLength(2);
    expect(aCalls[0].from).toBe(aCalls[0].to);
    expect(aCalls[1].from?.slice(8)).toBe("01");
    expect(aCalls[1].to).toBe(aCalls[0].to);
  });

  it("6. totals = sum of listed cards only; one org failing → card null + summariesFailed=1, others intact", async () => {
    const analytics = makeAnalyticsStub(
      {
        "org-a": { today: { totals: { orders: 3, revenueMinor: "150000" } }, month: { totals: { orders: 20, revenueMinor: "900000" } } },
        "org-b": { today: { totals: { orders: 5, revenueMinor: "250000" } }, month: { totals: { orders: 40, revenueMinor: "1800000" } } },
      },
      new Set(["org-b"]),
    );
    const w = makeWorld({ analytics });
    seedOrgData(w, "org-a", 2, [3, 4]);
    seedOrgData(w, "org-b", 1, [2]);

    const out: any = await w.svc.getConsole(USER);
    expect(out.orgs).toHaveLength(2);
    const b = out.orgs.find((o: any) => o.organization.id === "org-b");
    expect(b.summary).toBeNull();
    expect(b.error).toBe("তথ্য লোড হয়নি");
    const a = out.orgs.find((o: any) => o.organization.id === "org-a");
    expect(a.summary).not.toBeNull();
    expect(out.totals).toEqual({
      orgCount: 2,
      ordersToday: 3, revenueTodayMinor: "150000",
      ordersMonth: 20, revenueMonthMinor: "900000",
      pendingOrders: 2, unreadInbox: 7,
      summariesFailed: 1,
    });
  });
});

describe("NF15 client-org creation (ORG12)", () => {
  it("3a. delegation: createClientOrg calls OrganizationsService.create with the same userId+dto+ip and propagates its refusal unchanged", async () => {
    const w = makeWorld();
    const refusal = new BadRequestException("আপনি সর্বোচ্চ 1টি Organization-এর মালিক হতে পারবেন");
    const calls: any[] = [];
    const stubOrgs: any = {
      listMine: async () => [],
      create: async (userId: string, dto: any, ip?: string) => { calls.push({ userId, dto, ip }); throw refusal; },
    };
    const svc = new AgencyConsoleService(w.prisma, stubOrgs, makeAnalyticsStub({}) as any);
    const dto = { name: "New Client", slug: "new-client" } as any;
    await expect(svc.createClientOrg(USER, dto, "1.2.3.4")).rejects.toBe(refusal);
    expect(calls).toEqual([{ userId: USER, dto, ip: "1.2.3.4" }]);
  });

  it("3b. real create() path: the ORG12 cap refuses through the agency door; under the cap the caller lands OWNER", async () => {
    const w = makeWorld({ settings: [{ key: "maxOrgsPerUser", value: 1 }] });
    // USER already owns org-a (m-a, OWNER) → cap of 1 is full.
    await expect(
      w.svc.createClientOrg(USER, { name: "Second Shop", slug: "second-shop" } as any),
    ).rejects.toThrow(/সর্বোচ্চ 1টি/);
    expect(w.db.organization.some((o) => o.slug === "second-shop")).toBe(false);

    // Raise the cap → creation succeeds and lands the caller OWNER.
    w.db.systemSetting[0].value = 2;
    const created: any = await w.svc.createClientOrg(USER, { name: "Second Shop", slug: "second-shop" } as any);
    expect(created.slug).toBe("second-shop");
    const membership = w.db.membership.find((m) => m.organizationId === created.id && m.userId === USER);
    expect(membership?.role).toBe("OWNER");
    expect(membership?.status).toBe("ACTIVE");
  });
});

describe("NF15 commission records", () => {
  it("4. happy path: create + list, newest first, amount serialised as string, recordsOnly literal, client name resolved from memberships", async () => {
    const w = makeWorld();
    const first: any = await w.svc.createCommission("org-a", USER, {
      clientOrganizationId: "org-b", periodLabel: "সেপ্টেম্বর ২০২৬", amountMinor: "50000", note: "প্রথম মাস",
    });
    expect(first).toMatchObject({
      agencyOrganizationId: "org-a", clientOrganizationId: "org-b",
      clientOrganizationName: "Client Shop B", periodLabel: "সেপ্টেম্বর ২০২৬",
      amountMinor: "50000", note: "প্রথম মাস", recordedById: USER, recordsOnly: true,
    });
    expect(w.db.agencyCommissionEntry[0].amountMinor).toBe(50000n);
    const second: any = await w.svc.createCommission("org-a", USER, {
      clientOrganizationId: "org-b", periodLabel: "অক্টোবর ২০২৬", amountMinor: "75000",
    });
    expect(second.note).toBeNull();

    // Deterministic ordering: in a fast run both creates can land in
    // the same millisecond, and createdAt-desc is then ambiguous (true
    // of real Postgres too). Pin distinct timestamps so the assertion
    // below tests the ordering rule, not clock luck.
    w.db.agencyCommissionEntry[0].createdAt = new Date(Date.now() - 60_000);
    w.db.agencyCommissionEntry[1].createdAt = new Date(Date.now());

    const list: any[] = await w.svc.listCommissions("org-a", USER);
    expect(list.map((e) => e.periodLabel)).toEqual(["অক্টোবর ২০২৬", "সেপ্টেম্বর ২০২৬"]);
    expect(list.every((e) => e.recordsOnly === true)).toBe(true);
    // Entries for a different agency org never leak into this list.
    expect(await w.svc.listCommissions("org-b", USER)).toEqual([]);
  });

  it("4b. client name shows null when the caller no longer belongs to the client org — the entry itself still lists for the agency org", async () => {
    const w = makeWorld();
    await w.svc.createCommission("org-a", USER, {
      clientOrganizationId: "org-b", periodLabel: "অক্টোবর ২০২৬", amountMinor: "1000",
    });
    // The caller leaves the client org afterwards.
    w.db.membership.splice(w.db.membership.findIndex((m) => m.id === "m-b"), 1);
    const list: any[] = await w.svc.listCommissions("org-a", USER);
    expect(list).toHaveLength(1);
    expect(list[0].clientOrganizationId).toBe("org-b");
    expect(list[0].clientOrganizationName).toBeNull();
  });

  it("4c. validation refusals: client not caller's membership, agency==client, amount ≤ 0 / unparsable, empty or over-long period", async () => {
    const w = makeWorld();
    const base = { clientOrganizationId: "org-b", periodLabel: "অক্টোবর ২০২৬", amountMinor: "1000" };
    await expect(w.svc.createCommission("org-a", USER, { ...base, clientOrganizationId: "org-c" }))
      .rejects.toThrow(/সদস্য নন/);
    await expect(w.svc.createCommission("org-a", USER, { ...base, clientOrganizationId: "org-a" }))
      .rejects.toThrow(/নিজেই ক্লায়েন্ট/);
    await expect(w.svc.createCommission("org-a", USER, { ...base, amountMinor: "0" }))
      .rejects.toThrow(/শূন্যের বেশি/);
    await expect(w.svc.createCommission("org-a", USER, { ...base, amountMinor: "-500" }))
      .rejects.toThrow(/শূন্যের বেশি/);
    await expect(w.svc.createCommission("org-a", USER, { ...base, amountMinor: "abc" }))
      .rejects.toThrow(/সঠিক সংখ্যা নয়/);
    await expect(w.svc.createCommission("org-a", USER, { ...base, periodLabel: "   " }))
      .rejects.toThrow(/আবশ্যক/);
    await expect(w.svc.createCommission("org-a", USER, { ...base, periodLabel: "x".repeat(41) }))
      .rejects.toThrow(/৪০ অক্ষর/);
    expect(w.db.agencyCommissionEntry).toHaveLength(0);
  });

  it("5. wallet untouched: ZERO walletAccount/walletTransaction delegate calls across console + commission flows", async () => {
    const analytics = makeAnalyticsStub({
      "org-a": { today: { totals: { orders: 1, revenueMinor: "1000" } }, month: { totals: { orders: 2, revenueMinor: "2000" } } },
      "org-b": { today: { totals: { orders: 1, revenueMinor: "3000" } }, month: { totals: { orders: 2, revenueMinor: "4000" } } },
    });
    const w = makeWorld({ analytics });
    seedOrgData(w, "org-a", 1, [1]);
    await w.svc.getConsole(USER);
    await w.svc.createCommission("org-a", USER, {
      clientOrganizationId: "org-b", periodLabel: "অক্টোবর ২০২৬", amountMinor: "50000",
    });
    await w.svc.listCommissions("org-a", USER);
    expect(w.walletCalls).toEqual([]);
    expect(w.db.walletAccount).toHaveLength(0);
    expect(w.db.walletTransaction).toHaveLength(0);
  });
});
