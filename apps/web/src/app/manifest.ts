import type { MetadataRoute } from "next";

/**
 * Milestone 60 — PWA manifest (served by Next at
 * /manifest.webmanifest with the manifest content type).
 * Icons are real PNGs generated programmatically from the product's
 * gradient "Q" mark — see scripts/generate-pwa-icons.mjs (the repo
 * has no source logo artwork).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AI Marketing OS — Qosprey",
    short_name: "Marketing OS",
    description: "সব মেসেজ, বিজ্ঞাপন আর ডেলিভারি এক ড্যাশবোর্ডে — ই-কমার্স ব্যবসার AI মার্কেটিং অপারেটিং সিস্টেম।",
    id: "/dashboard",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "bn",
    dir: "ltr",
    background_color: "#f5f6fa",
    theme_color: "#4f46e5",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
