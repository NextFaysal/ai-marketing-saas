import { AnswerStoreService, normalizeQuestion, answerContainsLiveFacts } from "./answer-store.service";

/**
 * SA-B3 (Smart AI Phase 0, P4): AnswerStoreService specs.
 *
 * Fake prisma only — in-memory tables plus a pgvector
 * SIMULATION for the two raw-SQL touch points (the search
 * SELECT and the embedding UPDATE), mirroring the SA-B2 proof
 * split: these specs prove the service logic and the SQL's
 * bound-parameter shape; the batch gate proves the same SQL
 * against real pgvector on a throwaway cluster. The fake
 * $queryRaw applies the filters the SQL binds (org / status /
 * channel / provider / model / dimension) and computes real
 * cosine similarity over the vectors the fake $executeRaw
 * stored — the org filter lives in the query, so the
 * cross-org tests fail loudly if it ever goes missing.
 */

type Row = Record<string, any>;
const ORG = "org-a";
const ORG_B = "org-b";
const PAST = new Date("2026-01-01T00:00:00Z");
const FUTURE = new Date(Date.now() + 60_000);

function match(row: Row, where: any = {}): boolean {
  return Object.entries(where ?? {}).every(([k, raw]) => {
    const v = raw as any;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
}
function applyData(row: Row, data: any) {
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v !== null && typeof v === "object" && "increment" in (v as any)) row[k] = (row[k] ?? 0) + (v as any).increment;
    else row[k] = v;
  }
}
function table(store: Row[], name: string) {
  return {
    findMany: jest.fn(async ({ where, take }: any = {}) => {
      const rows = store.filter((r) => match(r, where));
      return take ? rows.slice(0, take) : rows;
    }),
    findFirst: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    findUnique: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `${name}-${store.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      store.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((r) => r.id === where.id || match(r, where));
      if (!row) throw new Error("nf");
      applyData(row, data);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let n = 0;
      for (const r of store) if (match(r, where)) { applyData(r, data); n++; }
      return { count: n };
    }),
  };
}

function cosine(a: number[], b: number[]): number {
  const dot = a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
  const na = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  const nb = Math.sqrt(b.reduce((s, x) => s + x * x, 0));
  return na && nb ? dot / (na * nb) : 0;
}

function setup(embeddingMap: Record<string, number[]> = {}, embeddingsAvailable = true) {
  const answers: Row[] = [];
  const docs: Row[] = [];
  const policies: Row[] = [];
  const profiles: Row[] = [];
  const products: Row[] = [];
  const db: any = {
    aiStoredAnswer: {
      ...table(answers, "ans"),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const key = where.organizationId_normalizedQuestion_channel;
        const existing = answers.find(
          (r) => r.organizationId === key.organizationId && r.normalizedQuestion === key.normalizedQuestion && r.channel === key.channel,
        );
        if (existing) {
          applyData(existing, update);
          existing.updatedAt = new Date();
          return existing;
        }
        const row = { id: `ans-${answers.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...create };
        answers.push(row);
        return row;
      }),
    },
    knowledgeDocument: table(docs, "doc"),
    businessPolicy: table(policies, "pol"),
    businessProfile: table(profiles, "prof"),
    product: table(products, "prod"),
    // pgvector simulation (see header): the search SELECT binds
    // [literal, organizationId, channel, provider, model,
    // dimension, literal]; the embedding UPDATE binds
    // [literal, id, organizationId] (or [id, organizationId]
    // for the NULL clear).
    $queryRaw: jest.fn(async (sql: any) => {
      const text = (sql.strings as string[]).join(" ");
      if (!text.includes('FROM "AiStoredAnswer"')) throw new Error("unexpected $queryRaw");
      const values = sql.values as any[];
      const vector = JSON.parse(values[0]) as number[];
      const [, organizationId, channel, provider, model, dimension] = values;
      return answers
        .filter(
          (r) =>
            r.organizationId === organizationId && r.status === "active" && r.channel === channel &&
            r.provider === provider && r.model === model && r.dimension === dimension && Array.isArray(r._vector),
        )
        .map((r) => ({ id: r.id, similarity: cosine(vector, r._vector) }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5);
    }),
    $executeRaw: jest.fn(async (sql: any) => {
      const text = (sql.strings as string[]).join(" ");
      if (!text.includes('UPDATE "AiStoredAnswer" SET "embedding"')) throw new Error("unexpected $executeRaw");
      const values = sql.values as any[];
      const hasVector = text.includes("::vector");
      const id = hasVector ? values[1] : values[0];
      const organizationId = hasVector ? values[2] : values[1];
      const row = answers.find((r) => r.id === id && r.organizationId === organizationId);
      if (!row) return 0;
      row._vector = hasVector ? (JSON.parse(values[0]) as number[]) : null;
      return 1;
    }),
  };
  const embeddings: any = embeddingsAvailable
    ? {
        embedOne: jest.fn(async (_org: string, text: string) => {
          const v = embeddingMap[text] ?? [0, 0, 1];
          return { ok: true, vectors: [v], provider: "fake", model: "fake-embed", dimension: v.length, inputTokens: 1, tokensEstimated: false };
        }),
      }
    : { embedOne: jest.fn(async () => ({ ok: false, reason: "provider_has_no_embeddings_api" })) };
  const service = new AnswerStoreService(db as any, embeddings);
  return { service, db, embeddings, answers, docs, policies, profiles, products };
}

