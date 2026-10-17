import { CompetitorIntelligenceService } from "./competitor-intelligence.service";
import { CompetitorResponseService, deriveCompetitorFindings } from "./competitor-response.service";
import { LearningService } from "./learning.service";
import { EventsService } from "../common/events.service";

/**
 * SA-B18 (Smart AI Phase 4, C2) — Competitor → Action
 * proposals, review-queue half:
 *  - every C1 finding gets exactly one response suggestion
 *    (kind "fact", sourceType "competitor", SUGGESTED-only),
 *    derived from the digest's OWN structured fields with
 *    C1's thresholds — parity with digest.findings is
 *    asserted, never a second computation;
 *  - a price-drop response quotes BOTH real prices (the
 *    rival's observed pair + the org's own live price) ONLY
 *    on the adopted linkage rule: exact name match (name or
 *    nameEn, normalised) against an ACTIVE own product;
 *  - a near-match that is not an exact match fabricates NO
 *    pairing (ownProduct null, an explicit no-linkage
 *    sentence, no own price anywhere in the text);
 *  - a comparative claim is made only when currencies
 *    match;
 *  - burst/silence responses fire on their findings and not
 *    below thresholds; silence keeps C1's honesty wording;
 *  - dedupe across repeated runs; approval forces INTERNAL
 *    (law L3); cross-org isolation; the findings path
 *    (suggestFindings — sweep + endpoint share it) triggers
 *    responses on the bus, fire-and-forget safe.
 * Fake prisma only — no live DB, no LLM anywhere.
 */

