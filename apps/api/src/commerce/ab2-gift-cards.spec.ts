/**
 * AB2 (AX3) — gift cards.
 *
 * Self-contained fake-prisma harness (the AB1 spec pattern): the
 * REAL GiftCardsService runs against in-memory tables, so ledger
 * rows + the card balance cache can be asserted together.
 *
 * What is pinned here:
 *  - issuance ONLY at the sold transition (exactly-once per
 *    (orderItem, unitIndex) across repeated reconciles);
 *  - code hygiene: hash ≠ code, the sealed copy never contains
 *    the code, the buyer reveal returns the original code, and
 *    staff serialization carries no hash / sealed fields;
 *  - redeem posting exactly-once + the depleted flip, and the
 *    insufficient-at-posting race (null, no entry, card intact);
 *  - redemption restores: cancel ⇒ full, partial refund ⇒
 *    proportional + cumulative (no double on re-run);
 *  - purchase voids: full refund voids the UNSPENT remainder
 *    (spent value is NOT recovered), partial refund never voids;
 *  - the expiry sweep (balance release + depleted flip);
 *  - publicBalance's identical wrong-org / unknown error;
 *  - manualIssue's recipient + note requirements and the
 *    code's absence from the response + audit;
 *  - resolveForCheckout's refusals (disabled, void, lazy
 *    expiry, gift-card-in-cart).
 */
import { GiftCardsService } from "./gift-cards.service";
import { hashGiftCardCode } from "./gift-cards";

// ------------------------------------------------------------------
// Fake prisma harness (mirrors ab1-loyalty.spec.ts)
// ------------------------------------------------------------------

let seq = 0;
const nid = (p: string) => `${p}_${++seq}`;

function cmpVal(a: any, b: any): number {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (av === bv) return 0;
  if (av == null) return -1;
  if (bv == null) return 1;
  return av < bv ? -1 : 1;
}

function matchWhere(row: any, where: any): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      if (!Array.isArray(cond) || !(cond as any[]).some((w) => matchWhere(row, w))) return false;
      continue;
    }
    if (key === "AND") {
      if (!Array.isArray(cond) || !(cond as any[]).every((w) => matchWhere(row, w))) return false;
      continue;
    }
    const v = row[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date) && !Array.isArray(cond)) {
      const c: any = cond;
      if ("in" in c && !c.in.some((x: any) => x === v || String(x) === String(v))) return false;
      if ("notIn" in c && c.notIn.some((x: any) => x === v)) return false;
      if ("gt" in c && !(cmpVal(v, c.gt) > 0)) return false;
      if ("gte" in c && !(cmpVal(v, c.gte) >= 0)) return false;
      if ("lt" in c && !(cmpVal(v, c.lt) < 0)) return false;
      if ("lte" in c && !(cmpVal(v, c.lte) <= 0)) return false;
      if ("not" in c) {
        if (c.not === null) {
          if (v == null) return false;
        } else if (v === c.not) return false;
      }
      if ("equals" in c && v !== c.equals) return false;
      if ("contains" in c && !(typeof v === "string" && v.includes(c.contains))) return false;
      continue;
    }
    if (cond === null) {
      if (v != null) return false;
      continue;
    }
    if (v !== cond) return false;
  }
  return true;
}

function applyData(row: any, data: any) {
  for (const [k, val] of Object.entries(data)) {
    if (val !== null && typeof val === "object" && !(val instanceof Date) && !Array.isArray(val)) {
      const o: any = val;
      if ("increment" in o) row[k] = (typeof row[k] === "bigint" || typeof o.increment === "bigint" ? BigInt(row[k] ?? 0) + BigInt(o.increment) : (row[k] ?? 0) + o.increment);
      else if ("decrement" in o) row[k] = (typeof row[k] === "bigint" || typeof o.decrement === "bigint" ? BigInt(row[k] ?? 0) - BigInt(o.decrement) : (row[k] ?? 0) - o.decrement);
      else if ("set" in o) row[k] = o.set;
      else row[k] = val;
    } else {
      row[k] = val;
    }
  }
}

