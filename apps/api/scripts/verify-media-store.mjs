#!/usr/bin/env node
/**
 * RM1 — real round-trip verification for the MediaStore against the
 * configured S3-compatible storage (Cloudflare R2 in production).
 *
 * This script talks to the REAL bucket named by the MEDIA_S3_* env
 * vars, using the application's own compiled MediaStore
 * (apps/api/dist/inbox/media-store.js). It writes two small probe
 * objects under `_probe/`, reads them back through every surface the
 * app relies on (put/get, size, putStream, ranged getStream,
 * presigned GET URL fetched WITHOUT credentials), then deletes them.
 *
 * It never prints credentials or the presigned URL itself (only its
 * host). Exit code 0 = every step passed; 1 = a step failed;
 * 2 = setup problem (dist missing or storage not in s3 mode).
 *
 * Usage (from the repo root, after `pnpm --filter @repo/api build`,
 * or inside the api container where dist already exists):
 *   MEDIA_S3_BUCKET=... MEDIA_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com \
 *   MEDIA_S3_REGION=auto MEDIA_S3_ACCESS_KEY_ID=... MEDIA_S3_SECRET_ACCESS_KEY=... \
 *   node apps/api/scripts/verify-media-store.mjs
 */
import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distPath = join(here, "..", "dist", "inbox", "media-store.js");

if (!existsSync(distPath)) {
  console.error("SETUP: apps/api/dist/inbox/media-store.js not found. Run `pnpm --filter @repo/api build` first (inside the api container dist already exists).");
  process.exit(2);
}

const { MediaStore } = await import(distPath);
const store = MediaStore.fromEnv();

if (store.mode !== "s3") {
  console.error("SETUP: MediaStore is in LOCAL mode — MEDIA_S3_BUCKET, MEDIA_S3_ACCESS_KEY_ID and MEDIA_S3_SECRET_ACCESS_KEY must all be set. Nothing was written anywhere.");
  process.exit(2);
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const stamp = new Date().toISOString().replace(/[-:.]/g, "");
const keyA = `_probe/rb1-verify-${stamp}-a.txt`;
const keyB = `_probe/rb1-verify-${stamp}-b.bin`;
const payloadA = Buffer.concat([Buffer.from(`qosprey rb1 media verify ${stamp}\n`), randomBytes(64 * 1024)]);
const payloadB = randomBytes(128 * 1024);

let failures = 0;
async function step(name, fn) {
  try {
    const detail = await fn();
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    failures += 1;
    console.log(`FAIL  ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

try {
  await step("put (buffer)", async () => {
    await store.put(keyA, payloadA, "text/plain");
    return `${payloadA.length} bytes to ${keyA}`;
  });

  await step("get + sha256 match", async () => {
    const got = await store.get(keyA);
    assert(got, "get returned null");
    assert(sha256(got) === sha256(payloadA), "sha256 mismatch between written and read bytes");
    return "bytes identical";
  });

  await step("size (HEAD)", async () => {
    const n = await store.size(keyA);
    assert(n === payloadA.length, `size reported ${n}, expected ${payloadA.length}`);
    return `${n} bytes`;
  });

  await step("putStream", async () => {
    const written = await store.putStream(keyB, Readable.from([payloadB]), "application/octet-stream");
    assert(written === payloadB.length, `putStream wrote ${written}, expected ${payloadB.length}`);
    return `${written} bytes streamed`;
  });

  await step("getStream with Range", async () => {
    const out = await store.getStream(keyB, { start: 1000, end: 1999 });
    assert(out, "getStream returned null");
    const chunks = [];
    for await (const c of out.stream) chunks.push(c);
    const got = Buffer.concat(chunks);
    assert(got.equals(payloadB.subarray(1000, 2000)), "ranged bytes do not match the written slice");
    assert(out.totalSize === payloadB.length, `totalSize reported ${out.totalSize}, expected ${payloadB.length}`);
    return "1000 ranged bytes identical";
  });

  await step("presigned GET URL (fetched with no credentials)", async () => {
    const url = store.signedUrl(keyA, 300);
    assert(url, "signedUrl returned null in s3 mode");
    const res = await fetch(url);
    assert(res.ok, `presigned fetch returned HTTP ${res.status}`);
    const got = Buffer.from(await res.arrayBuffer());
    assert(sha256(got) === sha256(payloadA), "presigned fetch bytes mismatch");
    return `HTTP 200 from ${new URL(url).host}, bytes identical`;
  });
} finally {
  await step("delete probes + confirm gone", async () => {
    await store.delete(keyA);
    await store.delete(keyB);
    const a = await store.size(keyA).catch(() => null);
    const b = await store.size(keyB).catch(() => null);
    assert(a === null && b === null, "a probe object still exists after delete");
    return "bucket left clean";
  });
}

if (failures > 0) {
  console.log(`\nRESULT: FAIL (${failures} step(s) failed) — media storage is NOT verified.`);
  process.exit(1);
}
console.log("\nRESULT: PASS — put/get/size/stream/range/presigned/delete all verified against the real bucket.");