// ---------- in-memory fake prisma (SA-B17 harness, + product) ----------
function cmpVal(v: any): any {
  return v instanceof Date ? v.getTime() : v;
}
function condMatch(val: any, cond: any): boolean {
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
    for (const [op, operand] of Object.entries(cond)) {
      if (op === "gt" && !(cmpVal(val) > cmpVal(operand))) return false;
      if (op === "gte" && !(cmpVal(val) >= cmpVal(operand))) return false;
      if (op === "lt" && !(cmpVal(val) < cmpVal(operand))) return false;
      if (op === "lte" && !(cmpVal(val) <= cmpVal(operand))) return false;
      if (op === "in" && !(operand as any[]).some((x) => cmpVal(x) === cmpVal(val))) return false;
      if (op === "notIn" && (operand as any[]).some((x) => cmpVal(x) === cmpVal(val))) return false;
      if (op === "not") {
        if (operand !== null && typeof operand === "object") {
          if (condMatch(val, operand)) return false;
        } else if (cmpVal(val) === cmpVal(operand)) return false;
      }
    }
    return true;
  }
  return cmpVal(val) === cmpVal(cond);
}
function matchesWhere(row: any, where: any): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      if (!(cond as any[]).some((c) => matchesWhere(row, c))) return false;
      continue;
    }
    if (key === "AND") {
      if (!(cond as any[]).every((c) => matchesWhere(row, c))) return false;
      continue;
    }
    if (key.includes("_")) {
      const c = cond as any;
      let ok = true;
      for (const part of key.split("_")) {
        if (cmpVal(row[part]) !== cmpVal(c?.[part])) ok = false;
      }
      if (!ok) return false;
      continue;
    }
    if (!condMatch(row[key], cond)) return false;
  }
  return true;
}
function applyOrder(rows: any[], orderBy: any): any[] {
  const specs = (Array.isArray(orderBy) ? orderBy : [orderBy]).filter(Boolean);
  const out = [...rows];
  for (let i = specs.length - 1; i >= 0; i--) {
    const [field, dir] = Object.entries(specs[i])[0] as [string, string];
    out.sort((a, b) => {
      const av = cmpVal(a[field]) ?? 0;
      const bv = cmpVal(b[field]) ?? 0;
      return dir === "desc" ? (bv > av ? 1 : bv < av ? -1 : 0) : av > bv ? 1 : av < bv ? -1 : 0;
    });
  }
  return out;
}
const TABLE_NAMES = [
  "businessProfile", "organization", "businessPolicy", "knowledgeDocument",
  "performanceSnapshot", "aiBrandVoiceProfile", "customerMemory", "learnedItem",
  "learningState", "dailyAdMetric",
  "competitor", "competitorAd", "competitorPriceObservation", "product",
] as const;
function makeFakePrisma() {
  let seq = 0;
  const nid = () => `fake-${++seq}`;
  const tables: Record<string, any[]> = {};
  for (const n of TABLE_NAMES) tables[n] = [];
  const defaults: Record<string, any> = {
    learnedItem: { status: "suggested" },
    aiBrandVoiceProfile: { status: "suggested" },
    customerMemory: { orderCount: 0, topics: [], notes: [] },
  };
  const model = (name: string) => ({
    findMany: async (args: any = {}) => {
      let rows = tables[name].filter((r) => matchesWhere(r, args.where));
      if (args.orderBy) rows = applyOrder(rows, args.orderBy);
      if (args.skip) rows = rows.slice(args.skip);
      if (args.take) rows = rows.slice(0, args.take);
      return rows;
    },
    findFirst: async (args: any = {}) => {
      let rows = tables[name].filter((r) => matchesWhere(r, args.where));
      if (args.orderBy) rows = applyOrder(rows, args.orderBy);
      return rows[0] ?? null;
    },
    findUnique: async (args: any = {}) => {
      const rows = tables[name].filter((r) => matchesWhere(r, args.where));
      return rows[0] ?? null;
    },
    count: async (args: any = {}) => tables[name].filter((r) => matchesWhere(r, args.where)).length,
    create: async (args: any) => {
      const row = { id: nid(), createdAt: new Date(), updatedAt: new Date(), ...(defaults[name] ?? {}), ...args.data };
      tables[name].push(row);
      return row;
    },
    update: async (args: any) => {
      const row = tables[name].find((r) => r.id === args.where.id);
      if (!row) throw new Error("record not found");
      Object.assign(row, args.data, { updatedAt: new Date() });
      return row;
    },
    upsert: async (args: any) => {
      const existing = tables[name].find((r) => matchesWhere(r, args.where));
      if (existing) {
        Object.assign(existing, args.update, { updatedAt: new Date() });
        return existing;
      }
      const row = { id: nid(), createdAt: new Date(), updatedAt: new Date(), ...(defaults[name] ?? {}), ...args.create };
      tables[name].push(row);
      return row;
    },
    delete: async (args: any) => {
      const idx = tables[name].findIndex((r) => r.id === args.where.id);
      if (idx < 0) throw new Error("record not found");
      return tables[name].splice(idx, 1)[0];
    },
  });
  const prisma: any = { $queryRaw: async () => [] };
  for (const n of TABLE_NAMES) prisma[n] = model(n);
  prisma.__tables = tables;
  return prisma;
}

const NOW = new Date("2026-10-17T12:00:00.000Z");
const D = (iso: string) => new Date(iso);
const A = "org-a";
const B = "org-b";
const DD = "org-d";
const E = "org-e";

let adSeq = 0;
function adRow(competitorId: string, firstSeenIso: string, opts: { active?: boolean; text?: string | null } = {}): any {
  adSeq++;
  return {
    id: `cad-${adSeq}`, competitorId, externalAdId: `ext-${adSeq}`,
    pageId: "pg1", pageName: "Page", startedAt: D(firstSeenIso), stoppedAt: opts.active === false ? D("2026-10-01T00:00:00.000Z") : null,
    isActive: opts.active !== false, platforms: ["facebook"],
    creativeText: opts.text ?? null, linkUrl: null, snapshotUrl: null,
    firstSeenAt: D(firstSeenIso), lastSeenAt: D(firstSeenIso), raw: null,
  };
}
function obsRow(competitorId: string, productName: string, priceMinor: bigint, iso: string, currency = "BDT"): any {
  return {
    id: `obs-${competitorId}-${productName}-${iso}`, competitorId, productName,
    priceMinor, currency, sourceUrl: "https://rival.example/p", sourceType: "website_scan",
    observedAt: D(iso),
  };
}
function productRow(org: string, id: string, name: string, priceMinor: bigint, opts: { nameEn?: string | null; status?: string; currency?: string; createdAt?: string } = {}): any {
  return {
    id, organizationId: org, name, nameEn: opts.nameEn ?? null,
    status: opts.status ?? "ACTIVE", priceMinor, currency: opts.currency ?? "BDT",
    createdAt: D(opts.createdAt ?? "2026-09-01T00:00:00.000Z"), updatedAt: D("2026-09-01T00:00:00.000Z"),
  };
}

