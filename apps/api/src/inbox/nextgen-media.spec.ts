/**
 * Inbox Next-Gen P1 — uploaded media (drag-drop / paste / voice).
 * Covers the magic-byte sniffer and InboxService.sendMediaReply:
 * the webchat path (row = delivery, no platform call), the failure
 * path (platform-less channel → row failed + verbatim error), the
 * size cap and the unknown-format rejection.
 */
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.MEDIA_LOCAL_DIR = mkdtempSync(join(tmpdir(), "nextgen-media-"));

import { BadRequestException } from "@nestjs/common";
import { InboxService, MEDIA_UPLOAD_MAX_BYTES } from "./inbox.service";
import { detectMediaKind } from "./media-sniff";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

const llmStub = { getProvider: () => new DevTemplateProvider() } as any;
const auditStub = { log: async () => undefined } as any;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const PDF = Buffer.from("%PDF-1.4 fake body", "utf8");
const EBML = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(16, 2)]);
const FTYP = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypM4A ", "ascii"), Buffer.alloc(8)]);
const WAV = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.alloc(4), Buffer.from("WAVE", "ascii"), Buffer.alloc(8)]);
const MP3 = Buffer.concat([Buffer.from("ID3", "ascii"), Buffer.alloc(16, 3)]);

describe("detectMediaKind (magic bytes, declared type untrusted)", () => {
  it("detects PNG even when the browser claims text/plain", () => {
    expect(detectMediaKind(PNG, "text/plain")).toEqual({ kind: "image", contentType: "image/png" });
  });
  it("rejects a text file spoofed as image/png", () => {
    expect(detectMediaKind(Buffer.from("just some text"), "image/png")).toBeNull();
  });
  it("detects PDF as a document", () => {
    expect(detectMediaKind(PDF, "application/pdf")).toEqual({ kind: "document", contentType: "application/pdf" });
  });
  it("uses the declared container to split EBML audio vs video", () => {
    expect(detectMediaKind(EBML, "audio/webm")?.kind).toBe("audio");
    expect(detectMediaKind(EBML, "video/webm")?.kind).toBe("video");
  });
  it("treats an ftyp audio container as audio", () => {
    expect(detectMediaKind(FTYP, "audio/mp4")).toEqual({ kind: "audio", contentType: "audio/mp4" });
  });
  it("detects WAV and MP3 audio", () => {
    expect(detectMediaKind(WAV, undefined)?.contentType).toBe("audio/wav");
    expect(detectMediaKind(MP3, undefined)?.contentType).toBe("audio/mpeg");
  });
  it("returns null for empty and unknown buffers", () => {
    expect(detectMediaKind(Buffer.alloc(0), "image/png")).toBeNull();
    expect(detectMediaKind(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]), "image/png")).toBeNull();
  });
});

function fakePrisma() {
  const convRows: any[] = [
    { id: "conv-web", organizationId: "org-1", channel: "webchat", status: "open", firstResponseAt: null, autoReplyPaused: false, pipelineStage: "new", integrationId: null, externalContactId: "visitor-1" },
    { id: "conv-tg", organizationId: "org-1", channel: "telegram", status: "open", firstResponseAt: null, autoReplyPaused: false, pipelineStage: "new", integrationId: null, externalContactId: "4242" },
  ];
  const msgRows: any[] = [];
  let seq = 0;
  const prisma: any = {
    channelConversation: {
      findFirst: async ({ where }: any) => convRows.find((c) => c.id === where.id && c.organizationId === where.organizationId) ?? null,
      update: async ({ where, data }: any) => { const row = convRows.find((c) => c.id === where.id); Object.assign(row, data); return row; },
    },
    channelMessage: {
      create: async ({ data }: any) => { const row = { id: `msg-${++seq}`, createdAt: new Date(), ...data }; msgRows.push(row); return row; },
      update: async ({ where, data }: any) => { const row = msgRows.find((m) => m.id === where.id); Object.assign(row, data); return row; },
    },
    integration: { findFirst: async () => null, findUnique: async () => null },
  };
  return { prisma, convRows, msgRows };
}

describe("InboxService.sendMediaReply", () => {
  it("webchat: persists bytes, marks the row sent with a web- id, updates the conversation", async () => {
    const { prisma, convRows, msgRows } = fakePrisma();
    const svc = new InboxService(prisma as any, auditStub, llmStub);
    const sent = await svc.sendMediaReply("org-1", "user-1", "conv-web", {
      dataBase64: PNG.toString("base64"), fileName: "photo.png", contentType: "image/png", caption: "এই ছবিটা দেখুন",
    });
    expect(sent.status).toBe("sent");
    expect(sent.externalId).toMatch(/^web-/);
    expect(sent.type).toBe("image");
    expect(sent.mediaStorageKey).toBeTruthy();
    expect(sent.mediaContentType).toBe("image/png");
    expect(msgRows).toHaveLength(1);
    expect(convRows[0].lastMessagePreview).toBe("এই ছবিটা দেখুন");
    expect(convRows[0].firstResponseAt).toBeInstanceOf(Date);
    expect(convRows[0].pipelineStage).toBe("talking");
  });

  it("voice note without a caption previews as [ভয়েস/অডিও] and stores the file name as content", async () => {
    const { prisma, convRows } = fakePrisma();
    const svc = new InboxService(prisma as any, auditStub, llmStub);
    const sent = await svc.sendMediaReply("org-1", "user-1", "conv-web", {
      dataBase64: WAV.toString("base64"), fileName: "voice-1.wav", contentType: "audio/wav",
    });
    expect(sent.type).toBe("audio");
    expect(sent.content).toBe("voice-1.wav");
    expect(convRows[0].lastMessagePreview).toBe("[ভয়েস/অডিও]");
  });

  it("telegram without an integration: row is marked failed and the platform error is thrown verbatim", async () => {
    const { prisma, msgRows } = fakePrisma();
    const svc = new InboxService(prisma as any, auditStub, llmStub);
    await expect(svc.sendMediaReply("org-1", "user-1", "conv-tg", {
      dataBase64: PNG.toString("base64"), fileName: "photo.png", contentType: "image/png",
    })).rejects.toThrow(/Media was NOT sent: No connected telegram integration for this organization/);
    expect(msgRows).toHaveLength(1);
    expect(msgRows[0].status).toBe("failed");
    expect(msgRows[0].error).toMatch(/No connected telegram integration for this organization/);
  });

  it("rejects files over the decoded cap before creating any row", async () => {
    const { prisma, msgRows } = fakePrisma();
    const svc = new InboxService(prisma as any, auditStub, llmStub);
    const big = Buffer.alloc(MEDIA_UPLOAD_MAX_BYTES + 1, 7);
    await expect(svc.sendMediaReply("org-1", "user-1", "conv-web", {
      dataBase64: big.toString("base64"), fileName: "big.png", contentType: "image/png",
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(msgRows).toHaveLength(0);
  });

  it("rejects unknown formats with the Bengali format error", async () => {
    const { prisma, msgRows } = fakePrisma();
    const svc = new InboxService(prisma as any, auditStub, llmStub);
    await expect(svc.sendMediaReply("org-1", "user-1", "conv-web", {
      dataBase64: Buffer.from("MZ executable bytes here").toString("base64"), fileName: "app.exe", contentType: "application/octet-stream",
    })).rejects.toThrow(/ফরম্যাট/);
    expect(msgRows).toHaveLength(0);
  });
});
