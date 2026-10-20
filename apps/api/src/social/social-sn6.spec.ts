process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { BadRequestException } from "@nestjs/common";
import { SocialService } from "./social.service";
import { SocialOAuthService } from "./social-oauth.service";
import { SocialPublishService, PermanentPublishError } from "./social-publish.service";
import { SocialHealthService } from "./social-health.service";
import { SocialInsightsService } from "./social-insights.service";
import { TelegramClient } from "./telegram.client";
import { validateForPlatform } from "./social-preflight";
import { decryptJson, encryptJson } from "../integrations/crypto";

/**
 * SN6 — Telegram channel publishing, proven at stubbed
 * boundaries (no live call anywhere):
 * - Connect verify matrix: bad bot token / channel not found /
 *   not-a-channel / bot not admin / admin without post rights →
 *   Bengali 400 carrying Telegram's verbatim message, and NOTHING
 *   is stored (no account, no integration, no credential).
 * - Connect happy path: account persisted through the shared
 *   path (platform "telegram", externalId = numeric chat id),
 *   the bot token sealed as { accessToken, expiresAt: 0 }, and
 *   the token absent from the response AND the audit rows.
 * - Publish: text (incl. >4096 chunking), photo, video, media
 *   group (caption on first item), over-long caption spilling
 *   into a follow-up message, chatId:messageId id mapping,
 *   t.me URL only for public channels, 11-media pre-flight
 *   refusal BEFORE any Telegram call, client errors verbatim.
 * - Insights: honestly unavailable (never a fabricated 0).
 * - Health: getMe identity probe, ok and verbatim-failure.
 * - Client request shapes + the transport-failure rule (the
 *   token-bearing URL never rides an error message).
 */

const ORG = "org-1";
const ACTOR = "owner-1";
const BOT_TOKEN = "123456:AAE-bot-token-secret";
const CHAT_ID = -1001234567890;
type Row = Record<string, any>;

const SAVED_ENV = { ...process.env };
afterAll(() => { process.env = { ...SAVED_ENV }; });

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v === null) return row[k] === null || row[k] === undefined;
    if (typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("gt" in v) return row[k] != null && new Date(row[k]).getTime() > new Date((v as any).gt).getTime();
      return true;
    }
    return row[k] === v;
  });
}

function table(store: Row[], prefix: string) {
  let seq = 0;
  return {
    findMany: jest.fn(async (args: any = {}) => store.filter((r) => matches(r, args.where)).map((r) => ({ ...r }))),
    findFirst: jest.fn(async (args: any = {}) => {
      const row = store.find((r) => matches(r, args.where));
      return row ? { ...row } : null;
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: data.id ?? `${prefix}-${++seq}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      store.push(row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((r) => matches(r, where));
      if (row) Object.assign(row, data);
      return row ? { ...row } : null;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const row of store) if (matches(row, where)) { Object.assign(row, data); count++; }
      return { count };
    }),
    deleteMany: jest.fn(async ({ where }: any = {}) => {
      const before = store.length;
      for (let i = store.length - 1; i >= 0; i--) if (matches(store[i], where)) store.splice(i, 1);
      return { count: before - store.length };
    }),
    upsert: jest.fn(async ({ where, update, create }: any) => {
      const key = where.organizationId_platform_externalId;
      const existing = key
        ? store.find((r) => r.organizationId === key.organizationId && r.platform === key.platform && r.externalId === key.externalId)
        : store.find((r) => matches(r, where));
      if (existing) {
        Object.assign(existing, Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined)));
        return { ...existing };
      }
      const row = { id: `${prefix}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      store.push(row);
      return { ...row };
    }),
  };
}

