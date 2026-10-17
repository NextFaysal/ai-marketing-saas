process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { GoogleBusinessClient } from "./google-business.client";
import { GBP_CAPABILITIES, GBP_PLATFORM, GBP_PROVIDER } from "./social.constants";
import {
  effectiveGbpApiAccessApproved, refreshPlatformConfig, seal, setPlatformConfigSnapshot,
} from "../common/platform-config";

/**
 * OU9 — Google Business Profile, proven at stubbed boundaries
 * (no live call anywhere; Google's API-access approval does not
 * exist for this project, so live proof is impossible by
 * definition — see docs/one-umbrella-ou9-section.md):
 * - Registry: the platform/provider/scope constants + the
 *   truthful capability flags (reviews/inbox/insights false).
 * - Gate: effectiveGbpApiAccessApproved is false by default
 *   (no config, half config, undeclared flag) and true only on
 *   the operator's literal declaration (admin row or env).
 * - Client request shapes: account/location listing URLs +
 *   readMask, the composed v4 parent, and the LocalPost create
 *   body EXACTLY as documented (STANDARD topic, LEARN_MORE
 *   callToAction, one PHOTO media by sourceUrl); Google's error
 *   message propagates verbatim.
 */

const SAVED_ENV = { ...process.env };
afterAll(() => { process.env = { ...SAVED_ENV }; });
afterEach(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_GBP_API_ACCESS_APPROVED;
  setPlatformConfigSnapshot({ llm: null, metaApp: null, smtp: null, sms: null, loadedAt: 0 } as any);
});

describe("OU9 registry + capabilities", () => {
  it("registers the GBP platform + provider distinctly from the Connect Center provider", () => {
    expect(GBP_PLATFORM).toBe("google_business_profile");
    expect(GBP_PROVIDER).toBe("google_business_social");
    expect(GBP_PROVIDER).not.toBe("google_business");
  });

  it("capability flags claim only what OU9 ships", () => {
    expect(GBP_CAPABILITIES.localPostPublishing).toBe(true);
    expect(GBP_CAPABILITIES.locationSelection).toBe(true);
    expect(GBP_CAPABILITIES.reviews).toBe(false);
    expect(GBP_CAPABILITIES.reviewReplies).toBe(false);
    expect(GBP_CAPABILITIES.inbox).toBe(false);
    expect(GBP_CAPABILITIES.comments).toBe(false);
    expect(GBP_CAPABILITIES.insights).toBe(false);
  });
});

describe("OU9 GBP API-access gate (platform-config)", () => {
  it("defaults to NOT approved with no config at all", () => {
    setPlatformConfigSnapshot({ llm: null, metaApp: null, smtp: null, sms: null, loadedAt: Date.now() } as any);
    expect(effectiveGbpApiAccessApproved()).toBe(false);
  });

  it("a stored googleApp row WITHOUT the declaration reads as not approved", async () => {
    const prisma: any = {
      systemSetting: {
        findUnique: async ({ where }: any) => where.key === "googleAppConfig"
          ? { value: { clientId: "g-id", clientSecretEncrypted: seal("g-secret") } }
          : null,
      },
    };
    await refreshPlatformConfig(prisma);
    expect(effectiveGbpApiAccessApproved()).toBe(false);
  });

  it("a stored googleApp row WITH gbpApiAccessApproved:true reads as approved", async () => {
    const prisma: any = {
      systemSetting: {
        findUnique: async ({ where }: any) => where.key === "googleAppConfig"
          ? { value: { clientId: "g-id", clientSecretEncrypted: seal("g-secret"), gbpApiAccessApproved: true } }
          : null,
      },
    };
    await refreshPlatformConfig(prisma);
    expect(effectiveGbpApiAccessApproved()).toBe(true);
  });

  it("a non-literal-true stored value (string 'true') does NOT approve", async () => {
    const prisma: any = {
      systemSetting: {
        findUnique: async ({ where }: any) => where.key === "googleAppConfig"
          ? { value: { clientId: "g-id", clientSecretEncrypted: seal("g-secret"), gbpApiAccessApproved: "true" } }
          : null,
      },
    };
    await refreshPlatformConfig(prisma);
    expect(effectiveGbpApiAccessApproved()).toBe(false);
  });

  it("env fallback: GOOGLE_GBP_API_ACCESS_APPROVED=true approves only with a complete env app", () => {
    setPlatformConfigSnapshot({ llm: null, metaApp: null, smtp: null, sms: null, loadedAt: Date.now() } as any);
    process.env.GOOGLE_CLIENT_ID = "env-id";
    process.env.GOOGLE_CLIENT_SECRET = "env-secret";
    expect(effectiveGbpApiAccessApproved()).toBe(false);
    process.env.GOOGLE_GBP_API_ACCESS_APPROVED = "true";
    expect(effectiveGbpApiAccessApproved()).toBe(true);
  });
});

