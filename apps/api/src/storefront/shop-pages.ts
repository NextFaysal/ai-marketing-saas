import { ApiException, badRequest } from "../i18n";

/**
 * GB1 (GC2) — shop content-page block validator + system page
 * seed definitions.
 *
 * CONTRACT SHAPE (fixed, shared with the web renderer/editor):
 * every block is `{ type, data: { ...fields } }` — the fields
 * live INSIDE `data`, never flat on the block. A ShopPage's
 * `blocks` Json is a fixed block list: only the block types
 * below may appear (structured data only — NO raw HTML
 * anywhere; the public renderer maps each type to a known
 * block and escapes text). Mirrors the landings/sections.ts
 * validator style: Bengali BadRequest on any violation, output
 * is the normalized block list.
 */

export const SHOP_PAGE_BLOCK_TYPES = [
  "heading",
  "paragraph",
  "list",
  "faq",
  "image",
  "contact_info",
] as const;
export type ShopPageBlockType = (typeof SHOP_PAGE_BLOCK_TYPES)[number];

export interface ShopPageBlock {
  type: ShopPageBlockType;
  data: Record<string, unknown>;
}

export const MAX_SHOP_PAGE_BLOCKS = 40;
export const MAX_SHOP_PAGE_BLOCKS_JSON_LENGTH = 30_000;

function bad(code: string, params?: Record<string, unknown>): ApiException {
  return badRequest(code, params);
}

function asObject(value: unknown, label: string): Record<string, any> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw bad("storefront.shopPageFieldMustBeObject", { label });
  }
  return value as Record<string, any>;
}

function reqString(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string") throw bad("storefront.shopPageFieldMustBeString", { field });
  const v = value.trim();
  if (v.length < min) throw bad("storefront.shopPageFieldMinLength", { field, min });
  if (v.length > max) throw bad("storefront.shopPageFieldMaxLength", { field, max });
  return v;
}

function optString(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  return reqString(value, field, 0, max);
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function stringList(value: unknown, field: string, minItems: number, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) throw bad("storefront.shopPageFieldMustBeList", { field });
  if (value.length < minItems) throw bad("storefront.shopPageFieldMinItems", { field, min: minItems });
  if (value.length > maxItems) throw bad("storefront.shopPageFieldMaxItems", { field, max: maxItems });
  return value.map((v, i) => reqString(v, `${field}[${i}]`, 1, maxLen));
}

function validateBlock(raw: unknown, idx: number): ShopPageBlock {
  const row = asObject(raw, `blocks[${idx}]`);
  const type = String(row.type ?? "");
  // Fields live inside `data` (contract shape). A missing or
  // non-object data is a validation error, never silently flat.
  const data = asObject(row.data, `blocks[${idx}].data`);
  switch (type) {
    case "heading": {
      const text = reqString(data.text, "heading.text", 1, 200);
      let level = 2;
      if (data.level !== undefined && data.level !== null) {
        if (![1, 2, 3].includes(data.level)) throw bad("storefront.shopPageHeadingLevel");
        level = data.level;
      }
      return { type: "heading", data: { text, level } };
    }
    case "paragraph": {
      return { type: "paragraph", data: { text: reqString(data.text, "paragraph.text", 1, 5000) } };
    }
    case "list": {
      return { type: "list", data: { items: stringList(data.items, "list.items", 1, 30, 300) } };
    }
    case "faq": {
      if (!Array.isArray(data.items)) throw bad("storefront.shopPageFaqItemsList");
      if (data.items.length < 1) throw bad("storefront.shopPageFaqMinItems");
      if (data.items.length > 30) throw bad("storefront.shopPageFaqMaxItems");
      const items = data.items.map((rawItem: unknown, i: number) => {
        const item = asObject(rawItem, `faq.items[${i}]`);
        return {
          q: reqString(item.q, `faq.items[${i}].q`, 1, 300),
          a: reqString(item.a, `faq.items[${i}].a`, 1, 2000),
        };
      });
      return { type: "faq", data: { items } };
    }
    case "image": {
      const url = reqString(data.url, "image.url", 1, 1000);
      if (!isHttpUrl(url)) throw bad("storefront.shopPageImageUrl");
      const alt = optString(data.alt, "image.alt", 200);
      return { type: "image", data: { url, ...(alt !== undefined ? { alt } : {}) } };
    }
    case "contact_info": {
      // No data of its own — resolved server-side at public read
      // from the org's BusinessProfile / storefront setting.
      return { type: "contact_info", data: {} };
    }
    default:
      throw bad("storefront.shopPageUnknownBlockType", { type: type || "(খালি)" });
  }
}

