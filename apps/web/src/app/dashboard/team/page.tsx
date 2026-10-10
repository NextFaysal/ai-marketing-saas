import React from "react";
import { EmptyState } from "@repo/ui";
export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="page-title">Team Settings</h1>
      <EmptyState title="Milestone 1 এ ভিত্তি তৈরি" description="সদস্য তালিকা ও Invite এখানে আসবে। API তৈরি আছে: POST /organizations/:id/members/invite (শুধু OWNER ও ADMIN)" />
    </div>
  );
}