const DELIVERY_Q = "ডেলিভারি চার্জ কত?";
const DELIVERY_Q_NORM = normalizeQuestion(DELIVERY_Q);
const DELIVERY_A = "ঢাকার ভিতরে ডেলিভারি চার্জ ৬০ টাকা, বাইরে ১২০ টাকা।";

function seedProfile(profiles: Row[], over: Row = {}) {
  profiles.push({
    id: "prof-1", organizationId: ORG, deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n,
    deliveryDaysInside: null, deliveryDaysOutside: null, codAvailable: true, bkashNumber: "01712345678",
    createdAt: PAST, updatedAt: PAST, ...over,
  });
}

describe("SA-B3 normalizeQuestion", () => {
  it("collapses case/punctuation/danda, keeps Bengali letters + marks", () => {
    expect(normalizeQuestion("Delivery Charge KOTO?")).toBe("delivery charge koto");
    expect(normalizeQuestion("ডেলিভারি চার্জ কত।")).toBe("ডেলিভারি চার্জ কত");
    expect(normalizeQuestion("  দাম   কত?? ")).toBe("দাম কত");
    expect(normalizeQuestion(DELIVERY_Q)).toBe(DELIVERY_Q_NORM);
  });
  it("containsLiveFacts = any number at all (conservative)", () => {
    expect(answerContainsLiveFacts(DELIVERY_A)).toBe(true);
    expect(answerContainsLiveFacts("আমরা সকাল ৯টা থেকে খোলা থাকি")).toBe(true);
    expect(answerContainsLiveFacts("ধন্যবাদ, আর কিছু জানতে চাইলে লিখুন")).toBe(false);
  });
});

