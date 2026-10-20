import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { OrganizationsService } from "./organizations.service";

/**
 * Milestone 34 (Phase N1) — tenant billing + email invitations.
 * Fake Prisma tables follow the codebase's hand-rolled pattern.
 * SMTP is unconfigured in tests, so invitations must honestly
 * report emailSent: false while still returning a shareable link.
 */
function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (k === "userId_organizationId") {
      const c = v as any;
      if (row.userId !== c.userId || row.organizationId !== c.organizationId) return false;
      continue;
    }
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const cond = v as any;
      const rv = row[k];
      if ("gt" in cond && !(new Date(rv).getTime() > new Date(cond.gt).getTime())) return false;
      if ("gte" in cond && !(new Date(rv).getTime() >= new Date(cond.gte).getTime())) return false;
      if ("not" in cond && rv === cond.not) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function table(seed: any[] = []) {
  const rows = [...seed];
  let seq = 0;
  return {
    rows,
    findUnique: async ({ where }: any) => rows.find((r) => matchWhere(r, where)) ?? null,
    findFirst: async ({ where, orderBy }: any) => {
      const found = rows.filter((r) => matchWhere(r, where));
      if (orderBy?.createdAt === "desc") found.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      return found[0] ?? null;
    },
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let found = rows.filter((r) => matchWhere(r, where));
      if (orderBy?.createdAt === "desc") found.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      if (take) found = found.slice(0, take);
      return found;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)).length,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("row not found");
      Object.assign(row, data);
      return row;
    },
  };
}

function makeService() {
  const org = { id: "org-1", name: "Demo Shop", slug: "demo", aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null };
  const p: any = {
    organization: table([org]),
    user: table([
      { id: "u-owner", email: "owner@x.com", name: "Owner" },
      { id: "u-new", email: "new@x.com", name: "New Person" },
    ]),
    membership: table([{ id: "m-1", userId: "u-owner", organizationId: "org-1", role: "OWNER", status: "ACTIVE" }]),
    memberInvitation: table(),
    subscription: table([
      { id: "s-1", organizationId: "org-1", plan: "GROWTH", status: "ACTIVE", currentPeriodEnd: new Date("2026-11-10"), createdAt: new Date("2026-10-10") },
    ]),
    saasPayment: table([
      { id: "pay-1", organizationId: "org-1", amountMinor: 300000n, currency: "BDT", method: "bkash", reference: "TRX1", periodStart: null, periodEnd: null, note: null, createdAt: new Date("2026-10-10") },
    ]),
    adminNote: table(),
    aIUsageRecord: table([{ id: "ai-1", organizationId: "org-1", createdAt: new Date() }]),
    broadcast: table(),
  };
  const auditEntries: any[] = [];
  const audit: any = { log: async (e: any) => { auditEntries.push(e); } };
  return { svc: new OrganizationsService(p, audit), p, auditEntries };
}

const owner = { userId: "u-owner", email: "owner@x.com", isSuperAdmin: false };

describe("M34 tenant billing", () => {
  it("assembles plan, price, limits, usage and payments from real rows", async () => {
    const { svc } = makeService();
    const b = await svc.getBilling("org-1");
    expect(b.subscription?.plan).toBe("GROWTH");
    expect(b.subscription?.priceMinor).toBe("300000");
    expect(b.limits.plan).toBe("GROWTH");
    expect(b.limits.seats).toBe(10);
    expect(b.usage.seatsUsed).toBe(1);
    expect(b.usage.aiCallsToday).toBe(1);
    expect(b.payments[0].amountMinor).toBe("300000");
    expect(b.plans.map((x: any) => x.tier)).toEqual(["FREE", "STARTER", "GROWTH", "AGENCY"]);
  });

  it("plan change request writes an admin note + audit and refuses the current plan", async () => {
    const { svc, p, auditEntries } = makeService();
    await expect(svc.requestPlanChange("org-1", "u-owner", { requestedPlan: "GROWTH" })).rejects.toBeInstanceOf(ApiException);
    await expect(svc.requestPlanChange("org-1", "u-owner", { requestedPlan: "PRO" })).rejects.toBeInstanceOf(ApiException);
    const out = await svc.requestPlanChange("org-1", "u-owner", { requestedPlan: "AGENCY", note: "growing" });
    expect(out.ok).toBe(true);
    expect(p.adminNote.rows[0].body).toContain("GROWTH -> AGENCY");
    expect(auditEntries.some((e: any) => e.action === "org.plan_change_requested")).toBe(true);
  });
});

