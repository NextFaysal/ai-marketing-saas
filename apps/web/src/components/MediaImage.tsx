import React from "react";
// Relative import (not "@/lib/...") on purpose: vitest has no "@"
// alias in this app, and this component is unit-tested directly.
import { cdnImageUrl, cdnSrcSet, cdnWidthFor, isCdnImageUrl } from "../lib/cdn-image";

/**
 * ED4 — the ONE shared image component (canonical implementation;
 * "@/components/media-image" re-exports this for the import path
 * the R2 package established, so there is exactly one component
 * and one URL system — lib/cdn-image).
 *
 * - CDN-hosted src: `src` is the transformation URL at the preset
 *   step for the requested display width (cdnWidthFor — the
 *   largest CDN_IMAGE_WIDTHS step <= the request) and `srcSet`
 *   carries every preset step, so the browser picks per viewport /
 *   DPR. `sizes` defaults to the declared width, or 100vw when no
 *   width is known.
 * - Any other src (external hotlink, API-relative path, data: /
 *   blob: URL): a plain <img> with the original src and NO srcset —
 *   /cdn-cgi/image/ only exists on our media zone.
 * - CLS guard: width/height become the HTML attributes AND an
 *   aspect-ratio style; an explicit `aspectRatio` prop wins over
 *   the width/height-derived ratio.
 * - Loading: lazy + async decoding by default; `priority` (hero /
 *   LCP images) switches to eager + fetchPriority="high".
 * - Server-component-safe: a plain <img>, no hooks, no
 *   "use client".
 *
 * `className` and `imgClassName` are both applied to the <img>
 * (className is the historical prop from the R2 component;
 * imgClassName is the ED4 name — callers may use either/both).
 * No object-fit is forced inline: the caller's class decides
 * (object-cover / object-contain), exactly as laid out.
 */
export interface MediaImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  /** CSS aspect-ratio string, e.g. "1/1" or "16/9". Wins over the ratio derived from width/height. */
  aspectRatio?: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
  imgClassName?: string;
  style?: React.CSSProperties;
}

export function MediaImage({
  src,
  alt,
  width,
  height,
  aspectRatio,
  sizes,
  priority,
  className,
  imgClassName,
  style,
}: MediaImageProps) {
  const cdn = isCdnImageUrl(src);
  const imgSrc = cdn ? cdnImageUrl(src, cdnWidthFor(width)) : src;
  const srcSet = cdn ? cdnSrcSet(src) : undefined;
  const ratio = aspectRatio ?? (width && height ? `${width} / ${height}` : undefined);
  const mergedStyle: React.CSSProperties = {
    ...(ratio ? { aspectRatio: ratio } : {}),
    ...style,
  };
  const cls = [className, imgClassName].filter(Boolean).join(" ") || undefined;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imgSrc}
      srcSet={srcSet}
      sizes={srcSet ? sizes ?? (width ? `${width}px` : "100vw") : undefined}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      {...(priority ? { fetchPriority: "high" as const } : {})}
      className={cls}
      style={Object.keys(mergedStyle).length > 0 ? mergedStyle : undefined}
    />
  );
}
