import { BadRequestException } from "@nestjs/common";
import { StorefrontService } from "./storefront.service";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * OU2 — Cloudflare for SaaS hook on storefront domain verification.
 *
 * Proven here (fetch stubbed at the Cloudflare boundary, fixtures
 * modelled on the adapter's envelope; DNS stubbed at the resolver
 * seam, EC8 style):
 *  (a) CfS NOT configured ⇒ verification still succeeds, the
 *      adapter is NEVER called (zero fetch), and the persisted
 *      HTTPS state is the honest "not_configured";
 *  (c) configured ⇒ verification creates the custom hostname via
 *      the adapter and persists id + mapped status + detail;
 *  (d) adapter failure ⇒ verification does NOT roll back
 *      (domainVerifiedAt stays set) and the persisted state is
 *      "failed" with the provider's own words in the detail;
 *  refresh: manual refresh requires a verified domain, re-reads
 *      an existing hostname instead of duplicating it, and maps
 *      active+active to "active" (adapter-level mapping itself is
 *      unit-proven in cloudflare-for-saas.client.spec.ts — not
 *      duplicated here);
 *  a domain change clears the old domain's HTTPS state.
 * Live Cloudflare proof is NOT claimed (TD D3 owed).
 */

/* ---- fake prisma (EC8 spec style, trimmed) ---- */
function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (k === "NOT") { if (matchWhere(row, v)) return false; continue; }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const cond: any = v;
      if ("in" in cond) { if (!cond.in.includes(row[k])) return false; continue; }
      if (!matchWhere(row, cond)) return false;
    } else if (v === null) {
      if (row[k] !== null && row[k] !== undefined) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}
function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where))[0] ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)),
    create: async ({ data }: any) => { const row = { id: data.id ?? `row-${++seq}`, ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
  };
}
function makePrisma() {
  return {
    organization: makeTable(),
    storefrontSetting: makeTable(),
    systemSetting: { findUnique: async () => null },
  } as any;
}
function seed(prisma: any) {
  prisma.organization.rows.push({ id: "org-1", slug: "shop-one", name: "Shop One", brandName: null, customDomain: "shop.example.com" });
  prisma.storefrontSetting.rows.push({
    id: "set-1", organizationId: "org-1", shopEnabled: true,
    domainVerifyToken: "tok-1", domainVerifiedAt: null,
    customHostnameId: null, httpsStatus: null, httpsStatusDetail: null, httpsUpdatedAt: null,
  });
}
function makeSvc(prisma: any) {
  const audit = { log: jest.fn(async () => undefined) };
  const dns = { resolveTxt: jest.fn(async (_host: string): Promise<string[]> => ["tok-1"]) };
  const svc = new StorefrontService(prisma, undefined, undefined, audit as any, dns as any);
  return { svc, audit, dns };
}

/* ---- platform-config snapshot control ---- */
function resetSnapshot() {
  setPlatformConfigSnapshot({ llm: null, metaApp: null, smtp: null, sms: null, loadedAt: 0 } as any);
}
function setConfigured() {
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null, loadedAt: Date.now(),
    cloudflareSaas: { enabled: true, apiToken: "cf-token-1", zoneId: "zone-1" },
  } as any);
}

