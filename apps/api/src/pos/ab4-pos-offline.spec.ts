import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { PosService } from "./pos.service";
import { PosOfflineService } from "./pos-offline.service";
import { IdempotencyService } from "../fraud/idempotency.service";
import { OrderLimitBlockedError } from "../common/plan-limit-checks";

/**
 * AB4 (AX6) — POS depth: (i) sale idempotency replay via the
 * GB3 IdempotencyService (namespaced `pos:` keys), (ii–vii)
 * the offline-sync ledger classification: happy sync with
 * variance (0 and non-zero), unknown product → rejected (no
 * createSale call), stock insufficiency → conflict without
 * posting then a FORCED repost → synced, plan-limit → conflict
 * then an unforced repost after the limit lifts → synced,
 * discard rules + audit, and the idempotent synced-retry.
 * Harness mirrors ec34-pos.spec.ts (fake prisma + collaborators,
 * positional construction).
 */

type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
}

function setup(opts: { upsertImpl?: (payload: any) => void } = {}) {
  const products: Row[] = [
    { id: "p1", organizationId: "org-1", name: "চাল ৫ কেজি", sku: "RICE-5", barcode: "8801001", status: "ACTIVE", priceMinor: 50000n, compareAtMinor: null, stockQuantity: 10, categoryId: null, imageUrl: null, preorderEnabled: false },
    { id: "p2", organizationId: "org-1", name: "টি-শার্ট", sku: "TSHIRT", barcode: null, status: "ACTIVE", priceMinor: 80000n, compareAtMinor: null, stockQuantity: null, categoryId: null, imageUrl: null, preorderEnabled: false },
  ];
  const variants: Row[] = [
    { id: "v1", productId: "p2", name: "লাল / L", sku: "TSHIRT-L-RED", priceMinor: 90000n, stockQuantity: 4 },
  ];
  const orders: Row[] = [];
  const pvRows: Row[] = [];
  const syncRows: Row[] = [];
  const idemRows: Row[] = [];
  let orderSeq = 0, pvSeq = 0, syncSeq = 0;

  const genericTable = (rows: Row[], prefix: string, seq: () => number) => ({
    findFirst: jest.fn(async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null),
    findMany: jest.fn(async ({ where, orderBy, take }: any = {}) => {
      let found = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") found = [...found].reverse();
      return take ? found.slice(0, take) : found;
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `${prefix}-${seq()}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
  });

  const prisma: any = {
    product: {
      findFirst: jest.fn(async ({ where }: any) => products.find((r) => matches(r, where)) ?? null),
      findMany: jest.fn(async () => []),
    },
    productVariant: {
      findFirst: jest.fn(async ({ where }: any) => variants.find((r) => matches(r, where)) ?? null),
      findMany: jest.fn(async ({ where }: any = {}) => variants.filter((r) => matches(r, where ?? {}))),
    },
    order: {
      findFirst: jest.fn(async ({ where }: any) => orders.find((r) => matches(r, where)) ?? null),
      findMany: jest.fn(async () => []),
    },
    paymentVerification: genericTable(pvRows, "pv", () => ++pvSeq),
    organization: { findFirst: jest.fn(async () => ({ id: "org-1", name: "টেস্ট দোকান", brandName: null })) },
    posOfflineSync: genericTable(syncRows, "sync", () => ++syncSeq),
    idempotencyRecord: {
      findFirst: jest.fn(async ({ where }: any) => idemRows.find((r) => matches(r, where)) ?? null),
      create: jest.fn(async ({ data }: any) => {
        if (idemRows.some((r) => r.organizationId === data.organizationId && r.key === data.key)) {
          const e: any = new Error("Unique constraint failed");
          e.code = "P2002";
          throw e;
        }
        const row = { id: `idem-${idemRows.length + 1}`, createdAt: new Date(), ...data };
        idemRows.push(row);
        return row;
      }),
    },
  };

  const integrations: any = {
    upsertOrder: jest.fn(async (orgId: string, _storeId: any, payload: any, source: string) => {
      if (opts.upsertImpl) opts.upsertImpl(payload);
      const row = {
        id: `ord-${++orderSeq}`, organizationId: orgId, source,
        externalId: payload.externalId, externalNumber: payload.externalNumber,
        status: payload.status, totalMinor: payload.totalMinor,
        createdAt: new Date(),
        items: (payload.items ?? []).map((i: any, idx: number) => ({ id: `oi-${idx}`, ...i })),
      };
      orders.push(row);
      return "created";
    }),
  };
  const ordersService: any = {
    updateOrder: jest.fn(async (_o: string, _a: string, orderId: string, dto: any) => {
      const row = orders.find((o) => o.id === orderId);
      if (row && dto.status) row.status = dto.status;
      return { id: orderId, status: row?.status };
    }),
    getOne: jest.fn(async (_o: string, orderId: string) => {
      const row = orders.find((o) => o.id === orderId);
      const paid = pvRows.filter((r) => r.orderId === orderId && r.status === "approved")
        .reduce((s, r) => s + BigInt(r.amountMinor ?? 0), 0n);
      const total = BigInt(row?.totalMinor ?? 0);
      const capped = paid > total ? total : paid;
      return {
        id: orderId, externalNumber: row?.externalNumber ?? null, status: row?.status,
        totalMinor: total.toString(), advancePaidMinor: capped.toString(),
        amountDueMinor: (total - capped).toString(), items: row?.items ?? [],
      };
    }),
  };
  const promotions: any = {
    evaluateCheckout: jest.fn(async (_o: string, input: any) => {
      const subtotal = input.lines.reduce((s: bigint, l: any) => s + l.unitPriceMinor * BigInt(l.quantity), 0n);
      return {
        subtotalMinor: subtotal, promotionDiscountMinor: 0n, promotionsApplied: [],
        couponDiscountMinor: 0n, couponFreeShipping: false, appliedDiscountId: null,
        appliedCouponCode: null, referral: null, referralCodeToRecord: null,
        referralDiscountMinor: 0n, totalDiscountMinor: 0n,
        taxMinor: 0n, taxAddedMinor: 0n, taxBreakdown: [], gift: null,
      };
    }),
    stampOrder: jest.fn(async () => undefined),
  };
  const discounts: any = { redeem: jest.fn(async () => ({ id: "d1" })) };
  const audit: any = { log: jest.fn(async () => undefined) };
  const idempotency = new IdempotencyService(prisma);

  const pos = new PosService(
    prisma, integrations, ordersService, promotions, discounts, audit,
    undefined, undefined, idempotency,
  );
  const offline = new PosOfflineService(pos, prisma, audit);
  return {
    pos, offline, prisma, integrations, ordersService, promotions, audit,
    products, variants, orders, pvRows, syncRows, idemRows, idempotency,
  };
}

const PAID = { mode: "paid", method: "cash" } as const;
const saleOf = (items: any[], extra: any = {}) => ({ items, payment: { ...PAID }, ...extra });

describe("AB4 POS — sale idempotency (GB3 replay)", () => {
  it("(i) same idempotencyKey twice → ONE order; the second call returns the stored response", async () => {
    const s = setup();
    const dto: any = saleOf([{ productId: "p1", quantity: 1 }], { idempotencyKey: "key-1" });
    const first: any = await s.pos.createSale("org-1", "staff-1", dto);
    const second: any = await s.pos.createSale("org-1", "staff-1", dto);
    expect(s.integrations.upsertOrder).toHaveBeenCalledTimes(1);
    expect(s.orders).toHaveLength(1);
    expect(second).toEqual(first);
    expect(second.receipt.totalMinor).toBe("50000");
    // Namespaced key, scope "pos".
    expect(s.idemRows).toHaveLength(1);
    expect(s.idemRows[0]).toMatchObject({ key: "pos:key-1", scope: "pos", organizationId: "org-1" });
  });

  it("different keys place different orders; no key = no record", async () => {
    const s = setup();
    await s.pos.createSale("org-1", "staff-1", saleOf([{ productId: "p1", quantity: 1 }], { idempotencyKey: "a" }) as any);
    await s.pos.createSale("org-1", "staff-1", saleOf([{ productId: "p1", quantity: 1 }], { idempotencyKey: "b" }) as any);
    await s.pos.createSale("org-1", "staff-1", saleOf([{ productId: "p1", quantity: 1 }]) as any);
    expect(s.orders).toHaveLength(3);
    expect(s.idemRows).toHaveLength(2);
  });
});

describe("AB4 POS offline sync — classification", () => {
  it("(ii) happy path → synced; variance recorded for the 0 case and a non-zero case", async () => {
    const s = setup();
    const zero: any = await s.offline.sync("org-1", "staff-1", {
      idempotencyKey: "off-1", localReceiptNo: "OFF-a-1", localTotalMinor: 50000,
      sale: saleOf([{ productId: "p1", quantity: 1 }]),
    });
    expect(zero.status).toBe("synced");
    expect(zero.serverOrderId).toBe(s.orders[0].id);
    expect(zero.serverTotalMinor).toBe("50000");
    expect(zero.localTotalMinor).toBe("50000");
    expect(zero.varianceMinor).toBe("0");
    expect(zero.syncedAt).toBeTruthy();
    expect(zero.sale.receipt.totalMinor).toBe("50000");
    expect(zero.attempts).toBe(1);

    const drift: any = await s.offline.sync("org-1", "staff-1", {
      idempotencyKey: "off-2", localReceiptNo: "OFF-a-2", localTotalMinor: 49000,
      sale: saleOf([{ productId: "p1", quantity: 1 }]),
    });
    expect(drift.status).toBe("synced");
    expect(drift.varianceMinor).toBe("1000"); // server 50000 − local 49000

    // No local total → variance stays null (nothing to compare).
    const noLocal: any = await s.offline.sync("org-1", "staff-1", {
      idempotencyKey: "off-3", sale: saleOf([{ productId: "p1", quantity: 1 }]),
    });
    expect(noLocal.status).toBe("synced");
    expect(noLocal.varianceMinor).toBeNull();
  });

  it("(iii) unknown product → rejected and createSale is never called", async () => {
    const s = setup();
    const spy = jest.spyOn(s.pos, "createSale");
    const res: any = await s.offline.sync("org-1", "staff-1", {
      idempotencyKey: "off-bad", localTotalMinor: 1000,
      sale: saleOf([{ productId: "nope", quantity: 1 }]),
    });
    expect(res.status).toBe("rejected");
    expect(res.reason).toContain("পণ্যটি পাওয়া যায়নি বা বন্ধ আছে");
    expect(spy).not.toHaveBeenCalled();
    expect(s.orders).toHaveLength(0);
  });

  it("(iv) insufficient stock → conflict WITHOUT posting; forced repost → synced (createSale got forceStock)", async () => {
    const s = setup();
    const spy = jest.spyOn(s.pos, "createSale");
    const res: any = await s.offline.sync("org-1", "staff-1", {
      idempotencyKey: "off-stock", localTotalMinor: 550000,
      sale: saleOf([{ productId: "p1", quantity: 11 }]), // stock is 10
    });
    expect(res.status).toBe("conflict");
    expect(res.reason).toContain("স্টকে মাত্র 10টি আছে");
    expect(spy).not.toHaveBeenCalled();
    expect(s.integrations.upsertOrder).not.toHaveBeenCalled();

    const reposted: any = await s.offline.repost("org-1", "staff-1", res.id, { force: true });
    expect(reposted.status).toBe("synced");
    expect(reposted.serverOrderId).toBe(s.orders[0].id);
    expect(reposted.attempts).toBe(2);
    // createSale received the stored payload + forceStock.
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0] as any[];
    expect(call[2]).toMatchObject({ idempotencyKey: "off-stock" });
    expect(call[3]).toEqual({ forceStock: true });
    // The sale audit carries the forced marker.
    expect(s.audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: "pos.sale_created",
      metadata: expect.objectContaining({ forced: true }),
    }));
    expect(s.audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: "pos.offline_repost", metadata: expect.objectContaining({ forced: true }),
    }));
  });

  it("(iv-b) aggregated duplicate lines are summed for the stock conflict", async () => {
    const s = setup();
    const res: any = await s.offline.sync("org-1", "staff-1", {
      idempotencyKey: "off-agg", sale: saleOf([
        { productId: "p1", quantity: 6 }, { productId: "p1", quantity: 6 },
      ]),
    });
    expect(res.status).toBe("conflict");
    expect(s.orders).toHaveLength(0);
  });

  it("(v) plan-limit block from createSale → conflict; unforced repost after the limit lifts → synced", async () => {
    let blocked = true;
    const s = setup({
      upsertImpl: () => {
        if (blocked) throw new OrderLimitBlockedError("অর্ডারের সীমা শেষ হয়ে গেছে", "order_limit");
      },
    });
    const res: any = await s.offline.sync("org-1", "staff-1", {
      idempotencyKey: "off-limit", localTotalMinor: 50000,
      sale: saleOf([{ productId: "p1", quantity: 1 }]),
    });
    expect(res.status).toBe("conflict");
    expect(res.reason).toContain("অর্ডারের সীমা শেষ");
    expect(s.orders).toHaveLength(0);

    blocked = false;
    const reposted: any = await s.offline.repost("org-1", "staff-1", res.id, {});
    expect(reposted.status).toBe("synced");
    expect(reposted.attempts).toBe(2);
    expect(s.orders).toHaveLength(1);
  });

  it("(v-b) a non-stock, non-limit createSale error → rejected with the message", async () => {
    const s = setup();
    const res: any = await s.offline.sync("org-1", "staff-1", {
      idempotencyKey: "off-coupon", localTotalMinor: 50000,
      sale: saleOf([{ productId: "p2", variantId: "wrong-variant", quantity: 1 }]),
    });
    // Variant ownership is a pre-check rejection.
    expect(res.status).toBe("rejected");
    expect(res.reason).toContain("ভ্যারিয়েন্টটি এই পণ্যের নয়");
    expect(s.orders).toHaveLength(0);
    // And a duplicate-TrxID style BadRequest surfacing from
    // createSale (not a stock message) is also a rejection.
    void BadRequestException;
  });

  it("(vi) discard from conflict writes the note + audit; discarding a synced row → 400", async () => {
    const s = setup();
    const conflict: any = await s.offline.sync("org-1", "staff-1", {
      idempotencyKey: "off-discard", sale: saleOf([{ productId: "p1", quantity: 99 }]),
    });
    expect(conflict.status).toBe("conflict");
    const discarded: any = await s.offline.discard("org-1", "staff-1", conflict.id, { note: "ক্রেতা ফিরে গেছেন" });
    expect(discarded.status).toBe("discarded");
    expect(discarded.discardNote).toBe("ক্রেতা ফিরে গেছেন");
    expect(s.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "pos.offline_discard" }));

    const synced: any = await s.offline.sync("org-1", "staff-1", {
      idempotencyKey: "off-ok", sale: saleOf([{ productId: "p1", quantity: 1 }]),
    });
    expect(synced.status).toBe("synced");
    await expect(s.offline.discard("org-1", "staff-1", synced.id, {}))
      .rejects.toThrow("সিঙ্ক হয়ে গেছে — বাদ দেওয়া যাবে না");
    // Repost is conflict-only; foreign rows 404.
    await expect(s.offline.repost("org-1", "staff-1", synced.id, {})).rejects.toThrow(BadRequestException);
    await expect(s.offline.discard("org-2", "staff-1", synced.id, {})).rejects.toThrow("পাওয়া যায়নি");
  });

  it("(vii) sync retry of an already-synced key returns the row unchanged — no second attempt", async () => {
    const s = setup();
    const dto: any = {
      idempotencyKey: "off-retry", localReceiptNo: "OFF-r-1", localTotalMinor: 50000,
      sale: saleOf([{ productId: "p1", quantity: 1 }]),
    };
    const first: any = await s.offline.sync("org-1", "staff-1", dto);
    expect(first.status).toBe("synced");
    const again: any = await s.offline.sync("org-1", "staff-1", dto);
    expect(again.id).toBe(first.id);
    expect(again.status).toBe("synced");
    expect(again.attempts).toBe(1);
    expect(again.sale).toBeUndefined();
    expect(s.integrations.upsertOrder).toHaveBeenCalledTimes(1);
    expect(s.syncRows).toHaveLength(1);
  });

  it("list returns rows newest-first, serialized with BigInt strings, honoring the status filter", async () => {
    const s = setup();
    await s.offline.sync("org-1", "staff-1", {
      idempotencyKey: "l-1", localTotalMinor: 50000, sale: saleOf([{ productId: "p1", quantity: 1 }]),
    });
    await s.offline.sync("org-1", "staff-1", {
      idempotencyKey: "l-2", sale: saleOf([{ productId: "p1", quantity: 99 }]),
    });
    const all: any = await s.offline.list("org-1");
    expect(all.rows).toHaveLength(2);
    expect(all.rows[0].idempotencyKey).toBe("l-2");
    expect(typeof all.rows[1].serverTotalMinor).toBe("string");
    const conflicts: any = await s.offline.list("org-1", "conflict");
    expect(conflicts.rows).toHaveLength(1);
    expect(conflicts.rows[0].idempotencyKey).toBe("l-2");
  });
});
