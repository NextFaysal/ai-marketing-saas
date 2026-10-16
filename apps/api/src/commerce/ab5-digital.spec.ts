/**
 * AB5 (AX9) — Digital depth: license-key pool + signed downloads.
 *
 * Self-contained fake-prisma harness (the codebase spec style):
 * the REAL LicenseKeysService + StorefrontService run against
 * in-memory tables. What is pinned here:
 *  - download-token mint/verify roundtrip, tamper + expiry;
 *  - import dedupe (within submission + against the pool),
 *    the >500 refusal, per-line report, case-sensitivity;
 *  - masked staff list (no keyHash / keySealed anywhere);
 *  - assignment exactly-once (second reveal = same keys, pool
 *    drains by quantity), shortage reporting, revoke hiding a
 *    key from the reveal set, unseal-failure skip;
 *  - product-save validation for the new digital fields;
 *  - digitalAccess returning downloadPath (+ license keys) and
 *    NEVER the raw stored file URL;
 *  - the download endpoint: valid token ⇒ 302 + per-item counter,
 *    limit ⇒ 403, another order's token ⇒ 403, per-item
 *    independence.
 */
import { LicenseKeysService } from "./license-keys.service";
import { StorefrontService } from "../storefront/storefront.service";
import {
  mintDownloadToken,
  verifyDownloadToken,
  downloadTokenSecret,
} from "../storefront/digital-download-token";
import { normalizeEc24Fields } from "../products/products.service";
import { assertEc24Conditionals } from "./ec24";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "ab5-digital-test-secret";

// ------------------------------------------------------------------
// Fake prisma harness
// ------------------------------------------------------------------

let seq = 0;
const nid = (p: string) => `${p}-${++seq}`;

function cmpVal(a: any, b: any): number {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (av === bv) return 0;
  if (av == null) return -1;
  if (bv == null) return 1;
  return av < bv ? -1 : 1;
}

function matchWhere(row: any, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
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
      if ("in" in (v as any)) {
        if (!(v as any).in.includes(row[k])) return false;
        continue;
      }
      if ("not" in (v as any)) {
        if (row[k] === (v as any).not) return false;
        continue;
      }
      if (!matchWhere(row[k] ?? {}, v)) return false;
    } else if (v === null) {
      if (row[k] !== null && row[k] !== undefined) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}

function sortRows(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  for (const spec of [...specs].reverse()) {
    const [field, dir] = Object.entries(spec)[0] as [string, string];
    out.sort((a, b) => cmpVal(a[field], b[field]) * (dir === "desc" ? -1 : 1));
  }
  return out;
}

function makeTable(name: string, uniqueCheck?: (rows: any[], candidate: any, selfId?: string) => void) {
  const table: any = {
    rows: [] as any[],
    findFirst: async ({ where, orderBy }: any = {}) =>
      sortRows(table.rows.filter((r: any) => matchWhere(r, where)), orderBy)[0] ?? null,
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let out = sortRows(table.rows.filter((r: any) => matchWhere(r, where ?? {})), orderBy);
      if (take) out = out.slice(0, take);
      return out;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? nid(name), createdAt: new Date(), updatedAt: new Date(), ...data };
      uniqueCheck?.(table.rows, row);
      table.rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = table.rows.find((r: any) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      const matched = table.rows.filter((r: any) => matchWhere(r, where));
      for (const row of matched) {
        uniqueCheck?.(table.rows, { ...row, ...data }, row.id);
      }
      for (const row of matched) Object.assign(row, data);
      return { count: matched.length };
    },
    count: async ({ where }: any = {}) => table.rows.filter((r: any) => matchWhere(r, where ?? {})).length,
  };
  return table;
}

