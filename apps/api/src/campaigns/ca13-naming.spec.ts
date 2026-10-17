import { CampaignsService, renderNamingTemplate } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Advanced CA13 (CB3): naming
 * conventions. The org template (BusinessProfile, set in
 * Organization Settings) renders from REAL values only;
 * empty tokens vanish with their separators; a typed name
 * is never silently overwritten (template applies at
 * create only for a blank name or an explicit opt-in);
 * the rename action is preview-then-confirm with a
 * server-side fresh-render match per item, and touches
 * LOCAL records only.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("not" in v) return row[k] !== (v as any).not;
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
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take }: any = {}) => { const f = rows.filter((r) => matches(r, where ?? {})); return take ? f.slice(0, take) : f; },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => matches(r, where ?? {})); if (row) Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => matches(r, where?.id ? { id: where.id } : where ?? {})); rows.splice(i, 1); return {}; },
  };
}
const dhakaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "businessProfile", "organization", "product", "savedAudience", "dailyAdMetric", "attributionCredit", "touchpoint"]) tables[n] = makeTable(n);
  tables.organization.rows.push({ id: "org", timezone: "Asia/Dhaka" });
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", externalId: "act_777", currency: "BDT", integrationId: "int-1" });
  const auditCalls: any[] = [];
  const audit = { log: async (e: any) => { auditCalls.push(e); } } as any;
  const svc: any = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc, auditCalls };
}

describe("CA13 renderNamingTemplate", () => {
  it("renders all tokens with their separators", () => {
    expect(renderNamingTemplate("{product} - {audience} - {date}", { product: "Panjabi", audience: "Dhaka Men", date: "2026-10-17" })).toBe("Panjabi - Dhaka Men - 2026-10-17");
    expect(renderNamingTemplate("{objective}_{platform}", { objective: "OUTCOME_SALES", platform: "Meta" })).toBe("OUTCOME_SALES_Meta");
  });
  it("an empty middle token vanishes WITH its separator — no double dash, no gap", () => {
    expect(renderNamingTemplate("{product} - {audience} - {date}", { product: "Panjabi", audience: null, date: "2026-10-17" })).toBe("Panjabi - 2026-10-17");
    expect(renderNamingTemplate("{product}_{audience}_{date}", { product: "Panjabi", audience: "", date: "2026-10-17" })).toBe("Panjabi_2026-10-17");
  });
  it("an empty first token leaves no leading separator; all-empty renders blank", () => {
    expect(renderNamingTemplate("{audience} - {date}", { audience: null, date: "2026-10-17" })).toBe("2026-10-17");
    expect(renderNamingTemplate("{product} - {audience}", { product: null, audience: null })).toBe("");
    expect(renderNamingTemplate("{product} - ", { product: "Panjabi" })).toBe("Panjabi");
  });
  it("unknown tokens render empty (validation refuses them at save time); literal text survives", () => {
    expect(renderNamingTemplate("Sale {season} {product}", { product: "Panjabi" })).toBe("Sale Panjabi");
  });
});

describe("CA13 template setting", () => {
  it("stores on BusinessProfile (creating the row when absent), validates tokens, clears on null", async () => {
    const { tables, svc } = setup();
    const out = await svc.setNamingTemplate("org", "u1", { template: "{product} - {date}" });
    expect(out.template).toBe("{product} - {date}");
    expect(out.sample).toContain("Panjabi");
    expect(tables.businessProfile.rows).toHaveLength(1);
    expect(tables.businessProfile.rows[0].campaignNamingTemplate).toBe("{product} - {date}");
    await expect(svc.setNamingTemplate("org", "u1", { template: "{product} {bogus}" })).rejects.toThrow(/অজানা token/);
    await expect(svc.setNamingTemplate("org", "u1", { template: "একটাই নাম সবার জন্য" })).rejects.toThrow(/token/);
    const cleared = await svc.setNamingTemplate("org", "u1", { template: null });
    expect(cleared.template).toBeNull();
    expect(tables.businessProfile.rows[0].campaignNamingTemplate).toBeNull();
  });
});

