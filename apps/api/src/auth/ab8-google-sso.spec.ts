import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { createHash } from "node:crypto";
import { hashSync } from "bcryptjs";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { GoogleSsoService } from "./google-sso.service";
import { AdminService } from "../admin/admin.service";
import {
  seal, setPlatformConfigSnapshot, effectiveGoogleOAuthConfig, getPlatformConfigSync,
} from "../common/platform-config";
import { decryptJson } from "../integrations/crypto";
import { totp } from "../common/totp";

// admin-token (TOTP challenges) signs with JWT_SECRET; seal()
// reads ENCRYPTION_KEY at call time.
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "ab8-test-secret";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.WEB_URL = "http://web.test";
process.env.API_PUBLIC_URL = "http://api.test";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

function plainUser(over: Record<string, any> = {}) {
  return {
    id: "u-1", email: "tenant@x.com", name: "Tenant", isSuperAdmin: false,
    status: "ACTIVE", tokenVersion: 0, totpEnabled: false, totpSecretEncrypted: null,
    passwordHash: hashSync("secret123", 10), ...over,
  };
}

type SsoCfg = "enabled" | "disabled-flag" | "absent";

function makeHarness(opts: { sso?: SsoCfg; users?: any[] } = {}) {
  const users: any[] = opts.users ?? [plainUser()];
  const settings: any[] = [];
  if ((opts.sso ?? "enabled") !== "absent") {
    settings.push({
      key: "googleOAuthConfig",
      value: {
        clientId: "sso-client-id",
        clientSecretEncrypted: seal("sso-secret"),
        enabled: (opts.sso ?? "enabled") === "enabled",
      },
    });
  }
  const ssoRows: any[] = [];
  const events: any[] = [];
  const sessions: any[] = [];
  let seq = 0;
  const p: any = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => users.find((u) => u.id === where.id || u.email === where.email) ?? null),
      update: jest.fn(async ({ where, data }: any) => { const u = users.find((x) => x.id === where.id); if (u) Object.assign(u, data); return u; }),
      create: jest.fn(async ({ data }: any) => { const u = { id: `u-new-${++seq}`, ...data }; users.push(u); return u; }),
    },
    systemSetting: {
      findUnique: async ({ where }: any) => settings.find((r) => r.key === where.key) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const row = settings.find((r) => r.key === where.key);
        if (row) { Object.assign(row, update); return row; }
        const created = { ...create }; settings.push(created); return created;
      },
      deleteMany: async ({ where }: any) => {
        const i = settings.findIndex((r) => r.key === where.key);
        if (i >= 0) settings.splice(i, 1);
        return { count: 1 };
      },
    },
    ssoLoginState: {
      create: jest.fn(async ({ data }: any) => { const row = { id: `sso-${++seq}`, createdAt: new Date(), usedAt: null, userId: null, ...data }; ssoRows.push(row); return row; }),
      findFirst: jest.fn(async ({ where }: any) => ssoRows.find((r) => r.tokenHash === where.tokenHash && r.kind === where.kind) ?? null),
      findUnique: jest.fn(async ({ where }: any) => ssoRows.find((r) => r.tokenHash === where.tokenHash) ?? null),
      update: jest.fn(async ({ where, data }: any) => { const r = ssoRows.find((x) => x.id === where.id); Object.assign(r, data); return r; }),
    },
    loginEvent: {
      create: jest.fn(async ({ data }: any) => { const row = { id: `le-${++seq}`, createdAt: new Date(), ...data }; events.push(row); return row; }),
      findMany: jest.fn(async () => [...events].reverse()),
    },
    userSession: {
      create: jest.fn(async ({ data }: any) => { const row = { id: `sess-${++seq}`, createdAt: new Date(), lastSeenAt: new Date(), revokedAt: null, ...data }; sessions.push(row); return row; }),
    },
  };
  const signedPayloads: any[] = [];
  const jwt: any = {
    signAsync: async (payload: any) => { signedPayloads.push(payload); return JSON.stringify(payload); },
    verifyAsync: async (token: string) => JSON.parse(token),
  };
  const audit: any = { log: async () => undefined };
  const auth = new AuthService(p, jwt, audit);
  const sso = new GoogleSsoService(p, auth);
  const controller = new AuthController(auth, undefined, sso);
  return { p, auth, sso, controller, users, settings, ssoRows, events, sessions, signedPayloads };
}