function licenseUnique(rows: any[], candidate: any, selfId?: string) {
  for (const r of rows) {
    if (selfId && r.id === selfId) continue;
    if (
      r.organizationId === candidate.organizationId &&
      r.productId === candidate.productId &&
      r.keyHash === candidate.keyHash
    ) {
      throw new Error("Unique constraint failed on the fields: (organizationId, productId, keyHash) P2002");
    }
    if (
      candidate.assignedItemId != null &&
      r.assignedItemId === candidate.assignedItemId &&
      r.unitIndex === candidate.unitIndex
    ) {
      throw new Error("Unique constraint failed on the fields: (assignedItemId, unitIndex) P2002");
    }
  }
}

function fakePrisma() {
  return {
    organization: makeTable("org"),
    storefrontSetting: makeTable("setting"),
    order: makeTable("order"),
    orderItem: makeTable("item"),
    customer: makeTable("customer"),
    product: makeTable("product"),
    fulfillment: makeTable("fulfillment"),
    licenseKey: makeTable("licenseKey", licenseUnique),
  } as any;
}

const auditStub: any = { log: jest.fn(async () => {}) };

// ------------------------------------------------------------------
// Download tokens
// ------------------------------------------------------------------

describe("AX9 download tokens", () => {
  const SECRET = "token-test-secret";
  const now = () => Math.floor(Date.now() / 1000);

  it("mint/verify roundtrip", () => {
    const token = mintDownloadToken(SECRET, { orderId: "o-1", itemId: "i-1", expEpochSec: now() + 3600 });
    expect(verifyDownloadToken(SECRET, token)).toEqual({ orderId: "o-1", itemId: "i-1", exp: now() + 3600 });
  });

  it("tampered payload => null", () => {
    const token = mintDownloadToken(SECRET, { orderId: "o-1", itemId: "i-1", expEpochSec: now() + 3600 });
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ orderId: "o-1", itemId: "i-2", exp: now() + 3600 })).toString("base64url");
    expect(verifyDownloadToken(SECRET, `${forged}.${sig}`)).toBeNull();
  });

  it("tampered signature => null", () => {
    const token = mintDownloadToken(SECRET, { orderId: "o-1", itemId: "i-1", expEpochSec: now() + 3600 });
    const [encoded, sig] = token.split(".");
    const bad = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(verifyDownloadToken(SECRET, `${encoded}.${bad}`)).toBeNull();
  });

  it("expired => null; wrong secret => null; garbage => null", () => {
    const expired = mintDownloadToken(SECRET, { orderId: "o-1", itemId: "i-1", expEpochSec: now() - 10 });
    expect(verifyDownloadToken(SECRET, expired)).toBeNull();
    const token = mintDownloadToken(SECRET, { orderId: "o-1", itemId: "i-1", expEpochSec: now() + 3600 });
    expect(verifyDownloadToken("other-secret", token)).toBeNull();
    expect(verifyDownloadToken(SECRET, "not-a-token")).toBeNull();
    expect(verifyDownloadToken(SECRET, "")).toBeNull();
  });

  it("the secret source is JWT_SECRET (the admin-token source)", () => {
    expect(downloadTokenSecret()).toBe(process.env.JWT_SECRET);
  });
});

// ------------------------------------------------------------------
// License import / list / pool
// ------------------------------------------------------------------

function seedDigitalProduct(prisma: any, over: any = {}) {
  prisma.product.rows.push({
    id: "p-lic", organizationId: "org-1", name: "সফটওয়্যার লাইসেন্স", status: "ACTIVE",
    priceMinor: 10000n, digital: true, digitalDeliveryType: "license", digitalFileUrl: null,
    digitalAccessLimit: null, ...over,
  });
}

