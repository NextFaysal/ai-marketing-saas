/**
 * MB4 (ML10) — support catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the support module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const supportCatalog: CatalogNamespace = {
  "support.attachmentDataIsRequired": {
    bn: "Attachment data দরকার",
    en: "Attachment data is required",
  },
  "support.attachmentFileNotFound": {
    bn: "Attachment file পাওয়া যায়নি",
    en: "Attachment file not found",
  },
  "support.fileSizeExceeds8mbLimit": {
    bn: "File size 8MB limit ছাড়িয়ে গেছে",
    en: "File size exceeds 8MB limit",
  },
  "support.internalNoteBodyIsRequired": {
    bn: "Internal note body দরকার",
    en: "Internal note body is required",
  },
  "support.invalidAttachmentData": {
    bn: "অবৈধ attachment data",
    en: "Invalid attachment data",
  },
  "support.messageBodyIsRequired": {
    bn: "Message body দরকার",
    en: "Message body is required",
  },
  "support.ratingMustBeBetween1And": {
    bn: "Rating ১ থেকে ৫-এর মধ্যে হতে হবে",
    en: "Rating must be between 1 and 5",
  },
  "support.subjectIsRequiredMin3Characters": {
    bn: "Subject দরকার (কমপক্ষে ৩ অক্ষর)",
    en: "Subject is required (min 3 characters)",
  },
  "support.tenantsCanCloseOrReopenA": {
    bn: "Tenants একটি ticket close অথবা reopen করতে পারেন",
    en: "Tenants can close or reopen a ticket",
  },
  "support.ticketNotFound": {
    bn: "Ticket পাওয়া যায়নি",
    en: "Ticket not found",
  },
  "support.categoryMustBeOneOf": {
    bn: "category হতে হবে এর যেকোনো একটি {{p1}}",
    en: "category must be one of {{p1}}",
  },
  "support.priorityMustBeOneOf": {
    bn: "priority হতে হবে এর যেকোনো একটি {{p1}}",
    en: "priority must be one of {{p1}}",
  },
  "support.statusMustBeOneOf": {
    bn: "status হতে হবে এর যেকোনো একটি {{p1}}",
    en: "status must be one of {{p1}}",
  },
};
