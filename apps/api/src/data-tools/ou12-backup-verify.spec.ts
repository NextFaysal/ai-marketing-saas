import { BadRequestException, NotFoundException } from "@nestjs/common";
import { DataExportsService } from "./data-exports.service";

/**
 * OU12 — backup VERIFICATION (the honest subset of OU12's
 * "backup restore"). Step-0 proved the export bundle does not
 * round-trip (no bundle import machinery; credentials never
 * exported; media metadata-only; ids are the source org's), so
 * NO restore is built. These specs pin the verification
 * contract instead:
 *  - slug confirmation is enforced BEFORE the file is touched;
 *  - a sound file verifies ok, with truncated tables and
 *    non-restorable sections named in the recorded result;
 *  - missing/corrupt/mismatched files verify NOT ok — the
 *    failure is recorded, never hidden;
 *  - the result is recorded on the export row + audited, and
 *    `restoreSupported` is false in every outcome;
 *  - verification mutates NOTHING except the export row's own
 *    verification record (read-only against org data).
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      return matches(row[k] ?? {}, v);
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
  };
}
class MemoryStore {
  files = new Map<string, Buffer>();
  getCalls = 0;
  async put(key: string, bytes: Buffer) { this.files.set(key, Buffer.from(bytes)); }
  async get(key: string) { this.getCalls++; return this.files.get(key) ?? null; }
  async delete(key: string) { this.files.delete(key); }
}

const ORG = { id: "org-1", name: "Acme", slug: "acme-shop", creditMinor: 0n };

function soundBundle() {
  return {
    manifest: {
      exportedAt: new Date().toISOString(), exportedBy: "owner@acme.test",
      tables: {
        organization: { rows: 1, truncated: false },
        products: { rows: 2, truncated: false },
        orders: { rows: 1, truncated: true },
        integrations: { rows: 1, truncated: false },
        mediaAssets: { rows: 1, truncated: false },
      },
    },
    data: {
      organization: { id: "org-1", name: "Acme" },
      products: [{ id: "p-1" }, { id: "p-2" }],
      orders: [{ id: "o-1" }],
      integrations: [{ id: "i-1", provider: "bkash", status: "CONNECTED" }],
      mediaAssets: [{ id: "ma-1", kind: "image" }],
    },
  };
}

function makeSvc(bundleBytes: Buffer | null, rowOverrides: any = {}) {
  const prisma: any = {
    organization: makeTable("org"),
    dataExport: makeTable("export"),
  };
  prisma.organization.rows.push({ ...ORG });
  const store = new MemoryStore();
  const fileRef = "data-exports/org-1/exp-1.json";
  if (bundleBytes) store.files.set(fileRef, bundleBytes);
  prisma.dataExport.rows.push({
    id: "exp-1", organizationId: "org-1", requestedById: "u-owner", kind: "backup",
    status: "ready", fileRef, sizeBytes: bundleBytes?.length ?? null, error: null,
    expiresAt: new Date(Date.now() + 86_400_000), createdAt: new Date(), completedAt: new Date(),
    backupVerifiedAt: null, backupVerification: null,
    ...rowOverrides,
  });
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const svc = new DataExportsService(prisma, audit as any);
  svc.storeFactory = () => store as any;
  return { svc, prisma, store, audit };
}

describe("OU12 verifyBackup", () => {
  it("a sound backup verifies ok — truncated tables + non-restorable sections named; result recorded on the row + audited; restoreSupported false", async () => {
    const { svc, prisma, audit } = makeSvc(Buffer.from(JSON.stringify(soundBundle()), "utf8"));
    const out: any = await svc.verifyBackup("org-1", "u-owner", "exp-1", "acme-shop");
    expect(out.restoreSupported).toBe(false);
    expect(out.verification.ok).toBe(true);
    expect(out.verification.problems).toEqual([]);
    expect(out.verification.truncatedTables).toEqual(["orders"]);
    expect(out.verification.counts.products).toEqual({ manifest: 2, actual: 2 });
    const nonRestorable = out.verification.nonRestorableSections.map((s: any) => s.section);
    expect(nonRestorable).toContain("integrations");
    expect(nonRestorable).toContain("mediaAssets");
    expect(nonRestorable).toContain("organization");
    const integrationsEntry = out.verification.nonRestorableSections.find((s: any) => s.section === "integrations");
    expect(integrationsEntry.reason).toContain("credentials are never exported");
    const row = prisma.dataExport.rows[0];
    expect(row.backupVerifiedAt).toBeTruthy();
    expect(row.backupVerification.ok).toBe(true);
    const entry = audit.calls.find((c: any) => c.action === "data_export.backup_verified");
    expect(entry).toBeTruthy();
    expect(entry.metadata.restoreSupported).toBe(false);
    expect(entry.metadata.ok).toBe(true);
  });

  it("wrong slug → refused BEFORE the file is read; nothing is recorded", async () => {
    const { svc, prisma, store, audit } = makeSvc(Buffer.from(JSON.stringify(soundBundle()), "utf8"));
    await expect(svc.verifyBackup("org-1", "u-owner", "exp-1", "not-the-slug")).rejects.toMatchObject({ code: "dataTools.slug" });
    await expect(svc.verifyBackup("org-1", "u-owner", "exp-1", "")).rejects.toMatchObject({ code: "dataTools.slug" });
    expect(store.getCalls).toBe(0);
    expect(prisma.dataExport.rows[0].backupVerifiedAt).toBeNull();
    expect(audit.calls).toHaveLength(0);
  });

  it("a foreign org's export is a 404, exactly like a missing one", async () => {
    const { svc, prisma } = makeSvc(Buffer.from(JSON.stringify(soundBundle()), "utf8"));
    prisma.dataExport.rows[0].organizationId = "org-2";
    await expect(svc.verifyBackup("org-1", "u-owner", "exp-1", "acme-shop")).rejects.toMatchObject({ code: "dataTools.exportNotFound" });
    await expect(svc.verifyBackup("org-1", "u-owner", "exp-missing", "acme-shop")).rejects.toMatchObject({ code: "dataTools.exportNotFound" });
  });

  it("missing stored bytes → NOT ok with stored_file_missing, and the failure is recorded (never hidden)", async () => {
    const { svc, prisma } = makeSvc(null);
    const out: any = await svc.verifyBackup("org-1", "u-owner", "exp-1", "acme-shop");
    expect(out.verification.ok).toBe(false);
    expect(out.verification.problems).toContain("stored_file_missing");
    expect(out.restoreSupported).toBe(false);
    expect(prisma.dataExport.rows[0].backupVerification.ok).toBe(false);
  });

  it("corrupt bytes → file_not_valid_json; count drift → count_mismatch:<table>", async () => {
    const corrupt = makeSvc(Buffer.from("{not json", "utf8"));
    const outCorrupt: any = await corrupt.svc.verifyBackup("org-1", "u-owner", "exp-1", "acme-shop");
    expect(outCorrupt.verification.ok).toBe(false);
    expect(outCorrupt.verification.problems).toContain("file_not_valid_json");

    const drifted = soundBundle();
    (drifted.data as any).products = [{ id: "p-1" }]; // manifest says 2
    const drift = makeSvc(Buffer.from(JSON.stringify(drifted), "utf8"));
    const outDrift: any = await drift.svc.verifyBackup("org-1", "u-owner", "exp-1", "acme-shop");
    expect(outDrift.verification.ok).toBe(false);
    expect(outDrift.verification.problems).toContain("count_mismatch:products");
    expect(outDrift.verification.counts.products).toEqual({ manifest: 2, actual: 1 });
  });

  it("a non-ready export records its status problem instead of pretending to verify", async () => {
    const { svc } = makeSvc(null, { status: "pending", fileRef: null });
    const out: any = await svc.verifyBackup("org-1", "u-owner", "exp-1", "acme-shop");
    expect(out.verification.ok).toBe(false);
    expect(out.verification.problems).toContain("status_not_ready:pending");
    expect(out.verification.problems).toContain("no_file_ref");
  });

  it("read-only: verification changes NOTHING except the export row's verification record", async () => {
    const { svc, prisma } = makeSvc(Buffer.from(JSON.stringify(soundBundle()), "utf8"));
    const orgBefore = JSON.stringify(prisma.organization.rows[0], (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    const rowBefore = { ...prisma.dataExport.rows[0] };
    await svc.verifyBackup("org-1", "u-owner", "exp-1", "acme-shop");
    const orgAfter = JSON.stringify(prisma.organization.rows[0], (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(orgAfter).toBe(orgBefore);
    const rowAfter = prisma.dataExport.rows[0];
    expect(rowAfter.status).toBe(rowBefore.status);
    expect(rowAfter.fileRef).toBe(rowBefore.fileRef);
    expect(rowAfter.sizeBytes).toBe(rowBefore.sizeBytes);
    expect(prisma.dataExport.rows).toHaveLength(1); // no new rows anywhere
  });
});
