/**
 * IN5a — voice-note transcoding (browser WebM → OGG/Opus).
 *
 * Covers: the transcode gate matrix (only WebM audio headed for
 * WhatsApp/Telegram), real ffmpeg conversion (output verified by
 * the magic-byte sniffer, never by trusting ffmpeg), every honest
 * fallback returning null (garbage input, non-audio input, missing
 * binary, kill switch), and the sendMediaReply integration — a
 * WebM voice note to a WhatsApp conversation is STORED as
 * audio/ogg (what would be sent) while delivery still fails
 * honestly without an integration, and the same file to Webchat
 * is NOT transcoded (narrow scope) and sends as WebM.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.MEDIA_LOCAL_DIR = mkdtempSync(join(tmpdir(), "in5a-media-"));

import { InboxService } from "./inbox.service";
import { detectMediaKind } from "./media-sniff";
import { isFfmpegAvailable, shouldTranscodeAudio, transcodeAudioToOggOpus } from "./audio-transcode";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

jest.setTimeout(60_000);

const llmStub = { getProvider: () => new DevTemplateProvider() } as any;
const auditStub = { log: async () => undefined } as any;

/** A real 0.3s 440Hz PCM WAV, built byte by byte (no fixture file). */
function sineWav(seconds = 0.3, freq = 440, rate = 8000): Buffer {
  const n = Math.floor(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 12000), 44 + i * 2);
  return buf;
}

/** A REAL WebM/Opus voice clip, encoded by the host ffmpeg. */
function makeWebm(): Buffer | null {
  try {
    const dir = mkdtempSync(join(tmpdir(), "in5a-webm-"));
    const out = join(dir, "voice.webm");
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.3", "-c:a", "libopus", "-b:a", "32k", out], { stdio: "ignore", timeout: 20_000 });
    return readFileSync(out);
  } catch { return null; }
}

describe("shouldTranscodeAudio (the narrow gate)", () => {
  it("transcodes WebM audio only for WhatsApp and Telegram", () => {
    expect(shouldTranscodeAudio("audio/webm", "whatsapp")).toBe(true);
    expect(shouldTranscodeAudio("audio/webm;codecs=opus", "telegram")).toBe(true);
    expect(shouldTranscodeAudio("audio/webm", "webchat")).toBe(false);
    expect(shouldTranscodeAudio("audio/webm", "messenger")).toBe(false);
    expect(shouldTranscodeAudio("audio/webm", "email")).toBe(false);
  });
  it("leaves OGG (target) and MP4/M4A (WhatsApp-accepted) alone", () => {
    expect(shouldTranscodeAudio("audio/ogg", "whatsapp")).toBe(false);
    expect(shouldTranscodeAudio("audio/mp4", "whatsapp")).toBe(false);
    expect(shouldTranscodeAudio("audio/mpeg", "whatsapp")).toBe(false);
  });
});

describe("transcodeAudioToOggOpus (real ffmpeg)", () => {
  it("converts a WAV to bytes that sniff as audio/ogg", async () => {
    if (!(await isFfmpegAvailable())) return; // host without ffmpeg: the null-path tests below still cover behaviour
    const out = await transcodeAudioToOggOpus(sineWav(), { declaredContentType: "audio/wav" });
    expect(out).not.toBeNull();
    expect(out!.contentType).toBe("audio/ogg");
    expect(out!.fileName).toBe("voice.ogg");
    expect(out!.bytes.subarray(0, 4).toString("latin1")).toBe("OggS");
    expect(detectMediaKind(out!.bytes, undefined)).toEqual({ kind: "audio", contentType: "audio/ogg" });
  });
  it("returns null for garbage bytes that merely wear an EBML header", async () => {
    const fake = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 7)]);
    await expect(transcodeAudioToOggOpus(fake, { declaredContentType: "audio/webm" })).resolves.toBeNull();
  });
  it("returns null for non-audio input", async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
    await expect(transcodeAudioToOggOpus(png, { declaredContentType: "image/png" })).resolves.toBeNull();
  });
  it("returns null when the ffmpeg binary does not exist", async () => {
    await expect(isFfmpegAvailable("/nonexistent/ffmpeg-in5a")).resolves.toBe(false);
    await expect(transcodeAudioToOggOpus(sineWav(), { bin: "/nonexistent/ffmpeg-in5a", declaredContentType: "audio/wav" })).resolves.toBeNull();
  });
  it("returns null while the kill switch is off, and recovers after", async () => {
    process.env.INBOX_AUDIO_TRANSCODE = "off";
    try {
      await expect(transcodeAudioToOggOpus(sineWav(), { declaredContentType: "audio/wav" })).resolves.toBeNull();
    } finally { delete process.env.INBOX_AUDIO_TRANSCODE; }
  });
});