describe("AX9 license import", () => {
  it("dedupes within the submission + reports invalid lines and the batch", async () => {
    const prisma = fakePrisma();
    seedDigitalProduct(prisma);
    const svc = new LicenseKeysService(prisma, auditStub);
    const out = await svc.importKeys("org-1", "u-1", "p-lic", {
      text: "KEY-AAAA-1111\nKEY-BBBB-2222\nKEY-AAAA-1111\nab\n\n  KEY-CCCC-3333  \n",
    });
    expect(out.imported).toBe(3);
    expect(out.duplicateCount).toBe(1);
    expect(out.duplicatesLast4).toEqual(["1111"]);
    expect(out.invalidCount).toBe(1);
    expect(out.invalidLines).toEqual([4]);
    expect(out.batch).toMatch(/^IMP-\d{8}-\d{4}$/);
    expect(prisma.licenseKey.rows).toHaveLength(3);
    expect(auditStub.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "license_keys.imported" }),
    );
  });

  it("dedupes against the pool on a second import; an explicit batch label wins", async () => {
    const prisma = fakePrisma();
    seedDigitalProduct(prisma);
    const svc = new LicenseKeysService(prisma, auditStub);
    await svc.importKeys("org-1", "u-1", "p-lic", { text: "KEY-AAAA-1111\nKEY-BBBB-2222" });
    const out = await svc.importKeys("org-1", "u-1", "p-lic", {
      text: "KEY-AAAA-1111\nKEY-DDDD-4444",
      batch: "VENDOR-JAN",
    });
    expect(out.imported).toBe(1);
    expect(out.duplicateCount).toBe(1);
    expect(out.batch).toBe("VENDOR-JAN");
    expect(prisma.licenseKey.rows).toHaveLength(3);
    expect(prisma.licenseKey.rows[2].importBatch).toBe("VENDOR-JAN");
  });

  it("keys are CASE-SENSITIVE: AbCd and abcd are different keys", async () => {
    const prisma = fakePrisma();
    seedDigitalProduct(prisma);
    const svc = new LicenseKeysService(prisma, auditStub);
    const out = await svc.importKeys("org-1", "u-1", "p-lic", { text: "AbCd-1234\nabcd-1234" });
    expect(out.imported).toBe(2);
    expect(out.duplicateCount).toBe(0);
  });

  it(">500 non-empty lines refuses the WHOLE import", async () => {
    const prisma = fakePrisma();
    seedDigitalProduct(prisma);
    const svc = new LicenseKeysService(prisma, auditStub);
    const text = Array.from({ length: 501 }, (_, i) => `KEY-${String(i).padStart(4, "0")}-XXXX`).join("\n");
    await expect(svc.importKeys("org-1", "u-1", "p-lic", { text })).rejects.toThrow(/সর্বোচ্চ 500/);
    expect(prisma.licenseKey.rows).toHaveLength(0);
  });

  it("non-digital or missing product => Bengali 400", async () => {
    const prisma = fakePrisma();
    seedDigitalProduct(prisma, { id: "p-phys", digital: false });
    const svc = new LicenseKeysService(prisma, auditStub);
    await expect(svc.importKeys("org-1", "u-1", "p-phys", { text: "KEY-AAAA-1111" }))
      .rejects.toThrow(/শুধুমাত্র ডিজিটাল পণ্যের জন্য/);
    await expect(svc.importKeys("org-1", "u-1", "p-nope", { text: "KEY-AAAA-1111" }))
      .rejects.toThrow(/পণ্যটি পাওয়া যায়নি/);
    await expect(svc.importKeys("org-2", "u-1", "p-phys", { text: "KEY-AAAA-1111" }))
      .rejects.toThrow(/পণ্যটি পাওয়া যায়নি/);
  });

  it("listKeys is MASKED — no keyHash / keySealed / full key anywhere", async () => {
    const prisma = fakePrisma();
    seedDigitalProduct(prisma);
    const svc = new LicenseKeysService(prisma, auditStub);
    await svc.importKeys("org-1", "u-1", "p-lic", { text: "KEY-AAAA-1111\nKEY-BBBB-2222" });
    const out: any = await svc.listKeys("org-1", { productId: "p-lic" });
    expect(out.keys).toHaveLength(2);
    expect(out.keys[0]).toEqual(expect.objectContaining({ keyLast4: expect.any(String), status: "available", productId: "p-lic" }));
    const json = JSON.stringify(out);
    expect(json).not.toContain("keySealed");
    expect(json).not.toContain("keyHash");
    expect(json).not.toContain("KEY-AAAA-1111");
    expect(json).not.toContain("KEY-BBBB-2222");
    const summary = await svc.poolSummary("org-1", "p-lic");
    expect(summary).toEqual({ available: 2, assigned: 0, revoked: 0 });
  });
});