// ---------- GBP client (stubbed fetch) ----------

type FetchCall = { url: string; init?: any };
function stubFetch(handler: (url: string) => { status?: number; body: any }) {
  const calls: FetchCall[] = [];
  const fetchFn = async (url: string, init?: any) => {
    calls.push({ url, init });
    const { status = 200, body } = handler(url);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { calls, fetchFn: fetchFn as any };
}

describe("OU9 GbpClient — location listing (documented v1 shapes)", () => {
  it("lists accounts then locations with readMask, composing the v4 parent", async () => {
    const { calls, fetchFn } = stubFetch((url) => {
      if (url === "https://mybusinessaccountmanagement.googleapis.com/v1/accounts") {
        return { body: { accounts: [{ name: "accounts/111", accountName: "Faysal's Businesses", type: "PERSONAL" }] } };
      }
      if (url.startsWith("https://mybusinessbusinessinformation.googleapis.com/v1/accounts/111/locations")) {
        return { body: { locations: [{ name: "locations/222", title: "Qosprey Khulna" }] } };
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const client = new GoogleBusinessClient(fetchFn);
    const locations = await client.listLocations("token-1");
    expect(calls[0]!.init.headers.Authorization).toBe("Bearer token-1");
    expect(calls[1]!.url).toContain("readMask=name%2Ctitle");
    expect(locations).toEqual([{
      parent: "accounts/111/locations/222",
      locationName: "locations/222",
      accountName: "accounts/111",
      title: "Qosprey Khulna",
      accountLabel: "Faysal's Businesses",
    }]);
  });

  it("zero accounts → empty list, nothing invented", async () => {
    const { fetchFn } = stubFetch(() => ({ body: { accounts: [] } }));
    await expect(new GoogleBusinessClient(fetchFn).listLocations("t")).resolves.toEqual([]);
  });

  it("Google's refusal propagates VERBATIM (the API-access gate's real face)", async () => {
    const { fetchFn } = stubFetch(() => ({
      status: 403,
      body: { error: { message: "Google Business Profile API has not been used in project 123 before or it is disabled.", status: "PERMISSION_DENIED" } },
    }));
    await expect(new GoogleBusinessClient(fetchFn).listLocations("t"))
      .rejects.toThrow("Google Business Profile API has not been used in project 123 before or it is disabled.");
  });
});

describe("OU9 GbpClient — LocalPost create (documented v4 shape)", () => {
  it("POSTs the exact documented body to the location's localPosts endpoint", async () => {
    const { calls, fetchFn } = stubFetch(() => ({
      status: 200,
      body: { name: "accounts/111/locations/222/localPosts/333", searchUrl: "https://www.google.com/maps/search/?api=1&query=post" },
    }));
    const client = new GoogleBusinessClient(fetchFn);
    const created = await client.createLocalPost("token-9", "accounts/111/locations/222", {
      summary: "ঈদের অফার চলছে!",
      linkUrl: "https://qosprey.com/offer",
      imageUrl: "https://cdn.example.com/poster.png",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://mybusiness.googleapis.com/v4/accounts/111/locations/222/localPosts");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers.Authorization).toBe("Bearer token-9");
    expect(JSON.parse(calls[0]!.init.body)).toEqual({
      languageCode: "en",
      summary: "ঈদের অফার চলছে!",
      topicType: "STANDARD",
      callToAction: { actionType: "LEARN_MORE", url: "https://qosprey.com/offer" },
      media: [{ mediaFormat: "PHOTO", sourceUrl: "https://cdn.example.com/poster.png" }],
    });
    expect(created).toEqual({ name: "accounts/111/locations/222/localPosts/333", searchUrl: "https://www.google.com/maps/search/?api=1&query=post" });
  });

  it("text-only post: no callToAction / media keys are sent at all", async () => {
    const { calls, fetchFn } = stubFetch(() => ({ body: { name: "accounts/1/locations/2/localPosts/3" } }));
    const created = await new GoogleBusinessClient(fetchFn).createLocalPost("t", "accounts/1/locations/2", { summary: "খোলা আছে" });
    expect(JSON.parse(calls[0]!.init.body)).toEqual({ languageCode: "en", summary: "খোলা আছে", topicType: "STANDARD" });
    expect(created.searchUrl).toBeNull();
  });

  it("a create refusal propagates Google's message verbatim", async () => {
    const { fetchFn } = stubFetch(() => ({ status: 403, body: { error: { message: "The caller does not have permission", status: "PERMISSION_DENIED" } } }));
    await expect(new GoogleBusinessClient(fetchFn).createLocalPost("t", "accounts/1/locations/2", { summary: "x" }))
      .rejects.toThrow("The caller does not have permission");
  });
});

// ---------- OU9 connect flow (SocialOAuthService, stubbed clients) ----------

import { BadRequestException } from "@nestjs/common";
import { SocialOAuthService } from "./social-oauth.service";
import { GBP_API_ACCESS_GATE_MSG } from "./social.constants";
import { decryptJson } from "../integrations/crypto";

const ORG = "org-1";
const ACTOR = "owner-1";
type Row = Record<string, any>;

function gbpSnapshot(approved: boolean, configured = true) {
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null, loadedAt: Date.now(),
    googleApp: configured ? { clientId: "g-id", clientSecret: "g-secret", gbpApiAccessApproved: approved } : null,
  } as any);
}

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v === null) return row[k] === null || row[k] === undefined;
    if (typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("gt" in v) return row[k] != null && new Date(row[k]).getTime() > new Date((v as any).gt).getTime();
      return true;
    }
    return row[k] === v;
  });
}

