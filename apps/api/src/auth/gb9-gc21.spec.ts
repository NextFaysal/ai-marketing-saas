import { BadRequestException, ForbiddenException, HttpException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { createHash } from "node:crypto";
import { VerificationService } from "./verification.service";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { IS_PUBLIC_KEY } from "../common/decorators";
import { OrganizationsService } from "../organizations/organizations.service";
import { AdminService } from "../admin/admin.service";
import { storageUsageForOrg, STORAGE_METERED_FROM } from "../common/storage-usage";

/**
 * GC21 (GB9) — Merchant Trust.
 * Email token issue/verify/expiry/reuse, phone OTP honesty when
 * the platform SMS is unconfigured, OTP attempt cap, the
 * email-verification gate matrix, merchant submit validation +
 * admin approve/reject, and the recorded storage sum.
 */

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const auditStub: any = { log: jest.fn(async () => undefined) };

function makeVerification(opts: { smsConfigured?: boolean; smsFails?: boolean; emailConfigured?: boolean } = {}) {
  const users: any[] = [{
    id: "u-1", email: "owner@shop.com", name: "Owner", status: "ACTIVE",
    emailVerifiedAt: null, phoneVerifiedAt: null, phone: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
  }];
  const tokens: any[] = [];
  let seq = 0;
  const applyWhere = (row: any, where: any) => Object.entries(where ?? {}).every(([k, v]) => {
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
  const p: any = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => users.find((u) => u.id === where.id || u.email === where.email) ?? null),
      update: jest.fn(async ({ where, data }: any) => { const u = users.find((x) => x.id === where.id); Object.assign(u, data); return u; }),
    },
    verificationToken: {
      create: jest.fn(async ({ data }: any) => { const row = { id: `vt-${++seq}`, createdAt: new Date(), ...data }; tokens.push(row); return row; }),
      findFirst: jest.fn(async ({ where }: any) => tokens.find((t) => applyWhere(t, where)) ?? null),
      findMany: jest.fn(async ({ where }: any) => tokens.filter((t) => applyWhere(t, where)).sort((a, b) => +b.createdAt - +a.createdAt)),
      update: jest.fn(async ({ where, data }: any) => { const t = tokens.find((x) => x.id === where.id); Object.assign(t, data); return t; }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const t of tokens) if (applyWhere(t, where)) { Object.assign(t, data); count++; }
        return { count };
      }),
    },
  };
  const sentMail: any[] = [];
  const email: any = {
    isConfigured: () => opts.emailConfigured !== false,
    send: jest.fn(async (input: any) => { sentMail.push(input); return { providerMessageId: "m-1" }; }),
  };
  const sentSms: any[] = [];
  const sms: any = {
    isConfigured: () => opts.smsConfigured === true,
    send: jest.fn(async (input: any) => {
      if (opts.smsFails) throw new Error("gateway refused");
      sentSms.push(input);
      return { providerMessageId: "s-1" };
    }),
  };
  const svc = new VerificationService(p, auditStub, email, sms);
  return { svc, p, users, tokens, sentMail, sentSms, email, sms };
}

