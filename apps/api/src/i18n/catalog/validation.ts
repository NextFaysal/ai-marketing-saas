/**
 * ML10 catalog namespace: validation — generic per-constraint
 * messages produced by the ValidationPipe exceptionFactory
 * (D-MB4-4). Params: {{property}} always; {{limit}} for the
 * length/min/max family when class-validator's default text
 * carries the bound.
 */
import type { CatalogNamespace } from "./types";

export const validationCatalog: CatalogNamespace = {
  "validation.custom": { bn: "{{message}}", en: "{{message}}" },
  "validation.invalid": { bn: "পাঠানো তথ্য সঠিক নয় — অনুগ্রহ করে যাচাই করে আবার চেষ্টা করুন", en: "The submitted data is invalid — please check it and try again" },
  "validation.isString": { bn: "{{property}} অবশ্যই লেখা (টেক্সট) হতে হবে", en: "{{property}} must be a string" },
  "validation.isNotEmpty": { bn: "{{property}} খালি রাখা যাবে না", en: "{{property}} must not be empty" },
  "validation.isNotEmptyObject": { bn: "{{property}} খালি রাখা যাবে না", en: "{{property}} must not be empty" },
  "validation.isEmpty": { bn: "{{property}} খালি থাকতে হবে", en: "{{property}} must be empty" },
  "validation.isEmail": { bn: "{{property}} সঠিক ইমেইল ঠিকানা হতে হবে", en: "{{property}} must be a valid email address" },
  "validation.isEnum": { bn: "{{property}}-এর মান সঠিক নয়", en: "{{property}} has an invalid value" },
  "validation.isIn": { bn: "{{property}}-এর মান সঠিক নয়", en: "{{property}} has an invalid value" },
  "validation.isBoolean": { bn: "{{property}} অবশ্যই সত্য/মিথ্যা (boolean) হতে হবে", en: "{{property}} must be a boolean" },
  "validation.isInt": { bn: "{{property}} অবশ্যই পূর্ণ সংখ্যা হতে হবে", en: "{{property}} must be an integer" },
  "validation.isNumber": { bn: "{{property}} অবশ্যই সংখ্যা হতে হবে", en: "{{property}} must be a number" },
  "validation.isPositive": { bn: "{{property}} অবশ্যই ধনাত্মক সংখ্যা হতে হবে", en: "{{property}} must be a positive number" },
  "validation.min": { bn: "{{property}} কমপক্ষে {{limit}} হতে হবে", en: "{{property}} must not be less than {{limit}}" },
  "validation.max": { bn: "{{property}} সর্বোচ্চ {{limit}} হতে পারে", en: "{{property}} must not be greater than {{limit}}" },
  "validation.minLength": { bn: "{{property}} কমপক্ষে {{limit}} অক্ষরের হতে হবে", en: "{{property}} must be longer than or equal to {{limit}} characters" },
  "validation.maxLength": { bn: "{{property}} সর্বোচ্চ {{limit}} অক্ষরের হতে পারে", en: "{{property}} must be shorter than or equal to {{limit}} characters" },
  "validation.length": { bn: "{{property}}-এর দৈর্ঘ্য সঠিক নয় (কমপক্ষে {{limit}} অক্ষর)", en: "{{property}} has an invalid length (at least {{limit}} characters)" },
  "validation.isArray": { bn: "{{property}} অবশ্যই তালিকা (array) হতে হবে", en: "{{property}} must be an array" },
  "validation.arrayMinSize": { bn: "{{property}}-তে কমপক্ষে {{limit}}টি আইটেম থাকতে হবে", en: "{{property}} must contain at least {{limit}} items" },
  "validation.arrayMaxSize": { bn: "{{property}}-তে সর্বোচ্চ {{limit}}টি আইটেম থাকতে পারে", en: "{{property}} must contain no more than {{limit}} items" },
  "validation.arrayNotEmpty": { bn: "{{property}} খালি তালিকা হতে পারবে না", en: "{{property}} must not be an empty array" },
  "validation.isDateString": { bn: "{{property}} সঠিক তারিখ হতে হবে", en: "{{property}} must be a valid date string" },
  "validation.isDate": { bn: "{{property}} সঠিক তারিখ হতে হবে", en: "{{property}} must be a valid date" },
  "validation.isUrl": { bn: "{{property}} সঠিক URL হতে হবে", en: "{{property}} must be a valid URL" },
  "validation.matches": { bn: "{{property}}-এর ফরম্যাট সঠিক নয়", en: "{{property}} has an invalid format" },
  "validation.isUUID": { bn: "{{property}} সঠিক আইডি হতে হবে", en: "{{property}} must be a valid id" },
  "validation.isObject": { bn: "{{property}} সঠিক আকারে পাঠাতে হবে", en: "{{property}} must be an object" },
  "validation.isDefined": { bn: "{{property}} আবশ্যক", en: "{{property}} is required" },
  "validation.isOptional": { bn: "{{property}} সঠিক নয়", en: "{{property}} is invalid" },
  "validation.whitelistValidation": { bn: "{{property}} এই ফিল্ডটি অনুমোদিত নয়", en: "{{property}} is not an allowed field" },
  "validation.isPhoneNumber": { bn: "{{property}} সঠিক ফোন নম্বর হতে হবে", en: "{{property}} must be a valid phone number" },
  "validation.isISO8601": { bn: "{{property}} সঠিক তারিখ-সময় হতে হবে", en: "{{property}} must be a valid date-time" },
  "validation.isMilitaryTime": { bn: "{{property}} সঠিক সময় (HH:mm) হতে হবে", en: "{{property}} must be a valid time (HH:mm)" },
  "validation.isDataURI": { bn: "{{property}} সঠিক ফরম্যাটে পাঠাতে হবে", en: "{{property}} must be in a valid format" },
  "validation.isBase64": { bn: "{{property}} সঠিক ফরম্যাটে পাঠাতে হবে", en: "{{property}} must be in a valid format" },
  "validation.isJSON": { bn: "{{property}} সঠিক JSON হতে হবে", en: "{{property}} must be valid JSON" },
  "validation.minDate": { bn: "{{property}}-এর তারিখ খুব আগের", en: "{{property}} is too early" },
  "validation.maxDate": { bn: "{{property}}-এর তারিখ খুব পরের", en: "{{property}} is too late" },
};