/** Same competitor world as SA-B17's org A: Rival Fashion
 * bursts (6 new ads/7d) and drops Panjabi Premium
 * 150000 -> 125000 (-16.67%); Quiet Store is 58d silent. */
function seedOrgA(prisma: any) {
  const t = prisma.__tables;
  t.organization.push({ id: A, name: "Shop A" });
  t.competitor.push(
    { id: "comp-a1", organizationId: A, name: "Rival Fashion", facebookPageId: "fb-rival", facebookPageUrl: null, websiteUrl: "https://rival.example", notes: null, createdAt: D("2026-08-01T00:00:00.000Z"), updatedAt: D("2026-08-01T00:00:00.000Z") },
    { id: "comp-a2", organizationId: A, name: "Quiet Store", facebookPageId: null, facebookPageUrl: null, websiteUrl: null, notes: null, createdAt: D("2026-08-01T00:00:00.000Z"), updatedAt: D("2026-08-01T00:00:00.000Z") },
  );
  t.competitorAd.push(
    adRow("comp-a1", "2026-10-12T10:00:00.000Z", { text: "সেরা মানের পাঞ্জাবি এখন মাত্র ১২৫০ টাকা! আজই অর্ডার করুন" }),
    adRow("comp-a1", "2026-10-13T10:00:00.000Z", { text: "Premium quality shirt — 20% discount this week! Order now" }),
    adRow("comp-a1", "2026-10-14T10:00:00.000Z", { text: "আপনার পছন্দের শাড়ি কোনটি? 🌸" }),
    adRow("comp-a1", "2026-10-15T10:00:00.000Z", { text: "Best fabric collection, limited stock, hurry!" }),
    adRow("comp-a1", "2026-10-16T10:00:00.000Z", { text: "নতুন কালেকশন এসেছে — দেখুন এখনই" }),
    adRow("comp-a1", "2026-10-16T11:00:00.000Z", { text: "" }),
    adRow("comp-a1", "2026-09-25T10:00:00.000Z", { text: "Eid collection sale — up to 30% off" }),
    adRow("comp-a1", "2026-09-20T10:00:00.000Z", { active: false, text: null }),
    adRow("comp-a1", "2026-08-01T10:00:00.000Z", { active: false, text: null }),
    adRow("comp-a2", "2026-08-05T10:00:00.000Z", {}),
    adRow("comp-a2", "2026-08-10T10:00:00.000Z", {}),
    adRow("comp-a2", "2026-08-20T10:00:00.000Z", { active: false }),
  );
  t.competitorPriceObservation.push(
    obsRow("comp-a1", "Panjabi Premium", 150000n, "2026-09-20T09:00:00.000Z"),
    obsRow("comp-a1", "Panjabi Premium", 125000n, "2026-10-15T09:00:00.000Z"),
    obsRow("comp-a1", "Shirt Classic", 90000n, "2026-10-10T09:00:00.000Z"),
  );
}

function makeServices(prisma: any, events?: EventsService) {
  const learning = new LearningService(prisma);
  const intelligence = new CompetitorIntelligenceService(prisma, learning, events);
  const responses = new CompetitorResponseService(prisma, intelligence, learning, events);
  return { learning, intelligence, responses };
}

const responseItems = (prisma: any, org: string) =>
  prisma.__tables.learnedItem.filter((i: any) => i.organizationId === org && String(i.title).startsWith("Competitor response:"));