function fakeDb() {
  const db: any = {
    organizations: [{ id: ORG, timezone: "Asia/Dhaka", socialRequireApproval: false }],
    socialAccounts: [] as Row[], socialPosts: [] as Row[], mediaAssets: [] as Row[],
    integrations: [] as Row[], credentials: [] as Row[], auditRows: [] as Row[],
  };
  db.organization = table(db.organizations, "org");
  db.socialAccount = table(db.socialAccounts, "acct");
  db.socialPost = table(db.socialPosts, "post");
  db.mediaAsset = table(db.mediaAssets, "asset");
  db.integrationCredential = table(db.credentials, "cred");
  db.integration = {
    ...table(db.integrations, "int"),
    findFirst: jest.fn(async (args: any = {}) => {
      const row = db.integrations.find((r: Row) => matches(r, args.where));
      if (!row) return null;
      const out: Row = { ...row };
      if (args.include?.credential) {
        const cred = db.credentials.find((c: Row) => c.integrationId === row.id);
        out.credential = cred ? { ...cred } : null;
      }
      return out;
    }),
  };
  return db;
}

function auditOf(db: any) {
  return { log: jest.fn(async (input: any) => { db.auditRows.push(input); }) };
}

/** A stub TelegramClient whose methods are jest fns. */
function telegramStub(over: Partial<Record<string, any>> = {}): any {
  return {
    getMe: jest.fn(async () => ({ id: 42, username: "my_bot", firstName: "My Bot" })),
    getChat: jest.fn(async () => ({ id: CHAT_ID, type: "channel", title: "My Channel", username: "mychan" })),
    getChatMember: jest.fn(async () => ({ status: "administrator", canPostMessages: true })),
    sendMessage: jest.fn(async () => ({ messageId: 555, chatId: CHAT_ID, chatUsername: "mychan" })),
    sendPhoto: jest.fn(async () => ({ messageId: 556, chatId: CHAT_ID, chatUsername: "mychan" })),
    sendVideo: jest.fn(async () => ({ messageId: 557, chatId: CHAT_ID, chatUsername: "mychan" })),
    sendMediaGroup: jest.fn(async () => [
      { messageId: 560, chatId: CHAT_ID, chatUsername: "mychan" },
      { messageId: 561, chatId: CHAT_ID, chatUsername: "mychan" },
    ]),
    ...over,
  };
}

function oauthService(db: any, telegram: any) {
  return new SocialOAuthService(db as any, auditOf(db) as any, undefined, undefined, undefined, telegram as any);
}

function publishService(db: any, telegram: any) {
  const audit = auditOf(db);
  return new SocialPublishService(
    db as any, audit as any, new SocialService(db as any, audit as any),
    undefined,
    { ensureAccessToken: jest.fn(async () => "unused-oauth-token") } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    telegram as any,
  );
}

function seedTelegramAccount(db: any) {
  db.integrations.push({ id: "int-tg", organizationId: ORG, provider: "telegram_social", status: "CONNECTED", externalAccountId: String(CHAT_ID) });
  db.credentials.push({
    id: "cred-tg", integrationId: "int-tg",
    encryptedData: encryptJson({ accessToken: BOT_TOKEN, expiresAt: 0, botUsername: "my_bot" }),
  });
  db.socialAccounts.push({
    id: "acct-tg", organizationId: ORG, integrationId: "int-tg", platform: "telegram",
    externalId: String(CHAT_ID), name: "My Channel", username: "mychan", status: "connected",
  });
}

function seedAsset(db: any, id: string, kind: string, token: string) {
  db.mediaAssets.push({
    id, organizationId: ORG, kind, name: `${id}.bin`,
    contentType: kind === "video" ? "video/mp4" : "image/jpeg",
    sizeBytes: 100, storageKey: `${ORG}/social/${id}`, publicToken: token, createdById: ACTOR,
  });
}

function seedPost(db: any, over: Row = {}) {
  const post = {
    id: "post-tg", organizationId: ORG, socialAccountId: "acct-tg", createdById: ACTOR,
    caption: "আজকের অফার!", linkUrl: null, mediaRefs: [], status: "draft", isStory: false,
    platformPostId: null, insights: null, publishedAt: null, ...over,
  };
  db.socialPosts.push(post);
  return post;
}

