/**
 * RM4 — the ONE place that turns a storage key into the public
 * CDN URL the web, shops and platforms fetch. The base comes from
 * MEDIA_CDN_BASE_URL and defaults to the R2 custom domain; every
 * surface that persists a public URL (ProductImage.url,
 * Product.imageUrl mirrors, later social/branding) must build it
 * here so a domain change is one env edit, never a data rewrite.
 */

export const MEDIA_CDN_BASE_URL_DEFAULT = "https://media.qosprey.com";

export function mediaCdnBaseUrl(): string {
  const raw = (process.env.MEDIA_CDN_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return raw || MEDIA_CDN_BASE_URL_DEFAULT;
}

/** Absolute public URL for an object key in the public bucket. */
export function publicMediaUrl(key: string): string {
  return `${mediaCdnBaseUrl()}/${key.replace(/^\/+/, "")}`;
}

/** Hostname of the CDN base — the mirror uses it to tell "already
 * ours" URLs from genuinely external ones. */
export function mediaCdnHost(): string {
  try {
    return new URL(mediaCdnBaseUrl()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * If `url` is one of OURS (served from the CDN base), return the
 * object key it points at; otherwise null. Used when a row is
 * deleted so the registry entry for the same object can be found
 * without storing the key on the row itself.
 */
export function mediaKeyFromCdnUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const base = `${mediaCdnBaseUrl()}/`;
  if (!url.startsWith(base)) return null;
  const key = url.slice(base.length).split(/[?#]/)[0];
  return key ? decodeURIComponent(key) : null;
}

/**
 * RB4/RM5 — is object storage (R2/S3) actually configured in this
 * process? This mirrors StorageService.resolveStorage's mode rule
 * exactly: a bucket name (private falls back to MEDIA_S3_BUCKET,
 * public falls back to private) AND both credentials present.
 * Serializers are synchronous, so they read env through here,
 * while async paths use StorageService.mode — the two must never
 * disagree (the rb4 spec pins the env combinations).
 */
export function publicMediaServingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const privateBucket = env.MEDIA_R2_PRIVATE_BUCKET ?? env.MEDIA_S3_BUCKET ?? "";
  const publicBucket = env.MEDIA_R2_PUBLIC_BUCKET ?? privateBucket;
  return Boolean(
    (privateBucket || publicBucket) &&
    env.MEDIA_S3_ACCESS_KEY_ID &&
    env.MEDIA_S3_SECRET_ACCESS_KEY,
  );
}

/**
 * The `publicUrl` every MediaAsset serializer returns — the
 * frozen shape is a string or null, never a new field. With
 * object storage on, a public asset's URL is its CDN URL: the
 * bytes are ensured into the public bucket when the link is
 * minted and again when a post publishes (PublicMediaService),
 * so the URL is real when it matters. In local mode the SP1
 * relative token path is returned exactly as before.
 */
export function storedAssetPublicUrl(row: {
  publicToken?: string | null;
  storageKey?: string | null;
}): string | null {
  if (!row?.publicToken) return null;
  if (row.storageKey && publicMediaServingEnabled()) return publicMediaUrl(row.storageKey);
  return `/public/media/${row.publicToken}`;
}

/** File extension for a sniffed image content type (the
 * social-import extForImageContentType mapping, shared). */
export function imageExtForContentType(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "bin";
}
