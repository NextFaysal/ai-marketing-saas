import "reflect-metadata";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { OrganizationsService } from "./organizations.service";

/**
 * Organization Next OB4 — ORG11 org security policy (service
 * layer) + ORG12 per-user owned-org cap. The load-bearing rules
 * under test:
 *  - the security policy is OWNER-only to change, any ACTIVE
 *    member may read it (the dashboard gate probes the read);
 *  - requireMfa cannot be switched ON by an OWNER whose own MFA
 *    is off (self-lockout guard) — switching it OFF is free;
 *  - sessionMaxAgeHours accepts 1..720 or explicit null (clear);
 *  - the policy view reports the CALLER's own standing
 *    (myMfaBlocked / mySessionBlocked), with session age measured
 *    from the UserSession row and un-ageable (sid-less) callers
 *    reading as blocked whenever a cap exists;
 *  - ORG12: with no platform setting there is NO cap; the cap
 *    counts OWNER-role memberships only (invited memberships in
 *    other people's orgs never count; archived orgs do); raising
 *    the setting re-opens creation.
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
      if ("in" in cond && !cond.in.includes(rv)) return false;
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

const HOUR = 3_600_000;
function makeService(opts: { orgExtra?: any; settings?: any[]; memberships?: any[] } = {}) {
  const org = {
    id: "org-1", name: "Demo Shop", slug: "demo", status: "ACTIVE", archivedAt: null,
    requireMfa: false, sessionMaxAgeHours: null, tags: ["internal-only"],
    aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null, creditMinor: 0n,
    ...(opts.orgExtra ?? {}),
  };
  const p: any = {
    organization: table([org]),
    user: table([
      { id: "u-owner", email: "owner@x.com", name: "Owner", totpEnabled: false },
      { id: "u-admin", email: "admin@x.com", name: "Admin", totpEnabled: false },
      { id: "u-agent", email: "agent@x.com", name: "Agent", totpEnabled: true },
      { id: "u-new", email: "new@x.com", name: "New", totpEnabled: false },
    ]),
    membership: table(opts.memberships ?? [
      { id: "m-owner", userId: "u-owner", organizationId: "org-1", role: "OWNER", status: "ACTIVE" },
      { id: "m-admin", userId: "u-admin", organizationId: "org-1", role: "ADMIN", status: "ACTIVE" },
      { id: "m-agent", userId: "u-agent", organizationId: "org-1", role: "SUPPORT_AGENT", status: "ACTIVE" },
    ]),
    userSession: table([
      { id: "sess-old", userId: "u-admin", createdAt: new Date(Date.now() - 72 * HOUR), lastSeenAt: new Date(), revokedAt: null },
      { id: "sess-new", userId: "u-admin", createdAt: new Date(Date.now() - 1 * HOUR), lastSeenAt: new Date(), revokedAt: null },
    ]),
    systemSetting: table(opts.settings ?? []),
    businessProfile: table(),
    subscription: table(),
  };
  p.$transaction = async (fn: any) => fn(p);
  const auditEntries: any[] = [];
  const audit: any = { log: async (e: any) => { auditEntries.push(e); } };
  return { svc: new OrganizationsService(p, audit), p, auditEntries };
}

describe("ORG11 — security policy read/write", () => {
  it("GET defaults: no MFA requirement, no cap, nobody blocked", async () => {
    const { svc } = makeService();
    const view = await svc.getSecurityPolicy("org-1", "u-admin");
    expect(view).toMatchObject({ requireMfa: false, sessionMaxAgeHours: null, myTotpEnabled: false, myMfaBlocked: false, mySessionBlocked: false });
  });

  it("GET refuses non-members", async () => {
    const { svc } = makeService();
    await expect(svc.getSecurityPolicy("org-1", "u-new")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("PATCH is OWNER-only at the service layer too", async () => {
    const { svc, p } = makeService();
    await expect(svc.updateSecurityPolicy("org-1", "u-admin", { sessionMaxAgeHours: 24 })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.updateSecurityPolicy("org-1", "u-new", { sessionMaxAgeHours: 24 })).rejects.toBeInstanceOf(NotFoundException);
    expect(p.organization.rows[0].sessionMaxAgeHours).toBeNull();
  });

  it("self-lockout guard: an OWNER without MFA cannot switch requireMfa ON", async () => {
    const { svc, p } = makeService();
    await expect(svc.updateSecurityPolicy("org-1", "u-owner", { requireMfa: true })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.updateSecurityPolicy("org-1", "u-owner", { requireMfa: true })).rejects.toThrow(/আগে নিজের অ্যাকাউন্টে MFA/);
    expect(p.organization.rows[0].requireMfa).toBe(false);
  });

  it("an OWNER with MFA can switch it ON; audit records the change", async () => {
    const { svc, p, auditEntries } = makeService();
    p.user.rows.find((u: any) => u.id === "u-owner").totpEnabled = true;
    const out = await svc.updateSecurityPolicy("org-1", "u-owner", { requireMfa: true });
    expect(out.requireMfa).toBe(true);
    expect(out.changedFields).toContain("requireMfa");
    expect(out.myMfaBlocked).toBe(false);
    expect(p.organization.rows[0].requireMfa).toBe(true);
    expect(auditEntries.some((e: any) => e.action === "org.security_policy_updated")).toBe(true);
  });

  it("switching requireMfa OFF never demands the owner's own MFA", async () => {
    const { svc, p } = makeService({ orgExtra: { requireMfa: true } });
    const out = await svc.updateSecurityPolicy("org-1", "u-owner", { requireMfa: false });
    expect(out.requireMfa).toBe(false);
    expect(p.organization.rows[0].requireMfa).toBe(false);
  });

  it("session cap validation: 1..720 integers, or null to clear", async () => {
    const { svc, p } = makeService();
    await expect(svc.updateSecurityPolicy("org-1", "u-owner", { sessionMaxAgeHours: 0 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.updateSecurityPolicy("org-1", "u-owner", { sessionMaxAgeHours: 721 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.updateSecurityPolicy("org-1", "u-owner", { sessionMaxAgeHours: 2.5 })).rejects.toBeInstanceOf(BadRequestException);
    const set = await svc.updateSecurityPolicy("org-1", "u-owner", { sessionMaxAgeHours: 24 });
    expect(set.sessionMaxAgeHours).toBe(24);
    expect(p.organization.rows[0].sessionMaxAgeHours).toBe(24);
    const cleared = await svc.updateSecurityPolicy("org-1", "u-owner", { sessionMaxAgeHours: null });
    expect(cleared.sessionMaxAgeHours).toBeNull();
    expect(p.organization.rows[0].sessionMaxAgeHours).toBeNull();
  });

  it("an empty patch reports unchanged and writes nothing", async () => {
    const { svc, auditEntries } = makeService();
    const out: any = await svc.updateSecurityPolicy("org-1", "u-owner", {});
    expect(out.unchanged).toBe(true);
    expect(auditEntries.length).toBe(0);
  });
});

describe("ORG11 — the caller's own standing in the policy view", () => {
  it("an MFA-less member reads as blocked once requireMfa is on; an MFA member does not", async () => {
    const { svc } = makeService({ orgExtra: { requireMfa: true } });
    const admin = await svc.getSecurityPolicy("org-1", "u-admin");
    expect(admin.myTotpEnabled).toBe(false);
    expect(admin.myMfaBlocked).toBe(true);
    const agent = await svc.getSecurityPolicy("org-1", "u-agent");
    expect(agent.myTotpEnabled).toBe(true);
    expect(agent.myMfaBlocked).toBe(false);
  });

  it("session standing follows the UserSession row's age; sid-less reads as blocked under a cap", async () => {
    const { svc } = makeService({ orgExtra: { sessionMaxAgeHours: 24 } });
    const old = await svc.getSecurityPolicy("org-1", "u-admin", "sess-old");
    expect(old.mySessionAgeHours).toBeGreaterThan(71);
    expect(old.mySessionBlocked).toBe(true);
    const fresh = await svc.getSecurityPolicy("org-1", "u-admin", "sess-new");
    expect(fresh.mySessionBlocked).toBe(false);
    const legacy = await svc.getSecurityPolicy("org-1", "u-admin");
    expect(legacy.mySessionAgeHours).toBeNull();
    expect(legacy.mySessionBlocked).toBe(true);
  });
});

describe("ORG12 — per-user owned-org cap in create()", () => {
  it("no platform setting = no cap at all", async () => {
    const { svc } = makeService();
    for (const slug of ["shop-a1", "shop-a2", "shop-a3"]) {
      await expect(svc.create("u-new", { name: slug, slug } as any)).resolves.toBeTruthy();
    }
  });

  it("cap counts OWNER memberships only — invited roles never eat the allowance", async () => {
    const memberships = [
      { id: "x-1", userId: "u-new", organizationId: "org-9", role: "OWNER", status: "ACTIVE" },
      { id: "x-2", userId: "u-new", organizationId: "org-8", role: "ADMIN", status: "ACTIVE" },
      { id: "x-3", userId: "u-new", organizationId: "org-7", role: "VIEWER", status: "ACTIVE" },
      { id: "x-4", userId: "u-new", organizationId: "org-6", role: "ANALYST", status: "ACTIVE" },
    ];
    const { svc, p } = makeService({ settings: [{ key: "maxOrgsPerUser", value: 2 }], memberships });
    // 1 owned + 3 invited → one more owned org fits the cap of 2.
    await expect(svc.create("u-new", { name: "Mine", slug: "mine-shop" } as any)).resolves.toBeTruthy();
    expect(p.membership.rows.filter((m: any) => m.userId === "u-new" && m.role === "OWNER").length).toBe(2);
    // Now at the cap — the next create is refused and names the limit.
    await expect(svc.create("u-new", { name: "Third", slug: "third-shop" } as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create("u-new", { name: "Third", slug: "third-shop" } as any)).rejects.toThrow(/সর্বোচ্চ 2টি/);
    expect(p.organization.rows.some((o: any) => o.slug === "third-shop")).toBe(false);
  });

  it("raising the platform setting re-opens creation", async () => {
    const memberships = [
      { id: "x-1", userId: "u-new", organizationId: "org-9", role: "OWNER", status: "ACTIVE" },
      { id: "x-2", userId: "u-new", organizationId: "org-8", role: "OWNER", status: "ACTIVE" },
    ];
    const { svc, p } = makeService({ settings: [{ key: "maxOrgsPerUser", value: 2 }], memberships });
    await expect(svc.create("u-new", { name: "Third", slug: "third-shop" } as any)).rejects.toBeInstanceOf(BadRequestException);
    p.systemSetting.rows[0].value = 3;
    await expect(svc.create("u-new", { name: "Third", slug: "third-shop" } as any)).resolves.toBeTruthy();
  });

  it("an invalid stored value reads as no cap (the code carries no built-in number)", async () => {
    const { svc } = makeService({ settings: [{ key: "maxOrgsPerUser", value: "two" }] });
    await expect(svc.create("u-new", { name: "Free", slug: "free-shop" } as any)).resolves.toBeTruthy();
  });
});

describe("ORG13 — tenant reads never carry admin tags", () => {
  it("getOne and listMine strip the tags field", async () => {
    const { svc } = makeService();
    const one = await svc.getOne("org-1");
    expect(one).not.toHaveProperty("tags");
    const mine = await svc.listMine("u-owner");
    expect(mine.length).toBeGreaterThan(0);
    for (const row of mine) expect(row).not.toHaveProperty("tags");
  });
});
