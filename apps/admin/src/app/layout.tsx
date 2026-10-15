import "@fontsource-variable/inter";
import "./globals.css";
import React from "react";
export const metadata = { title: "Qosprey Admin — SaaS Control", description: "Platform operator console" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="bn"><body>{children}</body></html>;
}
