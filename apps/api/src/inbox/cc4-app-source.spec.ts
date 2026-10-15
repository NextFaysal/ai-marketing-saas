process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "test-secret";
process.env.WEB_URL = "https://app.example.com";
process.env.API_PUBLIC_URL = "https://api.example.com";

import { InboxService } from "./inbox.service";
import { decryptJson, encryptJson } from "../integrations/crypto";

/**
 * CC4 — Connect Center app-source for messaging connects:
 * - appSource "own" without a saved TenantAppConfig (CC3) is
 *   refused with a clear 400 and creates NO row — it never
 *   silently falls back to the platform app.
 * - With a config, the connect succeeds even with no per-call
 *   appSecret and no platform app: the TENANT app's secret is
 *   the one sealed into the credential (so webhook signature
 *   verification, which prefers the stored secret, verifies
 *   against the tenant's app).
 * - An explicit per-call appSecret still wins over the config.
 * - No appSource = the pre-CC4 behaviour, row marked "platform".
 * Fake Prisma + stubbed Meta token verify, codebase style (the
 * CC2 spec's harness).
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

function buildInbox(withOwnMetaConfig = false) {
  const tables: any = {
    integration: makeTable("int"),
    integrationCredential: makeTable("cred"),
    tenantAppConfig: makeTable("appcfg"),
  };
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
  if (withOwnMetaConfig) {
    tables.tenantAppConfig.rows.push({
      id: "cfg-1", organizationId: "org-1", platform: "meta", appId: "999888",
      encryptedSecret: encryptJson({ appSecret: "tenant-app-secret" }),
      status: "verified", lastVerifiedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    });
  }
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

describe("CC4 connectMessaging appSource", () => {
  it("own + no TenantAppConfig → clear 400, no row, no credential", async () => {
    stubMetaVerify();
    const { svc, tables } = buildInbox(false);
    await expect(svc.connectMessaging("org-1", "owner-1", {
      channel: "whatsapp", accessToken: "tok", verifyToken: "vtok", phoneNumberId: "111", appSource: "own",
    })).rejects.toThrow(/নিজের Meta অ্যাপ কনফিগার করা নেই/);
    expect(tables.integration.rows).toHaveLength(0);
    expect(tables.integrationCredential.rows).toHaveLength(0);
  });

  it("own + config → row carries appSource 'own' and the sealed secret IS the tenant app's", async () => {
    stubMetaVerify();
    const { svc, tables, auditLogs } = buildInbox(true);
    const out = await svc.connectMessaging("org-1", "owner-1", {
      channel: "whatsapp", accessToken: "tok", verifyToken: "vtok", phoneNumberId: "111", appSource: "own",
    });
    expect(out).toMatchObject({ provider: "whatsapp", status: "CONNECTED", appSource: "own" });
    const row = tables.integration.rows[0];
    expect(row.appSource).toBe("own");
    const cred = decryptJson<any>(tables.integrationCredential.rows.find((c: any) => c.integrationId === row.id).encryptedData);
    expect(cred.appSecret).toBe("tenant-app-secret");
    expect(cred.accessToken).toBe("tok");
    expect(auditLogs[auditLogs.length - 1].metadata).toMatchObject({ appSource: "own" });
    const list = await svc.listMessagingIntegrations("org-1");
    expect(list[0].appSource).toBe("own");
  });

  it("own + explicit per-call appSecret → the per-call secret wins", async () => {
    stubMetaVerify();
    const { svc, tables } = buildInbox(true);
    await svc.connectMessaging("org-1", "owner-1", {
      channel: "whatsapp", accessToken: "tok", appSecret: "per-call-secret", verifyToken: "vtok", phoneNumberId: "111", appSource: "own",
    });
    const cred = decryptJson<any>(tables.integrationCredential.rows[0].encryptedData);
    expect(cred.appSecret).toBe("per-call-secret");
    expect(tables.integration.rows[0].appSource).toBe("own");
  });

  it("no appSource → unchanged default flow, row marked 'platform'", async () => {
    stubMetaVerify();
    const { svc, tables } = buildInbox(false);
    const out = await svc.connectMessaging("org-1", "owner-1", {
      channel: "whatsapp", accessToken: "tok", appSecret: "app-secret", verifyToken: "vtok", phoneNumberId: "111",
    });
    expect(out.appSource).toBe("platform");
    expect(tables.integration.rows[0].appSource).toBe("platform");
  });

  it("an invalid appSource is refused", async () => {
    stubMetaVerify();
    const { svc, tables } = buildInbox(true);
    await expect(svc.connectMessaging("org-1", "owner-1", {
      channel: "whatsapp", accessToken: "tok", appSecret: "s", verifyToken: "vtok", phoneNumberId: "111", appSource: "bogus",
    })).rejects.toThrow(/appSource/);
    expect(tables.integration.rows).toHaveLength(0);
  });
});
