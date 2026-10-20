/**
 * MB4 (ML10) — automation catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the automation module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const automationCatalog: CatalogNamespace = {
  "automation.adsServiceIsNotAvailableIn": {
    bn: "এই deployment-এ Ads service পাওয়া যাচ্ছে না",
    en: "Ads service is not available in this deployment",
  },
  "automation.audienceServiceIsNotAvailableIn": {
    bn: "এই deployment-এ Audience service পাওয়া যাচ্ছে না",
    en: "Audience service is not available in this deployment",
  },
  "automation.campaignPlanNotFound": {
    bn: "Campaign plan পাওয়া যায়নি",
    en: "Campaign plan not found",
  },
  "automation.campaignsServiceNotAvailable": {
    bn: "Campaigns service পাওয়া যাচ্ছে না",
    en: "Campaigns service not available",
  },
  "automation.connectionMonitorIsNotAvailableIn": {
    bn: "এই deployment-এ Connection monitor পাওয়া যাচ্ছে না",
    en: "Connection monitor is not available in this deployment",
  },
  "automation.courierServiceIsNotAvailableIn": {
    bn: "এই deployment-এ Courier service পাওয়া যাচ্ছে না",
    en: "Courier service is not available in this deployment",
  },
  "automation.deadLetterEntryNotFound": {
    bn: "Dead-letter entry পাওয়া যায়নি",
    en: "Dead-letter entry not found",
  },
  "automation.emailChannelIsNotAvailableIn": {
    bn: "এই deployment-এ Email channel পাওয়া যাচ্ছে না",
    en: "Email channel is not available in this deployment",
  },
  "automation.emailProviderIsNotAvailableIn": {
    bn: "এই deployment-এ Email provider পাওয়া যাচ্ছে না",
    en: "Email provider is not available in this deployment",
  },
  "automation.entryHasNoScheduledJobTo": {
    bn: "Entry-র replay করার মতো কোনো scheduled job নেই",
    en: "Entry has no scheduled job to replay",
  },
  "automation.inboxServiceIsNotAvailableIn": {
    bn: "এই deployment-এ Inbox service পাওয়া যাচ্ছে না",
    en: "Inbox service is not available in this deployment",
  },
  "automation.internalJobSurfaceIsNotConfigured": {
    bn: "Internal job surface configure করা নেই (INTERNAL_JOB_SECRET unset)",
    en: "Internal job surface is not configured (INTERNAL_JOB_SECRET unset)",
  },
  "automation.invalidAction": {
    bn: "অবৈধ action",
    en: "Invalid action",
  },
  "automation.invalidComparator": {
    bn: "অবৈধ comparator",
    en: "Invalid comparator",
  },
  "automation.invalidInternalSecret": {
    bn: "অবৈধ internal secret",
    en: "Invalid internal secret",
  },
  "automation.invalidJobType": {
    bn: "অবৈধ job type",
    en: "Invalid job type",
  },
  "automation.invalidMetric": {
    bn: "অবৈধ metric",
    en: "Invalid metric",
  },
  "automation.jobTemplateNotFound": {
    bn: "Job template পাওয়া যায়নি",
    en: "Job template not found",
  },
  "automation.leadsServiceIsNotAvailableIn": {
    bn: "এই deployment-এ Leads service পাওয়া যাচ্ছে না",
    en: "Leads service is not available in this deployment",
  },
  "automation.messagingServiceIsNotAvailableIn": {
    bn: "এই deployment-এ Messaging service পাওয়া যাচ্ছে না",
    en: "Messaging service is not available in this deployment",
  },
  "automation.noOwnerAdminEmailRecipientsFound": {
    bn: "কোনো OWNER/ADMIN email recipients পাওয়া যায়নি",
    en: "No OWNER/ADMIN email recipients found",
  },
  "automation.noEmailRecipientsFoundForThis": {
    bn: "এই report-এর জন্য কোনো email recipients পাওয়া যায়নি (report recipients, OWNER/ADMIN, billing contacts সব খালি)",
    en: "No email recipients found for this report (report recipients, OWNER/ADMIN, billing contacts all empty)",
  },
  "automation.orderChaseServiceIsNotAvailable": {
    bn: "এই deployment-এ Order chase service পাওয়া যাচ্ছে না",
    en: "Order chase service is not available in this deployment",
  },
  "automation.paymentsServiceIsNotAvailableIn": {
    bn: "এই deployment-এ Payments service পাওয়া যাচ্ছে না",
    en: "Payments service is not available in this deployment",
  },
  "automation.productNotFound": {
    bn: "Product পাওয়া যায়নি",
    en: "Product not found",
  },
  "automation.replenishmentRecordNotFound": {
    bn: "Replenishment record পাওয়া যায়নি",
    en: "Replenishment record not found",
  },
  "automation.reportExportServiceIsNotAvailable": {
    bn: "এই deployment-এ Report export service পাওয়া যাচ্ছে না",
    en: "Report export service is not available in this deployment",
  },
  "automation.reviewsServiceIsNotAvailableIn": {
    bn: "এই deployment-এ Reviews service পাওয়া যাচ্ছে না",
    en: "Reviews service is not available in this deployment",
  },
  "automation.ruleNotFound": {
    bn: "Rule পাওয়া যায়নি",
    en: "Rule not found",
  },
  "automation.savedReportNotFoundForThis": {
    bn: "এই job-এর target-এর জন্য saved report পাওয়া যায়নি",
    en: "Saved report not found for this job's target",
  },
  "automation.scheduledJobNotFound": {
    bn: "Scheduled job পাওয়া যায়নি",
    en: "Scheduled job not found",
  },
  "automation.scheduledJobNotFoundDeleted": {
    bn: "Scheduled job পাওয়া যায়নি (মোছা হয়েছে?)",
    en: "Scheduled job not found (deleted?)",
  },
  "automation.socialCoachServiceIsNotAvailable": {
    bn: "এই deployment-এ Social coach service পাওয়া যাচ্ছে না",
    en: "Social coach service is not available in this deployment",
  },
  "automation.socialCommentsServiceIsNotAvailable": {
    bn: "এই deployment-এ Social comments service পাওয়া যাচ্ছে না",
    en: "Social comments service is not available in this deployment",
  },
  "automation.socialInsightsServiceIsNotAvailable": {
    bn: "এই deployment-এ Social insights service পাওয়া যাচ্ছে না",
    en: "Social insights service is not available in this deployment",
  },
  "automation.socialPublishServiceIsNotAvailable": {
    bn: "এই deployment-এ Social publish service পাওয়া যাচ্ছে না",
    en: "Social publish service is not available in this deployment",
  },
  "automation.socialQueueServiceIsNotAvailable": {
    bn: "এই deployment-এ Social queue service পাওয়া যাচ্ছে না",
    en: "Social queue service is not available in this deployment",
  },
  "automation.socialSyndicationServiceIsNotAvailable": {
    bn: "এই deployment-এ Social syndication service পাওয়া যাচ্ছে না",
    en: "Social syndication service is not available in this deployment",
  },
  "automation.suggestionNotFound": {
    bn: "Suggestion পাওয়া যায়নি",
    en: "Suggestion not found",
  },
  "automation.theScheduledJobNoLongerExists": {
    bn: "Scheduled job-টি আর নেই",
    en: "The scheduled job no longer exists",
  },
  "automation.thisEntryWasAlreadyReplayed": {
    bn: "এই entry ইতিমধ্যে replay করা হয়েছে",
    en: "This entry was already replayed",
  },
  "automation.unknownJobType": {
    bn: "অজানা job type: {{jobType}}",
    en: "Unknown job type: {{jobType}}",
  },
  "automation.unknownWebhookSource": {
    bn: "অজানা webhook source: {{source}}",
    en: "Unknown webhook source: {{source}}",
  },
  "automation.walletServiceIsNotAvailableIn": {
    bn: "এই deployment-এ Wallet service পাওয়া যাচ্ছে না",
    en: "Wallet service is not available in this deployment",
  },
  "automation.eventidIsRequiredForWoocommerce": {
    bn: "woocommerce-এর জন্য eventId দরকার",
    en: "eventId is required for woocommerce",
  },
  "automation.intervalminutesMustBeAtLeast1": {
    bn: "intervalMinutes কমপক্ষে ১ হতে হবে",
    en: "intervalMinutes must be at least 1",
  },
  "automation.modeMustBeExecuteOrSuggest": {
    bn: "mode হতে হবে execute অথবা suggest",
    en: "mode must be execute or suggest",
  },
  "automation.scaleBudgetNeedsActionconfigPercentBetween": {
    bn: "scale_budget-এর জন্য actionConfig.percent -90 থেকে 200-এর মধ্যে লাগবে",
    en: "scale_budget needs actionConfig.percent between -90 and 200",
  },
  "automation.scheduledjobidIsRequired": {
    bn: "scheduledJobId দরকার",
    en: "scheduledJobId is required",
  },
  "automation.sourceAndIntegrationidAreRequired": {
    bn: "source ও integrationId দরকার",
    en: "source and integrationId are required",
  },
  "automation.thresholdMustBeNumeric": {
    bn: "threshold সংখ্যা হতে হবে",
    en: "threshold must be numeric",
  },
  "automation.aJobForThisTemplateAlready": {
    bn: "এই টেমপ্লেটের Job ইতিমধ্যে তৈরি আছে",
    en: "A Job for this template already exists",
  },
  "automation.thisSuggestionIsAlreadyADecision": {
    bn: "এই সাজেশন ইতিমধ্যে \"{{suggestionStatus}}\" — আবার সিদ্ধান্ত নেওয়া যাবে না",
    en: "This suggestion is already \"{{suggestionStatus}}\" — a decision cannot be taken again",
  },
  "automation.someoneElseHasAlreadyDecidedOn": {
    bn: "এই সাজেশনে ইতিমধ্যে অন্য কেউ সিদ্ধান্ত নিয়েছেন",
    en: "Someone else has already decided on this suggestion",
  },
};
