/**
 * MX7 — Bangladeshi festival template pack.
 *
 * Pre-built template DESIGNS (block layouts + org-editable copy)
 * for the four occasions the MX plan names. A design carries NO
 * product, NO coupon code and NO price: its product/coupon
 * blocks are unfilled SLOTS (productId / discountId = null) that
 * render empty until the org picks a real Product / StoreDiscount
 * row in the builder — at which point rendering fills them from
 * that real row (see email-blocks.ts). Installing a pack creates
 * a real MessageTemplate through the normal createTemplate path,
 * editable afterwards like any template.
 */
import type { EmailBlock } from "./email-blocks";

export interface FestivalTemplatePack {
  key: string;
  name: string;
  nameBn: string;
  subject: string;
  blocks: EmailBlock[];
}

export const FESTIVAL_TEMPLATE_PACKS: FestivalTemplatePack[] = [
  {
    key: "eid",
    name: "Eid Offer",
    nameBn: "ঈদ অফার",
    subject: "ঈদ মোবারক! 🌙 আপনার জন্য বিশেষ অফার",
    blocks: [
      { type: "text", text: "ঈদ মোবারক! 🌙\n\nপবিত্র ঈদ উপলক্ষে আমাদের বিশেষ আয়োজন চলছে। প্রিয়জনদের জন্য কেনাকাটা করুন ঘরে বসেই।", align: "center" },
      { type: "divider" },
      { type: "product", productId: null },
      { type: "coupon", discountId: null },
      { type: "text", text: "অফারটি সীমিত সময়ের জন্য প্রযোজ্য। যেকোনো প্রয়োজনে আমাদের জানান — সাহায্য করতে পেরে আমরা খুশি হব।" },
    ],
  },
  {
    key: "puja",
    name: "Puja Offer",
    nameBn: "পূজা অফার",
    subject: "শারদীয় শুভেচ্ছা! 🪔 পূজা উপলক্ষে বিশেষ অফার",
    blocks: [
      { type: "text", text: "শারদীয় শুভেচ্ছা! 🪔\n\nদুর্গাপূজা উপলক্ষে আমাদের বিশেষ আয়োজন চলছে। উৎসবের কেনাকাটা হোক আনন্দের।", align: "center" },
      { type: "divider" },
      { type: "product", productId: null },
      { type: "coupon", discountId: null },
      { type: "text", text: "অফারটি সীমিত সময়ের জন্য প্রযোজ্য। যেকোনো প্রয়োজনে আমাদের জানান — সাহায্য করতে পেরে আমরা খুশি হব।" },
    ],
  },
  {
    key: "pohela_boishakh",
    name: "Pohela Boishakh Offer",
    nameBn: "পহেলা বৈশাখ অফার",
    subject: "শুভ নববর্ষ! 🎉 পহেলা বৈশাখের বিশেষ অফার",
    blocks: [
      { type: "text", text: "শুভ নববর্ষ! 🎉\n\nপহেলা বৈশাখ উপলক্ষে নতুন বছরের কেনাকাটায় আমাদের বিশেষ আয়োজন চলছে।", align: "center" },
      { type: "divider" },
      { type: "product", productId: null },
      { type: "coupon", discountId: null },
      { type: "text", text: "অফারটি সীমিত সময়ের জন্য প্রযোজ্য। যেকোনো প্রয়োজনে আমাদের জানান — সাহায্য করতে পেরে আমরা খুশি হব।" },
    ],
  },
  {
    key: "winter_sale",
    name: "Winter Sale",
    nameBn: "শীতের সেল",
    subject: "শীতের সেল চলছে! ❄️ বিশেষ ছাড়",
    blocks: [
      { type: "text", text: "শীতের সেল চলছে! ❄️\n\nশীতের কেনাকাটায় আমাদের বিশেষ সেল থেকে পছন্দের পণ্যটি বেছে নিন।", align: "center" },
      { type: "divider" },
      { type: "product", productId: null },
      { type: "coupon", discountId: null },
      { type: "text", text: "সেল সীমিত সময়ের জন্য প্রযোজ্য — স্টক শেষ হওয়ার আগেই অর্ডার করুন।" },
    ],
  },
];