export function validateShopPageBlocks(raw: unknown): ShopPageBlock[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw bad("storefront.shopPageBlocksMustBeList");
  }
  if (raw.length > MAX_SHOP_PAGE_BLOCKS) {
    throw bad("storefront.shopPageBlocksMax", { max: MAX_SHOP_PAGE_BLOCKS });
  }
  let jsonLength = 0;
  try {
    jsonLength = JSON.stringify(raw)?.length ?? 0;
  } catch {
    throw bad("storefront.shopPageBlocksInvalidJson");
  }
  if (jsonLength > MAX_SHOP_PAGE_BLOCKS_JSON_LENGTH) {
    throw bad("storefront.shopPageBlocksTotalSize", { max: MAX_SHOP_PAGE_BLOCKS_JSON_LENGTH });
  }
  return raw.map((b, i) => validateBlock(b, i));
}

/** Slug from a title: lowercase, non [a-z0-9] => -, collapsed,
 * dashes trimmed. May return "" (caller rejects). */
export function slugifyShopPageTitle(title: string): string {
  return String(title ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const SHOP_PAGE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface SystemPageDefinition {
  slug: string;
  title: string;
  /** ML10 (MB4, D-MB4-8/D7): English companion seed content —
   * seeding an en-locale shop uses titleEn/blocksEn. */
  titleEn: string;
  showInFooter: boolean;
  showInMenu: boolean;
  blocks: ShopPageBlock[];
  blocksEn: ShopPageBlock[];
}

const para = (text: string): ShopPageBlock => ({ type: "paragraph", data: { text } });
const heading = (text: string): ShopPageBlock => ({ type: "heading", data: { text, level: 2 } });

/**
 * System page seeds (contract shape: { type, data }). Bodies
 * are honest GENERIC Bengali template paragraphs with
 * bracketed blanks ([দোকানের নাম], [ফোন নম্বর]…) that the
 * merchant must replace — they assert no legal fact about any
 * specific merchant.
 */
export const SYSTEM_PAGES: SystemPageDefinition[] = [
  {
    slug: "about",
    title: "আমাদের সম্পর্কে",
    titleEn: "About Us",
    showInFooter: true,
    showInMenu: true,
    blocks: [
      heading("আমাদের সম্পর্কে"),
      para("[দোকানের নাম] — আমরা [পণ্যের ধরন] বিক্রি করি। এই জায়গায় আপনার দোকানের গল্প, কবে থেকে ব্যবসা করছেন এবং গ্রাহকরা কেন আপনার কাছ থেকে কিনবেন, তা নিজের ভাষায় লিখুন।"),
      para("আমাদের ঠিকানা: [ঠিকানা]। যেকোনো প্রয়োজনে ফোন করুন: [ফোন নম্বর] অথবা ইমেইল করুন: [ইমেইল ঠিকানা]। (এই লেখাটি একটি নমুনা — প্রকাশের আগে নিজের তথ্য দিয়ে বদলে নিন।)"),
    ],
    blocksEn: [
      heading("About Us"),
      para("[Shop name] — we sell [type of products]. In this space, write in your own words your shop's story, how long you have been in business, and why customers should buy from you."),
      para("Our address: [Address]. For any need, call: [Phone number] or email: [Email address]. (This text is a sample — replace it with your own information before publishing.)"),
    ]
  },
  {
    slug: "contact",
    title: "যোগাযোগ",
    titleEn: "Contact",
    showInFooter: true,
    showInMenu: true,
    blocks: [
      heading("যোগাযোগ করুন"),
      para("কোনো প্রশ্ন, অর্ডার সংক্রান্ত জিজ্ঞাসা বা মতামতের জন্য আমাদের সঙ্গে যোগাযোগ করুন। আমরা [কার্যদিবসের সময়, যেমন সকাল ৯টা–রাত ৯টা] উত্তর দেওয়ার চেষ্টা করি।"),
      { type: "contact_info", data: {} },
    ],
    blocksEn: [
      heading("Contact Us"),
      para("For any question, order-related query or feedback, contact us. We try to reply within [working hours, e.g. 9am–9pm]."),
      { type: "contact_info", data: {} },
    ]
  },
  {
    slug: "faq",
    title: "সাধারণ জিজ্ঞাসা",
    titleEn: "Frequently Asked Questions",
    showInFooter: true,
    showInMenu: false,
    blocks: [
      heading("সাধারণ জিজ্ঞাসা"),
      {
        type: "faq",
        data: {
          items: [
            {
              q: "কীভাবে অর্ডার করব?",
              a: "পছন্দের পণ্যটি কার্টে যোগ করে চেকআউটে আপনার নাম, ফোন নম্বর ও ঠিকানা দিলেই অর্ডার সম্পন্ন হবে। প্রয়োজনে [ফোন নম্বর]-এ কল করেও অর্ডার করতে পারবেন।",
            },
            {
              q: "ডেলিভারি পেতে কতদিন লাগবে?",
              a: "সাধারণত [X–Y] কার্যদিবসের মধ্যে ডেলিভারি দেওয়া হয়। ডেলিভারি চার্জ ও সময় এলাকাভেদে আলাদা হতে পারে — চেকআউটে আপনার জেলার জন্য প্রযোজ্য চার্জ দেখানো হবে।",
            },
            {
              q: "পেমেন্ট কীভাবে করব?",
              a: "ক্যাশ অন ডেলিভারিতে পণ্য হাতে পেয়ে মূল্য পরিশোধ করতে পারবেন। অন্য কোনো পেমেন্ট পদ্ধতি থাকলে তা এখানে লিখুন: [পেমেন্ট পদ্ধতির বিবরণ]।",
            },
          ],
        },
      },
    ],
    blocksEn: [
      heading("Frequently Asked Questions"),
      {
        type: "faq",
        data: {
          items: [
              { q: "How do I order?", a: "Add your chosen product to the cart and give your name, phone number and address at checkout to complete the order. If needed, you can also order by calling [Phone number]." },
              { q: "How long does delivery take?", a: "Delivery usually takes [X–Y] working days. Delivery charge and time may vary by area — the applicable charge for your district will be shown at checkout." },
              { q: "How do I pay?", a: "With cash on delivery you can pay when you receive the product. If there are other payment methods, write them here: [Payment method details]." },
          ],
        },
      },
    ]
  },
  {
    slug: "privacy",
    title: "গোপনীয়তা নীতি",
    titleEn: "Privacy Policy",
    showInFooter: true,
    showInMenu: false,
    blocks: [
      heading("গোপনীয়তা নীতি"),
      para("এই পেজটি [দোকানের নাম]-এর গোপনীয়তা নীতির নমুনা খসড়া। প্রকাশের আগে নিজের ব্যবসার প্রকৃত তথ্য দিয়ে এটি বদলে নিন।"),
      para("অর্ডার সম্পন্ন করতে আমরা আপনার নাম, ফোন নম্বর ও ডেলিভারির ঠিকানা সংগ্রহ করি। এই তথ্য শুধু অর্ডার প্রসেস ও ডেলিভারির কাজে ব্যবহার করা হয়।"),
      para("আপনার তথ্য সংক্রান্ত কোনো প্রশ্ন থাকলে যোগাযোগ করুন: [ফোন নম্বর] / [ইমেইল ঠিকানা]। কোন কোন তৃতীয় পক্ষের (যেমন কুরিয়ার) সঙ্গে ডেলিভারির প্রয়োজনে তথ্য শেয়ার হয়, তা এখানে স্পষ্ট করে লিখুন।"),
      para("এই নীতি যেকোনো সময় হালনাগাদ হতে পারে; হালনাগাদ সংস্করণ এই পেজেই প্রকাশ করা হবে।"),
    ],
    blocksEn: [
      heading("Privacy Policy"),
      para("This page is a sample draft of [Shop name]'s privacy policy. Replace it with your business's real information before publishing."),
      para("To complete an order we collect your name, phone number and delivery address. This information is used only for order processing and delivery."),
      para("For any question about your information, contact: [Phone number] / [Email address]. Clearly write here which third parties (e.g. couriers) information is shared with for delivery purposes."),
      para("This policy may be updated at any time; the updated version will be published on this page."),
    ]
  },
  {
    slug: "terms",
    title: "শর্তাবলি",
    titleEn: "Terms & Conditions",
    showInFooter: true,
    showInMenu: false,
    blocks: [
      heading("শর্তাবলি"),
      para("এই পেজটি [দোকানের নাম]-এর শর্তাবলির নমুনা খসড়া। প্রকাশের আগে নিজের ব্যবসার প্রকৃত শর্ত দিয়ে এটি বদলে নিন।"),
      para("ওয়েবসাইটে দেখানো পণ্যের ছবি ও বিবরণ যথাসম্ভব সঠিক রাখার চেষ্টা করা হয়; সামান্য পার্থক্য থাকতে পারে। মূল্য ও স্টক যেকোনো সময় পরিবর্তন হতে পারে।"),
      para("অর্ডার নিশ্চিত হওয়ার পর আমরা ফোনে যোগাযোগ করে অর্ডারটি যাচাই করতে পারি। ভুল তথ্য দেওয়া হলে অর্ডার বাতিল হতে পারে।"),
      para("শর্তাবলি সংক্রান্ত প্রশ্নে যোগাযোগ করুন: [ফোন নম্বর] / [ইমেইল ঠিকানা]।"),
    ],
    blocksEn: [
      heading("Terms & Conditions"),
      para("This page is a sample draft of [Shop name]'s terms. Replace it with your business's real terms before publishing."),
      para("We try to keep product photos and descriptions shown on the website as accurate as possible; slight differences may occur. Prices and stock may change at any time."),
      para("After an order is confirmed we may contact you by phone to verify the order. If incorrect information is given, the order may be cancelled."),
      para("For questions about the terms, contact: [Phone number] / [Email address]."),
    ]
  },
  {
    slug: "returns",
    title: "রিটার্ন ও রিফান্ড",
    titleEn: "Returns & Refunds",
    showInFooter: true,
    showInMenu: false,
    blocks: [
      heading("রিটার্ন ও রিফান্ড নীতি"),
      para("এই পেজটি [দোকানের নাম]-এর রিটার্ন নীতির নমুনা খসড়া। প্রকাশের আগে নিজের প্রকৃত নীতি দিয়ে এটি বদলে নিন।"),
      para("অর্ডার পাওয়ার পর পণ্যে ত্রুটি থাকলে বা ভুল পণ্য পেলে [X] দিনের মধ্যে আমাদের সঙ্গে যোগাযোগ করুন: [ফোন নম্বর]। পণ্যটি অব্যবহৃত অবস্থায় ফেরত দিতে হতে পারে।"),
      para("যাচাইয়ের পর রিটার্ন গ্রহণ করা হলে রিফান্ড [Y] কার্যদিবসের মধ্যে [রিফান্ডের মাধ্যম, যেমন বিকাশ/ব্যাংক] দেওয়া হবে। কোন কোন ক্ষেত্রে রিটার্ন প্রযোজ্য নয়, তা এখানে লিখুন: [শর্তসমূহ]।"),
      para("ডেলিভারির সময় পণ্য দেখে নেওয়ার সুযোগ থাকলে, সমস্যা থাকলে ডেলিভারি কর্মীকে তখনই জানান।"),
    ],
    blocksEn: [
      heading("Return & Refund Policy"),
      para("This page is a sample draft of [Shop name]'s return policy. Replace it with your real policy before publishing."),
      para("After receiving an order, if the product is faulty or the wrong product was delivered, contact us within [X] days: [Phone number]. The product may need to be returned unused."),
      para("Once a return is accepted after verification, the refund will be given within [Y] working days via [refund method, e.g. bKash/bank]. Write here the cases where returns do not apply: [Conditions]."),
      para("If there is an opportunity to check the product at delivery, tell the delivery person right away if there is a problem."),
    ]
  },
  {
    slug: "shipping",
    title: "ডেলিভারি তথ্য",
    titleEn: "Delivery Information",
    showInFooter: true,
    showInMenu: false,
    blocks: [
      heading("ডেলিভারি তথ্য"),
      para("এই পেজটি [দোকানের নাম]-এর ডেলিভারি তথ্যের নমুনা খসড়া। প্রকাশের আগে নিজের প্রকৃত ডেলিভারি তথ্য দিয়ে এটি বদলে নিন।"),
      para("আমরা [এলাকার বিবরণ, যেমন সারা বাংলাদেশে] ডেলিভারি দিই। ডেলিভারি চার্জ এলাকাভেদে আলাদা — চেকআউটের সময় আপনার জেলার জন্য প্রযোজ্য চার্জ দেখানো হবে।"),
      para("সাধারণ ডেলিভারি সময় [X–Y] কার্যদিবস। আবহাওয়া বা অনিবার্য কারণে দেরি হতে পারে; সেক্ষেত্রে আমরা ফোনে জানিয়ে দেব।"),
      para("ডেলিভারি সংক্রান্ত জিজ্ঞাসায় যোগাযোগ করুন: [ফোন নম্বর]।"),
    ],
    blocksEn: [
      heading("Delivery Information"),
      para("This page is a sample draft of [Shop name]'s delivery information. Replace it with your real delivery information before publishing."),
      para("We deliver to [area description, e.g. all of Bangladesh]. Delivery charges vary by area — the applicable charge for your district will be shown at checkout."),
      para("Standard delivery time is [X–Y] working days. Delays may occur due to weather or unavoidable causes; in that case we will inform you by phone."),
      para("For delivery-related queries, contact: [Phone number]."),
    ]
  },
];
