import { BadRequestException, NotFoundException } from "@nestjs/common";
import { LabelScanService, MAX_LABEL_SCAN_BYTES } from "./label-scan.service";
import { ProductRecognitionService } from "./product-recognition.service";
import { parseLabelExtraction, validateIdentifiers } from "./label-extract";
import { parseProductDescription, rankProductCandidates } from "./product-match";

/**
 * CX8 — label scan + product recognition.
 *
 * Vision is a stub seam (canned text / unavailable); MediaStore is a
 * stub returning fixed bytes. No real vision read, no real send and
 * no live DB are claimed anywhere in this suite.
 */

const ORG = "org-1";
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 1, 2, 3, 4]);
const PDF_BYTES = Buffer.from("%PDF-1.4 fake", "latin1");

// ---------- fake prisma (matches / endsWith / OR aware) ----------
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub));
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("endsWith" in v) return typeof row[k] === "string" && row[k].endsWith((v as any).endsWith);
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("not" in v) return row[k] !== (v as any).not;
    }
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  const calls = { create: 0, update: 0, deleteMany: 0 };
  return {
    rows, calls,
    findFirst: async ({ where, orderBy }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") f = [...f].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return f[0] ?? null;
    },
    findMany: async ({ where, take, orderBy }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") f = [...f].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (orderBy?.updatedAt === "desc") f = [...f].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      return take ? f.slice(0, take) : f;
    },
    create: async ({ data }: any) => { calls.create++; const row = { id: `${name}-new`, createdAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { calls.update++; const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    deleteMany: async () => { calls.deleteMany++; return { count: 0 }; },
  };
}

function shipmentRow(over: any = {}) {
  return {
    id: "sh-1", organizationId: ORG, orderId: "ord-1", provider: "steadfast",
    trackingCode: "TRK-100", invoice: "1042", status: "in_transit",
    recipientName: "Rahim", recipientPhone: "01711112222", recipientAddress: "Dhaka",
    createdAt: new Date("2026-10-01T10:00:00Z"), updatedAt: new Date("2026-10-01T10:00:00Z"),
    ...over,
  };
}
function orderRow(over: any = {}) {
  return {
    id: "ord-1", organizationId: ORG, externalId: "1042", externalNumber: "1042",
    status: "processing", totalMinor: 150000n, currency: "BDT",
    createdAt: new Date("2026-10-01T09:00:00Z"), updatedAt: new Date("2026-10-01T09:00:00Z"),
    ...over,
  };
}

function fakePrisma() {
  return {
    courierShipment: makeTable("shipment"),
    order: makeTable("order"),
    channelConversation: makeTable("conv"),
    channelMessage: makeTable("msg"),
    product: makeTable("product"),
  } as any;
}

function visionReturning(text: string) {
  const calls: any[] = [];
  return {
    calls,
    analyzeImage: async (_org: string, _user: string, input: any) => {
      calls.push(input);
      return { available: true, text, provider: "gemini", model: "gemini-test" };
    },
  } as any;
}
const visionUnavailable = {
  analyzeImage: async () => ({ available: false, reason: "No real AI (LLM) provider is configured" }),
} as any;

describe("CX8 label extraction — parse + shape validation", () => {
  it("valid JSON extraction keeps all three identifiers", () => {
    const out = parseLabelExtraction('{"trackingCode":"TRK-100","orderNumber":"1042","phoneLast4":"2222"}');
    expect(out).toEqual({ trackingCode: "TRK-100", orderNumber: "1042", phoneLast4: "2222" });
  });

  it("fenced JSON still parses; surrounding prose tolerated", () => {
    const out = parseLabelExtraction("Here is the label:\n```json\n{\"trackingCode\":\"SF-88\",\"orderNumber\":null,\"phoneLast4\":null}\n```");
    expect(out).toEqual({ trackingCode: "SF-88" });
  });

  it("garbage / non-JSON model output → extracted {} and no crash", () => {
    expect(parseLabelExtraction("I cannot read this label at all")).toEqual({});
    expect(parseLabelExtraction("")).toEqual({});
    expect(parseLabelExtraction("{not json")).toEqual({});
    expect(parseLabelExtraction('{"trackingCode": 42}')).toEqual({});
  });

  it("shape validation: 5-digit phoneLast4 dropped (not truncated), oversized tracking dropped, inner spaces dropped", () => {
    expect(validateIdentifiers({ phoneLast4: "12345" })).toEqual({});
    expect(validateIdentifiers({ phoneLast4: "১২৩৪" })).toEqual({});
    expect(validateIdentifiers({ trackingCode: "X".repeat(41) })).toEqual({});
    expect(validateIdentifiers({ trackingCode: "TRK 100" })).toEqual({});
    expect(validateIdentifiers({ trackingCode: "TRK-100", phoneLast4: "0171" })).toEqual({ trackingCode: "TRK-100", phoneLast4: "0171" });
  });
});

describe("CX8 label lookup — precedence + org isolation", () => {
  function setup() {
    const prisma = fakePrisma();
    prisma.order.rows.push(orderRow());
    prisma.courierShipment.rows.push(shipmentRow());
    const svc = new LabelScanService(prisma, visionUnavailable);
    return { prisma, svc };
  }

  it("exact tracking match wins — even when the phone last4 points at another parcel", async () => {
    const { prisma, svc } = setup();
    prisma.courierShipment.rows.push(shipmentRow({ id: "sh-2", orderId: "ord-2", trackingCode: "TRK-200", recipientPhone: "01799992222" }));
    prisma.order.rows.push(orderRow({ id: "ord-2", externalId: "2042", externalNumber: "2042" }));
    const out = await svc.lookup(ORG, { trackingCode: "TRK-100", phoneLast4: "2222" });
    expect(out.matched?.shipmentId).toBe("sh-1");
    expect(out.matched?.orderNumber).toBe("1042");
    expect(out.candidates).toEqual([]);
  });

  it("exact order-number match (externalNumber and externalId both reach it)", async () => {
    const { svc } = setup();
    const out = await svc.lookup(ORG, { orderNumber: "1042" });
    expect(out.matched?.orderId).toBe("ord-1");
    expect(out.matched?.trackingCode).toBe("TRK-100");
  });

  it("phone-last4 alone → candidates ONLY (never a single match), capped at 5", async () => {
    const { prisma, svc } = setup();
    for (let i = 0; i < 7; i++) {
      prisma.courierShipment.rows.push(shipmentRow({ id: `sh-x${i}`, orderId: `ord-x${i}`, trackingCode: `TRK-X${i}`, recipientPhone: `018${i}3452222` }));
    }
    const out = await svc.lookup(ORG, { phoneLast4: "2222" });
    expect(out.matched).toBeNull();
    expect(out.candidates.length).toBe(5);
    expect(out.candidates.every((c) => c.phoneLast4 === "2222")).toBe(true);
  });

  it("cross-org identifiers NEVER match: same tracking code in another org is invisible", async () => {
    const { prisma, svc } = setup();
    prisma.courierShipment.rows.push(shipmentRow({ id: "sh-other", organizationId: "org-2", orderId: "ord-other", trackingCode: "TRK-OTHER" }));
    prisma.order.rows.push(orderRow({ id: "ord-other", organizationId: "org-2", externalId: "9999", externalNumber: "9999" }));
    expect((await svc.lookup(ORG, { trackingCode: "TRK-OTHER" })).matched).toBeNull();
    expect((await svc.lookup(ORG, { orderNumber: "9999" })).matched).toBeNull();
    expect((await svc.lookup(ORG, { phoneLast4: "2222" })).candidates.map((c) => c.shipmentId)).not.toContain("sh-other");
  });

  it("no match → honest empty result carrying nothing invented", async () => {
    const { svc } = setup();
    const out = await svc.lookup(ORG, { trackingCode: "NOPE-1", orderNumber: "0000", phoneLast4: "9999" });
    expect(out).toEqual({ matched: null, candidates: [] });
  });

  it("exact identifiers that matched nothing still fall through to phone narrowing", async () => {
    const { svc } = setup();
    const out = await svc.lookup(ORG, { trackingCode: "NOPE-1", phoneLast4: "2222" });
    expect(out.matched).toBeNull();
    expect(out.candidates.map((c) => c.shipmentId)).toEqual(["sh-1"]);
  });
});

describe("CX8 label scan — upload discipline + flow", () => {
  it("non-image magic bytes (a PDF renamed .jpg) → honest Bengali 400", async () => {
    const prisma = fakePrisma();
    const svc = new LabelScanService(prisma, visionReturning("{}"));
    await expect(svc.scanLabel(ORG, "user-1", { buffer: PDF_BYTES, size: PDF_BYTES.length }))
      .rejects.toBeInstanceOf(BadRequestException);
    try { await svc.scanLabel(ORG, "user-1", { buffer: PDF_BYTES, size: PDF_BYTES.length }); } catch (e: any) {
      expect(e.message).toContain("শুধু ছবি");
    }
  });

  it("size cap: a buffer over 8MB → Bengali 400 before any vision call", async () => {
    const prisma = fakePrisma();
    const vision = visionReturning("{}");
    const svc = new LabelScanService(prisma, vision);
    const big = Buffer.alloc(MAX_LABEL_SCAN_BYTES + 1);
    JPEG_BYTES.copy(big, 0);
    await expect(svc.scanLabel(ORG, "user-1", { buffer: big, size: big.length })).rejects.toBeInstanceOf(BadRequestException);
    expect(vision.calls).toHaveLength(0);
  });

  it("vision unavailable → honest setup state, extracted empty, number search still works", async () => {
    const prisma = fakePrisma();
    prisma.order.rows.push(orderRow());
    prisma.courierShipment.rows.push(shipmentRow());
    const svc = new LabelScanService(prisma, visionUnavailable);
    const out: any = await svc.scanLabel(ORG, "user-1", { buffer: JPEG_BYTES, size: JPEG_BYTES.length });
    expect(out.available).toBe(false);
    expect(out.message).toContain("AI ছবি পড়া এখন সেটআপ করা নেই");
    expect(out.extracted).toEqual({});
    expect(out.matched).toBeNull();
    // the no-AI path is unaffected
    const manual: any = await svc.searchByNumber(ORG, "TRK-100");
    expect(manual.matched?.orderId).toBe("ord-1");
  });

  it("happy path: vision JSON → extracted → exact match; feature key is vision_label_scan", async () => {
    const prisma = fakePrisma();
    prisma.order.rows.push(orderRow());
    prisma.courierShipment.rows.push(shipmentRow());
    const vision = visionReturning('{"trackingCode":"TRK-100","orderNumber":null,"phoneLast4":null}');
    const svc = new LabelScanService(prisma, vision);
    const out: any = await svc.scanLabel(ORG, "user-1", { buffer: JPEG_BYTES, size: JPEG_BYTES.length });
    expect(out.available).toBe(true);
    expect(out.extracted).toEqual({ trackingCode: "TRK-100" });
    expect(out.matched?.orderId).toBe("ord-1");
    expect(vision.calls[0].feature).toBe("vision_label_scan");
    expect(vision.calls[0].mimeType).toBe("image/jpeg");
  });

  it("garbage vision output → extracted {} + no crash + honest no-match", async () => {
    const prisma = fakePrisma();
    const svc = new LabelScanService(prisma, visionReturning("the label is blurry, sorry!"));
    const out: any = await svc.scanLabel(ORG, "user-1", { buffer: JPEG_BYTES, size: JPEG_BYTES.length });
    expect(out.available).toBe(true);
    expect(out.extracted).toEqual({});
    expect(out.matched).toBeNull();
    expect(out.candidates).toEqual([]);
  });

  it("searchByNumber: exactly 4 digits narrow by phone; a junk query is a Bengali 400", async () => {
    const prisma = fakePrisma();
    prisma.order.rows.push(orderRow());
    prisma.courierShipment.rows.push(shipmentRow());
    const svc = new LabelScanService(prisma, visionUnavailable);
    const out: any = await svc.searchByNumber(ORG, "2222");
    expect(out.matched).toBeNull();
    expect(out.candidates).toHaveLength(1);
    await expect(svc.searchByNumber(ORG, "   ")).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.searchByNumber(ORG, "a b")).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("CX8 product-match scorer (pure)", () => {
  const desc = { category: "clothing", color: "red", type: "panjabi", keywords: ["cotton", "eid"] };
  const products = [
    { id: "p-red-panjabi", name: "Red Cotton Panjabi", category: "clothing", description: "Soft cotton panjabi for Eid", sku: "PAN-R", imageUrl: "https://x/p.jpg", priceMinor: 150000n, currency: "BDT" },
    { id: "p-blue-panjabi", name: "Blue Panjabi", category: "clothing", description: null, sku: null, imageUrl: null, priceMinor: 120000n, currency: "BDT" },
    { id: "p-shoes", name: "Running Shoes", category: "footwear", description: "Lightweight shoes", sku: null, imageUrl: "https://x/s.jpg", priceMinor: 250000n, currency: "BDT" },
  ];

  it("description overlap ranks the true match first and carries reasons", () => {
    const out = rankProductCandidates(desc as any, products as any);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0].product.id).toBe("p-red-panjabi");
    expect(out[0].reasons.length).toBeGreaterThan(0);
    expect(out[0].reasons.join(" ")).toContain("মিলেছে");
    expect(out.map((c) => c.product.id)).not.toContain("p-shoes");
  });

  it("image-having boost: at EQUAL text score the product with a catalog image ranks first", () => {
    const pair = [
      { id: "noimg", name: "Cotton Panjabi", category: "clothing", description: null, sku: null, imageUrl: null, priceMinor: 100n, currency: "BDT" },
      { id: "withimg", name: "Cotton Panjabi", category: "clothing", description: null, sku: null, imageUrl: "https://x/a.jpg", priceMinor: 100n, currency: "BDT" },
    ];
    const out = rankProductCandidates({ type: "panjabi", keywords: [] } as any, pair as any);
    expect(out).toHaveLength(2);
    expect(out[0].score).toBe(out[1].score);
    expect(out[0].product.id).toBe("withimg");
    expect(out[0].reasons).toContain("ক্যাটালগে ছবি আছে");
  });

  it("below the floor → empty (a single weak description keyword is not a candidate)", () => {
    const out = rankProductCandidates({ keywords: ["soft"] } as any, products as any);
    expect(out).toEqual([]);
    expect(rankProductCandidates({ keywords: [] } as any, products as any)).toEqual([]);
  });

  it("max 5 candidates", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, name: `Cotton Panjabi ${i}`, category: "clothing", description: null, sku: null, imageUrl: null, priceMinor: 100n, currency: "BDT" }));
    const out = rankProductCandidates({ type: "panjabi", category: "clothing", keywords: ["cotton"] } as any, many as any);
    expect(out).toHaveLength(5);
  });

  it("parseProductDescription: garbage → empty description with no keywords (matches nothing)", () => {
    expect(parseProductDescription("not json")).toEqual({ keywords: [] });
    const ok = parseProductDescription('{"category":"Clothing","color":"Red","type":"Panjabi","visibleText":"EID SALE","keywords":["Cotton","eid",42]}');
    expect(ok.category).toBe("clothing");
    expect(ok.color).toBe("red");
    expect(ok.keywords).toEqual(["cotton", "eid"]);
  });
});