describe("SN6 connect — verify-before-save matrix", () => {
  it("bad bot token → 400 with Telegram's verbatim message, NOTHING stored", async () => {
    const db = fakeDb();
    const tg = telegramStub({ getMe: jest.fn(async () => { throw new Error("Unauthorized"); }) });
    const err = await oauthService(db, tg).connectTelegramChannel(ORG, ACTOR, { botToken: "bad", channel: "@mychan" }).catch((e) => e);
    expect(err).toMatchObject({ code: "social.botVerificationFailedCheckWhetherThe" });
    expect(err.message).toContain("Unauthorized");
    expect(db.socialAccounts).toHaveLength(0);
    expect(db.integrations).toHaveLength(0);
    expect(db.credentials).toHaveLength(0);
    expect(tg.getChat).not.toHaveBeenCalled();
  });

  it("channel not found → 400 verbatim, nothing stored, member check never runs", async () => {
    const db = fakeDb();
    const tg = telegramStub({ getChat: jest.fn(async () => { throw new Error("chat not found"); }) });
    const err = await oauthService(db, tg).connectTelegramChannel(ORG, ACTOR, { botToken: BOT_TOKEN, channel: "@nope" }).catch((e) => e);
    expect(err).toMatchObject({ code: "social.channelNotFoundCheckWhetherThe" });
    expect(err.message).toContain("chat not found");
    expect(db.socialAccounts).toHaveLength(0);
    expect(tg.getChatMember).not.toHaveBeenCalled();
  });

  it("target is a supergroup, not a channel → honest refusal, nothing stored", async () => {
    const db = fakeDb();
    const tg = telegramStub({ getChat: jest.fn(async () => ({ id: -100999, type: "supergroup", title: "Group", username: "grp" })) });
    const err = await oauthService(db, tg).connectTelegramChannel(ORG, ACTOR, { botToken: BOT_TOKEN, channel: "@grp" }).catch((e) => e);
    expect(err).toMatchObject({ code: "social.thisIsNotAChannelType" });
    expect(err.message).toContain("Channel নয়");
    expect(db.socialAccounts).toHaveLength(0);
    expect(tg.getChatMember).not.toHaveBeenCalled();
  });

  it("bot is a plain member, not admin → refusal naming the status, nothing stored", async () => {
    const db = fakeDb();
    const tg = telegramStub({ getChatMember: jest.fn(async () => ({ status: "member", canPostMessages: null })) });
    const err = await oauthService(db, tg).connectTelegramChannel(ORG, ACTOR, { botToken: BOT_TOKEN, channel: "@mychan" }).catch((e) => e);
    expect(err).toMatchObject({ code: "social.theBotIsNotAnAdmin" });
    expect(err.message).toContain("Admin নয়");
    expect(err.message).toContain("member");
    expect(db.socialAccounts).toHaveLength(0);
    expect(db.integrations).toHaveLength(0);
  });

  it("bot is admin but can_post_messages is false → refusal, nothing stored", async () => {
    const db = fakeDb();
    const tg = telegramStub({ getChatMember: jest.fn(async () => ({ status: "administrator", canPostMessages: false })) });
    const err = await oauthService(db, tg).connectTelegramChannel(ORG, ACTOR, { botToken: BOT_TOKEN, channel: "@mychan" }).catch((e) => e);
    expect(err).toMatchObject({ code: "social.theBotIsAnAdminBut" });
    expect(err.message).toContain("Post Messages");
    expect(db.socialAccounts).toHaveLength(0);
  });

  it("missing token / missing channel → Bengali 400 before any Telegram call", async () => {
    const db = fakeDb();
    const tg = telegramStub();
    const svc = oauthService(db, tg);
    const e1 = await svc.connectTelegramChannel(ORG, ACTOR, { botToken: "", channel: "@mychan" }).catch((e) => e);
    const e2 = await svc.connectTelegramChannel(ORG, ACTOR, { botToken: BOT_TOKEN, channel: " " }).catch((e) => e);
    expect(e1).toMatchObject({ code: "social.aBotTokenIsRequiredCreate" });
    expect(e2).toMatchObject({ code: "social.aChannelUsernameEGMychannel" });
    expect(tg.getMe).not.toHaveBeenCalled();
  });

  it("happy path → account saved via the shared path, token sealed, token NOWHERE in response/audit", async () => {
    const db = fakeDb();
    const tg = telegramStub();
    const out = await oauthService(db, tg).connectTelegramChannel(ORG, ACTOR, { botToken: BOT_TOKEN, channel: "@mychan" });
    expect(out.platform).toBe("telegram");
    expect(out.externalId).toBe(String(CHAT_ID));
    expect(out.name).toBe("My Channel");
    expect(out.username).toBe("mychan");
    expect(out.status).toBe("connected");
    // Sealed credential discipline: decrypts to the bot token
    // with the non-expiring marker; the raw token never appears
    // in the stored row's plain fields, the response, or audit.
    expect(db.credentials).toHaveLength(1);
    const cred = decryptJson<any>(db.credentials[0].encryptedData);
    expect(cred.accessToken).toBe(BOT_TOKEN);
    expect(cred.expiresAt).toBe(0);
    expect(JSON.stringify(out)).not.toContain(BOT_TOKEN);
    expect(JSON.stringify(db.auditRows)).not.toContain(BOT_TOKEN);
    expect(JSON.stringify(db.socialAccounts)).not.toContain(BOT_TOKEN);
    expect(db.integrations[0].provider).toBe("telegram_social");
    // getChatMember was asked about THIS bot in THIS chat.
    expect(tg.getChatMember).toHaveBeenCalledWith(BOT_TOKEN, String(CHAT_ID), 42);
  });
});