/** Fake Google: token endpoint + userinfo, via the fetch seam. */
function fakeGoogle(sso: GoogleSsoService, profile: any, opts: { tokenOk?: boolean } = {}) {
  const calls: any[] = [];
  sso.fetchFn = (async (url: string, init?: any) => {
    calls.push({ url, init });
    if (String(url).includes("oauth2.googleapis.com/token")) {
      if (opts.tokenOk === false) {
        return { ok: false, status: 400, json: async () => ({ error: "invalid_grant", error_description: "Bad code" }) };
      }
      // The exchange must be the documented form POST.
      expect(init.method).toBe("POST");
      const form = init.body as URLSearchParams;
      expect(form.get("grant_type")).toBe("authorization_code");
      expect(form.get("client_id")).toBe("sso-client-id");
      expect(form.get("client_secret")).toBe("sso-secret");
      expect(form.get("redirect_uri")).toBe("http://api.test/auth/google/callback");
      return { ok: true, status: 200, json: async () => ({ access_token: "at-1", token_type: "Bearer" }) };
    }
    if (String(url).includes("openidconnect.googleapis.com/v1/userinfo")) {
      expect(init.headers.Authorization).toBe("Bearer at-1");
      return { ok: true, status: 200, json: async () => profile };
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as any;
  return calls;
}

async function startState(sso: GoogleSsoService): Promise<string> {
  const { url } = await sso.start("1.2.3.4");
  const state = new URL(url).searchParams.get("state");
  expect(state).toBeTruthy();
  return state!;
}

beforeEach(() => {
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null, sslcommerz: null, bkash: null,
    image: null, tiktokApp: null, googleApp: null, googleOAuth: null, wallet: null, loadedAt: 0,
  });
  delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;
});
afterAll(() => {
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null, sslcommerz: null, bkash: null,
    image: null, tiktokApp: null, googleApp: null, googleOAuth: null, wallet: null, loadedAt: 0,
  });
});

