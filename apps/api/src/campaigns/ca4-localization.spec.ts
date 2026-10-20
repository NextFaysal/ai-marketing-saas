import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * CA4 — per-ad copy localization with numbers LOCKED to the
 * source.
 *
 * Proven: no real LLM → honest unavailable (translation has
 * NO template fallback); an LLM translation that INVENTS a
 * number or DROPS the source price is refused and nothing
 * is saved; a faithful translation is stored as a
 * locale-labelled variant under textOptions.locales.<loc>
 * with the canonical fields untouched; a same-locale request
 * is refused; usage is recorded for the LLM call.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) return true;
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
  };
}

const BN_AD = {
  id: "ad-1", planId: "plan-1", adSetId: "set-1", name: "Ad One",
  primaryText: "কটন পাঞ্জাবি মাত্র ১৫০০ টাকায়", headline: "নতুন কালেকশন", description: null,
  textOptions: {
    primaryTexts: ["কটন পাঞ্জাবি মাত্র ১৫০০ টাকায়", "আরামদায়ক কটন পাঞ্জাবি"],
    headlines: ["নতুন কালেকশন"],
    descriptions: [],
  },
};

function build(llm: any, ad: any = BN_AD) {
  const tables: any = { campaignPlan: makeTable("plan"), campaignAd: makeTable("ad"), aIUsageRecord: makeTable("usage") };
  tables.campaignPlan.rows.push({ id: "plan-1", organizationId: "org-1", status: "draft", name: "P" });
  tables.campaignAd.rows.push(JSON.parse(JSON.stringify(ad)));
  const svc = new CampaignsService(tables as any, { log: async () => undefined } as any, llm);
  return { svc, tables };
}
const fakeLlm = (text: string) => ({
  isRealLlm: true, name: "fake-llm",
  complete: async () => ({ text, inputTokens: 5, outputTokens: 6, tokensEstimated: false }),
});

describe("CA4 localizeAdCopy", () => {
  it("no real LLM → honest unavailable, nothing saved (no template translation)", async () => {
    const { svc, tables } = build({ getProvider: () => new DevTemplateProvider() });
    await expect(svc.localizeAdCopy("org-1", "u1", "plan-1", "ad-1", { targetLocale: "en" }))
      .rejects.toThrow("Template দিয়ে অনুবাদ করা হয় না");
    expect(tables.campaignAd.rows[0].textOptions.locales).toBeUndefined();
  });

  it("faithful translation (Bengali digits → same value) is saved as a locale variant; canonical fields untouched", async () => {
    const llm = { getProvider: () => fakeLlm(JSON.stringify({
      primaryTexts: ["Cotton panjabi for only 1500 taka", "Comfortable cotton panjabi"],
      headlines: ["New collection"], descriptions: [],
    })) };
    const { svc, tables } = build(llm);
    const out = await svc.localizeAdCopy("org-1", "u1", "plan-1", "ad-1", { targetLocale: "en" });
    expect(out.locale).toBe("en");
    expect(out.sourceLocaleDetected).toBe("bn");
    expect(out.numbersLocked).toEqual(["1500"]);
    const saved = tables.campaignAd.rows[0];
    expect(saved.primaryText).toBe("কটন পাঞ্জাবি মাত্র ১৫০০ টাকায়"); // canonical untouched
    expect(saved.textOptions.locales.en.primaryTexts[0]).toContain("1500");
    expect(saved.textOptions.primaryTexts[0]).toContain("১৫০০"); // base options preserved
    expect(tables.aIUsageRecord.rows.some((r: any) => r.feature === "ad_copy_localization")).toBe(true);
  });

  it("translation INVENTING a number (999 discount) → refused, nothing saved", async () => {
    const llm = { getProvider: () => fakeLlm(JSON.stringify({
      primaryTexts: ["Cotton panjabi for only 999 taka", "Comfortable cotton panjabi"],
      headlines: ["New collection"], descriptions: [],
    })) };
    const { svc, tables } = build(llm);
    await expect(svc.localizeAdCopy("org-1", "u1", "plan-1", "ad-1", { targetLocale: "en" }))
      .rejects.toThrow("সংখ্যা/দাম বদলে গেছে");
    expect(tables.campaignAd.rows[0].textOptions.locales).toBeUndefined();
  });

  it("translation DROPPING the price → refused, nothing saved", async () => {
    const llm = { getProvider: () => fakeLlm(JSON.stringify({
      primaryTexts: ["Cotton panjabi at a great price", "Comfortable cotton panjabi"],
      headlines: ["New collection"], descriptions: [],
    })) };
    const { svc, tables } = build(llm);
    await expect(svc.localizeAdCopy("org-1", "u1", "plan-1", "ad-1", { targetLocale: "en" }))
      .rejects.toThrow("সংখ্যা/দাম বদলে গেছে");
    expect(tables.campaignAd.rows[0].textOptions.locales).toBeUndefined();
  });

  it("translation changing an option COUNT → refused", async () => {
    const llm = { getProvider: () => fakeLlm(JSON.stringify({
      primaryTexts: ["Only one line 1500"], headlines: ["New collection"], descriptions: [],
    })) };
    const { svc } = build(llm);
    await expect(svc.localizeAdCopy("org-1", "u1", "plan-1", "ad-1", { targetLocale: "en" }))
      .rejects.toThrow("সংখ্যা বদলে গেছে");
  });

  it("same-locale request (bn → bn) → refused from script detection", async () => {
    const { svc } = build({ getProvider: () => fakeLlm("{}") });
    await expect(svc.localizeAdCopy("org-1", "u1", "plan-1", "ad-1", { targetLocale: "bn" }))
      .rejects.toThrow("এমনিতেই বাংলায় আছে");
  });

  it("ad not in the plan → 404", async () => {
    const { svc } = build({ getProvider: () => fakeLlm("{}") });
    await expect(svc.localizeAdCopy("org-1", "u1", "plan-1", "ad-zzz", { targetLocale: "en" }))
      .rejects.toMatchObject({ code: "campaigns.adNotFoundInThisPlan" });
  });
});
