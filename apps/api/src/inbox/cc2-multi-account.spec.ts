process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "test-secret";
process.env.WEB_URL = "https://app.example.com";
process.env.API_PUBLIC_URL = "https://api.example.com";

import { InboxService } from "./inbox.service";
import { decryptJson } from "../integrations/crypto";

/**
 * CC2 — Connect Center multi-account hardening for messaging
 * channels: InboxService.connectMessaging is keyed by
 * (organizationId, provider, externalAccountId). A second WhatsApp
 * number coexists with the first; reconnecting the SAME number
 * refreshes its row + credential instead of duplicating it.
 * Fake Prisma + stubbed Meta verify (fetch), codebase style.
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
    findFirst: async ({ where, orderBy }: any = {}) => {
      const out = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return out[0] ?? null;
    },
    findMany: async ({ where, orderBy }: any = {}) => {
      const out = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return out;
    },
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (row) Object.assign(row, data);
      return row;
    },
  };
}

function buildInbox() {
  const tables: any = {
    integration: makeTable("int"),
    integrationCredential: makeTable("cred"),
  };
  // Credential rows live in their own table; reads with
  // include:{credential:true} resolve them (Prisma shape), and
  // credential updates key by integrationId (Prisma unique).
  const baseInt = tables.integration;
  const attach = (row: any, args: any) => {
    if (!row) return row;
    if (args?.include?.credential) {
      const cred = tables.integrationCredential.rows.find((c: any) => c.integrationId === row.id) ?? null;
      return { ...row, credential: cred };
    }
    return row;
  };
  tables.integration = {
    ...baseInt,
    findFirst: async (args: any) => attach(await baseInt.findFirst(args), args),
    findMany: async (args: any) => { const rows = await baseInt.findMany(args); return args?.include?.credential ? rows.map((r: any) => attach(r, args)) : rows; },
    findUnique: async (args: any) => attach(await baseInt.findUnique(args), args),
  };
  tables.integrationCredential = {
    ...tables.integrationCredential,
    findUnique: async ({ where }: any) => tables.integrationCredential.rows.find((c: any) => c.integrationId === where.integrationId) ?? null,
    update: async ({ where, data }: any) => {
      const row = tables.integrationCredential.rows.find((c: any) => c.integrationId === where.integrationId);
      if (row) Object.assign(row, data);
      return row;
    },
  };
  const auditLogs: any[] = [];
  const audit = { log: async (entry: any) => { auditLogs.push(entry); } } as any;
  const svc = new InboxService(tables as any, audit, {} as any);
  return { svc, tables, auditLogs };
}

const realFetch = global.fetch;
afterEach(() => { (global as any).fetch = realFetch; });
function stubMetaVerify() {
  (global as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: "meta-user-1", name: "Owner" }) });
}

const connectWa = (svc: InboxService, phoneNumberId: string, accessToken: string) =>
  svc.connectMessaging("org-1", "owner-1", {
    channel: "whatsapp", accessToken, appSecret: "app-secret", verifyToken: "vtok", phoneNumberId,
  });

describe("CC2 connectMessaging multi-account keying", () => {
  it("a second WhatsApp number coexists with the first (no replace, no delete)", async () => {
    stubMetaVerify();
    const { svc, tables } = buildInbox();
    const first = await connectWa(svc, "111", "token-one");
    const second = await connectWa(svc, "222", "token-two");

    expect(second.id).not.toBe(first.id);
    const rows = tables.integration.rows.filter((r: any) => r.provider === "whatsapp");
    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.externalAccountId).sort()).toEqual(["111", "222"]);
    expect(rows.every((r: any) => r.status === "CONNECTED")).toBe(true);

    // Each row keeps its OWN sealed credential.
    const credFor = (integrationId: string) => decryptJson<any>(tables.integrationCredential.rows.find((c: any) => c.integrationId === integrationId).encryptedData);
    expect(credFor(first.id).accessToken).toBe("token-one");
    expect(credFor(second.id).accessToken).toBe("token-two");

    // The Inbox list shows both numbers.
    const list = await svc.listMessagingIntegrations("org-1");
    expect(list.filter((i: any) => i.provider === "whatsapp")).toHaveLength(2);
  });

  it("reconnecting the SAME number refreshes its row + credential instead of duplicating", async () => {
    stubMetaVerify();
    const { svc, tables, auditLogs } = buildInbox();
    const first = await connectWa(svc, "111", "token-old");
    await connectWa(svc, "222", "token-two");
    // Simulate a dropped connection, then reconnect the same number with a fresh token.
    tables.integration.rows.find((r: any) => r.id === first.id).status = "DISCONNECTED";
    const reconnected = await connectWa(svc, "111", "token-fresh");

    expect(reconnected.id).toBe(first.id);
    expect(tables.integration.rows.filter((r: any) => r.provider === "whatsapp")).toHaveLength(2);
    const row = tables.integration.rows.find((r: any) => r.id === first.id);
    expect(row.status).toBe("CONNECTED");
    const cred = decryptJson<any>(tables.integrationCredential.rows.find((c: any) => c.integrationId === first.id).encryptedData);
    expect(cred.accessToken).toBe("token-fresh");
    expect(auditLogs[auditLogs.length - 1].metadata).toMatchObject({ channel: "whatsapp", reconnected: true });
  });

  it("different channels with the same external id stay separate rows", async () => {
    stubMetaVerify();
    const { svc, tables } = buildInbox();
    await svc.connectMessaging("org-1", "owner-1", {
      channel: "messenger", accessToken: "tok", appSecret: "s", verifyToken: "v", pageId: "page-7",
    });
    await svc.connectMessaging("org-1", "owner-1", {
      channel: "instagram", accessToken: "tok", appSecret: "s", verifyToken: "v", pageId: "page-7",
    });
    expect(tables.integration.rows).toHaveLength(2);
    expect(tables.integration.rows.map((r: any) => r.provider).sort()).toEqual(["instagram", "messenger"]);
  });
});
