import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { SocialService } from "./social.service";
import { MetaClient } from "../ads/meta/meta.client";
import { MediaStore } from "../inbox/media-store";
import { decryptJson, encryptJson } from "../integrations/crypto";

/**
 * SP1 — Social Foundation:
 * - discover: side-effect-free picker step 1 (bad token = Meta's
 *   verbatim error, nothing stored; alreadyConnected counts a row
 *   in ANY status; a Page without Instagram reports instagram
 *   null — never invented).
 * - connect: the PAGE token (not the user token) is what gets
 *   sealed; empty/unknown selection = Bengali 400 before any
 *   write; Page + Instagram share one integration; AD2-style
 *   supersede only when the old integration is unreferenced;
 *   unselected pages/accounts are never touched.
 * - disconnect: shared-token reference counting (last referencer
 *   tears the credential down); posts are never touched.
 * - media: magic-byte sniffing decides (PDF rejected), public
 *   links are opt-in + idempotent, tokens never audited.
 * - posts: draft-only edit/delete (409 otherwise), org-scoped
 *   media refs with kind match, tenant isolation everywhere.
 */
const ORG = "org-1";
const ORG2 = "org-2";
const ACTOR = "owner-1";
type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
}

function table(store: Row[]) {
  return {
    findMany: jest.fn(async (args: any = {}) => {
      let rows = store.filter((r) => matches(r, args.where));
      if (args.orderBy?.createdAt === "asc") rows = [...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (args.orderBy?.createdAt === "desc") rows = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (args.take) rows = rows.slice(0, args.take);
      return rows.map((r) => ({ ...r }));
    }),
    findFirst: jest.fn(async (args: any = {}) => {
      const row = store.find((r) => matches(r, args.where));
      return row ? { ...row } : null;
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      store.push(row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((r) => matches(r, where));
      if (row) Object.assign(row, data, { updatedAt: new Date() });
      return row ? { ...row } : null;
    }),
    delete: jest.fn(async ({ where }: any) => {
      const idx = store.findIndex((r) => matches(r, where));
      if (idx >= 0) store.splice(idx, 1);
      return {};
    }),
    deleteMany: jest.fn(async ({ where }: any = {}) => {
      const before = store.length;
      for (let i = store.length - 1; i >= 0; i--) if (matches(store[i], where)) store.splice(i, 1);
      return { count: before - store.length };
    }),
  };
}

let seq = 0;
function fakeDb() {
  const db: any = {
    socialAccounts: [] as Row[], integrations: [] as Row[], credentials: [] as Row[],
    mediaAssets: [] as Row[], socialPosts: [] as Row[], auditRows: [] as Row[],
  };
  db.socialAccount = {
    ...table(db.socialAccounts),
    upsert: jest.fn(async ({ where, update, create }: any) => {
      const key = where.organizationId_platform_externalId;
      const found = db.socialAccounts.find((a: Row) => a.organizationId === key.organizationId && a.platform === key.platform && a.externalId === key.externalId);
      if (found) { Object.assign(found, update, { updatedAt: new Date() }); return { ...found }; }
      const row = { id: `sacc-${++seq}`, createdAt: new Date(), updatedAt: new Date(), username: null, pictureUrl: null, lastError: null, ...create };
      db.socialAccounts.push(row);
      return { ...row };
    }),
  };
  db.integration = {
    ...table(db.integrations),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `int-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      db.integrations.push(row);
      return { ...row };
    }),
  };
  db.integrationCredential = {
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `cred-${++seq}`, createdAt: new Date(), ...data };
      db.credentials.push(row);
      return { ...row };
    }),
    deleteMany: jest.fn(async ({ where }: any = {}) => {
      const before = db.credentials.length;
      for (let i = db.credentials.length - 1; i >= 0; i--) if (matches(db.credentials[i], where)) db.credentials.splice(i, 1);
      return { count: before - db.credentials.length };
    }),
  };
  db.mediaAsset = {
    ...table(db.mediaAssets),
    create: jest.fn(async ({ data }: any) => {
      const row = { createdAt: new Date(), updatedAt: new Date(), publicToken: null, ...data };
      db.mediaAssets.push(row);
      return { ...row };
    }),
  };
  db.socialPost = {
    ...table(db.socialPosts),
    create: jest.fn(async ({ data }: any) => {
      const row = {
        id: `post-${++seq}`, createdAt: new Date(), updatedAt: new Date(),
        linkUrl: null, scheduledAt: null, publishedAt: null, platformPostId: null,
        platformUrl: null, error: null, ...data,
      };
      db.socialPosts.push(row);
      return { ...row };
    }),
  };
  return db;
}

function service(db: any) {
  const audit = { log: jest.fn(async (input: any) => { db.auditRows.push({ id: `audit-${db.auditRows.length + 1}`, createdAt: new Date(), ...input }); }) };
  return new SocialService(db as any, audit as any);
}

function seedSocialAccount(db: any, over: Row = {}) {
  const row = {
    id: `sacc-seed-${db.socialAccounts.length + 1}`, organizationId: ORG, platform: "meta_page",
    externalId: "page-1", name: "Shop One", username: null, pictureUrl: null,
    status: "connected", lastError: null, integrationId: null, createdById: ACTOR,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.socialAccounts.push(row);
  return row;
}

function seedIntegration(db: any, over: Row = {}) {
  const row = {
    id: `int-seed-${db.integrations.length + 1}`, organizationId: ORG, provider: "meta_social",
    status: "CONNECTED", externalAccountId: "page-1", createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.integrations.push(row);
  db.credentials.push({ id: `cred-seed-${row.id}`, integrationId: row.id, encryptedData: encryptJson({ accessToken: "OLD-PAGE-TOKEN", pageId: "page-1" }), createdAt: new Date() });
  return row;
}

function seedAsset(db: any, over: Row = {}) {
  const row = {
    id: `asset-seed-${db.mediaAssets.length + 1}`, organizationId: ORG, kind: "image",
    name: "photo.png", contentType: "image/png", sizeBytes: 100,
    storageKey: `${ORG}/social/seed.png`, publicToken: null, createdById: ACTOR,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.mediaAssets.push(row);
  return row;
}

const PAGES = [
  {
    pageId: "page-1", name: "Shop One", pageAccessToken: "PAGE-TOKEN-1", pictureUrl: "https://pic/1",
    instagram: { externalId: "ig-1", username: "shopone", pictureUrl: "https://pic/ig1" },
  },
  { pageId: "page-2", name: "Shop Two", pageAccessToken: "PAGE-TOKEN-2", pictureUrl: null, instagram: null },
];

function stubMetaOk() {
  jest.spyOn(MetaClient.prototype, "verifyToken").mockResolvedValue({ id: "user-42", name: "Token User" });
  jest.spyOn(MetaClient.prototype, "listPages").mockResolvedValue(PAGES as any);
}

function stubMediaStore() {
  const blobs = new Map<string, { bytes: Buffer; contentType: string }>();
  jest.spyOn(MediaStore.prototype, "put").mockImplementation(async (key: string, bytes: Buffer, contentType: string) => {
    blobs.set(key, { bytes: Buffer.from(bytes), contentType });
  });
  jest.spyOn(MediaStore.prototype, "get").mockImplementation(async (key: string) => blobs.get(key)?.bytes ?? null);
  return blobs;
}

/** Recursive KEY scan (AD1 approach): no key anywhere in the
 * payload may look like credential material. */
function scanKeys(value: any, path = "$"): string[] {
  const bad: string[] = [];
  if (Array.isArray(value)) value.forEach((v, i) => bad.push(...scanKeys(v, `${path}[${i}]`)));
  else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) {
      if (/credential|encrypted|accessToken|token/i.test(k)) bad.push(`${path}.${k}`);
      bad.push(...scanKeys(v, `${path}.${k}`));
    }
  }
  return bad;
}

const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake-png-payload")]);

afterEach(() => jest.restoreAllMocks());

describe("SP1 discover (picker step 1)", () => {
  it("invalid token → Meta's verbatim error, and NOTHING is stored anywhere", async () => {
    const db = fakeDb();
    jest.spyOn(MetaClient.prototype, "verifyToken").mockRejectedValue(new Error("Invalid OAuth access token - Cannot parse access token"));
    const err = await service(db).discoverMetaPages(ORG, { accessToken: "bad-token-value" }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("Meta token verification failed: Invalid OAuth access token");
    expect(db.integrations).toHaveLength(0);
    expect(db.credentials).toHaveLength(0);
    expect(db.socialAccounts).toHaveLength(0);
    expect(db.auditRows).toHaveLength(0);
  });

  it("listPages failure after a valid token → verbatim 400, still nothing stored", async () => {
    const db = fakeDb();
    jest.spyOn(MetaClient.prototype, "verifyToken").mockResolvedValue({ id: "user-42" });
    jest.spyOn(MetaClient.prototype, "listPages").mockRejectedValue(new Error("(#190) OAuthException"));
    const err = await service(db).discoverMetaPages(ORG, { accessToken: "some-token" }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("Could not list Meta pages: (#190)");
    expect(db.integrations).toHaveLength(0);
    expect(db.auditRows).toHaveLength(0);
  });

  it("alreadyConnected flags count rows in ANY status; a Page without Instagram reports instagram null; no token leaks", async () => {
    const db = fakeDb(); stubMetaOk();
    // page-1 exists but DISCONNECTED today — reconnect revives it, so it counts.
    seedSocialAccount(db, { externalId: "page-1", status: "disconnected" });
    seedSocialAccount(db, { externalId: "ig-1", platform: "instagram", name: "Shop One", username: "shopone", status: "disconnected" });
    // page-2 exists only in ANOTHER org → does not count here.
    seedSocialAccount(db, { externalId: "page-2", organizationId: ORG2 });

    const res = await service(db).discoverMetaPages(ORG, { accessToken: "user-token-secret" });
    expect(res.pages).toHaveLength(2);
    const byId = new Map(res.pages.map((p: any) => [p.pageId, p]));
    expect(byId.get("page-1")).toMatchObject({
      name: "Shop One", pictureUrl: "https://pic/1", alreadyConnectedPage: true, alreadyConnectedInstagram: true,
      instagram: { externalId: "ig-1", username: "shopone", pictureUrl: "https://pic/ig1" },
    });
    // IG-absent honesty: instagram is null, never fabricated.
    expect(byId.get("page-2").instagram).toBeNull();
    expect(byId.get("page-2").alreadyConnectedPage).toBe(false);
    expect(byId.get("page-2").alreadyConnectedInstagram).toBe(false);
    // neither the user token nor any PAGE token appears in the payload
    const json = JSON.stringify(res);
    expect(json).not.toContain("user-token-secret");
    expect(json).not.toContain("PAGE-TOKEN");
    expect(scanKeys(res)).toEqual([]);
    // discover wrote nothing
    expect(db.integrations).toHaveLength(0);
    expect(db.credentials).toHaveLength(0);
    expect(db.auditRows).toHaveLength(0);
    expect(db.socialAccounts).toHaveLength(3); // only the seeds
  });
});

describe("SP1 connect", () => {
  it("empty or missing selection → Bengali 400, nothing stored", async () => {
    const db = fakeDb(); stubMetaOk();
    const svc = service(db);
    for (const pageIds of [[], undefined]) {
      const err = await svc.connectMetaPages(ORG, ACTOR, { accessToken: "tok", pageIds } as any).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain("কোনো Page নির্বাচন করা হয়নি");
    }
    expect(db.integrations).toHaveLength(0);
    expect(db.socialAccounts).toHaveLength(0);
  });

  it("an unknown pageId → Bengali 400 BEFORE any write", async () => {
    const db = fakeDb(); stubMetaOk();
    const err = await service(db).connectMetaPages(ORG, ACTOR, { accessToken: "tok", pageIds: ["page-1", "page-zzz"] }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("page-zzz");
    expect(db.integrations).toHaveLength(0);
    expect(db.credentials).toHaveLength(0);
    expect(db.socialAccounts).toHaveLength(0);
    expect(db.auditRows).toHaveLength(0);
  });

  it("bad token → verbatim 400, nothing stored", async () => {
    const db = fakeDb();
    jest.spyOn(MetaClient.prototype, "verifyToken").mockRejectedValue(new Error("Session has expired"));
    const err = await service(db).connectMetaPages(ORG, ACTOR, { accessToken: "tok", pageIds: ["page-1"] }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("Meta token verification failed: Session has expired");
    expect(db.integrations).toHaveLength(0);
  });

  it("creates integration + SEALED credential holding the PAGE token; Instagram shares the same integrationId", async () => {
    const db = fakeDb(); stubMetaOk();
    const res = await service(db).connectMetaPages(ORG, ACTOR, { accessToken: "user-token", pageIds: ["page-1"] });
    expect(res.accounts).toHaveLength(2);
    const pageAcc = res.accounts.find((a: any) => a.platform === "meta_page");
    const igAcc = res.accounts.find((a: any) => a.platform === "instagram");
    expect(pageAcc).toMatchObject({ externalId: "page-1", name: "Shop One", status: "connected" });
    expect(igAcc).toMatchObject({ externalId: "ig-1", name: "Shop One", username: "shopone", status: "connected" });

    expect(db.integrations).toHaveLength(1);
    const integration = db.integrations[0];
    expect(integration).toMatchObject({ provider: "meta_social", status: "CONNECTED", externalAccountId: "page-1", organizationId: ORG });
    const storedPage = db.socialAccounts.find((a: Row) => a.platform === "meta_page");
    const storedIg = db.socialAccounts.find((a: Row) => a.platform === "instagram");
    expect(storedPage.integrationId).toBe(integration.id);
    expect(storedIg.integrationId).toBe(integration.id); // SAME integration

    // the sealed credential decrypts to the PAGE token, not the user token
    expect(db.credentials).toHaveLength(1);
    const cred = db.credentials[0];
    expect(cred.integrationId).toBe(integration.id);
    expect(cred.encryptedData).not.toContain("PAGE-TOKEN-1");
    expect(cred.encryptedData).not.toBe("PAGE-TOKEN-1");
    expect(decryptJson(cred.encryptedData)).toEqual({ accessToken: "PAGE-TOKEN-1", pageId: "page-1" });

    // audits: one per account, metadata carries platform + pageId only — no tokens
    const audits = db.auditRows.filter((r: Row) => r.action === "social.account_connected");
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(db.auditRows)).not.toContain("PAGE-TOKEN");
    expect(JSON.stringify(db.auditRows)).not.toContain("user-token");
    expect(scanKeys(res)).toEqual([]);
  });

  it("reconnect supersedes the previous integration ONLY when it becomes unreferenced", async () => {
    const db = fakeDb(); stubMetaOk();
    const old = seedIntegration(db);
    seedSocialAccount(db, { externalId: "page-1", integrationId: old.id });
    seedSocialAccount(db, { externalId: "ig-1", platform: "instagram", integrationId: old.id, username: "shopone" });

    await service(db).connectMetaPages(ORG, ACTOR, { accessToken: "user-token", pageIds: ["page-1"] });
    // both accounts moved to the new integration → old one is dead
    expect(db.socialAccounts.every((a: Row) => a.integrationId !== old.id)).toBe(true);
    expect(db.integrations.find((i: Row) => i.id === old.id).status).toBe("DISCONNECTED");
    expect(db.credentials.filter((c: Row) => c.integrationId === old.id)).toHaveLength(0);
    expect(db.auditRows.filter((r: Row) => r.action === "social.integration_superseded")).toHaveLength(1);
  });

  it("partial selection leaves other accounts/integrations untouched; a still-referenced old integration stays alive", async () => {
    const db = fakeDb(); stubMetaOk();
    const old = seedIntegration(db); // page-1's previous integration
    seedSocialAccount(db, { externalId: "page-1", integrationId: old.id });
    // page-2's account ALSO references the old integration (shared
    // legacy row) and page-2 is NOT selected this time.
    const other = seedSocialAccount(db, { externalId: "page-2", name: "Shop Two", integrationId: old.id });
    const otherInt = seedIntegration(db, { externalAccountId: "page-2", id: "int-page2" });

    const res = await service(db).connectMetaPages(ORG, ACTOR, { accessToken: "user-token", pageIds: ["page-1"] });
    expect(res.accounts.map((a: any) => a.externalId)).toEqual(["page-1", "ig-1"]);
    // unselected account: same row, same integration; old integration
    // still CONNECTED with its credential (page-2 still references it)
    const storedOther = db.socialAccounts.find((a: Row) => a.id === other.id);
    expect(storedOther.integrationId).toBe(old.id);
    expect(db.integrations.find((i: Row) => i.id === old.id).status).toBe("CONNECTED");
    expect(db.credentials.filter((c: Row) => c.integrationId === old.id)).toHaveLength(1);
    expect(db.auditRows.filter((r: Row) => r.action === "social.integration_superseded")).toHaveLength(0);
    // page-2's own integration untouched
    expect(db.integrations.find((i: Row) => i.id === otherInt.id).status).toBe("CONNECTED");
  });
});

describe("SP1 listAccounts hygiene", () => {
  it("no credential-shaped key anywhere in the payload", async () => {
    const db = fakeDb(); stubMetaOk();
    const svc = service(db);
    await svc.connectMetaPages(ORG, ACTOR, { accessToken: "user-token", pageIds: ["page-1", "page-2"] });
    const list = await svc.listAccounts(ORG);
    expect(list).toHaveLength(3); // page-1, ig-1, page-2
    expect(scanKeys(list)).toEqual([]);
    expect(JSON.stringify(list)).not.toContain("PAGE-TOKEN");
    expect(list.find((a: any) => a.externalId === "page-2")).toMatchObject({ platform: "meta_page", status: "connected" });
  });
});

describe("SP1 disconnect", () => {
  it("shared token: disconnecting the Page keeps Instagram's credential; disconnecting Instagram last tears it down", async () => {
    const db = fakeDb(); stubMetaOk();
    const svc = service(db);
    const res = await svc.connectMetaPages(ORG, ACTOR, { accessToken: "user-token", pageIds: ["page-1"] });
    const pageAcc = res.accounts.find((a: any) => a.platform === "meta_page");
    const igAcc = res.accounts.find((a: any) => a.platform === "instagram");
    const integrationId = db.integrations[0].id;

    const afterPage = await svc.disconnectAccount(ORG, ACTOR, pageAcc.id);
    expect(afterPage).toMatchObject({ status: "disconnected" });
    expect(db.socialAccounts.find((a: Row) => a.id === pageAcc.id).integrationId).toBeNull();
    // Instagram keeps working: integration + credential untouched
    expect(db.socialAccounts.find((a: Row) => a.id === igAcc.id).integrationId).toBe(integrationId);
    expect(db.integrations[0].status).toBe("CONNECTED");
    expect(db.credentials.filter((c: Row) => c.integrationId === integrationId)).toHaveLength(1);
    expect(db.auditRows.find((r: Row) => r.action === "social.account_disconnected")?.metadata).toEqual({ shared: true });

    await svc.disconnectAccount(ORG, ACTOR, igAcc.id);
    expect(db.credentials.filter((c: Row) => c.integrationId === integrationId)).toHaveLength(0);
    expect(db.integrations[0].status).toBe("DISCONNECTED");
    const audits = db.auditRows.filter((r: Row) => r.action === "social.account_disconnected");
    expect(audits[audits.length - 1].metadata).toEqual({ shared: false });
  });

  it("disconnect keeps the account's posts; no-integration disconnect is idempotent; foreign org → 404", async () => {
    const db = fakeDb(); stubMetaOk(); stubMediaStore();
    const svc = service(db);
    const res = await svc.connectMetaPages(ORG, ACTOR, { accessToken: "user-token", pageIds: ["page-2"] });
    const acc = res.accounts[0];
    const post = await svc.createPost(ORG, ACTOR, { socialAccountId: acc.id, caption: "ঈদ অফার" });
    await svc.disconnectAccount(ORG, ACTOR, acc.id);
    expect(db.socialPosts).toHaveLength(1);
    const fetched = await svc.getPost(ORG, post.id);
    expect(fetched.caption).toBe("ঈদ অফার");

    const lone = seedSocialAccount(db, { externalId: "page-x", integrationId: null, status: "connected" });
    const again = await svc.disconnectAccount(ORG, ACTOR, lone.id);
    expect(again.status).toBe("disconnected");

    const err = await svc.disconnectAccount(ORG2, ACTOR, acc.id).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
  });
});

describe("SP1 media", () => {
  it("PDF bytes are rejected by sniffing with the Bengali 400", async () => {
    const db = fakeDb(); stubMediaStore();
    const pdf = Buffer.from("%PDF-1.4 not-an-image").toString("base64");
    const err = await service(db).uploadMedia(ORG, ACTOR, { dataBase64: pdf, fileName: "doc.pdf", contentType: "application/pdf" }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("শুধু ছবি বা ভিডিও আপলোড করা যাবে");
    expect(db.mediaAssets).toHaveLength(0);
  });

  it("invalid base64 and oversize payloads are Bengali 400s", async () => {
    const db = fakeDb(); stubMediaStore();
    const svc = service(db);
    const bad = await svc.uploadMedia(ORG, ACTOR, { dataBase64: "!!!not-base64!!!" }).catch((e) => e);
    expect(bad).toBeInstanceOf(BadRequestException);
    const big = Buffer.alloc(2_100_001);
    PNG_BYTES.copy(big, 0);
    const tooBig = await svc.uploadMedia(ORG, ACTOR, { dataBase64: big.toString("base64") }).catch((e) => e);
    expect(tooBig).toBeInstanceOf(BadRequestException);
    expect(tooBig.message).toContain("২.১ MB");
    expect(db.mediaAssets).toHaveLength(0);
  });

  it("image upload succeeds: sniffed type wins, storageKey shape is org/social/<id>.<ext>, publicUrl starts null", async () => {
    const db = fakeDb(); const blobs = stubMediaStore();
    const svc = service(db);
    const asset = await svc.uploadMedia(ORG, ACTOR, {
      dataBase64: PNG_BYTES.toString("base64"), fileName: "offer.png", contentType: "image/jpeg", // declared type lies; magic bytes win
    });
    expect(asset).toMatchObject({ kind: "image", contentType: "image/png", name: "offer.png", sizeBytes: PNG_BYTES.length, publicUrl: null });
    const stored = db.mediaAssets[0];
    expect(stored.storageKey).toBe(`${ORG}/social/${asset.id}.png`);
    expect(blobs.get(stored.storageKey)?.bytes.equals(PNG_BYTES)).toBe(true);
    const audit = db.auditRows.find((r: Row) => r.action === "social.media_uploaded");
    expect(audit.metadata).toEqual({ kind: "image", contentType: "image/png", sizeBytes: PNG_BYTES.length });

    const file = await svc.getMediaFile(ORG, asset.id);
    expect(file.bytes.equals(PNG_BYTES)).toBe(true);
    expect(file.contentType).toBe("image/png");
    const foreign = await svc.getMediaFile(ORG2, asset.id).catch((e) => e);
    expect(foreign).toBeInstanceOf(NotFoundException);
  });

  it("public link: opt-in, idempotent, resolvable by token only; the token never lands in audit metadata", async () => {
    const db = fakeDb(); const blobs = stubMediaStore();
    const svc = service(db);
    const asset = await svc.uploadMedia(ORG, ACTOR, { dataBase64: PNG_BYTES.toString("base64") });
    // no token yet → not resolvable by anything
    expect(await svc.resolvePublicMedia("anything")).toBeNull();

    const linked = await svc.createPublicLink(ORG, ACTOR, asset.id);
    expect(linked.publicUrl).toMatch(/^\/public\/media\/.+/);
    const token = db.mediaAssets[0].publicToken as string;
    expect(linked.publicUrl).toBe(`/public/media/${token}`);
    blobs.set(db.mediaAssets[0].storageKey, { bytes: PNG_BYTES, contentType: "image/png" });

    const again = await svc.createPublicLink(ORG, ACTOR, asset.id);
    expect(again.publicUrl).toBe(linked.publicUrl); // idempotent — token unchanged
    expect(db.mediaAssets[0].publicToken).toBe(token);

    const resolved = await svc.resolvePublicMedia(token);
    expect(resolved?.bytes.equals(PNG_BYTES)).toBe(true);
    expect(resolved?.contentType).toBe("image/png");
    expect(await svc.resolvePublicMedia("wrong-token")).toBeNull();

    // the token itself is never in audit metadata
    expect(JSON.stringify(db.auditRows)).not.toContain(token);
    const audit = db.auditRows.find((r: Row) => r.action === "social.media_public_link_created");
    expect(audit.metadata).toEqual({ assetId: asset.id });

    // removing the link kills resolution
    const removed = await svc.removePublicLink(ORG, ACTOR, asset.id);
    expect(removed.publicUrl).toBeNull();
    expect(await svc.resolvePublicMedia(token)).toBeNull();
  });

  it("listMedia is org-scoped and newest first", async () => {
    const db = fakeDb();
    seedAsset(db, { id: "a-old", createdAt: new Date(Date.now() - 60_000) });
    seedAsset(db, { id: "a-new" });
    seedAsset(db, { id: "a-foreign", organizationId: ORG2 });
    const list = await service(db).listMedia(ORG);
    expect(list.map((a: any) => a.id)).toEqual(["a-new", "a-old"]);
  });
});

describe("SP1 posts", () => {
  async function setup() {
    const db = fakeDb(); stubMetaOk(); stubMediaStore();
    const svc = service(db);
    const res = await svc.connectMetaPages(ORG, ACTOR, { accessToken: "user-token", pageIds: ["page-1"] });
    const account = res.accounts.find((a: any) => a.platform === "meta_page");
    return { db, svc, account };
  }

  it("create validations: foreign asset 400 (named), kind mismatch 400, empty caption 400, bad link 400", async () => {
    const { db, svc, account } = await setup();
    const own = seedAsset(db, { id: "asset-own", kind: "image" });
    const foreign = seedAsset(db, { id: "asset-foreign", organizationId: ORG2, kind: "image" });

    const foreignErr = await svc.createPost(ORG, ACTOR, { socialAccountId: account.id, caption: "hi", mediaRefs: [{ assetId: foreign.id, kind: "image" }] }).catch((e) => e);
    expect(foreignErr).toBeInstanceOf(BadRequestException);
    expect(foreignErr.message).toContain("asset-foreign");

    const kindErr = await svc.createPost(ORG, ACTOR, { socialAccountId: account.id, caption: "hi", mediaRefs: [{ assetId: own.id, kind: "video" }] }).catch((e) => e);
    expect(kindErr).toBeInstanceOf(BadRequestException);
    expect(kindErr.message).toContain("asset-own");

    const captionErr = await svc.createPost(ORG, ACTOR, { socialAccountId: account.id, caption: "   " }).catch((e) => e);
    expect(captionErr).toBeInstanceOf(BadRequestException);

    for (const linkUrl of ["notaurl", "ftp://example.com/x"]) {
      const linkErr = await svc.createPost(ORG, ACTOR, { socialAccountId: account.id, caption: "hi", linkUrl }).catch((e) => e);
      expect(linkErr).toBeInstanceOf(BadRequestException);
    }
    expect(db.socialPosts).toHaveLength(0);
  });

  it("create succeeds as draft with account summary; unknown/foreign account → 404", async () => {
    const { db, svc, account } = await setup();
    const own = seedAsset(db, { id: "asset-own", kind: "image" });
    const post = await svc.createPost(ORG, ACTOR, {
      socialAccountId: account.id, caption: "  নতুন কালেকশন  ", linkUrl: "https://shop.example.com/x",
      mediaRefs: [{ assetId: own.id, kind: "image" }],
    });
    expect(post).toMatchObject({ status: "draft", caption: "নতুন কালেকশন", linkUrl: "https://shop.example.com/x" });
    expect(post.account).toEqual({ id: account.id, platform: "meta_page", name: "Shop One", username: null });
    expect(post.mediaRefs).toEqual([{ assetId: "asset-own", kind: "image" }]);
    expect(db.auditRows.some((r: Row) => r.action === "social.post_created")).toBe(true);
    expect(scanKeys(post)).toEqual([]);

    const err = await svc.createPost(ORG2, ACTOR, { socialAccountId: account.id, caption: "hi" }).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
  });

  it("list filters: invalid status → Bengali 400; status/accountId filters apply; foreign org sees nothing", async () => {
    const { svc, account } = await setup();
    await svc.createPost(ORG, ACTOR, { socialAccountId: account.id, caption: "one" });
    const badStatus = await svc.listPosts(ORG, { status: "bogus" }).catch((e) => e);
    expect(badStatus).toBeInstanceOf(BadRequestException);
    expect((await svc.listPosts(ORG, { status: "draft" })).length).toBe(1);
    expect((await svc.listPosts(ORG, { status: "published" })).length).toBe(0);
    expect((await svc.listPosts(ORG, { accountId: account.id })).length).toBe(1);
    expect((await svc.listPosts(ORG2, {})).length).toBe(0);
  });

  it("PATCH/DELETE: non-draft → 409 Bengali; draft edits and deletes cleanly; foreign post → 404", async () => {
    const { db, svc, account } = await setup();
    const draft = await svc.createPost(ORG, ACTOR, { socialAccountId: account.id, caption: "draft one" });
    const scheduledRow = {
      id: "post-scheduled", organizationId: ORG, socialAccountId: account.id, caption: "sched",
      linkUrl: null, mediaRefs: [], status: "scheduled", scheduledAt: new Date(), publishedAt: null,
      platformPostId: null, platformUrl: null, error: null, createdById: ACTOR,
      createdAt: new Date(), updatedAt: new Date(),
    };
    db.socialPosts.push(scheduledRow);

    const patchErr = await svc.updatePost(ORG, ACTOR, "post-scheduled", { caption: "x" }).catch((e) => e);
    expect(patchErr).toBeInstanceOf(ConflictException);
    expect(patchErr.message).toContain("শুধু Draft পোস্ট সম্পাদনা করা যায়");
    const delErr = await svc.deletePost(ORG, ACTOR, "post-scheduled").catch((e) => e);
    expect(delErr).toBeInstanceOf(ConflictException);

    const updated = await svc.updatePost(ORG, ACTOR, draft.id, { caption: "edited", linkUrl: "https://a.b/c" });
    expect(updated.caption).toBe("edited");
    expect(updated.linkUrl).toBe("https://a.b/c");
    expect(db.auditRows.some((r: Row) => r.action === "social.post_updated")).toBe(true);

    const foreign = await svc.getPost(ORG2, draft.id).catch((e) => e);
    expect(foreign).toBeInstanceOf(NotFoundException);

    const del = await svc.deletePost(ORG, ACTOR, draft.id);
    expect(del).toEqual({ deleted: true, id: draft.id });
    expect(db.socialPosts.find((p: Row) => p.id === draft.id)).toBeUndefined();
  });
});

describe("SP1 MetaClient.listPages", () => {
  it("maps pages + instagram, and never follows a non-graph paging URL", async () => {
    const body = {
      data: [{
        id: "page-9", name: "Nine", access_token: "PT-9", picture: { url: "https://pic/9" },
        instagram_business_account: { id: "ig-9", username: "nine", profile_picture_url: "https://pic/ig9" },
      }, {
        id: "page-10", name: "Ten", access_token: "PT-10",
      }],
      paging: { next: "https://evil.example.com/steal" },
    };
    const fetchFn = jest.fn(async () => ({ ok: true, status: 200, json: async () => body })) as any;
    const client = new MetaClient("user-token", fetchFn);
    const pages = await client.listPages();
    expect(pages).toEqual([
      { pageId: "page-9", name: "Nine", pageAccessToken: "PT-9", pictureUrl: "https://pic/9", instagram: { externalId: "ig-9", username: "nine", pictureUrl: "https://pic/ig9" } },
      { pageId: "page-10", name: "Ten", pageAccessToken: "PT-10", pictureUrl: null, instagram: null },
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(1); // foreign paging URL not followed
    const calledUrl = String((fetchFn.mock.calls[0] as any)[0]);
    expect(calledUrl).toContain("/me/accounts");
    expect(calledUrl).toContain("instagram_business_account");
  });
});
