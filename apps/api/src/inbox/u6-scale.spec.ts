import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MediaStore, mediaKeyFor } from "./media-store";
import { RealtimeService, RealtimeBus } from "./realtime.service";
import { InboxService } from "./inbox.service";

/**
 * Unified Inbox U6 (Milestone 48): media pipeline storage, the
 * Redis-style cross-instance realtime bridge, exports and the
 * retention policy.
 */
const ORG = "org-1";
type Row = Record<string, any>;
function match(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (k === "OR" && Array.isArray(v)) return v.some((sub) => match(row, sub));
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return ((v as any).in as any[]).includes(row[k]);
      if ("not" in v) return (row[k] ?? null) !== (v as any).not;
      if ("lt" in v) return row[k] < (v as any).lt;
      if ("gte" in v) return row[k] >= (v as any).gte;
      if ("lte" in v) return row[k] <= (v as any).lte;
      return true;
    }
    return row[k] === v;
  });
}
function table(store: Row[]) {
  return {
    findMany: jest.fn(async ({ where, orderBy, take }: any = {}) => {
      let rows = store.filter((r) => match(r, where));
      if (orderBy?.createdAt === "desc") rows = [...rows].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      if (orderBy?.createdAt === "asc") rows = [...rows].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
      return take ? rows.slice(0, take) : rows;
    }),
    findFirst: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    findUnique: jest.fn(async ({ where }: any) => store.find((r) => r.id === where.id || r.organizationId === where.organizationId) ?? null),
    create: jest.fn(async ({ data }: any) => { const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), ...data }; store.push(row); return row; }),
    update: jest.fn(async ({ where, data }: any) => { const row = store.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; }),
    delete: jest.fn(async ({ where }: any) => { const i = store.findIndex((r) => r.id === where.id); if (i >= 0) store.splice(i, 1); return {}; }),
    deleteMany: jest.fn(async ({ where }: any) => {
      const before = store.length;
      for (let i = store.length - 1; i >= 0; i--) if (match(store[i], where)) store.splice(i, 1);
      return { count: before - store.length };
    }),
    count: jest.fn(async ({ where }: any = {}) => store.filter((r) => match(r, where)).length),
  };
}

describe("U6 media store", () => {
  it("local mode round-trips bytes and never signs urls", async () => {
    const dir = mkdtempSync(join(tmpdir(), "media-"));
    const store = new MediaStore({ localDir: dir });
    expect(store.mode).toBe("local");
    const key = mediaKeyFor(ORG, "m1", "image/png");
    expect(key).toContain(ORG);
    expect(key.endsWith(".png")).toBe(true);
    await store.put(key, Buffer.from("hello-media"), "image/png");
    expect(existsSync(join(dir, key))).toBe(true);
    const back = await store.get(key);
    expect(back?.toString()).toBe("hello-media");
    expect(await store.get("nope/missing.png")).toBeNull();
    expect(store.signedUrl(key)).toBeNull();
  });

  it("s3 mode produces a structurally valid presigned url", () => {
    const store = new MediaStore({
      bucket: "my-bucket", region: "ap-southeast-1",
      accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret",
    });
    expect(store.mode).toBe("s3");
    const url = store.signedUrl("org-1/2026-10/m1.png", 900);
    expect(url).toContain("my-bucket.s3.ap-southeast-1.amazonaws.com");
    expect(url).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(url).toContain("X-Amz-Expires=900");
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]{64}/);
    expect(url).toContain("X-Amz-Credential=AKIDEXAMPLE");
  });

  it("s3 PUT goes to the signed fetch with an authorization header", async () => {
    const original = global.fetch;
    let seen: any = null;
    (global as any).fetch = jest.fn(async (url: string, init: any) => { seen = { url, init }; return { ok: true, status: 200 }; });
    const store = new MediaStore({
      bucket: "b", region: "auto", endpoint: "https://s3.example.com",
      accessKeyId: "k", secretAccessKey: "s",
    });
    await store.put("org-1/2026-10/m1.jpg", Buffer.from("x"), "image/jpeg");
    expect(seen.url).toBe("https://s3.example.com/b/org-1/2026-10/m1.jpg");
    expect(seen.init.headers.authorization).toContain("AWS4-HMAC-SHA256 Credential=k/");
    expect(seen.init.headers["content-type"]).toBe("image/jpeg");
    (global as any).fetch = original;
  });
});

