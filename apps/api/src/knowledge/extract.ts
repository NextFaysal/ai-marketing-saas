import { BadRequestException } from "@nestjs/common";
import { unzipSync } from "fflate";
import { badRequest } from "../i18n/api-exception";

// pdf-parse v1.1.1, imported via its lib entry on purpose: the
// package index runs debug file-reads when module.parent is falsy,
// while lib/pdf-parse.js is the plain parser function. v2 was
// evaluated and rejected — its bundled pdfjs-dist 5 loads its worker
// via dynamic import(), which throws under this repo's ts-jest CJS
// runner (see docs/cx9-acceptance.md).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
  data: Uint8Array,
) => Promise<{ text: string }>;

/**
 * CX9: Knowledge Base file ingestion — pure text extraction from
 * uploaded files (.txt / .md / .pdf / .docx). Mirrors the magic-byte
 * discipline of inbox/media-sniff.ts: the file NAME (extension) is
 * never trusted on its own; the bytes must agree, or the upload is
 * rejected with an honest Bengali 400 and NOTHING is saved.
 *
 * Everything here is pure and unit-testable: buffers in, text out,
 * BadRequestException on any dishonesty (unsupported type, magic
 * mismatch, extraction failure, empty text, over the char ceiling).
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // enforced by multer at the route
export const MAX_TEXT_CHARS = 200_000;
export const CHUNK_CHARS = 8_000;

export const SCANNED_PDF_MESSAGE = "এই PDF থেকে লেখা পড়া যায়নি (স্ক্যান করা ছবি হতে পারে)";

const SUPPORTED = ["txt", "md", "pdf", "docx"] as const;
export type SupportedExt = (typeof SUPPORTED)[number];

export function fileExtension(filename: string): string {
  const name = String(filename ?? "");
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** Title base for ingested docs: filename minus its extension. */
export function baseTitleFromFilename(filename: string): string {
  const name = String(filename ?? "file").split(/[\\/]/).pop() ?? "file";
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name).trim();
  // Keep room for the " (অংশ N)" suffix within the 200-char title cap.
  return (base || "file").slice(0, 180);
}

function startsWithAscii(bytes: Buffer, sig: string): boolean {
  if (bytes.length < sig.length) return false;
  return bytes.subarray(0, sig.length).toString("latin1") === sig;
}

function isZip(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Strict UTF-8 text decode: fatal decoding (no replacement chars
 * smuggled in) and a control-character sweep, so a binary file
 * renamed to .txt is rejected instead of stored as junk.
 */
function decodePlainText(bytes: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw badRequest("knowledge.theFileIsNotReadableText");
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw badRequest("knowledge.theFileIsNotReadableText");
  }
  return text;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** word/document.xml → plain text: one line per <w:p> paragraph. */
export function docxXmlToText(xml: string): string {
  const paragraphs = xml.split(/<w:p(?:\s[^>]*)?>/).slice(1);
  const lines: string[] = [];
  for (const chunk of paragraphs) {
    const end = chunk.indexOf("</w:p>");
    const body = end >= 0 ? chunk.slice(0, end) : chunk;
    const withBreaks = body
      .replace(/<w:tab(?:\s[^>]*)?\/>/g, "\t")
      .replace(/<w:br(?:\s[^>]*)?\/>/g, "\n");
    let line = "";
    for (const m of withBreaks.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)) {
      line += decodeXmlEntities(m[1]);
    }
    lines.push(line);
  }
  return lines.join("\n");
}

function extractDocxText(bytes: Buffer): string {
  if (!isZip(bytes)) {
    throw badRequest("knowledge.theFileSRealFormatDoes");
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(bytes));
  } catch {
    throw badRequest("knowledge.theFileCouldNotBeOpened");
  }
  const docXml = files["word/document.xml"];
  if (!docXml) {
    throw badRequest("knowledge.thisIsNotAValidDocx");
  }
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(docXml);
  } catch {
    throw badRequest("knowledge.theTextInsideTheDocxFile");
  }
  return docxXmlToText(xml);
}

async function extractPdfText(bytes: Buffer): Promise<string> {
  if (!startsWithAscii(bytes, "%PDF-")) {
    throw badRequest("knowledge.theFileSRealFormatDoes");
  }
  // pdf.js (inside pdf-parse) reads the raw underlying ArrayBuffer
  // in places, ignoring byteOffset — a pooled Node Buffer (multer's,
  // for small files) would shift every internal offset and corrupt
  // the parse ("bad XRef entry"). Hand it a standalone copy instead.
  const standalone = new Uint8Array(bytes.length);
  standalone.set(bytes);
  try {
    const result = await pdfParse(standalone);
    return result.text ?? "";
  } catch {
    throw badRequest("knowledge.thePdfFileCouldNotBe");
  }
}

/**
 * Extract the full text of an uploaded knowledge file, or throw an
 * honest Bengali BadRequestException. Extraction and ALL validation
 * complete before the caller creates any document (all-or-nothing).
 */
export async function extractKnowledgeText(filename: string, bytes: Buffer): Promise<string> {
  const ext = fileExtension(filename);
  if (!ext || !(SUPPORTED as readonly string[]).includes(ext)) {
    throw badRequest("knowledge.unsupportedFileType", {
      p1: ext ? ` (.${ext})` : "",
    });
  }
  let text: string;
  if (ext === "txt" || ext === "md") {
    text = decodePlainText(bytes);
  } else if (ext === "docx") {
    text = extractDocxText(bytes);
  } else {
    text = await extractPdfText(bytes);
  }
  const trimmed = text.trim();
  if (!trimmed) {
    if (ext === "pdf") throw new BadRequestException(SCANNED_PDF_MESSAGE);
    throw badRequest("knowledge.noTextWasFoundInThe");
  }
  if (trimmed.length > MAX_TEXT_CHARS) {
    throw badRequest("knowledge.theFileTextIsTooLarge");
  }
  return trimmed;
}

/**
 * Split extracted text into chunks of at most CHUNK_CHARS, breaking
 * at paragraph boundaries first; a single giant paragraph falls back
 * to sentence boundaries (Bengali । or Latin .) and then spaces, and
 * only as a last resort a hard cut. One chunk = one KnowledgeDocument,
 * because retrieval (inbox/business-brain.ts matchKnowledge) scores
 * whole documents — chunk-sized docs keep matches focused.
 */
export function chunkKnowledgeText(text: string, maxChars: number = CHUNK_CHARS): string[] {
  const clean = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  const pushPiece = (piece: string) => {
    if (!current) current = piece;
    else if (current.length + 2 + piece.length <= maxChars) current += "\n\n" + piece;
    else { flush(); current = piece; }
  };
  for (const rawPara of clean.split(/\n{2,}/)) {
    const para = rawPara.trim();
    if (!para) continue;
    if (para.length <= maxChars) { pushPiece(para); continue; }
    // Giant paragraph: sentence/space-boundary splitting.
    let rest = para;
    while (rest.length > maxChars) {
      let cut = -1;
      for (const sep of ["। ", ". ", "! ", "? ", " "]) {
        const idx = rest.lastIndexOf(sep, maxChars);
        if (idx >= Math.floor(maxChars * 0.5)) { cut = idx; break; }
      }
      if (cut <= 0) cut = maxChars;
      pushPiece(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) pushPiece(rest);
  }
  flush();
  return chunks;
}