function sortRows(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  for (const spec of [...specs].reverse()) {
    const [field, dir] = Object.entries(spec)[0] as [string, string];
    out.sort((a, b) => cmpVal(a[field], b[field]) * (dir === "desc" ? -1 : 1));
  }
  return out;
}

class FakeTable {
  rows: any[] = [];
  constructor(public name: string) {}
  async create({ data }: any) {
    const row = { id: data.id ?? nid(this.name), createdAt: new Date(), ...data };
    this.rows.push(row);
    return row;
  }
  async findFirst(args: any = {}) {
    const m = sortRows(this.rows.filter((r) => matchWhere(r, args.where)), args.orderBy);
    return m[0] ?? null;
  }
  async findMany(args: any = {}) {
    let m = sortRows(this.rows.filter((r) => matchWhere(r, args?.where)), args?.orderBy);
    if (args?.skip) m = m.slice(args.skip);
    if (args?.take != null) m = m.slice(0, args.take);
    return m;
  }
  async findUnique(args: any) {
    return this.findFirst(args);
  }
  async update({ where, data }: any) {
    const row = this.rows.find((r) => r.id === where.id) ?? this.rows.find((r) => matchWhere(r, where));
    if (!row) throw new Error(`fake ${this.name}: update target missing`);
    applyData(row, data);
    return row;
  }
  async updateMany({ where, data }: any) {
    const ms = this.rows.filter((r) => matchWhere(r, where));
    for (const r of ms) applyData(r, data);
    return { count: ms.length };
  }
  async upsert({ where, create, update }: any) {
    const found = this.rows.find((r) => matchWhere(r, where));
    if (found) {
      applyData(found, update);
      return found;
    }
    return this.create({ data: create });
  }
  async count(args: any = {}) {
    return this.rows.filter((r) => matchWhere(r, args.where)).length;
  }
}

const TABLE_NAMES = [
  "organization", "order", "orderItem", "product", "courierShipment",
  "giftCardSetting", "giftCardIssuance", "giftCard", "giftCardLedger",
  "messagingSenderConfig",
] as const;

class FakeDb {
  [key: string]: any;
  constructor() {
    for (const n of TABLE_NAMES) this[n] = new FakeTable(n);
  }
  async $transaction(cb: any) {
    return cb(this);
  }
}

const auditStub = { records: [] as any[], log: async function (this: any, r: any) { this.records.push(r); return r; } };
const eventsStub = { on: (_e: string, _h: any) => undefined, emit: (_e: string, _p: any) => undefined };
const smsStub = {
  isConfigured: () => false,
  send: async () => { throw new Error("sms not configured in spec"); },
  sendWithGateway: async () => { throw new Error("sms not configured in spec"); },
};

function makeEmail() {
  const sent: any[] = [];
  return {
    sent,
    isConfigured: () => true,
    send: async (input: any) => { sent.push(input); return { providerMessageId: "msg-1" }; },
  };
}

const ORG = "org1";

function makeService(db: FakeDb, email: any = makeEmail()) {
  const svc = new GiftCardsService(db as any, auditStub as any, eventsStub as any, smsStub as any, email as any);
  return { svc, email };
}

async function seedOrg(db: FakeDb) {
  return db.organization.create({ data: { id: ORG, name: "Test Shop", brandName: "Test Shop" } });
}

async function seedOrder(db: FakeDb, over: any = {}) {
  return db.order.create({
    data: {
      organizationId: ORG,
      status: "completed",
      isPractice: false,
      customerId: "cust_buyer",
      totalMinor: 10000n,
      shippingMinor: 0n,
      giftWrapMinor: 0n,
      refundedMinor: 0n,
      ...over,
    },
  });
}

/** Seed a gift-card purchase order (not yet reconciled). */
async function seedPurchase(db: FakeDb, over: any = {}) {
  const product = await db.product.create({
    data: { organizationId: ORG, name: "Gift Card", isGiftCard: true },
  });
  const order = await seedOrder(db, over.order ?? {});
  const item = await db.orderItem.create({
    data: {
      orderId: order.id,
      productId: product.id,
      name: "Gift Card",
      quantity: over.quantity ?? 1,
      priceMinor: over.amountMinor ?? 5000n,
    },
  });
  return { product, order, item };
}

