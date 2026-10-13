import { BadRequestException } from "@nestjs/common";
import { extractKnowledgeText, fileExtension } from "../knowledge/extract";
import type { VisionResult } from "./vision.service";

/**
 * AP2 chat attachments — turn an uploaded file into the text the
 * assistant will actually see, BEFORE the message is sent:
 *
 * - Documents (txt/md/pdf/docx) reuse the CX9 knowledge extraction
 *   verbatim — same magic-byte discipline, same honest Bengali
 *   rejections. CSV decodes as strict UTF-8 text.
 * - Images (jpeg/png/webp) go through VisionService: the stored
 *   "text" is the vision model's description, labelled as such, so
 *   answers can cite it honestly. Vision unavailable → the attach
 *   fails with the verbatim reason; nothing is faked.
 *
 * The result is capped at 12,000 chars and stored on the user
 * message, so the bubble shows exactly what the assistant got.
 */

export const ATTACHMENT_TEXT_CAP = 12_000;
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export interface ChatAttachment {
  name: string;
  kind: "file" | "image";
  text: string;
  truncated: boolean;
}

export interface AttachmentVision {
  analyzeImage: (
    organizationId: string,
    userId: string,
    input: { imageBytes: Buffer; mimeType: string; prompt: string; feature: "vision_chat" },
  ) => Promise<VisionResult>;
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const IMAGE_DESCRIBE_PROMPT =
  "Describe this image in detail for a business assistant who will answer questions about it. " +
  "Transcribe any visible text exactly (Bengali or English), list products, prices, numbers and names you can read, " +
  "and say plainly when something is unreadable. Do not invent details.";

function capText(text: string): { text: string; truncated: boolean } {
  const clean = String(text ?? "").trim();
  if (clean.length <= ATTACHMENT_TEXT_CAP) return { text: clean, truncated: false };
  return { text: clean.slice(0, ATTACHMENT_TEXT_CAP), truncated: true };
}

function safeName(filename: string): string {
  const base = String(filename ?? "file").split(/[\\/]/).pop() ?? "file";
  return base.slice(0, 120) || "file";
}

export async function processChatAttachment(
  organizationId: string,
  userId: string,
  file: { originalname: string; buffer: Buffer; mimetype?: string },
  vision: AttachmentVision,
): Promise<ChatAttachment> {
  const name = safeName(file.originalname);
  const ext = fileExtension(name);
  const bytes = file.buffer;
  if (!bytes || bytes.length === 0) throw new BadRequestException("ফাইলটি খালি");
  if (bytes.length > ATTACHMENT_MAX_BYTES) throw new BadRequestException("ফাইলটি 10MB-এর বেশি বড়");

  // Images → vision description.
  const imageMime = IMAGE_MIME_BY_EXT[ext];
  if (imageMime) {
    const result = await vision.analyzeImage(organizationId, userId, {
      imageBytes: bytes,
      mimeType: imageMime,
      prompt: IMAGE_DESCRIBE_PROMPT,
      feature: "vision_chat",
    });
    if (!result.available) {
      // Verbatim honest reason (no provider / dev mode / bad mime) —
      // the attach simply does not happen.
      throw new BadRequestException(result.reason);
    }
    const { text, truncated } = capText(result.text);
    if (!text) throw new BadRequestException("ছবিটি থেকে কোনো বর্ণনা পাওয়া যায়নি");
    return { name, kind: "image", text, truncated };
  }

  // CSV → strict UTF-8 text (the knowledge extractor's discipline).
  if (ext === "csv") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new BadRequestException("CSV ফাইলটি পাঠযোগ্য টেক্সট (UTF-8) নয়");
    }
    const capped = capText(text);
    if (!capped.text) throw new BadRequestException("CSV ফাইল থেকে কোনো লেখা পাওয়া যায়নি");
    return { name, kind: "file", text: capped.text, truncated: capped.truncated };
  }

  // Documents → the CX9 extractor (throws honest Bengali 400s for
  // unsupported types, magic mismatches, scanned PDFs, empties).
  const extracted = await extractKnowledgeText(name, bytes);
  const capped = capText(extracted);
  if (!capped.text) throw new BadRequestException("ফাইল থেকে কোনো লেখা পাওয়া যায়নি");
  return { name, kind: "file", text: capped.text, truncated: capped.truncated };
}
