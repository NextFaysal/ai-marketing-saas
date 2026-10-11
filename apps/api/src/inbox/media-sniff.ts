/**
 * Inbox Next-Gen (Priority 1): content sniffing for agent-uploaded
 * media. The browser's declared content type is NEVER trusted for
 * images/PDF — the magic bytes decide — because the bytes are
 * forwarded to customer-facing platforms under the merchant's own
 * accounts. For container formats (WebM/Ogg/MP4) the same bytes can
 * be audio or video, so the declared type only breaks that tie.
 */
export type MediaKind = "image" | "audio" | "video" | "document";

export interface DetectedMedia {
  kind: MediaKind;
  contentType: string;
}

function startsWith(bytes: Buffer, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

function ascii(bytes: Buffer, from: number, to: number): string {
  return bytes.subarray(from, to).toString("latin1");
}

export function detectMediaKind(bytes: Buffer, declaredContentType?: string): DetectedMedia | null {
  const declared = (declaredContentType ?? "").split(";")[0].trim().toLowerCase();

  // Images — magic bytes only, declared type ignored.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "image", contentType: "image/png" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: "image", contentType: "image/jpeg" };
  if (ascii(bytes, 0, 3) === "GIF") return { kind: "image", contentType: "image/gif" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return { kind: "image", contentType: "image/webp" };

  // PDF document — magic bytes only.
  if (ascii(bytes, 0, 4) === "%PDF") return { kind: "document", contentType: "application/pdf" };

  // WAV (RIFF/WAVE).
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE") return { kind: "audio", contentType: "audio/wav" };

  // Ogg container — a voice note unless the browser said video.
  if (ascii(bytes, 0, 4) === "OggS") {
    return declared.startsWith("video/")
      ? { kind: "video", contentType: declared }
      : { kind: "audio", contentType: declared.startsWith("audio/") ? declared : "audio/ogg" };
  }

  // EBML (WebM/Matroska) — MediaRecorder's usual output; the
  // declared type decides audio vs video.
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return declared.startsWith("video/")
      ? { kind: "video", contentType: declared }
      : { kind: "audio", contentType: declared.startsWith("audio/") ? declared : "audio/webm" };
  }

  // ISO-BMFF (MP4/M4A) — "ftyp" box at offset 4.
  if (ascii(bytes, 4, 8) === "ftyp") {
    return declared.startsWith("audio/")
      ? { kind: "audio", contentType: declared }
      : { kind: "video", contentType: declared.startsWith("video/") ? declared : "video/mp4" };
  }

  // MP3 — ID3 tag or MPEG audio frame sync.
  if (ascii(bytes, 0, 3) === "ID3" || startsWith(bytes, [0xff, 0xfb]) || startsWith(bytes, [0xff, 0xf3]) || startsWith(bytes, [0xff, 0xf2])) {
    return { kind: "audio", contentType: "audio/mpeg" };
  }

  return null;
}

/** Default file name per kind when the browser gave none. */
export function defaultMediaFileName(kind: MediaKind, contentType: string): string {
  const ext = contentType.includes("png") ? "png"
    : contentType.includes("jpeg") ? "jpg"
    : contentType.includes("webp") ? "webp"
    : contentType.includes("gif") ? "gif"
    : contentType.includes("pdf") ? "pdf"
    : contentType.includes("ogg") ? "ogg"
    : contentType.includes("mpeg") ? "mp3"
    : contentType.includes("wav") ? "wav"
    : contentType.includes("mp4") ? "mp4"
    : contentType.includes("webm") ? "webm"
    : "bin";
  const base = kind === "image" ? "image" : kind === "audio" ? "voice" : kind === "video" ? "video" : "file";
  return `${base}.${ext}`;
}
