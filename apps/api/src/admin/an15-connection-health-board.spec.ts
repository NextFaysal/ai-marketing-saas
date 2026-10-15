process.env.ENCRYPTION_KEY = Buffer.alloc(32, 13).toString("base64");
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";

/**
 * Admin Next AN15 — Platform Connection-Health Board.
 *
 * The board reuses CC22's definitions verbatim (overall
 * pass/fail/partial; degraded in the denominator only; uptime
 * over 30 days, one decimal; ZERO checks => null uptime, an
 * explicit no_data state — never healthy). Specs run on a fake
 * Prisma: aggregation correctness, worst-first ordering,
 * zero-check honesty, orphan-target history, token-expiry risk
 * from the Integration row's own tokenExpiresAt (CC12 buckets),
 * and a poisoned-row scan proving no credential material can
 * reach the payload.
 */

const NOW = new Date("2026-10-15T00:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400000);

function fakePrisma(data: {
  integrations?: any[]; socials?: any[]; ads?: any[]; checks?: any[]; orgs?: any[];
}) {
  return {
    integration: { findMany: async () => data.integrations ?? [] },
    socialAccount: { findMany: async () => data.socials ?? [] },
    adAccount: { findMany: async () => data.ads ?? [] },
    connectionHealthCheck: { findMany: async () => data.checks ?? [] },
    organization: { findMany: async () => data.orgs ?? [] },
  } as any;
}
const audit: any = { log: async () => undefined };
const svc = (data: any) => new AdminService(fakePrisma(data), audit);

const ORGS = [{ id: "org-1", name: "Org One" }, { id: "org-2", name: "Org Two" }];

describe("AN15 healthConnections aggregation (CC22 definitions)", () => {
  it("counts pass/fail/partial over the 30d window, uptime = pass/total, latest fail = broken", async () => {
    const out = await svc({
      orgs: ORGS,
      integrations: [{ id: "int-1", organizationId: "org-1", provider: "shopify", status: "CONNECTED", tokenExpiresAt: null }],
      checks: [
        { organizationId: "org-1", targetType: "integration", targetId: "int-1", overall: "fail", createdAt: daysAgo(1), steps: [] },
        { organizationId: "org-1", targetType: "integration", targetId: "int-1", overall: "pass", createdAt: daysAgo(2), steps: [] },
        { organizationId: "org-1", targetType: "integration", targetId: "int-1", overall: "partial", createdAt: daysAgo(3), steps: [] },
        { organizationId: "org-1", targetType: "integration", targetId: "int-1", overall: "pass", createdAt: daysAgo(40), steps: [] },
      ],
    }).healthConnections(NOW);
    const c = out.connections.find((x: any) => x.targetId === "int-1");
    expect(c.checks).toBe(3); // the 40-day-old run is outside the window
    expect(c.passed).toBe(1);
    expect(c.failed).toBe(1);
    expect(c.degraded).toBe(1);
    expect(c.uptimePct).toBe(33.3); // degraded in the denominator, never the numerator
    expect(c.latestStatus).toBe("fail");
    expect(c.boardStatus).toBe("broken");
    expect(c.lastFailureAt).toBe(daysAgo(1).toISOString());
    expect(out.windowDays).toBe(30);
  });

  it("zero checks => explicit no_data with null uptime — never ok/healthy", async () => {
    const out = await svc({
      orgs: ORGS,
      socials: [{ id: "soc-1", organizationId: "org-1", platform: "meta_page", name: "Page", status: "connected" }],
      checks: [],
    }).healthConnections(NOW);
    const c = out.connections[0];
    expect(c.boardStatus).toBe("no_data");
    expect(c.checks).toBe(0);
    expect(c.uptimePct).toBeNull();
    expect(c.latestStatus).toBeNull();
    expect(c.lastCheckedAt).toBeNull();
    expect(out.summary).toEqual({ total: 1, broken: 0, atRisk: 0, ok: 0, noData: 1 });
  });

  it("token expiry inside CC12's 7-day buckets makes a passing connection at_risk", async () => {
    const out = await svc({
      orgs: ORGS,
      integrations: [{ id: "int-2", organizationId: "org-2", provider: "shopify", status: "CONNECTED", tokenExpiresAt: daysAgo(-2) }],
      checks: [{ organizationId: "org-2", targetType: "integration", targetId: "int-2", overall: "pass", createdAt: daysAgo(0), steps: [] }],
    }).healthConnections(NOW);
    const c = out.connections[0];
    expect(c.uptimePct).toBe(100);
    expect(c.expiryBucket).toBe("expiring_3");
    expect(c.tokenDaysLeft).toBe(2);
    expect(c.boardStatus).toBe("at_risk");
  });

  it("orders worst-first: broken, at_risk, ok, no_data", async () => {
    const out = await svc({
      orgs: ORGS,
      integrations: [
        { id: "ok-1", organizationId: "org-1", provider: "meta", status: "CONNECTED", tokenExpiresAt: null },
        { id: "bad-1", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", tokenExpiresAt: null },
      ],
      socials: [{ id: "risk-1", organizationId: "org-1", platform: "tiktok", name: "TT", status: "connected" }],
      ads: [{ id: "none-1", organizationId: "org-2", platform: "meta", name: "Ads", status: "ACTIVE" }],
      checks: [
        { organizationId: "org-1", targetType: "integration", targetId: "bad-1", overall: "fail", createdAt: daysAgo(1), steps: [] },
        { organizationId: "org-1", targetType: "integration", targetId: "ok-1", overall: "pass", createdAt: daysAgo(1), steps: [] },
        { organizationId: "org-1", targetType: "social_account", targetId: "risk-1", overall: "partial", createdAt: daysAgo(1), steps: [] },
      ],
    }).healthConnections(NOW);
    expect(out.connections.map((c: any) => c.boardStatus)).toEqual(["broken", "at_risk", "ok", "no_data"]);
    expect(out.summary).toEqual({ total: 4, broken: 1, atRisk: 1, ok: 1, noData: 1 });
  });

  it("check rows for a deleted target still surface, marked missing, identity from the row snapshot", async () => {
    const out = await svc({
      orgs: ORGS,
      checks: [{ organizationId: "org-2", targetType: "integration", targetId: "gone-1", provider: "woocommerce", category: "commerce", displayName: "Old Store", overall: "fail", createdAt: daysAgo(2), steps: [] }],
    }).healthConnections(NOW);
    const c = out.connections[0];
    expect(c.targetStatus).toBe("missing");
    expect(c.provider).toBe("woocommerce");
    expect(c.displayName).toBe("Old Store");
    expect(c.boardStatus).toBe("broken");
  });

  it("poisoned rows cannot leak credential material into the payload", async () => {
    const out = await svc({
      orgs: ORGS,
      integrations: [{ id: "int-9", organizationId: "org-1", provider: "meta", status: "CONNECTED", tokenExpiresAt: null, encryptedData: "ABCSECRET", credential: { accessToken: "ABCSECRET" } }],
      checks: [{ organizationId: "org-1", targetType: "integration", targetId: "int-9", overall: "fail", createdAt: daysAgo(1), steps: [{ key: "auth", status: "fail", detail: "token=ABCSECRET" }] }],
    }).healthConnections(NOW);
    const json = JSON.stringify(out);
    expect(json).not.toContain("ABCSECRET");
    const keys: string[] = [];
    const walk = (v: any) => { if (v && typeof v === "object") for (const [k, val] of Object.entries(v)) { keys.push(k); walk(val); } };
    walk(out);
    for (const bad of ["encryptedData", "credential", "accessToken", "refreshToken", "apiKey", "secret", "password", "steps"]) {
      expect(keys).not.toContain(bad);
    }
  });
});

describe("AN15 controller route", () => {
  it("GET health/connections delegates to AdminService.healthConnections", async () => {
    const sentinel = { connections: [] };
    const ctrl = new AdminController({ healthConnections: async () => sentinel } as any, {} as any, {} as any, {} as any);
    await expect((ctrl as any).healthConnections()).resolves.toBe(sentinel);
  });
});
