process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "cc28-spec-secret";
process.env.API_PUBLIC_URL = "https://api.example.test";

import { BadRequestException } from "@nestjs/common";
import { ConnectionsService } from "./connections.service";
import { GoogleConnectService } from "./google-connect.service";
import { SocialOAuthService } from "../social/social-oauth.service";
import { SocialService } from "../social/social.service";
import { AdsService } from "../ads/ads.service";
import { MetaClient } from "../ads/meta/meta.client";
import { setPlatformConfigSnapshot } from "../common/platform-config";
import { decryptJson, encryptJson } from "../integrations/crypto";

/**
 * CC28 (Connect Center Next) — own-app completion.
 *
 * Pins:
 *  - TenantAppConfig google + linkedin: format/presence honesty
 *    ("configured", verified_at_first_connect), the redirect
 *    URIs returned for registration, and the own-app guides;
 *  - Meta app-secret ROTATION: same appId + new secret verifies,
 *    replaces ONLY the sealed secret, audits
 *    app_config.secret_rotated, and touches NO connection row;
 *    a bad new secret saves nothing;
 *  - Google pack + YouTube + LinkedIn: appSource is bound into
 *    the OAuth state, the callback exchanges with the chosen
 *    app, the account records appSource, and refresh resolves
 *    by it; platform-app flows are byte-identical regressions;
 *  - token-paste Meta connects (social + ads) accept appSource,
 *    require the tenant config for "own", and persist it.
 */

const ORG = "org-cc28";
const USER = "user-1";

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) {
        const n = (v as any).not;
        if (n === null) { if (row[k] === null || row[k] === undefined) return false; }
        else if (row[k] === n) return false;
      }
      if ("in" in v && !(v as any).in.includes(row[k])) return false;
      if ("lte" in v && !(new Date(row[k]).getTime() <= new Date((v as any).lte).getTime())) return false;
      if ("lt" in v && !(new Date(row[k]).getTime() < new Date((v as any).lt).getTime())) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}

/** Flatten a Prisma compound-unique where ({ a_b: { a, b } }). */
function flatWhere(where: any): any {
  const keys = Object.keys(where ?? {});
  if (keys.length === 1) {
    const v = where[keys[0]];
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !("in" in v) && !("not" in v) && !("lte" in v) && !("lt" in v)) return v;
  }
  return where;
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where, orderBy }: any = {}) => {
      const out = rows.filter((r) => matches(r, flatWhere(where ?? {})));
      if (orderBy?.createdAt === "desc") out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (orderBy?.createdAt === "asc") out.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return out[0] ?? null;
    },
    findMany: async ({ where, take }: any = {}) => {
      const out = rows.filter((r) => matches(r, flatWhere(where ?? {})));
      return take ? out.slice(0, take) : out;
    },
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, flatWhere(where ?? {}))) ?? null,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, flatWhere(where ?? {})));
      if (row) { Object.assign(row, data); row.updatedAt = new Date(); }
      return row ?? null;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows) if (matches(row, flatWhere(where ?? {}))) { Object.assign(row, data); count++; }
      return { count };
    },
    upsert: async ({ where, create, update }: any) => {
      const existing = rows.find((r) => matches(r, flatWhere(where ?? {})));
      if (existing) { Object.assign(existing, update); return existing; }
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(row);
      return row;
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => matches(r, flatWhere(where ?? {})));
      if (i >= 0) rows.splice(i, 1);
      return {};
    },
    deleteMany: async ({ where }: any = {}) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], flatWhere(where ?? {}))) { rows.splice(i, 1); count++; }
      return { count };
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, flatWhere(where ?? {}))).length,
  };
}

function makeDb(names: string[]) {
  const db: any = {};
  for (const n of names) db[n] = makeTable(n);
  return db;
}

function makeAudit() {
  const entries: any[] = [];
  return { entries, audit: { log: jest.fn(async (input: any) => { entries.push(input); }) } };
}