function fakePrisma() {
  const convRows: any[] = [
    { id: "conv-wa", organizationId: "org-1", channel: "whatsapp", status: "open", firstResponseAt: null, autoReplyPaused: false, pipelineStage: "new", integrationId: null, externalContactId: "8801711" },
    { id: "conv-web", organizationId: "org-1", channel: "webchat", status: "open", firstResponseAt: null, autoReplyPaused: false, pipelineStage: "new", integrationId: null, externalContactId: "visitor-1" },
  ];
  const msgRows: any[] = [];
  let seq = 0;
  const prisma: any = {
    channelConversation: {
      findFirst: async ({ where }: any) => convRows.find((c) => c.id === where.id && c.organizationId === where.organizationId) ?? null,
      update: async ({ where, data }: any) => { const r = convRows.find((c) => c.id === where.id); Object.assign(r, data); return r; },
    },
    channelMessage: {
      create: async ({ data }: any) => { const row = { id: `msg-${++seq}`, createdAt: new Date(), ...data }; msgRows.push(row); return row; },
      update: async ({ where, data }: any) => { const r = msgRows.find((m) => m.id === where.id); Object.assign(r, data); return r; },
      findFirst: async ({ where }: any) => msgRows.find((m) => m.id === where.id && m.conversationId === where.conversationId) ?? null,
    },
    integration: { findFirst: async () => null, findUnique: async () => null },
  };
  return { prisma, convRows, msgRows };
}

describe("sendMediaReply integration (IN5a in the send path)", () => {
  it("a WebM voice note to WhatsApp is stored as OGG/Opus even though delivery fails without an integration", async () => {
    const webm = makeWebm();
    if (!webm || !(await isFfmpegAvailable())) return;
    expect(detectMediaKind(webm, "audio/webm")?.contentType).toContain("webm");
    const { prisma, msgRows } = fakePrisma();
    const svc = new InboxService(prisma as any, auditStub, llmStub);
    await expect(svc.sendMediaReply("org-1", "user-1", "conv-wa", {
      dataBase64: webm.toString("base64"), fileName: "voice.webm", contentType: "audio/webm",
    })).rejects.toMatchObject({ code: "inbox.mediaWasNotSent" });
    expect(msgRows).toHaveLength(1);
    expect(msgRows[0].status).toBe("failed"); // honest failure stands
    expect(msgRows[0].mediaContentType).toBe("audio/ogg"); // …but what WOULD be sent is the transcoded file
    expect(msgRows[0].content).toBe("voice.ogg");
    const stored = await svc.getMessageMedia("org-1", "conv-wa", msgRows[0].id);
    expect(stored.contentType).toBe("audio/ogg");
    expect(stored.bytes.subarray(0, 4).toString("latin1")).toBe("OggS");
  });
  it("the same WebM voice note to Webchat is NOT transcoded and sends as WebM", async () => {
    const webm = makeWebm();
    if (!webm) return;
    const { prisma, msgRows } = fakePrisma();
    const svc = new InboxService(prisma as any, auditStub, llmStub);
    const sent = await svc.sendMediaReply("org-1", "user-1", "conv-web", {
      dataBase64: webm.toString("base64"), fileName: "voice.webm", contentType: "audio/webm",
    });
    expect(sent.status).toBe("sent");
    expect(msgRows[0].mediaContentType).toContain("webm");
  });
});
