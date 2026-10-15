import { BadRequestException } from "@nestjs/common";
import { strToU8, zipSync } from "fflate";
import { KnowledgeService } from "./knowledge.service";
import {
  MAX_FILE_BYTES,
  SCANNED_PDF_MESSAGE,
  baseTitleFromFilename,
  chunkKnowledgeText,
  extractKnowledgeText,
} from "./extract";
import { MulterErrorFilter } from "./multer-error.filter";
import { MulterError } from "multer";
import { matchKnowledge } from "../inbox/business-brain";

/** Minimal but REAL one-page PDF with a genuine text layer (or, when
 * text is null, a content stream with no text-showing operator). */
function buildPdf(text: string | null): Buffer {
  const stream = text === null
    ? "BT /F1 24 Tf ET"
    : `BT /F1 24 Tf 72 720 Td (${text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")}) Tj ET`;
  const objs = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = [0];
  objs.forEach((body, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xrefAt = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

function buildDocx(documentXml: string): Buffer {
  return Buffer.from(zipSync({ "word/document.xml": strToU8(documentXml) }));
}

const DOCX_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>First paragraph &amp; more</w:t></w:r></w:p>
<w:p><w:r><w:t>Second</w:t></w:r><w:r><w:t xml:space="preserve"> line &#8212; done</w:t></w:r></w:p>
</w:body></w:document>`;

function fakePrisma() {
  const docs: any[] = [];
  let seq = 0;
  const prisma: any = {
    docs,
    knowledgeDocument: {
      create: async ({ data }: any) => {
        const row = { id: `doc-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        docs.push(row);
        return row;
      },
      findMany: async ({ where }: any) =>
        docs.filter((d) => d.organizationId === where.organizationId && (!where.kind || d.kind === where.kind)),
    },
  };
  return prisma;
}

function fakeAudit() {
  const entries: any[] = [];
  return { entries, log: async (e: any) => { entries.push(e); } };
}

function makeService() {
  const prisma = fakePrisma();
  const audit = fakeAudit();
  const service = new KnowledgeService(prisma as any, audit as any);
  return { service, prisma, audit };
}