async function purchaseCard(db: FakeDb, svc: GiftCardsService, over: any = {}) {
  const seeded = await seedPurchase(db, over);
  await svc.onOrderTransition(ORG, seeded.order.id);
  const cards = db.giftCard.rows.filter((r: any) => r.issuedOrderId === seeded.order.id);
  return { ...seeded, cards };
}

async function manualCard(svc: GiftCardsService, amountMinor = "10000") {
  const out = await svc.manualIssue(ORG, "staff1", {
    amountMinor,
    recipientEmail: "recipient@example.com",
    note: "টেস্ট ইস্যু",
  });
  return out;
}

const cardRow = (db: FakeDb, id: string) => db.giftCard.rows.find((r: any) => r.id === id);
const ledgerOf = (db: FakeDb, cardId: string, kind?: string) =>
  db.giftCardLedger.rows.filter((r: any) => r.giftCardId === cardId && (!kind || r.kind === kind));

// ------------------------------------------------------------------
// Issuance: sold-gated, exactly-once
// ------------------------------------------------------------------

describe("AB2 issuance — only at the sold transition", () => {
  it("a pending order mints nothing; delivery mints quantity cards, exactly once across reconciles", async () => {
    const db = new FakeDb();
    await seedOrg(db);
    const { svc } = makeService(db);
    const { order } = await seedPurchase(db, { quantity: 2, amountMinor: 5000n, order: { status: "processing" } });

    await svc.onOrderTransition(ORG, order.id);
    expect(db.giftCard.rows).toHaveLength(0);
    // The intent IS recorded at placement (first writer).
    expect(db.giftCardIssuance.rows).toHaveLength(1);

    await db.order.update({ where: { id: order.id }, data: { status: "completed" } });
    await svc.onOrderTransition(ORG, order.id);
    expect(db.giftCard.rows).toHaveLength(2);
    for (const card of db.giftCard.rows) {
      expect(card.balanceCache).toBe(5000n);
      expect(card.initialAmountMinor).toBe(5000n);
      expect(card.status).toBe("active");
      expect(card.source).toBe("purchase");
      expect(ledgerOf(db, card.id, "issue")).toHaveLength(1);
      expect(ledgerOf(db, card.id, "issue")[0].deltaMinor).toBe(5000n);
      expect(ledgerOf(db, card.id, "issue")[0].balanceAfter).toBe(5000n);
    }
    expect(db.giftCardIssuance.rows[0].issuedAt).toBeTruthy();

    // Reconcile twice more: still exactly N cards / N issue rows.
    await svc.onOrderTransition(ORG, order.id);
    await svc.onOrderTransition(ORG, order.id);
    expect(db.giftCard.rows).toHaveLength(2);
    expect(db.giftCardLedger.rows.filter((r: any) => r.kind === "issue")).toHaveLength(2);
  });

  it("a dead order never mints", async () => {
    const db = new FakeDb();
    await seedOrg(db);
    const { svc } = makeService(db);
    const { order } = await seedPurchase(db, { order: { status: "cancelled" } });
    await svc.onOrderTransition(ORG, order.id);
    expect(db.giftCard.rows).toHaveLength(0);
  });

  it("recordIntents keeps the first writer's recipient (a later hint never rewrites)", async () => {
    const db = new FakeDb();
    await seedOrg(db);
    const { svc } = makeService(db);
    const { order, item } = await seedPurchase(db, { order: { status: "processing" } });
    await svc.recordIntents(ORG, order.id, new Map([[item.id, { recipientEmail: "first@example.com", recipientName: "First" }]]));
    await svc.recordIntents(ORG, order.id, { [item.id]: { recipientEmail: "second@example.com" } });
    expect(db.giftCardIssuance.rows).toHaveLength(1);
    expect(db.giftCardIssuance.rows[0].recipientEmail).toBe("first@example.com");
  });
});

// ------------------------------------------------------------------
// Code hygiene
// ------------------------------------------------------------------