function table(store: Row[], prefix: string) {
  let seq = 0;
  return {
    findMany: jest.fn(async (args: any = {}) => store.filter((r) => matches(r, args.where)).map((r) => ({ ...r }))),
    findFirst: jest.fn(async (args: any = {}) => {
      const row = store.find((r) => matches(r, args.where));
      return row ? { ...row } : null;
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: data.id ?? `${prefix}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      store.push(row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((r) => matches(r, where));
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
    upsert: jest.fn(async ({ where, update, create }: any) => {
      const key = where.organizationId_platform_externalId;
      const existing = key
        ? store.find((r) => r.organizationId === key.organizationId && r.platform === key.platform && r.externalId === key.externalId)
        : store.find((r) => matches(r, where));
      if (existing) {
        Object.assign(existing, Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined)));
        return { ...existing };
      }
      const row = { id: `${prefix}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      store.push(row);
      return { ...row };
    }),
  };
}

function fakeDb() {
  const db: any = {
    organizations: [{ id: ORG, timezone: "Asia/Dhaka" }],
    socialAccounts: [] as Row[], integrations: [] as Row[], credentials: [] as Row[],
    oauthStates: [] as Row[], tenantAppConfigs: [] as Row[], auditRows: [] as Row[],
  };
  db.organization = table(db.organizations, "org");
  db.socialAccount = table(db.socialAccounts, "acct");
  db.socialOAuthState = table(db.oauthStates, "state");
  db.tenantAppConfig = table(db.tenantAppConfigs, "tac");
  db.integrationCredential = table(db.credentials, "cred");
  db.integration = {
    ...table(db.integrations, "int"),
    findFirst: jest.fn(async (args: any = {}) => {
      const row = db.integrations.find((r: Row) => matches(r, args.where));
      if (!row) return null;
      const out: Row = { ...row };
      if (args.include?.credential) {
        const cred = db.credentials.find((c: Row) => c.integrationId === row.id);
        out.credential = cred ? { ...cred } : null;
      }
      return out;
    }),
  };
  return db;
}

