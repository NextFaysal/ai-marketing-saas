/**
 * IN5a: server-side audio transcoding for agent voice notes.
 *
 * The problem (Inbox Next-Gen P1 acceptance, honest limit): Chrome's
 * MediaRecorder produces WebM/Opus. WhatsApp's Cloud API REJECTS
 * WebM audio outright, and Telegram's sendVoice wants OGG/Opus —
 * so a Chrome-recorded voice note could not reach the two channels
 * where voice matters most. This module converts such recordings
 * to OGG/Opus with the system ffmpeg BEFORE the send path stores
 * or delivers them.
 *
 * Honesty rules:
 * - No ffmpeg on the host, a transcode failure, or the kill switch
 *   (INBOX_AUDIO_TRANSCODE=off) all return NULL — the caller then
 *   sends the ORIGINAL bytes exactly as before IN5a, and any
 *   platform rejection still surfaces verbatim with the row marked
 *   failed. Nothing is ever faked or silently "fixed".
 * - The output is verified with the same magic-byte sniffer as
 *   uploads (media-sniff): only bytes that sniff as audio/ogg are
 *   ever returned.
 */
import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { detectMediaKind } from "./media-sniff";

export function ffmpegBin(): string {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

const availabilityCache = new Map<string, Promise<boolean>>();

/** True when an ffmpeg binary actually runs on this host. Cached
 * per binary path; the check is `ffmpeg -version` exiting 0. */
export function isFfmpegAvailable(bin = ffmpegBin()): Promise<boolean> {
  let cached = availabilityCache.get(bin);
  if (!cached) {
    cached = new Promise<boolean>((resolve) => {
      execFile(bin, ["-version"], { timeout: 5000 }, (err) => resolve(!err));
    });
    availabilityCache.set(bin, cached);
  }
  return cached;
}

/**
 * Which uploads get transcoded, and where: browser WebM (or
 * Matroska) AUDIO headed for WhatsApp or Telegram. Deliberately
 * narrow:
 * - Webchat/Email/Messenger accept the browser containers as-is
 *   (P1 truth table) — transcoding there would only add risk.
 * - MP4/M4A audio is NOT transcoded: WhatsApp accepts it (Safari
 *   recordings already work, per the P1 acceptance).
 * - OGG is already the target container.
 */
export function shouldTranscodeAudio(contentType: string, channel: string): boolean {
  if (channel !== "whatsapp" && channel !== "telegram") return false;
  const ct = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  return ct === "audio/webm" || ct === "video/webm" || ct.includes("webm") || ct.includes("matroska");
}

const INPUT_EXT: Record<string, string> = {
  "audio/webm": ".webm", "video/webm": ".webm",
  "audio/wav": ".wav", "audio/x-wav": ".wav",
  "audio/mpeg": ".mp3", "audio/mp4": ".mp4", "video/mp4": ".mp4",
  "audio/ogg": ".ogg",
};

export interface TranscodedAudio { bytes: Buffer<ArrayBuffer>; contentType: "audio/ogg"; fileName: "voice.ogg" }

/**
 * Transcode audio bytes to OGG/Opus (mono, 32kbps, voip profile —
 * the shape WhatsApp voice notes and Telegram sendVoice expect).
 * Returns null on ANY failure (no ffmpeg, bad input, timeout,
 * unverifiable output, kill switch) — see the honesty rules above.
 */
export async function transcodeAudioToOggOpus(
  bytes: Buffer,
  opts: { bin?: string; timeoutMs?: number; declaredContentType?: string } = {},
): Promise<TranscodedAudio | null> {
  if (process.env.INBOX_AUDIO_TRANSCODE === "off") return null;
  if (!bytes?.length) return null;
  const bin = opts.bin ?? ffmpegBin();
  if (!(await isFfmpegAvailable(bin))) return null;
  const detected = detectMediaKind(bytes, opts.declaredContentType);
  if (!detected || detected.kind !== "audio") return null;
  const ext = INPUT_EXT[detected.contentType] ?? ".webm";
  const dir = await mkdtemp(join(tmpdir(), "in5a-transcode-")).catch(() => null);
  if (!dir) return null;
  const inPath = join(dir, `in${ext}`);
  const outPath = join(dir, "voice.ogg");
  try {
    await writeFile(inPath, bytes);
    await new Promise<void>((resolve, reject) => {
      execFile(
        bin,
        ["-y", "-i", inPath, "-vn", "-ac", "1", "-c:a", "libopus", "-b:a", "32k", "-application", "voip", outPath],
        { timeout: opts.timeoutMs ?? 30_000, maxBuffer: 1024 * 1024 },
        (err) => (err ? reject(err) : resolve()),
      );
    });
    const out = await readFile(outPath).catch(() => null);
    if (!out?.length) return null;
    // Verify, never trust: the bytes must sniff as OGG audio.
    const check = detectMediaKind(out, "audio/ogg");
    if (!check || check.kind !== "audio" || !check.contentType.includes("ogg")) return null;
    return { bytes: Buffer.from(out), contentType: "audio/ogg", fileName: "voice.ogg" };
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
