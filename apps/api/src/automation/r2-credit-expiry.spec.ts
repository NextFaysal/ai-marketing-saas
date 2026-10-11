import { AutomationService, computeExpiredUnspent } from "./automation.service";

/**
 * Referral Advanced R2: granted credit expires UNSPENT,
 * FIFO over the ledger — spends and earlier expiry debits
 * consume the oldest grants first, and the daily billing
 * job debits what is due exactly once.
 */
const DAY = 86400000;
const T0 = new Date("2026-09-01T00:00:00Z");
const NOW = new Date("2026-10-11T00:00:00Z");
const grant = (delta: number, expiresInDays: number, at = T0) => ({
  deltaMinor: BigInt(delta), reason: "referral_reward",
  expiresAt: new Date(+at + expiresInDays * DAY), createdAt: at,
});
const spend = (delta: number, at = T0) => ({ deltaMinor: BigInt(delta), reason: "checkout_credit_spend", expiresAt: null, createdAt: at });

describe("computeExpiredUnspent (FIFO)", () => {
  it("an untouched expired grant is fully due", () => {
    expect(computeExpiredUnspent([grant(10000, 10)], NOW)).toBe(10000n);
  });
  it("spends consume the oldest grant first", () => {
    const entries = [grant(10000, 10), grant(5000, 300, new Date(+T0 + DAY)), spend(-4000, new Date(+T0 + 2 * DAY))];
    expect(computeExpiredUnspent(entries, NOW)).toBe(6000n);
  });
  it("an earlier expiry debit is never charged twice; unexpired grants are safe", () => {
    const expired = { deltaMinor: -10000n, reason: "credit_expired", expiresAt: null, createdAt: new Date(+T0 + 20 * DAY) };
    expect(computeExpiredUnspent([grant(10000, 10), expired as any], NOW)).toBe(0n);
    expect(computeExpiredUnspent([grant(10000, 300)], NOW)).toBe(0n);
  });
});

describe("the billing job debits expired credit once", () => {
  it("expired unspent credit leaves the balance with a ledger + audit trail", async () => {
    const org: any = { id: "org", name: "Shop", creditMinor: 10000n };
    const ledger: any[] = [grant(10000, 10)];
    const fake: any = {
      membership: {
        findMany: async () => [{ userId: "owner", role: "OWNER", status: "ACTIVE", user: { email: "o@x.com" } }],
        count: async () => 1,
      },
      aIUsageRecord: { count: async () => 0 },
      businessProfile: { findUnique: async () => null },
      organization: {
        findUnique: async () => org,
        update: async ({ data }: any) => { Object.assign(org, data); return org; },
      },
      subscription: { findFirst: async () => ({ id: "s", plan: "FREE", status: "ACTIVE", currentPeriodEnd: null }) },
      planCheckout: { findMany: async () => [] },
      creditLedger: {
        findMany: async () => ledger,
        create: async ({ data }: any) => { ledger.push({ ...data, createdAt: new Date() }); return data; },
      },
      agentNotification: { create: async ({ data }: any) => data },
      auditLog: { findMany: async () => [] },
    };
    const audits: any[] = [];
    const svc = new AutomationService(fake, { log: async (e: any) => { audits.push(e); } } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const out: any = await svc.sendBillingReminders("org");
    expect(out.creditExpiredMinor).toBe("10000");
    expect(org.creditMinor).toBe(0n);
    expect(ledger.some((l) => l.reason === "credit_expired" && l.deltaMinor === -10000n)).toBe(true);
    expect(audits.some((a) => a.action === "billing.credit_expired")).toBe(true);
    const again: any = await svc.sendBillingReminders("org");
    expect(again.creditExpiredMinor).toBe("0");
  });
});