function tenantAppRow(platform: string, appId: string, appSecret: string) {
  return {
    id: `tac-${platform}`, organizationId: ORG, platform, appId,
    encryptedSecret: encryptJson({ appSecret }), status: "configured",
    lastVerifiedAt: null, lastError: null, createdAt: new Date(), updatedAt: new Date(),
  };
}

function platformSnapshot(over: Record<string, any> = {}) {
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null, sslcommerz: null, bkash: null,
    image: null, tiktokApp: null, wallet: null, linkedinApp: null, googleApp: null,
    loadedAt: Date.now(), ...over,
  } as any);
}

describe("CC28 app configs — google + linkedin honesty", () => {
  function build() {
    const db = makeDb(["tenantAppConfig"]);
    const { audit, entries } = makeAudit();
    const meta = { verifyApp: jest.fn(async (appId: string) => ({ id: appId, name: "App" })) };
    const svc = new ConnectionsService(db as any, audit as any, meta as any);
    return { db, svc, entries, meta };
  }

  it("google: a client id that is not a Google OAuth client id is refused, nothing saved", async () => {
    const { db, svc } = build();
    await expect(svc.putAppConfig(ORG, USER, "google", { appId: "12345-not-a-client", appSecret: "s" }))
      .rejects.toThrow(/apps\.googleusercontent\.com/);
    expect(db.tenantAppConfig.rows).toHaveLength(0);
  });

  it("google: valid format saves as 'configured' (verified at first connect) and returns the redirect URIs to register", async () => {
    const { svc } = build();
    const view: any = await svc.putAppConfig(ORG, USER, "google", { appId: "123-abc.apps.googleusercontent.com", appSecret: "g-secret" });
    expect(view.status).toBe("configured");
    expect(view.verificationNote).toBe("verified_at_first_connect");
    expect(view.redirectUris).toEqual([
      "https://api.example.test/social/oauth/youtube/callback",
      "https://api.example.test/social/oauth/google-ga4/callback",
      "https://api.example.test/social/oauth/google-merchant/callback",
      "https://api.example.test/social/oauth/google-business/callback",
    ]);
  });

  it("linkedin: presence-only save as 'configured' with its callback URL to register", async () => {
    const { svc } = build();
    const view: any = await svc.putAppConfig(ORG, USER, "linkedin", { appId: "li-client-1", appSecret: "li-secret" });
    expect(view.status).toBe("configured");
    expect(view.verificationNote).toBe("verified_at_first_connect");
    expect(view.redirectUris).toEqual(["https://api.example.test/social/oauth/linkedin/callback"]);
  });

  it("listAppConfigs carries the own-app guides even before any config exists", async () => {
    const { svc } = build();
    const out: any = await svc.listAppConfigs(ORG);
    expect(out.configs).toEqual([]);
    expect(out.ownAppGuides.google.redirectUris).toHaveLength(4);
    expect(out.ownAppGuides.linkedin.redirectUris).toEqual(["https://api.example.test/social/oauth/linkedin/callback"]);
  });

  it("an unknown platform is still refused", async () => {
    const { svc } = build();
    await expect(svc.putAppConfig(ORG, USER, "snapchat", { appId: "x", appSecret: "y" })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("CC28 Meta app-secret rotation", () => {
  function build(verifyImpl?: (appId: string, secret: string) => Promise<any>) {
    const db = makeDb(["tenantAppConfig", "integration", "socialAccount"]);
    const { audit, entries } = makeAudit();
    const meta = { verifyApp: jest.fn(verifyImpl ?? (async (appId: string) => ({ id: appId, name: "App" }))) };
    const svc = new ConnectionsService(db as any, audit as any, meta as any);
    return { db, svc, entries, meta };
  }

  it("same appId + NEW secret = rotation: verified, only the sealed secret changes, distinct audit, NO connection row touched", async () => {
    const { db, svc, entries } = build();
    await svc.putAppConfig(ORG, USER, "meta", { appId: "meta-app-1", appSecret: "secret-OLD" });
    // A live connection made under this app (its rows must not move).
    db.integration.rows.push({ id: "int-1", organizationId: ORG, provider: "meta_social", status: "CONNECTED", externalAccountId: "page-1", appSource: "own" });
    db.socialAccount.rows.push({ id: "sa-1", organizationId: ORG, platform: "meta_page", externalId: "page-1", integrationId: "int-1", appSource: "own", status: "connected" });
    const integrationsBefore = JSON.parse(JSON.stringify(db.integration.rows));
    const accountsBefore = JSON.parse(JSON.stringify(db.socialAccount.rows));

    const view: any = await svc.putAppConfig(ORG, USER, "meta", { appId: "meta-app-1", appSecret: "secret-NEW" });
    expect(view.rotated).toBe(true);
    const row = db.tenantAppConfig.rows[0];
    expect(decryptJson(row.encryptedSecret)).toEqual({ appSecret: "secret-NEW" });
    expect(entries.some((e: any) => e.action === "app_config.secret_rotated")).toBe(true);
    expect(JSON.parse(JSON.stringify(db.integration.rows))).toEqual(integrationsBefore);
    expect(JSON.parse(JSON.stringify(db.socialAccount.rows))).toEqual(accountsBefore);
  });

  it("a BAD new secret saves nothing (the old secret survives) — rotation is verify-before-save like any save", async () => {
    const { db, svc } = build(async (appId: string, secret: string) => {
      if (secret === "secret-BAD") throw new Error("Invalid OAuth access token - cannot parse access token");
      return { id: appId, name: "App" };
    });
    await svc.putAppConfig(ORG, USER, "meta", { appId: "meta-app-1", appSecret: "secret-OLD" });
    await expect(svc.putAppConfig(ORG, USER, "meta", { appId: "meta-app-1", appSecret: "secret-BAD" })).rejects.toThrow(/Invalid OAuth/);
    expect(decryptJson(db.tenantAppConfig.rows[0].encryptedSecret)).toEqual({ appSecret: "secret-OLD" });
  });

  it("re-saving the SAME secret is not a rotation; a DIFFERENT appId is not a rotation", async () => {
    const { svc, entries } = build();
    await svc.putAppConfig(ORG, USER, "meta", { appId: "meta-app-1", appSecret: "secret-1" });
    const again: any = await svc.putAppConfig(ORG, USER, "meta", { appId: "meta-app-1", appSecret: "secret-1" });
    expect(again.rotated).toBeUndefined();
    const other: any = await svc.putAppConfig(ORG, USER, "meta", { appId: "meta-app-2", appSecret: "secret-2" });
    expect(other.rotated).toBeUndefined();
    expect(entries.filter((e: any) => e.action === "app_config.secret_rotated")).toHaveLength(0);
  });
});

describe("CC28 Google pack — appSource end to end", () => {
  function stubGoogle(over: Record<string, any> = {}) {
    return {
      exchangeCode: jest.fn(async () => ({ accessToken: "at-1", refreshToken: "rt-1", expiresAt: Date.now() + 3600_000, scope: "s" })),
      refreshAccessToken: jest.fn(async () => ({ accessToken: "at-2", expiresAt: Date.now() + 3600_000 })),
      listForKind: jest.fn(async () => [{ id: "prop-1", name: "Property One", detail: "Account A" }]),
      ...over,
    };
  }
  function build(withOwn: boolean) {
    const db = makeDb(["socialOAuthState", "tenantAppConfig", "integration", "integrationCredential"]);
    if (withOwn) db.tenantAppConfig.rows.push(tenantAppRow("google", "tenant-g.apps.googleusercontent.com", "tenant-g-secret"));
    const { audit } = makeAudit();
    const client = stubGoogle();
    const svc = new GoogleConnectService(db as any, audit as any, client as any);
    return { db, svc, client };
  }

  it("own: connect-url uses the TENANT client id and binds appSource into the state; the callback persists appSource=own", async () => {
    platformSnapshot(); // platform googleApp deliberately unset — own must not need it
    const { db, svc, client } = build(true);
    const { url } = await svc.connectUrl(ORG, USER, "ga4", "own");
    const u = new URL(url);
    expect(u.searchParams.get("client_id")).toBe("tenant-g.apps.googleusercontent.com");
    const state = u.searchParams.get("state")!;
    expect(db.socialOAuthState.rows[0].payload).toMatchObject({ appSource: "own" });
    const res: any = await svc.handleCallback("ga4", { code: "code-1", state });
    expect(res.connected).toBe(true);
    expect(client.exchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "tenant-g.apps.googleusercontent.com", clientSecret: "tenant-g-secret" }), "code-1");
    expect(db.integration.rows[0].appSource).toBe("own");
    expect(db.integration.rows[0].provider).toBe("google_analytics");
  });

  it("own without a saved tenant Google app → the honest refusal, no state minted", async () => {
    platformSnapshot();
    const { db, svc } = build(false);
    await expect(svc.connectUrl(ORG, USER, "ga4", "own")).rejects.toThrow(/নিজের Google App এখনো সেভ করা হয়নি/);
    expect(db.socialOAuthState.rows).toHaveLength(0);
  });

  it("platform regression: default flow uses the platform client id and persists appSource=platform (CC20 behavior)", async () => {
    platformSnapshot({ googleApp: { clientId: "plat-g.apps.googleusercontent.com", clientSecret: "plat-secret" } });
    const { db, svc, client } = build(false);
    const { url } = await svc.connectUrl(ORG, USER, "ga4");
    const u = new URL(url);
    expect(u.searchParams.get("client_id")).toBe("plat-g.apps.googleusercontent.com");
    const res: any = await svc.handleCallback("ga4", { code: "code-9", state: u.searchParams.get("state")! });
    expect(res.connected).toBe(true);
    expect(client.exchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "plat-g.apps.googleusercontent.com", clientSecret: "plat-secret" }), "code-9");
    expect(db.integration.rows[0].appSource).toBe("platform");
  });

  it("freshAccessToken resolves the client by the INTEGRATION's appSource (own → tenant client; platform → platform client)", async () => {
    platformSnapshot({ googleApp: { clientId: "plat-g.apps.googleusercontent.com", clientSecret: "plat-secret" } });
    const { db, svc, client } = build(true);
    const expired = { accessToken: "old", refreshToken: "rt-1", expiresAt: Date.now() - 1000, scope: "s" };
    db.integration.rows.push(
      { id: "int-own", organizationId: ORG, provider: "google_analytics", status: "CONNECTED", externalAccountId: "prop-1", appSource: "own" },
      { id: "int-plat", organizationId: ORG, provider: "google_analytics", status: "CONNECTED", externalAccountId: "prop-2", appSource: "platform" },
    );
    db.integrationCredential.rows.push(
      { id: "cred-own", integrationId: "int-own", encryptedData: encryptJson(expired) },
      { id: "cred-plat", integrationId: "int-plat", encryptedData: encryptJson(expired) },
    );
    await svc.freshAccessToken({ id: "int-own", organizationId: ORG, appSource: "own" });
    expect(client.refreshAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "tenant-g.apps.googleusercontent.com", clientSecret: "tenant-g-secret" }), "rt-1");
    await svc.freshAccessToken({ id: "int-plat", organizationId: ORG, appSource: "platform" });
    expect(client.refreshAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "plat-g.apps.googleusercontent.com", clientSecret: "plat-secret" }), "rt-1");
  });
});

