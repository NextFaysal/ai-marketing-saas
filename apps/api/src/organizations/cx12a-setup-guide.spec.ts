import "reflect-metadata";
import { OrganizationsService } from "./organizations.service";

/**
 * CX12a — Setup Guide checkers.
 *
 * Every step is computed from REAL rows only (the getOnboarding
 * discipline): each checker is proven both ways — state present
 * -> done, state absent -> not done — and the progress math is
 * exact (0% / partial / 100%). Fake prisma only; no live DB.
 */
const ORG = "org-1";

function makeOrgs(seed: {
  profile?: any;
  integrations?: any[];
  stores?: number;
  products?: number;
  instructionVersions?: number;
  members?: number;
  inboxSetting?: any;
} = {}) {
  const integrations = seed.integrations ?? [];
  const prisma = {
    businessProfile: {
      findUnique: async () => seed.profile ?? null,
    },
    inboxSetting: {
      findUnique: async () => seed.inboxSetting ?? null,
    },
    membership: {
      count: async () => seed.members ?? 1,
    },
    integration: {
      count: async ({ where }: any) => integrations.filter((i) =>
        i.organizationId === where.organizationId &&
        (!where.provider?.in || where.provider.in.includes(i.provider)) &&
        (!where.status || i.status === where.status)).length,
    },
    store: { count: async () => seed.stores ?? 0 },
    product: { count: async () => seed.products ?? 0 },
    aiInstructionVersion: { count: async () => seed.instructionVersions ?? 0 },
  };
  const audit = { log: async () => undefined };
  const svc = new OrganizationsService(prisma as any, audit as any);
  return { svc };
}

const FULL = {
  profile: { description: "ঢাকার ফ্যাশন শপ", websiteUrl: "", industry: "Fashion" },
  integrations: [
    { organizationId: ORG, provider: "whatsapp", status: "CONNECTED" },
    { organizationId: ORG, provider: "steadfast", status: "CONNECTED" },
  ],
  stores: 1,
  products: 3,
  instructionVersions: 1,
  members: 2,
  inboxSetting: { aiScheduleByChannel: { whatsapp: { enabled: true, windows: [{ days: [0, 1, 2, 3, 4, 5, 6], start: "09:00", end: "22:00" }] } } },
};

function step(guide: any, key: string) {
  const s = guide.steps.find((x: any) => x.key === key);
  if (!s) throw new Error(`missing step ${key}`);
  return s;
}

