"use client";
import React, { useEffect, useState } from "react";
import { cdnImageUrl, cdnSrcSet, isCdnImageUrl } from "@/lib/cdn-image";

/**
 * RB5/RM6 — the ONE shared image component. For URLs on our media
 * CDN it renders a Cloudflare Image Transformations srcset (the
 * stored master is never resized on disk — derivatives are built
 * at the edge); for every other URL it is a plain <img> with the
 * same props, so swapping it in never changes what a page shows,
 * only how efficiently CDN images are delivered.
 *
 * - width/height become the HTML attributes AND an aspect-ratio
 *   style (CLS guard); object-fit defaults to cover — pass a
 *   `style` to override either.
 * - priority -> eager loading (hero/LCP images); everything else
 *   is lazy.
 * - if a transformation URL ever fails, the image falls back ONCE
 *   to the original src (no srcset) — a broken transform must
 *   never mean a broken image, and the fallback cannot loop.
 */
export interface MediaImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  sizes?: string;
  priority?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function MediaImage({ src, alt, width, height, sizes, priority, className, style }: MediaImageProps) {
  const [useOriginal, setUseOriginal] = useState(false);
  useEffect(() => {
    setUseOriginal(false);
  }, [src]);

  const cdn = !useOriginal && isCdnImageUrl(src);
  const imgSrc = cdn && width ? cdnImageUrl(src, width) : src;
  const srcSet = cdn ? cdnSrcSet(src) : undefined;
  const mergedStyle: React.CSSProperties = {
    ...(width && height ? { aspectRatio: `${width} / ${height}` } : {}),
    objectFit: "cover",
    ...style,
  };

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imgSrc}
      srcSet={srcSet}
      sizes={srcSet ? sizes ?? (width ? `${width}px` : undefined) : undefined}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className={className}
      style={mergedStyle}
      onError={() => {
        if (!useOriginal) setUseOriginal(true);
      }}
    />
  );
}