describe("deriveCompetitorFindings — parity with the C1 digest", () => {
  it("mirrors digest.findings 1:1 (rules, order, evidence text) from the digest's own fields", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    const { intelligence } = makeServices(prisma);
    const digest = await intelligence.computeDigest(A, { now: NOW });
    expect(digest.findings).toHaveLength(3);
    const derived = deriveCompetitorFindings(digest);
    expect(derived.map((f) => f.rule)).toEqual(["price_drop", "launch_burst", "silence"]);
    expect(derived.map((f) => f.findingText)).toEqual(digest.findings);
    expect(derived[0]).toMatchObject({ competitorId: "comp-a1", productName: "Panjabi Premium", deltaPercent: -16.67, priorPriceMinor: "150000", latestPriceMinor: "125000" });
    expect(derived[1]).toMatchObject({ competitorId: "comp-a1", newAds7d: 6, activeAds: 7 });
    expect(derived[2]).toMatchObject({ competitorId: "comp-a2", daysSinceLastNewAd: 58 });
  });
});

describe("CompetitorResponseService — price-drop talking points + the linkage rule", () => {
  it("an exact-name own product links: the response quotes BOTH real prices and compares them", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    prisma.__tables.product.push(productRow(A, "prod-a1", "Panjabi Premium", 140000n));
    const { responses } = makeServices(prisma);
    const out = await responses.suggestResponses(A, { now: NOW });
    expect(out.created).toBe(3);
    const drop = responseItems(prisma, A).find((i: any) => i.content.response.rule === "price_drop");
    expect(drop).toBeTruthy();
    expect(drop.status).toBe("suggested");
    expect(drop.kind).toBe("fact");
    expect(drop.sourceType).toBe("competitor");
    const r = drop.content.response;
    // The finding's real numbers, verbatim from the digest.
    expect(r.priorPriceMinor).toBe("150000");
    expect(r.latestPriceMinor).toBe("125000");
    expect(r.deltaPercent).toBe(-16.67);
    expect(r.findingText ?? drop.content.findingText).toContain("Panjabi Premium");
    // The org's OWN live price, linked by the exact-name rule.
    expect(r.linkage).toBe("exact_name");
    expect(r.ownProduct).toEqual({ productId: "prod-a1", name: "Panjabi Premium", priceMinor: "140000", currency: "BDT" });
    expect(drop.content.text).toContain("BDT 1500.00");
    expect(drop.content.text).toContain("BDT 1250.00");
    expect(drop.content.text).toContain("BDT 1400.00");
    // Own 1400 > rival's new 1250, same currency -> the claim is made.
    expect(drop.content.text).toContain("প্রতিদ্বন্দ্বীর নতুন দাম এখন আপনার দামের চেয়ে কম");
    expect(drop.content.text).toContain("এখানে কোনো দাম বদলানো হয়নি");
  });

  it("a name-only near-match does NOT fabricate a pairing", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    // Superstring + reordered words: plausible-looking, NOT the rule.
    prisma.__tables.product.push(productRow(A, "prod-near1", "Panjabi Premium Special", 99900n));
    prisma.__tables.product.push(productRow(A, "prod-near2", "Premium Panjabi", 88800n));
    const { responses } = makeServices(prisma);
    await responses.suggestResponses(A, { now: NOW });
    const drop = responseItems(prisma, A).find((i: any) => i.content.response.rule === "price_drop");
    expect(drop.content.response.linkage).toBeNull();
    expect(drop.content.response.ownProduct).toBeNull();
    expect(drop.content.text).toContain("হুবহু একই নামের কোনো পণ্য পাওয়া যায়নি");
    // Neither near-match's price appears anywhere in the suggestion.
    expect(JSON.stringify(drop.content)).not.toContain("99900");
    expect(JSON.stringify(drop.content)).not.toContain("88800");
    expect(drop.content.text).not.toContain("BDT 999.00");
    expect(drop.content.text).not.toContain("BDT 888.00");
  });

  it("links through nameEn with case/whitespace normalisation", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    prisma.__tables.product.push(productRow(A, "prod-en", "পাঞ্জাবি প্রিমিয়াম", 130000n, { nameEn: "  panjabi   PREMIUM " }));
    const { responses } = makeServices(prisma);
    const link = await responses.findOwnProductLink(A, "Panjabi Premium");
    expect(link?.productId).toBe("prod-en");
    expect(link?.priceMinor).toBe("130000");
  });

  it("an own product that is not ACTIVE never links", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    prisma.__tables.product.push(productRow(A, "prod-arch", "Panjabi Premium", 140000n, { status: "ARCHIVED" }));
    const { responses } = makeServices(prisma);
    expect(await responses.findOwnProductLink(A, "Panjabi Premium")).toBeNull();
  });

  it("currency mismatch: both prices stated, NO comparative claim", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    prisma.__tables.product.push(productRow(A, "prod-usd", "Panjabi Premium", 140000n, { currency: "USD" }));
    const { responses } = makeServices(prisma);
    await responses.suggestResponses(A, { now: NOW });
    const drop = responseItems(prisma, A).find((i: any) => i.content.response.rule === "price_drop");
    expect(drop.content.response.ownProduct.currency).toBe("USD");
    expect(drop.content.text).toContain("USD 1400.00");
    expect(drop.content.text).toContain("BDT 1250.00");
    expect(drop.content.text).toContain("মুদ্রা আলাদা");
    expect(drop.content.text).not.toContain("চেয়ে কম");
    expect(drop.content.text).not.toContain("দুই দাম এখন সমান");
  });
});

