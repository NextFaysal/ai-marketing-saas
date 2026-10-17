import "reflect-metadata";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { LiveCommerceService } from "./live-commerce.service";
import { MetaLiveCommentsProvider } from "./live-comments.provider";
import { MessagingService } from "../messaging/messaging.service";

/**
 * NF1 (FB1) — Live Commerce backend. Fake-prisma harness in the
 * ec34-pos.spec.ts pattern (in-memory tables, org-scoped
 * `matches`, positional construction). Collaborators: OrdersService
 * is a STUB (createManual call-count pins the exactly-once rule);
 * MessagingService is the REAL service over the same fake prisma
 * (the follow-up segment must reuse it, not a fork); the Meta
 * provider is the REAL MetaLiveCommentsProvider with a fake
 * token resolver + fake Graph GET so the evidenced comment shape
 * is exercised end to end — and its unavailable path proves no
 * comment is ever fabricated.
 */

type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub));
    if (k === "AND") return (v as any[]).every((sub) => matches(row, sub));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("not" in v) return row[k] !== (v as any).not;
      return true;
    }
    return row[k] === v;
  });
}

function setup(opts: {
  provider?: any;
  messaging?: boolean;
} = {}) {
  const sessions: Row[] = [];
  const pins: Row[] = [];
  const comments: Row[] = [];
  const links: Row[] = [];
  const orders: Row[] = [];
  const audiences: Row[] = [];
  let seq = 0;
  const nid = (p: string) => `${p}-${++seq}`;

  const products: Row[] = [
    { id: "p1", organizationId: "org-1", name: "শাড়ি", sku: "SARI-1", priceMinor: 150000n, imageUrl: null, status: "ACTIVE" },
    { id: "p2", organizationId: "org-1", name: "কুর্তি", sku: "KURTI-1", priceMinor: 90000n, imageUrl: null, status: "ACTIVE" },
    { id: "p3", organizationId: "org-1", name: "পাঞ্জাবি", sku: "PANJ-1", priceMinor: 120000n, imageUrl: null, status: "ACTIVE" },
    { id: "p9", organizationId: "org-2", name: "অন্য দোকানের পণ্য", sku: "FOREIGN", priceMinor: 1000n, imageUrl: null, status: "ACTIVE" },
  ];
  const socialAccounts: Row[] = [
    { id: "sa-1", organizationId: "org-1", platform: "meta_page", externalId: "page-1", status: "connected", integrationId: "int-1" },
    { id: "sa-9", organizationId: "org-2", platform: "meta_page", externalId: "page-9", status: "connected", integrationId: "int-9" },
  ];
  const customers: Row[] = [
    { id: "cust-1", organizationId: "org-1", firstName: "রহিমা", lastName: "খাতুন", externalId: null, phone: "01710000001" },
    { id: "cust-2", organizationId: "org-1", firstName: "করিম", lastName: "উদ্দিন", externalId: "fb-222", phone: "01710000002" },
  ];

  const generic = (rows: Row[], prefix: string) => ({
    findFirst: jest.fn(async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null),
    findMany: jest.fn(async ({ where, orderBy }: any = {}) => {
      let found = rows.filter((r) => matches(r, where ?? {}));
      const ob = Array.isArray(orderBy) ? orderBy[0] : orderBy;
      if (ob?.createdAt === "desc") found = [...found].reverse();
      if (ob?.commentedAt === "asc") found = [...found].sort((a, b) => new Date(a.commentedAt).getTime() - new Date(b.commentedAt).getTime());
      if (ob?.displayOrder === "asc") found = [...found].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
      return found;
    }),
    create: jest.fn(async ({ data }: any) => {
      if (prefix === "lc" && data.externalCommentId != null
        && rows.some((r) => r.liveSessionId === data.liveSessionId && r.externalCommentId === data.externalCommentId)) {
        const e: any = new Error("Unique constraint failed"); e.code = "P2002"; throw e;
      }
      if (prefix === "lso" && rows.some((r) => r.orderId === data.orderId)) {
        const e: any = new Error("Unique constraint failed"); e.code = "P2002"; throw e;
      }
      const row = { id: nid(prefix), createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    }),
    createMany: jest.fn(async ({ data }: any) => {
      for (const d of data) {
        rows.push({ id: nid(prefix), createdAt: new Date(), updatedAt: new Date(), ...d });
      }
      return { count: data.length };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows) if (matches(row, where)) { Object.assign(row, data); count += 1; }
      return { count };
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) { rows.splice(i, 1); count += 1; }
      return { count };
    }),
  });

  const liveSessionTable: any = generic(sessions, "ls");
  const baseFindFirst = liveSessionTable.findFirst;
  const baseFindMany = liveSessionTable.findMany;
  const withIncludes = (row: Row | null, include: any) => {
    if (!row) return null;
    const out: any = { ...row };
    if (include?._count) {
      out._count = {
        products: pins.filter((p) => p.liveSessionId === row.id).length,
        comments: comments.filter((c) => c.liveSessionId === row.id).length,
        sessionOrders: links.filter((l) => l.liveSessionId === row.id).length,
      };
    }
    if (include?.products) {
      out.products = pins.filter((p) => p.liveSessionId === row.id)
        .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
        .map((p) => ({ ...p, product: products.find((pr) => pr.id === p.productId) ?? null }));
    }
    return out;
  };
  liveSessionTable.findFirst = jest.fn(async ({ where, include }: any = {}) =>
    withIncludes(await baseFindFirst({ where }), include));
  liveSessionTable.findMany = jest.fn(async ({ where, orderBy, include }: any = {}) => {
    const rows = await baseFindMany({ where, orderBy });
    return include ? rows.map((r: Row) => withIncludes(r, include)) : rows;
  });

  const pinTable: any = generic(pins, "lsp");
  const pinFindMany = pinTable.findMany;
  pinTable.findMany = jest.fn(async ({ where, orderBy, include }: any = {}) => {
    const rows = await pinFindMany({ where, orderBy });
    if (include?.product) return rows.map((r: Row) => ({ ...r, product: products.find((pr) => pr.id === r.productId) ?? null }));
    return rows;
  });

  const prisma: any = {
    liveSession: liveSessionTable,
    liveSessionProduct: pinTable,
    liveComment: generic(comments, "lc"),
    liveSessionOrder: generic(links, "lso"),
    product: generic(products, "prod"),
    socialAccount: generic(socialAccounts, "sa"),
    customer: generic(customers, "cust"),
    customerStoreIdentity: generic([], "csi"),
    order: generic(orders, "ord"),
    messagingSavedAudience: generic(audiences, "aud"),
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const audit: any = { log: jest.fn(async () => undefined) };

  let orderSeq = 0;
  const ordersService: any = {
    createManual: jest.fn(async (orgId: string, _actor: string, dto: any) => {
      const total = (dto.items ?? []).reduce(
        (s: bigint, i: any) => s + BigInt(i.unitPriceMinor) * BigInt(i.quantity), 0n,
      ) + BigInt(dto.shippingMinor ?? 0) - BigInt(dto.discountMinor ?? 0);
      const row = {
        id: `ord-live-${++orderSeq}`, organizationId: orgId, source: "manual",
        status: "processing", totalMinor: total, createdAt: new Date(),
      };
      orders.push(row);
      return { ...row, totalMinor: total.toString() };
    }),
  };

  const messaging = opts.messaging === false
    ? undefined
    : new MessagingService(prisma, audit, {} as any, {} as any);

  const service = new LiveCommerceService(prisma, audit, ordersService, messaging as any, opts.provider);
  return {
    service, prisma, audit, ordersService, messaging,
    sessions, pins, comments, links, orders, audiences, products, customers,
  };
}

