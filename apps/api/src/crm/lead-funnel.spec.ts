import { LeadsService } from "./leads.service";

// Fake Prisma with the operators funnel() uses (equality /
// mergedIntoId null / createdAt gte+lt). Mirrors the
// lead-followups.spec fake.
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("notIn" in v && v.notIn.includes(row[k])) return false;
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("not" in v) { const ok = v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not; if (!ok) return false; }
      if ("lt" in v && !(row[k] != null && new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if ("gte" in v && !(row[k] != null && new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}
function fakePrisma() {
  const rows: any[] = [];
  return {
    lead: {
      rows,
      findMany: async ({ where, take }: any = {}) => {
        const f = rows.filter((r) => matches(r, where ?? {}));
        return take ? f.slice(0, take) : f;
      },
    },
  };
}

// Fixed "now": 2026-10-11 10:00 UTC = 16:00 Dhaka. Dhaka day
// bounds: today starts 2026-10-10T18:00Z, tomorrow starts
// 2026-10-11T18:00Z. A 30-day window is therefore
// [2026-09-11T18:00Z, 2026-10-11T18:00Z).
const NOW = new Date("2026-10-11T10:00:00.000Z");
const utc = (iso: string) => new Date(iso);

let seq = 0;
function lead(prisma: any, over: Record<string, unknown>) {
  prisma.lead.rows.push({
    id: `lead-${++seq}`, organizationId: "org-1", name: "L", phone: null, email: null,
    source: "manual", stage: "new", valueMinor: null, currency: "BDT", customerId: null,
    mergedIntoId: null, ownerUserId: null, createdAt: utc("2026-10-05T10:00:00.000Z"),
    updatedAt: utc("2026-10-05T10:00:00.000Z"), ...over,
  });
}

function seed(prisma: any) {
  // manual: won(with customer+value) / new / lost
  lead(prisma, { source: "manual", stage: "won", valueMinor: 100000n, customerId: "c1", createdAt: utc("2026-10-05T10:00:00.000Z") });
  lead(prisma, { source: "manual", stage: "new", createdAt: utc("2026-10-06T10:00:00.000Z") });
  lead(prisma, { source: "manual", stage: "lost", valueMinor: 5000n, createdAt: utc("2026-10-07T10:00:00.000Z") });
  // whatsapp: won (no value, no customer) / contacted
  lead(prisma, { source: "whatsapp", stage: "won", createdAt: utc("2026-10-08T10:00:00.000Z") });
  lead(prisma, { source: "whatsapp", stage: "contacted", createdAt: utc("2026-10-09T10:00:00.000Z") });
  // facebook_lead_ads: one live new + one MERGED won (excluded)
  lead(prisma, { source: "facebook_lead_ads", stage: "new", createdAt: utc("2026-10-10T10:00:00.000Z") });
  lead(prisma, { source: "facebook_lead_ads", stage: "won", valueMinor: 99900n, customerId: "c2", mergedIntoId: "lead-x", createdAt: utc("2026-10-10T11:00:00.000Z") });
  // website: window-boundary probes — exactly at start (in),
  // one second before start (out), exactly at end (out)
  lead(prisma, { source: "website", stage: "new", createdAt: utc("2026-09-11T18:00:00.000Z") });
  lead(prisma, { source: "website", stage: "new", createdAt: utc("2026-09-11T17:59:59.000Z") });
  lead(prisma, { source: "website", stage: "qualified", createdAt: utc("2026-10-11T18:00:00.000Z") });
  // an unknown source present in data -> appears after the known vocabulary
  lead(prisma, { source: "partner_api", stage: "proposal", valueMinor: 20000n, customerId: "c3", createdAt: utc("2026-10-03T10:00:00.000Z") });
  // another org — must never leak into org-1's funnel
  lead(prisma, { organizationId: "org-2", source: "manual", stage: "won", valueMinor: 77700n, customerId: "c9", createdAt: utc("2026-10-05T10:00:00.000Z") });
}

describe("CRM C6 — lead funnel report", () => {
  it("matches hand computation per source and in totals (merged excluded, boundaries exact)", async () => {
    const prisma = fakePrisma();
    seed(prisma);
    const svc = new LeadsService(prisma as any);
    const out = await svc.funnel("org-1", 30, NOW);
    expect(out.days).toBe(30);
    expect(out.windowStart).toBe("2026-09-11T18:00:00.000Z");
    expect(out.windowEnd).toBe("2026-10-11T18:00:00.000Z");

    const bySource = new Map(out.sources.map((s: any) => [s.source, s]));
    // Known vocabulary comes first in its fixed order; unknown
    // sources present in data follow, alphabetically.
    expect(out.sources.map((s: any) => s.source)).toEqual([
      "manual", "whatsapp", "messenger", "instagram", "telegram", "email",
      "website", "webchat", "woocommerce", "facebook_lead_ads", "partner_api",
    ]);

    expect(bySource.get("manual")).toEqual({
      source: "manual", created: 3,
      byStage: { new: 1, contacted: 0, qualified: 0, proposal: 0, won: 1, lost: 1 },
      won: 1, wonRate: 0.3333, converted: 1, conversionRate: 0.3333, wonValueMinor: "100000",
    });
    expect(bySource.get("whatsapp")).toEqual({
      source: "whatsapp", created: 2,
      byStage: { new: 0, contacted: 1, qualified: 0, proposal: 0, won: 1, lost: 0 },
      won: 1, wonRate: 0.5, converted: 0, conversionRate: 0, wonValueMinor: "0",
    });
    // The merged won lead is NOT counted: created is 1, not 2.
    expect(bySource.get("facebook_lead_ads").created).toBe(1);
    expect(bySource.get("facebook_lead_ads").won).toBe(0);
    expect(bySource.get("facebook_lead_ads").wonValueMinor).toBe("0");
    // Boundary: exactly-at-start is in; before-start and
    // exactly-at-end are out -> website created is exactly 1.
    expect(bySource.get("website").created).toBe(1);
    expect(bySource.get("website").byStage.new).toBe(1);
    expect(bySource.get("website").byStage.qualified).toBe(0);
    // Unknown source from data, with its own figures.
    expect(bySource.get("partner_api")).toEqual({
      source: "partner_api", created: 1,
      byStage: { new: 0, contacted: 0, qualified: 0, proposal: 1, won: 0, lost: 0 },
      won: 0, wonRate: 0, converted: 1, conversionRate: 1, wonValueMinor: "0",
    });
    // A known source with no rows: zeros and NULL rates, no crash.
    expect(bySource.get("messenger").created).toBe(0);
    expect(bySource.get("messenger").wonRate).toBeNull();
    expect(bySource.get("messenger").conversionRate).toBeNull();
    expect(bySource.get("messenger").wonValueMinor).toBe("0");

    expect(out.totals).toEqual({
      source: "total", created: 8,
      byStage: { new: 3, contacted: 1, qualified: 0, proposal: 1, won: 2, lost: 1 },
      won: 2, wonRate: 0.25, converted: 2, conversionRate: 0.25, wonValueMinor: "100000",
    });
  });

  it("respects the days window (7 days drops the older sources)", async () => {
    const prisma = fakePrisma();
    seed(prisma);
    const svc = new LeadsService(prisma as any);
    const out = await svc.funnel("org-1", 7, NOW);
    expect(out.windowStart).toBe("2026-10-04T18:00:00.000Z");
    expect(out.totals.created).toBe(6); // manual 3 + whatsapp 2 + facebook_lead_ads 1
    expect(out.totals.won).toBe(2);
    expect(out.totals.converted).toBe(1);
    const website = out.sources.find((s: any) => s.source === "website")!;
    expect(website.created).toBe(0);
    expect(website.wonRate).toBeNull();
    const partner = out.sources.find((s: any) => s.source === "partner_api");
    expect(partner).toBeUndefined(); // not in data within this window, not in the vocabulary
  });

  it("cross-org isolation: org-2 sees only its own lead", async () => {
    const prisma = fakePrisma();
    seed(prisma);
    const svc = new LeadsService(prisma as any);
    const out = await svc.funnel("org-2", 30, NOW);
    expect(out.totals.created).toBe(1);
    expect(out.totals.wonValueMinor).toBe("77700");
    expect(out.sources.find((s: any) => s.source === "manual")!.created).toBe(1);
  });

  it("empty org: honest zeros and null rates, no crash; days defaults to 30", async () => {
    const prisma = fakePrisma();
    const svc = new LeadsService(prisma as any);
    const out = await svc.funnel("org-3", undefined, NOW);
    expect(out.days).toBe(30);
    expect(out.totals.created).toBe(0);
    expect(out.totals.wonRate).toBeNull();
    expect(out.totals.conversionRate).toBeNull();
    expect(out.totals.wonValueMinor).toBe("0");
    expect(out.sources.every((s: any) => s.created === 0 && s.wonRate === null)).toBe(true);
  });

  it("validates days: integer 1..365 only", async () => {
    const svc = new LeadsService(fakePrisma() as any);
    await expect(svc.funnel("org-1", 0, NOW)).rejects.toMatchObject({ code: "crm.daysMustBeAnIntegerBetween" });
    await expect(svc.funnel("org-1", 366, NOW)).rejects.toMatchObject({ code: "crm.daysMustBeAnIntegerBetween" });
    await expect(svc.funnel("org-1", "abc", NOW)).rejects.toMatchObject({ code: "crm.daysMustBeAnIntegerBetween" });
    await expect(svc.funnel("org-1", 30.5, NOW)).rejects.toMatchObject({ code: "crm.daysMustBeAnIntegerBetween" });
    await expect(svc.funnel("org-1", "90", NOW)).resolves.toMatchObject({ days: 90 });
  });
});