describe("SA-B3 store + exact lookup", () => {
  it("stores, serves an exact repeat, and counts the hit", async () => {
    const s = setup({ [DELIVERY_Q_NORM]: [1, 0, 0] });
    seedProfile(s.profiles);
    const stored = await s.service.store(ORG, {
      question: DELIVERY_Q, answer: DELIVERY_A, sourceRefs: { profileAreas: ["delivery"] }, origin: "autopilot_grounded",
    });
    expect(stored).toMatchObject({ stored: true, replaced: false, vectorStored: true });
    const hit = await s.service.lookup(ORG, "ডেলিভারি চার্জ কত"); // same normalized question, no "?"
    expect(hit.hit).toBe(true);
    if (hit.hit) {
      expect(hit.answer).toBe(DELIVERY_A);
      expect(hit.via).toBe("exact");
    }
    expect(s.answers[0].hitCount).toBe(1);
    expect(s.answers[0].lastHitAt).toBeInstanceOf(Date);
  });

  it("cross-org isolation: org B's answers never surface for org A (exact + vector)", async () => {
    const s = setup({ [DELIVERY_Q_NORM]: [1, 0, 0] });
    seedProfile(s.profiles);
    s.profiles.push({ id: "prof-2", organizationId: ORG_B, deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n, createdAt: PAST, updatedAt: PAST });
    await s.service.store(ORG_B, {
      question: DELIVERY_Q, answer: DELIVERY_A, sourceRefs: { profileAreas: ["delivery"] }, origin: "autopilot_grounded",
    });
    expect((await s.service.lookup(ORG, DELIVERY_Q)).hit).toBe(false);
    expect((await s.service.lookup(ORG, "ডেলিভারি চার্জ কত")).hit).toBe(false);
    expect(s.answers[0].hitCount).toBe(0); // never served, never counted
    expect((await s.service.lookup(ORG_B, DELIVERY_Q)).hit).toBe(true); // control: B itself can
  });

  it("replace semantics: re-storing the same question keeps ONE row and its hitCount", async () => {
    const s = setup({ [DELIVERY_Q_NORM]: [1, 0, 0] });
    seedProfile(s.profiles);
    await s.service.store(ORG, { question: DELIVERY_Q, answer: DELIVERY_A, sourceRefs: { profileAreas: ["delivery"] }, origin: "autopilot_grounded" });
    await s.service.lookup(ORG, DELIVERY_Q);
    expect(s.answers[0].hitCount).toBe(1);
    const again = await s.service.store(ORG, {
      question: DELIVERY_Q, answer: "ডেলিভারি চার্জ এখন ৭০ টাকা।", sourceRefs: { profileAreas: ["delivery"] }, origin: "staff_edited",
    });
    expect(again).toMatchObject({ stored: true, replaced: true });
    expect(s.answers).toHaveLength(1);
    expect(s.answers[0].answerText).toBe("ডেলিভারি চার্জ এখন ৭০ টাকা।");
    expect(s.answers[0].hitCount).toBe(1); // preserved across the replace
  });

  it("a disabled entry is not served and a re-store does not revive it", async () => {
    const s = setup({ [DELIVERY_Q_NORM]: [1, 0, 0] });
    seedProfile(s.profiles);
    await s.service.store(ORG, { question: DELIVERY_Q, answer: DELIVERY_A, sourceRefs: { profileAreas: ["delivery"] }, origin: "autopilot_grounded" });
    s.answers[0].status = "disabled";
    expect((await s.service.lookup(ORG, DELIVERY_Q)).hit).toBe(false);
    await s.service.store(ORG, { question: DELIVERY_Q, answer: DELIVERY_A, sourceRefs: { profileAreas: ["delivery"] }, origin: "autopilot_grounded" });
    expect(s.answers[0].status).toBe("disabled");
  });

  it("language mismatch is a miss, not an invalidation", async () => {
    const s = setup({ [DELIVERY_Q_NORM]: [1, 0, 0] });
    seedProfile(s.profiles);
    await s.service.store(ORG, {
      question: DELIVERY_Q, answer: DELIVERY_A, language: "bn", sourceRefs: { profileAreas: ["delivery"] }, origin: "autopilot_grounded",
    });
    const miss = await s.service.lookup(ORG, DELIVERY_Q, { language: "en" });
    expect(miss).toMatchObject({ hit: false, reason: "language_mismatch" });
    expect(s.answers[0].status).toBe("active");
    expect((await s.service.lookup(ORG, DELIVERY_Q, { language: "bn" })).hit).toBe(true);
  });
});

