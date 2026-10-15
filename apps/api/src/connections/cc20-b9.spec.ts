/**
 * CC20 (B9) — Smart Setup Assistant + Google pack, proven with
 * fake Prisma + stubbed boundaries (the codebase's spec style):
 *
 * Assistant — every rule fires AND does not fire on fixtures;
 * findings carry real-row evidence; a dismissal hides the
 * finding for the DISMISSING user only; an unknown key is
 * refused. The overview is stubbed (CC1 specs own it) — the
 * assistant's own tables are real fake-Prisma rows.
 *
 * Google pack — connect URL shape (derived per-flow redirect,
 * kind scope, offline+consent); callback zero accounts →
 * honest error + NOTHING stored; one account → Integration +
 * sealed credential; many → pick state: wrong id refused,
 * picked id stored, replay refused; no-refresh-token refused;
 * state single-use + expiry; Doctor list refreshes an expired
 * token. The Google client is stubbed — no real Google call is
 * claimed anywhere in this file.
 */

import { GoogleConnectService, GOOGLE_KIND_META } from "./google-connect.service";
import { SetupAssistantService } from "./setup-assistant.service";
import { decryptJson } from "../integrations/crypto";
import { setPlatformConfigSnapshot } from "../common/platform-config";

const ORG = "org-1";
const USER = "user-1";

const SAVED_ENV = { ...process.env };
beforeAll(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.API_PUBLIC_URL;
  delete process.env.WEB_URL;
});
afterAll(() => { process.env = { ...SAVED_ENV }; });

type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const nested = Object.values(v as any).every((nv) => matches(row, { [k]: nv }) || row[k] === nv);
      if ("gt" in v) return row[k] != null && new Date(row[k]).getTime() > new Date((v as any).gt).getTime();
      return nested;
    }
    return row[k] === v;
  });
}

