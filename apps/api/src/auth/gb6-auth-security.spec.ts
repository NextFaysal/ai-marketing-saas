import { UnauthorizedException } from "@nestjs/common";
import { hashSync } from "bcryptjs";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { IS_PUBLIC_KEY } from "../common/decorators";
import { totp } from "../common/totp";

// admin-token (the TOTP challenge issuer) signs with JWT_SECRET.
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "gb6-test-secret";

/**
 * GB6 (GC16): login events + server-side sessions.
 * Login success/failure land in LoginEvent (never the password);
 * issuance creates a UserSession and carries its id as `sid`;
 * the guard rejects revoked/gone sessions, tolerates lookup
 * errors, and leaves sid-less tokens untouched.
 */
function makeAuth(opts: { sessionCreateFails?: boolean } = {}) {
  const users: any[] = [{
    id: "u-1", email: "tenant@x.com", name: "Tenant", isSuperAdmin: false,
    status: "ACTIVE", tokenVersion: 0, totpEnabled: false, totpSecretEncrypted: null,
    passwordHash: hashSync("secret123", 10),
  }];
  const events: any[] = [];
  const sessions: any[] = [];
  let seq = 0;
  const p: any = {
    user: {
      findUnique: async ({ where }: any) => users.find((u) => u.id === where.id || u.email === where.email) ?? null,
      update: async ({ where, data }: any) => { const u = users.find((x) => x.id === where.id); Object.assign(u, data); return u; },
    },
    loginEvent: {
      create: jest.fn(async ({ data }: any) => { const row = { id: `le-${++seq}`, createdAt: new Date(), ...data }; events.push(row); return row; }),
      findMany: jest.fn(async ({ where, take }: any) => events.filter((e) => e.userId === where.userId).slice(-(take ?? 50)).reverse()),
    },
    userSession: {
      create: jest.fn(async ({ data }: any) => {
        if (opts.sessionCreateFails) throw new Error("session table unavailable");
        const row = { id: `sess-${++seq}`, createdAt: new Date(), lastSeenAt: new Date(), revokedAt: null, ...data };
        sessions.push(row); return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => sessions.find((s) => s.id === where.id) ?? null),
      findFirst: jest.fn(async ({ where }: any) => sessions.find((s) => s.id === where.id && s.userId === where.userId) ?? null),
      findMany: jest.fn(async ({ where }: any) => sessions.filter((s) => s.userId === where.userId && (where.revokedAt !== null || !s.revokedAt))),
      update: jest.fn(async ({ where, data }: any) => { const s = sessions.find((x) => x.id === where.id); Object.assign(s, data); return s; }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const s of sessions) if (s.userId === where.userId && !s.revokedAt) { Object.assign(s, data); count++; }
        return { count };
      }),
    },
  };
  const signedPayloads: any[] = [];
  const jwt: any = {
    signAsync: async (payload: any) => { signedPayloads.push(payload); return JSON.stringify(payload); },
    verifyAsync: async (token: string) => JSON.parse(token),
  };
  const audit: any = { log: async () => undefined };
  return { svc: new AuthService(p, jwt, audit), p, jwt, users, events, sessions, signedPayloads };
}

function guardCtx(token: string) {
  const req: any = { headers: { authorization: `Bearer ${token}` }, url: "/organizations", originalUrl: "/organizations" };
  return {
    ctx: { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => req }) } as any,
    req,
  };
}
const reflector = { getAllAndOverride: (key: string) => (key === IS_PUBLIC_KEY ? false : undefined) } as any;

