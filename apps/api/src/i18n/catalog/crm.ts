/**
 * MB4 (ML10) — crm catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the crm module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const crmCatalog: CatalogNamespace = {
  "crm.aFieldWithKeyAlreadyExists": {
    bn: "একটি \"{{dtoEntity}}\" field যার key \"{{key}}\" ইতিমধ্যে আছে{{p3}} — keys সংরক্ষিত থাকে যাতে stored values তাদের অর্থ ধরে রাখে",
    en: "A \"{{dtoEntity}}\" field with key \"{{key}}\" already exists{{p3}} — keys stay reserved so stored values keep their meaning",
  },
  "crm.aSelectFieldNeedsAtLeast": {
    bn: "একটি select field-এর কমপক্ষে একটি option লাগবে",
    en: "A select field needs at least one option",
  },
  "crm.atMostRowsCanBeImported": {
    bn: "CSV-তে সর্বোচ্চ {{LEAD_IMPORT_ROW_CAP}}টি সারি আমদানি করা যায় (এই ফাইলে {{totalRows}}টি)। ফাইলটি ভাগ করে আবার চেষ্টা করুন।",
    en: "At most {{LEAD_IMPORT_ROW_CAP}} rows can be imported from a CSV (this file has {{totalRows}}). Split the file and try again.",
  },
  "crm.cannotMergeALeadIntoItself": {
    bn: "একটি lead-কে নিজের মধ্যেই merge করা যাবে না",
    en: "Cannot merge a lead into itself",
  },
  "crm.customFieldIsRequired": {
    bn: "Custom field \"{{defLabel}}\" দরকার",
    en: "Custom field \"{{defLabel}}\" is required",
  },
  "crm.customFieldHasAnUnknownType": {
    bn: "Custom field \"{{label}}\"-এর একটি অজানা type \"{{defType}}\" আছে",
    en: "Custom field \"{{label}}\" has an unknown type \"{{defType}}\"",
  },
  "crm.customFieldIsTooLongMax": {
    bn: "Custom field \"{{label}}\" খুব লম্বা (সর্বোচ্চ {{CUSTOM_FIELD_TEXT_MAX}} অক্ষর)",
    en: "Custom field \"{{label}}\" is too long (max {{CUSTOM_FIELD_TEXT_MAX}} characters)",
  },
  "crm.customFieldMustBeADate": {
    bn: "Custom field \"{{label}}\" YYYY-MM-DD format-এ একটি date হতে হবে",
    en: "Custom field \"{{label}}\" must be a date in YYYY-MM-DD format",
  },
  "crm.customFieldMustBeANumber": {
    bn: "Custom field \"{{label}}\" একটি number হতে হবে",
    en: "Custom field \"{{label}}\" must be a number",
  },
  "crm.customFieldMustBeOneOf": {
    bn: "Custom field \"{{label}}\" হতে হবে এর যেকোনো একটি: {{p2}}",
    en: "Custom field \"{{label}}\" must be one of: {{p2}}",
  },
  "crm.customFieldMustBeText": {
    bn: "Custom field \"{{label}}\" text হতে হবে",
    en: "Custom field \"{{label}}\" must be text",
  },
  "crm.customFieldNotFoundInThis": {
    bn: "এই organization-এ custom field পাওয়া যায়নি",
    en: "Custom field not found in this organization",
  },
  "crm.customFieldsAreNotAvailableIn": {
    bn: "এই deployment-এ custom fields পাওয়া যাচ্ছে না",
    en: "Custom fields are not available in this deployment",
  },
  "crm.fieldKeyCannotBeChangedStored": {
    bn: "Field key \"{{defKey}}\" বদলানো যাবে না — stored values এটিকে reference করে। বদলে এই field-টি archive করুন এবং নতুন একটি তৈরি করুন।",
    en: "Field key \"{{defKey}}\" cannot be changed — stored values reference it. Archive this field and create a new one instead.",
  },
  "crm.fieldLabelCannotBeEmpty": {
    bn: "Field label খালি হতে পারবে না",
    en: "Field label cannot be empty",
  },
  "crm.fieldLabelIsRequired": {
    bn: "Field label দরকার",
    en: "Field label is required",
  },
  "crm.invalidEntityUseLeadCustomer": {
    bn: "অবৈধ entity: \"{{entity}}\" (lead, customer ব্যবহার করুন)",
    en: "Invalid entity: \"{{entity}}\" (use lead, customer)",
  },
  "crm.invalidFieldKeyAKeyMust": {
    bn: "অবৈধ field key: \"{{p1}}\" — একটি key অবশ্যই একটি letter দিয়ে শুরু হতে হবে এবং শুধু a-z, 0-9 ও _ ব্যবহার করতে হবে (না দিলে এটি label থেকে তৈরি হয়)",
    en: "Invalid field key: \"{{p1}}\" — a key must start with a letter and use only a-z, 0-9 and _ (it is derived from the label when not supplied)",
  },
  "crm.invalidFieldTypeUse": {
    bn: "অবৈধ field type: \"{{dtoType}}\" ({{p2}} ব্যবহার করুন)",
    en: "Invalid field type: \"{{dtoType}}\" (use {{p2}})",
  },
  "crm.invalidSource": {
    bn: "অবৈধ source",
    en: "Invalid source",
  },
  "crm.invalidStage": {
    bn: "অবৈধ stage",
    en: "Invalid stage",
  },
  "crm.leadNotFoundInThisOrganization": {
    bn: "এই organization-এ lead পাওয়া যায়নি",
    en: "Lead not found in this organization",
  },
  "crm.selectOptionsAreLimitedTo100": {
    bn: "Select options প্রতিটি ১০০ অক্ষরে সীমিত",
    en: "Select options are limited to 100 characters each",
  },
  "crm.sourceLeadIsAlreadyMerged": {
    bn: "Source lead ইতিমধ্যে merged",
    en: "Source lead is already merged",
  },
  "crm.targetLeadIsItselfMergedInto": {
    bn: "Target lead নিজেই অন্য একটি lead-এ merged",
    en: "Target lead is itself merged into another lead",
  },
  "crm.unknownCustomFieldFor": {
    bn: "অজানা custom field: {{entity}}-এর জন্য \"{{key}}\"",
    en: "Unknown custom field: \"{{key}}\" for {{entity}}",
  },
  "crm.customfieldsMustBeAnObjectKeyed": {
    bn: "customFields field key দিয়ে keyed একটি object হতে হবে",
    en: "customFields must be an object keyed by field key",
  },
  "crm.daysMustBeAnIntegerBetween": {
    bn: "days ১ থেকে ৩৬৫-এর মধ্যে একটি পূর্ণসংখ্যা হতে হবে",
    en: "days must be an integer between 1 and 365",
  },
  "crm.leadassignstrategyMustBeOffRoundRobin": {
    bn: "leadAssignStrategy হতে হবে off | round_robin | least_open_leads",
    en: "leadAssignStrategy must be off | round_robin | least_open_leads",
  },
  "crm.sortorderMustBeAnInteger": {
    bn: "sortOrder একটি পূর্ণসংখ্যা হতে হবে",
    en: "sortOrder must be an integer",
  },
};