describe("CX9 extractKnowledgeText", () => {
  it("txt extraction is verbatim (incl. Bengali UTF-8)", async () => {
    const text = "ডেলিভারি চার্জ ৬০ টাকা\nদুই দিনে পৌঁছাবে";
    await expect(extractKnowledgeText("notes.txt", Buffer.from(text, "utf-8"))).resolves.toBe(text);
  });

  it("md extraction is verbatim", async () => {
    const md = "# শিরোনাম\n\n- পয়েন্ট এক\n- পয়েন্ট দুই";
    await expect(extractKnowledgeText("guide.md", Buffer.from(md, "utf-8"))).resolves.toBe(md);
  });

  it("rejects undecodable / binary junk renamed .txt", async () => {
    await expect(extractKnowledgeText("junk.txt", Buffer.from([0xff, 0xfe, 0x00, 0x41, 0x80, 0x81])))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(extractKnowledgeText("nul.txt", Buffer.from("abc\u0000def", "utf-8")))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects unsupported extensions", async () => {
    await expect(extractKnowledgeText("photo.png", Buffer.from("whatever")))
      .rejects.toThrow(/সমর্থিত নয়/);
    await expect(extractKnowledgeText("noextension", Buffer.from("whatever")))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it("docx fixture (built in-spec) extracts paragraphs + decoded entities", async () => {
    const text = await extractKnowledgeText("guide.docx", buildDocx(DOCX_XML));
    expect(text).toBe("First paragraph & more\nSecond line — done");
  });

  it("rejects a .docx that is not a zip (magic mismatch)", async () => {
    await expect(extractKnowledgeText("fake.docx", Buffer.from("just plain text")))
      .rejects.toThrow(/মিলছে না/);
  });

  it("rejects a zip without word/document.xml as not-a-docx", async () => {
    const notDocx = Buffer.from(zipSync({ "readme.txt": strToU8("hello") }));
    await expect(extractKnowledgeText("fake.docx", notDocx))
      .rejects.toThrow(/word\/document\.xml/);
  });

  it("PDF with a real text layer extracts real text via the real parser", async () => {
    const text = await extractKnowledgeText("delivery.pdf", buildPdf("Delivery charge sixty taka"));
    expect(text).toContain("Delivery charge sixty taka");
    expect(text).not.toContain("of 1 --"); // parser page markers are stripped
  });

  it("rejects a fake PDF (plain text renamed .pdf) by magic bytes", async () => {
    await expect(extractKnowledgeText("fake.pdf", Buffer.from("Delivery charge sixty taka")))
      .rejects.toThrow(/মিলছে না/);
  });

  it("PDF with no text layer gives the exact scanned-PDF error", async () => {
    await expect(extractKnowledgeText("scan.pdf", buildPdf(null)))
      .rejects.toThrow(SCANNED_PDF_MESSAGE);
  });

  it("rejects extracted text over the 200,000-char ceiling", async () => {
    await expect(extractKnowledgeText("big.txt", Buffer.from("a".repeat(200_001))))
      .rejects.toThrow(/২০০,০০০/);
  });

  it("rejects an empty text file", async () => {
    await expect(extractKnowledgeText("empty.txt", Buffer.from("   \n  ")))
      .rejects.toThrow(/কোনো লেখা পাওয়া যায়নি/);
  });
});

describe("CX9 chunkKnowledgeText", () => {
  it("keeps short text as a single chunk", () => {
    expect(chunkKnowledgeText("hello world")).toEqual(["hello world"]);
  });

  it("splits long text at paragraph boundaries, each chunk ≤ 8000", () => {
    const para = "word ".repeat(900).trim(); // ~4499 chars
    const text = [para, para, para, para].join("\n\n");
    const chunks = chunkKnowledgeText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(8000);
    expect(chunks.join(" ").split("word").length - 1).toBe(3600);
  });

  it("splits a giant single paragraph at sentence/space boundaries", () => {
    const sentence = "This is a fairly long sentence about delivery policy. ";
    const text = sentence.repeat(300).trim(); // ~16k chars, no paragraph breaks
    const chunks = chunkKnowledgeText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(8000);
  });
});

describe("CX9 KnowledgeService.uploadDocFile", () => {
  it("txt upload creates one note doc with source + one upload audit entry", async () => {
    const { service, prisma, audit } = makeService();
    const res = await service.uploadDocFile("org-a", "user-1", {
      originalname: "faq-list.md", buffer: Buffer.from("# FAQ\n\nCash on delivery available"),
    });
    expect(res).toEqual({ documentsCreated: 1, charsExtracted: 33, title: "faq-list" });
    expect(prisma.docs).toHaveLength(1);
    expect(prisma.docs[0]).toMatchObject({
      organizationId: "org-a", kind: "note", title: "faq-list", source: "file:faq-list.md",
    });
    const uploads = audit.entries.filter((e: any) => e.action === "knowledge.upload");
    expect(uploads).toHaveLength(1);
    expect(uploads[0].metadata).toMatchObject({ filename: "faq-list.md", chunks: 1 });
    expect(audit.entries.filter((e: any) => e.action === "knowledge.create")).toHaveLength(0);
  });

  it("long upload creates multiple chunks with suffixed titles, each ≤ 8000", async () => {
    const { service, prisma, audit } = makeService();
    const para = "warranty policy covers manufacturing defects for one year. ".repeat(60).trim();
    const text = [para, para, para, para, para].join("\n\n"); // ~17k chars
    const res = await service.uploadDocFile("org-a", "user-1", {
      originalname: "policy-book.txt", buffer: Buffer.from(text),
    });
    expect(res.documentsCreated).toBeGreaterThan(1);
    expect(prisma.docs).toHaveLength(res.documentsCreated);
    prisma.docs.forEach((d: any, i: number) => {
      expect(d.content.length).toBeLessThanOrEqual(8000);
      expect(d.title).toBe(`policy-book (অংশ ${i + 1})`);
      expect(d.source).toBe("file:policy-book.txt");
    });
    expect(audit.entries.filter((e: any) => e.action === "knowledge.upload")).toHaveLength(1);
  });

  it("scanned PDF saves ZERO documents", async () => {
    const { service, prisma } = makeService();
    await expect(service.uploadDocFile("org-a", "user-1", {
      originalname: "scan.pdf", buffer: buildPdf(null),
    })).rejects.toThrow(SCANNED_PDF_MESSAGE);
    expect(prisma.docs).toHaveLength(0);
  });

  it("missing file is an honest 400, nothing saved", async () => {
    const { service, prisma } = makeService();
    await expect(service.uploadDocFile("org-a", "user-1", undefined))
      .rejects.toThrow(/কোনো ফাইল পাওয়া যায়নি/);
    expect(prisma.docs).toHaveLength(0);
  });

  it("uploaded PDF chunk is retrievable by the REAL matchKnowledge", async () => {
    const { service, prisma } = makeService();
    const filler = "alpha beta gamma delta epsilon zeta eta theta. ".repeat(220).trim();
    const text = `${filler}\n\nOur warranty policy gives a one year replacement guarantee.`;
    await service.uploadDocFile("org-a", "user-1", {
      originalname: "guide.txt", buffer: Buffer.from(text),
    });
    expect(prisma.docs.length).toBeGreaterThan(1);
    const matches = matchKnowledge("warranty policy", prisma.docs);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].doc.source).toBe("file:guide.txt");
    expect(matches[0].doc.content).toContain("warranty policy");
  });

  it("tenant isolation: org B sees none of org A's uploaded docs", async () => {
    const { service } = makeService();
    await service.uploadDocFile("org-a", "user-1", {
      originalname: "a.txt", buffer: Buffer.from("Org A secret delivery info"),
    });
    expect(await service.listDocs("org-b")).toHaveLength(0);
    const aDocs = await service.listDocs("org-a");
    expect(aDocs).toHaveLength(1);
    expect(aDocs[0].source).toBe("file:a.txt");
    // Org B's own upload is unaffected and separate.
    await service.uploadDocFile("org-b", "user-2", {
      originalname: "b.txt", buffer: Buffer.from("Org B own info"),
    });
    expect(await service.listDocs("org-a")).toHaveLength(1);
    expect(await service.listDocs("org-b")).toHaveLength(1);
  });
});

describe("CX9 limits + helpers", () => {
  it("file-size limit is 10MB and the multer filter turns overflow into a Bengali 400", () => {
    expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
    const filter = new MulterErrorFilter();
    expect(() => filter.catch(new MulterError("LIMIT_FILE_SIZE"), null as any))
      .toThrow(/সর্বোচ্চ ১০MB/);
    try {
      filter.catch(new MulterError("LIMIT_FILE_SIZE"), null as any);
      fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
    }
  });

  it("baseTitleFromFilename strips the extension and path", () => {
    expect(baseTitleFromFilename("delivery-guide.pdf")).toBe("delivery-guide");
    expect(baseTitleFromFilename("folder/sub/faq.md")).toBe("faq");
  });
});
