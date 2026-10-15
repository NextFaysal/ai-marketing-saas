import { InboxService } from "./inbox.service";

/**
 * Campaign Builder Next CN4: the Inbox leadgen ingest
 * applies OUR LeadForm's fieldMapping when a lead arrives
 * for a form we modelled — mapped standard targets win
 * over the default field names, custom:<key> targets land
 * in Lead.customFields while the def is live, an archived
 * def's mapping simply does not apply (the answer stays in
 * the activity text), and forms we did not model keep the
 * exact pre-CN4 behaviour.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
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
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
  };
}
function setup() {
  const tables: any = {};
  for (const n of ["lead", "leadActivity", "leadForm", "customFieldDef"]) tables[n] = makeTable(n);
  const svc = new InboxService(tables as any, { log: async () => undefined } as any, {} as any);
  return { tables, svc };
}
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

function stubGraph(fieldData: { name: string; values: string[] }[], formId = "form-meta-1") {
  global.fetch = (async () => ({
    ok: true, status: 200,
    json: async () => ({ field_data: fieldData, form_id: formId, ad_id: "ad-9", campaign_id: "camp-9" }),
  })) as any;
}

describe("CN4 leadgen field mapping", () => {
  it("mapped answers land on the lead: name override, notes target, custom field", async () => {
    const { tables, svc } = setup();
    tables.leadForm.rows.push({
      id: "lf-1", organizationId: "org", externalFormId: "form-meta-1", status: "created",
      fieldMapping: { contact_name: "name", city_q: "custom:city", note_q: "notes" },
    });
    tables.customFieldDef.rows.push({ id: "cf-1", organizationId: "org", entity: "lead", key: "city", archivedAt: null });
    stubGraph([
      { name: "full_name", values: ["Default Name"] },
      { name: "contact_name", values: ["Mapped Name"] },
      { name: "email", values: ["a@b.co"] },
      { name: "phone_number", values: ["+8801700000000"] },
      { name: "city_q", values: ["খুলনা"] },
      { name: "note_q", values: ["সন্ধ্যায় কল করুন"] },
    ]);
    const created = await (svc as any).ingestLeadgen("org", "tok", { leadgenId: "lg-1", formId: "form-meta-1" });
    expect(created).toBe(true);
    const lead = tables.lead.rows[0];
    expect(lead.name).toBe("Mapped Name");
    expect(lead.email).toBe("a@b.co");
    expect(lead.phone).toBe("+8801700000000");
    expect(lead.customFields).toEqual({ city: "খুলনা" });
    expect(lead.notes).toContain("সন্ধ্যায় কল করুন");
    // The full answers still land in the activity, mapped or not.
    expect(tables.leadActivity.rows[0].content).toContain("city_q: খুলনা");
  });

  it("an archived def's mapping does not apply — the answer stays in the activity only", async () => {
    const { tables, svc } = setup();
    tables.leadForm.rows.push({
      id: "lf-1", organizationId: "org", externalFormId: "form-meta-1", status: "created",
      fieldMapping: { city_q: "custom:city" },
    });
    tables.customFieldDef.rows.push({ id: "cf-1", organizationId: "org", entity: "lead", key: "city", archivedAt: new Date() });
    stubGraph([
      { name: "full_name", values: ["Karim"] },
      { name: "city_q", values: ["ঢাকা"] },
    ]);
    await (svc as any).ingestLeadgen("org", "tok", { leadgenId: "lg-2", formId: "form-meta-1" });
    const lead = tables.lead.rows[0];
    expect(lead.name).toBe("Karim");
    expect(lead.customFields).toBeUndefined();
    expect(tables.leadActivity.rows[0].content).toContain("city_q: ঢাকা");
  });

  it("a form we did not model keeps the exact legacy behaviour", async () => {
    const { tables, svc } = setup();
    stubGraph([
      { name: "full_name", values: ["Legacy Lead"] },
      { name: "email", values: ["l@b.co"] },
      { name: "city_q", values: ["ঢাকা"] },
    ], "someone-elses-form");
    await (svc as any).ingestLeadgen("org", "tok", { leadgenId: "lg-3", formId: "someone-elses-form" });
    const lead = tables.lead.rows[0];
    expect(lead.name).toBe("Legacy Lead");
    expect(lead.email).toBe("l@b.co");
    expect(lead.customFields).toBeUndefined();
    expect(lead.notes).toBe("Lead Ads form someone-elses-form");
  });
});
