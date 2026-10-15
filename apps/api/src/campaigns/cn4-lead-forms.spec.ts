import { CampaignsService } from "./campaigns.service";
import { encryptJson } from "../integrations/crypto";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

/**
 * Campaign Builder Next CN4: Lead Ads complete — the form
 * shape validation (privacy URL + questions are hard
 * requirements), form→CRM mapping validation against live
 * Custom Field defs, create-on-Meta (created ONLY with
 * Meta's returned id; a refusal is recorded verbatim and
 * rethrown), the edit-forks-a-created-form rule, ad-set
 * attachment (Page match), validatePlan gates, the publish
 * wiring (form created first, destination ON_AD, creative
 * carries lead_gen_form_id), and the readiness rows.
 *
 * Spike basis: Meta's current Lead Ads guide documents
 * POST /{PAGE_ID}/leadgen_forms (Page token; questions,
 * privacy_policy, thank_you_page, is_optimized_for_quality
 * for higher intent) — see docs/campaign-builder-nb2-acceptance.md.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if (k === "adSet") return matches(row.__adSet ?? {}, v);
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
    findUnique: async ({ where }: any = {}) => rows.find((r) => r.id === where.id) ?? null,
    findMany: async ({ where, take }: any = {}) => { const f = rows.filter((r) => matches(r, where ?? {})); return take ? f.slice(0, take) : f; },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    updateMany: async ({ where, data }: any) => { let n = 0; for (const r of rows) if (matches(r, where)) { Object.assign(r, data); n++; } return { count: n }; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}
function setup(withIntegration = false) {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "dailyAdMetric", "catalogRecord", "productSet", "audienceRecord", "conversionApiSetting", "conversionEventLog", "leadForm", "customFieldDef"]) tables[n] = makeTable(n);
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", sourceType: "api", externalId: "act_777", name: "Main", currency: "BDT", platformStatusBucket: "active", integrationId: withIntegration ? "int-1" : null });
  if (withIntegration) {
    tables.integration.rows.push({ id: "int-1", organizationId: "org", provider: "meta", status: "CONNECTED", credential: { encryptedData: encryptJson({ accessToken: "tok-123" }) } });
  }
  const svc = new CampaignsService(tables as any, { log: async () => undefined } as any, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc };
}
function metaFetch(opts: { failForms?: boolean } = {}) {
  const calls: { url: string; params: URLSearchParams }[] = [];
  const fetchFn = async (url: string, init: any) => {
    calls.push({ url, params: new URLSearchParams(String(init?.body ?? "")) });
    if (url.includes("/leadgen_forms")) {
      if (opts.failForms) return { ok: false, status: 400, json: async () => ({ error: { message: "Lead Ads terms not accepted for this Page" } }) };
      return { ok: true, status: 200, json: async () => ({ id: "form-meta-1" }) };
    }
    if (url.includes("/campaigns")) return { ok: true, status: 200, json: async () => ({ id: "camp-100" }) };
    if (url.includes("/adsets")) return { ok: true, status: 200, json: async () => ({ id: "adset-100" }) };
    if (url.includes("/ads") && !url.includes("/adsets")) return { ok: true, status: 200, json: async () => ({ id: "ad-100" }) };
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
  return { fetchFn, calls };
}
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

const FORM_DTO = {
  name: "Eid Lead Form", pageId: "pg",
  questions: [
    { type: "FULL_NAME", key: "full_name" },
    { type: "PHONE", key: "phone_number" },
    { type: "CUSTOM", key: "city_q", label: "আপনার জেলা?", options: [{ key: "o1", value: "ঢাকা" }, { key: "o2", value: "খুলনা" }] },
  ],
  privacyPolicyUrl: "https://shop.example/privacy",
  thankYouTitle: "ধন্যবাদ!", higherIntent: true,
};

describe("CN4 lead form shape validation", () => {
  it("privacy URL + questions are hard requirements; bad shapes are refused with reasons", async () => {
    const { svc } = setup();
    await expect(svc.createLeadForm("org", "u", { ...FORM_DTO, privacyPolicyUrl: "" })).rejects.toThrow(/Privacy Policy URL/);
    await expect(svc.createLeadForm("org", "u", { ...FORM_DTO, privacyPolicyUrl: "http://insecure.example/p" })).rejects.toThrow(/Privacy Policy URL/);
    await expect(svc.createLeadForm("org", "u", { ...FORM_DTO, questions: [] })).rejects.toThrow(/at least one question/);
    await expect(svc.createLeadForm("org", "u", { ...FORM_DTO, questions: [{ type: "CUSTOM", key: "q1" }] })).rejects.toThrow(/needs a label/);
    await expect(svc.createLeadForm("org", "u", { ...FORM_DTO, questions: [{ type: "FULL_NAME", key: "dup" }, { type: "EMAIL", key: "dup" }] })).rejects.toThrow(/Duplicate question key/);
    await expect(svc.createLeadForm("org", "u", { ...FORM_DTO, questions: [{ type: "MOON", key: "q1" }] })).rejects.toThrow(/not a Meta lead form question type/);
    const form: any = await svc.createLeadForm("org", "u", FORM_DTO);
    expect(form.status).toBe("local");
    expect(form.externalFormId).toBeNull();
    expect(form.questions[2].options).toHaveLength(2);
  });

  it("fieldMapping is validated against questions + live custom field defs", async () => {
    const { tables, svc } = setup();
    tables.customFieldDef.rows.push({ id: "cf-1", organizationId: "org", entity: "lead", key: "city", label: "City", archivedAt: null });
    tables.customFieldDef.rows.push({ id: "cf-2", organizationId: "org", entity: "lead", key: "old_field", label: "Old", archivedAt: new Date() });
    await expect(svc.createLeadForm("org", "u", { ...FORM_DTO, fieldMapping: { nope_q: "name" } })).rejects.toThrow(/not one of this form's questions/);
    await expect(svc.createLeadForm("org", "u", { ...FORM_DTO, fieldMapping: { city_q: "custom:missing" } })).rejects.toThrow(/not a live lead Custom Field/);
    await expect(svc.createLeadForm("org", "u", { ...FORM_DTO, fieldMapping: { city_q: "custom:old_field" } })).rejects.toThrow(/not a live lead Custom Field/);
    const form: any = await svc.createLeadForm("org", "u", { ...FORM_DTO, fieldMapping: { full_name: "name", phone_number: "phone", city_q: "custom:city" } });
    expect(form.fieldMapping).toEqual({ full_name: "name", phone_number: "phone", city_q: "custom:city" });
  });
});

describe("CN4 create on Meta + edit fork", () => {
  it("created ONLY with Meta's id; editing a created form forks it back to a local draft", async () => {
    const { svc } = setup(true);
    const { fetchFn, calls } = metaFetch();
    global.fetch = fetchFn as any;
    const form: any = await svc.createLeadForm("org", "u", FORM_DTO);
    const created: any = await svc.createLeadFormOnMetaAction("org", "u", form.id, "acc-1");
    expect(created.status).toBe("created");
    expect(created.externalFormId).toBe("form-meta-1");
    const call = calls.find((c) => c.url.includes("/leadgen_forms"))!;
    expect(call.url).toContain("/pg/leadgen_forms");
    expect(JSON.parse(call.params.get("privacy_policy")!)).toEqual({ url: "https://shop.example/privacy" });
    expect(call.params.get("is_optimized_for_quality")).toBe("true");
    const qs = JSON.parse(call.params.get("questions")!);
    expect(qs.map((q: any) => q.type)).toEqual(["FULL_NAME", "PHONE", "CUSTOM"]);
    expect(qs[2].label).toContain("জেলা");

    const again: any = await svc.createLeadFormOnMetaAction("org", "u", form.id, "acc-1");
    expect(again.alreadyCreated).toBe(true);
    expect(calls.filter((c) => c.url.includes("/leadgen_forms"))).toHaveLength(1);

    const edited: any = await svc.updateLeadForm("org", form.id, "u", { thankYouTitle: "নতুন ধন্যবাদ" });
    expect(edited.forkedFromMeta).toBe(true);
    expect(edited.status).toBe("local");
    expect(edited.externalFormId).toBeNull();
  });

  it("a Meta refusal is recorded verbatim on the row and rethrown — never a fake created", async () => {
    const { tables, svc } = setup(true);
    const { fetchFn } = metaFetch({ failForms: true });
    global.fetch = fetchFn as any;
    const form: any = await svc.createLeadForm("org", "u", FORM_DTO);
    await expect(svc.createLeadFormOnMetaAction("org", "u", form.id, "acc-1")).rejects.toThrow(/did NOT succeed: Lead Ads terms not accepted/);
    const row = tables.leadForm.rows.find((r: any) => r.id === form.id);
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/Lead Ads terms not accepted/);
    expect(row.externalFormId ?? null).toBeNull();
  });
});

describe("CN4 attachment + validatePlan + publish", () => {
  async function leadPlan(svc: CampaignsService, formId: string | undefined, adDto: any = {}) {
    const plan: any = await svc.createPlan("org", "creator", { name: "Leads", objective: "OUTCOME_LEADS", adAccountId: "acc-1" });
    const adSet: any = await svc.addAdSet("org", plan.id, { name: "L1", dailyBudget: "300", optimizationGoal: "LEAD_GENERATION", pageId: "pg", countries: ["BD"], ...(formId ? { leadFormId: formId } : {}) });
    await svc.addAd("org", plan.id, adSet.id, { name: "LA", primaryText: "ফর্মটি পূরণ করুন", linkUrl: "https://shop.example/leads", callToAction: "SIGN_UP", ...adDto });
    return { plan, adSet };
  }

  it("a form of another Page is refused at attach time", async () => {
    const { svc } = setup();
    const form: any = await svc.createLeadForm("org", "u", { ...FORM_DTO, pageId: "other-page" });
    const plan: any = await svc.createPlan("org", "u", { name: "Leads", objective: "OUTCOME_LEADS", adAccountId: "acc-1" });
    await expect(svc.addAdSet("org", plan.id, { name: "L1", dailyBudget: "300", optimizationGoal: "LEAD_GENERATION", pageId: "pg", countries: ["BD"], leadFormId: form.id })).rejects.toThrow(/belongs to Page other-page/);
    await expect(svc.addAdSet("org", plan.id, { name: "L1", dailyBudget: "300", optimizationGoal: "LEAD_GENERATION", pageId: "pg", countries: ["BD"], leadFormId: "missing" })).rejects.toThrow(/Lead form not found/);
  });

  it("validatePlan: a bad stored form (no privacy URL / no questions) and a wrong CTA are errors", async () => {
    const { tables, svc } = setup();
    tables.leadForm.rows.push({ id: "bad-form", organizationId: "org", pageId: "pg", name: "Bad", questions: [], privacyPolicyUrl: "", status: "local", fieldMapping: null });
    const { plan } = await leadPlan(svc, "bad-form", { callToAction: "SHOP_NOW" });
    const full: any = await svc.getPlan("org", plan.id);
    const v = (svc as any).validatePlan(full);
    expect(v.valid).toBe(false);
    const joined = v.errors.join(" ");
    expect(joined).toMatch(/Privacy Policy URL/);
    expect(joined).toMatch(/no questions/);
    expect(joined).toMatch(/call-to-action must be one of/);
  });

  it("publish creates the form first, then the ON_AD ad set + the form creative", async () => {
    const { tables, svc } = setup(true);
    const { fetchFn, calls } = metaFetch();
    global.fetch = fetchFn as any;
    const form: any = await svc.createLeadForm("org", "creator", FORM_DTO);
    const { plan } = await leadPlan(svc, form.id);
    await svc.submitForApproval("org", "creator", plan.id);
    await svc.approve("org", "owner", plan.id);
    await svc.publish("org", "owner", plan.id);

    const order = calls.map((c) => c.url);
    const formIdx = order.findIndex((u) => u.includes("/leadgen_forms"));
    const adsetIdx = order.findIndex((u) => u.includes("/adsets"));
    const adIdx = order.findIndex((u) => u.includes("/ads") && !u.includes("/adsets"));
    expect(formIdx).toBeGreaterThanOrEqual(0);
    expect(formIdx).toBeLessThan(adsetIdx);
    expect(adsetIdx).toBeLessThan(adIdx);

    const adsetCall = calls[adsetIdx];
    expect(adsetCall.params.get("destination_type")).toBe("ON_AD");
    expect(JSON.parse(adsetCall.params.get("promoted_object")!)).toEqual({ page_id: "pg" });
    const creative = JSON.parse(calls[adIdx].params.get("creative")!);
    expect(creative.link_data.link).toBe("https://fb.me/");
    expect(creative.link_data.call_to_action).toEqual({ type: "SIGN_UP", value: { lead_gen_form_id: "form-meta-1" } });
    const row = tables.leadForm.rows.find((r: any) => r.id === form.id);
    expect(row.status).toBe("created");
    expect(row.externalFormId).toBe("form-meta-1");
    const logs = tables.campaignPublishLog.rows.filter((r: any) => r.step === "lead_form");
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe("success");
  });

  it("publish fails honestly when Meta refuses the form — plan publish_failed, nothing faked", async () => {
    const { tables, svc } = setup(true);
    const { fetchFn } = metaFetch({ failForms: true });
    global.fetch = fetchFn as any;
    const form: any = await svc.createLeadForm("org", "creator", FORM_DTO);
    const { plan } = await leadPlan(svc, form.id);
    await svc.submitForApproval("org", "creator", plan.id);
    await svc.approve("org", "owner", plan.id);
    await expect(svc.publish("org", "owner", plan.id)).rejects.toThrow(/did NOT complete/);
    const row = tables.campaignPlan.rows.find((r: any) => r.id === plan.id);
    expect(row.status).toBe("publish_failed");
    expect(tables.campaignAdSet.rows.every((r: any) => !r.externalAdSetId)).toBe(true);
  });

  it("readiness: local form warns it will be created at publish; no form warns too; created form is ok", async () => {
    const { tables, svc } = setup();
    global.fetch = (async () => ({ ok: true, status: 200, json: async () => ({}) })) as any;
    const form: any = await svc.createLeadForm("org", "u", FORM_DTO);
    const { plan } = await leadPlan(svc, form.id);
    const r1: any = await svc.readiness("org", plan.id);
    const warn = r1.checks.find((c: any) => c.key === "lead_form");
    expect(warn.level).toBe("warn");
    expect(warn.detail).toMatch(/এখনো Meta-তে তৈরি হয়নি/);

    tables.leadForm.rows.find((r: any) => r.id === form.id).status = "created";
    tables.leadForm.rows.find((r: any) => r.id === form.id).externalFormId = "form-meta-1";
    const r2: any = await svc.readiness("org", plan.id);
    expect(r2.checks.find((c: any) => c.key === "lead_form").level).toBe("ok");

    const bare = await leadPlan(svc, undefined);
    const r3: any = await svc.readiness("org", bare.plan.id);
    expect(r3.checks.find((c: any) => c.key === "lead_form").level).toBe("warn");
  });
});
