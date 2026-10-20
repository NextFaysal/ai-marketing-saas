/**
 * MB4 (ML10) — creatives catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the creatives module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const creativesCatalog: CatalogNamespace = {
  "creatives.aiFeaturesAreTemporarilyDisabledFor": {
    bn: "AI features প্ল্যাটফর্ম team দ্বারা এই organization-এর জন্য সাময়িকভাবে বন্ধ আছে।",
    en: "AI features are temporarily disabled for this organization by the platform team.",
  },
  "creatives.theAiImageGenerationProviderIs": {
    bn: "AI ছবি তৈরির provider configure করা নেই — Admin Panel থেকে সেট করুন",
    en: "The AI image generation provider is not configured — set it from the Admin Panel",
  },
  "creatives.assetNotFound": {
    bn: "Asset পাওয়া যায়নি",
    en: "Asset not found",
  },
  "creatives.dailyAiGenerationLimitReachedFor": {
    bn: "এই organization-এর জন্য daily AI generation limit পূর্ণ হয়েছে ({{limit}})। আগামীকাল আবার চেষ্টা করুন অথবা platform team-কে আপনার plan limit বাড়াতে বলুন।",
    en: "Daily AI generation limit reached for this organization ({{limit}}). Try again tomorrow or ask the platform team to raise your plan limit.",
  },
  "creatives.onlyUploadedVideosCanBeRefreshed": {
    bn: "শুধু uploaded videos-ই refresh করা যাবে",
    en: "Only uploaded videos can be refreshed",
  },
  "creatives.productNotFoundInThisOrganization": {
    bn: "এই organization-এ product পাওয়া যায়নি",
    en: "Product not found in this organization",
  },
  "creatives.theProviderReturnedDataThatCould": {
    bn: "Provider এমন ডেটা ফেরত দিয়েছে যা ছবি হিসেবে পড়া যাচ্ছে না — Asset তৈরি হয়নি।",
    en: "The provider returned data that could not be read as an image — no Asset was created.",
  },
  "creatives.kindMustBeImageOrVideo": {
    bn: "kind হতে হবে image অথবা video",
    en: "kind must be image or video",
  },
  "creatives.sourceurlMustBeAnHttpsUrl": {
    bn: "sourceUrl একটি https URL হতে হবে যা Meta fetch করতে পারে",
    en: "sourceUrl must be an https URL Meta can fetch",
  },
  "creatives.theUploadedFileCouldNotBe": {
    bn: "আপলোড করা ফাইলটি পড়া যায়নি — ফাইলটি মোছা হয়েছে, আবার চেষ্টা করুন।",
    en: "The uploaded file could not be read — the file has been deleted, try again.",
  },
  "creatives.theUploadedFileWasNotFound": {
    bn: "আপলোড করা ফাইলটি পাওয়া যায়নি — আবার আপলোড করুন।",
    en: "The uploaded file was not found — upload again.",
  },
  "creatives.theUploadedFileSSizeDoes": {
    bn: "আপলোড করা ফাইলের আকার ঘোষিত আকারের সঙ্গে মিলছে না — ফাইলটি মোছা হয়েছে।",
    en: "The uploaded file's size does not match the declared size — the file has been deleted.",
  },
  "creatives.theUploadedFileSRealFormat": {
    bn: "আপলোড করা ফাইলের আসল ফরম্যাট ঘোষিত টাইপের সঙ্গে মিলছে না (পাওয়া গেছে {{what}}) — ফাইলটি মোছা হয়েছে।",
    en: "The uploaded file's real format does not match the declared type (got {{what}}) — the file has been deleted.",
  },
  "creatives.theUploadUrlCouldNotBe": {
    bn: "আপলোডের URL তৈরি করা যায়নি — object storage সেটআপ যাচাই করুন।",
    en: "The upload URL could not be created — check the object storage setup.",
  },
  "creatives.theUploadKeyIsNotValid": {
    bn: "আপলোডের key সঠিক নয় — presign থেকে পাওয়া key-ই পাঠাতে হবে।",
    en: "The upload key is not valid — the key received from presign must be sent.",
  },
  "creatives.giveTheImageDescriptionPrompt": {
    bn: "ছবির বর্ণনা (Prompt) দিন।",
    en: "Give the image description (Prompt).",
  },
  "creatives.theGeneratedVideoExceedsTheDirect": {
    bn: "তৈরি ভিডিও ({{aspectLabel}}) সরাসরি আপলোডের সীমা ৫০ MB ছাড়িয়ে গেছে — ভিডিও তৈরি বাতিল করা হয়েছে।",
    en: "The generated video ({{aspectLabel}}) exceeds the direct upload limit of 50 MB — video generation has been cancelled.",
  },
  "creatives.noImageOfTheProductWas": {
    bn: "প্রোডাক্টের কোনো ছবি আমাদের মিডিয়া CDN-এ পাওয়া যায়নি — ভিডিও বানাতে আগে প্রোডাক্টে ছবি আপলোড করুন (বাইরের URL থেকে ছবি এনে ভিডিও বানানো হয় না)।",
    en: "No image of the product was found in our media CDN — upload an image to the product first to make a video (images are not fetched from outside URLs to make videos).",
  },
  "creatives.theFileSizeSizebytesIsNot": {
    bn: "ফাইলের আকার (sizeBytes) সঠিক নয়।",
    en: "The file size (sizeBytes) is not valid.",
  },
  "creatives.ffmpegWasNotFoundOnThis": {
    bn: "ভিডিও তৈরির জন্য ffmpeg এই সার্ভারে পাওয়া যাচ্ছে না — AI ভিডিও এখন তৈরি করা যাচ্ছে না।",
    en: "ffmpeg was not found on this server for video generation — AI video cannot be generated now.",
  },
  "creatives.directFileUploadIsNotOn": {
    bn: "সরাসরি ফাইল আপলোড এখন চালু নেই — সার্ভারে object storage (Cloudflare R2) সেটআপ হয়নি। আপাতত URL দিয়ে ক্রিয়েটিভ যোগ করুন।",
    en: "Direct file upload is not on now — object storage (Cloudflare R2) is not set up on the server. For now, add creatives via URL.",
  },
};