describe("M34 email invitations", () => {
  it("stores only the token hash, returns the link once, and honestly reports emailSent=false without SMTP", async () => {
    const { svc, p } = makeService();
    const out = await svc.createEmailInvitation("org-1", "u-owner", { email: "New@X.com", role: "SUPPORT_AGENT" });
    expect(out.emailSent).toBe(false);
    expect(out.inviteUrl).toContain("/accept-invite?token=");
    const raw = out.inviteUrl.split("token=")[1];
    expect(raw.length).toBeGreaterThan(10);
    const stored = p.memberInvitation.rows[0];
    expect(stored.email).toBe("new@x.com");
    expect(stored.tokenHash).not.toBe(raw);
    expect(JSON.stringify(stored)).not.toContain(raw);
    expect(stored.status).toBe("pending");
  });

  it("refuses OWNER role, duplicates and existing members", async () => {
    const { svc } = makeService();
    await expect(svc.createEmailInvitation("org-1", "u-owner", { email: "a@b.com", role: "OWNER" })).rejects.toBeInstanceOf(ApiException);
    await svc.createEmailInvitation("org-1", "u-owner", { email: "dup@x.com", role: "VIEWER" });
    await expect(svc.createEmailInvitation("org-1", "u-owner", { email: "dup@x.com", role: "VIEWER" })).rejects.toBeInstanceOf(ApiException);
    await expect(svc.createEmailInvitation("org-1", "u-owner", { email: "owner@x.com", role: "VIEWER" })).rejects.toBeInstanceOf(ApiException);
  });

  it("counts pending invitations toward the seat limit (FREE plan = 2 seats)", async () => {
    const { svc, p } = makeService();
    // Move the org to FREE (2 seats): 1 active member already.
    p.subscription.rows[0].plan = "FREE";
    await svc.createEmailInvitation("org-1", "u-owner", { email: "one@x.com", role: "VIEWER" });
    await expect(svc.createEmailInvitation("org-1", "u-owner", { email: "two@x.com", role: "VIEWER" })).rejects.toBeInstanceOf(ApiException);
  });

  it("accepts only for the invited email, creates the membership, and cannot be reused", async () => {
    const { svc, p } = makeService();
    const out = await svc.createEmailInvitation("org-1", "u-owner", { email: "new@x.com", role: "ANALYST" });
    const raw = out.inviteUrl.split("token=")[1];
    const view = await svc.getInvitationForUser({ userId: "u-new", email: "new@x.com" } as any, raw);
    expect(view.emailMatchesAccount).toBe(true);
    expect(view.organizationName).toBe("Demo Shop");
    await expect(svc.acceptInvitation({ userId: "u-owner", email: "owner@x.com" } as any, raw)).rejects.toBeInstanceOf(ApiException);
    const accepted = await svc.acceptInvitation({ userId: "u-new", email: "new@x.com" } as any, raw);
    expect(accepted.alreadyMember).toBe(false);
    const membership = p.membership.rows.find((m: any) => m.userId === "u-new");
    expect(membership?.role).toBe("ANALYST");
    expect(p.memberInvitation.rows[0].status).toBe("accepted");
    await expect(svc.acceptInvitation({ userId: "u-new", email: "new@x.com" } as any, raw)).rejects.toBeInstanceOf(ApiException);
  });

  it("REGRESSION (live-found): an invitation can be accepted on the 2-seat FREE plan — it must not count against itself", async () => {
    const { svc, p } = makeService();
    p.subscription.rows[0].plan = "FREE"; // 2 seats; the owner holds 1
    const out = await svc.createEmailInvitation("org-1", "u-owner", { email: "new@x.com", role: "VIEWER" });
    const raw = out.inviteUrl.split("token=")[1];
    const accepted = await svc.acceptInvitation({ userId: "u-new", email: "new@x.com" } as any, raw);
    expect(accepted.alreadyMember).toBe(false);
    expect(p.membership.rows.filter((m: any) => m.organizationId === "org-1").length).toBe(2);
  });

  it("expired and revoked invitations cannot be accepted; resend rotates the token", async () => {
    const { svc, p } = makeService();
    const out = await svc.createEmailInvitation("org-1", "u-owner", { email: "new@x.com", role: "VIEWER" });
    const rawOld = out.inviteUrl.split("token=")[1];
    p.memberInvitation.rows[0].expiresAt = new Date(Date.now() - 3600_000);
    const view = await svc.getInvitationForUser({ userId: "u-new", email: "new@x.com" } as any, rawOld);
    expect(view.status).toBe("expired");
    await expect(svc.acceptInvitation({ userId: "u-new", email: "new@x.com" } as any, rawOld)).rejects.toBeInstanceOf(ApiException);
    const resent = await svc.resendInvitation("org-1", "u-owner", p.memberInvitation.rows[0].id);
    const rawNew = resent.inviteUrl.split("token=")[1];
    expect(rawNew).not.toBe(rawOld);
    await expect(svc.getInvitationForUser({ userId: "u-new", email: "new@x.com" } as any, rawOld)).rejects.toBeInstanceOf(ApiException);
    await svc.revokeInvitation("org-1", "u-owner", p.memberInvitation.rows[0].id);
    await expect(svc.acceptInvitation({ userId: "u-new", email: "new@x.com" } as any, rawNew)).rejects.toBeInstanceOf(ApiException);
  });
});