describe("GC21 email verification tokens", () => {
  it("issues a hashed token, emails the link, and verify stamps the user (token never in the response)", async () => {
    const { svc, users, tokens, sentMail } = makeVerification();
    const out: any = await svc.requestEmailVerification("u-1");
    expect(out).toEqual({ sent: true });
    expect(JSON.stringify(out)).not.toContain("token");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].kind).toBe("email");
    expect(tokens[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sentMail).toHaveLength(1);
    const link = /verify-email\?token=([a-f0-9]+)/.exec(sentMail[0].text);
    expect(link).toBeTruthy();
    const rawToken = link![1];
    expect(tokens[0].tokenHash).toBe(sha(rawToken)); // only the hash is stored
    expect(sentMail[0].text).not.toContain(tokens[0].tokenHash);

    const verified: any = await svc.verifyEmail(rawToken);
    expect(verified).toEqual({ verified: true, alreadyVerified: false });
    expect(users[0].emailVerifiedAt).toBeInstanceOf(Date);
    expect(tokens[0].usedAt).toBeInstanceOf(Date);
  });

  it("re-clicking after verification is a clear already-verified success, not an error", async () => {
    const { svc, sentMail } = makeVerification();
    await svc.requestEmailVerification("u-1");
    const rawToken = /token=([a-f0-9]+)/.exec(sentMail[0].text)![1];
    await svc.verifyEmail(rawToken);
    const again: any = await svc.verifyEmail(rawToken);
    expect(again).toEqual({ verified: true, alreadyVerified: true });
  });

  it("a new request invalidates the previous unused token", async () => {
    const { svc, sentMail } = makeVerification();
    await svc.requestEmailVerification("u-1");
    const first = /token=([a-f0-9]+)/.exec(sentMail[0].text)![1];
    await svc.requestEmailVerification("u-1");
    await expect(svc.verifyEmail(first)).rejects.toMatchObject({ code: "auth.verificationLinkExpired", status: 400 });
  });

  it("an expired token is refused and an unknown token is refused", async () => {
    const { svc, tokens, sentMail } = makeVerification();
    await svc.requestEmailVerification("u-1");
    const rawToken = /token=([a-f0-9]+)/.exec(sentMail[0].text)![1];
    tokens[0].expiresAt = new Date(Date.now() - 1000);
    await expect(svc.verifyEmail(rawToken)).rejects.toMatchObject({ code: "auth.verificationLinkExpired", status: 400 });
    await expect(svc.verifyEmail("f".repeat(64))).rejects.toMatchObject({ code: "auth.verificationLinkInvalidOrExpired", status: 400 });
  });

  it("unconfigured email returns sent:false and never throws (registration stays unblocked)", async () => {
    const { svc } = makeVerification({ emailConfigured: false });
    await expect(svc.requestEmailVerification("u-1")).resolves.toEqual({ sent: false, reason: "email_not_configured" });
  });
});

