import { AdminService } from "./admin.service";
import { AuthService } from "../auth/auth.service";
import { ensureReferralCode, maybeRewardReferral } from "../common/referral";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/** Milestone 41 (Admin Phase A5): self-contained fakes (m37 pattern). */
function match(row: any, where: any = {}): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("gte" in (v as any)) { if (!(new Date(row[k]).getTime() >= new Date((v as any).gte).getTime())) return false; }
      else if ("in" in (v as any)) { if (!(v as any).in.includes(row[k])) return false; }
      else if ("contains" in (v as any)) { if (!String(row[k] ?? "").includes((v as any).contains)) return false; }
      else if ("not" in (v as any)) { if (row[k] === (v as any).not) return false; }
      else return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}
let seq = 0;
function table(seed: any[] = []) {
  const rows = [...seed];
  const applyOrder = (out: any[], orderBy: any) => {
    if (!orderBy) return out;
    const [key, dir] = Object.entries(orderBy)[0] as [string, string];
    return [...out].sort((a, b) => {
      const av = a[key] instanceof Date ? a[key].getTime() : a[key]; const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
      const d = (av > bv ? 1 : av < bv ? -1 : 0);
      return dir === "desc" ? -d : d;
    });
  };
  const findUniqueRow = (where: any) => rows.find((r) =>
    (where.id !== undefined && r.id === where.id) ||
    (where.key !== undefined && r.key === where.key) ||
    (where.email !== undefined && r.email === where.email) ||
    (where.referralCode !== undefined && r.referralCode === where.referralCode) ||
    (where.referredUserId !== undefined && r.referredUserId === where.referredUserId)) ?? null;
  return {
    rows,
    findMany: async (args: any = {}) => {
      let out = rows.filter((r) => match(r, args.where ?? {}));
      out = applyOrder(out, args.orderBy);
      if (args.take) out = out.slice(0, args.take);
      return out;
    },
    findFirst: async (args: any = {}) => {
      let out = rows.filter((r) => match(r, args.where ?? {}));
      out = applyOrder(out, args.orderBy);
      return out[0] ?? null;
    },
    findUnique: async ({ where }: any) => findUniqueRow(where),
    count: async (args: any = {}) => rows.filter((r) => match(r, args.where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: `row-${++seq}`, createdAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = findUniqueRow(where);
      if (!row) throw new Error("not found");
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === "object" && "increment" in (v as any)) row[k] = (row[k] ?? 0) + (v as any).increment;
        else row[k] = v;
      }
      return row;
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => r.id === where.id);
      if (i >= 0) rows.splice(i, 1);
      return {};
    },
    upsert: async ({ where, create, update }: any) => {
      const row = findUniqueRow(where);
      if (row) { Object.assign(row, update); return row; }
      const created = { id: `row-${++seq}`, createdAt: new Date(), ...create };
      rows.push(created);
      return created;
    },
  };
}

const ADMIN: any = { id: "admin-1", email: "root@platform.local", isSuperAdmin: true, adminTier: "SUPER" };
const AUDIT: any = { log: jest.fn(async () => undefined) };
const OLD = new Date(Date.now() - 3600000);
const OLDER = new Date(Date.now() - 7200000);