const decoded = (s: string) => decodeURIComponent(s.replace(/\+/g, " "));
const LOC_1 = { parent: "accounts/111/locations/222", locationName: "locations/222", accountName: "accounts/111", title: "Qosprey Khulna", accountLabel: "Faysal" };
const LOC_2 = { parent: "accounts/111/locations/333", locationName: "locations/333", accountName: "accounts/111", title: "Qosprey Dhaka", accountLabel: "Faysal" };

function youtubeStub(over: Partial<Record<string, any>> = {}): any {
  return {
    exchangeCode: jest.fn(async () => ({ accessToken: "g-access", refreshToken: "g-refresh", expiresAt: Date.now() + 3600_000, scope: "https://www.googleapis.com/auth/business.manage" })),
    refreshAccessToken: jest.fn(async () => ({ accessToken: "g-access-fresh", expiresAt: Date.now() + 3600_000 })),
    ...over,
  };
}
function gbpStub(over: Partial<Record<string, any>> = {}): any {
  return {
    listLocations: jest.fn(async () => [LOC_1]),
    createLocalPost: jest.fn(async () => ({ name: "accounts/111/locations/222/localPosts/9", searchUrl: "https://search.example/post" })),
    ...over,
  };
}
function oauthService(db: any, youtube: any, gbp: any) {
  return new SocialOAuthService(db as any, { log: jest.fn(async (i: any) => { db.auditRows.push(i); }) } as any,
    undefined, youtube, undefined, undefined, undefined, gbp);
}

