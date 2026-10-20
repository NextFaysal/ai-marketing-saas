/**
 * MB4 (ML10) — storage catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the storage module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const storageCatalog: CatalogNamespace = {
  "storage.kindMustBeImageVideoOr": {
    bn: "kind হতে হবে image, video অথবা file।",
    en: "kind must be image, video or file.",
  },
  "storage.theUploadedFileCouldNotBe": {
    bn: "আপলোড করা ফাইলটি পড়া যায়নি — ফাইলটি মোছা হয়েছে, আবার চেষ্টা করুন।",
    en: "The uploaded file could not be read — the file has been deleted, try again.",
  },
  "storage.theUploadedFileWasNotFound": {
    bn: "আপলোড করা ফাইলটি পাওয়া যায়নি — আবার আপলোড করুন।",
    en: "The uploaded file was not found — upload again.",
  },
  "storage.theUploadedFileSSizeDoes": {
    bn: "আপলোড করা ফাইলের আকার ঘোষিত আকারের সঙ্গে মিলছে না — ফাইলটি মোছা হয়েছে।",
    en: "The uploaded file's size does not match the declared size — the file has been deleted.",
  },
  "storage.theUploadedFileSRealFormat": {
    bn: "আপলোড করা ফাইলের আসল ফরম্যাট ঘোষিত টাইপের সঙ্গে মিলছে না (পাওয়া গেছে {{what}}) — ফাইলটি মোছা হয়েছে।",
    en: "The uploaded file's real format does not match the declared type (got {{what}}) — the file has been deleted.",
  },
  "storage.theUploadUrlCouldNotBe": {
    bn: "আপলোডের URL তৈরি করা যায়নি — object storage সেটআপ যাচাই করুন।",
    en: "The upload URL could not be created — check the object storage setup.",
  },
  "storage.theUploadKeyIsNotValid": {
    bn: "আপলোডের key সঠিক নয় — presign থেকে পাওয়া key-ই পাঠাতে হবে।",
    en: "The upload key is not valid — the key received from presign must be sent.",
  },
  "storage.theFileIsTooLargeAt": {
    bn: "ফাইলটি অনেক বড় — সর্বোচ্চ ১০ MB পর্যন্ত আপলোড করা যাবে।",
    en: "The file is too large — at most 10 MB can be uploaded.",
  },
  "storage.theFileWasNotFound": {
    bn: "ফাইলটি পাওয়া যায়নি।",
    en: "The file was not found.",
  },
  "storage.theFileSizeSizebytesIsNot": {
    bn: "ফাইলের আকার (sizeBytes) সঠিক নয়।",
    en: "The file size (sizeBytes) is not valid.",
  },
  "storage.migrationCannotBeRunObjectStorage": {
    bn: "মাইগ্রেশন চালানো যাচ্ছে না — object storage (Cloudflare R2) সেটআপ হয়নি, কপি করার গন্তব্যই নেই। আগে MEDIA_S3_*/MEDIA_R2_* env বসান।",
    en: "Migration cannot be run — object storage (Cloudflare R2) is not set up, there is no destination to copy to. Set the MEDIA_S3_*/MEDIA_R2_* env first.",
  },
  "storage.onlyPngJpegOrWebpImages": {
    bn: "শুধু PNG, JPEG অথবা WebP ছবি আপলোড করা যাবে।",
    en: "Only PNG, JPEG or WebP images can be uploaded.",
  },
  "storage.directFileUploadIsNotOn": {
    bn: "সরাসরি ফাইল আপলোড এখন চালু নেই — সার্ভারে object storage (Cloudflare R2) সেটআপ হয়নি।",
    en: "Direct file upload is not on now — object storage (Cloudflare R2) is not set up on the server.",
  },
};
