import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { KnowledgeService, resolveKnowledgeVisibility } from "./knowledge.service";
import { CreateKnowledgeDocDto, IngestKnowledgeFileDto, UpdateKnowledgeDocDto } from "./knowledge.dto";

/**
 * SA-B1 (Smart AI Phase 0, P3) — KnowledgeDocument visibility:
 * schema default public; kind "note" without an explicit value
 * defaults to internal AT THE SERVICE layer; the closed set is
 * validated by the DTOs (anything else is a 400 upstream).
 */

function fakePrisma() {
  const docs: any[] = [];
  let seq = 0;
  const matches = (row: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => row[k] === v);
  const prisma: any = {
    docs,
    knowledgeDocument: {
      create: async ({ data }: any) => {
        // Emulates the Prisma schema default for rows created
        // without an explicit visibility.
        const row = { id: `doc-${++seq}`, createdAt: new Date(), updatedAt: new Date(), visibility: "public", ...data };
        docs.push(row);
        return row;
      },
      findMany: async ({ where }: any) => docs.filter((d) => matches(d, where)),
      findFirst: async ({ where }: any) => docs.find((d) => matches(d, where)) ?? null,
      update: async ({ where, data }: any) => {
        const row = docs.find((d) => d.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
  };
  return prisma;
}

function makeService() {
  const prisma = fakePrisma();
  const entries: any[] = [];
  const audit: any = { log: async (e: any) => { entries.push(e); } };
  return { service: new KnowledgeService(prisma as any, audit), prisma, entries };
}

describe("SA-B1 resolveKnowledgeVisibility (pure rule)", () => {
  it("explicit values always win", () => {
    expect(resolveKnowledgeVisibility("note", "public")).toBe("public");
    expect(resolveKnowledgeVisibility("faq", "internal")).toBe("internal");
  });
  it("omitted: note => internal, everything else => public", () => {
    expect(resolveKnowledgeVisibility("note", undefined)).toBe("internal");
    expect(resolveKnowledgeVisibility("faq", undefined)).toBe("public");
    expect(resolveKnowledgeVisibility("file_doc", undefined)).toBe("public");
    expect(resolveKnowledgeVisibility(undefined, undefined)).toBe("public");
  });
  it("an unrecognised explicit value falls back to the kind rule (DTO rejects it first in production)", () => {
    expect(resolveKnowledgeVisibility("faq", "secret")).toBe("public");
  });
});

describe("SA-B1 KnowledgeService visibility", () => {
  it("createDoc: faq without visibility => public (schema-era default)", async () => {
    const { service } = makeService();
    const doc = await service.createDoc("org-a", "u1", { title: "Delivery FAQ", content: "Delivery takes two days" } as any);
    expect(doc.visibility).toBe("public");
    expect(doc.kind).toBe("faq");
  });

  it("createDoc: kind note without visibility => internal", async () => {
    const { service } = makeService();
    const doc = await service.createDoc("org-a", "u1", { title: "Internal note", content: "Supplier margin talk", kind: "note" } as any);
    expect(doc.visibility).toBe("internal");
  });

  it("createDoc: kind note WITH explicit public stays public", async () => {
    const { service } = makeService();
    const doc = await service.createDoc("org-a", "u1", { title: "Public note", content: "Store holiday hours", kind: "note", visibility: "public" } as any);
    expect(doc.visibility).toBe("public");
  });

  it("createDoc: listDocs responses carry visibility", async () => {
    const { service } = makeService();
    await service.createDoc("org-a", "u1", { title: "Internal note", content: "Supplier margin talk", kind: "note" } as any);
    const docs = await service.listDocs("org-a");
    expect(docs).toHaveLength(1);
    expect(docs[0].visibility).toBe("internal");
  });

  it("updateDoc: reclassify public -> internal and back, audited; unknown doc 404s", async () => {
    const { service, entries } = makeService();
    const doc = await service.createDoc("org-a", "u1", { title: "Delivery FAQ", content: "Delivery takes two days" } as any);
    const updated = await service.updateDoc("org-a", "u1", doc.id, { visibility: "internal" });
    expect(updated.visibility).toBe("internal");
    expect(entries.some((e) => e.action === "knowledge.update" && e.entityId === doc.id)).toBe(true);
    const back = await service.updateDoc("org-a", "u1", doc.id, { visibility: "public" });
    expect(back.visibility).toBe("public");
    await expect(service.updateDoc("org-a", "u1", "missing", { visibility: "internal" })).rejects.toThrow(/not found/i);
    // Cross-org: org B cannot touch org A's document.
    await expect(service.updateDoc("org-b", "u2", doc.id, { visibility: "internal" })).rejects.toThrow(/not found/i);
  });

  it("upload path (multipart): uploaded chunks are kind note => internal by the same rule", async () => {
    const { service, prisma } = makeService();
    await service.uploadDocFile("org-a", "u1", { originalname: "guide.txt", buffer: Buffer.from("Warranty guide text for customers") });
    expect(prisma.docs).toHaveLength(1);
    expect(prisma.docs[0].kind).toBe("note");
    expect(prisma.docs[0].visibility).toBe("internal");
  });

  it("ingest path (JSON): default file_doc => public; kind note => internal; explicit wins", async () => {
    const { service, prisma } = makeService();
    const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64");
    await service.ingestFile("org-a", "u1", { filename: "a.txt", dataBase64: b64("plain reference text here") } as any);
    await service.ingestFile("org-a", "u1", { filename: "b.txt", dataBase64: b64("working note text here"), kind: "note" } as any);
    await service.ingestFile("org-a", "u1", { filename: "c.txt", dataBase64: b64("note but public text"), kind: "note", visibility: "public" } as any);
    expect(prisma.docs.map((d: any) => d.visibility)).toEqual(["public", "internal", "public"]);
  });
});

describe("SA-B1 visibility DTO validation (closed set => 400 upstream)", () => {
  it("CreateKnowledgeDocDto rejects a value outside public|internal", async () => {
    const dto = plainToInstance(CreateKnowledgeDocDto, { title: "Ok title", content: "Ok content", visibility: "secret" });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "visibility")).toBe(true);
  });
  it("CreateKnowledgeDocDto accepts public, internal and omitted", async () => {
    for (const v of ["public", "internal", undefined]) {
      const dto = plainToInstance(CreateKnowledgeDocDto, { title: "Ok title", content: "Ok content", ...(v ? { visibility: v } : {}) });
      expect(await validate(dto)).toHaveLength(0);
    }
  });
  it("UpdateKnowledgeDocDto + IngestKnowledgeFileDto enforce the same closed set", async () => {
    const bad = plainToInstance(UpdateKnowledgeDocDto, { visibility: "everyone" });
    expect((await validate(bad)).some((e) => e.property === "visibility")).toBe(true);
    const badIngest = plainToInstance(IngestKnowledgeFileDto, { filename: "a.txt", dataBase64: "eA==", visibility: "world" });
    expect((await validate(badIngest)).some((e) => e.property === "visibility")).toBe(true);
  });
});
