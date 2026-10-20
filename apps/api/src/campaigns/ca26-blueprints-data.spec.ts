import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CampaignsService, BLUEPRINTS } from "./campaigns.service";
import { AdminService } from "../admin/admin.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Advanced CA26 (CB6): blueprints as
 * data. VERIFY result: definitions WERE five code
 * constants (BLUEPRINTS in campaigns.service.ts). Now:
 * (1) migration 20261030900000 seeds CampaignBlueprint
 * platform rows whose adSet/ad JSON is byte-identical
 * to those constants — this spec re-derives the JSON
 * from the constants and asserts it appears verbatim
 * in the migration file, so seed and source can never
 * silently drift; (2) instantiation reads the DB rows
 * and produces plans/ad sets/ads IDENTICAL to the old
 * const path for all five keys (same inputs, both
 * sources, deep-compared); (3) orgs can clone a
 * platform blueprint into an editable copy (the copy
 * wins at instantiate), platform rows refuse org
 * edits/deletes; (4) platform-admin CRUD works on
 * platform rows only, with version bumps and the key
 * treated as identity.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("OR" in v) return (v as any).OR.some((w: any) => matches(row, w));
      return true;
    }
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return {}; },
  };
}
const auditStub = { log: async () => undefined } as any;
const devLlm = { getProvider: () => new DevTemplateProvider() } as any;

function basePrisma(withBlueprintTable: boolean) {
  const tables: any = {
    campaignPlan: makeTable("plan"), campaignAdSet: makeTable("adset"), campaignAd: makeTable("ad"),
    campaignPublishLog: makeTable("log"), adAccount: makeTable("account"), campaignPlanVersion: makeTable("version"),
    product: makeTable("product"),
  };
  tables.businessProfile = { findUnique: async () => ({ organizationId: "org-1", industry: "fashion" }) };
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org-1", platform: "meta", externalId: "act_777", name: "Main", currency: "BDT" });
  if (withBlueprintTable) {
    tables.campaignBlueprint = makeTable("bp");
    for (const bp of BLUEPRINTS as readonly any[]) {
      tables.campaignBlueprint.rows.push({
        id: `bp-${bp.key}`, key: bp.key, name: bp.name, objective: bp.objective, advantagePlus: !!bp.advantagePlus,
        description: bp.description, adSet: JSON.parse(JSON.stringify(bp.adSet)), ad: JSON.parse(JSON.stringify(bp.ad)),
        organizationId: null, version: 1, category: null, tags: [],
      });
    }
  }
  return tables;
}

function planEssence(full: any) {
  const s = full.adSets[0];
  const a = s.ads[0];
  return {
    plan: { name: full.name, objective: full.objective, advantagePlus: !!full.advantagePlus },
    adSet: { name: s.name, dailyBudgetMinor: String(s.dailyBudgetMinor), optimizationGoal: s.optimizationGoal, countries: s.targeting.countries, ageMin: s.targeting.ageMin, ageMax: s.targeting.ageMax },
    ad: { name: a.name, primaryText: a.primaryText, headline: a.headline, linkUrl: a.linkUrl, callToAction: a.callToAction },
  };
}

