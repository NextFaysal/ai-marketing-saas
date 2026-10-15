import {
  buildCompleteMultipartUploadXml,
  buildDeleteObjectsXml,
  decodeXmlEntities,
  parseDeleteObjectsResult,
  parseInitiateMultipartUpload,
  parseListObjectsV2,
  parseS3Error,
  xmlTag,
} from "./s3-xml";

/**
 * RM2 — S3 XML surface fixtures. All values are fictional; the XML
 * shapes mirror the documented S3 responses (and R2's S3-compatible
 * answers). This proves the parsers against the documented shapes
 * only — a live R2 bucket has not answered yet.
 */

describe("RM2 s3-xml", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeXmlEntities("a &amp; b &lt;x&gt; &#65;&#x42;")).toBe("a & b <x> AB");
  });

  it("xmlTag tolerates namespace attributes and unwraps CDATA", () => {
    const xml = `<InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Bucket>b1</Bucket><Key><![CDATA[org/social/a b.mp4]]></Key><UploadId>up-123</UploadId></InitiateMultipartUploadResult>`;
    expect(xmlTag(xml, "Bucket")).toBe("b1");
    expect(xmlTag(xml, "Key")).toBe("org/social/a b.mp4");
    expect(xmlTag(xml, "Missing")).toBeNull();
  });

  it("parses InitiateMultipartUpload and extracts the UploadId", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Bucket>qosprey-media-private</Bucket><Key>org1/social/clip.mp4</Key><UploadId>2~abcDEF123</UploadId></InitiateMultipartUploadResult>`;
    expect(parseInitiateMultipartUpload(xml)).toEqual({
      bucket: "qosprey-media-private",
      key: "org1/social/clip.mp4",
      uploadId: "2~abcDEF123",
    });
  });

  it("throws when InitiateMultipartUpload carries an S3 error", () => {
    const xml = `<Error><Code>AccessDenied</Code><Message>nope</Message></Error>`;
    expect(() => parseInitiateMultipartUpload(xml)).toThrow(/AccessDenied/);
  });

  it("builds CompleteMultipartUpload XML sorted by part number, with escaped etags", () => {
    const xml = buildCompleteMultipartUploadXml([
      { partNumber: 2, etag: '"b&2"' },
      { partNumber: 1, etag: '"a1"' },
    ]);
    expect(xml.indexOf("<PartNumber>1</PartNumber>")).toBeLessThan(xml.indexOf("<PartNumber>2</PartNumber>"));
    expect(xml).toContain("<ETag>&quot;b&amp;2&quot;</ETag>");
  });

  it("builds DeleteObjects XML escaping keys", () => {
    const xml = buildDeleteObjectsXml(["a&b.jpg", "c<d>.png"]);
    expect(xml).toContain("<Key>a&amp;b.jpg</Key>");
    expect(xml).toContain("<Key>c&lt;d&gt;.png</Key>");
    expect(xml).toContain("<Quiet>true</Quiet>");
  });

  it("parses ListObjectsV2 contents, truncation and continuation token", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>qosprey-media-public</Name><Prefix>org1/</Prefix><IsTruncated>true</IsTruncated><NextContinuationToken>tok-9</NextContinuationToken><Contents><Key>org1/a&amp;b.jpg</Key><LastModified>2026-10-15T00:00:00.000Z</LastModified><ETag>"etag1"</ETag><Size>123</Size></Contents><Contents><Key>org1/c.png</Key><LastModified>2026-10-15T01:00:00.000Z</LastModified><ETag>"etag2"</ETag><Size>0</Size></Contents></ListBucketResult>`;
    const out = parseListObjectsV2(xml);
    expect(out.isTruncated).toBe(true);
    expect(out.nextContinuationToken).toBe("tok-9");
    expect(out.objects).toEqual([
      { key: "org1/a&b.jpg", sizeBytes: 123, etag: "etag1", lastModified: "2026-10-15T00:00:00.000Z" },
      { key: "org1/c.png", sizeBytes: 0, etag: "etag2", lastModified: "2026-10-15T01:00:00.000Z" },
    ]);
  });

  it("parses a DeleteObjects result with one failed key", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Deleted><Key>ok.jpg</Key></Deleted><Error><Key>bad.jpg</Key><Code>AccessDenied</Code><Message>denied</Message></Error></DeleteResult>`;
    expect(parseDeleteObjectsResult(xml)).toEqual({
      deleted: ["ok.jpg"],
      errors: [{ key: "bad.jpg", code: "AccessDenied", message: "denied" }],
    });
  });

  it("parseS3Error finds embedded errors and ignores clean bodies", () => {
    expect(parseS3Error(`<Error><Code>NoSuchKey</Code><Message>gone</Message></Error>`)).toEqual({ code: "NoSuchKey", message: "gone" });
    expect(parseS3Error(`<CopyObjectResult><ETag>"x"</ETag></CopyObjectResult>`)).toBeNull();
  });
});
