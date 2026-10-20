/**
 * MB4 — finance catalog namespace (W-3 owned).
 *
 * Pure data: finance-module user-visible exception texts
 * (expenses, ledgers, OU7 accounting / bank reconciliation,
 * scheduled-report validation — the D-MB4-3 selective plain-
 * Error conversion proof case) and the scheduled-report email
 * subject/body. Report DOCUMENT labels live in documents.ts.
 *
 * bn text is faithful to the pre-MB4 originals (the finance
 * module was BN-only); en text is the translation.
 */
export const FINANCE_CATALOG = {
  // ---- finance-common range validation ----
  "finance.range.startDateInvalid": { bn: "শুরুর তারিখটি সঠিক নয়", en: "The start date is not valid" },
  "finance.range.endDateInvalid": { bn: "শেষের তারিখটি সঠিক নয়", en: "The end date is not valid" },
  "finance.range.startAfterEnd": { bn: "শুরুর তারিখ শেষের তারিখের পরে হতে পারে না", en: "The start date cannot be after the end date" },
  "finance.range.tooLong": { bn: "একবারে সর্বোচ্চ ৩৬৬ দিনের রিপোর্ট দেখা যাবে", en: "A report can cover at most 366 days at a time" },
  "finance.reportTypeNotFound": { bn: "রিপোর্টের ধরনটি পাওয়া যায়নি", en: "Report type not found" },
  "finance.ledgerTypeNotFound": { bn: "লেজারের ধরনটি পাওয়া যায়নি", en: "Ledger type not found" },
  // ---- finance.service expenses ----
  "finance.expense.dateFormat": { bn: "খরচের তারিখ YYYY-MM-DD আকারে দিন", en: "Give the expense date in YYYY-MM-DD format" },
  "finance.expense.dateInvalid": { bn: "খরচের তারিখটি সঠিক নয়", en: "The expense date is not valid" },
  "finance.expense.amountNotNumber": { bn: "পরিমাণটি সঠিক সংখ্যা নয়", en: "The amount is not a valid number" },
  "finance.expense.amountMustBePositive": { bn: "পরিমাণ শূন্যের বেশি হতে হবে", en: "The amount must be greater than zero" },
  "finance.expense.amountTooLarge": { bn: "পরিমাণটি অস্বাভাবিক বড়", en: "The amount is unusually large" },
  "finance.expense.categoryFromList": { bn: "খরচের শ্রেণিটি তালিকা থেকে বেছে নিন", en: "Choose the expense category from the list" },
  "finance.expense.noteMustBeString": { bn: "নোট লেখা হতে হবে", en: "The note must be text" },
  "finance.expense.paymentMethodFromList": { bn: "পরিশোধের মাধ্যমটি তালিকা থেকে বেছে নিন", en: "Choose the payment method from the list" },
  "finance.expense.receiptUrlInvalid": { bn: "রসিদের লিংকটি সঠিক URL নয়", en: "The receipt link is not a valid URL" },
  "finance.expense.receiptUrlMustBeHttp": { bn: "রসিদের লিংক http(s) হতে হবে", en: "The receipt link must be http(s)" },
  "finance.expense.notFound": { bn: "খরচের রেকর্ডটি পাওয়া যায়নি", en: "Expense record not found" },
  // ---- scheduled-reports validation + email ----
  "finance.scheduled.recipientsListRequired": { bn: "প্রাপকের ইমেইল তালিকা দিন", en: "Provide the recipient email list" },
  "finance.scheduled.atLeastOneRecipient": { bn: "অন্তত একজন প্রাপকের ইমেইল দিন", en: "Provide at least one recipient email" },
  "finance.scheduled.maxRecipients": { bn: "সর্বোচ্চ ১০ জন প্রাপক যোগ করা যাবে", en: "At most 10 recipients can be added" },
  "finance.scheduled.emailInvalid": { bn: "ইমেইল ঠিকানাটি সঠিক নয়: {{email}}", en: "The email address is not valid: {{email}}" },
  "finance.scheduled.reportTypeFromList": { bn: "রিপোর্টের ধরনটি তালিকা থেকে বেছে নিন", en: "Choose the report type from the list" },
  "finance.scheduled.cadenceInvalid": { bn: "পাঠানোর ব্যবধান daily বা weekly হতে হবে", en: "The cadence must be daily or weekly" },
  "finance.scheduled.formatInvalid": { bn: "ফরম্যাট csv বা xlsx হতে হবে", en: "The format must be csv or xlsx" },
  "finance.scheduled.notFound": { bn: "নির্ধারিত রিপোর্টটি পাওয়া যায়নি", en: "Scheduled report not found" },
  "finance.scheduled.emailSubject": { bn: "রিপোর্ট: {{label}} ({{period}})", en: "Report: {{label}} ({{period}})" },
  "finance.scheduled.emailBody": {
    bn: "{{summary}}\n\nসম্পূর্ণ রিপোর্টটি এই ইমেইলে সংযুক্ত (attachment) করা হয়েছে: {{filename}}",
    en: "{{summary}}\n\nThe full report is attached to this email: {{filename}}",
  },
  // ---- OU7 accounting ----
  "finance.accounting.mappingMissing": { bn: "অ্যাকাউন্ট ম্যাপিংয়ে নেই: {{name}}", en: "Not in the account mapping: {{name}}" },
  "finance.accounting.manualEntryMinLines": { bn: "ম্যানুয়াল এন্ট্রিতে অন্তত ২টি সারি লাগবে", en: "A manual entry needs at least 2 lines" },
  "finance.accounting.codeNotInChart": { bn: "অ্যাকাউন্ট কোডটি চার্টে নেই: {{code}}", en: "The account code is not in the chart: {{code}}" },
  "finance.accounting.debitCreditNegative": { bn: "ডেবিট/ক্রেডিট ঋণাত্মক হতে পারে না", en: "Debit/credit cannot be negative" },
  "finance.accounting.debitXorCredit": { bn: "প্রতি সারিতে ডেবিট অথবা ক্রেডিট — ঠিক একটিই থাকবে", en: "Each line must carry exactly one of debit or credit" },
  "finance.accounting.entryNotBalanced": { bn: "এন্ট্রিটি ব্যালান্স হয়নি — মোট ডেবিট ও মোট ক্রেডিট সমান হতে হবে", en: "The entry does not balance — total debit and total credit must be equal" },
  // ---- OU7 bank reconciliation ----
  "finance.bankRecon.amountInvalid": { bn: "পরিমাণটি সঠিক নয়: {{raw}}", en: "The amount is not valid: {{raw}}" },
  "finance.bankRecon.csvTextRequired": { bn: "স্টেটমেন্ট CSV টেক্সট দিন", en: "Provide the statement CSV text" },
  "finance.bankRecon.csvColumnRequired": { bn: "CSV-তে '{{column}}' কলামটি থাকতে হবে (date, description, amount[, reference])", en: "The CSV must contain the '{{column}}' column (date, description, amount[, reference])" },
  "finance.bankRecon.amountZero": { bn: "পরিমাণ শূন্য হতে পারে না", en: "The amount cannot be zero" },
  "finance.bankRecon.descriptionEmpty": { bn: "বিবরণ খালি", en: "Description is empty" },
  "finance.bankRecon.noRowImported": { bn: "একটি সারিও import হয়নি — প্রথম ত্রুটি: {{error}}", en: "No row was imported — first error: {{error}}" },
  "finance.bankRecon.lineNotFound": { bn: "স্টেটমেন্ট সারিটি পাওয়া যায়নি", en: "Statement line not found" },
  "finance.bankRecon.lineAlreadyMatched": { bn: "এই সারিটি ইতিমধ্যে মেলানো হয়েছে", en: "This line has already been matched" },
  "finance.bankRecon.suggestedMatchNotFound": { bn: "প্রস্তাবিত মিলটি পাওয়া যায়নি — পরিমাণ হুবহু ও তারিখ ±৭ দিনের মধ্যে থাকতে হবে", en: "The suggested match was not found — the amount must match exactly and the date must be within ±7 days" },
  "finance.bankRecon.lineNotMatched": { bn: "এই সারিটি মেলানো অবস্থায় নেই", en: "This line is not in a matched state" },
} as const;

export type FinanceCatalogKey = keyof typeof FINANCE_CATALOG;

/** Coordinator wiring alias (catalog/index.ts convention). */
export const financeCatalog = FINANCE_CATALOG;