describe("AB2 code hygiene — sealed, hashed, never staff-visible", () => {
  it("stored rows carry hash + sealed only; the reveal returns the original code", async () => {
    const db = new FakeDb();
    await seedOrg(db);
    const { svc } = makeService(db);
    const { order, cards } = await purchaseCard(db, svc, { amountMinor: 7000n });
    expect(cards).toHaveLength(1);
    const card = cards[0];

    const reveal = await svc.buyerRevealForOrder(ORG, order.id);
    expect(reveal).toHaveLength(1);
    const code = reveal[0].code;
    expect(typeof code).toBe("string");
    expect(code.startsWith("QG-")).toBe(true);

    expect(card.codeHash).not.toBe(code);
    expect(card.codeHash).toBe(hashGiftCardCode(code));
    expect(card.codeSealed).not.toContain(code);
    expect(card.codeLast4).toBe(code.slice(-4));
    expect(reveal[0].codeLast4).toBe(code.slice(-4));
    expect(reveal[0].balanceMinor).toBe("7000");

    // A second reveal is stable (the seal round-trips).
    const again = await svc.buyerRevealForOrder(ORG, order.id);
    expect(again[0].code).toBe(code);

    // Staff surfaces expose neither hash nor sealed copy.
    const listed = await svc.listCards(ORG, {});
    expect(listed.items[0].codeSealed).toBeUndefined();
    expect(listed.items[0].codeHash).toBeUndefined();
    expect(JSON.stringify(listed)).not.toContain(code);
    const detail = await svc.getCard(ORG, card.id);
    expect(detail.codeSealed).toBeUndefined();
    expect(detail.codeHash).toBeUndefined();
    expect(JSON.stringify(detail)).not.toContain(code);
  });
});

// ------------------------------------------------------------------
// Redemption posting
// ------------------------------------------------------------------

describe("AB2 postPlacementRedeem", () => {
  it("posts exactly once, flips to depleted at zero, and a partial spend stays active", async () => {
    const db = new FakeDb();
    await seedOrg(db);
    const { svc } = makeService(db);
    const { card } = await manualCard(svc, "10000");
    const row = cardRow(db, card.id);

    const first = await svc.postPlacementRedeem(ORG, { orderId: "spend-1", giftCardId: card.id, amountMinor: 4000n });
    expect(first).toMatchObject({ kind: "redeem", deltaMinor: -4000n, balanceAfter: 6000n, orderId: "spend-1" });
    expect(row.balanceCache).toBe(6000n);
    expect(row.status).toBe("active");

    const again = await svc.postPlacementRedeem(ORG, { orderId: "spend-1", giftCardId: card.id, amountMinor: 4000n });
    expect(again?.id).toBe(first?.id);
    expect(ledgerOf(db, card.id, "redeem")).toHaveLength(1);
    expect(row.balanceCache).toBe(6000n);

    const last = await svc.postPlacementRedeem(ORG, { orderId: "spend-2", giftCardId: card.id, amountMinor: 6000n });
    expect(last).toMatchObject({ kind: "redeem", balanceAfter: 0n });
    expect(row.balanceCache).toBe(0n);
    expect(row.status).toBe("depleted");
  });

  it("insufficient balance at posting time ⇒ null, no entry, card untouched (the order keeps its discount)", async () => {
    const db = new FakeDb();
    await seedOrg(db);
    const { svc } = makeService(db);
    const { card } = await manualCard(svc, "5000");
    const row = cardRow(db, card.id);
    const out = await svc.postPlacementRedeem(ORG, { orderId: "spend-race", giftCardId: card.id, amountMinor: 6000n });
    expect(out).toBeNull();
    expect(ledgerOf(db, card.id, "redeem")).toHaveLength(0);
    expect(row.balanceCache).toBe(5000n);
    expect(row.status).toBe("active");
    // Zero / missing input is also a silent null, never a throw.
    expect(await svc.postPlacementRedeem(ORG, { orderId: "x", giftCardId: card.id, amountMinor: 0n })).toBeNull();
    expect(await svc.postPlacementRedeem(ORG, { orderId: null, giftCardId: card.id, amountMinor: 100n })).toBeNull();
  });
});

// ------------------------------------------------------------------
// Redemption restores
// ------------------------------------------------------------------

