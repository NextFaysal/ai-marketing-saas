import { AdsService } from "./ads.service";
import { computeSpendWatch } from "./spend-watch";
import { AutomationService, JOB_TEMPLATES, JOB_TYPES } from "../automation/automation.service";
import { dhakaDayKey } from "../crm/lead-followups";

/**
 * AD4 — account-level spend watchdog (ALERTING ONLY).
 * Coverage: the shared computation's honest math (Dhaka-day today =
 * partial, trailing COMPLETE days only, basis limited by the
 * account's creation day, campaign-level rows only, own currency
 * only, exact BigInt anomaly boundary, zero-history behaviour), the
 * watchdog job (per-kind daily dedupe via AuditLog markers, ACTIVE
 * OWNER/ADMIN recipients, disabled accounts skipped), the settings
 * PATCH validation, tenant isolation, and the automation job
 * registration (JOB_TYPES + template + executeJob dispatch).
 * All data is in-memory fixture data — no platform or DB involved.
 */

const DAY = 86_400_000;
const todayKey = dhakaDayKey(new Date());
const dayDate = (key: string) => new Date(`${key}T00:00:00.000Z`);
const todayDate = dayDate(todayKey);
const dayAgo = (n: number) => new Date(todayDate.getTime() - n * DAY);

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, cond]: [string, any]) => {
    const value = row[key];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("in" in cond) return cond.in.includes(value);
      if ("gte" in cond) return value >= cond.gte;
      if ("lte" in cond) return value <= cond.lte;
      if ("gt" in cond) return value > cond.gt;
      return false;
    }
    return value === cond;
  });
}

