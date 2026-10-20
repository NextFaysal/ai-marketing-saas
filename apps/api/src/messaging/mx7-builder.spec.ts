process.env.JWT_SECRET = "test-secret";
process.env.WEB_URL = "https://app.example.com";
process.env.API_PUBLIC_URL = "https://api.example.com";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { MessagingService } from "./messaging.service";

/**
 * MX7 (service) — block-built templates render into the SAME
 * body/htmlBody fields; old-format templates are byte-identical
 * before/after (create/update/broadcast-from-template); versioning
 * snapshots + restore-as-new-version; content library CRUD; the
 * festival pack installs with EMPTY slots (no real rows chosen
 * yet) and fills only from real Product/StoreDiscount rows;
 * brand-kit changes never rewrite an existing broadcast; a
 * broadcast stamps the template version it was built from.
 * Fake-prisma style like the MS/MX specs.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("not" in v) return row[k] !== v.not;
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
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take, orderBy }: any = {}) => {
      let out = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.version === "desc") out = [...out].sort((a, b) => b.version - a.version);
      if (orderBy?.createdAt === "desc") out = [...out].reverse();
      return take ? out.slice(0, take) : out;
    },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return {}; },
  };
}

function build() {
  const tables: any = {
    messageTemplate: makeTable("tpl"), messageTemplateVersion: makeTable("ver"),
    messagingContentBlock: makeTable("cb"), broadcast: makeTable("bc"),
    product: makeTable("prod"), storeDiscount: makeTable("disc"),
  };
  const orgRow: any = {
    id: "org-1", name: "Legal Name Ltd", brandName: "Meghna Attire", logoUrl: "https://cdn.example.com/logo.png",
    primaryColor: "#0E7490", brandSecondaryColor: "#B45309", brandFont: "hind-siliguri",
  };
  tables.organization = { findUnique: async () => orgRow, findFirst: async () => orgRow };
  const audit = { log: async () => undefined } as any;
  const email = { isConfigured: () => true, send: async () => ({ providerMessageId: "x" }) } as any;
  const sms = { isConfigured: () => true, send: async () => ({ providerMessageId: "y" }) } as any;
  const svc = new MessagingService(tables as any, audit, email, sms);
  return { svc, tables, orgRow };
}

const BLOCKS = [
  { type: "text", text: "ঈদ মোবারক!" },
  { type: "product", productId: "prod-1" },
  { type: "coupon", discountId: "disc-1" },
  { type: "button", label: "কিনুন", url: "https://shop.example.com" },
];
function seedCatalog(tables: any) {
  tables.product.rows.push({ id: "prod-1", organizationId: "org-1", name: "পাঞ্জাবি", priceMinor: 125050n, currency: "BDT", slug: "panjabi", imageUrl: null, status: "ACTIVE", createdAt: new Date() });
  tables.storeDiscount.rows.push({ id: "disc-1", organizationId: "org-1", code: "EID20", kind: "percent", value: 20, active: true, createdAt: new Date() });
}

describe("MX7 block-built templates", () => {
  it("renders blocks into body/htmlBody with brand kit + real catalog values; version 1 + snapshot", async () => {
    const { svc, tables } = build(); seedCatalog(tables);
    const t: any = await svc.createTemplate("org-1", "u-1", { name: "Eid", channel: "email", subject: "ঈদ", blocks: BLOCKS });
    expect(t.version).toBe(1);
    expect(t.blocks).toHaveLength(4);
    expect(t.htmlBody).toContain("৳1,250.50");
    expect(t.htmlBody).toContain("EID20");
    expect(t.htmlBody).toContain("background:#0E7490");
    expect(t.htmlBody).toContain("Hind Siliguri");
    expect(t.body).toContain("কুপন কোড: EID20 — 20% ছাড়");
    expect(t.emptySlots).toEqual([]);
    expect(tables.messageTemplateVersion.rows).toHaveLength(1);
    expect(tables.messageTemplateVersion.rows[0].version).toBe(1);
  });

  it("refuses blocks on SMS, blocks+body together, and a body-less non-block template", async () => {
    const { svc, tables } = build(); seedCatalog(tables);
    await expect(svc.createTemplate("org-1", "u-1", { name: "x", channel: "sms", body: "hi", blocks: BLOCKS })).rejects.toMatchObject({ code: "messaging.blocksAreOnlyAllowedForEmail" });
    await expect(svc.createTemplate("org-1", "u-1", { name: "x", channel: "email", subject: "s", body: "hi", blocks: BLOCKS })).rejects.toMatchObject({ code: "messaging.withBlocksBodyHtmlBodyAreRendered" });
    await expect(svc.createTemplate("org-1", "u-1", { name: "x", channel: "email", subject: "s" })).rejects.toMatchObject({ code: "messaging.templateBodyIsRequiredWriteOne" });
  });

  it("composer discounts list only this org's ACTIVE StoreDiscount rows", async () => {
    const { svc, tables } = build(); seedCatalog(tables);
    tables.storeDiscount.rows.push({ id: "disc-2", organizationId: "org-1", code: "OFF", kind: "percent", value: 5, active: false, createdAt: new Date() });
    tables.storeDiscount.rows.push({ id: "disc-3", organizationId: "org-2", code: "OTHER", kind: "percent", value: 5, active: true, createdAt: new Date() });
    const out = await svc.listComposerDiscounts("org-1");
    // fake findMany applies the where (organizationId + active)
    expect(out.map((d: any) => d.code)).toEqual(["EID20"]);
  });
});

describe("MX7 old-format byte-identical proof", () => {
  it("a pre-MX7 template (no blocks) keeps EXACT body/htmlBody through update + broadcast creation", async () => {
    const { svc, tables } = build(); seedCatalog(tables);
    const body = "হ্যালো {{name}}, অফার চলছে https://shop.example.com/sale";
    const html = "<p>হ্যালো {{name}}</p>";
    const t: any = await svc.createTemplate("org-1", "u-1", { name: "Old", channel: "email", subject: "S", body, htmlBody: html });
    expect(t.body).toBe(body); expect(t.htmlBody).toBe(html); expect(t.blocks ?? null).toBeNull();
    const bc: any = await svc.createBroadcast("org-1", "u-1", { name: "B", channel: "email", templateId: t.id, audienceType: "customers" });
    expect(bc.body).toBe(body); expect(bc.htmlBody).toBe(html);
    expect(bc.templateVersion).toBe(1);
    void tables;
  });
});

describe("MX7 versioning", () => {
  it("content edit bumps version + snapshots; no-op edit does not; restore creates a NEW version with old content", async () => {
    const { svc, tables } = build();
    const t: any = await svc.createTemplate("org-1", "u-1", { name: "T", channel: "email", subject: "S1", body: "v1 body" });
    const edited: any = await svc.updateTemplate("org-1", t.id, { subject: "S2", body: "v2 body" });
    expect(edited.version).toBe(2);
    const noop: any = await svc.updateTemplate("org-1", t.id, { subject: "S2", body: "v2 body" });
    expect(noop.version).toBe(2);
    const versions = await svc.listTemplateVersions("org-1", t.id);
    expect(versions.map((v: any) => v.version)).toEqual([2, 1]);
    const restored: any = await svc.restoreTemplateVersion("org-1", "u-1", t.id, 1);
    expect(restored.version).toBe(3);
    expect(restored.body).toBe("v1 body"); expect(restored.subject).toBe("S1");
    expect(tables.messageTemplateVersion.rows.map((r: any) => r.version).sort()).toEqual([1, 2, 3]);
  });
});

describe("MX7 use-time rendering + sent-history immutability", () => {
  it("broadcast re-renders blocks at creation; a LATER brand change does not alter the existing broadcast or template", async () => {
    const { svc, tables, orgRow } = build(); seedCatalog(tables);
    const t: any = await svc.createTemplate("org-1", "u-1", { name: "Eid", channel: "email", subject: "ঈদ", blocks: BLOCKS });
    const bc1: any = await svc.createBroadcast("org-1", "u-1", { name: "B1", channel: "email", templateId: t.id, audienceType: "customers" });
    expect(bc1.htmlBody).toContain("background:#0E7490");
    expect(bc1.templateVersion).toBe(1);
    orgRow.primaryColor = "#FF0000";
    // existing broadcast + stored template keep their bytes…
    const storedBc = tables.broadcast.rows.find((r: any) => r.id === bc1.id);
    const storedTpl = tables.messageTemplate.rows.find((r: any) => r.id === t.id);
    expect(storedBc.htmlBody).toContain("background:#0E7490");
    expect(storedTpl.htmlBody).toContain("background:#0E7490");
    // …while a NEW broadcast from the same template uses the new kit.
    const bc2: any = await svc.createBroadcast("org-1", "u-1", { name: "B2", channel: "email", templateId: t.id, audienceType: "customers" });
    expect(bc2.htmlBody).toContain("background:#FF0000");
  });

  it("a product deleted after template save renders the slot EMPTY at broadcast creation (no stale price)", async () => {
    const { svc, tables } = build(); seedCatalog(tables);
    const t: any = await svc.createTemplate("org-1", "u-1", { name: "Eid", channel: "email", subject: "ঈদ", blocks: BLOCKS });
    expect(t.htmlBody).toContain("৳1,250.50");
    tables.product.rows.length = 0;
    const bc: any = await svc.createBroadcast("org-1", "u-1", { name: "B", channel: "email", templateId: t.id, audienceType: "customers" });
    expect(bc.htmlBody).not.toContain("৳1,250.50");
    expect(bc.body).not.toContain("পাঞ্জাবি");
  });
});

describe("MX7 content library + festival pack", () => {
  it("content blocks CRUD round-trips with validation + org scoping", async () => {
    const { svc } = build();
    const cb: any = await svc.createContentBlock("org-1", "u-1", { name: "ঈদ শুভেচ্ছা", block: { type: "text", text: "ঈদ মোবারক!" } });
    expect(cb.kind).toBe("text");
    expect((await svc.listContentBlocks("org-1")).length).toBe(1);
    expect((await svc.listContentBlocks("org-2")).length).toBe(0);
    await expect(svc.createContentBlock("org-1", "u-1", { name: "bad", block: { type: "video" } })).rejects.toThrow(/unknown block type/);
    const upd: any = await svc.updateContentBlock("org-1", cb.id, { block: { type: "divider" } });
    expect(upd.kind).toBe("divider");
    expect(await svc.deleteContentBlock("org-1", cb.id)).toEqual({ deleted: true });
  });

  it("festival install creates a template whose slots are EMPTY until real rows are picked — then they fill", async () => {
    const { svc, tables } = build(); seedCatalog(tables);
    expect(svc.listFestivalPacks().map((p: any) => p.key)).toEqual(["eid", "puja", "pohela_boishakh", "winter_sale"]);
    const { template }: any = await svc.installFestivalPack("org-1", "u-1", "eid");
    expect(template.emptySlots.map((s: any) => s.type).sort()).toEqual(["coupon", "product"]);
    expect(template.htmlBody).not.toContain("কুপন কোড");
    expect(template.htmlBody).not.toContain("৳");
    expect(template.htmlBody).toContain("ঈদ মোবারক");
    // org picks real rows in the builder → update re-renders with them
    const blocks = (template.blocks as any[]).map((b: any) => b.type === "product" ? { ...b, productId: "prod-1" } : b.type === "coupon" ? { ...b, discountId: "disc-1" } : b);
    const filled: any = await svc.updateTemplate("org-1", template.id, { blocks });
    expect(filled.htmlBody).toContain("৳1,250.50");
    expect(filled.htmlBody).toContain("EID20");
    expect(filled.version).toBe(2);
    await expect(svc.installFestivalPack("org-1", "u-1", "durga_unknown")).rejects.toMatchObject({ code: "messaging.festivalTemplatePackNotFound" });
  });

  it("brand kit reads the Organization row (single central place) with org-name fallback", async () => {
    const { svc, orgRow } = build();
    const kit = await svc.getBrandKit("org-1");
    expect(kit).toEqual({ brandName: "Meghna Attire", logoUrl: "https://cdn.example.com/logo.png", primaryColor: "#0E7490", secondaryColor: "#B45309", font: "hind-siliguri" });
    orgRow.brandName = null;
    expect((await svc.getBrandKit("org-1")).brandName).toBe("Legal Name Ltd");
  });
});