// ------------------------------------------------------------------
// Assignment / revoke
// ------------------------------------------------------------------

describe("AX9 license assignment", () => {
  function orderWith(qty: number, itemId = "i-1", orderId = "o-1") {
    return { id: orderId, organizationId: "org-1", items: [{ id: itemId, orderId, productId: "p-lic", name: "সফটওয়্যার লাইসেন্স", quantity: qty }] };
  }

  it("assigns exactly-once: a second call returns the SAME keys and drains nothing more", async () => {
    const prisma = fakePrisma();
    seedDigitalProduct(prisma);
    const svc = new LicenseKeysService(prisma, auditStub);
    await svc.importKeys("org-1", "u-1", "p-lic", { text: "KEY-AAAA-1111\nKEY-BBBB-2222\nKEY-CCCC-3333" });
    const first = await svc.ensureAssignedForOrder("org-1", orderWith(2));
    expect(first.shortages).toEqual([]);
    expect(first.byItem).toHaveLength(1);
    expect(first.byItem[0].keys.map((k) => k.key).sort()).toEqual(["KEY-AAAA-1111", "KEY-BBBB-2222"]);
    expect(first.byItem[0].keys.map((k) => k.unitIndex).sort()).toEqual([0, 1]);

    const second = await svc.ensureAssignedForOrder("org-1", orderWith(2));
    expect(second.byItem[0].keys.map((k) => k.key).sort()).toEqual(first.byItem[0].keys.map((k) => k.key).sort());
    expect(await svc.poolSummary("org-1", "p-lic")).toEqual({ available: 1, assigned: 2, revoked: 0 });
  });

  it("shortage is reported honestly when the pool < quantity", async () => {
    const prisma = fakePrisma();
    seedDigitalProduct(prisma);
    const svc = new LicenseKeysService(prisma, auditStub);
    await svc.importKeys("org-1", "u-1", "p-lic", { text: "KEY-AAAA-1111" });
    const out = await svc.ensureAssignedForOrder("org-1", orderWith(3));
    expect(out.byItem[0].keys).toHaveLength(1);
    expect(out.shortages).toEqual([{ itemId: "i-1", productName: "সফটওয়্যার লাইসেন্স", needed: 3, assigned: 1 }]);
  });

  it("revoke hides the key from the reveal set (assignedForOrder) + audits", async () => {
    const prisma = fakePrisma();
    seedDigitalProduct(prisma);
    const svc = new LicenseKeysService(prisma, auditStub);
    await svc.importKeys("org-1", "u-1", "p-lic", { text: "KEY-AAAA-1111\nKEY-BBBB-2222" });
    await svc.ensureAssignedForOrder("org-1", orderWith(2));
    const before = await svc.assignedForOrder("org-1", "o-1");
    expect(before.byItem[0].keys).toHaveLength(2);

    const assignedRow = prisma.licenseKey.rows.find((r: any) => r.status === "assigned");
    const revoked: any = await svc.revokeKey("org-1", "u-1", assignedRow.id);
    expect(revoked.status).toBe("revoked");
    expect(revoked.keyLast4).toBe(assignedRow.keyLast4);
    expect(JSON.stringify(revoked)).not.toContain("keySealed");

    const after = await svc.assignedForOrder("org-1", "o-1");
    expect(after.byItem[0].keys).toHaveLength(1);
    expect(after.byItem[0].keys[0].key).not.toBe(
      before.byItem[0].keys.find((k: any) => k.keyLast4 === assignedRow.keyLast4)?.key,
    );
    // Already-revoked returns as-is; another org 404s.
    const again: any = await svc.revokeKey("org-1", "u-1", assignedRow.id);
    expect(again.status).toBe("revoked");
    await expect(svc.revokeKey("org-2", "u-1", assignedRow.id)).rejects.toThrow(/পাওয়া যায়নি/);
  });

  it("a key that fails to unseal is skipped and does NOT count as assigned", async () => {
    const prisma = fakePrisma();
    seedDigitalProduct(prisma);
    const svc = new LicenseKeysService(prisma, auditStub);
    prisma.licenseKey.rows.push({
      id: "lk-bad", organizationId: "org-1", productId: "p-lic", keyHash: "x", keySealed: "v1:bad:bad:bad",
      keyLast4: "9999", status: "assigned", assignedOrderId: "o-1", assignedItemId: "i-1", unitIndex: 0,
      assignedAt: new Date(), createdAt: new Date(),
    });
    const out = await svc.ensureAssignedForOrder("org-1", orderWith(1));
    expect(out.byItem[0].keys).toEqual([]);
    expect(out.shortages).toEqual([{ itemId: "i-1", productName: "সফটওয়্যার লাইসেন্স", needed: 1, assigned: 0 }]);
  });

  it("file-type digital products never touch the pool", async () => {
    const prisma = fakePrisma();
    seedDigitalProduct(prisma, { digitalDeliveryType: "file", digitalFileUrl: "https://files.example.com/x.pdf" });
    const svc = new LicenseKeysService(prisma, auditStub);
    await svc.importKeys("org-1", "u-1", "p-lic", { text: "KEY-AAAA-1111" });
    const out = await svc.ensureAssignedForOrder("org-1", orderWith(1));
    expect(out.byItem).toEqual([]);
    expect(await svc.poolSummary("org-1", "p-lic")).toEqual({ available: 1, assigned: 0, revoked: 0 });
  });
});

