export interface ClassifiedComment {
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "SPAM";
  intent: "PRICE_QUERY" | "DELIVERY_QUERY" | "COMPLAINT" | "PRODUCT_INFO" | "BARGAIN" | "COMPETITOR_MENTION" | "GENERAL";
  confidenceScore: number;
  shouldHideOrDelete: boolean;
  isHighPriorityComplaint: boolean;
  isBargaining?: boolean;
  competitorDetected?: string;
}

export class CommentClassifier {
  private static spamKeywords = [
    "click here", "inbox me for crypto", "whatsapp me at", "earn money online", 
    "ঘরোয়া উপায়ে ইনকাম", "টেলিগ্রাম চ্যানেলে জয়েন করুন", "ফ্রি গিফট", "sex", "porn",
    "dm for promo", "dm us on @"
  ];

  private static competitorKeywords = [
    "daraz", "দারাজ", "aarong", "আড়ং", "chaldal", "চালডাল", "অন্য পেজে", "অন্য পেইজে", 
    "কম দামে পাওয়া যায়", "ওরা কম রাখে", "ওখানে কম", "দোকানে কম"
  ];

  private static bargainKeywords = [
    "কম রাখা যাবে", "কম রাখেন", "কিছু কম হবে", "একদাম", "ফিক্সড", "দামাদামি", "ডিসকাউন্ট দেন", 
    "কমান", "কমানো যাবে", "কমান ভাই", "কম হবে", "লাস্ট কত", "একটু কম রাখেন", "কিছু ছাড় দিন"
  ];

  private static priceKeywords = [
    "দাম", "কত", "price", "koto", "cost", "dam", "tk", "taka", "rate", "offer", "discount"
  ];

  private static deliveryKeywords = [
    "ডেলিভারি", "delivery", "dhaka", "chittagong", "কবে পাবো", "কয়দিন", "time", "shipping", "চার্জ", "charge", "homedelivery"
  ];

  private static complaintKeywords = [
    "ফালতু", "নষ্ট", "ভাঙা", "প্রতারক", "ভুয়া", "খারাপ", "fake", "scam", "bad", "cheat", "রিটার্ন", "বাজে", "worst", "দিল না"
  ];

  static classify(text: string, customBannedKeywords: string[] = []): ClassifiedComment {
    const lower = text.toLowerCase().trim();

    // 1. Check custom & standard spam/toxic keywords
    const allSpam = [...this.spamKeywords, ...customBannedKeywords.map((k) => k.toLowerCase())];
    for (const kw of allSpam) {
      if (kw && lower.includes(kw)) {
        return {
          sentiment: "SPAM",
          intent: "GENERAL",
          confidenceScore: 0.98,
          shouldHideOrDelete: true,
          isHighPriorityComplaint: false,
        };
      }
    }

    // 2. Check complaints & negative feedback
    for (const kw of this.complaintKeywords) {
      if (lower.includes(kw)) {
        return {
          sentiment: "NEGATIVE",
          intent: "COMPLAINT",
          confidenceScore: 0.95,
          shouldHideOrDelete: false,
          isHighPriorityComplaint: true,
        };
      }
    }

    // 3. Check Competitor Brand Mention & Hijack attempt
    for (const kw of this.competitorKeywords) {
      if (lower.includes(kw)) {
        return {
          sentiment: "NEUTRAL",
          intent: "COMPETITOR_MENTION",
          confidenceScore: 0.94,
          shouldHideOrDelete: false,
          isHighPriorityComplaint: false,
          competitorDetected: kw,
        };
      }
    }

    // 4. Check Bargaining Intent
    for (const kw of this.bargainKeywords) {
      if (lower.includes(kw)) {
        return {
          sentiment: "POSITIVE",
          intent: "BARGAIN",
          confidenceScore: 0.93,
          shouldHideOrDelete: false,
          isHighPriorityComplaint: false,
          isBargaining: true,
        };
      }
    }

    // 5. Check Price Intent
    for (const kw of this.priceKeywords) {
      if (lower.includes(kw)) {
        return {
          sentiment: "POSITIVE",
          intent: "PRICE_QUERY",
          confidenceScore: 0.96,
          shouldHideOrDelete: false,
          isHighPriorityComplaint: false,
        };
      }
    }

    // 6. Check Delivery Intent
    for (const kw of this.deliveryKeywords) {
      if (lower.includes(kw)) {
        return {
          sentiment: "NEUTRAL",
          intent: "DELIVERY_QUERY",
          confidenceScore: 0.92,
          shouldHideOrDelete: false,
          isHighPriorityComplaint: false,
        };
      }
    }

    // Default general engagement
    const isAppreciative = /সুন্দর|nice|valow|valo|good|wow|অসাধারণ|পছন্দ/i.test(lower);
    return {
      sentiment: isAppreciative ? "POSITIVE" : "NEUTRAL",
      intent: isAppreciative ? "PRODUCT_INFO" : "GENERAL",
      confidenceScore: 0.88,
      shouldHideOrDelete: false,
      isHighPriorityComplaint: false,
    };
  }
}