describe("OU9 GBP connect flow", () => {
  beforeEach(() => gbpSnapshot(true));
  afterEach(() => gbpSnapshot(false, false));

  it("connect-url: Google authorize URL with the business.manage scope + the GBP callback + a bound state", async () => {
    const db = fakeDb();
    const svc = oauthService(db, youtubeStub(), gbpStub());
    const { url } = await svc.googleBusinessConnectUrl(ORG, ACTOR);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/business.manage");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:4000/social/oauth/google-business-profile/callback");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(db.oauthStates).toHaveLength(1);
    expect(db.oauthStates[0]).toMatchObject({ platform: "google_business_profile", purpose: "connect", organizationId: ORG, userId: ACTOR });
  });

  it("connect-url: no Google app configured → honest Bengali refusal, no state minted", async () => {
    gbpSnapshot(false, false);
    const db = fakeDb();
    const svc = oauthService(db, youtubeStub(), gbpStub());
    await expect(svc.googleBusinessConnectUrl(ORG, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
    expect(db.oauthStates).toHaveLength(0);
  });

  it("connect-url: appSource=own without a tenant Google app → honest refusal", async () => {
    const db = fakeDb();
    const svc = oauthService(db, youtubeStub(), gbpStub());
    await expect(svc.googleBusinessConnectUrl(ORG, ACTOR, "own")).rejects.toThrow("নিজের Google অ্যাপ");
    expect(db.oauthStates).toHaveLength(0);
  });

  it("callback with ONE location: account created immediately, externalId = the v4 parent, credential sealed", async () => {
    const db = fakeDb();
    const svc = oauthService(db, youtubeStub(), gbpStub());
    const { url } = await svc.googleBusinessConnectUrl(ORG, ACTOR);
    const state = new URL(url).searchParams.get("state")!;
    const redirect = await svc.handleGoogleBusinessCallback({ code: "code-1", state });
    expect(redirect).toContain("social_connected=google_business_profile");
    expect(db.socialAccounts).toHaveLength(1);
    expect(db.socialAccounts[0]).toMatchObject({
      platform: "google_business_profile", externalId: "accounts/111/locations/222", name: "Qosprey Khulna", status: "connected",
    });
    const credRow = db.credentials.find((c: Row) => c.integrationId === db.socialAccounts[0].integrationId);
    const cred = decryptJson(credRow.encryptedData) as any;
    expect(cred.accessToken).toBe("g-access");
    expect(cred.refreshToken).toBe("g-refresh");
    expect(db.integrations[0]).toMatchObject({ provider: "google_business_social", status: "CONNECTED" });
  });

  it("callback with TWO locations: NOTHING stored yet — a location_pick state is parked", async () => {
    const db = fakeDb();
    const svc = oauthService(db, youtubeStub(), gbpStub({ listLocations: jest.fn(async () => [LOC_1, LOC_2]) }));
    const { url } = await svc.googleBusinessConnectUrl(ORG, ACTOR);
    const state = new URL(url).searchParams.get("state")!;
    const redirect = await svc.handleGoogleBusinessCallback({ code: "code-1", state });
    expect(redirect).toContain("gbp_pick=");
    expect(db.socialAccounts).toHaveLength(0);
    const pickState = new URL(redirect.replace("#", "?")).searchParams.get("gbp_pick")
      ?? decodeURIComponent(redirect.split("gbp_pick=")[1] ?? "");
    const info = await svc.getGoogleBusinessPickInfo(ORG, ACTOR, pickState);
    expect(info.locations).toEqual([
      { id: "accounts/111/locations/222", title: "Qosprey Khulna", accountLabel: "Faysal" },
      { id: "accounts/111/locations/333", title: "Qosprey Dhaka", accountLabel: "Faysal" },
    ]);
    // A location outside the offered list is refused, state intact.
    await expect(svc.selectGoogleBusinessLocation(ORG, ACTOR, { state: pickState, locationId: "accounts/999/locations/999" }))
      .rejects.toThrow("তালিকায় নেই");
    expect(db.socialAccounts).toHaveLength(0);
    const account = await svc.selectGoogleBusinessLocation(ORG, ACTOR, { state: pickState, locationId: "accounts/111/locations/333" });
    expect(account).toMatchObject({ platform: "google_business_profile", externalId: "accounts/111/locations/333", name: "Qosprey Dhaka" });
    expect(db.socialAccounts).toHaveLength(1);
    // The pick state is single-use.
    await expect(svc.selectGoogleBusinessLocation(ORG, ACTOR, { state: pickState, locationId: "accounts/111/locations/222" }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it("callback with ZERO locations: honest error redirect, nothing stored", async () => {
    const db = fakeDb();
    const svc = oauthService(db, youtubeStub(), gbpStub({ listLocations: jest.fn(async () => []) }));
    const { url } = await svc.googleBusinessConnectUrl(ORG, ACTOR);
    const state = new URL(url).searchParams.get("state")!;
    const redirect = await svc.handleGoogleBusinessCallback({ code: "code-1", state });
    expect(decoded(redirect)).toContain("কোনো Business Profile location পাওয়া যায়নি");
    expect(db.socialAccounts).toHaveLength(0);
    expect(db.integrations).toHaveLength(0);
  });

  it("callback when Google REFUSES the location list (API-access gate): Google's message surfaces verbatim, nothing stored", async () => {
    const db = fakeDb();
    const gbp = gbpStub({ listLocations: jest.fn(async () => { throw new Error("Google Business Profile API has not been used in project 123 before or it is disabled."); }) });
    const svc = oauthService(db, youtubeStub(), gbp);
    const { url } = await svc.googleBusinessConnectUrl(ORG, ACTOR);
    const state = new URL(url).searchParams.get("state")!;
    const redirect = await svc.handleGoogleBusinessCallback({ code: "code-1", state });
    expect(decoded(redirect)).toContain("Google Business Profile API has not been used in project 123 before or it is disabled.");
    expect(db.socialAccounts).toHaveLength(0);
  });

  it("callback without a refresh token: refused honestly, nothing stored", async () => {
    const db = fakeDb();
    const svc = oauthService(db, youtubeStub({ exchangeCode: jest.fn(async () => ({ accessToken: "a", expiresAt: Date.now() + 1000 })) }), gbpStub());
    const { url } = await svc.googleBusinessConnectUrl(ORG, ACTOR);
    const state = new URL(url).searchParams.get("state")!;
    const redirect = await svc.handleGoogleBusinessCallback({ code: "code-1", state });
    expect(decoded(redirect)).toContain("refresh token দেয়নি");
    expect(db.socialAccounts).toHaveLength(0);
  });

  it("a replayed connect state stores nothing twice", async () => {
    const db = fakeDb();
    const svc = oauthService(db, youtubeStub(), gbpStub());
    const { url } = await svc.googleBusinessConnectUrl(ORG, ACTOR);
    const state = new URL(url).searchParams.get("state")!;
    await svc.handleGoogleBusinessCallback({ code: "code-1", state });
    const second = await svc.handleGoogleBusinessCallback({ code: "code-1", state });
    expect(decoded(second)).toContain("মেয়াদোত্তীর্ণ");
    expect(db.socialAccounts).toHaveLength(1);
  });

  it("platform-modes carries the GBP entry: configured + the operator's approval state", async () => {
    const db = fakeDb();
    const svc = oauthService(db, youtubeStub(), gbpStub());
    expect((await svc.getPlatformModes()).googleBusinessProfile).toEqual({ configured: true, apiAccessApproved: true });
    gbpSnapshot(false);
    expect((await svc.getPlatformModes()).googleBusinessProfile).toEqual({ configured: true, apiAccessApproved: false });
  });

  it("ensureAccessToken refreshes a GBP account through the Google grant and persists the fresh token", async () => {
    const db = fakeDb();
    const youtube = youtubeStub();
    const svc = oauthService(db, youtube, gbpStub());
    const { url } = await svc.googleBusinessConnectUrl(ORG, ACTOR);
    const state = new URL(url).searchParams.get("state")!;
    await svc.handleGoogleBusinessCallback({ code: "code-1", state });
    const account = db.socialAccounts[0];
    // Force expiry: rewrite the sealed credential with a past expiry.
    const credRow = db.credentials.find((c: Row) => c.integrationId === account.integrationId);
    const { encryptJson } = await import("../integrations/crypto");
    credRow.encryptedData = encryptJson({ accessToken: "stale", refreshToken: "g-refresh", expiresAt: Date.now() - 1000 });
    const fresh = await svc.ensureAccessToken(ORG, account);
    expect(fresh).toBe("g-access-fresh");
    expect(youtube.refreshAccessToken).toHaveBeenCalledWith(expect.objectContaining({ clientId: "g-id" }), "g-refresh");
    const persisted = decryptJson(credRow.encryptedData) as any;
    expect(persisted.accessToken).toBe("g-access-fresh");
    expect(persisted.refreshToken).toBe("g-refresh");
  });

  it("the gate message constant is the plain-words explanation (EN headline + Bengali body)", () => {
    expect(GBP_API_ACCESS_GATE_MSG).toContain("Google Business Profile API access is not yet approved for this platform's Google project");
  });
});

// ---------- OU9 publish path (SocialPublishService, stubbed boundaries) ----------

import { SocialService } from "./social.service";
import { SocialPublishService, PermanentPublishError } from "./social-publish.service";
import { validateForPlatform } from "./social-preflight";
import { encryptJson } from "../integrations/crypto";

function publishDb() {
  const db = fakeDb();
  db.mediaAssets = [] as Row[];
  db.mediaAsset = table(db.mediaAssets, "asset");
  db.integrations.push({ id: "int-gbp", organizationId: ORG, provider: "google_business_social", status: "CONNECTED" });
  db.credentials.push({
    id: "cred-gbp", integrationId: "int-gbp",
    encryptedData: encryptJson({ accessToken: "sealed-token", refreshToken: "g-refresh", expiresAt: Date.now() + 3600_000 }),
  });
  db.socialAccounts.push({
    id: "acct-gbp", organizationId: ORG, platform: "google_business_profile",
    externalId: "accounts/111/locations/222", name: "Qosprey Khulna",
    status: "connected", integrationId: "int-gbp", createdById: ACTOR,
  });
  return db;
}

function publishService(db: any, oauth: any, gbp: any) {
  const audit = { log: jest.fn(async () => undefined) };
  return new SocialPublishService(
    db as any, audit as any, new SocialService(db as any, audit as any),
    undefined, // publisher
    oauth,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, // threadsPublisher, threadsClient
    undefined, // publicMedia
    gbp,
  );
}

const GBP_POST = {
  id: "post-gbp", organizationId: ORG, socialAccountId: "acct-gbp", createdById: ACTOR,
  caption: "আজকের অফার!", linkUrl: null, mediaRefs: [], status: "draft", isStory: false,
};

describe("OU9 GBP publish — the approval gate", () => {
  beforeEach(() => gbpSnapshot(true));
  afterEach(() => gbpSnapshot(false, false));

  it("gate NOT approved: publishing REFUSES with the gate message — no token resolved, no Google call made", async () => {
    gbpSnapshot(false);
    const db = publishDb();
    const oauth = { ensureAccessToken: jest.fn(async () => "fresh-token") };
    const gbp = gbpStub();
    const svc = publishService(db, oauth, gbp);
    const err = await svc.publishToPlatform({ ...GBP_POST }).catch((e) => e);
    expect(err).toBeInstanceOf(PermanentPublishError);
    expect(err.message).toBe(GBP_API_ACCESS_GATE_MSG);
    expect(oauth.ensureAccessToken).not.toHaveBeenCalled();
    expect(gbp.createLocalPost).not.toHaveBeenCalled();
  });

  it("gate approved: ONE documented create with the refresh-aware token, the account's parent, caption + link", async () => {
    const db = publishDb();
    const oauth = { ensureAccessToken: jest.fn(async () => "fresh-token") };
    const gbp = gbpStub();
    const svc = publishService(db, oauth, gbp);
    const out = await svc.publishToPlatform({ ...GBP_POST, linkUrl: "https://qosprey.com/offer" });
    expect(gbp.createLocalPost).toHaveBeenCalledTimes(1);
    expect(gbp.createLocalPost).toHaveBeenCalledWith("fresh-token", "accounts/111/locations/222", {
      summary: "আজকের অফার!", linkUrl: "https://qosprey.com/offer", imageUrl: null,
    });
    expect(out).toEqual({
      platformPostId: "accounts/111/locations/222/localPosts/9",
      platformUrl: "https://search.example/post",
      outcome: "published",
    });
  });

  it("gate approved + one image: the image rides by public URL; a missing asset fails permanently before any Google call", async () => {
    const db = publishDb();
    db.mediaAssets.push({ id: "asset-1", organizationId: ORG, kind: "image", contentType: "image/png", publicToken: "tok-1" });
    const oauth = { ensureAccessToken: jest.fn(async () => "fresh-token") };
    const gbp = gbpStub();
    const svc = publishService(db, oauth, gbp);
    await svc.publishToPlatform({ ...GBP_POST, mediaRefs: [{ assetId: "asset-1", kind: "image" }] });
    expect(gbp.createLocalPost).toHaveBeenCalledWith("fresh-token", "accounts/111/locations/222", {
      summary: "আজকের অফার!", linkUrl: null, imageUrl: "http://localhost:4000/public/media/tok-1",
    });
    const err = await svc.publishToPlatform({ ...GBP_POST, mediaRefs: [{ assetId: "missing", kind: "image" }] }).catch((e) => e);
    expect(err).toBeInstanceOf(PermanentPublishError);
    expect(gbp.createLocalPost).toHaveBeenCalledTimes(1);
  });

  it("gate approved but Google refuses the create: Google's message propagates (never a fake success)", async () => {
    const db = publishDb();
    const oauth = { ensureAccessToken: jest.fn(async () => "fresh-token") };
    const gbp = gbpStub({ createLocalPost: jest.fn(async () => { throw new Error("The caller does not have permission"); }) });
    const svc = publishService(db, oauth, gbp);
    await expect(svc.publishToPlatform({ ...GBP_POST })).rejects.toThrow("The caller does not have permission");
  });
});

describe("OU9 GBP pre-flight (validateForPlatform)", () => {
  it("text-only and text+one-image posts are acceptable", () => {
    expect(validateForPlatform({ caption: "খোলা আছে", mediaRefs: [] }, "google_business_profile")).toBeNull();
    expect(validateForPlatform({ caption: "খোলা আছে", mediaRefs: [{ assetId: "a", kind: "image" }] }, "google_business_profile")).toBeNull();
  });
  it("an empty post, a video, or two images can never succeed and are refused up front", () => {
    expect(validateForPlatform({ caption: "  ", mediaRefs: [] }, "google_business_profile")).toContain("লেখা (Caption) প্রয়োজন");
    expect(validateForPlatform({ caption: "x", mediaRefs: [{ assetId: "a", kind: "video" }] }, "google_business_profile")).toContain("ভিডিও পোস্ট হয় না");
    expect(validateForPlatform({ caption: "x", mediaRefs: [{ assetId: "a", kind: "image" }, { assetId: "b", kind: "image" }] }, "google_business_profile")).toContain("সর্বোচ্চ একটি ছবি");
  });
});