describe("SN6 publish — dispatch shapes", () => {
  it("text-only → sendMessage; id is chatId:messageId; public channel gets the t.me URL", async () => {
    const db = fakeDb();
    seedTelegramAccount(db);
    const tg = telegramStub();
    const post = seedPost(db);
    const out = await publishService(db, tg).publishToPlatform(post);
    expect(tg.sendMessage).toHaveBeenCalledWith(BOT_TOKEN, String(CHAT_ID), "আজকের অফার!");
    expect(out.platformPostId).toBe(`${CHAT_ID}:555`);
    expect(out.platformUrl).toBe("https://t.me/mychan/555");
    expect(out.outcome).toBe("published");
  });

  it("private channel (no username on the sent message) → platformUrl null, never fabricated", async () => {
    const db = fakeDb();
    seedTelegramAccount(db);
    const tg = telegramStub({ sendMessage: jest.fn(async () => ({ messageId: 9, chatId: CHAT_ID, chatUsername: null })) });
    const out = await publishService(db, tg).publishToPlatform(seedPost(db));
    expect(out.platformPostId).toBe(`${CHAT_ID}:9`);
    expect(out.platformUrl).toBeNull();
  });

  it("one image → sendPhoto with the SP1 public URL + caption", async () => {
    const db = fakeDb();
    seedTelegramAccount(db);
    seedAsset(db, "asset-img", "image", "tok-img");
    const tg = telegramStub();
    const post = seedPost(db, { mediaRefs: [{ assetId: "asset-img", kind: "image" }] });
    const out = await publishService(db, tg).publishToPlatform(post);
    const call = tg.sendPhoto.mock.calls[0];
    expect(call[0]).toBe(BOT_TOKEN);
    expect(call[1]).toBe(String(CHAT_ID));
    expect(call[2]).toContain("/public/media/tok-img");
    expect(call[3]).toBe("আজকের অফার!");
    expect(out.platformPostId).toBe(`${CHAT_ID}:556`);
  });

  it("one video → sendVideo", async () => {
    const db = fakeDb();
    seedTelegramAccount(db);
    seedAsset(db, "asset-vid", "video", "tok-vid");
    const tg = telegramStub();
    const post = seedPost(db, { mediaRefs: [{ assetId: "asset-vid", kind: "video" }] });
    const out = await publishService(db, tg).publishToPlatform(post);
    expect(tg.sendVideo).toHaveBeenCalled();
    expect(tg.sendPhoto).not.toHaveBeenCalled();
    expect(out.platformPostId).toBe(`${CHAT_ID}:557`);
  });

  it("two media → sendMediaGroup, caption rides the FIRST item only, id from the first message", async () => {
    const db = fakeDb();
    seedTelegramAccount(db);
    seedAsset(db, "a1", "image", "tok-1");
    seedAsset(db, "a2", "video", "tok-2");
    const tg = telegramStub();
    const post = seedPost(db, { mediaRefs: [{ assetId: "a1", kind: "image" }, { assetId: "a2", kind: "video" }] });
    const out = await publishService(db, tg).publishToPlatform(post);
    const media = tg.sendMediaGroup.mock.calls[0][2];
    expect(media).toHaveLength(2);
    expect(media[0].caption).toBe("আজকের অফার!");
    expect(media[1].caption).toBeUndefined();
    expect(media[0].type).toBe("photo");
    expect(media[1].type).toBe("video");
    expect(out.platformPostId).toBe(`${CHAT_ID}:560`);
  });

  it("caption over the 1024 media ceiling → media goes WITHOUT it, full caption follows as a message (nothing truncated)", async () => {
    const db = fakeDb();
    seedTelegramAccount(db);
    seedAsset(db, "asset-img", "image", "tok-img");
    const tg = telegramStub();
    const longCaption = "ক".repeat(1500);
    const post = seedPost(db, { caption: longCaption, mediaRefs: [{ assetId: "asset-img", kind: "image" }] });
    await publishService(db, tg).publishToPlatform(post);
    expect(tg.sendPhoto.mock.calls[0][3]).toBeUndefined();
    expect(tg.sendMessage).toHaveBeenCalledWith(BOT_TOKEN, String(CHAT_ID), longCaption);
  });

  it("text over the 4096 ceiling → chunked sendMessage calls, result from the FIRST message", async () => {
    const db = fakeDb();
    seedTelegramAccount(db);
    const tg = telegramStub();
    const post = seedPost(db, { caption: "a".repeat(5000) });
    const out = await publishService(db, tg).publishToPlatform(post);
    expect(tg.sendMessage.mock.calls.length).toBe(2);
    expect(tg.sendMessage.mock.calls[0][2].length).toBe(4096);
    expect(out.platformPostId).toBe(`${CHAT_ID}:555`);
  });

  it("11 media → pre-flight PermanentPublishError BEFORE any Telegram call", async () => {
    const db = fakeDb();
    seedTelegramAccount(db);
    const tg = telegramStub();
    const refs = Array.from({ length: 11 }, (_, i) => ({ assetId: `a${i}`, kind: "image" }));
    const post = seedPost(db, { mediaRefs: refs });
    const err = await publishService(db, tg).publishToPlatform(post).catch((e) => e);
    expect(err).toBeInstanceOf(PermanentPublishError);
    expect(err.message).toContain("সর্বোচ্চ ১০টি");
    expect(tg.sendMediaGroup).not.toHaveBeenCalled();
    expect(tg.sendMessage).not.toHaveBeenCalled();
  });

  it("Telegram's own error propagates verbatim", async () => {
    const db = fakeDb();
    seedTelegramAccount(db);
    const tg = telegramStub({ sendMessage: jest.fn(async () => { throw new Error("chat not found"); }) });
    const err = await publishService(db, tg).publishToPlatform(seedPost(db)).catch((e) => e);
    expect(err.message).toBe("chat not found");
  });

  it("preflight unit: telegram accepts 10 media, refuses 11, accepts text-only", () => {
    const refs = (n: number) => Array.from({ length: n }, (_, i) => ({ assetId: `a${i}`, kind: "image" }));
    expect(validateForPlatform({ caption: "x", mediaRefs: refs(10) }, "telegram")).toBeNull();
    expect(validateForPlatform({ caption: "x", mediaRefs: refs(11) }, "telegram")).toContain("১০টি");
    expect(validateForPlatform({ caption: "x", mediaRefs: [] }, "telegram")).toBeNull();
  });
});

