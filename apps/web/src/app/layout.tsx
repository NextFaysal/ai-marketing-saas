import "@fontsource-variable/inter";
// UX1 Q1: Bengali font — Inter has no Bengali glyphs, so without
// this every Bengali string fell back to a per-device system font.
// The stack in globals.css keeps Latin on Inter and lets Bengali
// glyphs fall through to Hind Siliguri per-glyph.
import "@fontsource/hind-siliguri/400.css";
import "@fontsource/hind-siliguri/500.css";
import "@fontsource/hind-siliguri/600.css";
import "@fontsource/hind-siliguri/700.css";
import "./globals.css";
import React from "react";
import type { Viewport } from "next";
import { SwRegister } from "@/components/pwa";

export const metadata = {
  title: "AI Marketing SaaS",
  description: "AI-powered marketing operating system for ecommerce businesses",
  // Milestone 60: PWA — manifest.ts serves /manifest.webmanifest;
  // icons are the generated product mark.
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Marketing OS" },
};
export const viewport: Viewport = { themeColor: "#4f46e5" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="bn" className="scroll-smooth"><body>{children}<SwRegister /></body></html>;
}
