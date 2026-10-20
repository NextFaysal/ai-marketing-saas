import { BadRequestException } from "@nestjs/common";
import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * RB4/RM8 item 6 — campaign variant image URL choice.
 *
 * The CN5 harness pattern (fake tables, 3-arg service) extended
 * with a scripted PublicMediaService at the new 6th constructor
 * slot. Pins: CDN preferred when the helper resolves; the CN5
 * token URL + API_PUBLIC_URL refusal preserved exactly when it
 * does not; the public token remains the gate (never resolved
 * for tokenless assets).
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
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
    findMany: async () => [],
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) Object.assign(row, data);
      return row;
    },
  };
}

function setup(publicMedia?: any) {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "creativeAsset", "mediaAsset"]) tables[n] = makeTable(n);
  tables.campaignPlan.rows.push({ id: "plan-1", organizationId: "org", status: "draft", name: "Plan" });
  tables.campaignAdSet.rows.push({ id: "set-1", planId: "plan-1" });
  const src: any = {
    id: "ad-1", adSetId: "set-1", name: "Source Ad", primaryText: "text", headline: "h",
    description: null, linkUrl: "https://shop.example.test/p", callToAction: "SHOP_NOW",
    productId: null, createdByAi: false, textOptions: undefined, creativeEnhancements: undefined,
  };
  src.__adSet = { id: "set-1", planId: "plan-1" };
  tables.campaignAd.rows.push(src);
  const audit: any = { log: async () => undefined };
  const llm: any = { getProvider: () => new DevTemplateProvider() };
  const svc = publicMedia
    ? new CampaignsService(tables as any, audit, llm, undefined, undefined, publicMedia)
    : new CampaignsService(tables as any, audit, llm);
  return { tables, svc };
}

function seedAsset(tables: any, over: any = {}) {
  tables.mediaAsset.rows.push({
    id: "ma-1", organizationId: "org", kind: "image", name: "Hero",
    storageKey: "org/social/hero.jpg", contentType: "image/jpeg", sizeBytes: 2048,
    publicToken: "tok-xyz", createdById: "user-1", ...over,
  });
}

const CDN_URL = "https://media.qosprey.com/org/social/hero.jpg";
afterEach(() => { delete process.env.API_PUBLIC_URL; });

describe("RB4 createAdVariant — MediaAsset branch URL choice", () => {
  it("prefers the CDN URL from the helper (API_PUBLIC_URL not needed)", async () => {
    const seen: any[] = [];
    const publicMedia = { resolvePublicMediaUrl: async (asset: any, surface: string) => { seen.push({ asset, surface }); return CDN_URL; } };
    const { tables, svc } = setup(publicMedia);
    seedAsset(tables);
    const variant = await svc.createAdVariant("org", "plan-1", "ad-1", "user-1", { mediaAssetId: "ma-1" });
    expect(variant.imageUrl).toBe(CDN_URL);
    expect(seen).toHaveLength(1);
    expect(seen[0].surface).toBe("social");
    expect(seen[0].asset).toMatchObject({ organizationId: "org", storageKey: "org/social/hero.jpg" });
  });

  it("helper null -> the CN5 token URL via API_PUBLIC_URL, unchanged", async () => {
    process.env.API_PUBLIC_URL = "https://api.qosprey.com/";
    const publicMedia = { resolvePublicMediaUrl: async () => null };
    const { tables, svc } = setup(publicMedia);
    seedAsset(tables);
    const variant = await svc.createAdVariant("org", "plan-1", "ad-1", "user-1", { mediaAssetId: "ma-1" });
    expect(variant.imageUrl).toBe("https://api.qosprey.com/public/media/tok-xyz");
  });

  it("helper null + no API_PUBLIC_URL -> the CN5 refusal stands", async () => {
    const publicMedia = { resolvePublicMediaUrl: async () => null };
    const { tables, svc } = setup(publicMedia);
    seedAsset(tables);
    await expect(svc.createAdVariant("org", "plan-1", "ad-1", "user-1", { mediaAssetId: "ma-1" }))
      .rejects.toMatchObject({ code: "campaigns.apiPublicUrlIsNotConfigured" });
  });

  it("tokenless asset is refused BEFORE the helper is consulted (token stays the gate)", async () => {
    let called = false;
    const publicMedia = { resolvePublicMediaUrl: async () => { called = true; return CDN_URL; } };
    const { tables, svc } = setup(publicMedia);
    seedAsset(tables, { publicToken: null });
    await expect(svc.createAdVariant("org", "plan-1", "ad-1", "user-1", { mediaAssetId: "ma-1" }))
      .rejects.toMatchObject({ code: "campaigns.thisMediaAssetHasNoPublic" });
    expect(called).toBe(false);
  });

  it("no helper injected (pre-RB4 construction) + API_PUBLIC_URL -> token URL", async () => {
    process.env.API_PUBLIC_URL = "https://api.qosprey.com";
    const { tables, svc } = setup(undefined);
    seedAsset(tables);
    const variant = await svc.createAdVariant("org", "plan-1", "ad-1", "user-1", { mediaAssetId: "ma-1" });
    expect(variant.imageUrl).toBe("https://api.qosprey.com/public/media/tok-xyz");
  });
});