describe("SN6 insights + health", () => {
  it("insights refresh for a telegram post → honest unavailable error, nothing stored", async () => {
    const db = fakeDb();
    seedTelegramAccount(db);
    const post = seedPost(db, { status: "published", platformPostId: `${CHAT_ID}:555`, publishedAt: new Date() });
    const audit = auditOf(db);
    const publish = publishService(db, telegramStub());
    const insights = new SocialInsightsService(db as any, audit as any, new SocialService(db as any, audit as any), publish);
    const err = await insights.refreshPostInsights(ORG, ACTOR, post.id).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("Insights পাওয়া যায় না");
    expect(db.socialPosts[0].insights).toBeNull();
  });

  it("health: getMe ok → ok:true and the check is stamped", async () => {
    const db = fakeDb();
    seedTelegramAccount(db);
    const tg = telegramStub();
    const publish = publishService(db, tg);
    const health = new SocialHealthService(db as any, auditOf(db) as any, publish, { ensureAccessToken: jest.fn() } as any, undefined, tg as any);
    const out = await health.checkAccountHealth(ORG, ACTOR, "acct-tg");
    expect(out.ok).toBe(true);
    expect(tg.getMe).toHaveBeenCalledWith(BOT_TOKEN);
    expect(db.socialAccounts[0].healthCheckedAt).toBeInstanceOf(Date);
  });

  it("health: Telegram rejects the token → ok:false with the verbatim message", async () => {
    const db = fakeDb();
    seedTelegramAccount(db);
    const tg = telegramStub({ getMe: jest.fn(async () => { throw new Error("Unauthorized"); }) });
    const publish = publishService(db, tg);
    const health = new SocialHealthService(db as any, auditOf(db) as any, publish, { ensureAccessToken: jest.fn() } as any, undefined, tg as any);
    const out = await health.checkAccountHealth(ORG, ACTOR, "acct-tg");
    expect(out.ok).toBe(false);
    expect(out.error).toContain("Unauthorized");
  });
});