describe("CompetitorResponseService — burst + silence responses", () => {
  it("burst files a counter-content IDEA with the burst facts and honestly-labelled aggregate themes", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    const { responses } = makeServices(prisma);
    await responses.suggestResponses(A, { now: NOW });
    const burst = responseItems(prisma, A).find((i: any) => i.content.response.rule === "launch_burst");
    expect(burst.content.response.kind).toBe("counter_content_idea");
    expect(burst.content.response.newAds7d).toBe(6);
    expect(burst.content.response.activeAds).toBe(7);
    expect(burst.content.text).toContain("6টি নতুন ad চালু করেছে");
    // Themes are ALL-competitor aggregates — labelled as such, never per-rival.
    expect(burst.content.text).toContain("সব প্রতিদ্বন্দ্বী মিলিয়ে");
    expect(burst.content.text).toContain("সামগ্রিক হিসাব, শুধু এই প্রতিদ্বন্দ্বীর নয়");
    // An idea for humans — no draft was produced.
    expect(burst.content.text).toContain("এটি কোনো খসড়া নয়");
    expect(burst.content.text).toContain("কোনো পোস্ট বা campaign তৈরি করা হয়নি");
  });

  it("silence files an opportunity note that keeps C1's caution wording", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    const { responses } = makeServices(prisma);
    await responses.suggestResponses(A, { now: NOW });
    const silence = responseItems(prisma, A).find((i: any) => i.content.response.rule === "silence");
    expect(silence.content.response.kind).toBe("opportunity_note");
    expect(silence.content.response.daysSinceLastNewAd).toBe(58);
    expect(silence.content.text).toContain("58 দিনে কোনো নতুন ad দেয়নি");
    expect(silence.content.text).toContain("নিষ্ক্রিয় এমন দাবি করা হচ্ছে না");
    expect(silence.content.text).toContain("এখানে কোনো পরিবর্তন করা হয়নি");
  });

  it("stays silent below every threshold, and honest for an org tracking nobody", async () => {
    const prisma = makeFakePrisma();
    const t = prisma.__tables;
    t.organization.push({ id: DD, name: "Shop D" });
    t.competitor.push({ id: "comp-d1", organizationId: DD, name: "Calm Rival", facebookPageId: null, facebookPageUrl: null, websiteUrl: null, notes: null, createdAt: D("2026-09-01T00:00:00.000Z"), updatedAt: D("2026-09-01T00:00:00.000Z") });
    for (let i = 0; i < 4; i++) t.competitorAd.push(adRow("comp-d1", `2026-10-${13 + i}T10:00:00.000Z`, {}));
    t.competitorAd.push(adRow("comp-d1", "2026-10-07T10:00:00.000Z", {}));
    t.competitorPriceObservation.push(
      obsRow("comp-d1", "Calm Product", 100000n, "2026-09-25T09:00:00.000Z"),
      obsRow("comp-d1", "Calm Product", 96000n, "2026-10-12T09:00:00.000Z"),
    );
    const { responses } = makeServices(prisma);
    const below = await responses.suggestResponses(DD, { now: NOW });
    expect(below.created).toBe(0);
    expect(below.reason).toBe("no_findings");
    const empty = await responses.suggestResponses(E, { now: NOW });
    expect(empty.created).toBe(0);
    expect(empty.reason).toBe("no_competitors_tracked");
    expect(responseItems(prisma, DD)).toHaveLength(0);
  });
});

