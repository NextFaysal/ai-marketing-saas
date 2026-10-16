/**
 * GB6 (GC16): notification categories + the single creation
 * helper every AgentNotification write goes through.
 *
 * A user can mute whole CATEGORIES per organization
 * (NotificationPreference.mutedCategories). categoryOfType maps
 * a notification `type` to its category; any unmapped type is
 * "general" (the catch-all — muting "general" mutes everything
 * unmapped, nothing else).
 *
 * createAgentNotification is failure-isolated on the PREFERENCE
 * side only: if the preference lookup fails for any reason the
 * notification is still created (a broken preference table must
 * never swallow a business event). Create errors propagate to
 * the caller exactly as a direct agentNotification.create did —
 * every call site keeps its own existing catch semantics.
 */
export interface NotificationCategoryDef {
  key: string;
  labelBn: string;
  label: string;
  types: string[];
}

export const NOTIFICATION_CATEGORIES: NotificationCategoryDef[] = [
  { key: "orders", labelBn: "অর্ডার", label: "Orders", types: ["urgent"] },
  { key: "inbox", labelBn: "ইনবক্স", label: "Inbox", types: ["assigned", "mention"] },
  { key: "inventory", labelBn: "ইনভেন্টরি", label: "Inventory", types: ["low_stock", "out_of_stock"] },
  { key: "billing", labelBn: "বিলিং", label: "Billing", types: ["billing"] },
  { key: "marketing", labelBn: "মার্কেটিং", label: "Marketing", types: ["ad_account_sync_failed", "social_post_failed"] },
  { key: "automation", labelBn: "অটোমেশন", label: "Automation", types: ["workflow", "workflow_failed", "job_dead_letter"] },
  { key: "leads", labelBn: "লিড", label: "Leads", types: ["lead_followup", "referral"] },
  { key: "general", labelBn: "সাধারণ", label: "General", types: [] },
];

export const NOTIFICATION_CATEGORY_KEYS: string[] = NOTIFICATION_CATEGORIES.map((c) => c.key);

const CATEGORY_BY_TYPE = new Map<string, string>();
for (const c of NOTIFICATION_CATEGORIES) {
  for (const t of c.types) CATEGORY_BY_TYPE.set(t, c.key);
}

export function categoryOfType(type: string): string {
  return CATEGORY_BY_TYPE.get(type) ?? "general";
}

/**
 * Create an AgentNotification unless the recipient has muted
 * its category in this organization. Returns the created row,
 * or null when muted / the table is unavailable. `data` is the
 * exact create payload the call site used before (organizationId,
 * userId, type, title, body, conversationId...).
 */
export async function createAgentNotification(prisma: any, data: any): Promise<any | null> {
  try {
    const pref = await (prisma as any).notificationPreference?.findUnique?.({
      where: { userId_organizationId: { userId: data.userId, organizationId: data.organizationId } },
    })?.catch?.(() => null);
    const muted: unknown = pref?.mutedCategories;
    if (Array.isArray(muted) && muted.includes(categoryOfType(String(data.type)))) {
      return null;
    }
  } catch {
    // Preference check failed synchronously — proceed to create.
  }
  return (await (prisma as any).agentNotification?.create?.({ data })) ?? null;
}