/* ---- fetch stub (admin-spec style) ---- */
const jsonRes = (body: any, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const realFetch = global.fetch;
function stubFetch(impl: (url: string, init?: any) => Promise<any>) {
  const calls: { url: string; init?: any }[] = [];
  (global as any).fetch = jest.fn(async (url: any, init?: any) => {
    calls.push({ url: String(url), init });
    return impl(String(url), init);
  });
  return calls;
}
beforeEach(() => resetSnapshot());
afterEach(() => { (global as any).fetch = realFetch; resetSnapshot(); });

const createPending = async (_url: string, _init?: any) =>
  jsonRes({ success: true, errors: [], result: { id: "ch-1", hostname: "shop.example.com", status: "pending", ssl: { status: "pending_validation" } } });

describe("OU2 hook — verifyDomain", () => {
  it("(a) unconfigured: verification succeeds, adapter never called, state persisted as not_configured", async () => {
    const calls = stubFetch(async () => { throw new Error("fetch must not be called"); });
    const prisma = makePrisma(); seed(prisma);
    const { svc } = makeSvc(prisma);
    const out: any = await svc.verifyDomain("org-1", "user-1");
    expect(out.verified).toBe(true);
    expect(out.httpsStatus).toBe("not_configured");
    expect(calls.length).toBe(0);
    const row = prisma.storefrontSetting.rows[0];
    expect(row.domainVerifiedAt).toBeInstanceOf(Date);
    expect(row.httpsStatus).toBe("not_configured");
    expect(row.httpsStatusDetail).toContain("configure/চালু করা নেই");
    expect(row.customHostnameId).toBeNull();
    expect(row.httpsUpdatedAt).toBeInstanceOf(Date);
  });

  it("(c) configured: creates the custom hostname and persists id + pending + provider detail", async () => {
    setConfigured();
    const calls = stubFetch(createPending);
    const prisma = makePrisma(); seed(prisma);
    const { svc } = makeSvc(prisma);
    const out: any = await svc.verifyDomain("org-1", "user-1");
    expect(out.verified).toBe(true);
    expect(out.httpsStatus).toBe("pending");
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("https://api.cloudflare.com/client/v4/zones/zone-1/custom_hostnames");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body).hostname).toBe("shop.example.com");
    const row = prisma.storefrontSetting.rows[0];
    expect(row.customHostnameId).toBe("ch-1");
    expect(row.httpsStatus).toBe("pending");
    expect(row.httpsStatusDetail).toContain("ssl status: pending_validation");
  });

  it("(d) adapter failure: verification does NOT roll back; state is failed with the provider's words", async () => {
    setConfigured();
    stubFetch(async () => jsonRes({ success: false, errors: [{ code: 1000, message: "Custom Hostnames are not enabled for this zone" }], result: null }, 403));
    const prisma = makePrisma(); seed(prisma);
    const { svc } = makeSvc(prisma);
    const out: any = await svc.verifyDomain("org-1", "user-1");
    expect(out.verified).toBe(true);
    expect(out.httpsStatus).toBe("failed");
    const row = prisma.storefrontSetting.rows[0];
    expect(row.domainVerifiedAt).toBeInstanceOf(Date);
    expect(row.httpsStatus).toBe("failed");
    expect(row.httpsStatusDetail).toContain("Custom Hostnames are not enabled for this zone");
    expect(row.customHostnameId).toBeNull();
  });
});

describe("OU2 refresh — refreshDomainHttps", () => {
  it("refuses before the domain is verified", async () => {
    const prisma = makePrisma(); seed(prisma);
    const { svc } = makeSvc(prisma);
    await expect(svc.refreshDomainHttps("org-1", "user-1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("re-reads the existing hostname (no duplicate create) and maps active+active to active", async () => {
    setConfigured();
    const calls = stubFetch(async () =>
      jsonRes({ success: true, errors: [], result: { id: "ch-1", hostname: "shop.example.com", status: "active", ssl: { status: "active" } } }));
    const prisma = makePrisma(); seed(prisma);
    const row = prisma.storefrontSetting.rows[0];
    row.domainVerifiedAt = new Date();
    row.customHostnameId = "ch-1";
    row.httpsStatus = "pending";
    const { svc } = makeSvc(prisma);
    const out: any = await svc.refreshDomainHttps("org-1", "user-1");
    expect(out.httpsStatus).toBe("active");
    expect(calls.length).toBe(1);
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].url).toBe("https://api.cloudflare.com/client/v4/zones/zone-1/custom_hostnames/ch-1");
    expect(row.httpsStatus).toBe("active");
    expect(row.httpsStatusDetail).toContain("active");
  });

  it("unconfigured refresh honestly re-persists not_configured without any fetch", async () => {
    const calls = stubFetch(async () => { throw new Error("fetch must not be called"); });
    const prisma = makePrisma(); seed(prisma);
    prisma.storefrontSetting.rows[0].domainVerifiedAt = new Date();
    const { svc } = makeSvc(prisma);
    const out: any = await svc.refreshDomainHttps("org-1", "user-1");
    expect(out.httpsStatus).toBe("not_configured");
    expect(calls.length).toBe(0);
  });
});

describe("OU2 resets", () => {
  it("a domain change clears the old domain's HTTPS state", async () => {
    const prisma = makePrisma(); seed(prisma);
    const row = prisma.storefrontSetting.rows[0];
    row.domainVerifiedAt = new Date();
    row.customHostnameId = "ch-1";
    row.httpsStatus = "active";
    const { svc } = makeSvc(prisma);
    await svc.setCustomDomain("org-1", "user-1", "other.example.com");
    expect(row.customHostnameId).toBeNull();
    expect(row.httpsStatus).toBeNull();
    expect(row.httpsStatusDetail).toBeNull();
    expect(row.httpsUpdatedAt).toBeNull();
  });
});