// ------------------------------------------------------------------
// Product-save validation
// ------------------------------------------------------------------

describe("AX9 product digital-field validation", () => {
  it("digitalDeliveryType must be file|license|both", () => {
    expect(normalizeEc24Fields({ digitalDeliveryType: "license" }, true).digitalDeliveryType).toBe("license");
    expect(normalizeEc24Fields({}, false).digitalDeliveryType).toBe("file");
    expect(() => normalizeEc24Fields({ digitalDeliveryType: "carrier-pigeon" }, true)).toThrow(/file, license অথবা both/);
  });

  it("digitalLinkExpiryHours must be null or an int 1..720", () => {
    expect(normalizeEc24Fields({ digitalLinkExpiryHours: 720 }, true).digitalLinkExpiryHours).toBe(720);
    expect(normalizeEc24Fields({ digitalLinkExpiryHours: null }, true).digitalLinkExpiryHours).toBeNull();
    expect(() => normalizeEc24Fields({ digitalLinkExpiryHours: 0 }, true)).toThrow(/১–৭২০/);
    expect(() => normalizeEc24Fields({ digitalLinkExpiryHours: 721 }, true)).toThrow(/১–৭২০/);
    expect(() => normalizeEc24Fields({ digitalLinkExpiryHours: 2.5 }, true)).toThrow(/১–৭২০/);
  });

  it("a license-only digital product needs NO file URL; file/both still do", () => {
    expect(() => assertEc24Conditionals({ digital: true, digitalDeliveryType: "license", digitalFileUrl: null })).not.toThrow();
    expect(() => assertEc24Conditionals({ digital: true, digitalDeliveryType: "file", digitalFileUrl: null })).toThrow(/ফাইল URL আবশ্যক/);
    expect(() => assertEc24Conditionals({ digital: true, digitalDeliveryType: "both", digitalFileUrl: null })).toThrow(/ফাইল URL আবশ্যক/);
    expect(() => assertEc24Conditionals({ digital: true, digitalFileUrl: null })).toThrow(/ফাইল URL আবশ্যক/);
  });
});

