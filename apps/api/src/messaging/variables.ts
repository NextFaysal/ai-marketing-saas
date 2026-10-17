/**
 * MS5 — the personalization variables a broadcast snapshot entry
 * can carry, per audience entity. This is the ONE source the API
 * builds `vars` from (prepareBroadcast in messaging.service.ts)
 * and the composer UI mirrors (the web keeps its own copy of this
 * constant — the GET messaging/variables endpoint serves this
 * exact object so the two can be compared). A variable is listed
 * for an entity ONLY when prepareBroadcast can fill it from a
 * real row of that entity — nothing here is invented: a customer
 * with no orders gets ordersCount 0 and EMPTY lastOrder* values.
 *
 * SA-B20 (G2) adds the memory variables (lastProductName,
 * lastCategory, favoriteCategory, languagePref, aiHook): these
 * are filled by BroadcastPersonalizationService at prepare time
 * ONLY when the broadcast's personalisation is enabled, from
 * that recipient's own CustomerMemory + live order rows. With
 * personalisation off (or no memory/orders for the recipient)
 * they render empty, exactly like any unfilled variable above.
 */
export const TEMPLATE_VARIABLES: Record<"customer" | "lead" | "csv", { key: string; labelBn: string }[]> = {
  customer: [
    { key: "name", labelBn: "নাম" },
    { key: "firstName", labelBn: "নামের প্রথম অংশ" },
    { key: "lastName", labelBn: "নামের শেষ অংশ" },
    { key: "email", labelBn: "ইমেইল" },
    { key: "phone", labelBn: "ফোন নম্বর" },
    { key: "lastOrderNumber", labelBn: "শেষ অর্ডারের নম্বর" },
    { key: "lastOrderTotal", labelBn: "শেষ অর্ডারের মোট (টাকা)" },
    { key: "ordersCount", labelBn: "মোট অর্ডারের সংখ্যা" },
    // SA-B20 (G2): memory variables — filled only when the
    // broadcast's personalisation is enabled (see header).
    { key: "lastProductName", labelBn: "সর্বশেষ কেনা পণ্যের নাম (G2 personalisation চালু থাকলে)" },
    { key: "lastCategory", labelBn: "সর্বশেষ কেনা পণ্যের category (G2)" },
    { key: "favoriteCategory", labelBn: "সবচেয়ে বেশি কেনা category (G2)" },
    { key: "languagePref", labelBn: "Customer-এর দেখা ভাষা: bn/en (G2)" },
    { key: "aiHook", labelBn: "AI ব্যক্তিগত লাইন (শুধু G2 Tier 2 চালু থাকলে)" },
  ],
  lead: [
    { key: "name", labelBn: "নাম" },
    { key: "email", labelBn: "ইমেইল" },
    { key: "phone", labelBn: "ফোন নম্বর" },
    { key: "stage", labelBn: "লিডের ধাপ" },
    { key: "source", labelBn: "উৎস" },
    { key: "value", labelBn: "মান (টাকা)" },
    // SA-B20 (G2): memory variables (leads: from their own
    // CustomerMemory when one exists; Tier 2 never applies —
    // a lead has no bought categories by definition here).
    { key: "lastProductName", labelBn: "সর্বশেষ কেনা পণ্যের নাম (G2 personalisation চালু থাকলে)" },
    { key: "lastCategory", labelBn: "সর্বশেষ কেনা পণ্যের category (G2)" },
    { key: "favoriteCategory", labelBn: "সবচেয়ে বেশি কেনা category (G2)" },
    { key: "languagePref", labelBn: "Lead-এর দেখা ভাষা: bn/en (G2)" },
  ],
  csv: [
    { key: "name", labelBn: "নাম (সিএসভি-তে থাকে না — খালি থাকে)" },
    { key: "address", labelBn: "ঠিকানা (ইমেইল/ফোন)" },
  ],
};