describe("CX12a setup guide — empty org", () => {
  it("nothing done, 0%, every required step present with a deep link", async () => {
    const { svc } = makeOrgs();
    const guide = await svc.getSetupGuide(ORG);
    expect(guide.total).toBe(8);
    expect(guide.completed).toBe(0);
    expect(guide.percent).toBe(0);
    expect(guide.allDone).toBe(false);
    for (const key of ["profile", "channel", "store", "products", "instructions", "courier", "team", "ai_schedule"]) {
      expect(step(guide, key).done).toBe(false);
      expect(step(guide, key).href).toMatch(/^\/dashboard\//);
    }
  });
});

describe("CX12a setup guide — full org", () => {
  it("everything done, 100%", async () => {
    const { svc } = makeOrgs(FULL);
    const guide = await svc.getSetupGuide(ORG);
    expect(guide.completed).toBe(8);
    expect(guide.percent).toBe(100);
    expect(guide.allDone).toBe(true);
    expect(guide.steps.every((s: any) => s.done)).toBe(true);
  });
});

describe("CX12a setup guide — each checker both ways", () => {
  it("profile: a filled profile field completes it; an empty profile row does not", async () => {
    expect(step(await makeOrgs({ profile: { description: "", websiteUrl: "", industry: "" } }).svc.getSetupGuide(ORG), "profile").done).toBe(false);
    expect(step(await makeOrgs({ profile: { description: "শপ", websiteUrl: "", industry: "" } }).svc.getSetupGuide(ORG), "profile").done).toBe(true);
    expect(step(await makeOrgs({ profile: null }).svc.getSetupGuide(ORG), "profile").done).toBe(false);
  });

  it("channel: only a CONNECTED messaging integration counts (a store/courier integration does not)", async () => {
    const base = { ...FULL, integrations: [{ organizationId: ORG, provider: "steadfast", status: "CONNECTED" }] };
    expect(step(await makeOrgs(base).svc.getSetupGuide(ORG), "channel").done).toBe(false);
    const disconnected = { ...FULL, integrations: [{ organizationId: ORG, provider: "whatsapp", status: "DISCONNECTED" }] };
    expect(step(await makeOrgs(disconnected).svc.getSetupGuide(ORG), "channel").done).toBe(false);
    const connected = { ...FULL, integrations: [{ organizationId: ORG, provider: "messenger", status: "CONNECTED" }] };
    expect(step(await makeOrgs(connected).svc.getSetupGuide(ORG), "channel").done).toBe(true);
  });

  it("instructions: a CX2 published version counts; merely having products/profile does not", async () => {
    expect(step(await makeOrgs({ ...FULL, instructionVersions: 0 }).svc.getSetupGuide(ORG), "instructions").done).toBe(false);
    expect(step(await makeOrgs({ ...FULL, instructionVersions: 2 }).svc.getSetupGuide(ORG), "instructions").done).toBe(true);
  });

  it("products: > 0 only", async () => {
    expect(step(await makeOrgs({ ...FULL, products: 0 }).svc.getSetupGuide(ORG), "products").done).toBe(false);
    expect(step(await makeOrgs({ ...FULL, products: 1 }).svc.getSetupGuide(ORG), "products").done).toBe(true);
  });

  it("courier: only a CONNECTED courier provider counts (messaging does not)", async () => {
    const msgOnly = { ...FULL, integrations: [{ organizationId: ORG, provider: "whatsapp", status: "CONNECTED" }] };
    expect(step(await makeOrgs(msgOnly).svc.getSetupGuide(ORG), "courier").done).toBe(false);
    const pathao = { ...FULL, integrations: [{ organizationId: ORG, provider: "pathao", status: "CONNECTED" }] };
    expect(step(await makeOrgs(pathao).svc.getSetupGuide(ORG), "courier").done).toBe(true);
  });

  it("team: more than the owner alone", async () => {
    expect(step(await makeOrgs({ ...FULL, members: 1 }).svc.getSetupGuide(ORG), "team").done).toBe(false);
    expect(step(await makeOrgs({ ...FULL, members: 2 }).svc.getSetupGuide(ORG), "team").done).toBe(true);
  });

  it("ai_schedule: an enabled CX12d entry counts; disabled / absent / corrupt does not", async () => {
    const off = { ...FULL, inboxSetting: { aiScheduleByChannel: { whatsapp: { enabled: false, windows: [] } } } };
    expect(step(await makeOrgs(off).svc.getSetupGuide(ORG), "ai_schedule").done).toBe(false);
    expect(step(await makeOrgs({ ...FULL, inboxSetting: null }).svc.getSetupGuide(ORG), "ai_schedule").done).toBe(false);
    const corrupt = { ...FULL, inboxSetting: { aiScheduleByChannel: "not-a-map" } };
    expect(step(await makeOrgs(corrupt).svc.getSetupGuide(ORG), "ai_schedule").done).toBe(false);
    const on = { ...FULL, inboxSetting: { aiScheduleByChannel: { messenger: { enabled: true, windows: [] } } } };
    expect(step(await makeOrgs(on).svc.getSetupGuide(ORG), "ai_schedule").done).toBe(true);
  });

  it("store: > 0 only", async () => {
    expect(step(await makeOrgs({ ...FULL, stores: 0 }).svc.getSetupGuide(ORG), "store").done).toBe(false);
    expect(step(await makeOrgs({ ...FULL, stores: 1 }).svc.getSetupGuide(ORG), "store").done).toBe(true);
  });
});

describe("CX12a setup guide — progress math", () => {
  it("partial completion: exactly 3 of 8 -> 38%", async () => {
    const { svc } = makeOrgs({ profile: FULL.profile, products: 5, members: 3 });
    const guide = await svc.getSetupGuide(ORG);
    expect(guide.completed).toBe(3);
    expect(guide.total).toBe(8);
    expect(guide.percent).toBe(38);
    expect(guide.allDone).toBe(false);
  });

  it("tenant isolation: another org's integrations never complete this org's steps", async () => {
    const foreign = {
      ...FULL,
      integrations: [
        { organizationId: "org-2", provider: "whatsapp", status: "CONNECTED" },
        { organizationId: "org-2", provider: "redx", status: "CONNECTED" },
      ],
    };
    const guide = await makeOrgs(foreign).svc.getSetupGuide(ORG);
    expect(step(guide, "channel").done).toBe(false);
    expect(step(guide, "courier").done).toBe(false);
  });
});