function makePrisma() {
  return {
    systemSetting: table([]),
    announcement: table([
      { id: "ann-all", title: "Global", body: "for everyone", audience: "all", active: true, startsAt: null, endsAt: null, createdAt: OLDER },
      { id: "ann-trial", title: "Trial tip", body: "for trials", audience: "trialing", active: true, startsAt: null, endsAt: null, createdAt: OLD },
    ]),
    subscription: table([
      { id: "sub-1", organizationId: "org-1", plan: "FREE", status: "TRIALING", createdAt: OLD },
      { id: "sub-2", organizationId: "org-2", plan: "GROWTH", status: "ACTIVE", createdAt: OLD },
    ]),
    organization: table([
      { id: "org-1", name: "Trial Shop", status: "ACTIVE", creditMinor: 0n },
      { id: "org-2", name: "Growth Shop", status: "ACTIVE", creditMinor: 0n },
    ]),
    membership: table([
      { id: "m-1", organizationId: "org-1", userId: "u-refd", role: "OWNER", status: "ACTIVE" },
      { id: "m-2", organizationId: "org-2", userId: "u-ref", role: "OWNER", status: "ACTIVE" },
    ]),
    user: table([
      { id: "u-ref", email: "referrer@x.test", name: "Referrer", referralCode: "QOS-ABC123" },
      { id: "u-refd", email: "referred@x.test", name: "Referred", referralCode: null },
    ]),
    referral: table([
      { id: "ref-1", referrerUserId: "u-ref", referredUserId: "u-refd", code: "QOS-ABC123", status: "pending", rewardMinor: null, createdAt: OLD },
    ]),
    platformCampaign: table([]),
    changelogEntry: table([]),
    feedback: table([
      { id: "f-1", organizationId: "org-1", userId: "u-refd", score: 10, comment: "great", createdAt: OLD },
      { id: "f-2", organizationId: "org-1", userId: "u-refd", score: 8, comment: null, createdAt: OLD },
      { id: "f-3", organizationId: "org-2", userId: "u-ref", score: 4, comment: "slow", createdAt: OLD },
      { id: "f-4", organizationId: "org-2", userId: "u-ref", score: 9, comment: null, createdAt: OLD },
    ]),
  } as any;
}