describe("CC28 YouTube + LinkedIn OAuth — appSource bound into state, refresh by appSource", () => {
  function stubYouTube() {
    return {
      exchangeCode: jest.fn(async () => ({ accessToken: "ya-1", refreshToken: "yr-1", expiresAt: Date.now() + 3600_000, scope: "s" })),
      listChannels: jest.fn(async () => [{ id: "chan-1", title: "Channel One", pictureUrl: null }]),
      refreshAccessToken: jest.fn(async () => ({ accessToken: "ya-2", expiresAt: Date.now() + 3600_000 })),
    };
  }
  function stubLinkedIn() {
    return {
      exchangeCode: jest.fn(async () => ({ accessToken: "la-1", refreshToken: "lr-1", expiresAt: Date.now() + 3600_000, scope: "s" })),
      listAdminOrganizations: jest.fn(async () => [{ id: "li-org-1", name: "Page One" }]),
      refreshAccessToken: jest.fn(async () => ({ accessToken: "la-2", expiresAt: Date.now() + 3600_000 })),
    };
  }
  function build(ownApps: string[] = []) {
    const db = makeDb(["socialOAuthState", "integration", "integrationCredential", "socialAccount", "tenantAppConfig"]);
    if (ownApps.includes("google")) db.tenantAppConfig.rows.push(tenantAppRow("google", "tenant-g.apps.googleusercontent.com", "tenant-g-secret"));
    if (ownApps.includes("linkedin")) db.tenantAppConfig.rows.push(tenantAppRow("linkedin", "tenant-li-id", "tenant-li-secret"));
    const { audit, entries } = makeAudit();
    const youtube = stubYouTube();
    const linkedin = stubLinkedIn();
    const svc = new SocialOAuthService(db as any, audit as any, undefined, youtube as any, linkedin as any);
    return { db, svc, youtube, linkedin, entries };
  }

  it("YouTube own: authorize URL carries the TENANT client id; the callback exchanges with it and persists appSource=own", async () => {
    platformSnapshot();
    const { db, svc, youtube } = build(["google"]);
    const { url } = await svc.youtubeConnectUrl(ORG, USER, "own");
    const u = new URL(url);
    expect(u.searchParams.get("client_id")).toBe("tenant-g.apps.googleusercontent.com");
    expect(u.searchParams.get("redirect_uri")).toBe("https://api.example.test/social/oauth/youtube/callback");
    const state = u.searchParams.get("state")!;
    expect(db.socialOAuthState.rows[0].payload).toMatchObject({ appSource: "own" });
    const redirect = await svc.handleYouTubeCallback({ code: "code-1", state });
    expect(redirect).toContain("social_connected=youtube");
    expect(youtube.exchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "tenant-g.apps.googleusercontent.com", clientSecret: "tenant-g-secret" }), "code-1");
    expect(db.socialAccount.rows[0].appSource).toBe("own");
    expect(db.integration.rows[0].appSource).toBe("own");
  });

  it("YouTube own without a saved tenant Google app → honest refusal", async () => {
    platformSnapshot();
    const { svc } = build([]);
    await expect(svc.youtubeConnectUrl(ORG, USER, "own")).rejects.toThrow(/নিজের Google অ্যাপ কনফিগার করা নেই/);
  });

  it("YouTube platform regression: platform client id, no state payload, appSource=platform persisted (SP9 behavior)", async () => {
    platformSnapshot({ googleApp: { clientId: "plat-g.apps.googleusercontent.com", clientSecret: "plat-secret" } });
    const { db, svc, youtube } = build([]);
    const { url } = await svc.youtubeConnectUrl(ORG, USER);
    const u = new URL(url);
    expect(u.searchParams.get("client_id")).toBe("plat-g.apps.googleusercontent.com");
    const state = u.searchParams.get("state")!;
    const redirect = await svc.handleYouTubeCallback({ code: "code-2", state });
    expect(redirect).toContain("social_connected=youtube");
    expect(youtube.exchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "plat-g.apps.googleusercontent.com", clientSecret: "plat-secret" }), "code-2");
    expect(db.socialAccount.rows[0].appSource).toBe("platform");
  });

  it("YouTube refresh: an own-app account refreshes against the TENANT app; a platform account against the platform app", async () => {
    platformSnapshot({ googleApp: { clientId: "plat-g.apps.googleusercontent.com", clientSecret: "plat-secret" } });
    const { db, svc, youtube } = build(["google"]);
    const cred = { accessToken: "old", refreshToken: "yr-1", expiresAt: Date.now() - 1000, channelId: "chan-1" };
    db.integration.rows.push(
      { id: "int-yt-own", organizationId: ORG, provider: "youtube_social", status: "CONNECTED", credential: { encryptedData: encryptJson(cred) } },
      { id: "int-yt-plat", organizationId: ORG, provider: "youtube_social", status: "CONNECTED", credential: { encryptedData: encryptJson(cred) } },
    );
    db.integrationCredential.rows.push(
      { id: "ic-own", integrationId: "int-yt-own", encryptedData: encryptJson(cred) },
      { id: "ic-plat", integrationId: "int-yt-plat", encryptedData: encryptJson(cred) },
    );
    const ownAccount = { id: "sa-own", platform: "youtube", appSource: "own", integrationId: "int-yt-own" };
    await expect(svc.ensureAccessToken(ORG, ownAccount)).resolves.toBe("ya-2");
    expect(youtube.refreshAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "tenant-g.apps.googleusercontent.com", clientSecret: "tenant-g-secret" }), "yr-1");
    const platAccount = { id: "sa-plat", platform: "youtube", appSource: "platform", integrationId: "int-yt-plat" };
    await expect(svc.ensureAccessToken(ORG, platAccount)).resolves.toBe("ya-2");
    expect(youtube.refreshAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "plat-g.apps.googleusercontent.com", clientSecret: "plat-secret" }), "yr-1");
  });

  it("LinkedIn own: authorize URL carries the TENANT client id; the callback persists appSource=own; refresh uses the tenant app", async () => {
    platformSnapshot();
    const { db, svc, linkedin } = build(["linkedin"]);
    const { url } = await svc.linkedinConnectUrl(ORG, USER, "own");
    const u = new URL(url);
    expect(u.searchParams.get("client_id")).toBe("tenant-li-id");
    expect(u.searchParams.get("redirect_uri")).toBe("https://api.example.test/social/oauth/linkedin/callback");
    const state = u.searchParams.get("state")!;
    const redirect = await svc.handleLinkedInCallback({ code: "code-li", state });
    expect(redirect).toContain("linkedin_connected=linkedin_page");
    expect(linkedin.exchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "tenant-li-id", clientSecret: "tenant-li-secret" }), "code-li");
    expect(db.socialAccount.rows[0].appSource).toBe("own");

    // refresh: expire the stored credential and run the token path
    const cred = { accessToken: "old", refreshToken: "lr-1", expiresAt: Date.now() - 1000, organizationId: "li-org-1" };
    const account = db.socialAccount.rows[0];
    db.integration.rows[0].credential = { encryptedData: encryptJson(cred) };
    db.integrationCredential.rows.push({ id: "ic-li", integrationId: db.integration.rows[0].id, encryptedData: encryptJson(cred) });
    await expect(svc.ensureAccessToken(ORG, { id: account.id, platform: "linkedin_page", appSource: "own", integrationId: db.integration.rows[0].id })).resolves.toBe("la-2");
    expect(linkedin.refreshAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "tenant-li-id", clientSecret: "tenant-li-secret" }), "lr-1");
  });

  it("LinkedIn own without a saved tenant LinkedIn app → honest refusal; platform regression persists appSource=platform", async () => {
    platformSnapshot({ linkedinApp: { clientId: "plat-li-id", clientSecret: "plat-li-secret" } });
    const { db, svc } = build([]);
    await expect(svc.linkedinConnectUrl(ORG, USER, "own")).rejects.toThrow(/নিজের LinkedIn অ্যাপ কনফিগার করা নেই/);
    const { url } = await svc.linkedinConnectUrl(ORG, USER);
    const state = new URL(url).searchParams.get("state")!;
    const redirect = await svc.handleLinkedInCallback({ code: "code-li2", state });
    expect(redirect).toContain("linkedin_connected=linkedin_page");
    expect(db.socialAccount.rows[0].appSource).toBe("platform");
  });
});

