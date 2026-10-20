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
export const TEMPLATE_VARIABLES: Record<"customer" | "lead" | "csv", { key: string; labelBn: string; labelEn: string }[]> = {
  customer: [
    { key: "name", labelBn: "নাম", labelEn: "Name" },
    { key: "firstName", labelBn: "নামের প্রথম অংশ", labelEn: "First name" },
    { key: "lastName", labelBn: "নামের শেষ অংশ", labelEn: "Last name" },
    { key: "email", labelBn: "ইমেইল", labelEn: "Email" },
    { key: "phone", labelBn: "ফোন নম্বর", labelEn: "Phone number" },
    { key: "lastOrderNumber", labelBn: "শেষ অর্ডারের নম্বর", labelEn: "Last order number" },
    { key: "lastOrderTotal", labelBn: "শেষ অর্ডারের মোট (টাকা)", labelEn: "Last order total (amount)" },
    { key: "ordersCount", labelBn: "মোট অর্ডারের সংখ্যা", labelEn: "Total number of orders" },
    // SA-B20 (G2): memory variables — filled only when the
    // broadcast's personalisation is enabled (see header).
    { key: "lastProductName", labelBn: "সর্বশেষ কেনা পণ্যের নাম (G2 personalisation চালু থাকলে)", labelEn: "Name of the most recently bought product (when G2 personalisation is on)" },
    { key: "lastCategory", labelBn: "সর্বশেষ কেনা পণ্যের category (G2)", labelEn: "Category of the most recently bought product (G2)" },
    { key: "favoriteCategory", labelBn: "সবচেয়ে বেশি কেনা category (G2)", labelEn: "Most frequently bought category (G2)" },
    { key: "languagePref", labelBn: "Customer-এর দেখা ভাষা: bn/en (G2)", labelEn: "The language the customer is seen using: bn/en (G2)" },
    { key: "aiHook", labelBn: "AI ব্যক্তিগত লাইন (শুধু G2 Tier 2 চালু থাকলে)", labelEn: "AI personal line (only when G2 Tier 2 is on)" },
  ],
  lead: [
    { key: "name", labelBn: "নাম", labelEn: "Name" },
    { key: "email", labelBn: "ইমেইল", labelEn: "Email" },
    { key: "phone", labelBn: "ফোন নম্বর", labelEn: "Phone number" },
    { key: "stage", labelBn: "লিডের ধাপ", labelEn: "Lead stage" },
    { key: "source", labelBn: "উৎস", labelEn: "Source" },
    { key: "value", labelBn: "মান (টাকা)", labelEn: "Value (amount)" },
    // SA-B20 (G2): memory variables (leads: from their own
    // CustomerMemory when one exists; Tier 2 never applies —
    // a lead has no bought categories by definition here).
    { key: "lastProductName", labelBn: "সর্বশেষ কেনা পণ্যের নাম (G2 personalisation চালু থাকলে)", labelEn: "Name of the most recently bought product (when G2 personalisation is on)" },
    { key: "lastCategory", labelBn: "সর্বশেষ কেনা পণ্যের category (G2)", labelEn: "Category of the most recently bought product (G2)" },
    { key: "favoriteCategory", labelBn: "সবচেয়ে বেশি কেনা category (G2)", labelEn: "Most frequently bought category (G2)" },
    { key: "languagePref", labelBn: "Lead-এর দেখা ভাষা: bn/en (G2)", labelEn: "The language the lead is seen using: bn/en (G2)" },
  ],
  csv: [
    { key: "name", labelBn: "নাম (সিএসভি-তে থাকে না — খালি থাকে)", labelEn: "Name (not present in the CSV — stays empty)" },
    { key: "address", labelBn: "ঠিকানা (ইমেইল/ফোন)", labelEn: "Address (email/phone)" },
  ],
};