describe("Milestone 41 — growth ops", () => {
  it("targeted announcements win for a matching org; others see the global one", async () => {
    const svc = new AdminService(makePrisma(), AUDIT);
    const trialStatus: any = await svc.publicStatus("org-1");
    expect(trialStatus.announcement.title).toBe("Trial tip");
    const growthStatus: any = await svc.publicStatus("org-2");
    expect(growthStatus.announcement.title).toBe("Global");
    const anon: any = await svc.publicStatus();
    expect(anon.announcement.title).toBe("Global");
  });

  it("announcement creation validates the audience", async () => {
    const svc = new AdminService(makePrisma(), AUDIT);
    await expect(svc.createAnnouncement(ADMIN, { title: "X", body: "Y", audience: "everybody" })).rejects.toThrow(/audience/);
    const ok: any = await svc.createAnnouncement(ADMIN, { title: "X", body: "Y", audience: "plan_GROWTH" });
    expect(ok.audience).toBe("plan_GROWTH");
  });

  it("campaign refuses honestly when email is not configured (nothing recorded)", async () => {
    setPlatformConfigSnapshot({ llm: null, metaApp: null, smtp: null, sms: null } as any);
    const p = makePrisma();
    const svc = new AdminService(p, AUDIT);
    await expect(svc.sendCampaign(ADMIN, { subject: "Hi", body: "Body", audience: "all" })).rejects.toThrow(/not configured/i);
    expect(p.platformCampaign.rows).toHaveLength(0);
  });

  it("campaign validates audience and empty audiences", async () => {
    const svc = new AdminService(makePrisma(), AUDIT);
    await expect(svc.sendCampaign(ADMIN, { subject: "Hi", body: "B", audience: "plan_AGENCY" })).rejects.toThrow(/No recipients/);
  });

  it("changelog CRUD + public list shows published only", async () => {
    const svc = new AdminService(makePrisma(), AUDIT);
    const draft: any = await svc.createChangelog(ADMIN, { title: "Draft", body: "secret" });
    expect(await svc.publicChangelog()).toHaveLength(0);
    await svc.updateChangelog(ADMIN, draft.id, { published: true });
    const pub: any[] = await svc.publicChangelog();
    expect(pub).toHaveLength(1);
    expect(pub[0].title).toBe("Draft");
    await svc.deleteChangelog(ADMIN, draft.id);
    expect(await svc.publicChangelog()).toHaveLength(0);
  });

  it("referral config round-trips and the board totals real rows", async () => {
    const p = makePrisma();
    const svc = new AdminService(p, AUDIT);
    const cfg: any = await svc.updateReferralConfig(ADMIN, { enabled: true, rewardMinor: 75000 });
    // Referral Advanced R1: the config grew the v2 fields;
    // the M41 flat pair still round-trips exactly.
    expect(cfg).toEqual({
      enabled: true, rewardMinor: 75000, mode: "flat", percentOfFirstPayment: 0,
      perPlanMinor: {}, refereeBonusMinor: 0, minFirstPaymentMinor: 0,
      creditExpiryDays: 0, milestones: [],
    });
    const board: any = await svc.referralsBoard();
    expect(board.totals.signups).toBe(1);
    expect(board.recent[0].referrerEmail).toBe("referrer@x.test");
  });

  it("first payment rewards the referrer's org credit exactly once", async () => {
    const p = makePrisma();
    await new AdminService(p, AUDIT).updateReferralConfig(ADMIN, { enabled: true, rewardMinor: 50000 });
    const out1 = await maybeRewardReferral(p, AUDIT, "org-1");
    expect(out1.rewarded).toBe(true);
    const org2 = p.organization.rows.find((o: any) => o.id === "org-2");
    expect(org2.creditMinor).toBe(50000n);
    expect(p.referral.rows[0].status).toBe("rewarded");
    const out2 = await maybeRewardReferral(p, AUDIT, "org-1");
    expect(out2.rewarded).toBe(false); // never twice
    expect(p.organization.rows.find((o: any) => o.id === "org-2").creditMinor).toBe(50000n);
  });

  it("no reward while the program is disabled", async () => {
    const p = makePrisma();
    const out = await maybeRewardReferral(p, AUDIT, "org-1");
    expect(out.rewarded).toBe(false);
    expect(p.organization.rows.find((o: any) => o.id === "org-2").creditMinor).toBe(0n);
  });

  it("referral codes are allocated lazily and stably", async () => {
    const p = makePrisma();
    const user = p.user.rows.find((u: any) => u.id === "u-refd");
    const code1 = await ensureReferralCode(p, user);
    expect(code1).toMatch(/^QOS-[A-Z2-9]{6}$/);
    const code2 = await ensureReferralCode(p, p.user.rows.find((u: any) => u.id === "u-refd"));
    expect(code2).toBe(code1);
  });

  it("signup with a referral code records the referral; a bad code is ignored", async () => {
    const p = makePrisma();
    const jwt: any = { signAsync: async () => "token" };
    const auth = new AuthService(p, jwt, AUDIT);
    await auth.register({ name: "New Person", email: "new@x.test", password: "Password123!", referralCode: "QOS-ABC123" } as any);
    const created = p.referral.rows.find((r: any) => r.code === "QOS-ABC123" && r.referredUserId !== "u-refd");
    expect(created?.referrerUserId).toBe("u-ref");
    await auth.register({ name: "Second", email: "second@x.test", password: "Password123!", referralCode: "QOS-NOPE99" } as any);
    expect(p.referral.rows.filter((r: any) => r.code === "QOS-NOPE99")).toHaveLength(0);
  });

  it("myReferral returns the code, program state and earned totals", async () => {
    const p = makePrisma();
    const jwt: any = { signAsync: async () => "token" };
    const auth = new AuthService(p, jwt, AUDIT);
    const mine: any = await auth.myReferral("u-ref");
    expect(mine.code).toBe("QOS-ABC123");
    expect(mine.stats.signups).toBe(1);
    expect(mine.referrals[0].referredEmail).toBe("referred@x.test");
  });

  it("feedback board computes NPS from real scores", async () => {
    const svc = new AdminService(makePrisma(), AUDIT);
    const board: any = await svc.feedbackBoard();
    expect(board.summary.count).toBe(4);
    expect(board.summary.promoters).toBe(2); // 10 and 9
    expect(board.summary.passives).toBe(1);  // 8
    expect(board.summary.detractors).toBe(1); // 4
    expect(board.summary.nps).toBe(25); // (2-1)/4 = 25
    expect(board.recent[0].organizationName).toBeDefined();
  });

  it("public pricing comes from operator settings (defaults without any)", async () => {
    const svc = new AdminService(makePrisma(), AUDIT);
    const pricing: any = await svc.publicPricing();
    expect(pricing.currency).toBe("BDT");
    expect(pricing.plans.map((x: any) => x.tier)).toEqual(["FREE", "STARTER", "GROWTH", "AGENCY"]);
    expect(pricing.plans.find((x: any) => x.tier === "GROWTH").priceMinor).toBe(300000);
  });
});
