import "@fontsource-variable/inter";
import "./globals.css";
import React from "react";
export const metadata = { title: "AI Marketing SaaS", description: "AI-powered marketing operating system for ecommerce businesses" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