describe("U6 realtime bus", () => {
  function fakeBusPair() {
    const handlers: ((payload: string) => void)[] = [];
    const bus: RealtimeBus = {
      publish: jest.fn(async (_channel: string, payload: string) => { for (const h of handlers) h(payload); return handlers.length; }),
      subscribe: jest.fn(async (_channel: string, handler: (payload: string) => void) => { handlers.push(handler); }),
    };
    return bus;
  }

  it("an emit on one instance reaches subscribers of another", async () => {
    const bus = fakeBusPair();
    const a = new RealtimeService(); a.attachBus(bus);
    const b = new RealtimeService(); b.attachBus(bus);
    const got: any[] = [];
    const sub = b.stream(ORG).subscribe((e) => { const d = (e as any).data; if (d && typeof d === "object") got.push(d); });
    a.emit(ORG, { type: "message.created", conversationId: "c1" });
    await new Promise((r) => setTimeout(r, 10));
    expect(got).toHaveLength(1);
    expect(got[0].type).toBe("message.created");
    expect(got[0].conversationId).toBe("c1");
    sub.unsubscribe();
  });

  it("without a bus, local delivery still works exactly once", async () => {
    const svc = new RealtimeService();
    const got: any[] = [];
    const sub = svc.stream(ORG).subscribe((e) => { const d = (e as any).data; if (d && typeof d === "object") got.push(d); });
    svc.emit(ORG, { type: "conversation.updated", conversationId: "c9" });
    expect(got).toHaveLength(1);
    sub.unsubscribe();
  });
});

describe("U6 export + retention", () => {
  function fakeDb() {
    const db: any = {
      conversations: [] as Row[], messages: [] as Row[], notes: [] as Row[],
      drafts: [] as Row[], sessions: [] as Row[], settings: [] as Row[],
    };
    db.channelConversation = table(db.conversations);
    db.channelMessage = table(db.messages);
    db.conversationNote = table(db.notes);
    db.messageDraft = table(db.drafts);
    db.botSession = table(db.sessions);
    db.inboxSetting = { findUnique: jest.fn(async () => db.settings[0] ?? null), upsert: jest.fn(async () => ({})) };
    return db;
  }
  const auditStub = () => ({ log: jest.fn(async () => undefined) });
  const svc = (db: any) => new InboxService(db as any, auditStub() as any, undefined as any, undefined, undefined);

  it("exports a thread as JSON and CSV from real rows", async () => {
    const db = fakeDb();
    db.conversations.push({ id: "c1", organizationId: ORG, channel: "webchat", status: "open", pipelineStage: "talking", createdAt: new Date() });
    db.messages.push(
      { id: "m1", conversationId: "c1", direction: "in", type: "text", content: "দাম কত?", status: "received", createdAt: new Date() },
      { id: "m2", conversationId: "c1", direction: "out", type: "text", content: "১২০০ টাকা", status: "sent", createdAt: new Date() },
    );
    const json = await svc(db).exportConversation(ORG, "c1", "json");
    const parsed = JSON.parse(json.body);
    expect(parsed.conversation.pipelineStage).toBe("talking");
    expect(parsed.messages).toHaveLength(2);
    const csv = await svc(db).exportConversation(ORG, "c1", "csv");
    expect(csv.body.split("\n")).toHaveLength(3);
    expect(csv.body).toContain("দাম কত?");
  });

  it("retention deletes only stale CLOSED threads, and only with a policy", async () => {
    const db = fakeDb();
    const old = new Date(Date.now() - 100 * 86400000);
    db.conversations.push(
      { id: "stale", organizationId: ORG, status: "closed", resolvedAt: old, createdAt: old },
      { id: "fresh-closed", organizationId: ORG, status: "closed", resolvedAt: new Date(), createdAt: new Date() },
      { id: "open-old", organizationId: ORG, status: "open", resolvedAt: null, createdAt: old },
    );
    db.messages.push(
      { id: "m1", conversationId: "stale", direction: "in", type: "text", createdAt: old },
      { id: "m2", conversationId: "open-old", direction: "in", type: "text", createdAt: old },
    );
    db.settings.push({ organizationId: ORG, retentionDays: 30 });
    const out = await svc(db).applyRetention(ORG);
    expect(out.deleted).toBe(1);
    expect(db.conversations.map((c: Row) => c.id).sort()).toEqual(["fresh-closed", "open-old"]);
    expect(db.messages.map((m: Row) => m.id)).toEqual(["m2"]);
    db.settings[0].retentionDays = null;
    const out2 = await svc(db).applyRetention(ORG);
    expect(out2).toMatchObject({ deleted: 0, skipped: "no_policy" });
  });

  it("media search returns only the org's stored/linked media", async () => {
    const db = fakeDb();
    db.conversations.push(
      { id: "c1", organizationId: ORG, channel: "whatsapp", contactName: "Rahim", createdAt: new Date() },
      { id: "cX", organizationId: "other-org", channel: "whatsapp", contactName: "Other", createdAt: new Date() },
    );
    db.messages.push(
      { id: "m1", conversationId: "c1", direction: "in", type: "image", mediaStorageKey: "k1", mediaContentType: "image/jpeg", mediaSizeBytes: 2048, createdAt: new Date() },
      { id: "m2", conversationId: "cX", direction: "in", type: "image", mediaUrl: "https://x/y.jpg", createdAt: new Date() },
      { id: "m3", conversationId: "c1", direction: "in", type: "text", content: "hi", createdAt: new Date() },
    );
    const items = await svc(db).searchMedia(ORG, {});
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "m1", stored: true, contactName: "Rahim" });
  });
});
