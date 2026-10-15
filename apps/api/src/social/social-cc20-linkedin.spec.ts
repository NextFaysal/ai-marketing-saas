/**
 * CC20 — LinkedIn Page connect + publish, proven at stubbed
 * boundaries (SP8/SP9 pattern: fake Prisma + stub clients/fetch):
 *
 * - Connect URL: not configured → the honest Bengali refusal;
 *   configured → LinkedIn authorize URL with the three documented
 *   scopes and a linkedin/connect state row.
 * - Callback: ZERO admin'd organizations → error redirect and
 *   NOTHING stored; ONE → linkedin_page SocialAccount under the
 *   platform app; MORE → org_pick state (sealed tokens inside):
 *   other-user peek refused, unlisted org refused, picked org
 *   stored, replay refused. State is single-use — a replayed
 *   callback stores nothing twice.
 * - Refresh: an expired linkedin_page token refreshes through
 *   the LinkedIn branch and re-seals.
 * - Publish dispatch: text post → UGC request with the org URN
 *   as author and shareMediaCategory NONE; a linkUrl post →
 *   ARTICLE with the originalUrl; mediaRefs → permanent refusal
 *   BEFORE any token/client call; the result stores the URN
 *   LinkedIn returns and NO url; LinkedIn's failure message
 *   propagates verbatim.
 * - Client request shape: token exchange form fields, ACL list
 *   URL, UGC headers — asserted against a stub fetch.
 *
 * Evidence ceiling: no real LinkedIn app exists in this sandbox
 * (live posting additionally needs LinkedIn's Community
 * Management API approval) — these specs prove shapes and state
 * semantics, never a live LinkedIn round-trip.
 */

import { SocialOAuthService, LINKEDIN_NOT_CONFIGURED_MSG } from "./social-oauth.service";
import { SocialPublishService, PermanentPublishError } from "./social-publish.service";
import { LinkedInClient } from "./linkedin.client";
import { decryptJson, encryptJson } from "../integrations/crypto";
import { setPlatformConfigSnapshot } from "../common/platform-config";

const ORG = "org-1";
const ACTOR = "owner-1";

const SAVED_ENV = { ...process.env };
beforeAll(() => {
  delete process.env.API_PUBLIC_URL;
  delete process.env.WEB_URL;
  delete process.env.LINKEDIN_CLIENT_ID;
  delete process.env.LINKEDIN_CLIENT_SECRET;
});
afterAll(() => { process.env = { ...SAVED_ENV }; });

function linkedinSnapshot(configured = true) {
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null, sslcommerz: null, bkash: null,
    image: null, tiktokApp: null, googleApp: null, wallet: null,
    linkedinApp: configured ? { clientId: "li-id", clientSecret: "li-secret" } : null,
    loadedAt: Date.now(),
  } as any);
}
beforeEach(() => linkedinSnapshot(true));

type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("gt" in v) return row[k] != null && new Date(row[k]).getTime() > new Date((v as any).gt).getTime();
      return true;
    }
    return row[k] === v;
  });
}

