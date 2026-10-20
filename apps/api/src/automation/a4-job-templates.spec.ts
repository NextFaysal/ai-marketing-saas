import { AutomationService, JOB_TEMPLATES, JOB_TYPES } from "./automation.service";

/**
 * Automations A4 — jobs day-one:
 * - the template catalogue is integral: every template type is a
 *   real JOB_TYPES member with a unique key and a valid interval;
 * - install creates a REAL ScheduledJob through createJob (org
 *   templates target the org; targeted templates require a
 *   tenant-chosen target that belongs to the org; duplicates are
 *   refused);
 * - competitor_multi_sync — previously missing from the tenant
 *   form — is creatable end-to-end through the normal create path.
 */
const ORG = "org-1";
type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("gte" in v) return new Date(row[k]).getTime() >= new Date((v as any).gte).getTime();
      return true;
    }
    return row[k] === v;
  });
}
function table(store: Row[]) {
  return {
    findMany: jest.fn(async (args: any = {}) => store.filter((r) => matches(r, args.where))),
    findFirst: jest.fn(async (args: any = {}) => store.find((r) => matches(r, args.where)) ?? null),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), ...data };
      store.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((r) => matches(r, where));
      if (row) Object.assign(row, data);
      return row;
    }),
  };
}
function fakeDb() {
  const db: any = { jobs: [] as Row[], integrations: [] as Row[], competitors: [] as Row[] };
  db.scheduledJob = table(db.jobs);
  db.integration = table(db.integrations);
  db.competitor = table(db.competitors);
  db.organization = { findMany: jest.fn(async () => []) };
  return db;
}
function service(db: any, competitorsSvc?: any) {
  return new AutomationService(
    db as any, { log: jest.fn(async () => undefined) } as any,
    {} as any, {} as any, {} as any, {} as any, competitorsSvc ?? ({} as any), {} as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  );
}

describe("A4 template catalogue integrity", () => {
  it("every template is grounded in a real job type", () => {
    const keys = new Set<string>();
    for (const tpl of JOB_TEMPLATES) {
      expect((JOB_TYPES as readonly string[]).includes(tpl.type)).toBe(true);
      expect(keys.has(tpl.key)).toBe(false);
      keys.add(tpl.key);
      // CX3: the two reply-debounce sweep templates run every
      // 1 minute, so the floor is 1 (createJob's minimum too).
      expect(tpl.intervalMinutes).toBeGreaterThanOrEqual(1);
      expect(["org", "integration", "competitor"]).toContain(tpl.targetKind);
      expect(tpl.descriptionBn.length).toBeGreaterThan(10);
    }
    // the brief's minimum set is covered
    const types = JOB_TEMPLATES.map((t) => t.type);
    for (const required of ["daily_report", "subscription_sweep", "billing_reminders", "lead_followup_sweep", "competitor_multi_sync", "meta_status_sync", "audience_refresh", "audit_retention"]) {
      expect(types).toContain(required);
    }
  });

  it("the catalogue endpoint returns the same list", () => {
    expect(service(fakeDb()).listJobTemplates()).toBe(JOB_TEMPLATES);
  });
});

describe("A4 template install", () => {
  it("org template installs through createJob with the org as target and the job defaults", async () => {
    const db = fakeDb();
    const job: any = await service(db).installJobTemplate(ORG, "owner", "lead_followup_sweep");
    expect(job).toMatchObject({ organizationId: ORG, type: "lead_followup_sweep", targetId: ORG, intervalMinutes: 60, enabled: true });
    expect(db.jobs).toHaveLength(1);
  });

  it("duplicate install of the same template target is refused", async () => {
    const db = fakeDb();
    const svc = service(db);
    await svc.installJobTemplate(ORG, "owner", "billing_reminders");
    await expect(svc.installJobTemplate(ORG, "owner", "billing_reminders")).rejects.toThrow(/ইতিমধ্যে তৈরি/);
    expect(db.jobs).toHaveLength(1);
  });

  it("unknown template key is a 404", async () => {
    await expect(service(fakeDb()).installJobTemplate(ORG, "owner", "nope")).rejects.toMatchObject({ code: "automation.jobTemplateNotFound" });
  });

  it("competitor template requires a chosen, org-owned competitor", async () => {
    const db = fakeDb();
    db.competitors.push({ id: "comp-1", organizationId: ORG, name: "Rival" });
    db.competitors.push({ id: "comp-2", organizationId: "org-2", name: "Foreign" });
    const svc = service(db);
    await expect(svc.installJobTemplate(ORG, "owner", "competitor_multi_sync")).rejects.toThrow(/Competitor বেছে/);
    await expect(svc.installJobTemplate(ORG, "owner", "competitor_multi_sync", { targetId: "comp-2" })).rejects.toThrow(/not found/i);
    const job: any = await svc.installJobTemplate(ORG, "owner", "competitor_multi_sync", { targetId: "comp-1" });
    expect(job).toMatchObject({ type: "competitor_multi_sync", targetId: "comp-1", intervalMinutes: 1440 });
  });

  it("integration template validates the store the same way", async () => {
    const db = fakeDb();
    db.integrations.push({ id: "int-1", organizationId: ORG, provider: "woocommerce" });
    const svc = service(db);
    await expect(svc.installJobTemplate(ORG, "owner", "woo_orders_sync", { targetId: "int-x" })).rejects.toThrow(/not found/i);
    const job: any = await svc.installJobTemplate(ORG, "owner", "woo_orders_sync", { targetId: "int-1" });
    expect(job).toMatchObject({ type: "woo_orders", targetId: "int-1", intervalMinutes: 30 });
  });
});

describe("A4 competitor_multi_sync creatable end-to-end", () => {
  it("createJob accepts the type and executeJob dispatches to syncMultiPlatform", async () => {
    const db = fakeDb();
    const competitorsSvc = { syncMultiPlatform: jest.fn(async () => ({ synced: 4 })) };
    const svc = service(db, competitorsSvc);
    const job: any = await svc.createJob(ORG, "owner", { name: "Multi sync", type: "competitor_multi_sync", targetId: "comp-1", intervalMinutes: 1440 });
    expect(job.type).toBe("competitor_multi_sync");
    const out = await svc.executeJob(job);
    expect(competitorsSvc.syncMultiPlatform).toHaveBeenCalledWith(ORG, "owner", "comp-1");
    expect(out).toEqual({ synced: 4 });
  });
});
