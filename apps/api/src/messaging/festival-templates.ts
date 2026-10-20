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
  /** MB4 (D-MB4-8): en companions of the platform-authored pack
   * content. Installing a pack picks ONE locale's content (the
   * org's dashboardLocale at install time); the installed copy
   * is a merchant-owned MessageTemplate afterwards and is never
   * re-translated (D-MB4-5). */
  subjectEn: string;
  blocksEn: EmailBlock[];
}

/** The pack's content in one locale (bn = the original fields). */
export function festivalPackForLocale(pack: FestivalTemplatePack, locale: "bn" | "en"): { subject: string; blocks: EmailBlock[] } {
  return locale === "en"
    ? { subject: pack.subjectEn, blocks: pack.blocksEn }
    : { subject: pack.subject, blocks: pack.blocks };
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
    subjectEn: "Eid Mubarak! 🌙 A special offer for you",
    blocksEn: [
      { type: "text", text: "Eid Mubarak! 🌙\n\nOur special Eid collection is on for the holy occasion. Shop from home for your loved ones.", align: "center" },
      { type: "divider" },
      { type: "product", productId: null },
      { type: "coupon", discountId: null },
      { type: "text", text: "The offer is valid for a limited time. Message us for anything you need — we are happy to help." },
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
    subjectEn: "Sharodiya greetings! 🪔 A special Puja offer",
    blocksEn: [
      { type: "text", text: "Sharodiya greetings! 🪔\n\nOur special collection is on for Durga Puja. Make your festival shopping a joy.", align: "center" },
      { type: "divider" },
      { type: "product", productId: null },
      { type: "coupon", discountId: null },
      { type: "text", text: "The offer is valid for a limited time. Message us for anything you need — we are happy to help." },
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
    subjectEn: "Happy New Year! 🎉 A special Pohela Boishakh offer",
    blocksEn: [
      { type: "text", text: "Happy New Year! 🎉\n\nOur special collection is on for your new-year Pohela Boishakh shopping.", align: "center" },
      { type: "divider" },
      { type: "product", productId: null },
      { type: "coupon", discountId: null },
      { type: "text", text: "The offer is valid for a limited time. Message us for anything you need — we are happy to help." },
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
    subjectEn: "Winter sale is on! ❄️ Special discounts",
    blocksEn: [
      { type: "text", text: "Winter sale is on! ❄️\n\nPick your favourite from our special winter sale collection.", align: "center" },
      { type: "divider" },
      { type: "product", productId: null },
      { type: "coupon", discountId: null },
      { type: "text", text: "The sale is valid for a limited time — order before stock runs out." },
    ],
  },
];