describe("GB6 login events + session issuance", () => {
  it("login success writes a success LoginEvent, creates a UserSession, and the token carries sid", async () => {
    const { svc, events, sessions, signedPayloads } = makeAuth();
    const out: any = await svc.login({ email: "tenant@x.com", password: "secret123" } as any, "1.2.3.4", "TestAgent/1.0");
    expect(out.accessToken).toBeTruthy();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ userId: "u-1", ip: "1.2.3.4", userAgent: "TestAgent/1.0" });
    expect(signedPayloads[0].sid).toBe(sessions[0].id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: "u-1", email: "tenant@x.com", success: true, ip: "1.2.3.4" });
  });

  it("login failure writes success:false with the attempted email — and never the password", async () => {
    const { svc, events, sessions } = makeAuth();
    await expect(svc.login({ email: "tenant@x.com", password: "wrongpass" } as any, "5.6.7.8")).rejects.toBeInstanceOf(UnauthorizedException);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: "u-1", email: "tenant@x.com", success: false });
    expect(JSON.stringify(events[0])).not.toContain("wrongpass");
    expect(sessions).toHaveLength(0);

    await expect(svc.login({ email: "ghost@x.com", password: "whatever1" } as any)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(events[1]).toMatchObject({ userId: null, email: "ghost@x.com", success: false });
  });

  it("a session-create failure at issuance still issues the token — without sid", async () => {
    const { svc, signedPayloads, events } = makeAuth({ sessionCreateFails: true });
    const out: any = await svc.login({ email: "tenant@x.com", password: "secret123" } as any);
    expect(out.accessToken).toBeTruthy();
    expect(signedPayloads[0].sid).toBeUndefined();
    expect(events[0].success).toBe(true); // the login itself stands
  });

  it("TOTP: a wrong code records a failure; the correct code records success and issues a sid token", async () => {
    const { svc, users, events, signedPayloads } = makeAuth();
    const { generateTotpSecret } = await import("../common/totp");
    const { encryptJson } = await import("../integrations/crypto");
    const { issueAdminToken } = await import("../common/admin-token");
    const secret = generateTotpSecret();
    users[0].totpEnabled = true;
    users[0].totpSecretEncrypted = encryptJson({ secret });
    const challenge = issueAdminToken({ purpose: "totp-challenge", sub: "u-1", tv: 0 }, 5);

    const wrong = totp(secret) === "000000" ? "000001" : "000000";
    await expect(svc.verifyTotpLogin(challenge, wrong)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: "u-1", success: false });

    const out: any = await svc.verifyTotpLogin(challenge, totp(secret));
    expect(out.accessToken).toBeTruthy();
    expect(events[1]).toMatchObject({ userId: "u-1", success: true });
    expect(signedPayloads[signedPayloads.length - 1].sid).toBeTruthy();
  });

  it("own sessions + history endpoints read back what login wrote", async () => {
    const { svc, sessions } = makeAuth();
    await svc.login({ email: "tenant@x.com", password: "secret123" } as any, "1.1.1.1", "UA");
    const mine: any[] = await svc.mySessions("u-1", sessions[0].id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: sessions[0].id, current: true, ip: "1.1.1.1" });
    const history: any[] = await svc.myLoginHistory("u-1");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ success: true, email: "tenant@x.com" });

    await expect(svc.revokeMySession("u-1", "sess-of-someone-else")).rejects.toThrow(/not found/);
    await expect(svc.revokeMySession("u-1", sessions[0].id)).resolves.toMatchObject({ ok: true, alreadyRevoked: false });
    await expect(svc.mySessions("u-1")).resolves.toHaveLength(0);
  });
});

describe("GB6 JwtAuthGuard session check", () => {
  it("a token whose session is revoked is a 401", async () => {
    const { p, jwt, sessions } = makeAuth();
    sessions.push({ id: "sess-rev", userId: "u-1", createdAt: new Date(), lastSeenAt: new Date(), revokedAt: new Date() });
    const guard = new JwtAuthGuard(jwt, reflector, p);
    const { ctx } = guardCtx(JSON.stringify({ sub: "u-1", email: "tenant@x.com", sid: "sess-rev" }));
    await expect(guard.canActivate(ctx)).rejects.toThrow(/Session has been revoked/);
  });

  it("a token whose session row is gone is a 401; a lookup error is not", async () => {
    const { p, jwt } = makeAuth();
    const guard = new JwtAuthGuard(jwt, reflector, p);
    const gone = guardCtx(JSON.stringify({ sub: "u-1", email: "tenant@x.com", sid: "sess-missing" }));
    await expect(guard.canActivate(gone.ctx)).rejects.toThrow(/Session has been revoked/);

    const brokenPrisma: any = { userSession: { findUnique: async () => { throw new Error("db down"); } } };
    const tolerant = new JwtAuthGuard(jwt, reflector, brokenPrisma);
    const err = guardCtx(JSON.stringify({ sub: "u-1", email: "tenant@x.com", sid: "sess-any" }));
    await expect(tolerant.canActivate(err.ctx)).resolves.toBe(true);
  });

  it("a live session passes, exposes sid, and stamps a stale lastSeenAt", async () => {
    const { p, jwt, sessions } = makeAuth();
    const stale = new Date(Date.now() - 5 * 60 * 1000);
    sessions.push({ id: "sess-live", userId: "u-1", createdAt: new Date(), lastSeenAt: stale, revokedAt: null });
    const guard = new JwtAuthGuard(jwt, reflector, p);
    const { ctx, req } = guardCtx(JSON.stringify({ sub: "u-1", email: "tenant@x.com", sid: "sess-live" }));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((req.user as any).sid).toBe("sess-live");
    await new Promise((r) => setImmediate(r));
    expect(sessions[0].lastSeenAt.getTime()).toBeGreaterThan(stale.getTime());
  });

  it("a token without sid passes untouched", async () => {
    const { p, jwt } = makeAuth();
    const guard = new JwtAuthGuard(jwt, reflector, p);
    const { ctx, req } = guardCtx(JSON.stringify({ sub: "u-1", email: "tenant@x.com" }));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((req.user as any).sid).toBeUndefined();
  });
});