describe("GC21 phone OTP", () => {
  it("no platform SMS config → honest sms_not_configured and NOTHING is created", async () => {
    const { svc, tokens, users } = makeVerification({ smsConfigured: false });
    await svc.setPhone("u-1", "01712345678");
    expect(users[0].phone).toBe("+8801712345678");
    const out: any = await svc.requestPhoneOtp("u-1");
    expect(out).toEqual({ sent: false, reason: "sms_not_configured" });
    expect(tokens.filter((t) => t.kind === "phone")).toHaveLength(0);
  });

  it("changing the phone resets phoneVerifiedAt; an invalid number is refused in Bengali", async () => {
    const { svc, users } = makeVerification();
    users[0].phone = "+8801712345678";
    users[0].phoneVerifiedAt = new Date();
    const out: any = await svc.setPhone("u-1", "01998765432");
    expect(out.phone).toBe("+8801998765432");
    expect(out.phoneVerifiedAt).toBeNull();
    await expect(svc.setPhone("u-1", "12345")).rejects.toMatchObject({ code: "auth.bdMobileNumberInvalid", status: 400 });
  });

  it("configured SMS: code is hashed, verify stamps phoneVerifiedAt, reuse fails", async () => {
    const { svc, tokens, users, sentSms } = makeVerification({ smsConfigured: true });
    await svc.setPhone("u-1", "01712345678");
    const out: any = await svc.requestPhoneOtp("u-1");
    expect(out.sent).toBe(true);
    expect(sentSms).toHaveLength(1);
    expect(sentSms[0].to).toBe("8801712345678");
    const code = /কোড: (\d{6})/.exec(sentSms[0].text)![1];
    const row = tokens.find((t) => t.kind === "phone");
    expect(row.tokenHash).toBe(sha(`u-1:${code}`));
    expect(row.tokenHash).not.toBe(code); // only the hash is stored, never the raw code

    const verified: any = await svc.verifyPhoneOtp("u-1", code);
    expect(verified.verified).toBe(true);
    expect(users[0].phoneVerifiedAt).toBeInstanceOf(Date);
    await expect(svc.verifyPhoneOtp("u-1", code)).rejects.toMatchObject({ code: "auth.otpCodeFailed", status: 400 });
  });

  it("attempt cap: the 5th wrong code kills the OTP — even the right code then fails", async () => {
    const { svc, tokens, sentSms } = makeVerification({ smsConfigured: true });
    await svc.setPhone("u-1", "01712345678");
    await svc.requestPhoneOtp("u-1");
    const code = /কোড: (\d{6})/.exec(sentSms[0].text)![1];
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) {
      await expect(svc.verifyPhoneOtp("u-1", wrong)).rejects.toMatchObject({ code: "auth.otpCodeFailed", status: 400 });
    }
    const row = tokens.find((t) => t.kind === "phone");
    expect(row.attempts).toBe(5);
    expect(row.usedAt).toBeInstanceOf(Date);
    await expect(svc.verifyPhoneOtp("u-1", code)).rejects.toMatchObject({ code: "auth.otpCodeFailed", status: 400 });
  });

  it("a provider failure returns provider_error, kills the code, verifies nothing", async () => {
    const { svc, tokens, users } = makeVerification({ smsConfigured: true, smsFails: true });
    await svc.setPhone("u-1", "01712345678");
    const out: any = await svc.requestPhoneOtp("u-1");
    expect(out).toEqual({ sent: false, reason: "provider_error" });
    expect(users[0].phoneVerifiedAt).toBeNull();
    const row = tokens.find((t) => t.kind === "phone");
    expect(new Date(row.expiresAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("resend cooldown + hourly cap mirror the shop OTP discipline (429)", async () => {
    const { svc } = makeVerification({ smsConfigured: true });
    await svc.setPhone("u-1", "01712345678");
    await svc.requestPhoneOtp("u-1");
    await expect(svc.requestPhoneOtp("u-1")).rejects.toBeInstanceOf(HttpException);
    try { await svc.requestPhoneOtp("u-1"); } catch (e: any) { expect(e.getStatus()).toBe(429); }
  });
});

// ---------------- Gate matrix ----------------

function makeGuard(opts: { gate?: any; user?: any }) {
  const p: any = {
    systemSetting: {
      findUnique: jest.fn(async ({ where }: any) => (where.key === "emailVerificationGate" && opts.gate !== undefined ? { value: opts.gate } : null)),
    },
    user: { findUnique: jest.fn(async () => opts.user ?? null) },
  };
  const jwt: any = { verifyAsync: async () => ({ sub: "u-1", email: "x@y.com", isSuperAdmin: false, tv: 0 }) };
  const reflector: any = { getAllAndOverride: (key: string) => (key === IS_PUBLIC_KEY ? false : undefined) };
  return new JwtAuthGuard(jwt, reflector, p);
}
function guardCtx(url: string) {
  const req: any = { headers: { authorization: "Bearer tok" }, url, originalUrl: url, method: "GET" };
  return { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => req }) } as any;
}
const SINCE = "2026-10-10T00:00:00.000Z";
const NEW_UNVERIFIED = { emailVerifiedAt: null, createdAt: new Date("2026-10-12T00:00:00Z") };

describe("GC21 email verification gate (JwtAuthGuard)", () => {
  it("enforced + unverified + created after `since` → 403 EMAIL_VERIFICATION_REQUIRED on a tenant route", async () => {
    const guard = makeGuard({ gate: { enforced: true, since: SINCE }, user: NEW_UNVERIFIED });
    const err: any = await guard.canActivate(guardCtx("/organizations")).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toMatchObject({ code: "EMAIL_VERIFICATION_REQUIRED" });
    expect(err.getResponse().message).toContain("যাচাই");
  });

  it("the same user is allowed on /auth/* (me, resend, verify)", async () => {
    const guard = makeGuard({ gate: { enforced: true, since: SINCE }, user: NEW_UNVERIFIED });
    await expect(guard.canActivate(guardCtx("/auth/me"))).resolves.toBe(true);
    await expect(guard.canActivate(guardCtx("/auth/verification/email"))).resolves.toBe(true);
  });

  it("grandfathered user (created before `since`) passes", async () => {
    const guard = makeGuard({ gate: { enforced: true, since: SINCE }, user: { emailVerifiedAt: null, createdAt: new Date("2026-01-01T00:00:00Z") } });
    await expect(guard.canActivate(guardCtx("/organizations"))).resolves.toBe(true);
  });

  it("verified user passes; flag off passes; absent setting passes", async () => {
    const verified = makeGuard({ gate: { enforced: true, since: SINCE }, user: { emailVerifiedAt: new Date(), createdAt: new Date("2026-10-12T00:00:00Z") } });
    await expect(verified.canActivate(guardCtx("/organizations"))).resolves.toBe(true);
    const off = makeGuard({ gate: { enforced: false, since: SINCE }, user: NEW_UNVERIFIED });
    await expect(off.canActivate(guardCtx("/organizations"))).resolves.toBe(true);
    const absent = makeGuard({ gate: undefined, user: NEW_UNVERIFIED });
    await expect(absent.canActivate(guardCtx("/organizations"))).resolves.toBe(true);
  });

  it("fails OPEN when the user lookup errors", async () => {
    const guard = makeGuard({ gate: { enforced: true, since: SINCE }, user: NEW_UNVERIFIED });
    ((guard as any).prisma.user.findUnique as jest.Mock).mockRejectedValue(new Error("db down"));
    await expect(guard.canActivate(guardCtx("/organizations"))).resolves.toBe(true);
  });
});

describe("GC21 me() surface + register hook", () => {
  function makeAuthMe(gate: any, userRow: any) {
    const p: any = {
      user: { findUnique: jest.fn(async () => userRow) },
      systemSetting: { findUnique: jest.fn(async ({ where }: any) => (where.key === "emailVerificationGate" && gate !== undefined ? { value: gate } : null)) },
    };
    return new AuthService(p, {} as any, auditStub);
  }

  it("me() carries the verification fields and verificationRequired for a gated new user", async () => {
    const svc = makeAuthMe({ enforced: true, since: SINCE }, {
      id: "u-1", email: "x@y.com", name: "X", isSuperAdmin: false,
      createdAt: new Date("2026-10-12T00:00:00Z"), emailVerifiedAt: null, phoneVerifiedAt: null, phone: null,
    });
    const me: any = await svc.me("u-1");
    expect(me.verificationRequired).toBe(true);
    expect(me.emailVerifiedAt).toBeNull();
    expect(me.phone).toBeNull();
    const grandfathered = makeAuthMe({ enforced: true, since: SINCE }, {
      id: "u-2", email: "o@y.com", name: "O", isSuperAdmin: false,
      createdAt: new Date("2026-01-01T00:00:00Z"), emailVerifiedAt: null, phoneVerifiedAt: null, phone: "+8801712345678",
    });
    expect((await grandfathered.me("u-2") as any).verificationRequired).toBe(false);
  });

  it("register fires the verification email fire-and-forget and still issues the token when it fails", async () => {
    const users: any[] = [];
    const p: any = {
      user: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => { const u = { id: "u-new", ...data }; users.push(u); return u; }),
      },
      systemSetting: { findUnique: jest.fn(async () => null) },
    };
    const jwt: any = { signAsync: async () => "tok" };
    const failingVerification: any = { requestEmailVerification: jest.fn(async () => { throw new Error("smtp down"); }) };
    const svc = new AuthService(p, jwt, auditStub, failingVerification);
    const out: any = await svc.register({ name: "New", email: "new@shop.com", password: "password123" } as any);
    expect(out.accessToken).toBe("tok");
    await new Promise((r) => setImmediate(r));
    expect(failingVerification.requestEmailVerification).toHaveBeenCalledWith("u-new");
  });
});

