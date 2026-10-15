process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "test-secret";

import { TelegramService } from "./channels/telegram.service";
import { EmailChannelService } from "./channels/email.service";
import { ConnectionsService } from "../connections/connections.service";
import { decryptJson } from "../integrations/crypto";

/**
 * CC7 (Connect Center B3) — Telegram / Email channel keying, the
 * CC2 discipline applied to the two connects B1 deferred:
 * keyed by (organizationId, provider, externalAccountId) where
 * the external id is a VERIFIED value — the bot's numeric id
 * from Telegram's getMe response for Telegram, and the mailbox
 * address that just passed BOTH a real IMAP login and a real
 * SMTP handshake for Email. Reconnecting the same bot/mailbox
 * refreshes its row + sealed credential in place; a second,
 * distinct bot/mailbox coexists; disconnecting one row through
 * the Connect Center leaves the other untouched.
 * Fake Prisma + stubbed provider calls, codebase style.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("not" in v) return row[k] !== v.not;
      return true;
    }
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {}))[0] ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    findUnique: async ({ where }: any) => rows.filter((r) => matches(r, where ?? {}))[0] ?? null,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (row) Object.assign(row, data);
      return row;
    },
    deleteMany: async ({ where }: any) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where ?? {})) { rows.splice(i, 1); count++; }
      return { count };
    },
  };
}

function buildWorld() {
  const tables: any = {
    integration: makeTable("int"),
    integrationCredential: makeTable("cred"),
  };
  const auditLogs: any[] = [];
  const audit = { log: async (entry: any) => { auditLogs.push(entry); } } as any;
  const inbox = { ingestExternalMessage: async () => "stored" } as any;
  const telegram = new TelegramService(tables as any, audit, inbox);
  const email = new EmailChannelService(tables as any, audit, inbox);
  const connections = new ConnectionsService(tables as any, audit);
  return { tables, auditLogs, telegram, email, connections };
}

const realFetch = global.fetch;
afterEach(() => { (global as any).fetch = realFetch; });

/** Telegram getMe stub: the bot id is derived from the token, so
 * two tokens = two distinct verified bots. */
function stubTelegram() {
  (global as any).fetch = async (url: string) => {
    const m = /bot([^/]+)\/getMe/.exec(String(url));
    const token = m?.[1] ?? "";
    const id = token.startsWith("111") ? 111 : token.startsWith("222") ? 222 : 999;
    return {
      ok: true, status: 200,
      json: async () => ({ ok: true, result: { id, username: `bot_${id}` } }),
    };
  };
}

function stubEmailVerify(svc: EmailChannelService) {
  (svc as any).buildImapClient = () => ({ connect: async () => undefined, logout: async () => undefined });
  (svc as any).buildTransport = () => ({ verify: async () => true });
}

const credOf = (tables: any, integrationId: string) =>
  decryptJson<any>(tables.integrationCredential.rows.find((c: any) => c.integrationId === integrationId).encryptedData);