describe("AB8 config + start", () => {
  it("no admin config → config endpoint {enabled:false} and start refuses — env Google creds do NOT enable SSO", async () => {
    process.env.GOOGLE_CLIENT_ID = "env-youtube-id";
    process.env.GOOGLE_CLIENT_SECRET = "env-youtube-secret";
    const h = makeHarness({ sso: "absent" });
    await expect(h.sso.config()).resolves.toEqual({ enabled: false });
    await expect(h.controller.googleConfig()).resolves.toEqual({ enabled: false });
    await expect(h.sso.start()).rejects.toMatchObject({ code: "auth.googleSsoNotEnabled", status: 503 });
    expect(effectiveGoogleOAuthConfig()).toBeNull();
    expect(h.ssoRows).toHaveLength(0);
    delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it("config stored but enabled=false → still off (credentials alone never turn SSO on)", async () => {
    const h = makeHarness({ sso: "disabled-flag" });
    await expect(h.sso.config()).resolves.toEqual({ enabled: false });
    await expect(h.sso.start()).rejects.toMatchObject({ code: "auth.googleSsoNotEnabled", status: 503 });
    // The config itself DID load — only the switch is off.
    expect(effectiveGoogleOAuthConfig()).toMatchObject({ clientId: "sso-client-id", enabled: false, source: "admin" });
  });

  it("start creates a HASHED single state row and the URL carries client/redirect/state/scope", async () => {
    const h = makeHarness();
    const { url } = await h.sso.start("1.2.3.4");
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("client_id")).toBe("sso-client-id");
    expect(u.searchParams.get("redirect_uri")).toBe("http://api.test/auth/google/callback");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("openid email profile");
    expect(u.searchParams.get("access_type")).toBe("online");
    expect(u.searchParams.get("prompt")).toBe("select_account");
    const raw = u.searchParams.get("state")!;
    expect(h.ssoRows).toHaveLength(1);
    expect(h.ssoRows[0]).toMatchObject({ kind: "state", tokenHash: sha256(raw), userId: null, usedAt: null });
    expect(JSON.stringify(h.ssoRows)).not.toContain(raw);
    expect(new Date(h.ssoRows[0].expiresAt).getTime()).toBeGreaterThan(Date.now() + 9 * 60 * 1000);
  });
});

describe("AB8 callback", () => {
  it("bad state → googleError=state_invalid, Google is never called, nothing is recorded", async () => {
    const h = makeHarness();
    const calls = fakeGoogle(h.sso, { email: "tenant@x.com", email_verified: true });
    const out = await h.sso.callback("code-1", "not-a-real-state", "1.2.3.4", "UA");
    expect(out).toBe("http://web.test/login?googleError=state_invalid");
    expect(calls).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  it("token exchange failure → exchange_failed, and the state is still consumed (replay → state_invalid)", async () => {
    const h = makeHarness();
    fakeGoogle(h.sso, { email: "tenant@x.com", email_verified: true }, { tokenOk: false });
    const state = await startState(h.sso);
    const out = await h.sso.callback("bad-code", state, "1.2.3.4", "UA");
    expect(out).toBe("http://web.test/login?googleError=exchange_failed");
    expect(h.ssoRows[0].usedAt).toBeTruthy();
    const replay = await h.sso.callback("bad-code", state, "1.2.3.4", "UA");
    expect(replay).toBe("http://web.test/login?googleError=state_invalid");
    expect(h.events).toHaveLength(0);
  });

  it("userinfo email_verified=false → email_unverified, no handoff, no login event", async () => {
    const h = makeHarness();
    fakeGoogle(h.sso, { email: "tenant@x.com", email_verified: false });
    const state = await startState(h.sso);
    const out = await h.sso.callback("code-1", state);
    expect(out).toBe("http://web.test/login?googleError=email_unverified");
    expect(h.ssoRows.filter((r) => r.kind === "handoff")).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  it("unknown email → account_not_found, NO user is created, a failed LoginEvent (method google) is recorded", async () => {
    const h = makeHarness();
    fakeGoogle(h.sso, { email: "Stranger@X.com", email_verified: true });
    const state = await startState(h.sso);
    const out = await h.sso.callback("code-1", state, "5.6.7.8", "UA/1");
    expect(out).toBe("http://web.test/login?googleError=account_not_found");
    expect(h.p.user.create).not.toHaveBeenCalled();
    expect(h.users).toHaveLength(1);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ userId: null, email: "stranger@x.com", success: false, method: "google", ip: "5.6.7.8" });
    expect(h.ssoRows.filter((r) => r.kind === "handoff")).toHaveLength(0);
  });

  it("known but non-ACTIVE account → account_inactive + failed LoginEvent (method google)", async () => {
    const h = makeHarness({ users: [plainUser({ status: "SUSPENDED" })] });
    fakeGoogle(h.sso, { email: "tenant@x.com", email_verified: true });
    const state = await startState(h.sso);
    const out = await h.sso.callback("code-1", state);
    expect(out).toBe("http://web.test/login?googleError=account_inactive");
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ userId: "u-1", email: "tenant@x.com", success: false, method: "google" });
  });

  it("SSO disabled after start → callback reports not_configured", async () => {
    const h = makeHarness({ sso: "disabled-flag" });
    const out = await h.sso.callback("code-1", "any-state");
    expect(out).toBe("http://web.test/login?googleError=not_configured");
  });
});

describe("AB8 handoff + exchange", () => {
  async function handoffFor(h: ReturnType<typeof makeHarness>): Promise<string> {
    fakeGoogle(h.sso, { email: "tenant@x.com", email_verified: true, name: "Tenant" });
    const state = await startState(h.sso);
    const out = await h.sso.callback("code-1", state, "1.2.3.4", "UA/1");
    const m = out.match(/#handoff=(.+)$/);
    expect(out.startsWith("http://web.test/login/google#handoff=")).toBe(true);
    expect(m).toBeTruthy();
    return m![1];
  }

  it("known user → handoff redirect carries the raw token ONLY in the fragment; the row stores its hash", async () => {
    const h = makeHarness();
    const raw = await handoffFor(h);
    const row = h.ssoRows.find((r) => r.kind === "handoff");
    expect(row).toMatchObject({ tokenHash: sha256(raw), userId: "u-1", usedAt: null });
    expect(JSON.stringify(h.ssoRows)).not.toContain(raw);
    expect(new Date(row.expiresAt).getTime()).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
    // No login has completed yet — no event, no session.
    expect(h.events).toHaveLength(0);
    expect(h.sessions).toHaveLength(0);
  });

  it("exchange completes the login: session issued, LoginEvent method google; the handoff is single-use", async () => {
    const h = makeHarness();
    const raw = await handoffFor(h);
    const out: any = await h.sso.exchange(raw, "1.2.3.4", "UA/1");
    expect(out.accessToken).toBeTruthy();
    expect(out.user).toMatchObject({ id: "u-1", email: "tenant@x.com" });
    expect(h.sessions).toHaveLength(1);
    expect(h.sessions[0]).toMatchObject({ userId: "u-1", ip: "1.2.3.4" });
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ userId: "u-1", email: "tenant@x.com", success: true, method: "google" });
    await expect(h.sso.exchange(raw, "1.2.3.4", "UA/1")).rejects.toBeInstanceOf(ApiException);
    await expect(h.sso.exchange(raw)).rejects.toThrow(/অবৈধ বা মেয়াদ শেষ/);
    expect(h.sessions).toHaveLength(1);
  });

  it("exchange of a bogus/empty token → 401 with the Bengali message", async () => {
    const h = makeHarness();
    await expect(h.sso.exchange("bogus-token")).rejects.toBeInstanceOf(ApiException);
    await expect(h.sso.exchange("")).rejects.toThrow(/অবৈধ বা মেয়াদ শেষ/);
  });

  it("an expired handoff → 401", async () => {
    const h = makeHarness();
    const raw = await handoffFor(h);
    const row = h.ssoRows.find((r) => r.kind === "handoff");
    row.expiresAt = new Date(Date.now() - 1000);
    await expect(h.sso.exchange(raw)).rejects.toBeInstanceOf(ApiException);
  });
});

