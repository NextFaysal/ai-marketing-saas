/**
 * IN9a — cursor pagination for listConversations.
 *
 * Proves, at the fake-prisma level (the fake APPLIES the where
 * clauses and the (lastMessageAt, id) ordering for real):
 * - encode/decode round-trips, strict rejection of garbage;
 * - a full walk over pages visits every conversation EXACTLY once
 *   in canonical order — including a lastMessageAt TIE split across
 *   a page boundary (the id tie-breaker) and a null lastMessageAt
 *   row (Postgres DESC = nulls first);
 * - the final page reports nextCursor null, intermediates don't;
 * - a malformed cursor falls back to the first page, never throws;
 * - cursors compose with the existing filters (channel here);
 * - a within-page display sort (sort=unread) cannot lose or
 *   duplicate rows across pages;
 * - legacy mode (no cursor key) is untouched: bare array back.
 */
import { InboxService } from "./inbox.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";
import {
  clampConversationPageLimit,
  decodeConversationCursor,
  encodeConversationCursor,
} from "./conversation-cursor";

const llmStub = { getProvider: () => new DevTemplateProvider() } as any;

const T_A = new Date("2026-10-12T10:00:00.000Z");
const T_B = new Date("2026-10-11T10:00:00.000Z");
const T_C = new Date("2026-10-10T10:00:00.000Z");
const T_D = new Date("2026-10-09T10:00:00.000Z");

function conv(id: string, channel: string, lastMessageAt: Date | null, unreadCount = 0) {
  return {
    id, organizationId: "org-1", channel, status: "open",
    contactName: id, contactPhone: null, assignedUserId: null, tags: [],
    unreadCount, isPractice: false, snoozedUntil: null,
    firstResponseAt: new Date("2026-10-01T00:00:00.000Z"),
    lastMessageAt, lastMessagePreview: "x",
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: lastMessageAt ?? new Date("2026-10-01T00:00:00.000Z"),
    autoReplyPaused: false, pipelineStage: "talking",
  };
}

/** Canonical order: null first, then T_A ids desc, T_B, T_C, T_D. */
const CANONICAL = ["n1", "a3", "a2", "a1", "b2", "b1", "c5", "c4", "c3", "c2", "c1", "d1"];

function baseConvs() {
  return [
    conv("n1", "whatsapp", null, 5),
    conv("a3", "messenger", T_A, 0), conv("a2", "messenger", T_A, 9), conv("a1", "messenger", T_A, 1),
    conv("b2", "whatsapp", T_B, 3), conv("b1", "whatsapp", T_B, 0),
    conv("c5", "messenger", T_C, 2), conv("c4", "messenger", T_C, 0), conv("c3", "messenger", T_C, 7),
    conv("c2", "messenger", T_C, 0), conv("c1", "messenger", T_C, 4),
    conv("d1", "whatsapp", T_D, 0),
  ];
}

function cmp(a: any, b: any): number {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (av == null || bv == null) return Number.NaN;
  return av < bv ? -1 : av > bv ? 1 : 0;
}

function matchesWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries<any>(where ?? {})) {
    if (k === "AND") { if (!v.every((w: any) => matchesWhere(row, w))) return false; continue; }
    if (k === "OR") { if (!v.some((w: any) => matchesWhere(row, w))) return false; continue; }
    if (v instanceof Date) {
      if (!(row[k] instanceof Date) || (row[k] as Date).getTime() !== v.getTime()) return false;
      continue;
    }
    if (v === null) { if (row[k] != null) return false; continue; }
    if (typeof v === "object") {
      if (v.in !== undefined && !v.in.includes(row[k])) return false;
      if (v.not !== undefined) { if (v.not === null ? row[k] == null : row[k] === v.not) return false; }
      if (v.gt !== undefined && !(cmp(row[k], v.gt) > 0)) return false;
      if (v.gte !== undefined && !(cmp(row[k], v.gte) >= 0)) return false;
      if (v.lt !== undefined && !(cmp(row[k], v.lt) < 0)) return false;
      if (v.lte !== undefined && !(cmp(row[k], v.lte) <= 0)) return false;
      if (v.has !== undefined && !(row[k] ?? []).includes(v.has)) return false;
      if (v.contains !== undefined && !String(row[k] ?? "").toLowerCase().includes(String(v.contains).toLowerCase())) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

const keyMs = (r: any) => (r.lastMessageAt == null ? Number.POSITIVE_INFINITY : new Date(r.lastMessageAt).getTime());

function fakePrisma() {
  const convs = baseConvs();
  const prisma: any = {
    channelConversation: {
      findMany: async ({ where, orderBy, take }: any) => {
        let rows = convs.filter((c) => matchesWhere(c, where));
        const keys = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
        rows = [...rows].sort((a, b) => {
          for (const k of keys) {
            if (k.lastMessageAt === "desc") {
              const ma = keyMs(a); const mb = keyMs(b);
              if (ma !== mb) return mb - ma;
            }
            if (k.id === "desc") {
              const d = String(b.id).localeCompare(String(a.id));
              if (d) return d;
            }
          }
          return 0;
        });
        return take ? rows.slice(0, take) : rows;
      },
      count: async ({ where }: any) => convs.filter((c) => matchesWhere(c, where)).length,
      aggregate: async () => ({ _sum: { unreadCount: 0 } }),
    },
    channelMessage: { findMany: async () => [] },
    order: { findMany: async () => [] },
    inboxSetting: { findUnique: async () => null },
  };
  const audit = { log: async () => undefined };
  return { prisma, audit };
}

function svc() {
  const fake = fakePrisma();
  return new InboxService(fake.prisma as any, fake.audit as any, llmStub);
}

/** Walk every page and return the flattened ids + page shapes. */
async function walk(s: InboxService, filters: any, limit: number) {
  const ids: string[] = [];
  const pageSizes: number[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 20; guard++) {
    const res: any = await s.listConversations("org-1", { ...filters, cursor, limit }, "user-1");
    expect(Array.isArray(res)).toBe(false);
    ids.push(...res.items.map((r: any) => r.id));
    pageSizes.push(res.items.length);
    if (res.nextCursor === null) return { ids, pageSizes, pages: pageSizes.length };
    expect(typeof res.nextCursor).toBe("string");
    cursor = res.nextCursor;
  }
  throw new Error("walk did not terminate");
}

describe("IN9a cursor codec", () => {
  it("round-trips dated and null timestamps", () => {
    const dated = encodeConversationCursor({ id: "c9", lastMessageAt: T_A });
    expect(decodeConversationCursor(dated)).toEqual({ t: T_A.toISOString(), id: "c9" });
    const nulled = encodeConversationCursor({ id: "c0", lastMessageAt: null });
    expect(decodeConversationCursor(nulled)).toEqual({ t: null, id: "c0" });
    // String timestamps encode identically to Dates.
    expect(encodeConversationCursor({ id: "c9", lastMessageAt: T_A.toISOString() })).toBe(dated);
  });

  it("rejects garbage, tampered and wrong-shape payloads", () => {
    expect(decodeConversationCursor("not-a-cursor!!!")).toBeNull();
    expect(decodeConversationCursor("")).toBeNull();
    expect(decodeConversationCursor(null)).toBeNull();
    expect(decodeConversationCursor(42)).toBeNull();
    const noId = Buffer.from(JSON.stringify({ t: T_A.toISOString() }), "utf8").toString("base64url");
    expect(decodeConversationCursor(noId)).toBeNull();
    const badDate = Buffer.from(JSON.stringify({ t: "junk", id: "c1" }), "utf8").toString("base64url");
    expect(decodeConversationCursor(badDate)).toBeNull();
  });

  it("clamps the page limit to [1, 100] with a 100 default", () => {
    expect(clampConversationPageLimit(undefined)).toBe(100);
    expect(clampConversationPageLimit(500)).toBe(100);
    expect(clampConversationPageLimit(0)).toBe(1);
    expect(clampConversationPageLimit(7.9)).toBe(7);
    expect(clampConversationPageLimit("junk")).toBe(100);
  });
});

describe("IN9a listConversations cursor mode", () => {
  it("legacy mode (no cursor key) still returns a bare array", async () => {
    const rows: any = await svc().listConversations("org-1", {}, "user-1");
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(12);
  });

  it("walks all 12 conversations exactly once, in canonical order", async () => {
    const { ids, pageSizes } = await walk(svc(), {}, 3);
    expect(ids).toEqual(CANONICAL);
    expect(pageSizes).toEqual([3, 3, 3, 3]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("splits a lastMessageAt tie across the boundary without skip/dup", async () => {
    const s = svc();
    const p1: any = await s.listConversations("org-1", { cursor: null, limit: 3 }, "user-1");
    expect(p1.items.map((r: any) => r.id)).toEqual(["n1", "a3", "a2"]);
    // The boundary row a2 shares T_A with a1 — the next page must
    // start exactly at a1 (id tie-break), not skip to T_B.
    const p2: any = await s.listConversations("org-1", { cursor: p1.nextCursor, limit: 3 }, "user-1");
    expect(p2.items.map((r: any) => r.id)).toEqual(["a1", "b2", "b1"]);
  });

  it("continues correctly after the null-lastMessageAt row", async () => {
    const s = svc();
    const p1: any = await s.listConversations("org-1", { cursor: null, limit: 1 }, "user-1");
    expect(p1.items.map((r: any) => r.id)).toEqual(["n1"]);
    expect(p1.nextCursor).not.toBeNull();
    const p2: any = await s.listConversations("org-1", { cursor: p1.nextCursor, limit: 2 }, "user-1");
    expect(p2.items.map((r: any) => r.id)).toEqual(["a3", "a2"]);
  });

  it("a malformed cursor falls back to the first page", async () => {
    const res: any = await svc().listConversations("org-1", { cursor: "garbage!!", limit: 3 }, "user-1");
    expect(res.items.map((r: any) => r.id)).toEqual(["n1", "a3", "a2"]);
    expect(res.nextCursor).not.toBeNull();
  });

  it("composes with the channel filter across pages", async () => {
    const { ids } = await walk(svc(), { channel: "whatsapp" }, 2);
    expect(ids).toEqual(["n1", "b2", "b1", "d1"]);
  });

  it("a within-page display sort (unread) still walks completely", async () => {
    const { ids } = await walk(svc(), { sort: "unread" }, 4);
    expect([...ids].sort()).toEqual([...CANONICAL].sort());
    expect(new Set(ids).size).toBe(12);
  });

  it("default limit returns everything in one page with nextCursor null", async () => {
    const res: any = await svc().listConversations("org-1", { cursor: null }, "user-1");
    expect(res.items).toHaveLength(12);
    expect(res.nextCursor).toBeNull();
  });
});
