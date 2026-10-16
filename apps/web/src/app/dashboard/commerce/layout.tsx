import React from "react";
import { CommerceBreadcrumb } from "@/components/commerce-breadcrumb";

// EB5/ED12: every commerce sub-page gets the ড্যাশবোর্ড / কমার্স / <page>
// breadcrumb from this one layout — pages keep their own headers.
export default function CommerceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CommerceBreadcrumb />
      {children}
    </>
  );
}