// ---------------- Merchant verification + storage ----------------

function makeOrgWorld(profile: any) {
  const org: any = {
    id: "org-1", name: "আমার দোকান", slug: "amar-dokan", creditMinor: 0n,
    verificationStatus: "unverified", verificationNote: null, verificationSubmittedAt: null,
  };
  const assets = [
    { organizationId: "org-1", sizeBytes: 1000 },
    { organizationId: "org-1", sizeBytes: 2500 },
    { organizationId: "org-2", sizeBytes: 9999 },
  ];
  const p: any = {
    organization: {
      findUnique: jest.fn(async ({ where }: any) => (where.id === "org-1" ? org : null)),
      update: jest.fn(async ({ data }: any) => { Object.assign(org, data); return org; }),
    },
    businessProfile: { findUnique: jest.fn(async () => profile) },
    mediaAsset: {
      aggregate: jest.fn(async ({ where }: any) => {
        const rows = assets.filter((a) => a.organizationId === where.organizationId);
        return { _sum: { sizeBytes: rows.reduce((s, a) => s + a.sizeBytes, 0) }, _count: { _all: rows.length } };
      }),
    },
  };
  return { p, org };
}
const FULL_PROFILE = { address: "বাড়ি ১, রোড ২, খুলনা", businessAddress: null, contactPhone: "01712345678", contactEmail: null, tradeLicenseNo: "TRAD-123" };

