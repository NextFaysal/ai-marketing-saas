import { AssistantApiService, hashApiKey } from "./assistant-api.service";

function makeTable(seed: any[] = []) {
  const rows: any[] = [...seed];
  let seq = 0;
  const matches = (row: any, where: any) => Object.entries(where ?? {}).every(([k, v]) => row[k] === v);
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where)),
    create: async ({ data }: any) => { const row = { id: `k-${++seq}`, createdAt: new Date(), lastUsedAt: null, revokedAt: null, ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return row; },
  };
}

describe("AssistantApiService (AP7)", () => {
  it("stores only the hash; the plaintext is returned once and authenticates", async () => {
    const prisma: any = { assistantApiKey: makeTable() };
    const svc = new AssistantApiService(prisma);
    const { key, record } = await svc.createKey("org1", "owner1", "Zapier");
    expect(key.startsWith("qos_ai_")).toBe(true);
    expect(prisma.assistantApiKey.rows[0].keyHash).toBe(hashApiKey(key));
    expect(JSON.stringify(prisma.assistantApiKey.rows[0])).not.toContain(key);
    expect(record.keyPrefix).toBe(key.slice(0, 14));
    const auth = await svc.authenticate(key);
    expect(auth).toEqual({ organizationId: "org1", userId: "owner1", keyId: record.id });
    expect(prisma.assistantApiKey.rows[0].lastUsedAt).toBeInstanceOf(Date);
  });

  it("wrong, foreign-format and revoked keys never authenticate", async () => {
    const prisma: any = { assistantApiKey: makeTable() };
    const svc = new AssistantApiService(prisma);
    const { key, record } = await svc.createKey("org1", "owner1", "K");
    expect(await svc.authenticate("qos_ai_wrong")).toBeNull();
    expect(await svc.authenticate("sk_live_123")).toBeNull();
    expect(await svc.authenticate(undefined)).toBeNull();
    await svc.revokeKey("org1", record.id);
    expect(await svc.authenticate(key)).toBeNull();
    // A key id from another org cannot be revoked cross-org.
    await expect(svc.revokeKey("org2", record.id)).rejects.toMatchObject({ code: "ai.apiKeyNotFound" });
  });
});