function table(rows: any[]) {
  return {
    findMany: async ({ where, take }: any = {}) => {
      const out = rows.filter((r) => matches(r, where));
      return take ? out.slice(0, take) : out;
    },
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    create: async ({ data }: any) => {
      const row = { id: `row-${rows.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("record not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
  };
}

function makeDb() {
  const db: any = {
    accounts: [] as any[],
    metrics: [] as any[],
    members: [] as any[],
    notifications: [] as any[],
    auditRows: [] as any[],
    integrations: [] as any[],
  };
  db.prisma = {
    adAccount: table(db.accounts),
    dailyAdMetric: table(db.metrics),
    // The notification fan-out reads `membership` (role+status on the row).
    membership: table(db.members),
    agentNotification: table(db.notifications),
    auditLog: table(db.auditRows),
    integration: table(db.integrations),
  };
  return db;
}

function auditFor(db: any) {
  return {
    log: async (entry: any) => {
      db.auditRows.push({
        id: `audit-${db.auditRows.length + 1}`,
        createdAt: new Date(),
        organizationId: entry.organizationId ?? null,
        userId: entry.userId ?? null,
        ...entry,
      });
    },
  };
}

function metric(accountId: string, date: Date, spendMinor: bigint, extra: any = {}) {
  return {
    id: `m-${Math.random().toString(36).slice(2, 9)}`,
    organizationId: "org-1",
    adAccountId: accountId,
    date,
    currency: "BDT",
    spendMinor,
    adExternalId: "",
    campaignExternalId: "cmp-1",
    ...extra,
  };
}

function seedAccount(db: any, over: any = {}) {
  const account = {
    id: "acc-1",
    organizationId: "org-1",
    platform: "meta",
    sourceType: "api",
    externalId: "act_1",
    name: "Main Shop",
    currency: "BDT",
    status: "ACTIVE",
    integrationId: "int-1",
    createdAt: new Date(Date.now() - 30 * DAY),
    spendWatchEnabled: true,
    dailyCapMinor: null as bigint | null,
    anomalyPct: null as number | null,
    ...over,
  };
  db.accounts.push(account);
  return account;
}

function seedMembers(db: any) {
  db.members.push(
    { id: "mem-owner", organizationId: "org-1", userId: "owner-1", role: "OWNER", status: "ACTIVE" },
    { id: "mem-admin", organizationId: "org-1", userId: "admin-1", role: "ADMIN", status: "ACTIVE" },
    { id: "mem-susp", organizationId: "org-1", userId: "susp-1", role: "ADMIN", status: "SUSPENDED" },
    { id: "mem-agent", organizationId: "org-1", userId: "agent-1", role: "AGENT", status: "ACTIVE" },
  );
}

function seedWeek(db: any, accountId: string, dailyMinor: bigint) {
  for (let offset = 1; offset <= 7; offset += 1) {
    db.metrics.push(metric(accountId, dayAgo(offset), dailyMinor));
  }
}

describe("AD4 computeSpendWatch — honest math", () => {
  it("full 7-day basis: average, cap and anomaly from campaign-level rows", async () => {
    const db = makeDb();
    const account = seedAccount(db, { dailyCapMinor: 20_000n, anomalyPct: 100 });
    seedWeek(db, account.id, 10_000n);
    db.metrics.push(metric(account.id, todayDate, 25_000n));
    const c = await computeSpendWatch(db.prisma, account);
    expect(c.avgDaysUsed).toBe(7);
    expect(c.avgDailySpendMinor).toBe("10000");
    expect(c.todaySpendMinor).toBe("25000");
    expect(c.capCrossed).toBe(true);
    // 25000*7*100 = 17,500,000 >= 70000*200 = 14,000,000
    expect(c.anomalyTriggered).toBe(true);
    expect(c.anomalyThresholdMinor).toBe("20000");
    expect(c.avgBasis).toContain("৭টি");
    expect(c.todaySpendFormatted).toBe("BDT 250.00");
  });

  it("anomaly boundary is exact BigInt math (19999 no, 20000 yes at avg 10000 +100%)", async () => {
    const db = makeDb();
    const account = seedAccount(db, { anomalyPct: 100 });
    seedWeek(db, account.id, 10_000n);
    db.metrics.push(metric(account.id, todayDate, 19_999n));
    expect((await computeSpendWatch(db.prisma, account)).anomalyTriggered).toBe(false);
    db.metrics[db.metrics.length - 1].spendMinor = 20_000n;
    expect((await computeSpendWatch(db.prisma, account)).anomalyTriggered).toBe(true);
  });

  it("partial history: basis stops at the account's creation day and says so", async () => {
    const db = makeDb();
    // Created on the Dhaka day 2 days ago -> only offsets 1 and 2 count.
    const account = seedAccount(db, {
      createdAt: new Date(todayDate.getTime() - 2 * DAY + 3_600_000),
      anomalyPct: 50,
    });
    db.metrics.push(metric(account.id, dayAgo(1), 5_000n));
    db.metrics.push(metric(account.id, dayAgo(2), 15_000n));
    db.metrics.push(metric(account.id, dayAgo(5), 999_999n)); // before creation — excluded
    const c = await computeSpendWatch(db.prisma, account);
    expect(c.avgDaysUsed).toBe(2);
    expect(c.avgDailySpendMinor).toBe("10000");
    expect(c.avgBasis).toContain("২টি");
    expect(c.avgBasis).toContain("ইতিহাস এখনো নেই");
  });

  it("account created today: zero complete days — anomaly can never fire, cap still can", async () => {
    const db = makeDb();
    const account = seedAccount(db, { createdAt: new Date(), dailyCapMinor: 1_000n, anomalyPct: 1 });
    db.metrics.push(metric(account.id, todayDate, 9_999_999n));
    const c = await computeSpendWatch(db.prisma, account);
    expect(c.avgDaysUsed).toBe(0);
    expect(c.anomalyTriggered).toBe(false);
    expect(c.capCrossed).toBe(true);
  });

  it("zero-spend history: trailing sum 0 — anomaly never fires even with pct=1", async () => {
    const db = makeDb();
    const account = seedAccount(db, { anomalyPct: 1 });
    db.metrics.push(metric(account.id, todayDate, 9_999_999n));
    const c = await computeSpendWatch(db.prisma, account);
    expect(c.avgDaysUsed).toBe(7);
    expect(c.avgDailySpendMinor).toBe("0");
    expect(c.anomalyTriggered).toBe(false);
  });

  it("ad-level rows and other currencies are never mixed in", async () => {
    const db = makeDb();
    const account = seedAccount(db, { dailyCapMinor: 2_000n });
    db.metrics.push(metric(account.id, todayDate, 1_000n));
    db.metrics.push(metric(account.id, todayDate, 999_999n, { adExternalId: "ad-9" }));
    db.metrics.push(metric(account.id, todayDate, 888_888n, { currency: "USD" }));
    const c = await computeSpendWatch(db.prisma, account);
    expect(c.todaySpendMinor).toBe("1000");
    expect(c.capCrossed).toBe(false);
  });

  it("cap fires exactly at the threshold (>=)", async () => {
    const db = makeDb();
    const account = seedAccount(db, { dailyCapMinor: 5_000n });
    db.metrics.push(metric(account.id, todayDate, 5_000n));
    expect((await computeSpendWatch(db.prisma, account)).capCrossed).toBe(true);
  });
});

describe("AD4 runSpendWatchdog — alerts, dedupe, recipients", () => {
  it("fires cap + anomaly once per kind per day to ACTIVE OWNER/ADMIN with real figures", async () => {
    const db = makeDb();
    seedMembers(db);
    const account = seedAccount(db, { dailyCapMinor: 20_000n, anomalyPct: 100 });
    seedWeek(db, account.id, 10_000n);
    db.metrics.push(metric(account.id, todayDate, 25_000n));
    const svc = new AdsService(db.prisma, auditFor(db) as any);

    const first = await svc.runSpendWatchdog("org-1");
    expect(first).toEqual({ checked: 1, capAlerts: 1, anomalyAlerts: 1 });
    // 2 kinds x 2 recipients (suspended admin + agent excluded)
    expect(db.notifications).toHaveLength(4);
    expect(db.notifications.every((n: any) => n.type === "ad_account_spend_alert")).toBe(true);
    const bodies = db.notifications.map((n: any) => n.body).join("\n");
    expect(bodies).toContain("BDT 250.00");
    expect(bodies).toContain("BDT 200.00");
    expect(bodies).toContain("শুধু সতর্কবার্তা");
    expect(bodies).toContain("স্বয়ংক্রিয়ভাবে বন্ধ বা Pause করা হয়নি");
    expect(bodies).toContain("গত ৭টি সম্পূর্ণ দিনের গড়");

    const second = await svc.runSpendWatchdog("org-1");
    expect(second).toEqual({ checked: 1, capAlerts: 0, anomalyAlerts: 0 });
    expect(db.notifications).toHaveLength(4);
  });

  it("dedupe is per alert KIND: cap-only account never gets an anomaly alert", async () => {
    const db = makeDb();
    seedMembers(db);
    const account = seedAccount(db, { dailyCapMinor: 1_000n, anomalyPct: null });
    db.metrics.push(metric(account.id, todayDate, 5_000n));
    const svc = new AdsService(db.prisma, auditFor(db) as any);
    const r = await svc.runSpendWatchdog("org-1");
    expect(r).toEqual({ checked: 1, capAlerts: 1, anomalyAlerts: 0 });
    expect(db.auditRows.some((a: any) => a.action === "ad_account.spend_cap_notified")).toBe(true);
    expect(db.auditRows.some((a: any) => a.action === "ad_account.spend_anomaly_notified")).toBe(false);
  });

  it("watch-disabled accounts are skipped entirely", async () => {
    const db = makeDb();
    seedMembers(db);
    seedAccount(db, { spendWatchEnabled: false, dailyCapMinor: 1n });
    db.metrics.push(metric("acc-1", todayDate, 9_999_999n));
    const svc = new AdsService(db.prisma, auditFor(db) as any);
    expect(await svc.runSpendWatchdog("org-1")).toEqual({ checked: 0, capAlerts: 0, anomalyAlerts: 0 });
    expect(db.notifications).toHaveLength(0);
  });

  it("tenant isolation: another org's accounts are never computed or alerted", async () => {
    const db = makeDb();
    seedMembers(db);
    seedAccount(db, { id: "acc-foreign", organizationId: "org-2", dailyCapMinor: 1n });
    db.metrics.push(metric("acc-foreign", todayDate, 9_999n, { organizationId: "org-2" }));
    const svc = new AdsService(db.prisma, auditFor(db) as any);
    expect(await svc.runSpendWatchdog("org-1")).toEqual({ checked: 0, capAlerts: 0, anomalyAlerts: 0 });
    expect(db.notifications).toHaveLength(0);
  });
});

describe("AD4 updateSpendWatch / getSpendWatch", () => {
  it("stores the cap as minor units, returns strings, and audits", async () => {
    const db = makeDb();
    const account = seedAccount(db, { spendWatchEnabled: false });
    const svc = new AdsService(db.prisma, auditFor(db) as any);
    const out = await svc.updateSpendWatch("org-1", "owner-1", account.id, {
      enabled: true, dailyCap: "5000.50", anomalyPct: 50,
    });
    expect(out).toEqual({ id: account.id, spendWatchEnabled: true, dailyCapMinor: "500050", anomalyPct: 50 });
    expect(db.accounts[0].dailyCapMinor).toBe(500_050n);
    expect(db.auditRows.some((a: any) => a.action === "ad_account.spend_watch_update")).toBe(true);
  });

  it("null clears cap and anomaly; invalid values are honest 400s", async () => {
    const db = makeDb();
    const account = seedAccount(db, { dailyCapMinor: 100n, anomalyPct: 10 });
    const svc = new AdsService(db.prisma, auditFor(db) as any);
    const cleared = await svc.updateSpendWatch("org-1", "owner-1", account.id, { dailyCap: null, anomalyPct: null });
    expect(cleared.dailyCapMinor).toBeNull();
    expect(cleared.anomalyPct).toBeNull();
    await expect(svc.updateSpendWatch("org-1", "owner-1", account.id, { dailyCap: "abc" })).rejects.toMatchObject({ code: "ads.invalid" });
    await expect(svc.updateSpendWatch("org-1", "owner-1", account.id, { dailyCap: "0" })).rejects.toThrow(/০-এর বেশি/);
    await expect(svc.updateSpendWatch("org-1", "owner-1", account.id, { anomalyPct: 0 })).rejects.toThrow(/১ থেকে ১০০০/);
    await expect(svc.updateSpendWatch("org-1", "owner-1", account.id, { anomalyPct: 1001 })).rejects.toThrow(/১ থেকে ১০০০/);
    await expect(svc.updateSpendWatch("org-1", "owner-1", account.id, { anomalyPct: 2.5 })).rejects.toThrow(/১ থেকে ১০০০/);
  });

  it("foreign account is a 404 for both PATCH and GET", async () => {
    const db = makeDb();
    const account = seedAccount(db, { organizationId: "org-2" });
    const svc = new AdsService(db.prisma, auditFor(db) as any);
    await expect(svc.updateSpendWatch("org-1", "owner-1", account.id, { enabled: true })).rejects.toMatchObject({ code: "ads.adAccountNotFoundInThis" });
    await expect(svc.getSpendWatch("org-1", account.id)).rejects.toMatchObject({ code: "ads.adAccountNotFoundInThis" });
  });

  it("getSpendWatch returns the same computation the job uses", async () => {
    const db = makeDb();
    const account = seedAccount(db, { dailyCapMinor: 20_000n, anomalyPct: 100 });
    seedWeek(db, account.id, 10_000n);
    db.metrics.push(metric(account.id, todayDate, 25_000n));
    const svc = new AdsService(db.prisma, auditFor(db) as any);
    const view = await svc.getSpendWatch("org-1", account.id);
    expect(view.todaySpendMinor).toBe("25000");
    expect(view.avgDaysUsed).toBe(7);
    expect(view.capCrossed).toBe(true);
    expect(view.anomalyTriggered).toBe(true);
  });

  it("listAccounts serializes dailyCapMinor as a string (BigInt never reaches JSON)", async () => {
    const db = makeDb();
    seedAccount(db, { dailyCapMinor: 500_050n });
    db.integrations.push({ id: "int-1", organizationId: "org-1", status: "CONNECTED", lastSyncAt: new Date(), lastError: null, createdAt: new Date() });
    const svc = new AdsService(db.prisma, auditFor(db) as any);
    const list = await svc.listAccounts("org-1");
    const json = JSON.stringify(list);
    expect(json).toContain('"dailyCapMinor":"500050"');
  });
});

describe("AD4 automation job registration", () => {
  it("ad_spend_watchdog is a JOB_TYPE and the template's type is registered", () => {
    expect((JOB_TYPES as readonly string[]).includes("ad_spend_watchdog")).toBe(true);
    const tpl = JOB_TEMPLATES.find((t) => t.key === "ad_spend_watchdog");
    expect(tpl).toBeTruthy();
    expect((JOB_TYPES as readonly string[]).includes(tpl!.type)).toBe(true);
    expect(tpl!.targetKind).toBe("org");
    expect(tpl!.descriptionBn).toContain("শুধু সতর্কতা");
  });

  it("executeJob dispatches to AdsService.runSpendWatchdog with the job's org", async () => {
    const calls: string[] = [];
    const adsStub = {
      runSpendWatchdog: async (orgId: string) => {
        calls.push(orgId);
        return { checked: 3, capAlerts: 1, anomalyAlerts: 0 };
      },
    };
    const svc = new AutomationService(
      {} as any, { log: async () => undefined } as any,
      {} as any, {} as any, adsStub as any, {} as any, {} as any, {} as any,
    );
    const result: any = await svc.executeJob({ organizationId: "org-9", createdById: "owner", type: "ad_spend_watchdog" });
    expect(calls).toEqual(["org-9"]);
    expect(result.checked).toBe(3);
  });

  it("executeJob fails honestly when the ads service is unavailable", async () => {
    const svc = new AutomationService(
      {} as any, { log: async () => undefined } as any,
      {} as any, {} as any, undefined as any, {} as any, {} as any, {} as any,
    );
    await expect(svc.executeJob({ organizationId: "org-9", createdById: "owner", type: "ad_spend_watchdog" }))
      .rejects.toMatchObject({ code: "automation.adsServiceIsNotAvailableIn" });
  });
});