describe("CX8 product recognition flow — agent-only, never sends", () => {
  function setup(vision: any) {
    const prisma = fakePrisma();
    prisma.channelConversation.rows.push({ id: "conv-1", organizationId: ORG, channel: "messenger" });
    prisma.channelMessage.rows.push({
      id: "msg-1", conversationId: "conv-1", direction: "in", type: "image",
      mediaStorageKey: "org-1/2026-10/msg-1.jpg", mediaContentType: "image/jpeg", content: null,
    });
    prisma.product.rows.push(
      { id: "p-1", organizationId: ORG, status: "ACTIVE", name: "Red Cotton Panjabi", category: "clothing", description: "Soft cotton panjabi", sku: null, imageUrl: "https://x/p.jpg", priceMinor: 150000n, currency: "BDT", updatedAt: new Date() },
      { id: "p-other-org", organizationId: "org-2", status: "ACTIVE", name: "Red Cotton Panjabi", category: "clothing", description: "Soft cotton panjabi", sku: null, imageUrl: "https://x/q.jpg", priceMinor: 99000n, currency: "BDT", updatedAt: new Date() },
    );
    const mediaStore = { get: async (_key: string) => JPEG_BYTES } as any;
    const svc = new ProductRecognitionService(prisma, vision, mediaStore);
    return { prisma, svc };
  }

  it("returns ranked candidates with REAL price text + reasons; cross-org products never scored", async () => {
    const vision = visionReturning('{"category":"clothing","color":"red","type":"panjabi","keywords":["cotton"]}');
    const { svc } = setup(vision);
    const out: any = await svc.recognize(ORG, "user-1", "conv-1", "msg-1");
    expect(out.available).toBe(true);
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].productId).toBe("p-1");
    expect(out.candidates[0].priceText).toBe("BDT 1500.00");
    expect(out.candidates[0].priceMinor).toBe("150000");
    expect(out.candidates[0].imageUrl).toBe("https://x/p.jpg");
    expect(out.candidates[0].reasons.length).toBeGreaterThan(0);
    expect(vision.calls[0].feature).toBe("vision_product_match");
  });

  it("NO send seam is touched: the flow creates/updates NO message or conversation row", async () => {
    const vision = visionReturning('{"category":"clothing","type":"panjabi","keywords":["cotton"]}');
    const { prisma, svc } = setup(vision);
    await svc.recognize(ORG, "user-1", "conv-1", "msg-1");
    expect(prisma.channelMessage.calls.create).toBe(0);
    expect(prisma.channelMessage.calls.update).toBe(0);
    expect(prisma.channelMessage.calls.deleteMany).toBe(0);
    expect(prisma.channelConversation.calls.create).toBe(0);
    expect(prisma.channelConversation.calls.update).toBe(0);
    // and the service holds no inbox/send dependency at all
    const deps = Object.values(svc as any).map((v: any) => v?.constructor?.name ?? typeof v);
    expect(deps.join(",")).not.toContain("InboxService");
  });

  it("vision unavailable → empty candidates + honest state, nothing asserted", async () => {
    const { svc } = setup(visionUnavailable);
    const out: any = await svc.recognize(ORG, "user-1", "conv-1", "msg-1");
    expect(out.available).toBe(false);
    expect(out.candidates).toEqual([]);
    expect(out.message).toContain("সেটআপ করা নেই");
  });

  it("guards: another org's conversation 404s; an outbound or non-image message is a 400", async () => {
    const vision = visionReturning("{}");
    const { prisma, svc } = setup(vision);
    await expect(svc.recognize("org-2", "user-1", "conv-1", "msg-1")).rejects.toBeInstanceOf(NotFoundException);
    prisma.channelMessage.rows.push({ id: "msg-out", conversationId: "conv-1", direction: "out", type: "image", mediaStorageKey: "k", mediaContentType: "image/jpeg" });
    await expect(svc.recognize(ORG, "user-1", "conv-1", "msg-out")).rejects.toBeInstanceOf(BadRequestException);
    prisma.channelMessage.rows.push({ id: "msg-text", conversationId: "conv-1", direction: "in", type: "text", content: "hi" });
    await expect(svc.recognize(ORG, "user-1", "conv-1", "msg-text")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("a message whose bytes were never stored → honest Bengali error, no vision call", async () => {
    const vision = visionReturning("{}");
    const { prisma, svc } = setup(vision);
    prisma.channelMessage.rows.push({ id: "msg-nobytes", conversationId: "conv-1", direction: "in", type: "image", mediaStorageKey: null, mediaUrl: null, mediaId: "wa-media-id" });
    await expect(svc.recognize(ORG, "user-1", "conv-1", "msg-nobytes")).rejects.toBeInstanceOf(BadRequestException);
    expect(vision.calls).toHaveLength(0);
  });
});
