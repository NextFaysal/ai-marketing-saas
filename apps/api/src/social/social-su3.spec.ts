import sharp from "sharp";
import { SocialMediaLibraryService, normalizeMediaTags } from "./social-media-library.service";

/**
 * SU3 — Media Library v2:
 * - folders: CRUD, case-insensitive duplicate → Conflict,
 *   org-scoped 404s, assetCount from real asset rows, delete
 *   removes ONLY the folder row (assets survive in the table).
 * - updateMedia: name/folder/tags with normalization; a foreign
 *   folder reference is a Bengali 400, never a silent move.
 * - listMedia filters: folder / folderless ("none") / tag / q.
 * - usage: posts are found by scanning mediaRefs (org-scoped).
 * - bulk: move per-item results; delete refuses used assets
 *   per-item with the reason, deletes unused ones (bytes + row).
 * - edit: a REAL sharp crop (400×200 PNG → 1:1 → 200×200 PNG),
 *   the source asset untouched, derivedFromId stamped.
 * - cover: no ffmpeg → honest 400 and NO row; a fake extractor
 *   success → derived image asset; cover on an image → 400.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "gte" in (v as any)) {
      return new Date(row[k]) >= (v as any).gte;
    }
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take, orderBy }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") f = [...f].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (orderBy?.createdAt === "asc") f = [...f].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return take ? f.slice(0, take) : f;
    },
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => r.id === where.id);
      const [row] = rows.splice(i, 1);
      return row;
    },
  };
}

function fakePrisma() {
  return {
    mediaFolder: makeTable("folder"),
    mediaAsset: makeTable("asset"),
    socialPost: makeTable("post"),
  };
}

function buildLibrary(prisma: any) {
  const auditRows: any[] = [];
  const audit = { log: async (input: any) => { auditRows.push(input); } } as any;
  const svc = new SocialMediaLibraryService(prisma as any, audit);
  return { svc, auditRows };
}

function seedAsset(prisma: any, over: Record<string, unknown> = {}) {
  const row = {
    id: `asset-${prisma.mediaAsset.rows.length + 1}`,
    organizationId: "org-1", kind: "image", name: "Asset",
    contentType: "image/png", sizeBytes: 100, storageKey: "org-1/social/x.png",
    publicToken: null, origin: "upload", prompt: null,
    folderId: null, tags: [], derivedFromId: null, createdById: "user-1",
    createdAt: new Date(Date.now() + prisma.mediaAsset.rows.length * 1000),
    ...over,
  };
  prisma.mediaAsset.rows.push(row);
  return row;
}

describe("normalizeMediaTags", () => {
  it("trims, dedupes case-insensitively (first form wins), drops empties and >50-char tags, caps at 20", () => {
    expect(normalizeMediaTags([" Sale ", "sale", "EID", "", "  ", "eid"])).toEqual(["Sale", "EID"]);
    expect(normalizeMediaTags(["x".repeat(51), "ok"])).toEqual(["ok"]);
    const many = Array.from({ length: 25 }, (_, i) => `tag${i}`);
    expect(normalizeMediaTags(many)).toHaveLength(20);
    expect(normalizeMediaTags("nope" as any)).toEqual([]);
  });
});

describe("folders", () => {
  it("create/list with assetCount, duplicate name → Conflict, rename, delete removes only the folder row", async () => {
    const prisma = fakePrisma();
    const { svc, auditRows } = buildLibrary(prisma);

    const created: any = await svc.createFolder("org-1", "user-1", { name: "  Eid Campaign  " });
    expect(created.name).toBe("Eid Campaign");
    expect(created.assetCount).toBe(0);
    expect(auditRows.some((r: any) => r.action === "social.media_folder_created")).toBe(true);

    await expect(svc.createFolder("org-1", "user-1", { name: "eid campaign" }))
      .rejects.toThrow("এই নামে একটি ফোল্ডার আগেই আছে।");
    await expect(svc.createFolder("org-1", "user-1", { name: "   " }))
      .rejects.toThrow("ফোল্ডারের নাম দিন।");
    // another org may reuse the name
    const other: any = await svc.createFolder("org-2", "user-9", { name: "eid campaign" });
    expect(other.name).toBe("eid campaign");

    seedAsset(prisma, { folderId: created.id });
    seedAsset(prisma, { folderId: created.id });
    seedAsset(prisma, { folderId: null });
    const folders: any[] = await svc.listFolders("org-1");
    expect(folders).toHaveLength(1);
    expect(folders[0].assetCount).toBe(2);

    const renamed: any = await svc.updateFolder("org-1", "user-1", created.id, { name: "Eid 2026" });
    expect(renamed.name).toBe("Eid 2026");
    expect(renamed.assetCount).toBe(2);

    const del = await svc.deleteFolder("org-1", "user-1", created.id);
    expect(del).toEqual({ deleted: true });
    expect(prisma.mediaFolder.rows.filter((f: any) => f.id === created.id)).toHaveLength(0);
    // the assets themselves were NOT deleted by the service
    expect(prisma.mediaAsset.rows).toHaveLength(3);
  });

  it("foreign folder → 404 on update/delete", async () => {
    const prisma = fakePrisma();
    const { svc } = buildLibrary(prisma);
    const foreign: any = await svc.createFolder("org-2", "user-9", { name: "Theirs" });
    await expect(svc.updateFolder("org-1", "user-1", foreign.id, { name: "X" }))
      .rejects.toMatchObject({ code: "social.mediaFolderNotFoundInThis" });
    await expect(svc.deleteFolder("org-1", "user-1", foreign.id))
      .rejects.toMatchObject({ code: "social.mediaFolderNotFoundInThis" });
    await expect(svc.updateFolder("org-1", "user-1", "missing", { name: "X" }))
      .rejects.toMatchObject({ code: "social.mediaFolderNotFoundInThis" });
  });
});

describe("updateMedia + listMedia", () => {
  it("updates name/folder/tags (normalized), folderId null makes it folderless, foreign folder → Bengali 400", async () => {
    const prisma = fakePrisma();
    const { svc, auditRows } = buildLibrary(prisma);
    const folder: any = await svc.createFolder("org-1", "user-1", { name: "Campaign" });
    const foreign: any = await svc.createFolder("org-2", "user-9", { name: "Foreign" });
    const asset = seedAsset(prisma, { name: "Old" });

    const updated: any = await svc.updateMedia("org-1", "user-1", asset.id, {
      name: "  New Name  ", folderId: folder.id, tags: [" Sale ", "sale", "EID", ""],
    });
    expect(updated.name).toBe("New Name");
    expect(updated.folderId).toBe(folder.id);
    expect(updated.tags).toEqual(["Sale", "EID"]);
    expect(auditRows.some((r: any) => r.action === "social.media_updated")).toBe(true);

    const folderless: any = await svc.updateMedia("org-1", "user-1", asset.id, { folderId: null });
    expect(folderless.folderId).toBeNull();

    await expect(svc.updateMedia("org-1", "user-1", asset.id, { folderId: foreign.id }))
      .rejects.toThrow("ফোল্ডারটি পাওয়া যায়নি");
    await expect(svc.updateMedia("org-1", "user-1", asset.id, { name: "   " }))
      .rejects.toThrow("মিডিয়ার নাম খালি রাখা যাবে না।");
    await expect(svc.updateMedia("org-1", "user-1", "missing", { name: "X" }))
      .rejects.toMatchObject({ code: "social.mediaAssetNotFoundInThis" });
  });

  it("listMedia filters by folder, folderless, tag (case-insensitive) and name query", async () => {
    const prisma = fakePrisma();
    const { svc } = buildLibrary(prisma);
    seedAsset(prisma, { id: "a1", name: "Red Banner", folderId: "f1", tags: ["Sale"] });
    seedAsset(prisma, { id: "a2", name: "Blue Poster", folderId: null, tags: ["eid"] });
    seedAsset(prisma, { id: "a3", name: "red thumb", folderId: "f1", tags: [] });

    expect((await svc.listMedia("org-1", {})).map((a: any) => a.id).sort()).toEqual(["a1", "a2", "a3"]);
    expect((await svc.listMedia("org-1", { folderId: "f1" })).map((a: any) => a.id).sort()).toEqual(["a1", "a3"]);
    expect((await svc.listMedia("org-1", { folderId: "none" })).map((a: any) => a.id)).toEqual(["a2"]);
    expect((await svc.listMedia("org-1", { tag: "sale" })).map((a: any) => a.id)).toEqual(["a1"]);
    expect((await svc.listMedia("org-1", { tag: "EID" })).map((a: any) => a.id)).toEqual(["a2"]);
    expect((await svc.listMedia("org-1", { q: "RED" })).map((a: any) => a.id).sort()).toEqual(["a1", "a3"]);
    const one: any = (await svc.listMedia("org-1", { folderId: "f1" }))[0];
    expect(one).toHaveProperty("folderId");
    expect(one).toHaveProperty("tags");
    expect(one).toHaveProperty("derivedFromId");
  });
});

describe("usage + bulk", () => {
  function seedUsage(prisma: any) {
    const a1 = seedAsset(prisma, { id: "used-1", name: "Used" });
    const a2 = seedAsset(prisma, { id: "free-1", name: "Free" });
    prisma.socialPost.rows.push(
      { id: "p1", organizationId: "org-1", status: "published", caption: "one", socialAccountId: "acc-1", mediaRefs: [{ assetId: "used-1", kind: "image" }], createdAt: new Date() },
      { id: "p2", organizationId: "org-1", status: "draft", caption: "two", socialAccountId: "acc-1", mediaRefs: [{ assetId: "used-1", kind: "image" }, { assetId: "free-1", kind: "image" }], createdAt: new Date() },
      { id: "p3", organizationId: "org-2", status: "published", caption: "other org", socialAccountId: "acc-9", mediaRefs: [{ assetId: "used-1", kind: "image" }], createdAt: new Date() },
    );
    return { a1, a2 };
  }

  it("usage counts only this org's posts (any status)", async () => {
    const prisma = fakePrisma();
    const { svc } = buildLibrary(prisma);
    seedUsage(prisma);
    const usage: any = await svc.getUsage("org-1", "used-1");
    expect(usage.assetId).toBe("used-1");
    expect(usage.count).toBe(2); // p3 belongs to another org
    expect(usage.posts.map((p: any) => p.id).sort()).toEqual(["p1", "p2"]);
    expect(usage.posts[0]).toHaveProperty("status");
    expect(usage.posts[0]).toHaveProperty("caption");
  });

  it("bulk move: per-item results, unknown id fails alone, null target makes folderless", async () => {
    const prisma = fakePrisma();
    const { svc } = buildLibrary(prisma);
    const folder: any = await svc.createFolder("org-1", "user-1", { name: "Target" });
    const a = seedAsset(prisma, { id: "m1" });
    const b = seedAsset(prisma, { id: "m2", folderId: folder.id });

    const res: any = await svc.bulkMedia("org-1", "user-1", { ids: ["m1", "missing"], action: "move", folderId: folder.id });
    expect(res.results).toEqual([
      { id: "m1", ok: true },
      { id: "missing", ok: false, error: "মিডিয়াটি পাওয়া যায়নি" },
    ]);
    expect(prisma.mediaAsset.rows.find((r: any) => r.id === "m1").folderId).toBe(folder.id);

    const res2: any = await svc.bulkMedia("org-1", "user-1", { ids: ["m2"], action: "move", folderId: null });
    expect(res2.results).toEqual([{ id: "m2", ok: true }]);
    expect(prisma.mediaAsset.rows.find((r: any) => r.id === "m2").folderId).toBeNull();
    expect(a.id).toBe("m1");
    expect(b.id).toBe("m2");
  });

  it("bulk delete: unused asset deleted (bytes + row), used asset refused per-item with the reason, batch continues", async () => {
    const prisma = fakePrisma();
    const { svc } = buildLibrary(prisma);
    seedUsage(prisma);
    const unused = seedAsset(prisma, { id: "unused-1", storageKey: "org-1/social/unused.png" });
    const deletedKeys: string[] = [];
    svc.deleteBytes = async (key: string) => { deletedKeys.push(key); };

    const res: any = await svc.bulkMedia("org-1", "user-1", { ids: ["used-1", "unused-1"], action: "delete" });
    expect(res.results[0].id).toBe("used-1");
    expect(res.results[0].ok).toBe(false);
    expect(res.results[0].error).toContain("post-এ ব্যবহৃত");
    expect(res.results[1]).toEqual({ id: "unused-1", ok: true });
    expect(prisma.mediaAsset.rows.some((r: any) => r.id === "used-1")).toBe(true);
    expect(prisma.mediaAsset.rows.some((r: any) => r.id === unused.id)).toBe(false);
    expect(deletedKeys).toEqual(["org-1/social/unused.png"]);

    await expect(svc.bulkMedia("org-1", "user-1", { ids: [], action: "delete" }))
      .rejects.toThrow("কোনো মিডিয়া নির্বাচন করা হয়নি।");
  });
});

describe("edit + cover (seams)", () => {
  async function pngFixture(width: number, height: number): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();
  }

  function wireStore(svc: SocialMediaLibraryService, store: Map<string, Buffer>) {
    svc.readBytes = async (key: string) => store.get(key) ?? null;
    svc.writeBytes = async (key: string, bytes: Buffer) => { store.set(key, bytes); };
  }

  it("editAsset: real 400×200 PNG → 1:1 derived PNG is 200×200, source untouched, folder/tags copied", async () => {
    const prisma = fakePrisma();
    const { svc, auditRows } = buildLibrary(prisma);
    const source = seedAsset(prisma, {
      id: "img-1", name: "Banner", storageKey: "org-1/social/img-1.png",
      folderId: "f1", tags: ["Red"],
    });
    const store = new Map<string, Buffer>([[source.storageKey, await pngFixture(400, 200)]]);
    wireStore(svc, store);

    const derived: any = await svc.editAsset("org-1", "user-1", "img-1", { aspect: "1:1" });
    expect(derived.kind).toBe("image");
    expect(derived.name).toBe("Banner (1:1)");
    expect(derived.derivedFromId).toBe("img-1");
    expect(derived.folderId).toBe("f1");
    expect(derived.tags).toEqual(["Red"]);
    expect(derived.contentType).toBe("image/png");

    const outRow = prisma.mediaAsset.rows.find((r: any) => r.id === derived.id);
    const outBytes = store.get(outRow.storageKey);
    expect(outBytes).toBeTruthy();
    const meta = await sharp(outBytes!).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(200);

    const sourceAfter = prisma.mediaAsset.rows.find((r: any) => r.id === "img-1");
    expect(sourceAfter.name).toBe("Banner");
    expect(prisma.mediaAsset.rows).toHaveLength(2);
    expect(auditRows.some((r: any) => r.action === "social.media_edited")).toBe(true);
  });

  it("editAsset on a video → Bengali 400", async () => {
    const prisma = fakePrisma();
    const { svc } = buildLibrary(prisma);
    seedAsset(prisma, { id: "vid-1", kind: "video", contentType: "video/mp4" });
    await expect(svc.editAsset("org-1", "user-1", "vid-1", { aspect: "1:1" }))
      .rejects.toThrow("শুধু ছবির aspect ratio বদলানো যায় — এটি একটি ভিডিও ফাইল।");
    expect(prisma.mediaAsset.rows).toHaveLength(1);
  });

  it("cover: ffmpeg unavailable → Bengali 400 and NO asset row; fake extractor success → derived image; cover on image → 400", async () => {
    const prisma = fakePrisma();
    const { svc, auditRows } = buildLibrary(prisma);
    const video = seedAsset(prisma, {
      id: "vid-1", kind: "video", name: "Clip", contentType: "video/mp4",
      storageKey: "org-1/social/vid-1.mp4", folderId: "f1",
    });
    seedAsset(prisma, { id: "img-1", kind: "image" });
    const store = new Map<string, Buffer>([[video.storageKey, Buffer.from("fake-video-bytes")]]);
    wireStore(svc, store);

    svc.ffmpegAvailable = async () => false;
    await expect(svc.coverFromVideo("org-1", "user-1", "vid-1"))
      .rejects.toThrow("এই সার্ভারে ffmpeg পাওয়া যায়নি");
    expect(prisma.mediaAsset.rows).toHaveLength(2); // nothing was created

    svc.ffmpegAvailable = async () => true;
    svc.frameExtractor = async () => pngFixture(64, 64);
    const cover: any = await svc.coverFromVideo("org-1", "user-1", "vid-1", 2);
    expect(cover.kind).toBe("image");
    expect(cover.name).toBe("Clip (Cover)");
    expect(cover.derivedFromId).toBe("vid-1");
    expect(cover.folderId).toBe("f1");
    expect(cover.contentType).toBe("image/png");
    expect(auditRows.some((r: any) => r.action === "social.media_cover_created")).toBe(true);

    await expect(svc.coverFromVideo("org-1", "user-1", "img-1"))
      .rejects.toThrow("শুধু ভিডিও থেকেই cover তোলা যায়");
  });
});