describe("SA-B3 store refusals (L3)", () => {
  it("refuses internal / customer-own / personalized flags with typed reasons", async () => {
    const s = setup();
    const base = { question: DELIVERY_Q, answer: DELIVERY_A, origin: "autopilot_grounded" as const };
    expect(await s.service.store(ORG, { ...base, flags: { audience: "internal" } })).toEqual({ stored: false, reason: "audience_internal" });
    expect(await s.service.store(ORG, { ...base, flags: { customerOwn: true } })).toEqual({ stored: false, reason: "customer_own" });
    expect(await s.service.store(ORG, { ...base, flags: { personalized: true } })).toEqual({ stored: false, reason: "personalized" });
    expect(s.answers).toHaveLength(0);
  });

  it("refuses an answer quoting a customer's phone, but allows the shop's OWN bkash number", async () => {
    const s = setup();
    seedProfile(s.profiles); // bkashNumber 01712345678 is the shop's PUBLIC payment number
    const personal = await s.service.store(ORG, {
      question: "আমার নম্বরটা কি আছে?", answer: "আপনার নম্বর 01987654321-এ কল করা হবে।", origin: "autopilot_grounded",
    });
    expect(personal).toEqual({ stored: false, reason: "pii_phone_in_answer" });
    const own = await s.service.store(ORG, {
      question: "বিকাশ নম্বর কি?", answer: "আমাদের বিকাশ নম্বর: 01712345678।", sourceRefs: { profileAreas: ["payment"] }, origin: "autopilot_grounded",
    });
    expect(own).toMatchObject({ stored: true });
  });

  it("refuses order references and card-like digit runs", async () => {
    const s = setup();
    expect(await s.service.store(ORG, { question: "অর্ডার?", answer: "আপনার অর্ডার #10245 প্রসেসিং হচ্ছে।", origin: "autopilot_grounded" }))
      .toEqual({ stored: false, reason: "order_reference_in_answer" });
    expect(await s.service.store(ORG, { question: "কার্ড?", answer: "কার্ড নম্বর 1234567890123456 দিলেই হবে।", origin: "autopilot_grounded" }))
      .toEqual({ stored: false, reason: "pii_card_like_in_answer" });
    expect(s.answers).toHaveLength(0);
  });
});

describe("SA-B3 vector lookup + threshold", () => {
  const NEAR_NORM = normalizeQuestion("ডেলিভারি খরচ কত লাগবে");
  const FAR_NORM = normalizeQuestion("রিটার্ন নীতি কি");
  it("above-threshold paraphrase hits via vector; below-threshold misses", async () => {
    const s = setup({
      [DELIVERY_Q_NORM]: [1, 0, 0],
      [NEAR_NORM]: [0.9, Math.sqrt(1 - 0.81), 0], // cosine 0.90 >= 0.86
      [FAR_NORM]: [0.5, Math.sqrt(1 - 0.25), 0], // cosine 0.50 < 0.86
    });
    seedProfile(s.profiles);
    await s.service.store(ORG, { question: DELIVERY_Q, answer: DELIVERY_A, sourceRefs: { profileAreas: ["delivery"] }, origin: "autopilot_grounded" });
    const near = await s.service.lookup(ORG, "ডেলিভারি খরচ কত লাগবে");
    expect(near.hit).toBe(true);
    if (near.hit) expect(near.via).toBe("vector");
    expect(await s.service.lookup(ORG, "রিটার্ন নীতি কি")).toMatchObject({ hit: false, reason: "no_match" });
  });

  it("embeddings unavailable: stores vectorless, exact still hits, paraphrase misses", async () => {
    const s = setup({}, false);
    seedProfile(s.profiles);
    const stored = await s.service.store(ORG, {
      question: DELIVERY_Q, answer: DELIVERY_A, sourceRefs: { profileAreas: ["delivery"] }, origin: "autopilot_grounded",
    });
    expect(stored).toMatchObject({ stored: true, vectorStored: false });
    expect(s.answers[0].provider).toBeNull();
    expect((await s.service.lookup(ORG, DELIVERY_Q)).hit).toBe(true);
    expect((await s.service.lookup(ORG, "ডেলিভারি খরচ কত লাগবে")).hit).toBe(false);
  });
});

