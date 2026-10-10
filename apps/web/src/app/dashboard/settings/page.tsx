import React from "react";
import { EmptyState } from "@repo/ui";
export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="page-title">Organization Settings</h1>
      <EmptyState title="Milestone 1 এ ভিত্তি তৈরি" description="Organization এর নাম, দেশ, টাইমজোন ও মুদ্রা এখানে থাকবে।" />
    </div>
  );
}
