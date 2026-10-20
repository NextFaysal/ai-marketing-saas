/**
 * MB4 (ML10) — knowledge catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the knowledge module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const knowledgeCatalog: CatalogNamespace = {
  "knowledge.documentNotFoundInThisOrganization": {
    bn: "এই organization-এ document পাওয়া যায়নি",
    en: "Document not found in this organization",
  },
  "knowledge.thePdfFileCouldNotBe": {
    bn: "PDF ফাইলটি পড়া যায়নি — ফাইলটি ক্ষতিগ্রস্ত হতে পারে",
    en: "The PDF file could not be read — the file may be damaged",
  },
  "knowledge.policyNotFoundInThisOrganization": {
    bn: "এই organization-এ policy পাওয়া যায়নি",
    en: "Policy not found in this organization",
  },
  "knowledge.theTextInsideTheDocxFile": {
    bn: "docx ফাইলের ভেতরের লেখা পড়া যায়নি",
    en: "The text inside the docx file could not be read",
  },
  "knowledge.thisIsNotAValidDocx": {
    bn: "এটি বৈধ .docx ফাইল নয় (word/document.xml পাওয়া যায়নি)",
    en: "This is not a valid .docx file (word/document.xml not found)",
  },
  "knowledge.noFileWasFound": {
    bn: "কোনো ফাইল পাওয়া যায়নি",
    en: "No file was found",
  },
  "knowledge.anEmptyFileCannotBeUploaded": {
    bn: "খালি ফাইল আপলোড করা যাবে না",
    en: "An empty file cannot be uploaded",
  },
  "knowledge.theFileIsTooLargeAt": {
    bn: "ফাইল অনেক বড় — সর্বোচ্চ ১০MB আপলোড করা যাবে",
    en: "The file is too large — at most 10MB can be uploaded",
  },
  "knowledge.fileDataBase64IsRequired": {
    bn: "ফাইল ডেটা (base64) প্রয়োজন",
    en: "File data (base64) is required",
  },
  "knowledge.noTextWasFoundInThe": {
    bn: "ফাইল থেকে কোনো লেখা পাওয়া যায়নি",
    en: "No text was found in the file",
  },
  "knowledge.theFileCouldNotBeOpened": {
    bn: "ফাইলটি খোলা যায়নি — ফাইলটি ক্ষতিগ্রস্ত হতে পারে",
    en: "The file could not be opened — the file may be damaged",
  },
  "knowledge.theFileIsNotReadableText": {
    bn: "ফাইলটি পাঠযোগ্য টেক্সট (UTF-8) নয়",
    en: "The file is not readable text (UTF-8)",
  },
  "knowledge.theFileSRealFormatDoes": {
    bn: "ফাইলের আসল ফরম্যাট এক্সটেনশনের সঙ্গে মিলছে না",
    en: "The file's real format does not match its extension",
  },
  "knowledge.noReadableInformationWasFoundInside": {
    bn: "ফাইলের ভেতর কোনো পাঠযোগ্য তথ্য পাওয়া যায়নি",
    en: "No readable information was found inside the file",
  },
  "knowledge.theFileTextIsTooLarge": {
    bn: "ফাইলের লেখা অনেক বড় (সর্বোচ্চ ২০০,০০০ অক্ষর)",
    en: "The file text is too large (at most 200,000 characters)",
  },
  "knowledge.theFileSizeCanBeAt": {
    bn: "ফাইলের সাইজ সর্বোচ্চ 10MB হতে পারে",
    en: "The file size can be at most 10MB",
  },
  "knowledge.unsupportedFileType": {
    bn: "সমর্থিত নয় এমন ফাইল টাইপ{{p1}} — শুধু .pdf, .docx, .txt, .md ফাইল আপলোড করা যাবে",
    en: "Unsupported file type{{p1}} — only .pdf, .docx, .txt, .md files can be uploaded",
  },
};
