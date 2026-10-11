import { ClassifiedComment } from "./comment-classifier";

export interface HumanReplyContext {
  authorName: string;
  commentText: string;
  classification: ClassifiedComment;
  postTitle?: string;
  matchedProduct?: {
    name: string;
    priceFormatted: string;
    description?: string;
    orderUrl?: string;
  };
  tonePreference?: string;
  freeDeliveryNote?: string;
  isNightOwl?: boolean;
}

export interface GeneratedReplyOutput {
  publicCommentReply: string;
  privateDmText?: string;
  shouldSendDm: boolean;
  humanConfidence: number;
}

export class CommentHumanizer {
  private static greetings = [
    "প্রিয়",
    "আসসালামু আলাইকুম",
    "হ্যালো",
    "শুভ দিন",
  ];

  private static salutations = [
    "ভাইয়া",
    "আপু",
    "প্রিয় গ্রাহক",
  ];

  static generateHumanReply(ctx: HumanReplyContext): GeneratedReplyOutput {
    const namePart = ctx.authorName ? ctx.authorName.split(" ")[0] : "";
    const greeting = this.greetings[Math.floor(Math.random() * this.greetings.length)];
    const salutation = namePart ? `${namePart} ${this.salutations[Math.floor(Math.random() * this.salutations.length)]}` : "প্রিয় গ্রাহক";

    // 0. Night-Owl (12:00 AM - 8:00 AM) Assurance
    if (ctx.isNightOwl) {
      const prodName = ctx.matchedProduct?.name || ctx.postTitle || "আমাদের এই প্রোডাক্টটি";
      const price = ctx.matchedProduct?.priceFormatted || "অফার মূল্যে";
      const orderUrl = ctx.matchedProduct?.orderUrl || "";
      return {
        publicCommentReply: `${greeting} ${salutation}! আমাদের অফিস এখন বন্ধ থাকলেও আপনার কমেন্টটি আমরা নোট করে রেখেছি ✨ ${prodName} পাচ্ছেন ${price} অফারে। আপনি নিশ্চিন্তে অর্ডার দিয়ে রাখতে পারেন, সকাল ৯টায় আমাদের টিম সবার আগে আপনার অর্ডারটি প্রসেস করবে ❤️`,
        privateDmText: `আসসালামু আলাইকুম ${salutation}! নিশুতি রাতের স্পেশাল শুভেচ্ছা 🌙\n\nআপনি "${prodName}" নিয়ে আগ্রহী হওয়ায় আন্তরিক ধন্যবাদ। অফার প্রাইজ: ${price}।\n\nসকালে আমাদের টিম জয়েন করা মাত্রই যাতে আপনার পার্সেল সবার আগে পাঠানো হয়, সেজন্য নিচের লিংকে গিয়ে এখনই অর্ডার কনফার্ম করে রাখুন:\n👉 ${orderUrl || "আমাদের শপ লিংকে ক্লিক করুন"}\n\nশুভ রাত্রি!`,
        shouldSendDm: true,
        humanConfidence: 0.98,
      };
    }

    // 1. Complaint Resolution
    if (ctx.classification.intent === "COMPLAINT") {
      return {
        publicCommentReply: `${greeting} ${salutation}, আপনার অসুবিধার জন্য আমরা আন্তরিকভাবে দুঃখিত 🙏 অনুগ্রহ করে আপনার অর্ডার নম্বরটি আমাদের ইনবক্সে জানান, আমাদের সিনিয়র টিম এখনই সর্বোচ্চ গুরুত্ব দিয়ে সমাধান করে দিচ্ছে।`,
        privateDmText: `আসসালামু আলাইকুম ${salutation}! আপনার কমেন্টটি আমরা লক্ষ্য করেছি। সমস্যাটি দ্রুত সমাধান করার জন্য আপনার ফোন নম্বর অথবা অর্ডার আইডিটি দয়া করে এখানে দিন। আমরা এখনই কল ব্যাক করছি।`,
        shouldSendDm: true,
        humanConfidence: 0.96,
      };
    }

    // 2. Competitor Brand Hijack / Mention Handling
    if (ctx.classification.intent === "COMPETITOR_MENTION") {
      const prodName = ctx.matchedProduct?.name || ctx.postTitle || "আমাদের এই প্রোডাক্টটি";
      return {
        publicCommentReply: `${greeting} ${salutation}! বাজারে কমদামে অনেক কপি বা আন-অফিশিয়াল প্রোডাক্ট পাওয়া যায়। কিন্তু ${prodName} সম্পূর্ণ ১০০% অরিজিনাল, প্রিমিয়াম ফিনিশিং এবং এর সাথে পাচ্ছেন মান নিশ্চিতের রিপ্লেসমেন্ট ওয়ারেন্টি ✨ বিস্তারিত ও আসল ছবি দেখতে ইনবক্স চেক করুন!`,
        privateDmText: `আসসালামু আলাইকুম ${salutation}! বাজারের সাধারণ বা কপি প্রোডাক্টের সাথে আমাদের অরিজিনাল কোয়ালিটির পার্থক্যের ভিডিও ও রিয়েল ছবি দেখতে ইনবক্সে আপনাকে স্বাগতম। আজই অর্ডারে পাচ্ছেন স্পেশাল সিক্রেট ডিসকাউন্ট!`,
        shouldSendDm: true,
        humanConfidence: 0.95,
      };
    }

    // 3. Discount Bargaining & Negotiator Handling
    if (ctx.classification.intent === "BARGAIN") {
      const price = ctx.matchedProduct?.priceFormatted || "বর্তমান অফার মূল্যে";
      const orderUrl = ctx.matchedProduct?.orderUrl || "";
      return {
        publicCommentReply: `${greeting} ${salutation}! প্রিমিয়াম কোয়ালিটি নিশ্চিত করে আমাদের লাভ একদম সীমিত রেখে ${price} ফিক্সড অফার রাখা হয়েছে। তবে আপনি যদি আজই অর্ডার কনফার্ম করেন, ইনবক্সে আপনার জন্য বিশেষ সারপ্রাইজ ডেলিভারি ভাউচার দেওয়া হবে 🎁`,
        privateDmText: `আসসালামু আলাইকুম ${salutation}! 😊\n\nদামাদামির সুযোগ না থাকলেও আপনার আগ্রহের কারণে আমরা আপনাকে ১০০ টাকার স্পেশাল ভাউচার কোড "VIP100" প্রদান করছি!\n\nসরাসরি অর্ডার পেজে এই কুপন ব্যবহার করে ডিসকাউন্ট উপভোগ করুন:\n👉 ${orderUrl || "আমাদের পেজের শপ লিংক"}\n\nধন্যবাদ! ❤️`,
        shouldSendDm: true,
        humanConfidence: 0.97,
      };
    }

    // 4. Price Query with Product Context
    if (ctx.classification.intent === "PRICE_QUERY") {
      const prodName = ctx.matchedProduct?.name || ctx.postTitle || "এই প্রোডাক্টটির";
      const price = ctx.matchedProduct?.priceFormatted || "অফার প্রাইস";
      const orderUrl = ctx.matchedProduct?.orderUrl || "";

      const variations = [
        `${greeting} ${salutation}! ${prodName}-এর রেগুলার অফার মূল্য ${price} ❤️ প্রোডাক্টটি ১০০% প্রিমিয়াম কোয়ালিটির। অর্ডার করতে বা আরও ছবি দেখতে এখনই ইনবক্স চেক করুন!`,
        `${greeting} ${salutation}! প্রিমিয়াম কোয়ালিটির ${prodName} পাচ্ছেন মাত্র ${price}-এ ✨ ক্যাশ অন ডেলিভারিতে নিতে চাইলে আপনার ইনবক্সে বিস্তারিত লিংক পাঠিয়ে দিয়েছি।`,
        `${greeting} ${salutation}! জি, বর্তমান স্পেশাল ডিসকাউন্টে এর মূল্য ${price} 🎁 সাথে পাচ্ছেন দ্রুত হোম ডেলিভারির নিশ্চয়তা! ইনবক্সে অর্ডার লিঙ্ক পাঠিয়ে দেওয়া হয়েছে।`,
      ];
      const selected = variations[Math.floor(Math.random() * variations.length)];

      return {
        publicCommentReply: selected,
        privateDmText: `আসসালামু আলাইকুম ${salutation}! 😊\n\nআপনি "${prodName}" এর বিষয়ে জানতে চেয়েছিলেন।\n\n💰 স্পেশাল অফার প্রাইজ: ${price}\n🚚 সারা বাংলাদেশে ক্যাশ অন ডেলিভারি সুবিধা রয়েছে।\n\nসরাসরি অর্ডার করতে নিচের লিংকে ক্লিক করুন:\n👉 ${orderUrl || "আমাদের পেজের 'Shop Now' বাটনে ক্লিক করুন"}\n\nযেকোনো প্রয়োজনে আমাদের জানান, ধন্যবাদ! ❤️`,
        shouldSendDm: true,
        humanConfidence: 0.98,
      };
    }

    // 3. Delivery Query
    if (ctx.classification.intent === "DELIVERY_QUERY") {
      return {
        publicCommentReply: `${greeting} ${salutation}! ঢাকা সিটির ভেতরে মাত্র ২৪-৪৮ ঘণ্টার মধ্যে এবং ঢাকার বাইরে ২-৩ কার্যদিবসের মধ্যে হোম ডেলিভারি পৌঁছে দেওয়া হয় 🚚 ক্যাশ অন ডেলিভারি সুবিধা রয়েছে! বিস্তারিত জানতে ইনবক্স চেক করুন।`,
        privateDmText: `আসসালামু আলাইকুম ${salutation}! ডেলিভারি সংক্রান্ত বিস্তারিত তথ্য:\n\n• ঢাকা সিটির ভেতর: ৬০ টাকা (১-২ দিন)\n• ঢাকার বাইরে: ১২০ টাকা (২-৩ দিন)\n\nপণ্য হাতে পেয়ে চেক করে পেমেন্ট করার সুবিধা রয়েছে। আপনার ডেলিভারি ঠিকানা পাঠাতে পারেন!`,
        shouldSendDm: true,
        humanConfidence: 0.94,
      };
    }

    // 4. Product Info or Compliment
    if (ctx.classification.intent === "PRODUCT_INFO") {
      return {
        publicCommentReply: `অসংখ্য ধন্যবাদ ${salutation} আপনার সুন্দর মতামতের জন্য! ❤️ আমাদের প্রোডাক্টগুলো সম্পূর্ণ প্রিমিয়াম ও অরিজিনাল। যেকোনো তথ্যের জন্য ইনবক্সে মেসেজ দিতে পারেন।`,
        privateDmText: `আসসালামু আলাইকুম ${salutation}! আমাদের প্রোডাক্টটি পছন্দ করায় আন্তরিক ধন্যবাদ। আজকের যেকোনো অর্ডারে থাকছে বিশেষ উপহার! বিস্তারিত জানতে ইনবক্সে যোগাযোগ রাখুন।`,
        shouldSendDm: false,
        humanConfidence: 0.92,
      };
    }

    // 5. General Interaction
    return {
      publicCommentReply: `${greeting} ${salutation}! আপনার আগ্রহের জন্য অনেক ধন্যবাদ ✨ আমাদের টিম সর্বদা আপনার সহায়তায় প্রস্তুত। বিস্তারিত জানতে চাইলে ইনবক্সে যেকোনো সময় নক দিন।`,
      privateDmText: `আসসালামু আলাইকুম ${salutation}! আপনার দিনটি শুভ হোক। আমরা আপনাকে কীভাবে সহযোগিতা করতে পারি জানাবেন?`,
      shouldSendDm: false,
      humanConfidence: 0.90,
    };
  }
}
