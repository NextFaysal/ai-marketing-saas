import "reflect-metadata";
import { ApiException } from "../i18n";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { StorefrontService } from "./storefront.service";
import { EmailProvider } from "../messaging/email.provider";
import { OrderNotificationService } from "../order-notifications/order-notifications.service";
import { mergeConfig } from "../order-notifications/order-notifications";
import { AdminService } from "../admin/admin.service";

/**
 * AB8 (AX23 + AX24) — custom CSS/JS (API side) + white-label
 * (API side).
 *
 * AX23: settings validation (breakouts + length), staff read,
 * audit with LENGTHS ONLY, and the public shop payload carrying
 * the raw code for the shop layout.
 * AX24: EmailProvider fromName formatting (default unchanged),
 * order-notification sender name for white-label orgs, and the
 * admin org-update toggle (updateOrgLimits whitelist) + detail.
 */

// ---------- fake prisma (storefront.spec style) ----------

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (k === "OR") {
      if (!(v as any[]).some((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (k === "AND") {
      if (!(v as any[]).every((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const cond: any = v;
      if ("in" in cond) {
        if (!cond.in.map(String).includes(String(row[k]))) return false;
        continue;
      }
      if ("not" in cond) {
        if (String(row[k]) === String(cond.not)) return false;
        continue;
      }
      if ("gte" in cond || "lte" in cond) {
        if (row[k] === null || row[k] === undefined) return false;
        const t = new Date(row[k]).getTime();
        if ("gte" in cond && t < new Date(cond.gte).getTime()) return false;
        if ("lte" in cond && t > new Date(cond.lte).getTime()) return false;
        continue;
      }
      if ("contains" in cond) {
        const hay = String(row[k] ?? "");
        const needle = String(cond.contains);
        const hit =
          cond.mode === "insensitive"
            ? hay.toLowerCase().includes(needle.toLowerCase())
            : hay.includes(needle);
        if (!hit) return false;
        continue;
      }
      if (!matchWhere(row, cond)) return false;
    } else if (v === null) {
      if (row[k] !== null && row[k] !== undefined) return false;
    } else if (String(row[k]) !== String(v)) {
      return false;
    }
  }
  return true;
}

function applyOrderBy(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  for (const spec of [...specs].reverse()) {
    for (const [field, dir] of Object.entries(spec)) {
      out.sort((a: any, b: any) => {
        const av = a[field];
        const bv = b[field];
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const cmp =
          av instanceof Date || bv instanceof Date
            ? new Date(av).getTime() - new Date(bv).getTime()
            : av < bv
              ? -1
              : 1;
        return dir === "desc" ? -cmp : cmp;
      });
    }
  }
  return out;
}

function makeTable(name = "t") {
  const rows: any[] = [];
  let seq = 0;
  const findFirst = async ({ where, orderBy }: any = {}) =>
    applyOrderBy(rows.filter((r) => matchWhere(r, where)), orderBy)[0] ?? null;
  return {
    rows,
    findFirst,
    findUnique: findFirst,
    findMany: async ({ where, orderBy, take, skip }: any = {}) => {
      let found = applyOrderBy(rows.filter((r) => matchWhere(r, where)), orderBy);
      if (skip) found = found.slice(skip);
      if (take !== undefined) found = found.slice(0, take);
      return found;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)).length,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
    upsert: async ({ where, create, update }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (row) {
        Object.assign(row, update);
        return row;
      }
      const created = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(created);
      return created;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matchWhere(r, where));
      if (idx < 0) throw new Error("record not found");
      return rows.splice(idx, 1)[0];
    },
  };
}

function makeStorefrontPrisma() {
  return {
    organization: makeTable("org"),
    storefrontSetting: makeTable("set"),
    businessProfile: makeTable("bp"),
    category: makeTable("cat"),
    product: makeTable("prod"),
    productVariant: makeTable("var"),
    productImage: makeTable("img"),
    shippingZone: makeTable("zone"),
    storeCart: makeTable("cart"),
    storeCartItem: makeTable("ci"),
    order: makeTable("ord"),
  } as any;
}

const T0 = new Date("2026-10-01T00:00:00Z");
const CSS = ".ab8-marker{color:#123456}";
const JS = "console.log('ab8-marker-js')";

function seedShop(prisma: any, orgOver: any = {}, settingOver: any = {}) {
  prisma.organization.rows.push({
    id: "org-1", slug: "shop-one", name: "Shop One Ltd", brandName: "ShopOne",
    logoUrl: null, primaryColor: "#111111", customDomain: null, whiteLabel: false,
    ...orgOver,
  });
  prisma.storefrontSetting.rows.push({
    id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: null,
    announcementText: null, showFeatured: true, showCategories: true, showSearch: true,
    metaDescription: null, featuredProductIds: null, domainVerifyToken: null,
    domainVerifiedAt: null, customCss: null, customJs: null, customJsEnabled: false,
    createdAt: T0, updatedAt: T0, ...settingOver,
  });
  prisma.businessProfile.rows.push({
    id: "bp-1", organizationId: "org-1", codAvailable: true, bkashNumber: null,
    nagadNumber: null, paymentNote: null,
  });
  prisma.product.rows.push({
    id: "p-a", organizationId: "org-1", name: "লেদার ওয়ালেট", slug: "leather-wallet",
    description: null, category: null, categoryId: null, sku: "WAL-1", status: "ACTIVE",
    priceMinor: 50000n, compareAtMinor: null, currency: "BDT", stockQuantity: 10,
    lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null,
    bumpImageUrl: null, seoTitle: null, seoDescription: null,
    createdAt: new Date("2026-10-02"), updatedAt: T0,
  });
}

function makeStorefront(prisma: any) {
  const auditLogs: any[] = [];
  const audit: any = { log: async (x: any) => { auditLogs.push(x); } };
  const svc = new StorefrontService(prisma, undefined, undefined, audit, undefined, undefined);
  return { svc, auditLogs };
}

// ---------- AX23: validation ----------

describe("AB8 AX23 — custom CSS/JS validation", () => {
  it("rejects customCss containing </style (case-insensitive)", async () => {
    const prisma = makeStorefrontPrisma(); seedShop(prisma);
    const { svc } = makeStorefront(prisma);
    await expect(svc.updateSettings("org-1", "u-1", { customCss: "a{} </STYLE> <script>" } as any))
      .rejects.toBeInstanceOf(ApiException);
    expect(prisma.storefrontSetting.rows[0].customCss).toBeNull();
  });

  it("rejects customCss containing <!--", async () => {
    const prisma = makeStorefrontPrisma(); seedShop(prisma);
    const { svc } = makeStorefront(prisma);
    await expect(svc.updateSettings("org-1", "u-1", { customCss: "a{} <!-- sneaky" } as any))
      .rejects.toBeInstanceOf(ApiException);
  });

  it("rejects customJs containing </script (case-insensitive)", async () => {
    const prisma = makeStorefrontPrisma(); seedShop(prisma);
    const { svc } = makeStorefront(prisma);
    await expect(svc.updateSettings("org-1", "u-1", { customJs: "x(); </ScRiPt>" } as any))
      .rejects.toBeInstanceOf(ApiException);
    expect(prisma.storefrontSetting.rows[0].customJs).toBeNull();
  });

  it("rejects over-length CSS and JS (> 50,000 chars)", async () => {
    const prisma = makeStorefrontPrisma(); seedShop(prisma);
    const { svc } = makeStorefront(prisma);
    const big = "x".repeat(50001);
    await expect(svc.updateSettings("org-1", "u-1", { customCss: big } as any))
      .rejects.toBeInstanceOf(ApiException);
    await expect(svc.updateSettings("org-1", "u-1", { customJs: big } as any))
      .rejects.toBeInstanceOf(ApiException);
    // Exactly at the cap is accepted.
    const ok = await svc.updateSettings("org-1", "u-1", { customCss: "x".repeat(50000) } as any);
    expect(ok.setting.customCss).toHaveLength(50000);
  });

  it("accepts clean code, returns it on the staff read, and null clears it", async () => {
    const prisma = makeStorefrontPrisma(); seedShop(prisma);
    const { svc } = makeStorefront(prisma);
    const out = await svc.updateSettings("org-1", "u-1", {
      customCss: CSS, customJs: JS, customJsEnabled: true,
    } as any);
    expect(out.setting.customCss).toBe(CSS);
    expect(out.setting.customJs).toBe(JS);
    expect(out.setting.customJsEnabled).toBe(true);
    expect(prisma.storefrontSetting.rows[0].customCss).toBe(CSS);

    const cleared = await svc.updateSettings("org-1", "u-1", { customCss: null, customJs: null } as any);
    expect(cleared.setting.customCss).toBeNull();
    expect(cleared.setting.customJs).toBeNull();
    expect(prisma.storefrontSetting.rows[0].customCss).toBeNull();
  });

  it("serializeSetting(null) reports the custom fields as unset", async () => {
    const prisma = makeStorefrontPrisma(); seedShop(prisma);
    const { svc } = makeStorefront(prisma);
    const empty = (svc as any).serializeSetting(null);
    expect(empty.customCss).toBeNull();
    expect(empty.customJs).toBeNull();
    expect(empty.customJsEnabled).toBe(false);
  });
});

// ---------- AX23: audit carries lengths only ----------

describe("AB8 AX23 — settings audit metadata", () => {
  it("carries lengths + enabled flag and NEVER the code values", async () => {
    const prisma = makeStorefrontPrisma(); seedShop(prisma);
    const { svc, auditLogs } = makeStorefront(prisma);
    await svc.updateSettings("org-1", "u-1", {
      customCss: CSS, customJs: JS, customJsEnabled: true,
    } as any);
    const entry = auditLogs.find((l) => l.action === "storefront.settings_updated");
    expect(entry).toBeTruthy();
    expect(entry.metadata.customCssLength).toBe(CSS.length);
    expect(entry.metadata.customJsLength).toBe(JS.length);
    expect(entry.metadata.customJsEnabled).toBe(true);
    const blob = JSON.stringify(entry.metadata);
    expect(blob).not.toContain("ab8-marker");
    expect(blob).not.toContain("#123456");
    expect(blob).not.toContain(CSS);
    expect(blob).not.toContain(JS);
  });
});

// ---------- AX23/AX24: public shop payload ----------

describe("AB8 — shop home payload", () => {
  it("carries customCss/customJs/customJsEnabled + organization.whiteLabel/brandName", async () => {
    const prisma = makeStorefrontPrisma();
    seedShop(prisma, { whiteLabel: true }, { customCss: CSS, customJs: JS, customJsEnabled: true });
    const { svc } = makeStorefront(prisma);
    const home = await svc.shopHome("shop-one", {});
    expect(home.settings.customCss).toBe(CSS);
    expect(home.settings.customJs).toBe(JS);
    expect(home.settings.customJsEnabled).toBe(true);
    expect(home.organization.whiteLabel).toBe(true);
    expect(home.organization.brandName).toBe("ShopOne");
  });

  it("whiteLabel defaults to false and custom code to null when unset", async () => {
    const prisma = makeStorefrontPrisma(); seedShop(prisma);
    const { svc } = makeStorefront(prisma);
    const home = await svc.shopHome("shop-one", {});
    expect(home.organization.whiteLabel).toBe(false);
    expect(home.settings.customCss).toBeNull();
    expect(home.settings.customJs).toBeNull();
    expect(home.settings.customJsEnabled).toBe(false);
  });
});

// ---------- AX24: EmailProvider fromName ----------

describe("AB8 AX24 — EmailProvider.send fromName", () => {
  const OLD_ENV = { ...process.env };
  beforeAll(() => {
    process.env.SMTP_HOST = "smtp.invalid";
    process.env.SMTP_FROM = "reports@example.com";
  });
  afterAll(() => { process.env = OLD_ENV; });

  function capturing() {
    const sent: any[] = [];
    const transport = {
      sendMail: async (mail: any) => { sent.push(mail); return { messageId: "<ab8@test>" }; },
    };
    return { provider: new EmailProvider(transport), sent };
  }

  it("formats the From header as \"Name\" <addr> when fromName is present", async () => {
    const { provider, sent } = capturing();
    await provider.send({ to: "c@example.com", subject: "s", text: "t", fromName: "My Shop" });
    expect(sent[0].from).toBe('"My Shop" <reports@example.com>');
  });

  it("strips quotes and newlines from the display name", async () => {
    const { provider, sent } = capturing();
    await provider.send({ to: "c@example.com", subject: "s", text: "t", fromName: 'My "Shop"\nName\r\nBcc: x' });
    expect(sent[0].from).not.toContain("\n");
    expect(sent[0].from).toBe('"My ShopNameBcc: x" <reports@example.com>');
  });

  it("without fromName the From is the bare address (pre-AB8 shape)", async () => {
    const { provider, sent } = capturing();
    await provider.send({ to: "c@example.com", subject: "s", text: "t" });
    expect(sent[0].from).toBe("reports@example.com");
    expect(sent[0]).toMatchObject({ to: "c@example.com", subject: "s", text: "t" });
  });
});

// ---------- AX24: order notifications ----------

function makeNotifyHarness(orgRow: any, settingShopName: string | null = "ShopNameX") {
  const tables = {
    order: makeTable("order"),
    customer: makeTable("customer"),
    orderNotificationSetting: makeTable("setting"),
    orderNotificationLog: makeTable("log"),
    courierShipment: makeTable("shipment"),
    storefrontSetting: makeTable("sf"),
    organization: makeTable("org"),
    integration: makeTable("int"),
    paymentVerification: makeTable("pv"),
  };
  const prisma: any = { ...tables };
  tables.customer.rows.push({
    id: "cust-1", organizationId: "org-1", firstName: "Ayesha", lastName: "Rahman",
    phone: "01711000000", email: "ayesha@example.com",
  });
  tables.order.rows.push({
    id: "order-1", organizationId: "org-1", customerId: "cust-1",
    externalNumber: "ORD-1001", totalMinor: 125000n, isPractice: false,
    conversationId: null, status: "processing",
  });
  tables.organization.rows.push(orgRow);
  tables.storefrontSetting.rows.push({ id: "sf-1", organizationId: "org-1", shopName: settingShopName });
  tables.orderNotificationSetting.rows.push({
    id: "setting-1", organizationId: "org-1",
    config: mergeConfig({ order_placed: { enabled: true, channels: ["email"], templates: { sms: null, whatsapp: null, email: null } } }),
  });
  const emailCalls: any[] = [];
  const emailProvider: any = {
    isConfigured: () => true,
    send: async (input: any) => { emailCalls.push(input); return { providerMessageId: "em-1" }; },
  };
  const svc = new OrderNotificationService(
    prisma, undefined, undefined, emailProvider, undefined,
    { on: () => undefined } as any,
  );
  return { svc, emailCalls, tables };
}

describe("AB8 AX24 — order notification sender name", () => {
  it("whiteLabel org → fromName is the org brandName", async () => {
    const h = makeNotifyHarness({ id: "org-1", name: "Legal Name Ltd", brandName: "BrandCo", whiteLabel: true });
    const res = await h.svc.notify("org-1", "order-1", "order_placed");
    expect(res.sent).toBe(true);
    expect(h.emailCalls).toHaveLength(1);
    expect(h.emailCalls[0].fromName).toBe("BrandCo");
  });

  it("whiteLabel org without brandName → fromName falls back to the shop name", async () => {
    const h = makeNotifyHarness({ id: "org-1", name: "Legal Name Ltd", brandName: null, whiteLabel: true });
    await h.svc.notify("org-1", "order-1", "order_placed");
    expect(h.emailCalls[0].fromName).toBe("ShopNameX");
  });

  it("whiteLabel org without brandName or shop name → fromName is the org name", async () => {
    const h = makeNotifyHarness({ id: "org-1", name: "Legal Name Ltd", brandName: null, whiteLabel: true }, null);
    await h.svc.notify("org-1", "order-1", "order_placed");
    expect(h.emailCalls[0].fromName).toBe("Legal Name Ltd");
  });

  it("non-whiteLabel org → no fromName key at all (today's behaviour)", async () => {
    const h = makeNotifyHarness({ id: "org-1", name: "Legal Name Ltd", brandName: "BrandCo", whiteLabel: false });
    const res = await h.svc.notify("org-1", "order-1", "order_placed");
    expect(res.sent).toBe(true);
    expect(h.emailCalls).toHaveLength(1);
    expect("fromName" in h.emailCalls[0]).toBe(false);
  });
});

// ---------- AX24: admin toggle ----------

function makeAdminHarness() {
  const tables: Record<string, any> = {};
  for (const n of [
    "organization", "membership", "user", "integration", "subscription",
    "product", "order", "channelConversation", "campaignPlan", "businessProfile",
  ]) tables[n] = makeTable(n);
  const prisma: any = { ...tables };
  tables.organization.rows.push({
    id: "org-1", name: "Demo Store", slug: "demo", status: "ACTIVE",
    creditMinor: 0n, whiteLabel: false, createdAt: new Date(), updatedAt: new Date(),
  });
  const auditLogs: any[] = [];
  const audit: any = { log: async (x: any) => { auditLogs.push(x); } };
  const svc = new AdminService(prisma, audit);
  const actor: any = { id: "admin-1", email: "root@x.com" };
  return { svc, prisma, tables, auditLogs, actor };
}

describe("AB8 AX24 — admin whiteLabel toggle", () => {
  it("persists via updateOrgLimits, returns it, and audits before/after", async () => {
    const h = makeAdminHarness();
    const out = await h.svc.updateOrgLimits(h.actor, "org-1", { whiteLabel: true });
    expect(out.whiteLabel).toBe(true);
    expect(h.tables.organization.rows[0].whiteLabel).toBe(true);
    const entry = h.auditLogs.find((l) => l.action === "admin.org_limits");
    expect(entry).toBeTruthy();
    expect(entry.metadata.before.whiteLabel).toBe(false);
    expect(entry.metadata.after.whiteLabel).toBe(true);

    const off = await h.svc.updateOrgLimits(h.actor, "org-1", { whiteLabel: false });
    expect(off.whiteLabel).toBe(false);
    expect(h.tables.organization.rows[0].whiteLabel).toBe(false);
  });

  it("rejects a non-boolean whiteLabel and unknown orgs, like neighbouring fields", async () => {
    const h = makeAdminHarness();
    await expect(h.svc.updateOrgLimits(h.actor, "org-1", { whiteLabel: "yes" } as any))
      .rejects.toBeInstanceOf(ApiException);
    await expect(h.svc.updateOrgLimits(h.actor, "no-such-org", { whiteLabel: true }))
      .rejects.toBeInstanceOf(ApiException);
    // Neighbouring behaviour unchanged: negative limits still refuse.
    await expect(h.svc.updateOrgLimits(h.actor, "org-1", { seatLimit: -1 }))
      .rejects.toBeInstanceOf(ApiException);
    const org = await h.svc.updateOrgLimits(h.actor, "org-1", { seatLimit: 3 });
    expect(org.seatLimit).toBe(3);
    expect(org.whiteLabel).toBe(false);
  });

  it("org detail payload carries whiteLabel", async () => {
    const h = makeAdminHarness();
    h.tables.organization.rows[0].whiteLabel = true;
    const detail = await h.svc.orgDetail("org-1");
    expect(detail.whiteLabel).toBe(true);
  });
});
