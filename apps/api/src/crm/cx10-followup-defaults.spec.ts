import { LeadsService, LEAD_STAGES } from "./leads.service";
import { followUpDateFor, followUpDefaultFor, normalizeFollowUpDefaults, validateFollowUpDefaults } from "./lead-followups";

/**
 * CX10 — per-stage follow-up default intervals.
 * Fake-prisma style like lead-followups.spec.ts, plus a crmSetting
 * table keyed by organizationId (the real table's @unique key).
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (k === "OR") return v.some((sub: any) => matches(row, sub));
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("notIn" in v && v.notIn.includes(row[k])) return false;
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("not" in v) { const ok = v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not; if (!ok) return false; }
      if ("contains" in v) return String(row[k] ?? "").toLowerCase().includes(String(v.contains).toLowerCase());
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
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}
function makeCrmSetting() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findUnique: async ({ where }: any) => rows.find((r) => r.organizationId === where.organizationId) ?? null,
    create: async ({ data }: any) => { const row = { id: `set-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.organizationId === where.organizationId); Object.assign(row, data); return row; },
  };
}
function fakePrisma() {
  return {
    lead: makeTable("lead"), leadActivity: makeTable("act"), customer: makeTable("cust"),
    importJob: makeTable("job"), crmSetting: makeCrmSetting(),
  };
}

const H = 3600 * 1000;
function expectStamped(value: unknown, hours: number, before: number, after: number) {
  const t = new Date(value as any).getTime();
  expect(t).toBeGreaterThanOrEqual(before + hours * H - 1000);
  expect(t).toBeLessThanOrEqual(after + hours * H + 1000);
}

describe("CX10 helpers: followUpDefaultFor / followUpDateFor", () => {
  it("no setting at all → null for every stage", () => {
    for (const s of LEAD_STAGES) {
      expect(followUpDefaultFor(null, s)).toBeNull();
      expect(followUpDefaultFor(undefined, s)).toBeNull();
      expect(followUpDefaultFor({}, s)).toBeNull();
      expect(followUpDefaultFor({ followUpDefaultsByStage: null }, s)).toBeNull();
    }
  });
  it("reads both the CrmSetting-row shape and the raw map shape", () => {
    const row = { followUpDefaultsByStage: { new: 24, contacted: 72 } };
    expect(followUpDefaultFor(row, "new")).toBe(24);
    expect(followUpDefaultFor(row, "contacted")).toBe(72);
    expect(followUpDefaultFor({ new: 24 }, "new")).toBe(24);
  });
  it("stage absent from the map → null; terminal stages behave like any stage", () => {
    const row = { followUpDefaultsByStage: { new: 24, won: 168, lost: 720 } };
    expect(followUpDefaultFor(row, "qualified")).toBeNull();
    expect(followUpDefaultFor(row, "won")).toBe(168);
    expect(followUpDefaultFor(row, "lost")).toBe(720);
    expect(followUpDefaultFor(row, "banana")).toBeNull();
  });
  it("corrupt stored values degrade to null, never a nonsense date", () => {
    for (const bad of [0, -5, 8761, 2.5, "24", true]) {
      expect(followUpDefaultFor({ followUpDefaultsByStage: { new: bad } }, "new")).toBeNull();
    }
    expect(normalizeFollowUpDefaults({ followUpDefaultsByStage: { new: 24, won: 0, mars: 5 } })).toEqual({ new: 24 });
  });
  it("followUpDateFor = now + hours, or null", () => {
    const now = new Date("2026-10-12T00:00:00.000Z");
    expect(followUpDateFor({ followUpDefaultsByStage: { new: 24 } }, "new", now)?.toISOString()).toBe("2026-10-13T00:00:00.000Z");
    expect(followUpDateFor(null, "new", now)).toBeNull();
  });
});

describe("CX10 settings write validation", () => {
  it("accepts valid maps, drops explicit nulls, and {} / null clear everything", async () => {
    const prisma = fakePrisma();
    const svc = new LeadsService(prisma as any);
    const saved = await svc.updateFollowUpSetting("org-1", { new: 24, contacted: 72, won: null });
    expect(saved).toEqual({ followUpDefaultsByStage: { new: 24, contacted: 72 } });
    expect(await svc.getFollowUpSetting("org-1")).toEqual({ followUpDefaultsByStage: { new: 24, contacted: 72 } });
    expect(await svc.updateFollowUpSetting("org-1", {})).toEqual({ followUpDefaultsByStage: null });
    expect(prisma.crmSetting.rows[0].followUpDefaultsByStage).toBeNull();
  });
  it("rejects unknown stages and out-of-range / non-integer hours with a 400", async () => {
    const svc = new LeadsService(fakePrisma() as any);
    await expect(svc.updateFollowUpSetting("org-1", { banana: 24 })).rejects.toThrow(/অজানা Lead Stage/);
    await expect(svc.updateFollowUpSetting("org-1", { new: 0 })).rejects.toThrow(/1–8760/);
    await expect(svc.updateFollowUpSetting("org-1", { new: 8761 })).rejects.toThrow(/1–8760/);
    await expect(svc.updateFollowUpSetting("org-1", { new: 2.5 })).rejects.toThrow(/1–8760/);
    await expect(svc.updateFollowUpSetting("org-1", { new: "24" })).rejects.toThrow(/1–8760/);
    await expect(svc.updateFollowUpSetting("org-1", "nope")).rejects.toThrow(/অবজেক্ট/);
    // Bounds themselves are valid.
    await expect(svc.updateFollowUpSetting("org-1", { new: 1, lost: 8760 })).resolves.toEqual({ followUpDefaultsByStage: { new: 1, lost: 8760 } });
  });
  it("validateFollowUpDefaults is the strict twin of the lenient normalizer", () => {
    expect(validateFollowUpDefaults({ new: 24 })).toEqual({ new: 24 });
    expect(() => validateFollowUpDefaults({ new: 0 })).toThrow();
    expect(normalizeFollowUpDefaults({ new: 0 })).toBeNull();
  });
  it("updating the follow-up setting never clobbers the assignment fields on the same row", async () => {
    const prisma = fakePrisma();
    prisma.crmSetting.rows.push({ id: "set-x", organizationId: "org-1", leadAssignStrategy: "round_robin", rrCursorUserId: "u-9", followUpDefaultsByStage: null });
    const svc = new LeadsService(prisma as any);
    await svc.updateFollowUpSetting("org-1", { proposal: 48 });
    const row = prisma.crmSetting.rows[0];
    expect(row.leadAssignStrategy).toBe("round_robin");
    expect(row.rrCursorUserId).toBe("u-9");
    expect(row.followUpDefaultsByStage).toEqual({ proposal: 48 });
  });
});

describe("CX10 LeadsService.create stamping", () => {
  it("no settings at all → nextFollowUpAt stays null (pre-CX10 behaviour)", async () => {
    const svc = new LeadsService(fakePrisma() as any);
    const lead = await svc.create("org-1", "u", { name: "Plain" });
    expect(lead.nextFollowUpAt).toBeNull();
  });
  it("create without an explicit date + a default for the stage → stamped now + hours", async () => {
    const prisma = fakePrisma();
    const svc = new LeadsService(prisma as any);
    await svc.updateFollowUpSetting("org-1", { new: 24, qualified: 48 });
    const before = Date.now();
    const a = await svc.create("org-1", "u", { name: "Fresh" }); // stage defaults to "new"
    const b = await svc.create("org-1", "u", { name: "Mid", stage: "qualified" });
    const c = await svc.create("org-1", "u", { name: "NoDefault", stage: "proposal" });
    const after = Date.now();
    expectStamped(a.nextFollowUpAt, 24, before, after);
    expectStamped(b.nextFollowUpAt, 48, before, after);
    expect(c.nextFollowUpAt).toBeNull(); // no default for proposal → left null
  });
  it("create WITH an explicit date → the explicit date is untouched", async () => {
    const prisma = fakePrisma();
    const svc = new LeadsService(prisma as any);
    await svc.updateFollowUpSetting("org-1", { new: 24 });
    const lead = await svc.create("org-1", "u", { name: "Dated", nextFollowUpAt: "2026-12-01T09:00:00.000Z" });
    expect(new Date(lead.nextFollowUpAt).toISOString()).toBe("2026-12-01T09:00:00.000Z");
  });
  it("tenant isolation: org B's defaults never stamp org A's leads (and vice versa)", async () => {
    const prisma = fakePrisma();
    const svc = new LeadsService(prisma as any);
    await svc.updateFollowUpSetting("org-2", { new: 24 });
    const a = await svc.create("org-1", "u", { name: "OrgA" });
    expect(a.nextFollowUpAt).toBeNull();
    const before = Date.now();
    const b = await svc.create("org-2", "u", { name: "OrgB" });
    expectStamped(b.nextFollowUpAt, 24, before, Date.now());
  });
});

describe("CX10 LeadsService.update stage-change stamping", () => {
  async function setup() {
    const prisma = fakePrisma();
    const svc = new LeadsService(prisma as any);
    await svc.updateFollowUpSetting("org-1", { contacted: 72, won: 168 });
    const lead = await svc.create("org-1", "u", { name: "Mover" }); // stage new, no new-default → null
    expect(lead.nextFollowUpAt).toBeNull();
    return { prisma, svc, lead };
  }
  it("stage change without an explicit date → stamped from the NEW stage's default", async () => {
    const { svc, lead } = await setup();
    const before = Date.now();
    const updated = await svc.update("org-1", "u", lead.id, { stage: "contacted" });
    expectStamped(updated.nextFollowUpAt, 72, before, Date.now());
  });
  it("stage change WITH an explicit date in the same update → explicit wins", async () => {
    const { svc, lead } = await setup();
    const updated = await svc.update("org-1", "u", lead.id, { stage: "contacted", nextFollowUpAt: "2027-01-05T00:00:00.000Z" });
    expect(new Date(updated.nextFollowUpAt).toISOString()).toBe("2027-01-05T00:00:00.000Z");
  });
  it("stage change to a stage WITHOUT a default keeps the existing follow-up (no silent clear — incl. lost)", async () => {
    const { svc, lead } = await setup();
    await svc.update("org-1", "u", lead.id, { nextFollowUpAt: "2026-11-20T00:00:00.000Z" });
    const updated = await svc.update("org-1", "u", lead.id, { stage: "lost" }); // no lost default configured
    expect(new Date(updated.nextFollowUpAt).toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect(updated.stage).toBe("lost");
  });
  it("terminal stage WITH a default is stamped like any other stage", async () => {
    const { svc, lead } = await setup();
    const before = Date.now();
    const updated = await svc.update("org-1", "u", lead.id, { stage: "won" });
    expectStamped(updated.nextFollowUpAt, 168, before, Date.now());
  });
  it("a non-stage update never re-stamps", async () => {
    const { svc, lead } = await setup();
    const updated = await svc.update("org-1", "u", lead.id, { notes: "কথা হয়েছে" });
    expect(updated.nextFollowUpAt).toBeNull();
  });
  it("an explicit null in the update still clears (the user's own choice beats defaults)", async () => {
    const { svc, lead } = await setup();
    await svc.update("org-1", "u", lead.id, { stage: "contacted" }); // stamped +72h
    const cleared = await svc.update("org-1", "u", lead.id, { stage: "qualified", nextFollowUpAt: null });
    expect(cleared.nextFollowUpAt).toBeNull();
  });
});

describe("CX10 CSV importer path", () => {
  it("explicit CSV dates win over defaults (the importer passes them through create); dateless rows follow the create rule", async () => {
    const prisma = fakePrisma();
    const svc = new LeadsService(prisma as any);
    await svc.updateFollowUpSetting("org-1", { new: 24 });
    const csv = [
      "name,phone,next_follow_up_at",
      "Dated Row,01711111111,2026-12-25T00:00:00.000Z",
      "Dateless Row,01712222222,",
    ].join("\n");
    const before = Date.now();
    const res = await svc.importLeadsCsv("org-1", "u", { csvText: csv });
    expect(res.successRows).toBe(2);
    const dated = prisma.lead.rows.find((l: any) => l.name === "Dated Row");
    const dateless = prisma.lead.rows.find((l: any) => l.name === "Dateless Row");
    expect(new Date(dated.nextFollowUpAt).toISOString()).toBe("2026-12-25T00:00:00.000Z");
    expectStamped(dateless.nextFollowUpAt, 24, before, Date.now());
  });
});