describe("AB2 redemption restores", () => {
  async function spentCard() {
    const db = new FakeDb();
    await seedOrg(db);
    const { svc } = makeService(db);
    const { card } = await manualCard(svc, "10000");
    await svc.postPlacementRedeem(ORG, { orderId: "spend-ord", giftCardId: card.id, amountMinor: 4000n });
    return { db, svc, card };
  }

  it("cancelling the spending order restores the full redeemed amount, exactly once", async () => {
    const { db, svc, card } = await spentCard();
    const spendOrder = await seedOrder(db, { status: "cancelled", totalMinor: 50000n });
    // Align the seeded order's id with the redeem's orderId.
    await db.order.update({ where: { id: spendOrder.id }, data: { id: spendOrder.id } });
    db.giftCardLedger.rows.forEach((r: any) => { if (r.kind === "redeem") r.orderId = spendOrder.id; });

    await svc.onOrderTransition(ORG, spendOrder.id);
    const row = cardRow(db, card.id);
    expect(row.balanceCache).toBe(10000n);
    expect(ledgerOf(db, card.id, "restore")).toHaveLength(1);
    expect(ledgerOf(db, card.id, "restore")[0].deltaMinor).toBe(4000n);

    await svc.onOrderTransition(ORG, spendOrder.id);
    expect(ledgerOf(db, card.id, "restore")).toHaveLength(1);
    expect(row.balanceCache).toBe(10000n);
  });

  it("a 50% refund restores half; a further refund restores cumulatively with no double-posting", async () => {
    const { db, svc, card } = await spentCard();
    const spendOrder = await seedOrder(db, { status: "processing", totalMinor: 50000n, refundedMinor: 25000n });
    db.giftCardLedger.rows.forEach((r: any) => { if (r.kind === "redeem") r.orderId = spendOrder.id; });
    const row = cardRow(db, card.id);
    expect(row.balanceCache).toBe(6000n);

    await svc.onOrderTransition(ORG, spendOrder.id);
    expect(row.balanceCache).toBe(8000n); // half of 4000 restored
    await svc.onOrderTransition(ORG, spendOrder.id);
    expect(row.balanceCache).toBe(8000n); // converged, no double

    await db.order.update({ where: { id: spendOrder.id }, data: { refundedMinor: 50000n } });
    await svc.onOrderTransition(ORG, spendOrder.id);
    expect(row.balanceCache).toBe(10000n); // the rest, cumulatively
    const restores = ledgerOf(db, card.id, "restore");
    expect(restores.reduce((s: bigint, r: any) => s + r.deltaMinor, 0n)).toBe(4000n);
  });
});

// ------------------------------------------------------------------
// Purchase voids
// ------------------------------------------------------------------

describe("AB2 purchase voids", () => {
  it("a full purchase refund voids the unspent remainder; spent value is NOT recovered", async () => {
    const db = new FakeDb();
    await seedOrg(db);
    const { svc } = makeService(db);
    const { order, cards } = await purchaseCard(db, svc, { amountMinor: 10000n });
    const card = cards[0];
    // The buyer spends 3000 of it on another order.
    await svc.postPlacementRedeem(ORG, { orderId: "other-order", giftCardId: card.id, amountMinor: 3000n });
    expect(cardRow(db, card.id).balanceCache).toBe(7000n);

    await db.order.update({ where: { id: order.id }, data: { status: "refunded", refundedMinor: 10000n, totalMinor: 10000n } });
    await svc.onOrderTransition(ORG, order.id);
    const row = cardRow(db, card.id);
    expect(row.status).toBe("void");
    expect(row.balanceCache).toBe(0n);
    const voids = ledgerOf(db, card.id, "void");
    expect(voids).toHaveLength(1);
    expect(voids[0].deltaMinor).toBe(-7000n); // only the unspent part
    // Re-run: no second void entry.
    await svc.onOrderTransition(ORG, order.id);
    expect(ledgerOf(db, card.id, "void")).toHaveLength(1);
  });

  it("a partial purchase refund never voids", async () => {
    const db = new FakeDb();
    await seedOrg(db);
    const { svc } = makeService(db);
    const { order, cards } = await purchaseCard(db, svc, { amountMinor: 10000n });
    await db.order.update({ where: { id: order.id }, data: { refundedMinor: 5000n } });
    await svc.onOrderTransition(ORG, order.id);
    const row = cardRow(db, cards[0].id);
    expect(row.status).toBe("active");
    expect(row.balanceCache).toBe(10000n);
    expect(ledgerOf(db, cards[0].id, "void")).toHaveLength(0);
  });
});

