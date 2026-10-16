"use client";
import React, { useEffect } from "react";
import { MediaImage } from "@/components/media-image";

/**
 * ED6 (EB2) — the PDP lightbox, extracted verbatim from
 * ProductDetailClient and loaded via next/dynamic (ssr:false): it
 * renders only after the shopper clicks the gallery image, so its
 * chunk stays out of the PDP first load. Behaviour is identical to
 * the inline version it replaces — backdrop click closes, the image
 * click is stop-propagated, prev/next wrap around, and the keyboard
 * listener (Escape / ArrowLeft / ArrowRight) lives here now: this
 * component mounts exactly while the lightbox is open, which is
 * precisely the window the parent's effect subscribed for.
 */
export function ProductLightbox({
  images,
  index,
  productName,
  closeLabel,
  onClose,
  onNavigate,
}: {
  images: string[];
  index: number;
  productName: string;
  closeLabel: string;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onNavigate(images.length ? (index + 1) % images.length : index);
      if (e.key === "ArrowLeft") onNavigate(images.length ? (index - 1 + images.length) % images.length : index);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length, index, onClose, onNavigate]);

  if (images.length === 0) return null;
  const safeIndex = Math.min(index, images.length - 1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={onClose}>
      <button type="button" aria-label={closeLabel} onClick={onClose} className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl text-white">×</button>
      {images.length > 1 ? (
        <>
          <button type="button" aria-label="Previous" onClick={(e) => { e.stopPropagation(); onNavigate((safeIndex - 1 + images.length) % images.length); }} className="absolute left-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-2xl text-white">‹</button>
          <button type="button" aria-label="Next" onClick={(e) => { e.stopPropagation(); onNavigate((safeIndex + 1) % images.length); }} className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-2xl text-white">›</button>
        </>
      ) : null}
      {/* ED6: MediaImage with NO width/height (natural product dims
          are unknown here) and objectFit contained via style, which
          MediaImage merges over its cover default — same rendering
          as the plain <img> it replaces. The old <img> carried
          onClick stopPropagation (clicking the photo must not close
          the lightbox); MediaImage forwards no onClick, so a plain
          wrapper span carries that same handler instead. */}
      <span onClick={(e) => e.stopPropagation()} className="contents">
        <MediaImage
          src={images[safeIndex]}
          alt={productName}
          sizes="100vw"
          style={{ objectFit: "contain" }}
          className="max-h-[90vh] max-w-full object-contain"
        />
      </span>
    </div>
  );
}
