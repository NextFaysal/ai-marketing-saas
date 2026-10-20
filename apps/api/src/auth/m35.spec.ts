import { BadRequestException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { AuthService } from "./auth.service";
import { totp } from "../common/totp";

/** Milestone 35 (Phase N1): self-service TOTP for tenant users. */
function makeAuth() {
  const users: any[] = [{ id: "u-1", email: "tenant@x.com", name: "Tenant", isSuperAdmin: false, status: "ACTIVE", tokenVersion: 0, totpEnabled: false, totpSecretEncrypted: null }];
  const p: any = {
    user: {
      findUnique: async ({ where }: any) => users.find((u) => u.id === where.id || u.email === where.email) ?? null,
      update: async ({ where, data }: any) => {
        const u = users.find((x) => x.id === where.id);
        Object.assign(u, data);
        return u;
      },
    },
  };
  const jwt: any = { signAsync: async () => "signed-token" };
  const auditEntries: any[] = [];
  const audit: any = { log: async (e: any) => { auditEntries.push(e); } };
  return { svc: new AuthService(p, jwt, audit), users, auditEntries };
}

describe("M35 tenant TOTP self-service", () => {
  it("enrol -> confirm with a real code -> login challenge machinery sees it enabled; disable requires a valid code", async () => {
    const { svc, users, auditEntries } = makeAuth();
    const before = await svc.totpStatus("u-1");
    expect(before.totpEnabled).toBe(false);

    const enrolled = await svc.totpEnroll("u-1");
    expect(enrolled.secret.length).toBeGreaterThanOrEqual(16);
    expect(enrolled.otpauthUrl).toContain("otpauth://totp/");
    expect(users[0].totpEnabled).toBe(false); // not enabled until confirmed
    expect(users[0].totpSecretEncrypted).not.toContain(enrolled.secret); // stored encrypted

    await expect(svc.totpConfirm("u-1", "000000")).rejects.toBeInstanceOf(ApiException);
    const code = totp(enrolled.secret);
    const confirmed = await svc.totpConfirm("u-1", code);
    expect(confirmed.totpEnabled).toBe(true);
    expect((await svc.totpStatus("u-1")).totpEnabled).toBe(true);

    await expect(svc.totpEnroll("u-1")).rejects.toBeInstanceOf(ApiException); // already enabled
    await expect(svc.totpDisable("u-1", "000000")).rejects.toBeInstanceOf(ApiException);
    const off = await svc.totpDisable("u-1", totp(enrolled.secret));
    expect(off.totpEnabled).toBe(false);
    expect(users[0].totpSecretEncrypted).toBeNull();
    expect(auditEntries.map((e: any) => e.action)).toEqual(
      expect.arrayContaining(["auth.totp_enroll_started", "auth.totp_enabled", "auth.totp_disabled"]),
    );
  });

  it("confirm without enrolment is refused", async () => {
    const { svc } = makeAuth();
    await expect(svc.totpConfirm("u-1", "123456")).rejects.toBeInstanceOf(ApiException);
  });
});