// ------------------------------------------------------------------
// Storefront reveal + download endpoint
// ------------------------------------------------------------------

const PHONE = "01711111111";
const FILE_URL = "https://files.example.com/secret-ebook.pdf";
const FILE2_URL = "https://files.example.com/secret-course.zip";

class FakeRes {
  statusCode: number | null = null;
  headers: Record<string, string> = {};
  body: string | null = null;
  redirectUrl: string | null = null;
  status(code: number) { this.statusCode = code; return this; }
  setHeader(k: string, v: string) { this.headers[k] = v; return this; }
  send(b: string) { this.body = b; return this; }
  end(b?: string) { if (b) this.body = b; return this; }
  redirect(code: number, url: string) { this.statusCode = code; this.redirectUrl = url; return this; }
}

function makeStorefront(prisma: any, licenseKeys?: any) {
  return new StorefrontService(
    prisma,
    undefined, // integrations
    undefined, // discounts
    undefined, // audit
    undefined, // dnsResolver
    undefined, // routingFetcher
    undefined, // promotions
    undefined, // bundles
    undefined, // deliveryPricing
    undefined, // affiliates
    undefined, // blockedPhones
    undefined, // email
    undefined, // inventory
    undefined, // checkoutGuard
    undefined, // idempotency
    undefined, // tenantPayments
    undefined, // loyalty
    undefined, // giftCards
    undefined, // priceLists
    licenseKeys as any,
  );
}

function seedShop(prisma: any, over: { status?: string; fileLimit?: number | null } = {}) {
  prisma.organization.rows.push({ id: "org-1", slug: "shop-one", name: "Shop One" });
  prisma.storefrontSetting.rows.push({ id: "s-1", organizationId: "org-1", shopEnabled: true, trackingPageEnabled: true, shopName: "Shop" });
  prisma.customer.rows.push({ id: "c-1", organizationId: "org-1", phone: PHONE, firstName: "রহিম" });
  prisma.product.rows.push({
    id: "p-file", organizationId: "org-1", name: "ইবুক", status: "ACTIVE", priceMinor: 10000n,
    digital: true, digitalDeliveryType: "file", digitalFileUrl: FILE_URL,
    digitalAccessLimit: over.fileLimit === undefined ? null : over.fileLimit, digitalLinkExpiryHours: 2,
  });
  prisma.product.rows.push({
    id: "p-file2", organizationId: "org-1", name: "কোর্স", status: "ACTIVE", priceMinor: 20000n,
    digital: true, digitalDeliveryType: "both", digitalFileUrl: FILE2_URL,
    digitalAccessLimit: null, digitalLinkExpiryHours: null,
  });
  prisma.product.rows.push({
    id: "p-lic", organizationId: "org-1", name: "সফটওয়্যার লাইসেন্স", status: "ACTIVE", priceMinor: 30000n,
    digital: true, digitalDeliveryType: "license", digitalFileUrl: null, digitalAccessLimit: null,
  });
  prisma.order.rows.push({
    id: "o-1", organizationId: "org-1", externalId: "native-1", externalNumber: "ORD-1",
    customerId: "c-1", status: over.status ?? "completed", totalMinor: 60000n, currency: "BDT",
    digitalAccessCount: 0, placedAt: new Date(),
  });
  prisma.orderItem.rows.push({ id: "i-file", orderId: "o-1", productId: "p-file", name: "ইবুক", quantity: 1, totalMinor: 10000n, digitalAccessCount: 0 });
  prisma.orderItem.rows.push({ id: "i-file2", orderId: "o-1", productId: "p-file2", name: "কোর্স", quantity: 1, totalMinor: 20000n, digitalAccessCount: 0 });
  prisma.orderItem.rows.push({ id: "i-lic", orderId: "o-1", productId: "p-lic", name: "সফটওয়্যার লাইসেন্স", quantity: 2, totalMinor: 30000n, digitalAccessCount: 0 });
}