describe("SA-B3 live re-verification (L4: a stored answer never beats live data)", () => {
  async function storedWithDoc(s: ReturnType<typeof setup>) {
    s.docs.push({
      id: "d1", organizationId: ORG, kind: "faq", title: "ওয়ারেন্টি", content: "সব পণ্যে ওয়ারেন্টি সুবিধা আছে।",
      visibility: "public", createdAt: PAST, updatedAt: PAST,
    });
    await s.service.store(ORG, {
      question: "ওয়ারেন্টি আছে কি?", answer: "জি, সব পণ্যে ওয়ারেন্টি সুবিধা আছে।",
      sourceRefs: { docIds: ["d1"] }, origin: "autopilot_grounded",
    });
  }

  it("source doc edited after grounding -> invalidated (source_doc_changed)", async () => {
    const s = setup();
    await storedWithDoc(s);
    s.docs[0].updatedAt = FUTURE;
    const miss = await s.service.lookup(ORG, "ওয়ারেন্টি আছে কি?");
    expect(miss).toMatchObject({ hit: false, reason: "invalidated", invalidReason: "source_doc_changed" });
    expect(s.answers[0].status).toBe("invalidated");
    expect(s.answers[0].invalidReason).toBe("source_doc_changed");
  });

  it("source doc reclassified internal -> invalidated (source_doc_reclassified); removed -> source_doc_removed", async () => {
    const s = setup();
    await storedWithDoc(s);
    s.docs[0].visibility = "internal";
    expect(await s.service.lookup(ORG, "ওয়ারেন্টি আছে কি?")).toMatchObject({ hit: false, invalidReason: "source_doc_reclassified" });

    const s2 = setup();
    await storedWithDoc(s2);
    s2.docs.splice(0, 1);
    expect(await s2.service.lookup(ORG, "ওয়ারেন্টি আছে কি?")).toMatchObject({ hit: false, invalidReason: "source_doc_removed" });
  });

  it("profile edited after grounding -> invalidated (source_profile_changed)", async () => {
    const s = setup();
    seedProfile(s.profiles);
    await s.service.store(ORG, { question: DELIVERY_Q, answer: DELIVERY_A, sourceRefs: { profileAreas: ["delivery"] }, origin: "autopilot_grounded" });
    s.profiles[0].updatedAt = FUTURE;
    expect(await s.service.lookup(ORG, DELIVERY_Q)).toMatchObject({ hit: false, invalidReason: "source_profile_changed" });
  });

  async function storedWithProduct(s: ReturnType<typeof setup>, answer: string) {
    s.products.push({
      id: "p1", organizationId: ORG, name: "কটন শাড়ি", priceMinor: 120000n, currency: "BDT",
      stockQuantity: 5, status: "ACTIVE", createdAt: PAST, updatedAt: PAST,
    });
    await s.service.store(ORG, {
      question: "কটন শাড়ির দাম কত?", answer, sourceRefs: { productIds: ["p1"] }, origin: "autopilot_grounded",
    });
  }

  it("price changed after grounding -> the stored price answer is NOT served (live_facts_changed)", async () => {
    const s = setup();
    await storedWithProduct(s, "কটন শাড়ির দাম ১২০০ টাকা।");
    expect((await s.service.lookup(ORG, "কটন শাড়ির দাম কত?")).hit).toBe(true); // control: live price still 1200
    s.products[0].priceMinor = 150000n;
    const miss = await s.service.lookup(ORG, "কটন শাড়ির দাম কত?");
    expect(miss).toMatchObject({ hit: false, invalidReason: "live_facts_changed" });
    expect(s.answers[0].status).toBe("invalidated");
  });

  it("stock changed -> a stock-quoting answer is invalidated; a price-only answer survives a stock move", async () => {
    const s = setup();
    await storedWithProduct(s, "কটন শাড়ি স্টকে আছে (৫টি), দাম ১২০০ টাকা।");
    s.products[0].stockQuantity = 3;
    expect(await s.service.lookup(ORG, "কটন শাড়ির দাম কত?")).toMatchObject({ hit: false, invalidReason: "live_facts_changed" });

    const s2 = setup();
    await storedWithProduct(s2, "কটন শাড়ির দাম ১২০০ টাকা।");
    s2.products[0].stockQuantity = 3; // the answer never quoted stock
    expect((await s2.service.lookup(ORG, "কটন শাড়ির দাম কত?")).hit).toBe(true);
  });

  it("product archived -> product_unavailable; product renamed -> product_changed", async () => {
    const s = setup();
    await storedWithProduct(s, "কটন শাড়ির দাম ১২০০ টাকা।");
    s.products[0].status = "ARCHIVED";
    expect(await s.service.lookup(ORG, "কটন শাড়ির দাম কত?")).toMatchObject({ hit: false, invalidReason: "product_unavailable" });

    const s2 = setup();
    await storedWithProduct(s2, "কটন শাড়ির দাম ১২০০ টাকা।");
    s2.products[0].name = "সিল্ক শাড়ি";
    expect(await s2.service.lookup(ORG, "কটন শাড়ির দাম কত?")).toMatchObject({ hit: false, invalidReason: "product_changed" });
  });
});
