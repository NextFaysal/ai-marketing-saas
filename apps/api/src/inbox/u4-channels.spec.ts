process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=";

import { TelegramAdapter, TelegramClient, TelegramService } from "./channels/telegram.service";
import { EmailChannelService } from "./channels/email.service";
import { ChannelSendService } from "./channels/channel-send.service";
import { TikTokPartnerGatedAdapter, TIKTOK_APPLICATION_PACK } from "./channels/channel-adapter";
import { decryptJson } from "../integrations/crypto";

/**
 * Unified Inbox U4 (Milestone 46): Telegram bot channel (verify
 * before save, secret-checked webhook, deduped ingest, confirmed
 * sends), the email lane (dual verification, IMAP sync), and the
 * honestly-refusing TikTok partner-gated adapter.
 */
const ORG = "org-1";
type Row = Record<string, any>;
function table(store: Row[]) {
  return {
    findUnique: jest.fn(async ({ where }: any) => store.find((r) => r.id === where.id) ?? null),
    findFirst: jest.fn(async () => store[0] ?? null),
    create: jest.fn(async ({ data }: any) => { const row = { id: `int-${store.length + 1}`, createdAt: new Date(), ...data }; store.push(row); return row; }),
    update: jest.fn(async ({ where, data }: any) => { const row = store.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row ?? {}; }),
  };
}
function fakePrisma() {
  const integrations: Row[] = [];
  const credentials: Row[] = [];
  return {
    integrations, credentials,
    integration: {
      ...table(integrations),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `int-${integrations.length + 1}`, createdAt: new Date(), ...data };
        integrations.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const row = integrations.find((r) => r.id === where.id) ?? null;
        if (row && (row as any)._cred !== false) return { ...row, credential: credentials.find((c) => c.integrationId === row.id) ?? null };
        return row;
      }),
      findFirst: jest.fn(async () => {
        const row = integrations[0] ?? null;
        return row ? { ...row, credential: credentials.find((c) => c.integrationId === row.id) ?? null } : null;
      }),
    },
    integrationCredential: {
      create: jest.fn(async ({ data }: any) => { const row = { id: `cred-${credentials.length + 1}`, ...data }; credentials.push(row); return row; }),
    },
    channelMessage: { findFirst: jest.fn(async () => null) },
  };
}
const auditStub = () => ({ calls: [] as any[], log: jest.fn(async (e: any) => { (auditStub as any).x = e; }) });

function stubFetch(handler: (url: string, init?: any) => any) {
  const original = global.fetch;
  (global as any).fetch = jest.fn(async (url: string, init?: any) => handler(url, init));
  return () => { (global as any).fetch = original; };
}

describe("U4 Telegram", () => {
  it("adapter verifies a bot token via getMe; Telegram's own error surfaces", async () => {
    const restore = stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { id: 42, username: "qosprey_bot" } }) }));
    const account = await new TelegramAdapter().verifyCredentials({ botToken: "123:abc" });
    expect(account).toEqual({ externalAccountId: "42", displayName: "@qosprey_bot" });
    restore();
    const restore2 = stubFetch(async () => ({ ok: false, status: 401, json: async () => ({ ok: false, description: "Unauthorized" }) }));
    await expect(new TelegramAdapter().verifyCredentials({ botToken: "bad" })).rejects.toThrow(/Telegram: Unauthorized/);
    restore2();
    void TelegramClient;
  });

  it("connect verifies first, stores encrypted credentials, and reports webhook reality", async () => {
    const restore = stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { id: 7, username: "shop_bot" } }) }));
    const prisma = fakePrisma();
    const inbox = { ingestExternalMessage: jest.fn(async () => "stored") } as any;
    const svc = new TelegramService(prisma as any, auditStub() as any, inbox);
    const out = await svc.connect(ORG, "owner", { botToken: "999:secret-token" });
    expect(out.bot).toBe("@shop_bot");
    expect(out.webhook.registered).toBe(false); // no public https base in tests — reported, not hidden
    expect(prisma.integrations).toHaveLength(1);
    const saved = decryptJson<any>(prisma.credentials[0].encryptedData);
    expect(saved.botToken).toBe("999:secret-token");
    expect(saved.webhookSecret).toBeTruthy();
    restore();
  });

  it("webhook rejects a wrong secret and ingests a text message once", async () => {
    const prisma = fakePrisma();
    prisma.integrations.push({ id: "int-1", organizationId: ORG, provider: "telegram", status: "CONNECTED" });
    const { encryptJson } = await import("../integrations/crypto");
    prisma.credentials.push({ id: "cred-1", integrationId: "int-1", encryptedData: encryptJson({ botToken: "t", webhookSecret: "s3cret" }) });
    const inbox = { ingestExternalMessage: jest.fn(async () => "stored") } as any;
    const svc = new TelegramService(prisma as any, auditStub() as any, inbox);
    const update = { message: { message_id: 55, chat: { id: 1234 }, from: { first_name: "Rahim" }, text: "দাম কত?", date: 1760000000 } };
    await expect(svc.handleWebhook("int-1", "wrong", update)).rejects.toThrow(/secret/);
    const ok = await svc.handleWebhook("int-1", "s3cret", update);
    expect(ok).toEqual({ received: 1, duplicates: 0 });
    expect(inbox.ingestExternalMessage).toHaveBeenCalledWith(expect.objectContaining({
      channel: "telegram", externalContactId: "1234", externalId: "55", content: "দাম কত?",
    }));
    const ignored = await svc.handleWebhook("int-1", "s3cret", { message: { chat: { id: 1 }, photo: [] } });
    expect(ignored).toEqual({ ignored: true });
  });

  it("send dispatch returns Telegram's message_id", async () => {
    const restore = stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 777 } }) }));
    const prisma = fakePrisma();
    prisma.integrations.push({ id: "int-1", organizationId: ORG, provider: "telegram", status: "CONNECTED" });
    const { encryptJson } = await import("../integrations/crypto");
    prisma.credentials.push({ id: "cred-1", integrationId: "int-1", encryptedData: encryptJson({ botToken: "t", webhookSecret: "s" }) });
    const sender = new ChannelSendService(prisma as any);
    const id = await sender.sendText({ id: "c1", channel: "telegram", organizationId: ORG, integrationId: "int-1", externalContactId: "1234" }, "হ্যালো");
    expect(id).toBe("777");
    restore();
  });
});

