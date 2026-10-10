process.env.JWT_SECRET = "test-secret-for-admin-tokens";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
import { hashSync } from "bcryptjs";
import { AdminService } from "./admin.service";
import { SuperAdminGuard } from "../common/super-admin.guard";
import { AuthService } from "../auth/auth.service";

// ---------- richer fake table (OR / contains / startsWith / gte / in / select / paging) ----------
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (k === "OR") return (v as any[]).some((w) => matches(row, w));
    if (k === "AND") return (v as any[]).every((w) => matches(row, w));
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("gte" in v) return new Date(row[k]) >= new Date((v as any).gte);
      if ("lte" in v) return new Date(row[k]) <= new Date((v as any).lte);
      if ("contains" in v) return String(row[k] ?? "").toLowerCase().includes(String((v as any).contains).toLowerCase());
      if ("startsWith" in v) return String(row[k] ?? "").startsWith((v as any).startsWith);
      return true;
    }
    return row[k] === v;
  });
}
function applySelect(row: any, select: any) {
  if (!select) return row;
  const out: any = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
  return out;
}
function table(name: string, rows: any[] = []) {
  let seq = 0;
  const t: any = {
    rows,
    findFirst: async ({ where, orderBy }: any = {}) => {
      let out = rows.filter((r) => matches(r, where));
      if (orderBy?.createdAt === "desc") out = [...out].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      return out[0] ?? null;
    },
    findUnique: async ({ where, select }: any) => {
      const row = rows.find((r) => r.id === where.id || (where.email && r.email === where.email) || (where.key && r.key === where.key)
        || (where.organizationId_key && r.organizationId === where.organizationId_key.organizationId && r.key === where.organizationId_key.key)
        || (where.userId_organizationId && r.userId === where.userId_organizationId.userId && r.organizationId === where.userId_organizationId.organizationId));
      return row ? applySelect(row, select) : null;
    },
    findMany: async ({ where, orderBy, skip = 0, take, select }: any = {}) => {
      let out = rows.filter((r) => matches(r, where));
      if (orderBy?.createdAt === "desc") out = [...out].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      out = out.slice(skip, take != null ? skip + take : undefined);
      return out.map((r) => applySelect(r, select));
    },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) { for (const [k, v] of Object.entries(data)) row[k] = (v as any)?.increment != null ? (row[k] ?? 0) + (v as any).increment : v; }
      return row;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where)).length,
    upsert: async ({ where, create, update }: any) => {
      const keyOf = (w: any) => w.key ?? w.id ?? (w.organizationId_key ? `${w.organizationId_key.organizationId}:${w.organizationId_key.key}` : null);
      const target = keyOf(where);
      const found = rows.find((r: any) => (target != null && (r.key === target || r.id === target || `${r.organizationId}:${r.key}` === target)));
      if (found) { Object.assign(found, update); return found; }
      const row = { id: `${name}-up-${rows.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(row); return row;
    },
    delete: async ({ where }: any) => { const i = rows.findIndex((r: any) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return {}; },
  };
  return t;
}

function basePrisma() {
  const t: any = {
    user: table("user"), organization: table("org"), membership: table("member"),
    auditLog: table("audit"), subscription: table("sub"), integration: table("int"),
    product: table("prod"), order: table("order"), channelConversation: table("conv"),
    campaignPlan: table("plan"), dailyAdMetric: table("metric"), aIUsageRecord: table("ai"),
    syncJob: table("sync"), automationRun: table("run"), adminNote: table("note"),
    systemSetting: table("setting"), orgFeatureFlag: table("flag"), announcement: table("ann"),
    scheduledJob: table("sched"), messageDelivery: table("delivery"), broadcast: table("bcast"),
    saasPayment: table("pay"),
    workflowRun: table("wfrun"), courierShipment: table("ship"), channelMessage: table("msg"),
    $queryRaw: async () => [{ "?column?": 1 }],
  };
  return t;
}
const mkAudit = (logs: any[]) => ({ log: async (input: any) => { logs.push(input); } }) as any;
const SUPER = { id: "admin-1", email: "root@x.com", isSuperAdmin: true, adminTier: "SUPER", status: "ACTIVE", tokenVersion: 0 };

function seedUsers(p: any) {
  p.user.rows.push(
    { ...SUPER, passwordHash: hashSync("rootpass123", 10), createdAt: new Date() },
    { id: "admin-2", email: "help@x.com", isSuperAdmin: true, adminTier: "SUPPORT", status: "ACTIVE", tokenVersion: 0, createdAt: new Date() },
    { id: "u-1", email: "tenant@x.com", name: "Tenant One", isSuperAdmin: false, adminTier: null, status: "ACTIVE", tokenVersion: 0, createdAt: new Date() },
    { id: "u-2", email: "bad@x.com", name: "Suspended Sam", isSuperAdmin: false, adminTier: null, status: "SUSPENDED", tokenVersion: 0, passwordHash: hashSync("sampass123", 10), createdAt: new Date() },
  );
  p.organization.rows.push({ id: "org-1", name: "Demo Store", slug: "demo", status: "ACTIVE", country: "BD", currency: "BDT", createdAt: new Date() });
  p.membership.rows.push({ id: "m-1", userId: "u-1", organizationId: "org-1", role: "OWNER", status: "ACTIVE" });
}

describe("SuperAdminGuard", () => {
  const ctxFor = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null }) as any;
  it("rejects unauthenticated and non-admin requests", async () => {
    const p = basePrisma(); seedUsers(p);
    const guard = new SuperAdminGuard(p, { getAllAndOverride: () => undefined } as any);
    await expect(guard.canActivate(ctxFor({ headers: {} }))).rejects.toThrow(/Authentication required/);
    await expect(guard.canActivate(ctxFor({ user: { userId: "u-1", tv: 0 }, headers: {} }))).rejects.toThrow(/Platform admin access required/);
  });
  it("rejects a revoked admin whose JWT still claims admin", async () => {
    const p = basePrisma(); seedUsers(p);
    p.user.rows.find((r: any) => r.id === "admin-2").isSuperAdmin = false; // revoked in DB after token issued
    const guard = new SuperAdminGuard(p, { getAllAndOverride: () => undefined } as any);
    await expect(guard.canActivate(ctxFor({ user: { userId: "admin-2", tv: 0 }, headers: {} }))).rejects.toThrow(/Platform admin access required/);
  });
  it("rejects a stale token version (session revoked)", async () => {
    const p = basePrisma(); seedUsers(p);
    p.user.rows.find((r: any) => r.id === "admin-1").tokenVersion = 3;
    const guard = new SuperAdminGuard(p, { getAllAndOverride: () => undefined } as any);
    await expect(guard.canActivate(ctxFor({ user: { userId: "admin-1", tv: 0 }, headers: {} }))).rejects.toThrow(/revoked/);
  });
  it("admits a live admin and enforces tier restrictions", async () => {
    const p = basePrisma(); seedUsers(p);
    const open = new SuperAdminGuard(p, { getAllAndOverride: () => undefined } as any);
    const req: any = { user: { userId: "admin-2", tv: 0 }, headers: {} };
    await expect(open.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(req.adminTier).toBe("SUPPORT");
    const superOnly = new SuperAdminGuard(p, { getAllAndOverride: () => ["SUPER"] } as any);
    await expect(superOnly.canActivate(ctxFor({ user: { userId: "admin-2", tv: 0 }, headers: {} }))).rejects.toThrow(/SUPER/);
  });
});

describe("AdminService", () => {
  it("suspend requires a reason, blocks self-suspension, and audits with before/after", async () => {
    const p = basePrisma(); seedUsers(p);
    const logs: any[] = [];
    const svc = new AdminService(p, mkAudit(logs));
    await expect(svc.setUserStatus(SUPER as any, "SUPER", "u-1", "SUSPENDED", "", "1.2.3.4")).rejects.toThrow(/reason/i);
    await expect(svc.setUserStatus(SUPER as any, "SUPER", "admin-1", "SUSPENDED", "self test")).rejects.toThrow(/your own/);
    const out = await svc.setUserStatus(SUPER as any, "SUPER", "u-1", "SUSPENDED", "chargeback abuse", "1.2.3.4");
    expect(out.status).toBe("SUSPENDED");
    expect(p.user.rows.find((r: any) => r.id === "u-1").status).toBe("SUSPENDED");
    const entry = logs.find((l) => l.action === "admin.user_status");
    expect(entry.metadata).toMatchObject({ from: "ACTIVE", to: "SUSPENDED", reason: "chargeback abuse" });
    expect(entry.ipAddress).toBe("1.2.3.4");
  });
  it("SUPPORT tier cannot change another admin's status", async () => {
    const p = basePrisma(); seedUsers(p);
    const svc = new AdminService(p, mkAudit([]));
    await expect(svc.setUserStatus({ id: "admin-2" } as any, "SUPPORT", "admin-1", "SUSPENDED", "nope")).rejects.toThrow(/SUPER tier/);
  });
  it("grant validates tier and active status; revoke protects the last SUPER and bumps token version", async () => {
    const p = basePrisma(); seedUsers(p);
    const svc = new AdminService(p, mkAudit([]));
    await expect(svc.grantAdmin(SUPER as any, "u-1", "WIZARD", "x reason")).rejects.toThrow(/tier/);
    const granted = await svc.grantAdmin(SUPER as any, "u-1", "FINANCE", "handles billing");
    expect(granted.adminTier).toBe("FINANCE");
    await expect(svc.revokeAdmin(SUPER as any, "admin-1", "self")).rejects.toThrow(/own admin/);
    // admin-1 is the only SUPER left (u-1 is FINANCE) -> cannot be revoked by admin-2 even though not self
    await expect(svc.revokeAdmin({ id: "admin-2" } as any, "admin-1", "cleanup")).rejects.toThrow(/last active super admin/);
    const before = p.user.rows.find((r: any) => r.id === "u-1").tokenVersion;
    await svc.revokeAdmin(SUPER as any, "u-1", "role changed");
    expect(p.user.rows.find((r: any) => r.id === "u-1").isSuperAdmin).toBe(false);
    expect(p.user.rows.find((r: any) => r.id === "u-1").tokenVersion).toBe(before + 1);
  });
  it("org status changes are audited and reason-required", async () => {
    const p = basePrisma(); seedUsers(p);
    const logs: any[] = [];
    const svc = new AdminService(p, mkAudit(logs));
    await expect(svc.setOrgStatus(SUPER as any, "org-1", "SUSPENDED", "")).rejects.toThrow(/reason/i);
    const out = await svc.setOrgStatus(SUPER as any, "org-1", "SUSPENDED", "payment overdue 60d");
    expect(out.status).toBe("SUSPENDED");
    expect(logs.find((l) => l.action === "admin.org_status")?.metadata).toMatchObject({ from: "ACTIVE", to: "SUSPENDED" });
  });
  it("overview aggregates real rows only (campaign-level spend, non-cancelled revenue)", async () => {
    const p = basePrisma(); seedUsers(p);
    const now = new Date();
    p.order.rows.push(
      { id: "o-1", organizationId: "org-1", status: "confirmed", totalMinor: 100000n, createdAt: now },
      { id: "o-2", organizationId: "org-1", status: "cancelled", totalMinor: 50000n, createdAt: now },
    );
    p.dailyAdMetric.rows.push(
      { id: "dm-1", organizationId: "org-1", date: now, spendMinor: 30000n, adExternalId: "" },
      { id: "dm-2", organizationId: "org-1", date: now, spendMinor: 99999n, adExternalId: "ad-9" }, // ad-level: excluded
    );
    const svc = new AdminService(p, mkAudit([]));
    const ov = await svc.overview();
    expect(ov.monthOrders).toBe(1);
    expect(ov.monthOrderRevenueMinor).toBe("100000");
    expect(ov.monthAdSpendMinor).toBe("30000");
    expect(ov.organizations).toBe(1);
  });
  it("force-reset issues a signed one-time token bound to the current token version", async () => {
    const p = basePrisma(); seedUsers(p);
    const svc = new AdminService(p, mkAudit([]));
    const out = await svc.forceReset(SUPER as any, "u-1");
    expect(out.resetPath).toContain("/reset-password?token=");
    const { verifyAdminToken } = await import("../common/admin-token");
    const token = out.resetPath.split("token=")[1];
    expect(verifyAdminToken(token, "pwd-reset")?.sub).toBe("u-1");
    expect(verifyAdminToken(token, "other-purpose")).toBeNull();
  });
});

describe("AuthService suspension", () => {
  it("a suspended user cannot log in even with the right password", async () => {
    const p = basePrisma(); seedUsers(p);
    const auth = new AuthService(p, { signAsync: async () => "tok" } as any, mkAudit([]));
    await expect(auth.login({ email: "bad@x.com", password: "sampass123" } as any)).rejects.toThrow(/suspended/);
    await expect(auth.login({ email: "bad@x.com", password: "wrong" } as any)).rejects.toThrow(/Invalid email or password/);
  });
  it("reset via admin token changes the password and revokes old sessions", async () => {
    const p = basePrisma(); seedUsers(p);
    const logs: any[] = [];
    const svc = new AdminService(p, mkAudit(logs));
    const auth = new AuthService(p, { signAsync: async () => "tok" } as any, mkAudit(logs));
    const { resetPath } = await svc.forceReset(SUPER as any, "u-2");
    const token = resetPath.split("token=")[1];
    const tvBefore = p.user.rows.find((r: any) => r.id === "u-2").tokenVersion;
    await auth.resetPasswordWithAdminToken(token, "brand-new-pass");
    const row = p.user.rows.find((r: any) => r.id === "u-2");
    expect(row.tokenVersion).toBe(tvBefore + 1);
    // token is one-time: its embedded tv no longer matches
    await expect(auth.resetPasswordWithAdminToken(token, "another-pass-1")).rejects.toThrow(/no longer valid/);
  });
});

describe("AdminService Phase B — settings, flags, limits", () => {
  it("settings roundtrip with defaults; unknown keys and malformed kill switches rejected", async () => {
    const p = basePrisma(); seedUsers(p);
    const svc = new AdminService(p, mkAudit([]));
    const before = await svc.getSettings();
    expect(before.signupOpen).toBe(true);
    expect(before.maintenanceMode).toBe(false);
    await expect(svc.updateSettings(SUPER as any, { nope: 1 })).rejects.toThrow(/Unknown setting/);
    await expect(svc.updateSettings(SUPER as any, { killSwitches: { aiDisabledOrgIds: "x", broadcastsPaused: false } })).rejects.toThrow(/killSwitches/);
    const after = await svc.updateSettings(SUPER as any, { maintenanceMode: true, supportContact: "help@qosprey.com" });
    expect(after.maintenanceMode).toBe(true);
    expect(after.supportContact).toBe("help@qosprey.com");
  });
  it("publicStatus shows only an in-window active announcement", async () => {
    const p = basePrisma(); seedUsers(p);
    const svc = new AdminService(p, mkAudit([]));
    await svc.createAnnouncement(SUPER as any, { title: "Future", body: "later", startsAt: new Date(Date.now() + 86400000).toISOString() });
    expect((await svc.publicStatus()).announcement).toBeNull();
    await svc.createAnnouncement(SUPER as any, { title: "Now", body: "visible" });
    expect((await svc.publicStatus()).announcement?.title).toBe("Now");
  });
  it("flags upsert and limits validation (negative rejected, null clears)", async () => {
    const p = basePrisma(); seedUsers(p);
    const svc = new AdminService(p, mkAudit([]));
    const flag = await svc.setOrgFlag(SUPER as any, "org-1", "dayparting", true);
    expect(flag.enabled).toBe(true);
    const flag2 = await svc.setOrgFlag(SUPER as any, "org-1", "dayparting", false);
    expect(flag2.enabled).toBe(false);
    expect(p.orgFeatureFlag.rows).toHaveLength(1);
    await expect(svc.updateOrgLimits(SUPER as any, "org-1", { seatLimit: -1 })).rejects.toThrow(/non-negative/);
    const org = await svc.updateOrgLimits(SUPER as any, "org-1", { seatLimit: 3, aiDailyLimitOverride: 5 });
    expect(org.seatLimit).toBe(3);
    const cleared = await svc.updateOrgLimits(SUPER as any, "org-1", { aiDailyLimitOverride: null });
    expect(cleared.aiDailyLimitOverride).toBeNull();
  });
  it("support view is metadata-first: message bodies never leak; content access needs a reason and is audited", async () => {
    const p = basePrisma(); seedUsers(p);
    p.channelConversation.rows.push({ id: "conv-1", organizationId: "org-1", channel: "whatsapp", status: "open", contactName: "Rahim", updatedAt: new Date() });
    p.channelMessage.rows.push({ id: "msg-1", conversationId: "conv-1", direction: "inbound", body: "SECRET-BODY-TEXT", createdAt: new Date() });
    const logs: any[] = [];
    const svc = new AdminService(p, mkAudit(logs));
    const view = await svc.supportView("org-1");
    expect(JSON.stringify(view)).not.toContain("SECRET-BODY-TEXT");
    expect(view.recentConversations[0].messageCount).toBe(1);
    await expect(svc.supportConversationMessages(SUPER as any, "org-1", "conv-1", "")).rejects.toThrow(/reason/i);
    const access = await svc.supportConversationMessages(SUPER as any, "org-1", "conv-1", "fraud investigation #42");
    expect(access.messages[0].body).toBe("SECRET-BODY-TEXT");
    expect(logs.find((l) => l.action === "admin.support_content_access")?.metadata?.reason).toBe("fraud investigation #42");
  });
  it("usage board aggregates per org", async () => {
    const p = basePrisma(); seedUsers(p);
    p.aIUsageRecord.rows.push({ id: "ai-1", organizationId: "org-1", inputTokens: 10, outputTokens: 5, createdAt: new Date() });
    const svc = new AdminService(p, mkAudit([]));
    const board = await svc.usageBoard();
    expect(board[0]).toMatchObject({ organizationId: "org-1", aiCalls30d: 1, aiTokens30d: 15 });
  });
});

describe("Platform settings enforcement helpers", () => {
  it("effectiveLimits: admin override beats plan, plan beats baseline", async () => {
    const { effectiveLimits } = await import("../common/platform-settings");
    const p = basePrisma(); seedUsers(p);
    p.subscription.rows.push({ id: "sub-1", organizationId: "org-1", plan: "GROWTH", status: "ACTIVE", createdAt: new Date() });
    const fromPlan = await effectiveLimits(p, "org-1", { aiDaily: 200, broadcastCap: 1000 });
    expect(fromPlan).toMatchObject({ aiDaily: 200, broadcastCap: 1000, seats: 10, plan: "GROWTH" });
    p.organization.rows.find((r: any) => r.id === "org-1").aiDailyLimitOverride = 7;
    const overridden = await effectiveLimits(p, "org-1", { aiDaily: 200, broadcastCap: 1000 });
    expect(overridden.aiDaily).toBe(7);
  });
  it("signup gate: registration refused while signups are closed", async () => {
    const p = basePrisma(); seedUsers(p);
    p.systemSetting.rows.push({ key: "signupOpen", value: false });
    const auth = new AuthService(p, { signAsync: async () => "tok" } as any, mkAudit([]));
    await expect(auth.register({ email: "new@x.com", name: "New", password: "password123" } as any)).rejects.toThrow(/closed/);
  });
  it("AI kill switch + per-org cap are enforced by the chat service", async () => {
    const { ChatService } = await import("../ai/chat.service");
    const p = basePrisma(); seedUsers(p);
    p.organization.rows.find((r: any) => r.id === "org-1").aiDailyLimitOverride = 0;
    const chat = new ChatService(p, {} as any, {} as any);
    await expect((chat as any).checkDailyLimit("org-1")).rejects.toThrow(/limit reached/);
    p.systemSetting.rows.push({ key: "killSwitches", value: { aiDisabledOrgIds: ["org-1"], broadcastsPaused: false } });
    await expect((chat as any).checkDailyLimit("org-1")).rejects.toThrow(/disabled/);
  });
  it("seat limit blocks invites beyond the org's seat count", async () => {
    const { OrganizationsService } = await import("../organizations/organizations.service");
    const p = basePrisma(); seedUsers(p);
    p.organization.rows.find((r: any) => r.id === "org-1").seatLimit = 1; // org-1 already has 1 ACTIVE member
    p.user.rows.push({ id: "u-9", email: "nine@x.com", name: "Nine", status: "ACTIVE" });
    const orgs = new OrganizationsService(p, mkAudit([]));
    await expect(orgs.invite("org-1", "u-1", { email: "nine@x.com", role: "SUPPORT_AGENT" } as any)).rejects.toThrow(/seats/);
  });
});

describe("AdminService Phase C — SaaS billing", () => {
  it("subscription update validates plan/status, requires a reason, audits before/after", async () => {
    const p = basePrisma(); seedUsers(p);
    const logs: any[] = [];
    const svc = new AdminService(p, mkAudit(logs));
    await expect(svc.updateSubscription(SUPER as any, "org-1", { plan: "PRO" }, "reason ok")).rejects.toThrow(/plan/);
    await expect(svc.updateSubscription(SUPER as any, "org-1", { plan: "GROWTH" }, "")).rejects.toThrow(/reason/i);
    const created = await svc.updateSubscription(SUPER as any, "org-1", { plan: "GROWTH", status: "ACTIVE", currentPeriodEnd: "2027-01-01" }, "client upgraded at launch");
    expect(created.plan).toBe("GROWTH");
    const updated = await svc.updateSubscription(SUPER as any, "org-1", { status: "PAST_DUE" }, "payment failed twice");
    expect(updated.status).toBe("PAST_DUE");
    expect(p.subscription.rows).toHaveLength(1); // updated in place, not duplicated
    const entry = logs.filter((l) => l.action === "admin.subscription_updated").pop();
    expect(entry.metadata.before.status).toBe("ACTIVE");
    expect(entry.metadata.after.status).toBe("PAST_DUE");
  });
  it("payments validate method/amount/org and are listed with string amounts", async () => {
    const p = basePrisma(); seedUsers(p);
    const svc = new AdminService(p, mkAudit([]));
    await expect(svc.recordPayment(SUPER as any, { organizationId: "org-1", amountMinor: 100, method: "paypal" })).rejects.toThrow(/method/);
    await expect(svc.recordPayment(SUPER as any, { organizationId: "org-1", amountMinor: 0, method: "bkash" })).rejects.toThrow(/positive/);
    await expect(svc.recordPayment(SUPER as any, { organizationId: "ghost", amountMinor: 100, method: "bkash" })).rejects.toThrow(/not found/i);
    const row = await svc.recordPayment(SUPER as any, { organizationId: "org-1", amountMinor: "300000", method: "bkash", reference: "TXN123" });
    expect(row.amountMinor).toBe("300000");
    const list = await svc.listPayments("org-1");
    expect(list[0]).toMatchObject({ amountMinor: "300000", organizationName: "Demo Store" });
  });
  it("payment deletion is audited with a full snapshot", async () => {
    const p = basePrisma(); seedUsers(p);
    const logs: any[] = [];
    const svc = new AdminService(p, mkAudit(logs));
    const row = await svc.recordPayment(SUPER as any, { organizationId: "org-1", amountMinor: 5000, method: "cash" });
    await svc.deletePayment(SUPER as any, row.id, "recorded twice by mistake");
    expect(p.saasPayment.rows).toHaveLength(0);
    expect(logs.find((l) => l.action === "admin.payment_deleted")?.metadata?.snapshot?.amountMinor).toBe("5000");
  });
  it("billing summary: MRR counts ACTIVE only, overdue and collections are real", async () => {
    const p = basePrisma(); seedUsers(p);
    p.organization.rows.push({ id: "org-2", name: "Trial Shop", slug: "trial", status: "ACTIVE", createdAt: new Date() });
    const future = new Date(Date.now() + 20 * 86400000);
    const past = new Date(Date.now() - 5 * 86400000);
    p.subscription.rows.push(
      { id: "sub-1", organizationId: "org-1", plan: "GROWTH", status: "ACTIVE", currentPeriodEnd: future, createdAt: new Date() },
      { id: "sub-2", organizationId: "org-2", plan: "STARTER", status: "TRIALING", currentPeriodEnd: past, createdAt: new Date() },
    );
    const svc = new AdminService(p, mkAudit([]));
    await svc.recordPayment(SUPER as any, { organizationId: "org-1", amountMinor: 300000, method: "bank" });
    const sum = await svc.billingSummary();
    expect(sum.mrrMinor).toBe("300000"); // GROWTH price, ACTIVE only (trial not counted)
    expect(sum.trialingCount).toBe(1);
    expect(sum.overdue).toHaveLength(1);
    expect(sum.overdue[0]).toMatchObject({ organizationId: "org-2", daysOverdue: 5 });
    expect(sum.collectedThisMonthMinor).toBe("300000");
    expect(sum.perPlan).toMatchObject({ GROWTH: 1, STARTER: 1 });
  });
  it("sweepSubscription turns only ended TRIALING/ACTIVE subs PAST_DUE", async () => {
    const { sweepSubscription } = await import("../common/platform-settings");
    const p = basePrisma(); seedUsers(p);
    const past = new Date(Date.now() - 86400000);
    const future = new Date(Date.now() + 86400000);
    p.subscription.rows.push({ id: "sub-t", organizationId: "org-1", plan: "FREE", status: "TRIALING", currentPeriodEnd: past, createdAt: new Date() });
    expect((await sweepSubscription(p, "org-1")).changed).toBe(true);
    expect(p.subscription.rows[0].status).toBe("PAST_DUE");
    expect((await sweepSubscription(p, "org-1")).changed).toBe(false); // already past due
    p.subscription.rows.push({ id: "sub-a", organizationId: "org-2", plan: "GROWTH", status: "ACTIVE", currentPeriodEnd: future, createdAt: new Date() });
    expect((await sweepSubscription(p, "org-2")).changed).toBe(false); // still in period
  });
});

describe("TOTP (RFC 6238)", () => {
  it("matches the RFC test vectors (SHA-1)", async () => {
    const { base32Encode, hotp, verifyTotp } = await import("../common/totp");
    const secret = base32Encode(Buffer.from("12345678901234567890", "ascii"));
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(hotp(secret, 1)).toBe("287082"); // T=59s, 8-digit vector 94287082
    expect(hotp(secret, 37037036)).toBe("081804"); // T=1111111109s, vector 07081804
    expect(verifyTotp(secret, "287082", new Date(59000))).toBe(true);
    expect(verifyTotp(secret, "287082", new Date(89000))).toBe(true); // +1 step drift window
    expect(verifyTotp(secret, "000000", new Date(59000))).toBe(false);
    expect(verifyTotp(secret, "28708", new Date(59000))).toBe(false); // wrong length
  });
});

describe("Phase D — TOTP login flow, guard gate, session revocation", () => {
  async function totpUser(p: any) {
    const { generateTotpSecret } = await import("../common/totp");
    const { encryptJson } = await import("../integrations/crypto");
    const secret = generateTotpSecret();
    p.user.rows.push({ id: "u-totp", email: "secure@x.com", name: "Secure", isSuperAdmin: true, adminTier: "SUPER", status: "ACTIVE", tokenVersion: 0, totpEnabled: true, totpSecretEncrypted: encryptJson({ secret }), passwordHash: hashSync("securepass1", 10), createdAt: new Date() });
    return secret;
  }
  it("login returns a challenge (no token); the correct code completes it", async () => {
    const p = basePrisma(); seedUsers(p);
    const secret = await totpUser(p);
    const { totp } = await import("../common/totp");
    const auth = new AuthService(p, { signAsync: async () => "real-token" } as any, mkAudit([]));
    const step1: any = await auth.login({ email: "secure@x.com", password: "securepass1" } as any);
    expect(step1.requiresTotp).toBe(true);
    expect(step1.accessToken).toBeUndefined();
    await expect(auth.verifyTotpLogin(step1.challengeToken, "000000")).rejects.toThrow(/incorrect/);
    const step2: any = await auth.verifyTotpLogin(step1.challengeToken, totp(secret));
    expect(step2.accessToken).toBe("real-token");
  });
  it("enrolment: confirm with a valid code enables TOTP; disable needs a valid code", async () => {
    const p = basePrisma(); seedUsers(p);
    const svc = new AdminService(p, mkAudit([]));
    const actor = p.user.rows.find((r: any) => r.id === "admin-2");
    const enroll = await svc.totpEnroll(actor);
    expect(enroll.secret.length).toBeGreaterThanOrEqual(16);
    expect(p.user.rows.find((r: any) => r.id === "admin-2").totpEnabled).toBe(false); // not yet
    const { totp } = await import("../common/totp");
    await expect(svc.totpConfirm(actor, "000000")).rejects.toThrow(/incorrect/);
    await svc.totpConfirm(actor, totp(enroll.secret));
    expect(p.user.rows.find((r: any) => r.id === "admin-2").totpEnabled).toBe(true);
    await svc.totpDisable(actor, totp(enroll.secret));
    expect(p.user.rows.find((r: any) => r.id === "admin-2").totpEnabled).toBe(false);
  });
  it("guard: a SUPER without TOTP can read and enrol, but cannot mutate", async () => {
    const p = basePrisma(); seedUsers(p);
    const guard = new SuperAdminGuard(p, { getAllAndOverride: () => undefined } as any);
    const ctxFor = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null }) as any;
    await expect(guard.canActivate(ctxFor({ user: { userId: "admin-1", tv: 0 }, headers: {}, method: "GET", originalUrl: "/admin/users" }))).resolves.toBe(true);
    await expect(guard.canActivate(ctxFor({ user: { userId: "admin-1", tv: 0 }, headers: {}, method: "POST", originalUrl: "/admin/settings" }))).rejects.toThrow(/two-factor/);
    await expect(guard.canActivate(ctxFor({ user: { userId: "admin-1", tv: 0 }, headers: {}, method: "POST", originalUrl: "/admin/totp/confirm" }))).resolves.toBe(true);
    p.user.rows.find((r: any) => r.id === "admin-1").totpEnabled = true;
    await expect(guard.canActivate(ctxFor({ user: { userId: "admin-1", tv: 0 }, headers: {}, method: "POST", originalUrl: "/admin/settings" }))).resolves.toBe(true);
  });
  it("revokeSessions bumps the token version so old admin tokens die at the guard", async () => {
    const p = basePrisma(); seedUsers(p);
    const svc = new AdminService(p, mkAudit([]));
    await svc.revokeSessions(SUPER as any, "admin-2", "device lost");
    expect(p.user.rows.find((r: any) => r.id === "admin-2").tokenVersion).toBe(1);
    const guard = new SuperAdminGuard(p, { getAllAndOverride: () => undefined } as any);
    const ctxFor = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null }) as any;
    await expect(guard.canActivate(ctxFor({ user: { userId: "admin-2", tv: 0 }, headers: {}, method: "GET", originalUrl: "/admin/users" }))).rejects.toThrow(/revoked/);
    await expect(guard.canActivate(ctxFor({ user: { userId: "admin-2", tv: 1 }, headers: {}, method: "GET", originalUrl: "/admin/users" }))).resolves.toBe(true);
  });
});