const ORDER_DTO = {
  customerPhone: "01710000001",
  items: [{ name: "শাড়ি", sku: "SARI-1", quantity: 1, unitPriceMinor: 150000 }],
};

describe("NF1 sessions — create / lifecycle / org isolation", () => {
  it("manual session: creates scheduled, meta fields stay null, mode labelled manual", async () => {
    const s = setup();
    const created: any = await s.service.createSession("org-1", "staff-1", { title: "ঈদ লাইভ" });
    expect(created.status).toBe("scheduled");
    expect(created.source).toBe("manual");
    expect(created.mode).toBe("manual");
    expect(created.socialAccountId).toBeNull();
    expect(created.externalLiveVideoId).toBeNull();
  });

  it("meta session requires BOTH socialAccountId and externalLiveVideoId", async () => {
    const s = setup();
    await expect(s.service.createSession("org-1", "staff-1", { title: "L", source: "meta", socialAccountId: "sa-1" }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(s.service.createSession("org-1", "staff-1", { title: "L", source: "meta", externalLiveVideoId: "vid-1" }))
      .rejects.toBeInstanceOf(BadRequestException);
    const ok: any = await s.service.createSession("org-1", "staff-1", {
      title: "L", source: "meta", socialAccountId: "sa-1", externalLiveVideoId: "vid-1",
    });
    expect(ok.mode).toBe("meta");
    expect(ok.externalLiveVideoId).toBe("vid-1");
  });

  it("meta session refuses ANOTHER org's social account", async () => {
    const s = setup();
    await expect(s.service.createSession("org-1", "staff-1", {
      title: "L", source: "meta", socialAccountId: "sa-9", externalLiveVideoId: "vid-9",
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(s.sessions).toHaveLength(0);
  });

  it("start → live stamps startedAt; end → ended stamps endedAt; ended cannot restart; start/end are idempotent", async () => {
    const s = setup();
    const c: any = await s.service.createSession("org-1", "staff-1", { title: "L" });
    const started: any = await s.service.startSession("org-1", "staff-1", c.id);
    expect(started.status).toBe("live");
    expect(started.startedAt).toBeTruthy();
    const again: any = await s.service.startSession("org-1", "staff-1", c.id);
    expect(again.status).toBe("live");
    const ended: any = await s.service.endSession("org-1", "staff-1", c.id);
    expect(ended.status).toBe("ended");
    expect(ended.endedAt).toBeTruthy();
    await expect(s.service.startSession("org-1", "staff-1", c.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("org B cannot read, start, end, pin on, comment on, recap or segment org A's session (404 everywhere)", async () => {
    const s = setup();
    const c: any = await s.service.createSession("org-1", "staff-1", { title: "A-এর লাইভ" });
    await expect(s.service.getSession("org-2", c.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.service.startSession("org-2", "staff-9", c.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.service.endSession("org-2", "staff-9", c.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.service.setProducts("org-2", "staff-9", c.id, ["p1"])).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.service.listComments("org-2", c.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.service.importComments("org-2", "staff-9", c.id, { commenterName: "X", message: "hi" }))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(s.service.recap("org-2", c.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.service.buildFollowUpSegment("org-2", "staff-9", c.id)).rejects.toBeInstanceOf(NotFoundException);
    // And org B's list never contains org A's session.
    const listB = await s.service.listSessions("org-2");
    expect(listB).toHaveLength(0);
    // Nothing was mutated by the foreign attempts.
    expect(s.sessions[0].status).toBe("scheduled");
    expect(s.comments).toHaveLength(0);
  });
});

describe("NF1 pinned products + now-showing", () => {
  it("setProducts replaces the list in order; a foreign product id refuses BEFORE any write", async () => {
    const s = setup();
    const c: any = await s.service.createSession("org-1", "staff-1", { title: "L" });
    const r1: any = await s.service.setProducts("org-1", "staff-1", c.id, ["p2", "p1"]);
    expect(r1.products.map((p: any) => p.productId)).toEqual(["p2", "p1"]);
    expect(r1.products.map((p: any) => p.displayOrder)).toEqual([0, 1]);
    await expect(s.service.setProducts("org-1", "staff-1", c.id, ["p1", "p9"]))
      .rejects.toBeInstanceOf(BadRequestException);
    // The refused replace left the previous list intact.
    const after = await s.service.getSession("org-1", c.id);
    expect(after.products.map((p: any) => p.productId)).toEqual(["p2", "p1"]);
  });

  it("now-showing exclusivity: setting a second product clears the first; unpinned product 404s", async () => {
    const s = setup();
    const c: any = await s.service.createSession("org-1", "staff-1", { title: "L" });
    await s.service.setProducts("org-1", "staff-1", c.id, ["p1", "p2", "p3"]);
    await s.service.setNowShowing("org-1", "staff-1", c.id, "p1");
    let view: any = await s.service.getSession("org-1", c.id);
    expect(view.products.filter((p: any) => p.isNowShowing).map((p: any) => p.productId)).toEqual(["p1"]);
    await s.service.setNowShowing("org-1", "staff-1", c.id, "p3");
    view = await s.service.getSession("org-1", c.id);
    expect(view.products.filter((p: any) => p.isNowShowing).map((p: any) => p.productId)).toEqual(["p3"]);
    await expect(s.service.setNowShowing("org-1", "staff-1", c.id, "p9")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("NF1 comments — provider honesty + manual import", () => {
  it("provider UNAVAILABLE: stored comments only, mode manual + providerStatus unavailable + reason — nothing fabricated", async () => {
    const provider: any = {
      fetchComments: jest.fn(async () => ({ status: "unavailable", reason: "কোনো Meta অ্যাকাউন্ট যুক্ত নেই — সেশনটি manual মোডে চলছে" })),
    };
    const s = setup({ provider });
    const c: any = await s.service.createSession("org-1", "staff-1", {
      title: "L", source: "meta", socialAccountId: "sa-1", externalLiveVideoId: "vid-1",
    });
    await s.service.importComments("org-1", "staff-1", c.id, { commenterName: "নুসরাত", message: "দাম কত?" });
    const res: any = await s.service.listComments("org-1", c.id);
    expect(res.mode).toBe("manual");
    expect(res.providerStatus).toBe("unavailable");
    expect(res.providerReason).toContain("manual");
    expect(res.comments).toHaveLength(1);
    expect(res.comments[0].commenterName).toBe("নুসরাত");
    expect(s.comments).toHaveLength(1); // the read created nothing
  });

  it("manual session: provider is never consulted, providerStatus not_applicable", async () => {
    const provider: any = { fetchComments: jest.fn(async () => ({ status: "ok", comments: [] })) };
    const s = setup({ provider });
    const c: any = await s.service.createSession("org-1", "staff-1", { title: "L" });
    const res: any = await s.service.listComments("org-1", c.id);
    expect(provider.fetchComments).not.toHaveBeenCalled();
    expect(res.mode).toBe("manual");
    expect(res.providerStatus).toBe("not_applicable");
  });

  it("REAL Meta provider: evidenced Graph shape is mapped + upserted idempotently (second poll creates no duplicates)", async () => {
    const graphRows = [
      { id: "cmt-1", created_time: "2026-10-17T10:00:00+0000", from: { id: "fb-111", name: "সাকিব" }, message: "এটা নিতে চাই" },
      { id: "cmt-2", created_time: "2026-10-17T10:01:00+0000", from: { id: "fb-222", name: "করিম উদ্দিন" }, message: "সাইজ হবে?" },
    ];
    const graphGetFn: any = jest.fn(async () => ({ data: graphRows, paging: { cursors: { after: "x" } } }));
    const provider = new MetaLiveCommentsProvider(
      { resolveAccountToken: jest.fn(async () => ({ account: { id: "sa-1" }, accessToken: "page-token" })) } as any,
      graphGetFn,
    );
    const s = setup({ provider });
    const c: any = await s.service.createSession("org-1", "staff-1", {
      title: "L", source: "meta", socialAccountId: "sa-1", externalLiveVideoId: "vid-1",
    });
    const first: any = await s.service.listComments("org-1", c.id);
    expect(first.mode).toBe("meta");
    expect(first.providerStatus).toBe("ok");
    expect(first.comments).toHaveLength(2);
    expect(first.comments[0]).toMatchObject({
      externalCommentId: "cmt-1", commenterExternalId: "fb-111", commenterName: "সাকিব", source: "meta",
    });
    // The Graph call used ONLY the evidenced fields on the comments edge.
    const call = graphGetFn.mock.calls[0];
    expect(call[1]).toBe("/vid-1/comments");
    expect(call[2].fields).toBe("id,created_time,from{id,name},message");
    const second: any = await s.service.listComments("org-1", c.id);
    expect(second.comments).toHaveLength(2);
    expect(s.comments).toHaveLength(2); // idempotent upsert
  });

  it("REAL Meta provider: token resolution failure → typed unavailable (no throw, no fabricated comments)", async () => {
    const provider = new MetaLiveCommentsProvider(
      { resolveAccountToken: jest.fn(async () => { throw new Error("boom-internal"); }) } as any,
      jest.fn(async () => ({ data: [] })) as any,
    );
    const out: any = await provider.fetchComments({ organizationId: "org-1", socialAccountId: "sa-1", externalLiveVideoId: "vid-1" });
    expect(out.status).toBe("unavailable");
    expect(typeof out.reason).toBe("string");
    const noAccount: any = await provider.fetchComments({ organizationId: "org-1", socialAccountId: null, externalLiveVideoId: "vid-1" });
    expect(noAccount.status).toBe("unavailable");
  });

  it("manual import: batch + single; a repeated externalCommentId is deduped and REPORTED as skipped", async () => {
    const s = setup();
    const c: any = await s.service.createSession("org-1", "staff-1", { title: "L" });
    const batch: any = await s.service.importComments("org-1", "staff-1", c.id, {
      comments: [
        { commenterName: "A", message: "এক", externalCommentId: "ext-1" },
        { commenterName: "B", message: "দুই" },
      ],
    });
    expect(batch.created).toBe(2);
    const again: any = await s.service.importComments("org-1", "staff-1", c.id, {
      commenterName: "A", message: "এক", externalCommentId: "ext-1",
    });
    expect(again.created).toBe(0);
    expect(again.skippedDuplicates).toBe(1);
    expect(s.comments).toHaveLength(2);
    expect(s.comments.every((r) => r.source === "manual")).toBe(true);
  });
});

describe("NF1 comment → order (existing createManual path, exactly-once)", () => {
  it("first call creates via createManual ONCE + links; second call returns the SAME order without calling createManual again", async () => {
    const s = setup();
    const c: any = await s.service.createSession("org-1", "staff-1", { title: "L" });
    const imp: any = await s.service.importComments("org-1", "staff-1", c.id, { commenterName: "রহিমা খাতুন", message: "নিবো" });
    const commentId = imp.comments[0].id;
    const first: any = await s.service.createOrderFromComment("org-1", "staff-1", c.id, commentId, ORDER_DTO as any);
    expect(first.alreadyExisted).toBe(false);
    expect(s.ordersService.createManual).toHaveBeenCalledTimes(1);
    // createManual received the comment context: buyer name fell
    // back to the commenter's name when the body omitted it.
    const manualArg = s.ordersService.createManual.mock.calls[0][2];
    expect(manualArg.customerPhone).toBe("01710000001");
    expect(s.links).toHaveLength(1);
    expect(s.links[0]).toMatchObject({ liveSessionId: c.id, liveCommentId: commentId, orderId: first.orderId, organizationId: "org-1" });

    const second: any = await s.service.createOrderFromComment("org-1", "staff-1", c.id, commentId, ORDER_DTO as any);
    expect(second.alreadyExisted).toBe(true);
    expect(second.orderId).toBe(first.orderId);
    expect(s.ordersService.createManual).toHaveBeenCalledTimes(1);
    expect(s.links).toHaveLength(1);
    expect(s.orders).toHaveLength(1);
  });

  it("a comment of ANOTHER session/org cannot be ordered through this session", async () => {
    const s = setup();
    const a: any = await s.service.createSession("org-1", "staff-1", { title: "A" });
    const b: any = await s.service.createSession("org-1", "staff-1", { title: "B" });
    const imp: any = await s.service.importComments("org-1", "staff-1", a.id, { commenterName: "X", message: "hi" });
    await expect(s.service.createOrderFromComment("org-1", "staff-1", b.id, imp.comments[0].id, ORDER_DTO as any))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(s.ordersService.createManual).not.toHaveBeenCalled();
  });
});

describe("NF1 recap — attributed orders only", () => {
  it("commentCount + distinct commenters + orderCount/revenue ONLY from this session's LiveSessionOrder links", async () => {
    const s = setup();
    const c: any = await s.service.createSession("org-1", "staff-1", { title: "L" });
    const other: any = await s.service.createSession("org-1", "staff-1", { title: "অন্য লাইভ" });
    await s.service.importComments("org-1", "staff-1", c.id, {
      comments: [
        { commenterName: "রহিমা খাতুন", message: "নিবো", commenterExternalId: "fb-111" },
        { commenterName: "রহিমা খাতুন", message: "আরেকটা", commenterExternalId: "fb-111" },
        { commenterName: "করিম উদ্দিন", message: "দাম?", commenterExternalId: "fb-222" },
      ],
    });
    const impOther: any = await s.service.importComments("org-1", "staff-1", other.id, { commenterName: "অন্য", message: "x" });
    // One attributed order on THIS session (150000) and one on
    // the OTHER session (90000) — recap must see only its own.
    const mine = (await s.service.listComments("org-1", c.id)).comments[0];
    await s.service.createOrderFromComment("org-1", "staff-1", c.id, mine.id, ORDER_DTO as any);
    await s.service.createOrderFromComment("org-1", "staff-1", other.id, impOther.comments[0].id, {
      customerPhone: "01710000009",
      items: [{ name: "কুর্তি", sku: "KURTI-1", quantity: 1, unitPriceMinor: 90000 }],
    } as any);
    // An UNLINKED org order must never leak into revenue either.
    s.orders.push({ id: "ord-stray", organizationId: "org-1", totalMinor: 777000n, status: "processing" });

    const recap: any = await s.service.recap("org-1", c.id);
    expect(recap.commentCount).toBe(3);
    expect(recap.distinctCommenters).toBe(2);
    expect(recap.orderCount).toBe(1);
    expect(recap.revenueMinor).toBe("150000");
  });
});

describe("NF1 follow-up segment — MessagingSavedAudience reuse, honest matching", () => {
  it("matches commenters by external id + exact name via the REAL MessagingService; unmatched are counted, not dropped or faked", async () => {
    const s = setup();
    const c: any = await s.service.createSession("org-1", "staff-1", { title: "ঈদ লাইভ" });
    await s.service.importComments("org-1", "staff-1", c.id, {
      comments: [
        // cust-2 carries externalId fb-222 → external-id match.
        { commenterName: "করিম উদ্দিন", message: "আছি", commenterExternalId: "fb-222" },
        // cust-1 (রহিমা খাতুন) has no external id → exact-name match.
        { commenterName: "রহিমা খাতুন", message: "নিবো" },
        // No customer at all → unmatched, counted honestly.
        { commenterName: "অচেনা মানুষ", message: "হাই", commenterExternalId: "fb-999" },
      ],
    });
    const res: any = await s.service.buildFollowUpSegment("org-1", "staff-1", c.id);
    expect(res.commenterCount).toBe(3);
    expect(res.matchedCustomerCount).toBe(2);
    expect(res.unmatchedCount).toBe(1);
    expect(new Set(res.matchedCustomerIds)).toEqual(new Set(["cust-1", "cust-2"]));
    // The audience REALLY went through MessagingService: one
    // MessagingSavedAudience row exists, created by it, carrying
    // the strictly-validated definition.
    expect(s.audiences).toHaveLength(1);
    expect(res.audienceId).toBe(s.audiences[0].id);
    expect(s.audiences[0].name).toContain("ঈদ লাইভ");
    expect(s.audiences[0].definition).toEqual({ entity: "customers", match: "all", conditions: [] });
    expect(res.note).toContain("unmatchedCount");
    // No fake customer was created for the unmatched commenter.
    expect(s.customers).toHaveLength(2);
  });
});