describe("CA26 migration seed is byte-identical to the code seed source", () => {
  const sql = readFileSync(join(__dirname, "../../../../packages/db/prisma/migrations/20261030900000_ca26_blueprints_data/migration.sql"), "utf8");
  const esc = (s: string) => s.replace(/'/g, "''");
  it("contains CREATE TABLE and all five keys", () => {
    expect(sql).toContain('CREATE TABLE "CampaignBlueprint"');
    for (const bp of BLUEPRINTS as readonly any[]) expect(sql).toContain(`'${bp.key}'`);
  });
  it("every adSet/ad JSON appears verbatim (escaped) in the seed INSERTs", () => {
    for (const bp of BLUEPRINTS as readonly any[]) {
      expect(sql).toContain(esc(JSON.stringify(bp.adSet)));
      expect(sql).toContain(esc(JSON.stringify(bp.ad)));
      expect(sql).toContain(esc(bp.description));
    }
  });
});

describe("CA26 instantiation: DB rows produce exactly the old const-path plans", () => {
  it("all five blueprints instantiate identically from DB rows and from the const fallback", async () => {
    for (const bp of BLUEPRINTS as readonly any[]) {
      const fromDb: any = new CampaignsService(basePrisma(true) as any, auditStub, devLlm);
      const fromConst: any = new CampaignsService(basePrisma(false) as any, auditStub, devLlm);
      const a = await fromDb.instantiateBlueprint("org-1", "u", { blueprintKey: bp.key, adAccountId: "acc-1" });
      const b = await fromConst.instantiateBlueprint("org-1", "u", { blueprintKey: bp.key, adAccountId: "acc-1" });
      expect(planEssence(a)).toEqual(planEssence(b));
    }
  });

  it("listBlueprints returns platform rows from the DB with scope metadata", async () => {
    const svc: any = new CampaignsService(basePrisma(true) as any, auditStub, devLlm);
    const list = await svc.listBlueprints("org-1");
    expect(list).toHaveLength(5);
    expect(list.every((b: any) => b.scope === "platform" && b.editable === false)).toBe(true);
  });

  it("an unknown key still refuses with the old error", async () => {
    const svc: any = new CampaignsService(basePrisma(true) as any, auditStub, devLlm);
    await expect(svc.instantiateBlueprint("org-1", "u", { blueprintKey: "nope", adAccountId: "acc-1" })).rejects.toMatchObject({ code: "campaigns.unknownBlueprint" });
  });
});

describe("CA26 org clones", () => {
  it("clone creates an org copy; the copy wins at instantiate; platform rows refuse org edit/delete", async () => {
    const prisma = basePrisma(true);
    const svc: any = new CampaignsService(prisma as any, auditStub, devLlm);
    const copy = await svc.cloneBlueprint("org-1", "u", "cod_sales");
    expect(copy.scope).toBe("org");
    expect(copy.editable).toBe(true);
    expect(copy.name).toContain("নিজের কপি");
    // idempotent
    const again = await svc.cloneBlueprint("org-1", "u", "cod_sales");
    expect(again.id).toBe(copy.id);
    expect(prisma.campaignBlueprint.rows.filter((r: any) => r.organizationId === "org-1")).toHaveLength(1);
    // edit the copy's budget -> instantiate reflects the copy, not the platform row
    await svc.updateOrgBlueprint("org-1", "u", copy.id, { adSet: { ...copy.adSet, dailyBudget: "777" } });
    const full = await svc.instantiateBlueprint("org-1", "u", { blueprintKey: "cod_sales", adAccountId: "acc-1" });
    expect(String(full.adSets[0].dailyBudgetMinor)).toBe("77700");
    // platform row is untouchable by orgs
    const platformRow = prisma.campaignBlueprint.rows.find((r: any) => r.key === "cod_sales" && r.organizationId === null);
    await expect(svc.updateOrgBlueprint("org-1", "u", platformRow.id, { name: "Hacked" })).rejects.toThrow(/Platform Blueprint/);
    await expect(svc.deleteOrgBlueprint("org-1", "u", platformRow.id)).rejects.toThrow(/Platform Blueprint/);
    // another org cannot touch org-1's copy either
    await expect(svc.updateOrgBlueprint("org-2", "u", copy.id, { name: "Hacked" })).rejects.toThrow(/Platform Blueprint/);
    // delete own copy works; instantiate falls back to the platform row
    await svc.deleteOrgBlueprint("org-1", "u", copy.id);
    const full2 = await svc.instantiateBlueprint("org-1", "u", { blueprintKey: "cod_sales", adAccountId: "acc-1" });
    expect(String(full2.adSets[0].dailyBudgetMinor)).toBe("50000");
  });
});

describe("CA26 platform-admin CRUD", () => {
  function adminSvc() {
    const prisma: any = { campaignBlueprint: makeTable("bp") };
    prisma.campaignBlueprint.rows.push({ id: "bp-org", key: "cod_sales", name: "Org copy", objective: "OUTCOME_SALES", advantagePlus: false, description: "", adSet: {}, ad: {}, organizationId: "org-1", version: 1, category: null, tags: [] });
    const admin: any = new AdminService(prisma, auditStub);
    return { admin, prisma };
  }
  const actor = { id: "admin-1" };

  it("create refuses a duplicate platform key; update bumps version and refuses key changes; org rows are invisible", async () => {
    const { admin, prisma } = adminSvc();
    const created = await admin.createPlatformBlueprint(actor, { key: "new_bp", name: "New", objective: "OUTCOME_SALES", adSet: { name: "S" }, ad: { name: "A" } });
    expect(created.organizationId).toBeNull();
    await expect(admin.createPlatformBlueprint(actor, { key: "new_bp", name: "Dupe" })).rejects.toThrow(/ইতিমধ্যে আছে/);
    const updated = await admin.updatePlatformBlueprint(actor, created.id, { name: "Renamed" });
    expect(updated.name).toBe("Renamed");
    expect(updated.version).toBe(2);
    await expect(admin.updatePlatformBlueprint(actor, created.id, { key: "other" })).rejects.toThrow(/key বদলানো যায় না/);
    // the org-owned row is NOT a platform blueprint for admin update/delete
    await expect(admin.updatePlatformBlueprint(actor, "bp-org", { name: "X" })).rejects.toMatchObject({ code: "admin.platformBlueprintNotFound" });
    await expect(admin.deletePlatformBlueprint(actor, "bp-org")).rejects.toMatchObject({ code: "admin.platformBlueprintNotFound" });
    const list = await admin.listPlatformBlueprints();
    expect(list.blueprints.map((b: any) => b.key)).toEqual(["new_bp"]);
    await admin.deletePlatformBlueprint(actor, created.id);
    expect(prisma.campaignBlueprint.rows.filter((r: any) => r.organizationId === null)).toHaveLength(0);
  });
});