describe("CA13 create-time application", () => {
  it("a blank plan name is rendered from the template; a typed name is NEVER overwritten without opt-in", async () => {
    const { tables, svc } = setup();
    await svc.setNamingTemplate("org", "u1", { template: "{objective} - {platform} - {date}" });
    const blank = await svc.createPlan("org", "u1", { name: "", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    expect(blank.name).toBe(`OUTCOME_SALES - Meta - ${dhakaToday()}`);
    const typed = await svc.createPlan("org", "u1", { name: "আমার নিজের নাম", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    expect(typed.name).toBe("আমার নিজের নাম");
    const opted = await svc.createPlan("org", "u1", { name: "যেকোনো", objective: "OUTCOME_TRAFFIC", adAccountId: "acc-1", useNamingTemplate: true });
    expect(opted.name).toBe(`OUTCOME_TRAFFIC - Meta - ${dhakaToday()}`);
    expect(tables.campaignPlan.rows).toHaveLength(3);
  });

  it("without a template, create behaviour is byte-identical to before (blank stays blank, typed stays typed)", async () => {
    const { svc } = setup();
    const blank = await svc.createPlan("org", "u1", { name: "", objective: "OUTCOME_SALES", adAccountId: "acc-1", useNamingTemplate: true });
    expect(blank.name).toBe("");
    const typed = await svc.createPlan("org", "u1", { name: "নাম", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
    expect(typed.name).toBe("নাম");
  });

  it("an ad's {product} token resolves from its linked product at create (opt-in)", async () => {
    const { tables, svc } = setup();
    await svc.setNamingTemplate("org", "u1", { template: "{product} Ad - {date}" });
    tables.campaignPlan.rows.push({ id: "plan-1", organizationId: "org", adAccountId: "acc-1", name: "P", objective: "OUTCOME_SALES", status: "draft", createdById: "u1" });
    tables.campaignAdSet.rows.push({ id: "set-1", planId: "plan-1", name: "S", optimizationGoal: "OFFSITE_CONVERSIONS", targeting: { countries: ["BD"] } });
    tables.product.rows.push({ id: "prod-1", organizationId: "org", name: "কুর্তি X" });
    const ad = await svc.addAd("org", "plan-1", "set-1", { name: "", primaryText: "t", linkUrl: "https://x.com", productId: "prod-1", useNamingTemplate: true });
    expect(ad.name).toBe(`কুর্তি X Ad - ${dhakaToday()}`);
    const typed = await svc.addAd("org", "plan-1", "set-1", { name: "হাতে লেখা", primaryText: "t", linkUrl: "https://x.com", productId: "prod-1" });
    expect(typed.name).toBe("হাতে লেখা");
  });
});

describe("CA13 rename preview + apply", () => {
  function seedTree(tables: any) {
    tables.campaignPlan.rows.push({ id: "plan-1", organizationId: "org", adAccountId: "acc-1", name: "পুরনো Plan", objective: "OUTCOME_SALES", status: "draft", createdById: "u1" });
    tables.campaignAdSet.rows.push({ id: "set-1", planId: "plan-1", name: "পুরনো Set", optimizationGoal: "OFFSITE_CONVERSIONS", targeting: { countries: ["BD"], savedAudienceId: "saved-1" } });
    tables.campaignAd.rows.push({ id: "ad-1", adSetId: "set-1", name: "পুরনো Ad", primaryText: "t", linkUrl: "https://x.com", productId: "prod-1" });
    tables.savedAudience.rows.push({ id: "saved-1", organizationId: "org", name: "Dhaka Men 25-44" });
    tables.product.rows.push({ id: "prod-1", organizationId: "org", name: "Panjabi" });
  }

  it("preview renders plan/set/ad names from each level's real values and renames nothing", async () => {
    const { tables, svc } = setup();
    await svc.setNamingTemplate("org", "u1", { template: "{product} - {audience} - {objective}" });
    seedTree(tables);
    const out = await svc.previewNamingApply("org", "plan-1");
    const byLevel = new Map<string, any>(out.items.map((i: any) => [i.level, i]));
    expect(byLevel.get("plan").newName).toBe("OUTCOME_SALES");
    expect(byLevel.get("ad_set").newName).toBe("Dhaka Men 25-44 - OUTCOME_SALES");
    expect(byLevel.get("ad").newName).toBe("Panjabi - Dhaka Men 25-44 - OUTCOME_SALES");
    expect(byLevel.get("ad").changed).toBe(true);
    expect(tables.campaignPlan.rows[0].name).toBe("পুরনো Plan");
  });

  it("apply renames exactly the confirmed items and audits the diff; a tampered name is refused per item", async () => {
    const { tables, svc, auditCalls } = setup();
    await svc.setNamingTemplate("org", "u1", { template: "{product} - {audience} - {objective}" });
    seedTree(tables);
    const preview = await svc.previewNamingApply("org", "plan-1");
    const items = preview.items.filter((i: any) => i.changed).map((i: any) => ({ level: i.level, id: i.id, newName: i.newName }));
    items.push({ level: "ad", id: "ad-1", newName: "হাতে বদলানো নাম" }); // duplicate ad item, tampered — the fresh one above must win first; this one goes stale? both target ad-1: first applies, second re-renders same fresh name but sends a different one -> stale_preview
    const out = await svc.applyNaming("org", "u1", "plan-1", { items });
    expect(out.appliedCount).toBe(3);
    expect(out.failedCount).toBe(1);
    expect(out.results.find((r: any) => !r.ok).error).toBe("stale_preview");
    expect(tables.campaignPlan.rows[0].name).toBe("OUTCOME_SALES");
    expect(tables.campaignAdSet.rows[0].name).toBe("Dhaka Men 25-44 - OUTCOME_SALES");
    expect(tables.campaignAd.rows[0].name).toBe("Panjabi - Dhaka Men 25-44 - OUTCOME_SALES");
    expect(out.note).toContain("Meta-তে থাকা");
    const auditRow = auditCalls.find((a: any) => a.action === "campaign.naming_applied");
    expect(auditRow.metadata.diffs).toHaveLength(3);
  });

  it("preview refuses honestly when no template is set", async () => {
    const { tables, svc } = setup();
    seedTree(tables);
    await expect(svc.previewNamingApply("org", "plan-1")).rejects.toThrow(/Naming Template/);
  });
});
