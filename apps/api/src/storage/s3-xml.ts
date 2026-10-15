/**
 * RM2 — the minimal hand-rolled XML surface for the S3 XML API.
 *
 * The storage layer speaks S3 through plain fetch + hand-signed
 * SigV4 (see s3-object-store.ts), and the multipart / batch-delete /
 * list operations answer in XML. This module is exactly the slice of
 * XML those answers need — entity decode/escape, single-tag reads,
 * repeated-block reads, and the request-body builders — nothing
 * more. No XML dependency is added, matching the codebase's
 * zero-dependency storage tradition (MediaStore signs by hand too).
 *
 * Parsers are written against the documented S3 response shapes and
 * are unit-proven against fixtures; they have NOT been proven
 * against a live R2 bucket yet (that proof is the owner's bucket —
 * see docs/r2-rb2-acceptance.md).
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'",
};

export function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const n = parseInt(body.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    if (body.startsWith("#")) {
      const n = parseInt(body.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Inner text of the FIRST `<tag>…</tag>` (attributes tolerated,
 * CDATA unwrapped, entities decoded). Null when absent. */
export function xmlTag(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  if (!m) return null;
  const inner = m[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(inner);
  return cdata ? cdata[1] : decodeXmlEntities(inner);
}

/** Inner text of EVERY `<tag>…</tag>` block, in document order. */
export function xmlBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/** `<Error><Code>…</Code><Message>…</Message></Error>` anywhere in a
 * body (S3 can embed one in an HTTP 200 for CompleteMultipartUpload
 * and CopyObject). Null when the body carries no error element. */
export function parseS3Error(xml: string): { code: string; message: string } | null {
  if (!/<Error(?:\s[^>]*)?>/.test(xml)) return null;
  return {
    code: xmlTag(xml, "Code") ?? "UnknownError",
    message: xmlTag(xml, "Message") ?? "",
  };
}

export function parseInitiateMultipartUpload(xml: string): { bucket: string | null; key: string | null; uploadId: string } {
  const err = parseS3Error(xml);
  if (err) throw new Error(`S3 CreateMultipartUpload failed: ${err.code}: ${err.message}`);
  const uploadId = xmlTag(xml, "UploadId");
  if (!uploadId) throw new Error("S3 CreateMultipartUpload returned no UploadId");
  return { bucket: xmlTag(xml, "Bucket"), key: xmlTag(xml, "Key"), uploadId };
}

export function buildCompleteMultipartUploadXml(parts: { partNumber: number; etag: string }[]): string {
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  const body = sorted
    .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeXml(p.etag)}</ETag></Part>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUpload>${body}</CompleteMultipartUpload>`;
}

export function buildDeleteObjectsXml(keys: string[]): string {
  const body = keys.map((k) => `<Object><Key>${escapeXml(k)}</Key></Object>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${body}</Delete>`;
}

export interface S3ListedObject {
  key: string;
  sizeBytes: number | null;
  etag: string | null;
  lastModified: string | null;
}

export function stripEtagQuotes(etag: string | null): string | null {
  if (etag == null) return null;
  return etag.replace(/^"+|"+$/g, "");
}

export function parseListObjectsV2(xml: string): { objects: S3ListedObject[]; isTruncated: boolean; nextContinuationToken: string | null } {
  const err = parseS3Error(xml);
  if (err) throw new Error(`S3 ListObjectsV2 failed: ${err.code}: ${err.message}`);
  const objects = xmlBlocks(xml, "Contents").map((block) => {
    const size = xmlTag(block, "Size");
    return {
      key: xmlTag(block, "Key") ?? "",
      sizeBytes: size != null && size !== "" ? Number(size) : null,
      etag: stripEtagQuotes(xmlTag(block, "ETag")),
      lastModified: xmlTag(block, "LastModified"),
    };
  });
  return {
    objects,
    isTruncated: xmlTag(xml, "IsTruncated") === "true",
    nextContinuationToken: xmlTag(xml, "NextContinuationToken"),
  };
}

export function parseDeleteObjectsResult(xml: string): { deleted: string[]; errors: { key: string; code: string; message: string }[] } {
  const deleted = xmlBlocks(xml, "Deleted")
    .map((block) => xmlTag(block, "Key"))
    .filter((k): k is string => Boolean(k));
  const errors = xmlBlocks(xml, "Error").map((block) => ({
    key: xmlTag(block, "Key") ?? "",
    code: xmlTag(block, "Code") ?? "UnknownError",
    message: xmlTag(block, "Message") ?? "",
  }));
  return { deleted, errors };
}
