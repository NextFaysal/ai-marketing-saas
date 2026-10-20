import "@fontsource-variable/inter";
// ADNX1: self-hosted Hind Siliguri (Bengali subset only — Latin
// and digits keep Inter Variable via the globals.css stack).
import "@fontsource/hind-siliguri/bengali-400.css";
import "@fontsource/hind-siliguri/bengali-500.css";
import "@fontsource/hind-siliguri/bengali-600.css";
import "@fontsource/hind-siliguri/bengali-700.css";
import "./globals.css";
import React from "react";
import { AdminLocaleProvider } from "@/components/AdminLocale";
export const metadata = { title: "Qosprey Admin — SaaS Control", description: "Platform operator console" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="bn"><body><AdminLocaleProvider>{children}</AdminLocaleProvider></body></html>;
}
