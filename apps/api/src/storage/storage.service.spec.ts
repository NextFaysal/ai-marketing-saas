import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StorageService, defaultVisibilityForSurface } from "./storage.service";

/**
 * RM2 — StorageService.
 *
 * S3 mode is exercised with a stubbed global fetch that records
 * requests and answers with documented S3 XML shapes — this proves
 * request construction, SigV4 signing, bucket selection and XML
 * handling. It is NOT a live R2 proof: no real bucket has answered.
 * Local mode runs against a real temp directory.
 */

const S3_CFG = {
  endpoint: "https://acct0000example.r2.cloudflarestorage.com",
  region: "auto",
  accessKeyId: "AKIDEXAMPLE0000",
  secretAccessKey: "fake-secret-for-tests",
  privateBucket: "qosprey-media-private",
  publicBucket: "qosprey-media-public",
};

interface RecordedCall { url: string; method: string; headers: Record<string, string>; body?: string }

function stubFetch(handler: (call: RecordedCall) => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  (global as any).fetch = jest.fn(async (url: string, init: any) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init?.headers ?? {})) headers[k.toLowerCase()] = String(v);
    const call: RecordedCall = {
      url: String(url),
      method: init?.method ?? "GET",
      headers,
      body: init?.body != null ? String(init.body) : undefined,
    };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

afterEach(() => {
  delete (global as any).fetch;
});

describe("RM2 StorageService — bucket selection & env fallbacks", () => {
  it("routes public and private to their own buckets", () => {
    const svc = StorageService.withConfig(S3_CFG);
    expect(svc.mode).toBe("s3");
    expect(svc.bucketFor("private")).toBe("qosprey-media-private");
    expect(svc.bucketFor("public")).toBe("qosprey-media-public");
  });

  it("RB1 single-bucket deployment: public falls back to the legacy bucket", () => {
    const svc = StorageService.withConfig({
      endpoint: S3_CFG.endpoint, region: "auto",
      accessKeyId: S3_CFG.accessKeyId, secretAccessKey: S3_CFG.secretAccessKey,
      privateBucket: "legacy-single-bucket",
    });
    expect(svc.bucketFor("private")).toBe("legacy-single-bucket");
    expect(svc.bucketFor("public")).toBe("legacy-single-bucket");
  });

  it("no bucket or no credentials means local mode", () => {
    expect(StorageService.withConfig({}).mode).toBe("local");
    expect(StorageService.withConfig({ privateBucket: "b" }).mode).toBe("local");
    expect(StorageService.withConfig({ accessKeyId: "a", secretAccessKey: "s" }).mode).toBe("local");
  });

  it("surface defaults: public surfaces public, private surfaces private, unknown private", () => {
    expect(defaultVisibilityForSurface("product")).toBe("public");
    expect(defaultVisibilityForSurface("social")).toBe("public");
    expect(defaultVisibilityForSurface("inbox")).toBe("private");
    expect(defaultVisibilityForSurface("digital")).toBe("private");
    expect(defaultVisibilityForSurface("something-new")).toBe("private");
  });
});

describe("RM2 StorageService — presigning (S3 mode)", () => {
  it("presigned PUT points at the right bucket with a valid SigV4 signature", () => {
    const svc = StorageService.withConfig(S3_CFG);
    const url = svc.presignedPutUrl("public", "org1/product/p1/cover.jpg", { ttlSeconds: 600 })!;
    expect(url).toContain("https://acct0000example.r2.cloudflarestorage.com/qosprey-media-public/org1/product/p1/cover.jpg?");
    expect(url).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(url).toContain("X-Amz-Expires=600");
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);
  });

  it("presigned GET uses the private bucket for private visibility", () => {
    const svc = StorageService.withConfig(S3_CFG);
    const url = svc.signedGetUrl("private", "org1/inbox/2026-10/m1.jpg")!;
    expect(url).toContain("/qosprey-media-private/org1/inbox/2026-10/m1.jpg?");
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);
  });

  it("part presign carries partNumber + uploadId in the signed query and changes per part", () => {
    const svc = StorageService.withConfig(S3_CFG);
    const p1 = svc.presignPartUrl("private", "org1/social/v.mp4", "upload-9", 1);
    const p2 = svc.presignPartUrl("private", "org1/social/v.mp4", "upload-9", 2);
    expect(p1).toContain("partNumber=1");
    expect(p1).toContain("uploadId=upload-9");
    expect(p2).toContain("partNumber=2");
    expect(p1).not.toBe(p2);
  });
});