describe("CompetitorResponseService — dedupe, approval, isolation, trigger", () => {
  it("dedupes across repeated runs, alongside C1's findings", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    prisma.__tables.product.push(productRow(A, "prod-a1", "Panjabi Premium", 140000n));
    const { intelligence, responses } = makeServices(prisma);
    const f1 = await intelligence.suggestFindings(A, { now: NOW });
    expect(f1.created).toBe(3);
    const r1 = await responses.suggestResponses(A, { now: NOW });
    expect(r1.created).toBe(3);
    const r2 = await responses.suggestResponses(A, { now: NOW });
    expect(r2.created).toBe(0);
    expect(responseItems(prisma, A)).toHaveLength(3);
    expect(prisma.__tables.learnedItem.filter((i: any) => i.organizationId === A)).toHaveLength(6);
  });

  it("approval of a response forces INTERNAL even when public is requested (law L3)", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    const { responses, learning } = makeServices(prisma);
    await responses.suggestResponses(A, { now: NOW });
    const item = responseItems(prisma, A)[0];
    const updated = await learning.approve(A, "owner-1", item.id, { visibility: "public" });
    expect(updated.status).toBe("approved");
    const doc = prisma.__tables.knowledgeDocument.find((d2: any) => d2.organizationId === A);
    expect(doc).toBeTruthy();
    expect(doc.visibility).toBe("internal");
    expect(doc.source).toBe("learned:competitor");
  });

  it("cross-org isolation: org B's responses reference only org B's rivals and products", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    prisma.__tables.product.push(productRow(A, "prod-a1", "Panjabi Premium", 140000n));
    const t = prisma.__tables;
    t.organization.push({ id: B, name: "Shop B" });
    t.competitor.push({ id: "comp-b1", organizationId: B, name: "SENTINEL-BEE Shop", facebookPageId: null, facebookPageUrl: null, websiteUrl: null, notes: null, createdAt: D("2026-09-01T00:00:00.000Z"), updatedAt: D("2026-09-01T00:00:00.000Z") });
    t.competitorPriceObservation.push(
      obsRow("comp-b1", "Bee Product SENTINEL", 500000n, "2026-09-25T09:00:00.000Z"),
      obsRow("comp-b1", "Bee Product SENTINEL", 400000n, "2026-10-12T09:00:00.000Z"),
    );
    t.product.push(productRow(B, "prod-b1", "Bee Product SENTINEL", 450000n));
    // An org-A product whose name matches B's dropped product must never serve B.
    t.product.push(productRow(A, "prod-a-bee", "Bee Product SENTINEL", 11100n));

    const { responses } = makeServices(prisma);
    const outB = await responses.suggestResponses(B, { now: NOW });
    expect(outB.created).toBe(1);
    const itemsB = responseItems(prisma, B);
    expect(itemsB[0].content.response.ownProduct.productId).toBe("prod-b1");
    expect(itemsB[0].content.response.ownProduct.priceMinor).toBe("450000");
    expect(JSON.stringify(itemsB)).not.toContain("Rival Fashion");
    expect(JSON.stringify(itemsB)).not.toContain("140000");
    expect(JSON.stringify(itemsB)).not.toContain("11100");

    const outA = await responses.suggestResponses(A, { now: NOW });
    expect(outA.created).toBe(3);
    expect(JSON.stringify(responseItems(prisma, A))).not.toContain("SENTINEL");
  });

  it("the findings path triggers responses on the bus (sweep + endpoint share suggestFindings)", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    const events = new EventsService();
    const { intelligence, responses } = makeServices(prisma, events);
    responses.onModuleInit();
    const out = await intelligence.suggestFindings(A, { now: NOW });
    expect(out.created).toBe(3);
    // The bus dispatches asynchronously — give the handler its ticks.
    await new Promise((r) => setTimeout(r, 30));
    expect(responseItems(prisma, A)).toHaveLength(3);
  });
});
