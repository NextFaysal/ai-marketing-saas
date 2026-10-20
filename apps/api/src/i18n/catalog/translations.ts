/**
 * MB4 (ML10) — translations catalog namespace (coordinator
 * finishing pass: the NF5 translations module was missed by the
 * CD-5 split; its user-visible exceptions are converted here).
 *
 * Pure data: bn/en message pairs, `{{param}}` syntax (D-MB4-10).
 * The pre-MB4 originals were Bengali — bn is byte-faithful,
 * en is the translation.
 */
export const translationsCatalog: Record<string, { bn: string; en: string }> = {
  "translations.languageMustBeBnEnOrHi": {
    bn: "ভাষা অবশ্যই bn, en অথবা hi হতে হবে",
    en: "Language must be bn, en or hi",
  },
  "translations.productFieldMustBeNameOrDescription": {
    bn: "পণ্যের জন্য ক্ষেত্র শুধু name অথবা description হতে পারে",
    en: "For a product, the field can only be name or description",
  },
  "translations.storefrontFieldMustBeOneOf": {
    bn: "দোকানের লেখার জন্য ক্ষেত্র শুধু {{fields}} হতে পারে",
    en: "For storefront text, the field can only be one of {{fields}}",
  },
  "translations.entityTypeMustBeProductOrStorefrontString": {
    bn: "entityType অবশ্যই product অথবা storefront_string হতে হবে",
    en: "entityType must be product or storefront_string",
  },
  "translations.productNotFoundInOrg": {
    bn: "পণ্যটি এই সংস্থায় পাওয়া যায়নি",
    en: "The product was not found in this organization",
  },
  "translations.translationTextMustNotBeEmpty": {
    bn: "অনুবাদের লেখা খালি হতে পারে না",
    en: "The translation text cannot be empty",
  },
  "translations.translationNotFound": {
    bn: "অনুবাদটি পাওয়া যায়নি",
    en: "The translation was not found",
  },
  "translations.statusMustBeDraftOrApproved": {
    bn: "status শুধু draft অথবা approved হতে পারে",
    en: "status can only be draft or approved",
  },
  "translations.aiDisabledByPlatform": {
    bn: "এই সংস্থার জন্য AI সুবিধা প্ল্যাটফর্ম টিম সাময়িকভাবে বন্ধ রেখেছে।",
    en: "The AI feature is temporarily disabled for this organization by the platform team.",
  },
  "translations.aiNoActiveModelConfigured": {
    bn: "AI অনুবাদ তৈরি করা যায়নি — এই সংস্থার জন্য কোনো সক্রিয় AI মডেল কনফিগার করা নেই। অনুগ্রহ করে নিজে অনুবাদ লিখুন, অথবা সংযোগ সেটিংসে AI মডেল যাচাই করুন।",
    en: "AI translation could not be generated — no active AI model is configured for this organization. Please write the translation yourself, or verify the AI model in connection settings.",
  },
  "translations.aiTranslationFailed": {
    bn: "AI অনুবাদ তৈরি করা যায়নি: {{detail}}",
    en: "AI translation could not be generated: {{detail}}",
  },
  "translations.aiNoUsableTranslation": {
    bn: "AI অনুবাদ তৈরি করা যায়নি — মডেল কোনো ব্যবহারযোগ্য অনুবাদ দেয়নি। আবার চেষ্টা করুন অথবা নিজে লিখুন।",
    en: "AI translation could not be generated — the model returned no usable translation. Try again or write it yourself.",
  },
  "translations.productHasNoNameOrDescription": {
    bn: "এই পণ্যের কোনো নাম/বিবরণ নেই — আগে পণ্যের তথ্য যোগ করুন",
    en: "This product has no name/description — add the product information first",
  },
  "translations.noStorefrontSourceStrings": {
    bn: "দোকানের কোনো মূল লেখা (ঘোষণা/রিটার্ন নীতি/ডেলিভারি প্রতিশ্রুতি) সেট করা নেই — আগে স্টোরফ্রন্ট সেটিংসে লেখা যোগ করুন",
    en: "No original storefront text (announcement/return policy/delivery promise) is set — add text in the storefront settings first",
  },
  "translations.currencyCodeMustBeIso3": {
    bn: "মুদ্রার কোড অবশ্যই ৩ অক্ষরের ISO কোড হতে হবে (যেমন USD)",
    en: "The currency code must be a 3-letter ISO code (e.g. USD)",
  },
  "translations.baseCurrencyNeedsNoRate": {
    bn: "দোকানের মূল মুদ্রা ({{currency}}) নিজেই — এর জন্য আলাদা রেট লাগে না",
    en: "This is the shop's base currency itself ({{currency}}) — no separate rate is needed for it",
  },
  "translations.rateMustBePositive": {
    bn: "রেট অবশ্যই ধনাত্মক সংখ্যা হতে হবে (যেমন 119.50)",
    en: "The rate must be a positive number (e.g. 119.50)",
  },
  "translations.rateSourceNoteRequired": {
    bn: "রেটের উৎস লিখতে হবে — এই রেট কোথা থেকে নিয়েছেন (যেমন: ব্যাংকের আজকের রেট, নিজের হিসাব)",
    en: "The rate's source must be written — where this rate was taken from (e.g. the bank's rate today, your own calculation)",
  },
  "translations.noRateSetForCurrency": {
    bn: "এই মুদ্রার কোনো রেট সেট করা নেই",
    en: "No rate is set for this currency",
  },
  // MB5 (ML15) — category + blog_post entity types. The old
  // entityTypeMustBeProductOrStorefrontString key above is
  // retired (unreferenced since ML15 widened the switch) but
  // retained for parity/history.
  "translations.entityTypeMustBeProductCategoryBlogPostOrStorefrontString": {
    bn: "entityType অবশ্যই product, category, blog_post অথবা storefront_string হতে হবে",
    en: "entityType must be product, category, blog_post or storefront_string",
  },
  "translations.categoryFieldMustBeNameOrDescription": {
    bn: "ক্যাটাগরির জন্য ক্ষেত্র শুধু name অথবা description হতে পারে",
    en: "For a category, the field can only be name or description",
  },
  "translations.categoryNotFoundInOrg": {
    bn: "ক্যাটাগরিটি এই সংস্থায় পাওয়া যায়নি",
    en: "The category was not found in this organization",
  },
  "translations.categoryHasNoNameOrDescription": {
    bn: "এই ক্যাটাগরির কোনো নাম/বিবরণ নেই — আগে ক্যাটাগরির তথ্য যোগ করুন",
    en: "This category has no name/description — add the category information first",
  },
  "translations.blogPostFieldMustBeTitle": {
    bn: "ব্লগ পোস্টের জন্য ক্ষেত্র শুধু title হতে পারে",
    en: "For a blog post, the field can only be title",
  },
  "translations.blogPostNotFoundInOrg": {
    bn: "ব্লগ পোস্টটি এই সংস্থায় পাওয়া যায়নি",
    en: "The blog post was not found in this organization",
  },
  "translations.blogPostHasNoTitle": {
    bn: "এই ব্লগ পোস্টের কোনো শিরোনাম নেই — আগে শিরোনাম যোগ করুন",
    en: "This blog post has no title — add the title first",
  },
};