describe("U4 Email lane", () => {
  const creds = { imapHost: "imap.example.com", imapPort: 993, smtpHost: "smtp.example.com", smtpPort: 587, user: "shop@example.com", password: "pw" };

  it("connect refuses when SMTP verification fails and saves nothing", async () => {
    const prisma = fakePrisma();
    const svc = new EmailChannelService(prisma as any, auditStub() as any, {} as any);
    (svc as any).buildImapClient = () => ({ connect: jest.fn(async () => undefined), logout: jest.fn(async () => undefined) });
    (svc as any).buildTransport = () => ({ verify: jest.fn(async () => { throw new Error("Invalid login"); }) });
    await expect(svc.connect(ORG, "owner", creds)).rejects.toMatchObject({ code: "inbox.smtpVerificationFailed" });
    expect(prisma.integrations).toHaveLength(0);
  });

  it("sync pulls unread mail into the inbox with subject + dedupe flags", async () => {
    const prisma = fakePrisma();
    prisma.integrations.push({ id: "int-1", organizationId: ORG, provider: "email", status: "CONNECTED" });
    const { encryptJson } = await import("../integrations/crypto");
    prisma.credentials.push({ id: "cred-1", integrationId: "int-1", encryptedData: encryptJson(creds) });
    const raw = Buffer.from(
      "From: Karim <karim@mail.com>\r\nSubject: অর্ডার সম্পর্কে\r\nMessage-ID: <m1@mail.com>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nআমার অর্ডারটি কোথায়?\r\n",
    );
    const flags: string[] = [];
    const svc = new EmailChannelService(prisma as any, auditStub() as any, {
      ingestExternalMessage: jest.fn(async () => "stored"),
    } as any);
    (svc as any).buildImapClient = () => ({
      connect: jest.fn(async () => undefined),
      getMailboxLock: jest.fn(async () => ({ release: jest.fn() })),
      search: jest.fn(async () => [11]),
      fetchOne: jest.fn(async () => ({ source: raw, uid: 11 })),
      messageFlagsAdd: jest.fn(async (uid: string) => { flags.push(uid); return true; }),
      logout: jest.fn(async () => undefined),
    });
    const out = await svc.syncOrganization(ORG);
    expect(out).toEqual({ fetched: 1, stored: 1, duplicates: 0 });
    expect(flags).toEqual(["11"]);
    const call = ((svc as any).inbox.ingestExternalMessage as jest.Mock).mock.calls[0][0];
    expect(call).toMatchObject({ channel: "email", externalContactId: "karim@mail.com", subject: "অর্ডার সম্পর্কে", externalId: "<m1@mail.com>" });
    expect(call.content).toContain("অর্ডারটি কোথায়");
  });
});

describe("U4 TikTok partner gate", () => {
  it("the development adapter refuses honestly and the pack explains the path", async () => {
    const adapter = new TikTokPartnerGatedAdapter();
    await expect(adapter.verifyCredentials({})).rejects.toThrow(/partner-gated/);
    await expect(adapter.sendText({}, "1", "hi")).rejects.toThrow(/No message was sent/);
    expect(TIKTOK_APPLICATION_PACK.available).toBe(false);
    expect(TIKTOK_APPLICATION_PACK.steps.length).toBeGreaterThanOrEqual(4);
  });
});