describe("RM2 StorageService — S3 operations over a stubbed fetch", () => {
  it("createMultipartUpload posts ?uploads and parses the UploadId", async () => {
    const calls = stubFetch(async () =>
      new Response(
        `<?xml version="1.0" encoding="UTF-8"?><InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Bucket>qosprey-media-private</Bucket><Key>org1/social/v.mp4</Key><UploadId>up-42</UploadId></InitiateMultipartUploadResult>`,
        { status: 200, headers: { "content-type": "application/xml" } },
      ));
    const svc = StorageService.withConfig(S3_CFG);
    const out = await svc.createMultipartUpload("private", "org1/social/v.mp4", "video/mp4");
    expect(out).toEqual({ uploadId: "up-42", key: "org1/social/v.mp4", bucket: "qosprey-media-private" });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("uploads=");
    expect(calls[0].headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE0000\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=/);
  });

  it("completeMultipartUpload sends the sorted Complete XML and returns the etag", async () => {
    const calls = stubFetch(async () =>
      new Response(
        `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><ETag>"final-etag"</ETag></CompleteMultipartUploadResult>`,
        { status: 200 },
      ));
    const svc = StorageService.withConfig(S3_CFG);
    const out = await svc.completeMultipartUpload("private", "org1/social/v.mp4", "up-42", [
      { partNumber: 2, etag: '"e2"' },
      { partNumber: 1, etag: '"e1"' },
    ]);
    expect(out.etag).toBe("final-etag");
    expect(calls[0].url).toContain("uploadId=up-42");
    expect(calls[0].body!.indexOf("<PartNumber>1</PartNumber>")).toBeLessThan(calls[0].body!.indexOf("<PartNumber>2</PartNumber>"));
  });

  it("completeMultipartUpload refuses an HTTP 200 carrying an embedded Error", async () => {
    stubFetch(async () =>
      new Response(`<Error><Code>InvalidPart</Code><Message>part 2 missing</Message></Error>`, { status: 200 }));
    const svc = StorageService.withConfig(S3_CFG);
    await expect(
      svc.completeMultipartUpload("private", "k.mp4", "up-1", [{ partNumber: 1, etag: '"e1"' }]),
    ).rejects.toThrow(/InvalidPart/);
  });

  it("abortMultipartUpload issues DELETE with the uploadId", async () => {
    const calls = stubFetch(async () => new Response(null, { status: 204 }));
    const svc = StorageService.withConfig(S3_CFG);
    await svc.abortMultipartUpload("private", "org1/social/v.mp4", "up-42");
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toContain("uploadId=up-42");
  });

  it("head parses metadata and maps 404 to null", async () => {
    stubFetch(async (call) =>
      call.url.includes("missing")
        ? new Response(null, { status: 404 })
        : new Response(null, {
            status: 200,
            headers: { "content-length": "1234", "content-type": "image/jpeg", etag: '"e9"', "x-amz-meta-origin": "upload" },
          }));
    const svc = StorageService.withConfig(S3_CFG);
    const head = await svc.head("public", "org1/product/a.jpg");
    expect(head?.sizeBytes).toBe(1234);
    expect(head?.contentType).toBe("image/jpeg");
    expect(head?.etag).toBe("e9");
    expect(head?.metadata).toEqual({ origin: "upload" });
    expect(await svc.head("public", "org1/missing.jpg")).toBeNull();
  });

  it("deleteMany computes deleted as requested-minus-errored in Quiet mode", async () => {
    stubFetch(async () =>
      new Response(
        `<?xml version="1.0" encoding="UTF-8"?><DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Error><Key>b.jpg</Key><Code>AccessDenied</Code><Message>no</Message></Error></DeleteResult>`,
        { status: 200 },
      ));
    const svc = StorageService.withConfig(S3_CFG);
    const out = await svc.deleteMany("private", ["a.jpg", "b.jpg", "c.jpg"]);
    expect(out.deleted).toEqual(["a.jpg", "c.jpg"]);
    expect(out.errors).toEqual([{ key: "b.jpg", code: "AccessDenied", message: "no" }]);
  });

  it("list parses ListObjectsV2 and forwards the continuation token", async () => {
    const calls = stubFetch(async () =>
      new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated><Contents><Key>org1/x.jpg</Key><ETag>"e1"</ETag><Size>10</Size><LastModified>2026-10-15T00:00:00.000Z</LastModified></Contents></ListBucketResult>`,
        { status: 200 },
      ));
    const svc = StorageService.withConfig(S3_CFG);
    const out = await svc.list("public", "org1/", { limit: 50, cursor: "tok-1" });
    expect(calls[0].url).toContain("list-type=2");
    expect(calls[0].url).toContain("continuation-token=tok-1");
    expect(calls[0].url).toContain("max-keys=50");
    expect(out.objects).toEqual([{ key: "org1/x.jpg", sizeBytes: 10, etag: "e1", lastModified: "2026-10-15T00:00:00.000Z" }]);
    expect(out.truncated).toBe(false);
    expect(out.nextCursor).toBeNull();
  });

  it("copy sends x-amz-copy-source naming the source bucket and key", async () => {
    const calls = stubFetch(async () =>
      new Response(`<CopyObjectResult><ETag>"copied"</ETag><LastModified>2026-10-15T00:00:00.000Z</CopyObjectResult>`, { status: 200 }));
    const svc = StorageService.withConfig(S3_CFG);
    const out = await svc.copy(
      { visibility: "private", key: "_quarantine/org1/u1.jpg" },
      { visibility: "public", key: "org1/product/p1/u1.jpg" },
    );
    expect(out.etag).toBe("copied");
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toContain("/qosprey-media-public/org1/product/p1/u1.jpg");
    expect(calls[0].headers["x-amz-copy-source"]).toBe("/qosprey-media-private/_quarantine/org1/u1.jpg");
  });

  it("health probes PUT -> HEAD -> DELETE against the (stubbed) bucket", async () => {
    // Stateful stub: the probe ends with a confirming HEAD that must
    // see the object GONE after DELETE.
    let exists = false;
    (global as any).fetch = jest.fn(async (_url: string, init: any) => {
      if (init?.method === "PUT") { exists = true; return new Response(null, { status: 200 }); }
      if (init?.method === "HEAD") return exists
        ? new Response(null, { status: 200, headers: { "content-length": "28" } }) // "qosprey storage health probe" = 28 bytes
        : new Response(null, { status: 404 });
      if (init?.method === "DELETE") { exists = false; return new Response(null, { status: 204 }); }
      return new Response(null, { status: 405 });
    });
    const svc = StorageService.withConfig(S3_CFG);
    const health = await svc.health("private");
    expect(health.mode).toBe("s3");
    expect(health.objectStorage).toBe(true);
    expect(health.ok).toBe(true);
    expect(health.steps).toEqual({ put: true, head: true, delete: true });
    expect(health.bucket).toBe("qosprey-media-private");
    expect(health.error).toBeNull();
  });
});

describe("RM2 StorageService — local mode (real temp dir)", () => {
  let dir: string;
  let svc: StorageService;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rb2-storage-"));
    svc = StorageService.withConfig({ localDir: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("put/get/head/list/copy/delete round-trip on disk", async () => {
    expect(svc.mode).toBe("local");
    expect(svc.bucketFor("public")).toBe("local");
    await svc.put("private", "org1/inbox/a.txt", Buffer.from("hello"), "text/plain");
    expect((await svc.get("private", "org1/inbox/a.txt"))?.toString()).toBe("hello");
    expect(await svc.get("private", "org1/inbox/none.txt")).toBeNull();

    const head = await svc.head("private", "org1/inbox/a.txt");
    expect(head?.sizeBytes).toBe(5);
    expect(head?.contentType).toBeNull(); // local mode never recorded it

    await svc.put("public", "org1/product/b.txt", Buffer.from("world!"), "text/plain");
    const listed = await svc.list("public", "org1/");
    expect(listed.objects.map((o) => o.key)).toEqual(["org1/inbox/a.txt", "org1/product/b.txt"]);

    await svc.copy({ visibility: "private", key: "org1/inbox/a.txt" }, { visibility: "public", key: "org1/product/a-copy.txt" });
    expect((await readFile(join(dir, "org1/product/a-copy.txt"))).toString()).toBe("hello");

    const del = await svc.deleteMany("private", ["org1/inbox/a.txt", "org1/inbox/never-existed.txt"]);
    expect(del.errors).toEqual([]);
    expect(del.deleted.sort()).toEqual(["org1/inbox/a.txt", "org1/inbox/never-existed.txt"]);
    await expect(stat(join(dir, "org1/inbox/a.txt"))).rejects.toThrow();
  });

  it("presigned URLs are null in local mode (MediaStore parity)", () => {
    expect(svc.presignedPutUrl("public", "x.jpg")).toBeNull();
    expect(svc.signedGetUrl("private", "x.jpg")).toBeNull();
  });

  it("multipart refuses honestly in local mode", async () => {
    await expect(svc.createMultipartUpload("private", "v.mp4", "video/mp4")).rejects.toThrow(/does not support it/);
    expect(() => svc.presignPartUrl("private", "v.mp4", "up", 1)).toThrow(/does not support it/);
    await expect(svc.completeMultipartUpload("private", "v.mp4", "up", [])).rejects.toThrow(/does not support it/);
    await expect(svc.abortMultipartUpload("private", "v.mp4", "up")).rejects.toThrow(/does not support it/);
  });

  it("health says LOCAL plainly and never claims object storage", async () => {
    const health = await svc.health("private");
    expect(health.mode).toBe("local");
    expect(health.objectStorage).toBe(false);
    expect(health.bucket).toBeNull();
    expect(health.ok).toBe(true); // the disk probe itself passed
    expect(health.note).toContain("NOT durable object storage");
  });
});
