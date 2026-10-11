import { ForbiddenException } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { SupportService } from "../support/support.service";
import { TenantGuard } from "../common/tenant.guard";

/** Milestone 38 (Admin Phase A2): self-contained fakes, same pattern as m37.spec. */
function match(row: any, where: any = {}): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR") { if (!(v as any[]).some((w: any) => match(row, w))) return false; continue; }
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("gte" in (v as any)) { if (!(new Date(row[k]).getTime() >= new Date((v as any).gte).getTime())) return false; }
      else if ("in" in (v as any)) { if (!(v as any).in.includes(row[k])) return false; }
      else return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}
let seq = 0;
function table(seed: any[] = []) {
  const rows = [...seed];
  const sortBy = (out: any[], orderBy: any) => {
    if (!orderBy) return out;
    const [key, dir] = Object.entries(orderBy)[0] as [string, string];
    return [...out].sort((a, b) => {
      const d = new Date(a[key]).getTime() - new Date(b[key]).getTime();
      return dir === "desc" ? -d : d;
    });
  };
  return {
    rows,
    findMany: async (args: any = {}) => {
      let out = rows.filter((r) => match(r, args.where ?? {}));
      out = sortBy(out, args.orderBy);
      if (args.take) out = out.slice(0, args.take);
      return out;
    },
    findFirst: async (args: any = {}) => {
      const out = sortBy(rows.filter((r) => match(r, args.where ?? {})), args.orderBy ?? { createdAt: "desc" });
      return out[0] ?? null;
    },
    findUnique: async ({ where }: any) => rows.find((r) =>
      (where.id !== undefined && r.id === where.id) ||
      (where.organizationId !== undefined && r.organizationId === where.organizationId)) ?? null,
    count: async (args: any = {}) => rows.filter((r) => match(r, args.where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), lastMessageAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
  };
}

const ADMIN: any = { id: "admin-1", email: "root@platform.local", isSuperAdmin: true, adminTier: "SUPER" };
const AUDIT: any = { log: jest.fn(async () => undefined) };

function makePrisma() {
  const p: any = {
    organization: table([
      { id: "org-1", name: "Acme", status: "ACTIVE", createdAt: new Date() },
      { id: "org-2", name: "Beta", status: "ACTIVE", createdAt: new Date() },
    ]),
    user: table([
      { id: "owner-1", email: "owner@acme.test", name: "Owner", status: "ACTIVE", tokenVersion: 0 },
    ]),
    membership: table([
      { id: "m-1", userId: "owner-1", organizationId: "org-1", role: "OWNER", status: "ACTIVE", user: { email: "owner@acme.test" } },
    ]),
    subscription: table([
      { id: "s-1", organizationId: "org-1", plan: "GROWTH", status: "ACTIVE", createdAt: new Date(), updatedAt: new Date(), currentPeriodEnd: null },
    ]),
    auditLog: table([]),
    // AP2: startViewAs registers a server-side session row.
    viewAsSession: table([]),
    saasPayment: table([]),
    order: table([]),
    channelConversation: table([]),
    integration: table([]),
    syncJob: table([]),
    store: table([]),
    product: table([]),
    adAccount: table([]),
    campaignPlan: table([]),
    businessProfile: table([]),
    supportTicket: table([]),
    supportTicketMessage: table([]),
  };
  return p;
}

describe("Milestone 38 — support tickets", () => {
  it("tenant opens a ticket; admin replies (email honestly unconfigured) and the tenant reply reopens a resolved ticket", async () => {
    const p = makePrisma();
    const support = new SupportService(p as any, AUDIT);
    const created: any = await support.createTicket("org-1", "owner-1", { subject: "Sync হচ্ছে না", body: "কাল থেকে অর্ডার আসছে না" });
    expect(created.status).toBe("open");
    expect(created.messages).toHaveLength(1);

    await expect(support.getTicket("org-2", created.id)).rejects.toThrow(/not found/i);

    const queue: any[] = await support.listTicketsAdmin({});
    expect(queue[0].subject).toBe("Sync হচ্ছে না");
    expect(queue[0].organizationName).toBe("Acme");
    expect(queue[0].messageCount).toBe(1);

    const replied: any = await support.replyAsAdmin(ADMIN, created.id, "দেখছি, কিছুক্ষণের মধ্যে ঠিক হয়ে যাবে");
    expect(replied.message.authorKind).toBe("admin");
    expect(replied.emailSent).toBe(0);
    expect(replied.emailError).toMatch(/not configured/i);
    const after: any = await support.getTicket("org-1", created.id);
    expect(after.status).toBe("pending");
    expect(after.messages).toHaveLength(2);

    await support.updateAsAdmin(ADMIN, created.id, { status: "resolved" });
    await support.replyAsTenant("org-1", "owner-1", created.id, "এখনও হয়নি");
    const reopened: any = await support.getTicket("org-1", created.id);
    expect(reopened.status).toBe("open");
  });
});

describe("Milestone 38 — view-as", () => {
  function makeSvc() {
    const p = makePrisma();
    const signed: any[] = [];
    const fakeJwt: any = { signAsync: async (payload: any, opts: any) => { signed.push({ payload, opts }); return "signed-token"; } };
    return { svc: new AdminService(p as any, AUDIT, fakeJwt), signed };
  }

  it("issues a 30-minute READ token bound to the org, as the OWNER, never as super admin", async () => {
    const { svc, signed } = makeSvc();
    const out: any = await svc.startViewAs(ADMIN, "SUPPORT", "org-1", { mode: "read", reason: "sync issue debug" });
    expect(out.mode).toBe("read");
    expect(out.targetUser.email).toBe("owner@acme.test");
    expect(signed[0].opts.expiresIn).toBe("30m");
    expect(signed[0].payload.sub).toBe("owner-1");
    expect(signed[0].payload.isSuperAdmin).toBe(false);
    expect(signed[0].payload.viewAs).toMatchObject({ orgId: "org-1", mode: "read", adminId: "admin-1" });
  });

  it("write sessions are SUPER-only and a reason is mandatory", async () => {
    const { svc } = makeSvc();
    await expect(svc.startViewAs(ADMIN, "SUPPORT", "org-1", { mode: "write", reason: "fix needed" })).rejects.toBeInstanceOf(ForbiddenException);
    const ok: any = await svc.startViewAs(ADMIN, "SUPER", "org-1", { mode: "write", reason: "fix needed" });
    expect(ok.mode).toBe("write");
    await expect(svc.startViewAs(ADMIN, "SUPER", "org-1", { mode: "read", reason: "   " })).rejects.toThrow(/reason/i);
  });

  it("TenantGuard enforces the view-as org binding and read-only mode", async () => {
    const membership = { status: "ACTIVE", role: "OWNER" };
    const mk = (viewAs: any, method = "GET", orgId = "org-1") => {
      const req: any = { params: { organizationId: orgId }, headers: {}, method, url: `/organizations/${orgId}/products`, user: { userId: "owner-1", isSuperAdmin: false, viewAs } };
      // AP2: the guard also requires the live session row.
      const liveSession = { id: "sess-m38", organizationId: "org-1", revokedAt: null, expiresAt: new Date(Date.now() + 10 * 60000) };
      return { ctx: { switchToHttp: () => ({ getRequest: () => req }) } as any, prisma: { membership: { findUnique: async () => membership }, viewAsSession: { findUnique: async () => liveSession } } as any };
    };
    const va = { adminId: "admin-1", orgId: "org-1", mode: "read", sessionId: "sess-m38" };
    { const { ctx, prisma } = mk(va); await expect(new TenantGuard(prisma).canActivate(ctx)).resolves.toBe(true); }
    { const { ctx, prisma } = mk(va, "POST"); await expect(new TenantGuard(prisma).canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException); }
    { const { ctx, prisma } = mk(va, "GET", "org-2"); await expect(new TenantGuard(prisma).canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException); }
    { const { ctx, prisma } = mk({ ...va, mode: "write" }, "POST"); await expect(new TenantGuard(prisma).canActivate(ctx)).resolves.toBe(true); }
  });
});

describe("Milestone 38 — org 360, alerts, onboarding board", () => {
  it("timeline360 merges orders and tickets into the org history", async () => {
    const p = makePrisma();
    p.order.rows.push({ id: "o-1", organizationId: "org-1", externalNumber: "1024", status: "processing", totalMinor: 125000n, createdAt: new Date() });
    const support = new SupportService(p as any, AUDIT);
    await support.createTicket("org-1", "owner-1", { subject: "একটি সমস্যা", body: "বিস্তারিত" });
    const timeline: any = await new AdminService(p as any, AUDIT).orgTimeline360("org-1");
    const kinds = timeline.events.map((e: any) => e.kind);
    expect(kinds).toContain("order");
    expect(kinds).toContain("ticket");
    expect(timeline.events.find((e: any) => e.kind === "order").title).toContain("1024");
  });

  it("alerts surface broken integrations and past-due subscriptions", async () => {
    const p = makePrisma();
    p.integration.rows.push({ id: "int-bad", organizationId: "org-1", provider: "woocommerce", status: "ERROR", lastError: "401 from store", updatedAt: new Date() });
    p.subscription.rows[0].status = "PAST_DUE";
    const alerts: any[] = await new AdminService(p as any, AUDIT).alertsBoard();
    const kinds = alerts.map((a) => a.kind);
    expect(kinds).toContain("integration_error");
    expect(kinds).toContain("past_due");
    expect(alerts.find((a) => a.kind === "integration_error").detail).toContain("401 from store");
  });

  it("onboarding board reports per-step truth for a fresh org", async () => {
    const p = makePrisma();
    const board: any[] = await new AdminService(p as any, AUDIT).onboardingBoard();
    const acme = board.find((r) => r.organizationId === "org-1");
    expect(acme.total).toBe(7);
    expect(acme.completed).toBe(0);
    expect(acme.stuckAt).toBe("ব্যবসায়িক প্রোফাইল");
  });

  it("an incomplete org's nudge reaches the mailer (unconfigured = honest error)", async () => {
    const p = makePrisma();
    const svc = new AdminService(p as any, AUDIT);
    await expect(svc.nudgeOrg(ADMIN, "org-1", "onboarding")).rejects.toThrow(/not configured/i);
  });
});
