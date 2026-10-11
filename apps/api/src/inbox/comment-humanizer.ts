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

    // 1. Complaint Resolution
    if (ctx.classification.intent === "COMPLAINT") {
      return {
        publicCommentReply: `${greeting} ${salutation}, আপনার অসুবিধার জন্য আমরা আন্তরিকভাবে দুঃখিত 🙏 অনুগ্রহ করে আপনার অর্ডার নম্বরটি আমাদের ইনবক্সে জানান, আমাদের সিনিয়র টিম এখনই সর্বোচ্চ গুরুত্ব দিয়ে সমাধান করে দিচ্ছে।`,
        privateDmText: `আসসালামু আলাইকুম ${salutation}! আপনার কমেন্টটি আমরা লক্ষ্য করেছি। সমস্যাটি দ্রুত সমাধান করার জন্য আপনার ফোন নম্বর অথবা অর্ডার আইডিটি দয়া করে এখানে দিন। আমরা এখনই কল ব্যাক করছি।`,
        shouldSendDm: true,
        humanConfidence: 0.96,
      };
    }

    // 2. Price Query with Product Context
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