// ------------------------------------------------------------------
// Expiry sweep
// ------------------------------------------------------------------

describe("AB2 expiry sweep", () => {
  it("releases the balance, flips to expired, and never re-posts", async () => {
    const db = new FakeDb();
    await seedOrg(db);
    const { svc } = makeService(db);
    const { card } = await manualCard(svc, "5000");
    const row = cardRow(db, card.id);
    row.expiresAt = new Date(Date.now() - 86400000);

    const res = await svc.runExpirySweep(ORG);
    expect(res).toEqual({ expired: 1, releasedMinor: "5000" });
    expect(row.status).toBe("expired");
    expect(row.balanceCache).toBe(0n);
    expect(ledgerOf(db, card.id, "expire")).toHaveLength(1);
    expect(ledgerOf(db, card.id, "expire")[0].deltaMinor).toBe(-5000n);

    const res2 = await svc.runExpirySweep(ORG);
    expect(res2).toEqual({ expired: 0, releasedMinor: "0" });
  });

  it("a depleted card past expiry flips with NO ledger entry", async () => {
    const db = new FakeDb();
    await seedOrg(db);
    const { svc } = makeService(db);
    const { card } = await manualCard(svc, "5000");
    await svc.postPlacementRedeem(ORG, { orderId: "drain", giftCardId: card.id, amountMinor: 5000n });
    const row = cardRow(db, card.id);
    expect(row.status).toBe("depleted");
    row.expiresAt = new Date(Date.now() - 86400000);
    const before = db.giftCardLedger.rows.length;
    const res = await svc.runExpirySweep(ORG);
    expect(res.expired).toBe(1);
    expect(res.releasedMinor).toBe("0");
    expect(row.status).toBe("expired");
    expect(db.giftCardLedger.rows.length).toBe(before);
  });
});

// ------------------------------------------------------------------
// publicBalance
// ------------------------------------------------------------------

describe("AB2 publicBalance", () => {
  it("answers for the owning org; wrong-org and unknown codes fail IDENTICALLY", async () => {
    const db = new FakeDb();
    await seedOrg(db);
    const { svc } = makeService(db);
    const { order } = await purchaseCard(db, svc, { amountMinor: 8000n });
    const [reveal] = await svc.buyerRevealForOrder(ORG, order.id);
    const ok = await svc.publicBalance(ORG, reveal.code);
    expect(ok.balanceMinor).toBe("8000");
    expect(ok.status).toBe("active");
    // No recipient / issuance data leaks on the public surface.
    expect((ok as any).recipientEmail).toBeUndefined();

    let wrongOrgErr: any = null;
    let unknownErr: any = null;
    try { await svc.publicBalance("org2", reveal.code); } catch (e) { wrongOrgErr = e; }
    try { await svc.publicBalance(ORG, "QG-AAAA-AAAA-AAAA"); } catch (e) { unknownErr = e; }
    expect(wrongOrgErr).toBeTruthy();
    expect(unknownErr).toBeTruthy();
    expect(wrongOrgErr.message).toBe(unknownErr.message);
    expect(wrongOrgErr.message).toContain("এই দোকানের কার্ড নয়");
  });
});

// ------------------------------------------------------------------
// manualIssue
// ------------------------------------------------------------------