describe("CC7 Telegram keying", () => {
  it("a second bot coexists; reconnecting the same bot refreshes its row + credential", async () => {
    stubTelegram();
    const { telegram, tables, auditLogs } = buildWorld();

    const first = await telegram.connect("org-1", "owner-1", { botToken: "111:token-a" });
    const second = await telegram.connect("org-1", "owner-1", { botToken: "222:token-b" });
    expect(second.integrationId).not.toBe(first.integrationId);
    expect(first.reconnected).toBe(false);
    expect(tables.integration.rows.filter((r: any) => r.provider === "telegram")).toHaveLength(2);

    // Simulate a dropped connection, then reconnect bot 111 with a fresh token.
    tables.integration.rows.find((r: any) => r.id === first.integrationId).status = "DISCONNECTED";
    const again = await telegram.connect("org-1", "owner-1", { botToken: "111:token-a-fresh" });
    expect(again.integrationId).toBe(first.integrationId);
    expect(again.reconnected).toBe(true);
    expect(tables.integration.rows.filter((r: any) => r.provider === "telegram")).toHaveLength(2);
    const row = tables.integration.rows.find((r: any) => r.id === first.integrationId);
    expect(row.status).toBe("CONNECTED");
    expect(credOf(tables, first.integrationId).botToken).toBe("111:token-a-fresh");
    expect(credOf(tables, second.integrationId).botToken).toBe("222:token-b");
    expect(auditLogs[auditLogs.length - 1].metadata).toMatchObject({ reconnected: true });
  });

  it("disconnecting one bot via the Connect Center leaves the other CONNECTED with its credential", async () => {
    stubTelegram();
    const { telegram, tables, connections } = buildWorld();
    const first = await telegram.connect("org-1", "owner-1", { botToken: "111:token-a" });
    const second = await telegram.connect("org-1", "owner-1", { botToken: "222:token-b" });

    await connections.disconnect("org-1", "owner-1", first.integrationId);
    const rows = Object.fromEntries(tables.integration.rows.map((r: any) => [r.id, r.status]));
    expect(rows[first.integrationId]).toBe("DISCONNECTED");
    expect(rows[second.integrationId]).toBe("CONNECTED");
    expect(tables.integrationCredential.rows.map((c: any) => c.integrationId)).toEqual([second.integrationId]);
  });
});

describe("CC7 Email keying", () => {
  const mailbox = (user: string, password = "pw") => ({
    imapHost: "imap.example.com", imapPort: 993, smtpHost: "smtp.example.com", smtpPort: 587, user, password,
  });

  it("a second mailbox coexists; reconnecting the same mailbox refreshes its credential", async () => {
    const { email, tables, auditLogs } = buildWorld();
    stubEmailVerify(email);

    const first = await email.connect("org-1", "owner-1", mailbox("shop@example.com", "pw-old"));
    const second = await email.connect("org-1", "owner-1", mailbox("support@example.com"));
    expect(second.integrationId).not.toBe(first.integrationId);
    expect(tables.integration.rows.filter((r: any) => r.provider === "email")).toHaveLength(2);

    tables.integration.rows.find((r: any) => r.id === first.integrationId).status = "DISCONNECTED";
    const again = await email.connect("org-1", "owner-1", mailbox("shop@example.com", "pw-new"));
    expect(again.integrationId).toBe(first.integrationId);
    expect(again.reconnected).toBe(true);
    expect(tables.integration.rows.filter((r: any) => r.provider === "email")).toHaveLength(2);
    expect(tables.integration.rows.find((r: any) => r.id === first.integrationId).status).toBe("CONNECTED");
    expect(credOf(tables, first.integrationId).password).toBe("pw-new");
    expect(credOf(tables, second.integrationId).user).toBe("support@example.com");
    expect(auditLogs[auditLogs.length - 1].metadata).toMatchObject({ mailbox: "shop@example.com", reconnected: true });
  });

  it("a failed verification still saves nothing (keying never bypasses verify-before-save)", async () => {
    const { email, tables } = buildWorld();
    (email as any).buildImapClient = () => ({ connect: async () => { throw new Error("Invalid login"); }, logout: async () => undefined });
    (email as any).buildTransport = () => ({ verify: async () => true });
    await expect(email.connect("org-1", "owner-1", mailbox("shop@example.com"))).rejects.toThrow(/IMAP login failed/);
    expect(tables.integration.rows).toHaveLength(0);
  });

  it("disconnecting one mailbox via the Connect Center leaves the other CONNECTED with its credential", async () => {
    const { email, tables, connections } = buildWorld();
    stubEmailVerify(email);
    const first = await email.connect("org-1", "owner-1", mailbox("shop@example.com"));
    const second = await email.connect("org-1", "owner-1", mailbox("support@example.com"));

    await connections.disconnect("org-1", "owner-1", second.integrationId);
    const rows = Object.fromEntries(tables.integration.rows.map((r: any) => [r.id, r.status]));
    expect(rows[first.integrationId]).toBe("CONNECTED");
    expect(rows[second.integrationId]).toBe("DISCONNECTED");
    expect(tables.integrationCredential.rows.map((c: any) => c.integrationId)).toEqual([first.integrationId]);
  });
});
