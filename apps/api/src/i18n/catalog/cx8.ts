/**
 * MB4 (ML10) — cx8 catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the cx8 module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const cx8Catalog: CatalogNamespace = {
  "cx8.conversationNotFoundInThisOrganization": {
    bn: "এই organization-এ conversation পাওয়া যায়নি",
    en: "Conversation not found in this organization",
  },
  "cx8.messageNotFoundInThisConversation": {
    bn: "এই conversation-এ message পাওয়া যায়নি",
    en: "Message not found in this conversation",
  },
  "cx8.noSavedCopyOfThisMessage": {
    bn: "এই মেসেজের ছবির কপি সংরক্ষিত নেই — ছবিটি আবার পাঠাতে বলুন",
    en: "No saved copy of this message's image exists — ask them to send the image again",
  },
  "cx8.writeTheNumberToSearchFor": {
    bn: "খোঁজার নম্বরটি লিখুন",
    en: "Write the number to search for",
  },
  "cx8.theImageIsTooLargeAt": {
    bn: "ছবি অনেক বড় — সর্বোচ্চ ৮MB আপলোড করা যাবে",
    en: "The image is too large — at most 8MB can be uploaded",
  },
  "cx8.theImageWasNotFoundUpload": {
    bn: "ছবি পাওয়া যায়নি — একটি লেবেলের ছবি আপলোড করুন",
    en: "The image was not found — upload an image of a label",
  },
  "cx8.theImageCouldNotBeFetched": {
    bn: "ছবিটি আনা যায়নি ({{resStatus}})",
    en: "The image could not be fetched ({{resStatus}})",
  },
  "cx8.theNumberIsNotInThe": {
    bn: "নম্বরটি সঠিক ফরম্যাটে নয় — ট্র্যাকিং কোড, অর্ডার নম্বর অথবা ফোনের শেষ ৪ ডিজিট লিখুন",
    en: "The number is not in the correct format — write a tracking code, order number, or the last 4 digits of a phone",
  },
  "cx8.productsCanOnlyBeSearchedFrom": {
    bn: "শুধু গ্রাহকের পাঠানো ছবির জন্যই প্রোডাক্ট খোঁজা যাবে",
    en: "Products can only be searched from images sent by the customer",
  },
  "cx8.onlyImagesJpegPngWebpCan": {
    bn: "শুধু ছবি (JPEG/PNG/WebP) আপলোড করা যাবে — ফাইলের আসল ফরম্যাট ছবি নয়",
    en: "Only images (JPEG/PNG/WebP) can be uploaded — the file's real format is not an image",
  },
};