describe("AB2 manualIssue", () => {
  it("refuses without a recipient contact and without a note", async () => {
    const db = new FakeDb();
    await seedOrg(db);
    const { svc } = makeService(db);
    await expect(
      svc.manualIssue(ORG, "staff1", { amountMinor: "5000", note: "কারণ আছে" }),
    ).rejects.toThrow(/প্রাপকের ইমেইল বা ফোন/);
    await expect(
      svc.manualIssue(ORG, "staff1", { amountMinor: "5000", recipientEmail: "not-an-email", note: "কারণ আছে" }),
    ).rejects.toThrow(/প্রাপকের ইমেইল বা ফোন/);
    await expect(
      svc.manualIssue(ORG, "staff1", { amountMinor: "5000", recipientEmail: "r@example.com", note: "  " }),
    ).rejects.toThrow(/নোট/);
    expect(db.giftCard.rows).toHaveLength(0);
  });

  it("issues, sends the code ONLY to the recipient, and keeps it out of the response + audit", async () => {
    const db = new FakeDb();
    await seedOrg(db);
    const email = makeEmail();
    const { svc } = makeService(db, email);
    auditStub.records.length = 0;
    const out = await svc.manualIssue(ORG, "staff1", {
      amountMinor: "5000", recipientEmail: "r@example.com", recipientName: "প্রাপক", note: "উপহার",
    });
    expect(out.sentVia).toBe("email");
    expect(out.card.balanceMinor).toBe("5000");
    expect(out.card.codeSealed).toBeUndefined();
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].to).toBe("r@example.com");
    const codeInEmail = /QG-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/.exec(email.sent[0].text)?.[0];
    expect(codeInEmail).toBeTruthy();
    expect(JSON.stringify(out)).not.toContain(codeInEmail);
    const auditRow = auditStub.records.find((r: any) => r.action === "gift_card.manual_issued");
    expect(auditRow?.metadata?.sentVia).toBe("email");
    expect(auditRow?.metadata?.codeLast4).toBe(codeInEmail!.slice(-4));
    expect(JSON.stringify(auditRow)).not.toContain(codeInEmail);
  });
});

// ------------------------------------------------------------------
// resolveForCheckout refusals
// ------------------------------------------------------------------

describe("AB2 resolveForCheckout", () => {
  async function setup() {
    const db = new FakeDb();
    await seedOrg(db);
    const email = makeEmail();
    const { svc } = makeService(db, email);
    const { card } = await manualCard(svc, "9000");
    const row = cardRow(db, card.id);
    const code = /QG-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/.exec(email.sent[0].text)?.[0]!;
    return { db, svc, card, row, code };
  }

  it("resolves a live card to the checkout snapshot (lowercase / undashed input accepted)", async () => {
    const { svc, card, code } = await setup();
    const snap = await svc.resolveForCheckout(ORG, code.toLowerCase().replace(/-/g, ""));
    expect(snap.giftCardId).toBe(card.id);
    expect(snap.balanceMinor).toBe(9000n);
    expect(snap.codeLast4).toBe(code.slice(-4));
  });

  it("refuses a malformed / unknown code with the generic message", async () => {
    const { svc } = await setup();
    await expect(svc.resolveForCheckout(ORG, "hello")).rejects.toThrow("গিফট কার্ডের কোডটি সঠিক নয়");
    await expect(svc.resolveForCheckout(ORG, "QG-AAAA-AAAA-AAAA")).rejects.toThrow("গিফট কার্ডের কোডটি সঠিক নয়");
    await expect(svc.resolveForCheckout("org2", "QG-AAAA-AAAA-AAAA")).rejects.toThrow("গিফট কার্ডের কোডটি সঠিক নয়");
  });

  it("refuses when redemption is disabled in the settings", async () => {
    const { svc, code } = await setup();
    await svc.updateSetting(ORG, "staff1", { redemptionEnabled: false });
    await expect(svc.resolveForCheckout(ORG, code)).rejects.toThrow(/কেনাকাটা বন্ধ/);
  });

  it("refuses a void card", async () => {
    const { svc, card, code } = await setup();
    await svc.voidCard(ORG, "staff1", card.id, { note: "জালিয়াতি সন্দেহ" });
    await expect(svc.resolveForCheckout(ORG, code)).rejects.toThrow("কার্ডটি বাতিল করা হয়েছে");
  });

  it("refuses a lazily-expired card (stored status still active)", async () => {
    const { svc, row, code } = await setup();
    row.expiresAt = new Date(Date.now() - 60000);
    await expect(svc.resolveForCheckout(ORG, code)).rejects.toThrow(/মেয়াদ শেষ/);
  });

  it("refuses when the cart itself contains a gift-card product", async () => {
    const { svc, code } = await setup();
    await expect(
      svc.resolveForCheckout(ORG, code, { cartHasGiftCardProduct: true }),
    ).rejects.toThrow("গিফট কার্ড দিয়ে গিফট কার্ড কেনা যাবে না");
  });

  it("refuses a fully-spent card", async () => {
    const { svc, card, code } = await setup();
    await svc.postPlacementRedeem(ORG, { orderId: "drain-2", giftCardId: card.id, amountMinor: 9000n });
    await expect(svc.resolveForCheckout(ORG, code)).rejects.toThrow(/ব্যালেন্স অবশিষ্ট নেই/);
  });
});