describe("CC28 token-paste Meta connects gain appSource", () => {
  it("social paste: 'own' without a tenant Meta config → refused, nothing stored; with config → appSource persisted on Integration + accounts; default → platform", async () => {
    const db = makeDb(["integration", "integrationCredential", "socialAccount", "tenantAppConfig"]);
    const { audit } = makeAudit();
    const svc = new SocialService(db as any, audit as any);
    (svc as any).verifyAndListPages = jest.fn(async () => [
      { pageId: "page-1", name: "Shop Page", pictureUrl: null, pageAccessToken: "ptok-1", instagram: null },
    ]);
    await expect(svc.connectMetaPages(ORG, USER, { accessToken: "tok-1234567890", pageIds: ["page-1"], appSource: "own" } as any))
      .rejects.toThrow(/নিজের Meta অ্যাপ কনফিগার করা নেই/);
    expect(db.integration.rows).toHaveLength(0);

    db.tenantAppConfig.rows.push(tenantAppRow("meta", "meta-app-1", "meta-secret"));
    const own: any = await svc.connectMetaPages(ORG, USER, { accessToken: "tok-1234567890", pageIds: ["page-1"], appSource: "own" } as any);
    expect(own.accounts).toHaveLength(1);
    expect(db.integration.rows[0].appSource).toBe("own");
    expect(db.socialAccount.rows[0].appSource).toBe("own");

    const db2 = makeDb(["integration", "integrationCredential", "socialAccount", "tenantAppConfig"]);
    const svc2 = new SocialService(db2 as any, audit as any);
    (svc2 as any).verifyAndListPages = (svc as any).verifyAndListPages;
    await svc2.connectMetaPages(ORG, USER, { accessToken: "tok-1234567890", pageIds: ["page-1"] } as any);
    expect(db2.integration.rows[0].appSource).toBe("platform");
    expect(db2.socialAccount.rows[0].appSource).toBe("platform");
  });

  it("ads paste: 'own' without a tenant Meta config → refused; with config → Integration records appSource=own; default → platform", async () => {
    const verifySpy = jest.spyOn(MetaClient.prototype, "verifyToken").mockResolvedValue({ id: "meta-user-1", name: "Owner" } as any);
    const listSpy = jest.spyOn(MetaClient.prototype, "listAdAccounts").mockResolvedValue([
      { externalId: "act_1", name: "Ads One", currency: "BDT", status: 1, timezone: "Asia/Dhaka" },
    ] as any);
    try {
      const db = makeDb(["integration", "integrationCredential", "adAccount", "tenantAppConfig", "socialAccount", "notification"]);
      const { audit } = makeAudit();
      const svc = new AdsService(db as any, audit as any);
      await expect(svc.connectMeta(ORG, USER, { accessToken: "tok-1234567890", appSource: "own" } as any))
        .rejects.toThrow(/নিজের Meta অ্যাপ কনফিগার করা নেই/);
      expect(db.integration.rows).toHaveLength(0);

      db.tenantAppConfig.rows.push(tenantAppRow("meta", "meta-app-1", "meta-secret"));
      await svc.connectMeta(ORG, USER, { accessToken: "tok-1234567890", appSource: "own" } as any);
      expect(db.integration.rows[0].appSource).toBe("own");

      const db2 = makeDb(["integration", "integrationCredential", "adAccount", "tenantAppConfig", "socialAccount", "notification"]);
      const svc2 = new AdsService(db2 as any, audit as any);
      await svc2.connectMeta(ORG, USER, { accessToken: "tok-1234567890" } as any);
      expect(db2.integration.rows[0].appSource).toBe("platform");
    } finally {
      verifySpy.mockRestore();
      listSpy.mockRestore();
    }
  });
});