function table(store: Row[]) {
  return {
    findMany: jest.fn(async (args: any = {}) => store.filter((r) => matches(r, args.where)).map((r) => ({ ...r }))),
    findFirst: jest.fn(async (args: any = {}) => {
      const row = store.find((r) => matches(r, args.where));
      return row ? { ...row } : null;
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: data.id ?? `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data };
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
      const row = { id: `row-${store.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      store.push(row);
      return { ...row };
    }),
  };
}

function fakeDb() {
  const db: any = {
    socialAccounts: [] as Row[], integrations: [] as Row[], credentials: [] as Row[], oauthStates: [] as Row[],
  };
  db.socialAccount = table(db.socialAccounts);
  db.socialOAuthState = table(db.oauthStates);
  db.integrationCredential = table(db.credentials);
  db.integration = {
    ...table(db.integrations),
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

const auditStub: any = { log: jest.fn(async () => undefined) };

function stubLinkedInClient(overrides: Record<string, any> = {}) {
  return {
    exchangeCode: jest.fn(async () => ({ accessToken: "li-at", refreshToken: "li-rt", expiresAt: Date.now() + 3600_000, scope: "r_liteprofile" })),
    refreshAccessToken: jest.fn(async () => ({ accessToken: "li-at-2", refreshToken: "li-rt-2", expiresAt: Date.now() + 3600_000 })),
    listAdminOrganizations: jest.fn(async () => [{ id: "555", name: "Qosprey Page" }]),
    publishUgcPost: jest.fn(async () => ({ platformPostId: "urn:li:share:777" })),
    ...overrides,
  };
}

function oauthSvc(db: any, client: any) {
  return new SocialOAuthService(db, auditStub, undefined, undefined, client);
}

async function beginConnect(db: any, svc: SocialOAuthService) {
  const { url } = await svc.linkedinConnectUrl(ORG, ACTOR);
  return { url, state: db.oauthStates[db.oauthStates.length - 1].id as string };
}

describe("CC20 LinkedIn connect", () => {
  it("connect URL carries the documented scopes + a linkedin/connect state", async () => {
    const db = fakeDb();
    const svc = oauthSvc(db, stubLinkedInClient());
    const { url, state } = await beginConnect(db, svc);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
    expect(u.searchParams.get("scope")).toBe("r_liteprofile r_organization_admin w_organization_social");
    expect(u.searchParams.get("redirect_uri")).toContain("/social/oauth/linkedin/callback");
    expect(db.oauthStates[0]).toMatchObject({ platform: "linkedin", purpose: "connect" });
    expect(state).toBeTruthy();
  });

  it("not configured → honest refusal, no state row", async () => {
    linkedinSnapshot(false);
    const db = fakeDb();
    const svc = oauthSvc(db, stubLinkedInClient());
    await expect(svc.linkedinConnectUrl(ORG, ACTOR)).rejects.toThrow(LINKEDIN_NOT_CONFIGURED_MSG);
    expect(db.oauthStates).toHaveLength(0);
  });

  it("callback with ZERO admin'd Pages → error redirect to the Connect Center, NOTHING stored", async () => {
    const db = fakeDb();
    const svc = oauthSvc(db, stubLinkedInClient({ listAdminOrganizations: jest.fn(async () => []) }));
    const { state } = await beginConnect(db, svc);
    const url = await svc.handleLinkedInCallback({ code: "c1", state });
    expect(url).toContain("/dashboard/connections?");
    expect(url).toContain("linkedin_error=");
    expect(decodeURIComponent(url.replace(/\+/g, " "))).toContain("কিছু সেভ করা হয়নি");
    expect(db.socialAccounts).toHaveLength(0);
    expect(db.integrations).toHaveLength(0);
  });

  it("callback with ONE Page → linkedin_page SocialAccount + sealed credential (platform app)", async () => {
    const db = fakeDb();
    const svc = oauthSvc(db, stubLinkedInClient());
    const { state } = await beginConnect(db, svc);
    const url = await svc.handleLinkedInCallback({ code: "c1", state });
    expect(url).toContain("linkedin_connected=linkedin_page");
    expect(db.socialAccounts).toHaveLength(1);
    expect(db.socialAccounts[0]).toMatchObject({ platform: "linkedin_page", externalId: "555", name: "Qosprey Page", appSource: "platform", status: "connected" });
    const cred = decryptJson(db.credentials[0].encryptedData) as any;
    expect(cred).toMatchObject({ accessToken: "li-at", refreshToken: "li-rt", organizationId: "555" });
  });

  it("callback state is single-use — replay stores nothing twice", async () => {
    const db = fakeDb();
    const svc = oauthSvc(db, stubLinkedInClient());
    const { state } = await beginConnect(db, svc);
    await svc.handleLinkedInCallback({ code: "c1", state });
    const replay = await svc.handleLinkedInCallback({ code: "c1", state });
    expect(replay).toContain("linkedin_error=");
    expect(db.socialAccounts).toHaveLength(1);
  });

  it("multi-Page callback → org pick: wrong user refused, unlisted org refused, picked org stored, replay refused", async () => {
    const db = fakeDb();
    const client = stubLinkedInClient({
      listAdminOrganizations: jest.fn(async () => [
        { id: "111", name: "Page A" },
        { id: "222", name: "Page B" },
      ]),
    });
    const svc = oauthSvc(db, client);
    const { state } = await beginConnect(db, svc);
    const url = await svc.handleLinkedInCallback({ code: "c1", state });
    expect(url).toContain("linkedin_pick=");
    expect(db.socialAccounts).toHaveLength(0);
    const pickState = new URL(url).searchParams.get("linkedin_pick")!;

    const info = await svc.getLinkedInPickInfo(ORG, ACTOR, pickState);
    expect(info.organizations.map((o: any) => o.id)).toEqual(["111", "222"]);
    await expect(svc.getLinkedInPickInfo(ORG, "intruder", pickState)).rejects.toThrow();
    await expect(svc.selectLinkedInOrganization(ORG, ACTOR, { state: pickState, organizationId: "999" })).rejects.toThrow();

    const account = await svc.selectLinkedInOrganization(ORG, ACTOR, { state: pickState, organizationId: "222" });
    expect(account).toMatchObject({ platform: "linkedin_page", externalId: "222", name: "Page B" });
    await expect(svc.selectLinkedInOrganization(ORG, ACTOR, { state: pickState, organizationId: "111" })).rejects.toThrow();
  });

  it("ensureAccessToken refreshes an expired linkedin_page token via the LinkedIn branch and re-seals", async () => {
    const db = fakeDb();
    const client = stubLinkedInClient();
    const svc = oauthSvc(db, client);
    const { state } = await beginConnect(db, svc);
    await svc.handleLinkedInCallback({ code: "c1", state });
    // age the stored token
    const cred = decryptJson(db.credentials[0].encryptedData) as any;
    db.credentials[0].encryptedData = encryptJson({ ...cred, expiresAt: Date.now() - 1000 });
    const account = db.socialAccounts[0];
    const token = await svc.ensureAccessToken(ORG, account);
    expect(token).toBe("li-at-2");
    expect(client.refreshAccessToken).toHaveBeenCalled();
    const rotated = decryptJson(db.credentials[0].encryptedData) as any;
    expect(rotated.accessToken).toBe("li-at-2");
    expect(rotated.refreshToken).toBe("li-rt-2");
  });
});

describe("CC20 LinkedIn publish dispatch", () => {
  function publishSetup(linkedin: any) {
    const db = fakeDb();
    db.integrations.push({ id: "int-li", organizationId: ORG, provider: "linkedin_social", status: "CONNECTED", externalAccountId: "555" });
    db.credentials.push({ id: "cred-li", integrationId: "int-li", encryptedData: encryptJson({ accessToken: "li-at", refreshToken: "li-rt", expiresAt: Date.now() + 3600_000, organizationId: "555" }) });
    db.socialAccounts.push({ id: "acct-li", organizationId: ORG, platform: "linkedin_page", externalId: "555", name: "Qosprey Page", status: "connected", integrationId: "int-li" });
    const oauth: any = { ensureAccessToken: jest.fn(async () => "fresh-li-token") };
    const svc = new SocialPublishService(db, auditStub, {} as any, undefined, oauth, undefined, undefined, undefined, linkedin);
    return { db, svc, oauth };
  }
  const post = (partial: Row = {}): Row => ({
    id: "post-1", organizationId: ORG, socialAccountId: "acct-li",
    caption: "নতুন কালেকশন এসেছে!", linkUrl: null, mediaRefs: [], ...partial,
  });

  it("text post → UGC publish with fresh token; result stores LinkedIn's URN and NO url", async () => {
    const linkedin = stubLinkedInClient();
    const { svc, oauth } = publishSetup(linkedin);
    const result = await svc.publishToPlatform(post());
    expect(oauth.ensureAccessToken).toHaveBeenCalled();
    expect(linkedin.publishUgcPost).toHaveBeenCalledWith("fresh-li-token", {
      organizationId: "555", text: "নতুন কালেকশন এসেছে!", linkUrl: null,
    });
    expect(result).toMatchObject({ platformPostId: "urn:li:share:777", platformUrl: null, outcome: "published" });
  });

  it("link post passes the linkUrl through (ARTICLE handled by the client)", async () => {
    const linkedin = stubLinkedInClient();
    const { svc } = publishSetup(linkedin);
    await svc.publishToPlatform(post({ linkUrl: "https://shop.example/p/1" }));
    expect(linkedin.publishUgcPost).toHaveBeenCalledWith("fresh-li-token", expect.objectContaining({ linkUrl: "https://shop.example/p/1" }));
  });

  it("mediaRefs → permanent refusal BEFORE any token or client call", async () => {
    const linkedin = stubLinkedInClient();
    const { svc, oauth } = publishSetup(linkedin);
    await expect(svc.publishToPlatform(post({ mediaRefs: [{ assetId: "a1", kind: "image" }] }))).rejects.toBeInstanceOf(PermanentPublishError);
    expect(oauth.ensureAccessToken).not.toHaveBeenCalled();
    expect(linkedin.publishUgcPost).not.toHaveBeenCalled();
  });

  it("LinkedIn's failure message propagates verbatim", async () => {
    const linkedin = stubLinkedInClient({
      publishUgcPost: jest.fn(async () => { throw new Error("Not enough permissions to post"); }),
    });
    const { svc } = publishSetup(linkedin);
    await expect(svc.publishToPlatform(post())).rejects.toThrow("Not enough permissions to post");
  });
});

describe("CC20 LinkedIn client request shapes (stub fetch)", () => {
  function stubFetch(handler: (url: string, init: any) => any) {
    const calls: { url: string; init: any }[] = [];
    const fn = (async (url: string, init: any) => {
      calls.push({ url, init });
      return handler(url, init);
    }) as any;
    return { fn, calls };
  }
  const jsonRes = (body: any, status = 200, headers: Record<string, string> = {}) => ({
    ok: status >= 200 && status < 300, status,
    json: async () => body,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  });

  it("token exchange posts the documented form fields", async () => {
    const { fn, calls } = stubFetch(() => jsonRes({ access_token: "tok", expires_in: 5184000, refresh_token: "rtok", scope: "r_liteprofile" }));
    const client = new LinkedInClient(fn);
    const tokens = await client.exchangeCode({ clientId: "cid", clientSecret: "sec", redirectUri: "https://api.example/social/oauth/linkedin/callback" }, "code-1");
    expect(tokens.accessToken).toBe("tok");
    expect(calls[0].url).toBe("https://www.linkedin.com/oauth/v2/accessToken");
    const body = new URLSearchParams(calls[0].init.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code-1");
    expect(body.get("client_id")).toBe("cid");
    expect(body.get("redirect_uri")).toContain("/social/oauth/linkedin/callback");
  });

  it("organization list: ACL call then per-org detail; a failed detail keeps the URN name", async () => {
    const { fn, calls } = stubFetch((url: string) => {
      if (url.includes("organizationAcls")) return jsonRes({ elements: [{ organization: "urn:li:organization:111" }, { organization: "urn:li:organization:222" }] });
      if (url.includes("/organizations/111")) return jsonRes({ localizedName: "Page One" });
      return jsonRes({ message: "boom" }, 500);
    });
    const client = new LinkedInClient(fn);
    const orgs = await client.listAdminOrganizations("tok");
    expect(calls[0].url).toContain("q=roleAssignee");
    expect(calls[0].url).toContain("role=ADMINISTRATOR");
    expect(orgs).toEqual([
      { id: "111", name: "Page One" },
      { id: "222", name: "urn:li:organization:222" },
    ]);
  });

  it("UGC publish: author URN, NONE for text, ARTICLE + originalUrl for links, post id from body", async () => {
    const { fn, calls } = stubFetch(() => jsonRes({ id: "urn:li:share:42" }, 201));
    const client = new LinkedInClient(fn);
    const text = await client.publishUgcPost("tok", { organizationId: "555", text: "Hello" });
    expect(text.platformPostId).toBe("urn:li:share:42");
    const payload = JSON.parse(calls[0].init.body);
    expect(payload.author).toBe("urn:li:organization:555");
    expect(payload.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory).toBe("NONE");
    expect(calls[0].init.headers["X-Restli-Protocol-Version"]).toBe("2.0.0");

    await client.publishUgcPost("tok", { organizationId: "555", text: "Hi", linkUrl: "https://x.example/a" });
    const linkPayload = JSON.parse(calls[1].init.body);
    const share = linkPayload.specificContent["com.linkedin.ugc.ShareContent"];
    expect(share.shareMediaCategory).toBe("ARTICLE");
    expect(share.media[0].originalUrl).toBe("https://x.example/a");
  });

  it("UGC failure surfaces LinkedIn's message verbatim", async () => {
    const { fn } = stubFetch(() => jsonRes({ message: "Member has no permission" }, 403));
    const client = new LinkedInClient(fn);
    await expect(client.publishUgcPost("tok", { organizationId: "555", text: "x" })).rejects.toThrow("Member has no permission");
  });
});