// ------------------------------------------------------------------
// Settings + staff adjust / void + liability
// ------------------------------------------------------------------

describe("AB2 settings, staff corrections, liability", () => {
  it("settings default to redemption-on / no expiry, validate ranges, and upsert", async () => {
    const db = new FakeDb();
    await seedOrg(db);
    const { svc } = makeService(db);
    const def = await svc.getSetting(ORG);
    expect(def.setting.redemptionEnabled).toBe(true);
    expect(def.setting.defaultExpiryDays).toBeNull();
    await expect(svc.updateSetting(ORG, "staff1", { defaultExpiryDays: 0 })).rejects.toThrow();
    await expect(svc.updateSetting(ORG, "staff1", { defaultExpiryDays: 3651 })).rejects.toThrow();
    const saved = await svc.updateSetting(ORG, "staff1", { defaultExpiryDays: 90 });
    expect(saved.setting.defaultExpiryDays).toBe(90);
    const again = await svc.updateSetting(ORG, "staff1", { defaultExpiryDays: null });
    expect(again.setting.defaultExpiryDays).toBeNull();
    expect(db.giftCardSetting.rows).toHaveLength(1);
  });

  it("adjust posts through the choke point, refuses a negative result and void/expired cards", async () => {
    const db = new FakeDb();
    await seedOrg(db);
    const { svc } = makeService(db);
    const { card } = await manualCard(svc, "5000");
    const row = cardRow(db, card.id);
    const out = await svc.adjustBalance(ORG, "staff1", card.id, { deltaMinor: "-2000", note: "ভুল সংশোধন" });
    expect(out.card.balanceMinor).toBe("3000");
    expect(row.balanceCache).toBe(3000n);
    await expect(
      svc.adjustBalance(ORG, "staff1", card.id, { deltaMinor: "-3001", note: "x" }),
    ).rejects.toThrow(/ঋণাত্মক/);
    await expect(
      svc.adjustBalance(ORG, "staff1", card.id, { deltaMinor: "0", note: "x" }),
    ).rejects.toThrow();
    await expect(
      svc.adjustBalance(ORG, "staff1", "missing", { deltaMinor: "100", note: "x" }),
    ).rejects.toThrow(/পাওয়া যায়নি/);
    await svc.voidCard(ORG, "staff1", card.id, { note: "বাতিল" });
    expect(row.status).toBe("void");
    expect(row.balanceCache).toBe(0n);
    await expect(
      svc.adjustBalance(ORG, "staff1", card.id, { deltaMinor: "100", note: "x" }),
    ).rejects.toThrow(/সংশোধন করা যাবে না/);
    await expect(svc.voidCard(ORG, "staff1", card.id, { note: "আবার" })).rejects.toThrow(/ইতিমধ্যে বাতিল/);
  });

  it("liability report sums outstanding + the period ledger movements", async () => {
    const db = new FakeDb();
    await seedOrg(db);
    const { svc } = makeService(db);
    const a = await manualCard(svc, "10000");
    await manualCard(svc, "5000");
    await svc.postPlacementRedeem(ORG, { orderId: "liab-spend", giftCardId: a.card.id, amountMinor: 2500n });
    const report = await svc.liabilityReport(ORG);
    expect(report.outstandingMinor).toBe("12500");
    expect(report.outstandingCount).toBe(2);
    expect(report.issuedMinor).toBe("15000");
    expect(report.redeemedMinor).toBe("2500");
    expect(report.truncated).toBe(false);
    await expect(svc.liabilityReport(ORG, "not-a-date")).rejects.toThrow(/তারিখ/);
  });
});