function table(store: Row[]) {
  return {
    findMany: jest.fn(async (args: any = {}) => store.filter((r) => matches(r, args.where)).map((r) => ({ ...r }))),
    findUnique: jest.fn(async (args: any = {}) => {
      const w = args.where ?? {};
      // compound unique for dismissals
      const flat = w.organizationId_userId_findingKey ?? w;
      const row = store.find((r) => matches(r, flat));
      return row ? { ...row } : null;
    }),
    findFirst: jest.fn(async (args: any = {}) => {
      const row = store.find((r) => matches(r, args.where));
      return row ? { ...row } : null;
    }),
    count: jest.fn(async (args: any = {}) => store.filter((r) => matches(r, args.where)).length),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: data.id ?? `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      store.push(row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const flat = where?.organizationId_userId_findingKey ?? where;
      const row = store.find((r) => matches(r, flat));
      if (row) Object.assign(row, data);
      return row ? { ...row } : null;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const row of store) if (matches(row, where)) { Object.assign(row, data); count++; }
      return { count };
    }),
    deleteMany: jest.fn(async ({ where }: any = {}) => {
      const before = store.length;
      for (let i = store.length - 1; i >= 0; i--) if (matches(store[i], where)) store.splice(i, 1);
      return { count: before - store.length };
    }),
    upsert: jest.fn(async ({ where, create }: any) => {
      const flat = where?.organizationId_userId_findingKey ?? where;
      const existing = store.find((r) => matches(r, flat));
      if (existing) return { ...existing };
      const row = { id: `row-${store.length + 1}`, createdAt: new Date(), ...create };
      store.push(row);
      return { ...row };
    }),
  };
}

function fakeDb() {
  const db: any = {
    integrations: [] as Row[], credentials: [] as Row[], oauthStates: [] as Row[],
    gateways: [] as Row[], enablements: [] as Row[], templates: [] as Row[],
    shipments: [] as Row[], dismissals: [] as Row[],
    businessProfileRow: null as Row | null, orgLlmRow: null as Row | null,
  };
  db.integration = table(db.integrations);
  db.integrationCredential = table(db.credentials);
  db.socialOAuthState = table(db.oauthStates);
  db.tenantPaymentGateway = table(db.gateways);
  db.platformPaymentEnablement = table(db.enablements);
  db.whatsAppTemplate = table(db.templates);
  db.courierShipment = table(db.shipments);
  db.setupFindingDismissal = table(db.dismissals);
  db.businessProfile = { findUnique: jest.fn(async () => db.businessProfileRow) };
  db.orgLlmConfig = { findUnique: jest.fn(async () => db.orgLlmRow) };
  return db;
}

const auditStub: any = { log: jest.fn(async () => undefined) };

// ---------------- assistant fixtures ----------------

function overviewWith(accounts: Row[], aiStatus = "not_configured") {
  return {
    categories: [
      { key: "ai", status: aiStatus, accounts: accounts.filter((a) => a.category === "ai") },
      { key: "all", status: "connected", accounts },
    ],
  };
}
const acct = (partial: Row): Row => ({
  source: "integration", provider: "whatsapp", status: "CONNECTED",
  externalAccountId: null, displayName: "X", ...partial,
});

function assistant(db: any, overview: any, offered: Record<string, boolean> = { sslcommerz: true, bkash: true }) {
  const connections: any = { getOverview: jest.fn(async () => overview) };
  const wallet: any = {
    platformProviders: () => Object.entries(offered).map(([provider, o]) => ({ provider, offered: o })),
  };
  return new SetupAssistantService(db, connections, wallet);
}

const keys = (findings: any[]) => findings.map((f) => f.key);

describe("CC20 Smart Setup Assistant", () => {
  it("empty org → no findings (the 'সব ঠিক আছে' state)", async () => {
    const db = fakeDb();
    const svc = assistant(db, overviewWith([]));
    expect((await svc.getFindings(ORG, USER)).findings).toEqual([]);
  });

  it("WhatsApp connected + zero APPROVED templates fires; an APPROVED one silences it", async () => {
    const db = fakeDb();
    db.templates.push({ organizationId: ORG, status: "PENDING" }, { organizationId: ORG, status: "REJECTED" });
    const overview = overviewWith([acct({ provider: "whatsapp" })]);
    const fired = await assistant(db, overview).getFindings(ORG, USER);
    expect(keys(fired.findings)).toContain("whatsapp_no_approved_template");
    const f = fired.findings.find((x: any) => x.key === "whatsapp_no_approved_template")!;
    expect(f.severity).toBe("blocker");
    expect(f.evidence).toContain("মোট টেমপ্লেট রেকর্ড: 2টি");

    db.templates.push({ organizationId: ORG, status: "APPROVED" });
    const silenced = await assistant(db, overview).getFindings(ORG, USER);
    expect(keys(silenced.findings)).not.toContain("whatsapp_no_approved_template");
  });

  it("WhatsApp NOT connected → the template rule cannot fire", async () => {
    const db = fakeDb();
    const svc = assistant(db, overviewWith([]));
    expect(keys((await svc.getFindings(ORG, USER)).findings)).not.toContain("whatsapp_no_approved_template");
  });

  it("Meta Page mismatch fires per unmatched Page id; a matching Messenger channel silences it", async () => {
    const db = fakeDb();
    const page = acct({ source: "social_account", provider: "meta_page", externalAccountId: "page-9", displayName: "My Shop" });
    const fired = await assistant(db, overviewWith([page])).getFindings(ORG, USER);
    expect(keys(fired.findings)).toContain("meta_page_without_messaging:page-9");
    const f = fired.findings.find((x: any) => x.key.startsWith("meta_page_without"))!;
    expect(f.evidence).toContain("page-9");

    const matched = overviewWith([page, acct({ provider: "messenger", externalAccountId: "page-9" })]);
    const silenced = await assistant(db, matched).getFindings(ORG, USER);
    expect(keys(silenced.findings).some((k: string) => k.startsWith("meta_page_without"))).toBe(false);
    expect(keys(silenced.findings).some((k: string) => k.startsWith("messaging_page_without"))).toBe(false);
  });

  it("Messenger channel without the social Page fires the vice-versa rule", async () => {
    const db = fakeDb();
    const overview = overviewWith([acct({ provider: "messenger", externalAccountId: "page-7" })]);
    const { findings } = await assistant(db, overview).getFindings(ORG, USER);
    expect(keys(findings)).toContain("messaging_page_without_social:page-7");
  });

  it("store without courier fires; a connected courier silences it", async () => {
    const db = fakeDb();
    const store = acct({ source: "store", provider: "woocommerce", status: "ACTIVE" });
    const fired = await assistant(db, overviewWith([store])).getFindings(ORG, USER);
    expect(keys(fired.findings)).toContain("store_without_courier");
    const withCourier = overviewWith([store, acct({ provider: "steadfast" })]);
    const silenced = await assistant(db, withCourier).getFindings(ORG, USER);
    expect(keys(silenced.findings)).not.toContain("store_without_courier");
  });

  it("store without any payment path fires; each real path silences it", async () => {
    const store = acct({ source: "store", provider: "shopify", status: "ACTIVE" });
    const firedDb = fakeDb();
    expect(keys((await assistant(firedDb, overviewWith([store])).getFindings(ORG, USER)).findings)).toContain("store_without_payment_path");

    const gwDb = fakeDb();
    gwDb.gateways.push({ organizationId: ORG, provider: "sslcommerz", status: "configured", environment: "live", isEnabled: true });
    expect(keys((await assistant(gwDb, overviewWith([store])).getFindings(ORG, USER)).findings)).not.toContain("store_without_payment_path");

    const enDb = fakeDb();
    enDb.enablements.push({ organizationId: ORG, provider: "bkash", isEnabled: true });
    expect(keys((await assistant(enDb, overviewWith([store])).getFindings(ORG, USER)).findings)).not.toContain("store_without_payment_path");

    const manualDb = fakeDb();
    manualDb.businessProfileRow = { organizationId: ORG, bkashNumber: "01700000000", nagadNumber: null, codAvailable: false };
    expect(keys((await assistant(manualDb, overviewWith([store])).getFindings(ORG, USER)).findings)).not.toContain("store_without_payment_path");

    // a SANDBOX-only own gateway is NOT a production payment path
    const sandboxDb = fakeDb();
    sandboxDb.gateways.push({ organizationId: ORG, provider: "bkash", status: "verified", environment: "sandbox", isEnabled: true });
    expect(keys((await assistant(sandboxDb, overviewWith([store])).getFindings(ORG, USER)).findings)).toContain("store_without_payment_path");
  });

  it("platform gateway enabled but not platform-configured fires; configured silences it", async () => {
    const db = fakeDb();
    db.enablements.push({ organizationId: ORG, provider: "bkash", isEnabled: true });
    const fired = await assistant(db, overviewWith([]), { sslcommerz: true, bkash: false }).getFindings(ORG, USER);
    expect(keys(fired.findings)).toContain("platform_gateway_not_configured:bkash");
    const silenced = await assistant(db, overviewWith([]), { sslcommerz: true, bkash: true }).getFindings(ORG, USER);
    expect(keys(silenced.findings).some((k: string) => k.startsWith("platform_gateway_not_configured"))).toBe(false);
  });

  it("bKash 'configured' fires (per environment); 'verified' and SSLCommerz-configured never do", async () => {
    const db = fakeDb();
    db.gateways.push(
      { organizationId: ORG, provider: "bkash", status: "configured", environment: "live", isEnabled: true },
      { organizationId: ORG, provider: "bkash", status: "verified", environment: "sandbox", isEnabled: true },
      { organizationId: ORG, provider: "sslcommerz", status: "configured", environment: "live", isEnabled: true },
    );
    const { findings } = await assistant(db, overviewWith([])).getFindings(ORG, USER);
    expect(keys(findings)).toContain("bkash_gateway_unverified:live");
    expect(keys(findings)).not.toContain("bkash_gateway_unverified:sandbox");
    expect(findings.find((f: any) => f.key.startsWith("bkash_gateway"))!.evidence).toContain("(live)");
  });

  it("courier connected but zero shipments fires; one shipment silences it", async () => {
    const db = fakeDb();
    const overview = overviewWith([acct({ provider: "pathao" })]);
    expect(keys((await assistant(db, overview).getFindings(ORG, USER)).findings)).toContain("courier_never_used");
    db.shipments.push({ organizationId: ORG });
    expect(keys((await assistant(db, overview).getFindings(ORG, USER)).findings)).not.toContain("courier_never_used");
  });

  it("LLM platform fallback is info-only and needs the platform_managed state + no own config", async () => {
    const db = fakeDb();
    const fired = await assistant(db, overviewWith([], "platform_managed")).getFindings(ORG, USER);
    const f = fired.findings.find((x: any) => x.key === "llm_platform_fallback");
    expect(f?.severity).toBe("info");
    // own config present → no fallback note
    db.orgLlmRow = { organizationId: ORG, isEnabled: true };
    const silenced = await assistant(db, overviewWith([], "platform_managed")).getFindings(ORG, USER);
    expect(keys(silenced.findings)).not.toContain("llm_platform_fallback");
    // no platform LLM either → not this rule's claim
    const noPlatform = await assistant(fakeDb(), overviewWith([], "not_configured")).getFindings(ORG, USER);
    expect(keys(noPlatform.findings)).not.toContain("llm_platform_fallback");
  });

  it("dismissals hide the finding for the dismissing user only; unknown keys are refused", async () => {
    const db = fakeDb();
    const overview = overviewWith([acct({ source: "store", provider: "woocommerce", status: "ACTIVE" })]);
    const svc = assistant(db, overview);
    await svc.dismiss(ORG, USER, "store_without_courier");
    expect(keys((await svc.getFindings(ORG, USER)).findings)).not.toContain("store_without_courier");
    expect(keys((await svc.getFindings(ORG, "user-2")).findings)).toContain("store_without_courier");
    await expect(svc.dismiss(ORG, USER, "made_up_key")).rejects.toThrow();
  });

  it("severity order: blockers before improvements before info", async () => {
    const db = fakeDb();
    db.enablements.push({ organizationId: ORG, provider: "bkash", isEnabled: true });
    const overview = overviewWith([acct({ source: "store", provider: "woocommerce", status: "ACTIVE" })], "platform_managed");
    const { findings } = await assistant(db, overview, { bkash: false, sslcommerz: false }).getFindings(ORG, USER);
    const sevs = findings.map((f: any) => f.severity);
    expect(sevs.indexOf("info")).toBe(sevs.length - 1);
    expect(sevs[0]).toBe("blocker");
  });
});

// ---------------- Google pack ----------------

function googleSnapshot() {
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null, sslcommerz: null, bkash: null,
    image: null, tiktokApp: null, wallet: null, linkedinApp: null,
    googleApp: { clientId: "gg-id", clientSecret: "gg-secret" }, loadedAt: Date.now(),
  } as any);
}

function stubGoogleClient(overrides: Record<string, any> = {}) {
  return {
    exchangeCode: jest.fn(async () => ({ accessToken: "at-1", refreshToken: "rt-1", expiresAt: Date.now() + 3600_000, scope: "s" })),
    refreshAccessToken: jest.fn(async () => ({ accessToken: "at-2", expiresAt: Date.now() + 3600_000 })),
    listForKind: jest.fn(async () => [{ id: "123456", name: "Property One", detail: "Account A" }]),
    ...overrides,
  };
}

describe("CC20 Google pack", () => {
  beforeEach(googleSnapshot);

  it("connect-url: derived per-flow redirect + kind scope + offline/consent + state row", async () => {
    const db = fakeDb();
    const svc = new GoogleConnectService(db, auditStub, stubGoogleClient() as any);
    const { url } = await svc.connectUrl(ORG, USER, "ga4");
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("scope")).toBe(GOOGLE_KIND_META.ga4.scope);
    expect(u.searchParams.get("redirect_uri")).toContain("/social/oauth/google-ga4/callback");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(db.oauthStates).toHaveLength(1);
    expect(db.oauthStates[0].platform).toBe("google_analytics");
    await expect(svc.connectUrl(ORG, USER, "bogus")).rejects.toThrow();
  });

  it("connect-url without a platform Google app → honest refusal, no state", async () => {
    setPlatformConfigSnapshot({
      llm: null, metaApp: null, smtp: null, sms: null, sslcommerz: null, bkash: null,
      image: null, tiktokApp: null, wallet: null, linkedinApp: null, googleApp: null, loadedAt: Date.now(),
    } as any);
    const db = fakeDb();
    const svc = new GoogleConnectService(db, auditStub, stubGoogleClient() as any);
    await expect(svc.connectUrl(ORG, USER, "ga4")).rejects.toThrow(/configure করা হয়নি/);
    expect(db.oauthStates).toHaveLength(0);
  });

  async function beginConnect(db: any, svc: GoogleConnectService, kind = "ga4") {
    await svc.connectUrl(ORG, USER, kind);
    return db.oauthStates[db.oauthStates.length - 1].id as string;
  }

  it("callback with ZERO properties → honest error, NOTHING stored", async () => {
    const db = fakeDb();
    const svc = new GoogleConnectService(db, auditStub, stubGoogleClient({ listForKind: jest.fn(async () => []) }) as any);
    const state = await beginConnect(db, svc);
    const result = await svc.handleCallback("ga4", { code: "c1", state });
    expect(result.error).toContain("কিছু সেভ করা হয়নি");
    expect(db.integrations).toHaveLength(0);
    expect(db.credentials).toHaveLength(0);
  });

  it("callback with ONE property → Integration + sealed credential stored", async () => {
    const db = fakeDb();
    const svc = new GoogleConnectService(db, auditStub, stubGoogleClient() as any);
    const state = await beginConnect(db, svc);
    const result = await svc.handleCallback("ga4", { code: "c1", state });
    expect(result.connected).toBe(true);
    expect(db.integrations).toHaveLength(1);
    expect(db.integrations[0]).toMatchObject({ provider: "google_analytics", externalAccountId: "123456", status: "CONNECTED" });
    const cred = decryptJson(db.credentials[0].encryptedData) as any;
    expect(cred.accessToken).toBe("at-1");
    expect(cred.refreshToken).toBe("rt-1");
    expect(JSON.stringify(db.credentials[0])).not.toContain("at-1");
  });

  it("callback without a refresh token → refused, nothing stored", async () => {
    const db = fakeDb();
    const client = stubGoogleClient({ exchangeCode: jest.fn(async () => ({ accessToken: "at-x", expiresAt: Date.now() + 1000 })) });
    const svc = new GoogleConnectService(db, auditStub, client as any);
    const state = await beginConnect(db, svc);
    const result = await svc.handleCallback("ga4", { code: "c1", state });
    expect(result.error).toContain("refresh token");
    expect(db.integrations).toHaveLength(0);
  });

  it("callback state is single-use: a replayed callback errors and stores nothing new", async () => {
    const db = fakeDb();
    const svc = new GoogleConnectService(db, auditStub, stubGoogleClient() as any);
    const state = await beginConnect(db, svc);
    await svc.handleCallback("ga4", { code: "c1", state });
    const replay = await svc.handleCallback("ga4", { code: "c1", state });
    expect(replay.error).toBeTruthy();
    expect(db.integrations).toHaveLength(1);
  });

  it("expired connect state → honest error, nothing stored", async () => {
    const db = fakeDb();
    const svc = new GoogleConnectService(db, auditStub, stubGoogleClient() as any);
    const state = await beginConnect(db, svc);
    db.oauthStates[0].expiresAt = new Date(Date.now() - 1000);
    const result = await svc.handleCallback("ga4", { code: "c1", state });
    expect(result.error).toBeTruthy();
    expect(db.integrations).toHaveLength(0);
  });

  it("multi-property callback → pick state; wrong id refused; picked id stored; replay refused", async () => {
    const db = fakeDb();
    const client = stubGoogleClient({
      listForKind: jest.fn(async () => [
        { id: "111", name: "Prop A", detail: null },
        { id: "222", name: "Prop B", detail: null },
      ]),
    });
    const svc = new GoogleConnectService(db, auditStub, client as any);
    const state = await beginConnect(db, svc);
    const result = await svc.handleCallback("ga4", { code: "c1", state });
    expect(result.pickState).toBeTruthy();
    expect(db.integrations).toHaveLength(0);

    const info = await svc.getPickInfo(ORG, USER, result.pickState!);
    expect(info.options.map((o: any) => o.id)).toEqual(["111", "222"]);
    // another user may not even read the pick state
    await expect(svc.getPickInfo(ORG, "user-2", result.pickState!)).rejects.toThrow();

    await expect(svc.select(ORG, USER, "ga4", result.pickState!, "999")).rejects.toThrow();
    const done = await svc.select(ORG, USER, "ga4", result.pickState!, "222");
    expect(done).toMatchObject({ connected: true, externalAccountId: "222" });
    expect(db.integrations).toHaveLength(1);
    expect(db.integrations[0].externalAccountId).toBe("222");
    await expect(svc.select(ORG, USER, "ga4", result.pickState!, "111")).rejects.toThrow();
  });

  it("merchant kind stores provider google_merchant", async () => {
    const db = fakeDb();
    const svc = new GoogleConnectService(db, auditStub, stubGoogleClient() as any);
    const state = await beginConnect(db, svc, "merchant");
    const result = await svc.handleCallback("merchant", { code: "c1", state });
    expect(result.connected).toBe(true);
    expect(db.integrations[0].provider).toBe("google_merchant");
  });

  it("doctorList refreshes an expired stored token and returns the real count", async () => {
    const db = fakeDb();
    const client = stubGoogleClient();
    const svc = new GoogleConnectService(db, auditStub, client as any);
    const state = await beginConnect(db, svc);
    await svc.handleCallback("ga4", { code: "c1", state });
    // age the stored token past expiry
    const credRow = db.credentials[0];
    const cred = decryptJson(credRow.encryptedData) as any;
    const { encryptJson } = await import("../integrations/crypto");
    credRow.encryptedData = encryptJson({ ...cred, expiresAt: Date.now() - 5000 });
    const out = await svc.doctorList("ga4", { id: db.integrations[0].id, organizationId: ORG });
    expect(client.refreshAccessToken).toHaveBeenCalled();
    expect(out.count).toBe(1);
    const rotated = decryptJson(db.credentials[0].encryptedData) as any;
    expect(rotated.accessToken).toBe("at-2");
    expect(rotated.refreshToken).toBe("rt-1");
  });
});