describe("AB8 TOTP is never bypassed", () => {
  function totpUser() {
    const { generateTotpSecret } = require("../common/totp");
    const secret = generateTotpSecret();
    const user = plainUser({ totpEnabled: true, totpSecretEncrypted: require("../integrations/crypto").encryptJson({ secret }) });
    return { user, secret };
  }

  it("Google login for a TOTP user → requiresTotp, challenge carries via=google, completion records method google", async () => {
    const { user, secret } = totpUser();
    const h = makeHarness({ users: [user] });
    fakeGoogle(h.sso, { email: "tenant@x.com", email_verified: true });
    const state = await startState(h.sso);
    const redirect = await h.sso.callback("code-1", state);
    const raw = redirect.match(/#handoff=(.+)$/)![1];
    const out: any = await h.sso.exchange(raw, "1.2.3.4", "UA/1");
    expect(out.requiresTotp).toBe(true);
    expect(out.accessToken).toBeUndefined();
    // The challenge body carries the origin claim.
    const body = JSON.parse(Buffer.from(String(out.challengeToken).split(".")[0], "base64url").toString("utf8"));
    expect(body).toMatchObject({ purpose: "totp-challenge", sub: "u-1", via: "google" });
    // Nothing has completed yet: no success event, no session.
    expect(h.events.filter((e) => e.success)).toHaveLength(0);
    expect(h.sessions).toHaveLength(0);

    const done: any = await h.auth.verifyTotpLogin(out.challengeToken, totp(secret), "1.2.3.4", "UA/1");
    expect(done.accessToken).toBeTruthy();
    expect(h.sessions).toHaveLength(1);
    const success = h.events.find((e) => e.success);
    expect(success).toMatchObject({ userId: "u-1", method: "google" });
  });

  it("a password-origin TOTP completion still records method password", async () => {
    const { user, secret } = totpUser();
    const h = makeHarness({ users: [user] });
    const first: any = await h.auth.login({ email: "tenant@x.com", password: "secret123" } as any, "1.2.3.4", "UA/1");
    expect(first.requiresTotp).toBe(true);
    const body = JSON.parse(Buffer.from(String(first.challengeToken).split(".")[0], "base64url").toString("utf8"));
    expect(body.via).toBeUndefined();
    await h.auth.verifyTotpLogin(first.challengeToken, totp(secret), "1.2.3.4", "UA/1");
    const success = h.events.find((e) => e.success);
    expect(success).toMatchObject({ userId: "u-1", method: "password" });
  });
});

describe("AB8 admin platform-config surface (googleOAuth)", () => {
  const actor: any = { id: "admin-1" };

  it("write seals the secret, the safe view never contains it, blank secret keeps the stored one, snapshot follows", async () => {
    const h = makeHarness({ sso: "absent" });
    const admin = new AdminService(h.p, { log: async () => undefined } as any);
    const view: any = await admin.updatePlatformConfig(actor, "googleOAuth", {
      clientId: "sso-client-id", clientSecret: "sso-secret-xyz", enabled: true,
    });
    expect(view.googleOAuth).toMatchObject({ clientId: "sso-client-id", secretConfigured: true, enabled: true, source: "admin" });
    expect(JSON.stringify(view)).not.toContain("sso-secret-xyz");
    const row = h.settings.find((r: any) => r.key === "googleOAuthConfig");
    expect(row.value.clientSecretEncrypted).not.toContain("sso-secret-xyz");
    expect(decryptJson<any>(row.value.clientSecretEncrypted).v).toBe("sso-secret-xyz");
    // The live snapshot (what GoogleSsoService reads) carries it.
    expect(getPlatformConfigSync().googleOAuth).toMatchObject({ clientId: "sso-client-id", clientSecret: "sso-secret-xyz", enabled: true });
    expect(effectiveGoogleOAuthConfig()).toMatchObject({ clientId: "sso-client-id", enabled: true, source: "admin" });

    // Blank secret on a later write keeps the stored secret;
    // enabled can be switched off without touching credentials.
    const view2: any = await admin.updatePlatformConfig(actor, "googleOAuth", { clientSecret: "", enabled: false });
    expect(view2.googleOAuth).toMatchObject({ clientId: "sso-client-id", secretConfigured: true, enabled: false });
    const row2 = h.settings.find((r: any) => r.key === "googleOAuthConfig");
    expect(decryptJson<any>(row2.value.clientSecretEncrypted).v).toBe("sso-secret-xyz");

    const full: any = await admin.getPlatformConfig();
    expect(full.googleOAuth).toMatchObject({ clientId: "sso-client-id", secretConfigured: true, enabled: false });
    expect(JSON.stringify(full)).not.toContain("sso-secret-xyz");
  });
});
