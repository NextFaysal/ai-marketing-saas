/**
 * RB5/RM6 established this import path ("@/components/media-image");
 * ED4 moved the implementation into "@/components/MediaImage" and
 * this module now simply re-exports it, so there is exactly ONE
 * MediaImage component (and one URL system, lib/cdn-image).
 *
 * Behaviour change vs the original RB5 component, for the record:
 * the client-side onError fallback to the original src is gone —
 * the ED4 component is a server-safe plain <img> (no hooks). The
 * component no longer forces objectFit:"cover" inline either;
 * every existing caller's class already carries its object-*.
 */
export { MediaImage, type MediaImageProps } from "./MediaImage";