describe("SN6 TelegramClient — request shapes at a stub fetch", () => {
  function fetchReturning(result: any, ok = true, description?: string) {
    const calls: { url: string; body: any }[] = [];
    const fetchFn = async (url: string, init?: any) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return {
        ok, status: ok ? 200 : 401,
        json: async () => (ok ? { ok: true, result } : { ok: false, error_code: 401, description }),
      };
    };
    return { calls, fetchFn };
  }

  it("getMe posts to the bot URL and maps the identity", async () => {
    const { calls, fetchFn } = fetchReturning({ id: 42, username: "my_bot", first_name: "My Bot" });
    const client = new TelegramClient(fetchFn as any);
    const me = await client.getMe(BOT_TOKEN);
    expect(calls[0].url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    expect(me).toEqual({ id: 42, username: "my_bot", firstName: "My Bot" });
  });

  it("ok:false → Telegram's description verbatim", async () => {
    const { fetchFn } = fetchReturning(null, false, "Unauthorized");
    const client = new TelegramClient(fetchFn as any);
    await expect(client.getMe("bad-token")).rejects.toThrow("Unauthorized");
  });

  it("sendMediaGroup body: InputMedia array, caption only where given", async () => {
    const { calls, fetchFn } = fetchReturning([{ message_id: 1, chat: { id: CHAT_ID, username: "mychan" } }]);
    const client = new TelegramClient(fetchFn as any);
    const sent = await client.sendMediaGroup(BOT_TOKEN, String(CHAT_ID), [
      { type: "photo", url: "https://x/1.jpg", caption: "cap" },
      { type: "video", url: "https://x/2.mp4" },
    ]);
    expect(calls[0].url).toContain("/sendMediaGroup");
    expect(calls[0].body.media).toEqual([
      { type: "photo", media: "https://x/1.jpg", caption: "cap" },
      { type: "video", media: "https://x/2.mp4" },
    ]);
    expect(sent[0]).toEqual({ messageId: 1, chatId: CHAT_ID, chatUsername: "mychan" });
  });

  it("a transport failure never leaks the token-bearing URL into the error", async () => {
    const fetchFn = async (url: string) => { throw new Error(`fetch failed for ${url}`); };
    const client = new TelegramClient(fetchFn as any);
    const err = await client.getMe(BOT_TOKEN).catch((e) => e);
    expect(err.message).not.toContain(BOT_TOKEN);
    expect(err.message).not.toContain("api.telegram.org");
  });
});