describe("GC21 merchant verification workflow", () => {
  it("submit with missing pieces → 400 listing them in Bengali; org stays unverified", async () => {
    const { p, org } = makeOrgWorld({ address: null, businessAddress: null, contactPhone: null, contactEmail: null, tradeLicenseNo: null });
    const svc = new OrganizationsService(p, auditStub);
    const err: any = await svc.submitVerification("org-1", "u-1").catch((e) => e);
    expect(err).toMatchObject({ code: "organizations.verificationInfoMissing", status: 400 });
    const body = err.extra;
    expect(body.missing).toEqual(expect.arrayContaining(["ব্যবসার ঠিকানা", "যোগাযোগের ফোন বা ইমেইল", "ট্রেড লাইসেন্স নম্বর"]));
    expect(org.verificationStatus).toBe("unverified");
  });

  it("submit complete → pending + stamp + audit; admin approve → verified; resubmit after reject works", async () => {
    const { p, org } = makeOrgWorld({ ...FULL_PROFILE });
    const orgs = new OrganizationsService(p, auditStub);
    const submitted: any = await orgs.submitVerification("org-1", "u-1");
    expect(submitted.verificationStatus).toBe("pending");
    expect(submitted.verificationSubmittedAt).toBeInstanceOf(Date);

    const admin = new AdminService(p, auditStub);
    // Reject without a note is refused — the merchant needs the reason.
    await expect(admin.reviewOrgVerification({ id: "admin-1" }, "org-1", "reject", "")).rejects.toMatchObject({ status: 400 });
    const rejected: any = await admin.reviewOrgVerification({ id: "admin-1" }, "org-1", "reject", "ট্রেড লাইসেন্স নম্বরটি পড়া যাচ্ছে না");
    expect(rejected.verificationStatus).toBe("rejected");
    expect(rejected.verificationNote).toContain("পড়া যাচ্ছে না");
    expect(org.verificationStatus).toBe("rejected");

    // Merchant fixes + resubmits from rejected → pending again.
    const again: any = await orgs.submitVerification("org-1", "u-1");
    expect(again.verificationStatus).toBe("pending");
    expect(again.verificationNote).toBeNull();

    const approved: any = await admin.reviewOrgVerification({ id: "admin-1" }, "org-1", "approve");
    expect(approved.verificationStatus).toBe("verified");
    // A decided org cannot be re-decided; a verified org cannot resubmit.
    await expect(admin.reviewOrgVerification({ id: "admin-1" }, "org-1", "approve")).rejects.toBeInstanceOf(ApiException);
    await expect(orgs.submitVerification("org-1", "u-1")).rejects.toBeInstanceOf(ApiException);
  });

  it("businessAddress alone satisfies the address requirement", async () => {
    const { p } = makeOrgWorld({ address: null, businessAddress: "দোকান ৫, মার্কেট, ঢাকা", contactPhone: null, contactEmail: "a@b.com", tradeLicenseNo: "T-1" });
    const svc = new OrganizationsService(p, auditStub);
    const out: any = await svc.submitVerification("org-1", "u-1");
    expect(out.verificationStatus).toBe("pending");
  });
});

describe("GC21 storage usage", () => {
  it("sums MediaAsset.sizeBytes for the org only, BigInt-safe as a string, with the meteredFrom note", async () => {
    const { p } = makeOrgWorld(FULL_PROFILE);
    const usage = await storageUsageForOrg(p, "org-1");
    expect(usage.storageBytes).toBe("3500");
    expect(usage.assetCount).toBe(2);
    expect(usage.meteredFrom).toBe(STORAGE_METERED_FROM);
    expect(STORAGE_METERED_FROM).toBe("মিডিয়া লাইব্রেরিতে রেকর্ডকৃত আপলোড থেকে হিসাব");
    const svc = new OrganizationsService(p, auditStub);
    await expect(svc.storageUsage("org-1")).resolves.toMatchObject({ storageBytes: "3500" });
    await expect(svc.storageUsage("org-missing")).rejects.toThrow();
  });
});