function tokenFrom(downloadPath: string): string {
  return downloadPath.split("token=")[1];
}

describe("AX9 storefront reveal + signed download", () => {
  it("digitalAccess returns downloadPath + license keys and NOT the raw URL", async () => {
    const prisma = fakePrisma();
    seedShop(prisma);
    const licenseKeys = new LicenseKeysService(prisma, auditStub);
    await licenseKeys.importKeys("org-1", "u-1", "p-lic", { text: "KEY-AAAA-1111\nKEY-BBBB-2222" });
    // "both" product p-file2 also draws license keys — none in its
    // pool, which must surface as a shortage, not a failure.
    const svc = makeStorefront(prisma, licenseKeys);
    const out: any = await svc.digitalAccess("shop-one", { phone: PHONE, orderNumber: "ORD-1" });

    expect(out.links).toHaveLength(2);
    const ebook = out.links.find((l: any) => l.itemId === "i-file");
    expect(ebook.productName).toBe("ইবুক");
    expect(ebook.downloadPath).toContain("public/shop/shop-one/orders/o-1/digital-download?token=");
    expect(ebook.expiresAt).toBeTruthy();
    // THE key assertion: the stored merchant URLs appear NOWHERE.
    const json = JSON.stringify(out);
    expect(json).not.toContain(FILE_URL);
    expect(json).not.toContain(FILE2_URL);
    expect(json).not.toContain("files.example.com");
    expect(json).not.toContain("digitalFileUrl");

    const lic = out.licenseKeys.find((l: any) => l.itemId === "i-lic");
    expect(lic.keys.map((k: any) => k.key).sort()).toEqual(["KEY-AAAA-1111", "KEY-BBBB-2222"]);
    expect(out.licenseShortages).toEqual([{ productName: "কোর্স", needed: 1, assigned: 0 }]);
    // Order-level counting semantics unchanged: one reveal = +1.
    expect(prisma.order.rows[0].digitalAccessCount).toBe(1);
  });

  it("a license failure does NOT break the file reveal", async () => {
    const prisma = fakePrisma();
    seedShop(prisma);
    const brokenLicenseKeys: any = { ensureAssignedForOrder: jest.fn(async () => { throw new Error("pool exploded"); }) };
    const svc = makeStorefront(prisma, brokenLicenseKeys);
    const out: any = await svc.digitalAccess("shop-one", { phone: PHONE, orderNumber: "ORD-1" });
    expect(out.links).toHaveLength(2);
    expect(out.licenseKeys).toEqual([]);
  });

  it("valid token => 302 to the stored URL + the ITEM counter increments (order counter untouched)", async () => {
    const prisma = fakePrisma();
    seedShop(prisma);
    const svc = makeStorefront(prisma);
    const out: any = await svc.digitalAccess("shop-one", { phone: PHONE, orderNumber: "ORD-1" });
    const token = tokenFrom(out.links.find((l: any) => l.itemId === "i-file").downloadPath);
    const res = new FakeRes();
    await svc.digitalDownload("shop-one", "o-1", token, res as any);
    expect(res.statusCode).toBe(302);
    expect(res.redirectUrl).toBe(FILE_URL);
    const item = prisma.orderItem.rows.find((r: any) => r.id === "i-file");
    expect(item.digitalAccessCount).toBe(1);
    expect(item.digitalLastAccessedAt).toBeInstanceOf(Date);
  });

  it("per-item limit reached => generic 403; item B is NOT blocked by item A", async () => {
    const prisma = fakePrisma();
    seedShop(prisma, { fileLimit: 1 });
    const svc = makeStorefront(prisma);
    const secret = downloadTokenSecret();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const tokenA = mintDownloadToken(secret, { orderId: "o-1", itemId: "i-file", expEpochSec: exp });
    const tokenB = mintDownloadToken(secret, { orderId: "o-1", itemId: "i-file2", expEpochSec: exp });

    const resA1 = new FakeRes();
    await svc.digitalDownload("shop-one", "o-1", tokenA, resA1 as any);
    expect(resA1.statusCode).toBe(302);

    const resA2 = new FakeRes();
    await svc.digitalDownload("shop-one", "o-1", tokenA, resA2 as any);
    expect(resA2.statusCode).toBe(403);
    expect(resA2.body).toContain("লিংকটি বৈধ নয় বা মেয়াদ শেষ");
    expect(resA2.redirectUrl).toBeNull();

    // Per-item independence: B has its own counter + no limit.
    const resB = new FakeRes();
    await svc.digitalDownload("shop-one", "o-1", tokenB, resB as any);
    expect(resB.statusCode).toBe(302);
    expect(resB.redirectUrl).toBe(FILE2_URL);
    expect(prisma.orderItem.rows.find((r: any) => r.id === "i-file2").digitalAccessCount).toBe(1);
    expect(prisma.orderItem.rows.find((r: any) => r.id === "i-file").digitalAccessCount).toBe(1);
  });

  it("a token for ANOTHER order => 403 on this order's route", async () => {
    const prisma = fakePrisma();
    seedShop(prisma);
    prisma.order.rows.push({
      id: "o-2", organizationId: "org-1", externalId: "native-2", externalNumber: "ORD-2",
      customerId: "c-1", status: "completed", totalMinor: 10000n, currency: "BDT", digitalAccessCount: 0, placedAt: new Date(),
    });
    const svc = makeStorefront(prisma);
    const secret = downloadTokenSecret();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const otherOrderToken = mintDownloadToken(secret, { orderId: "o-2", itemId: "i-file", expEpochSec: exp });
    const res = new FakeRes();
    await svc.digitalDownload("shop-one", "o-1", otherOrderToken, res as any);
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("লিংকটি বৈধ নয় বা মেয়াদ শেষ");
    expect(prisma.orderItem.rows.find((r: any) => r.id === "i-file").digitalAccessCount).toBe(0);
  });

  it("expired token, tampered token and an undelivered order all get the SAME generic 403", async () => {
    const prisma = fakePrisma();
    seedShop(prisma);
    const svc = makeStorefront(prisma);
    const secret = downloadTokenSecret();
    const expired = mintDownloadToken(secret, { orderId: "o-1", itemId: "i-file", expEpochSec: Math.floor(Date.now() / 1000) - 60 });
    const resExpired = new FakeRes();
    await svc.digitalDownload("shop-one", "o-1", expired, resExpired as any);
    expect(resExpired.statusCode).toBe(403);

    const resTampered = new FakeRes();
    await svc.digitalDownload("shop-one", "o-1", `${expired}x`, resTampered as any);
    expect(resTampered.statusCode).toBe(403);
    expect(resTampered.body).toBe(resExpired.body);

    const prisma2 = fakePrisma();
    seedShop(prisma2, { status: "processing" });
    const svc2 = makeStorefront(prisma2);
    const valid = mintDownloadToken(secret, { orderId: "o-1", itemId: "i-file", expEpochSec: Math.floor(Date.now() / 1000) + 3600 });
    const resUndelivered = new FakeRes();
    await svc2.digitalDownload("shop-one", "o-1", valid, resUndelivered as any);
    expect(resUndelivered.statusCode).toBe(403);
    expect(resUndelivered.body).toBe(resExpired.body);
  });

  it("trackOrder summary carries no URL (unchanged AB5 behaviour, verified)", async () => {
    const prisma = fakePrisma();
    seedShop(prisma);
    const svc = makeStorefront(prisma);
    const out: any = await svc.trackOrder("shop-one", { phone: PHONE, orderNumber: "ORD-1" });
    expect(JSON.stringify(out)).not.toContain("files.example.com");
    expect(JSON.stringify(out)).not.toContain("digitalFileUrl");
    expect(out.digitalItems.length).toBeGreaterThan(0);
  });
});
