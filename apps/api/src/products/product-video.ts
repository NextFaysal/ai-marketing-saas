/**
 * GB1 (GC4) — product video normalization, shared by the
 * products write path (validation) and the storefront public
 * read path (serialization). ONE implementation, both sides.
 *
 * Accepted forms (http/https only):
 *  - YouTube: youtube.com/watch?v=ID, youtu.be/ID,
 *    youtube.com/shorts/ID, youtube.com/embed/ID
 *  - Vimeo:   vimeo.com/<digits>
 *  - Direct file: pathname ending .mp4 / .webm
 * Anything else normalizes to null (no video) — the write path
 * turns that into a Bengali BadRequest, the read path simply
 * serializes `video: null`.
 */

export type ProductVideo =
  | { kind: "youtube"; embedUrl: string; posterUrl: string | null }
  | { kind: "vimeo"; embedUrl: string; posterUrl: string | null }
  | { kind: "file"; url: string; posterUrl: string | null };

export function normalizeProductVideo(product: {
  videoUrl?: string | null;
  videoPosterUrl?: string | null;
}): ProductVideo | null {
  const raw = product?.videoUrl?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const posterUrl = product.videoPosterUrl ?? null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");

  if (host === "youtube.com" || host === "youtu.be") {
    let id: string | null = null;
    if (host === "youtu.be") {
      id = url.pathname.split("/").filter(Boolean)[0] ?? null;
    } else if (url.pathname === "/watch") {
      id = url.searchParams.get("v");
    } else {
      const m = url.pathname.match(/^\/(?:shorts|embed)\/([^/?#]+)/);
      if (m) id = m[1];
    }
    if (id && /^[A-Za-z0-9_-]+$/.test(id)) {
      return { kind: "youtube", embedUrl: `https://www.youtube.com/embed/${id}`, posterUrl };
    }
    return null;
  }

  if (host === "vimeo.com") {
    const m = url.pathname.match(/^\/(\d+)\/?$/);
    if (m) {
      return { kind: "vimeo", embedUrl: `https://player.vimeo.com/video/${m[1]}`, posterUrl };
    }
    return null;
  }

  const path = url.pathname.toLowerCase();
  if (path.endsWith(".mp4") || path.endsWith(".webm")) {
    return { kind: "file", url: raw, posterUrl };
  }
  return null;
}

/** Write-path predicate: a non-empty videoUrl is acceptable
 * only when it normalizes to a playable video. */
export function isValidProductVideoUrl(raw: string): boolean {
  return normalizeProductVideo({ videoUrl: raw, videoPosterUrl: null }) !== null;
}
