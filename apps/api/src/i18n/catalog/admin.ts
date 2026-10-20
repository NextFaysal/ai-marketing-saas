/**
 * MB4 (ML10) — admin catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the admin module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const adminCatalog: CatalogNamespace = {
  "admin.aCancelledSubscriptionCannotBePaused": {
    bn: "CANCELLED subscription pause করা যাবে না",
    en: "A CANCELLED subscription cannot be paused",
  },
  "admin.aReasonIsRequiredForEvery": {
    bn: "প্রতিটি admin Brain fix-এর জন্য একটি কারণ দরকার — এটি audit trail-এ হুবহু লিপিবদ্ধ থাকে।",
    en: "A reason is required for every admin Brain fix — it is recorded verbatim in the audit trail.",
  },
  "admin.aReasonIsRequiredForEvery2": {
    bn: "প্রতিটি kill-switch flip-এর জন্য একটি কারণ দরকার — এটি audit trail-এ হুবহু লিপিবদ্ধ থাকে।",
    en: "A reason is required for every kill-switch flip — it is recorded verbatim in the audit trail.",
  },
  "admin.aReasonIsRequiredForThis": {
    bn: "এই admin action-এর জন্য একটি কারণ দরকার (এটি audit trail-এ সংরক্ষিত থাকে)",
    en: "A reason is required for this admin action (it is stored in the audit trail)",
  },
  "admin.aRecipientPhoneNumberIsRequired": {
    bn: "Test-এর জন্য একটি recipient phone number দরকার",
    en: "A recipient phone number is required for the test",
  },
  "admin.aValidRecipientEmailIsRequired": {
    bn: "Test-এর জন্য একটি বৈধ recipient email দরকার",
    en: "A valid recipient email is required for the test",
  },
  "admin.apiKeyNameIsRequiredMin": {
    bn: "API key name দরকার (কমপক্ষে ৩ অক্ষর)",
    en: "API key name is required (min 3 characters)",
  },
  "admin.apiKeyNotFound": {
    bn: "API key পাওয়া যায়নি",
    en: "API key not found",
  },
  "admin.adAccountNotFound": {
    bn: "Ad account পাওয়া যায়নি",
    en: "Ad account not found",
  },
  "admin.anOrganizationMayCarryAtMost": {
    bn: "একটি organization সর্বোচ্চ ২০টি tag বহন করতে পারে",
    en: "An organization may carry at most 20 tags",
  },
  "admin.announcementNotFound": {
    bn: "Announcement পাওয়া যায়নি",
    en: "Announcement not found",
  },
  "admin.announcementTitleAndBodyAreRequired": {
    bn: "Announcement title ও body দরকার",
    en: "Announcement title and body are required",
  },
  "admin.audienceResolvesToRecipientsOverThe": {
    bn: "Audience {{recipientsLength}} জন recipients-এ resolve হয় — ৫০০ safety cap-এর বেশি। Audience সংকীর্ণ করুন।",
    en: "Audience resolves to {{recipientsLength}} recipients — over the 500 safety cap. Narrow the audience.",
  },
  "admin.blueprintKeyIsRequired": {
    bn: "Blueprint key আবশ্যক।",
    en: "Blueprint key is required.",
  },
  "admin.blueprintKeyCannotBeChangedCreate": {
    bn: "Blueprint key বদলানো যায় না — নতুন key চাইলে নতুন Blueprint তৈরি করুন।",
    en: "Blueprint key cannot be changed — create a new Blueprint for a new key.",
  },
  "admin.bulkActionsAreLimitedTo50": {
    bn: "Bulk actions একবারে ৫০টি organization-এ সীমিত",
    en: "Bulk actions are limited to 50 organizations at a time",
  },
  "admin.campaignNotFound": {
    bn: "Campaign পাওয়া যায়নি",
    en: "Campaign not found",
  },
  "admin.campaignSubjectAndBodyAreRequired": {
    bn: "Campaign subject ও body দরকার",
    en: "Campaign subject and body are required",
  },
  "admin.theCampaignblueprintTableWasNotFound": {
    bn: "CampaignBlueprint table পাওয়া যায়নি — Migration বাকি।",
    en: "The CampaignBlueprint table was not found — migration pending.",
  },
  "admin.changelogEntryNotFound": {
    bn: "Changelog entry পাওয়া যায়নি",
    en: "Changelog entry not found",
  },
  "admin.changelogTitleAndBodyAreRequired": {
    bn: "Changelog title ও body দরকার",
    en: "Changelog title and body are required",
  },
  "admin.changingAnAdminSStatusRequires": {
    bn: "একজন admin-এর status বদলাতে SUPER tier লাগে",
    en: "Changing an admin's status requires the SUPER tier",
  },
  "admin.cloudflareForSaasVerificationFailedThe": {
    bn: "Cloudflare for SaaS verification FAILED — setting-টি সেভ হয়নি: {{probeDetail}}",
    en: "Cloudflare for SaaS verification FAILED — the setting was NOT saved: {{probeDetail}}",
  },
  "admin.confirmationFailedTypeTheOrganizationS": {
    bn: "Confirmation ব্যর্থ হয়েছে: permanently delete করতে organization-এর হুবহু নাম লিখুন",
    en: "Confirmation failed: type the organization's exact name to delete it permanently",
  },
  "admin.conversationNotFoundInThisOrganization": {
    bn: "এই organization-এ conversation পাওয়া যায়নি",
    en: "Conversation not found in this organization",
  },
  "admin.customerMemoryNotFound": {
    bn: "Customer memory পাওয়া যায়নি",
    en: "Customer memory not found",
  },
  "admin.eachTagMayBeAtMost": {
    bn: "প্রতিটি tag সর্বোচ্চ ৪০ অক্ষরের হতে পারে",
    en: "Each tag may be at most 40 characters",
  },
  "admin.emailIsNotConfiguredNoCampaign": {
    bn: "Email configure করা নেই — কোনো campaign email পাঠানো হয়নি। ({{configError}})",
    en: "Email is not configured — no campaign email was sent. ({{configError}})",
  },
  "admin.emailTestDidNotSucceed": {
    bn: "Email test সফল হয়নি: {{p1}}",
    en: "Email test did NOT succeed: {{p1}}",
  },
  "admin.everyTagMustBeAString": {
    bn: "প্রতিটি tag একটি string হতে হবে",
    en: "Every tag must be a string",
  },
  "admin.flagKeyIsRequired": {
    bn: "Flag key দরকার",
    en: "Flag key is required",
  },
  "admin.imageProviderVerificationFailedTheSetting": {
    bn: "Image provider verification FAILED — setting-টি সেভ হয়নি: {{message}}",
    en: "Image provider verification FAILED — the setting was NOT saved: {{message}}",
  },
  "admin.imageTestDidNotSucceed": {
    bn: "Image test সফল হয়নি: {{p1}}",
    en: "Image test did NOT succeed: {{p1}}",
  },
  "admin.invalidCidrRangeInEntry": {
    bn: "Entry-তে অবৈধ CIDR range: {{entry}}",
    en: "Invalid CIDR range in entry: {{entry}}",
  },
  "admin.invalidAllowlistEntry": {
    bn: "অবৈধ allowlist entry: {{entry}}",
    en: "Invalid allowlist entry: {{entry}}",
  },
  "admin.llmTestDidNotSucceed": {
    bn: "LLM test সফল হয়নি: {{p1}}",
    en: "LLM test did NOT succeed: {{p1}}",
  },
  "admin.metaAppVerificationFailedTheSetting": {
    bn: "Meta app verification FAILED — setting-টি সেভ হয়নি: {{probeDetail}}",
    en: "Meta app verification FAILED — the setting was NOT saved: {{probeDetail}}",
  },
  "admin.noOwnerAdminEmailRecipientsFound": {
    bn: "এই organization-এর জন্য কোনো OWNER/ADMIN email recipients পাওয়া যায়নি",
    en: "No OWNER/ADMIN email recipients found for this organization",
  },
  "admin.noImageProviderIsConfiguredSet": {
    bn: "কোনো image provider configure করা নেই। আগে উপরে একটি provider + API key সেট করুন (অথবা env-এ IMAGE_PROVIDER/IMAGE_API_KEY)।",
    en: "No image provider is configured. Set a provider + API key above (or IMAGE_PROVIDER/IMAGE_API_KEY in env) first.",
  },
  "admin.noPayoutInstructionExistsForThis": {
    bn: "এই request-এর জন্য কোনো payout instruction নেই",
    en: "No payout instruction exists for this request",
  },
  "admin.noRealLlmIsConfiguredSet": {
    bn: "কোনো real LLM configure করা নেই। আগে উপরে একটি provider + API key সেট করুন (অথবা env-এ LLM_PROVIDER/LLM_API_KEY)।",
    en: "No real LLM is configured. Set a provider + API key above (or LLM_PROVIDER/LLM_API_KEY in env) first.",
  },
  "admin.noRecipientsMatchThisAudience": {
    bn: "এই audience-এর সঙ্গে কোনো recipients মেলে না",
    en: "No recipients match this audience",
  },
  "admin.noSlugTombstoneFoundForThis": {
    bn: "এই নামের কোনো slug tombstone পাওয়া যায়নি",
    en: "No slug tombstone found for this name",
  },
  "admin.noTwoFactorEnrolmentInProgress": {
    bn: "কোনো two-factor enrolment চলছে না। আগে enrolment শুরু করুন।",
    en: "No two-factor enrolment in progress. Start enrolment first.",
  },
  "admin.noteBodyIsRequired": {
    bn: "Note body দরকার",
    en: "Note body is required",
  },
  "admin.nothingToUpdate": {
    bn: "Update করার কিছু নেই",
    en: "Nothing to update",
  },
  "admin.onlyAnActiveUserCanBe": {
    bn: "শুধু একজন ACTIVE user-কেই admin দেওয়া যাবে",
    en: "Only an ACTIVE user can be granted admin",
  },
  "admin.onlyTheSessionSAdminOr": {
    bn: "শুধু session-এর admin (অথবা একজন SUPER admin) এটিকে revoke করতে পারেন",
    en: "Only the session's admin (or a SUPER admin) can revoke it",
  },
  "admin.organizationHasNoSubscriptionToPause": {
    bn: "Organization-এর pause করার মতো কোনো subscription নেই",
    en: "Organization has no subscription to pause",
  },
  "admin.organizationHasNoSubscriptionToResume": {
    bn: "Organization-এর resume করার মতো কোনো subscription নেই",
    en: "Organization has no subscription to resume",
  },
  "admin.organizationNotFound": {
    bn: "Organization পাওয়া যায়নি",
    en: "Organization not found",
  },
  "admin.paymentAmountMustBePositive": {
    bn: "Payment amount ধনাত্মক হতে হবে",
    en: "Payment amount must be positive",
  },
  "admin.paymentNotFound": {
    bn: "Payment পাওয়া যায়নি",
    en: "Payment not found",
  },
  "admin.permanentDeletionRequiresTheOrganizationTo": {
    bn: "Permanent deletion-এর জন্য organization-টিকে আগে DELETED status-এ থাকতে হবে (আগে soft-delete করুন, তার data export করুন, তারপর permanently delete করুন)",
    en: "Permanent deletion requires the organization to be in DELETED status first (soft-delete it, export its data, then delete permanently)",
  },
  "admin.aPlatformBlueprintWithKeyAlready": {
    bn: "Platform blueprint key \"{{key}}\" ইতিমধ্যে আছে।",
    en: "A platform blueprint with key \"{{key}}\" already exists.",
  },
  "admin.platformBlueprintNotFound": {
    bn: "Platform blueprint পাওয়া যায়নি",
    en: "Platform blueprint not found",
  },
  "admin.rateForMustBeANon": {
    bn: "{{provider}}-এর rate একটি অ-ঋণাত্মক সংখ্যা হতে হবে (minor units per 1M tokens)",
    en: "Rate for {{provider}} must be a non-negative number (minor units per 1M tokens)",
  },
  "admin.refundAmountMustBePositive": {
    bn: "Refund amount ধনাত্মক হতে হবে",
    en: "Refund amount must be positive",
  },
  "admin.refundExceedsTheRemainingRefundableAmount": {
    bn: "Refund বাকি refundable amount ছাড়িয়ে গেছে ({{p1}} minor)",
    en: "Refund exceeds the remaining refundable amount ({{p1}} minor)",
  },
  "admin.whenRejectingAReasonNoteMust": {
    bn: "Reject করলে কারণ/নোট লিখতে হবে — মার্চেন্ট সেটি দেখে ঠিক করে আবার জমা দেবেন",
    en: "When rejecting, a reason/note must be written — the merchant will see it, fix it and resubmit",
  },
  "admin.smsTestDidNotSucceed": {
    bn: "SMS test সফল হয়নি: {{p1}}",
    en: "SMS test did NOT succeed: {{p1}}",
  },
  "admin.socialAccountNotFound": {
    bn: "Social account পাওয়া যায়নি",
    en: "Social account not found",
  },
  "admin.socialPostNotFound": {
    bn: "Social post পাওয়া যায়নি",
    en: "Social post not found",
  },
  "admin.storedAnswerNotFound": {
    bn: "Stored answer পাওয়া যায়নি",
    en: "Stored answer not found",
  },
  "admin.stripeVerificationFailedTheSettingWas": {
    bn: "Stripe verification FAILED — setting-টি সেভ হয়নি: Stripe-এর livemode উত্তর key-র mode-এর সঙ্গে অমিল",
    en: "Stripe verification FAILED — the setting was NOT saved: Stripe's livemode answer disagrees with the key's mode",
  },
  "admin.stripeVerificationFailedTheSettingWas2": {
    bn: "Stripe verification FAILED — setting-টি সেভ হয়নি: secret key sk_test_ / sk_live_ (অথবা rk_) দিয়ে শুরু হতে হবে",
    en: "Stripe verification FAILED — the setting was NOT saved: the secret key must start with sk_test_ / sk_live_ (or rk_)",
  },
  "admin.stripeVerificationFailedTheSettingWas3": {
    bn: "Stripe verification FAILED — setting-টি সেভ হয়নি: {{probeDetail}}",
    en: "Stripe verification FAILED — the setting was NOT saved: {{probeDetail}}",
  },
  "admin.teachingItemNotFound": {
    bn: "Teaching item পাওয়া যায়নি",
    en: "Teaching item not found",
  },
  "admin.thatCodeIsIncorrect": {
    bn: "সেই code-টি সঠিক নয়",
    en: "That code is incorrect",
  },
  "admin.thatCodeIsIncorrectCheckThe": {
    bn: "সেই code-টি সঠিক নয় — আপনার device-এর সময় দেখুন এবং আবার চেষ্টা করুন",
    en: "That code is incorrect — check the time on your device and try again",
  },
  "admin.theTargetMemberAccountIsNot": {
    bn: "Target member account সক্রিয় নয়",
    en: "The target member account is not active",
  },
  "admin.thisApiKeyIsAlreadyRevoked": {
    bn: "এই API key ইতিমধ্যে revoked",
    en: "This API key is already revoked",
  },
  "admin.thisIsTheLastActiveSuper": {
    bn: "এটি শেষ সক্রিয় super admin এবং একে revoke করা যাবে না",
    en: "This is the last active super admin and cannot be revoked",
  },
  "admin.thisOrganizationHasCompletedOnboardingNothing": {
    bn: "এই organization onboarding সম্পন্ন করেছে — nudge করার কিছু নেই",
    en: "This organization has completed onboarding — nothing to nudge about",
  },
  "admin.thisOrganizationHasNoActiveMembers": {
    bn: "এই organization-এর দেখার মতো কোনো সক্রিয় সদস্য নেই",
    en: "This organization has no active members to view as",
  },
  "admin.thisPaymentHasAlreadyBeenFully": {
    bn: "এই payment ইতিমধ্যে সম্পূর্ণ refund করা হয়েছে",
    en: "This payment has already been fully refunded",
  },
  "admin.thisSlugWasAlreadyReleased": {
    bn: "এই slug ইতিমধ্যে released",
    en: "This slug was already released",
  },
  "admin.thisSlugSCooldownHasAlready": {
    bn: "এই slug-এর cooldown ইতিমধ্যে শেষ — release-এর দরকার নেই",
    en: "This slug's cooldown has already expired — no release is needed",
  },
  "admin.unknownConfigArea": {
    bn: "অজানা config area: {{area}}",
    en: "Unknown config area: {{area}}",
  },
  "admin.unknownNudgeKind": {
    bn: "অজানা nudge kind: {{kind}}",
    en: "Unknown nudge kind: {{kind}}",
  },
  "admin.unknownPlanTierKnown": {
    bn: "অজানা plan tier \"{{tier}}\" (জানা: {{p2}})",
    en: "Unknown plan tier \"{{tier}}\" (known: {{p2}})",
  },
  "admin.unknownQueueThisSystemHasQueues": {
    bn: "Unknown queue \"{{name}}\" — এই সিস্টেমে queue আছে: {{p2}}",
    en: "Unknown queue \"{{name}}\" — this system has queues: {{p2}}",
  },
  "admin.unknownSettingKey": {
    bn: "অজানা setting key: {{key}}",
    en: "Unknown setting key: {{key}}",
  },
  "admin.userNotFound": {
    bn: "User পাওয়া যায়নি",
    en: "User not found",
  },
  "admin.viewAsIsUnavailableInThis": {
    bn: "এই deployment-এ view-as পাওয়া যাচ্ছে না (token service নেই)",
    en: "View-as is unavailable in this deployment (token service missing)",
  },
  "admin.viewAsSessionNotFound": {
    bn: "View-as session পাওয়া যায়নি",
    en: "View-as session not found",
  },
  "admin.webhookEventNotFound": {
    bn: "Webhook event পাওয়া যায়নি",
    en: "Webhook event not found",
  },
  "admin.writeViewAsSessionsRequireA": {
    bn: "Write view-as sessions-এর জন্য SUPER admin লাগে",
    en: "Write view-as sessions require a SUPER admin",
  },
  "admin.youCannotChangeYourOwnAccount": {
    bn: "আপনি নিজের account status বদলাতে পারবেন না",
    en: "You cannot change your own account status",
  },
  "admin.youCannotRevokeYourOwnAdmin": {
    bn: "আপনি নিজের admin access revoke করতে পারবেন না — অন্য SUPER admin-কে বলুন অথবা CLI ব্যবহার করুন",
    en: "You cannot revoke your own admin access — ask another SUPER admin or use the CLI",
  },
  "admin.aCampaignWithThisCodeAlready": {
    bn: "এই code দিয়ে একটি campaign ইতিমধ্যে আছে",
    en: "a campaign with this code already exists",
  },
  "admin.amountminorMustBeAnIntegerIn": {
    bn: "amountMinor minor units-এ একটি পূর্ণসংখ্যা হতে হবে",
    en: "amountMinor must be an integer in minor units",
  },
  "admin.audienceMustBeAllOrOne": {
    bn: "audience হতে হবে \"all\" অথবা এর যেকোনো একটি {{p1}}",
    en: "audience must be \"all\" or one of {{p1}}",
  },
  "admin.audienceMustBeOneOf": {
    bn: "audience হতে হবে এর যেকোনো একটি {{p1}}",
    en: "audience must be one of {{p1}}",
  },
  "admin.auditretentiondaysMustBeANumberBetween": {
    bn: "auditRetentionDays ৩০ থেকে ৩৬৫০-এর মধ্যে একটি সংখ্যা হতে হবে",
    en: "auditRetentionDays must be a number between 30 and 3650",
  },
  "admin.bkashVerificationFailedTheSettingWas": {
    bn: "bKash verification FAILED — setting-টি সেভ হয়নি: {{probeDetail}}",
    en: "bKash verification FAILED — the setting was NOT saved: {{probeDetail}}",
  },
  "admin.codeMustBe324Chars": {
    bn: "code 3-24 অক্ষরের হতে হবে A-Z, 0-9, - দিয়ে",
    en: "code must be 3-24 chars of A-Z, 0-9, -",
  },
  "admin.codesStartingWithQosAreReserved": {
    bn: "QOS- দিয়ে শুরু হওয়া codes user referral codes-এর জন্য সংরক্ষিত",
    en: "codes starting with QOS- are reserved for user referral codes",
  },
  "admin.contentCannotBeEmpty": {
    bn: "content খালি হতে পারবে না",
    en: "content cannot be empty",
  },
  "admin.contentIsRequired": {
    bn: "content দরকার",
    en: "content is required",
  },
  "admin.contentIsTooLongMax4000": {
    bn: "content খুব লম্বা (সর্বোচ্চ ৪০০০)",
    en: "content is too long (max 4000)",
  },
  "admin.customerkeyIsRequired": {
    bn: "customerKey দরকার",
    en: "customerKey is required",
  },
  "admin.daysMustBe7Or30": {
    bn: "days হতে হবে 7 অথবা 30",
    en: "days must be 7 or 30",
  },
  "admin.decisionMustBeApproveOrReject": {
    bn: "decision হতে হবে \\\"approve\\\" অথবা \\\"reject\\\"",
    en: "decision must be \\\"approve\\\" or \\\"reject\\\"",
  },
  "admin.decisionMustBeApproveOrReject2": {
    bn: "decision হতে হবে approve অথবা reject",
    en: "decision must be approve or reject",
  },
  "admin.disabledMustBeABoolean": {
    bn: "disabled একটি boolean হতে হবে",
    en: "disabled must be a boolean",
  },
  "admin.eachMilestoneNeedsAPositiveCount": {
    bn: "প্রতিটি milestone-এর একটি ধনাত্মক count ও bonusMinor লাগবে",
    en: "each milestone needs a positive count and bonusMinor",
  },
  "admin.enabledMustBeABoolean": {
    bn: "enabled একটি boolean হতে হবে",
    en: "enabled must be a boolean",
  },
  "admin.endsatMustBeAValidIso": {
    bn: "endsAt একটি বৈধ ISO date হতে হবে",
    en: "endsAt must be a valid ISO date",
  },
  "admin.endsatMustBeAfterStartsat": {
    bn: "endsAt startsAt-এর পরে হতে হবে",
    en: "endsAt must be after startsAt",
  },
  "admin.entriesMustBeAnArrayOf": {
    bn: "entries IP অথবা CIDR range-এর array হতে হবে",
    en: "entries must be an array of IPs or CIDR ranges",
  },
  "admin.feebpsMustBeAnInteger0": {
    bn: "feeBps একটি পূর্ণসংখ্যা 0-10000 হতে হবে (basis points)",
    en: "feeBps must be an integer 0-10000 (basis points)",
  },
  "admin.graphversionMustLookLikeV210": {
    bn: "graphVersion v21.0-এর মতো দেখতে হবে",
    en: "graphVersion must look like v21.0",
  },
  "admin.imageProviderMustBeGemini": {
    bn: "image provider হতে হবে gemini",
    en: "image provider must be gemini",
  },
  "admin.killswitchesMustBeAidisabledorgidsStringBroadcastspaused": {
    bn: "killSwitches হতে হবে { aiDisabledOrgIds: string[], broadcastsPaused: boolean }",
    en: "killSwitches must be { aiDisabledOrgIds: string[], broadcastsPaused: boolean }",
  },
  "admin.kindMustBeOneOf": {
    bn: "kind হতে হবে এর যেকোনো একটি {{p1}}",
    en: "kind must be one of {{p1}}",
  },
  "admin.labelIsRequired": {
    bn: "label দরকার",
    en: "label is required",
  },
  "admin.languageMustBeOneOf": {
    bn: "language হতে হবে এর যেকোনো একটি {{p1}}",
    en: "language must be one of {{p1}}",
  },
  "admin.maintenancewindowMustBeNullOrStartsat": {
    bn: "maintenanceWindow হতে হবে null অথবা { startsAt, endsAt, message?, hardLockout? } বৈধ ISO dates সহ",
    en: "maintenanceWindow must be null or { startsAt, endsAt, message?, hardLockout? } with valid ISO dates",
  },
  "admin.maintenancewindowEndsatMustBeAfterStartsat": {
    bn: "maintenanceWindow.endsAt startsAt-এর পরে হতে হবে",
    en: "maintenanceWindow.endsAt must be after startsAt",
  },
  "admin.maintenancewindowHardlockoutMustBeABoolean": {
    bn: "maintenanceWindow.hardLockout একটি boolean হতে হবে",
    en: "maintenanceWindow.hardLockout must be a boolean",
  },
  "admin.maintenancewindowMessageMustBeAString": {
    bn: "maintenanceWindow.message একটি string হতে হবে",
    en: "maintenanceWindow.message must be a string",
  },
  "admin.maxorgsperuserMustBeNullNoLimit": {
    bn: "maxOrgsPerUser হতে হবে null (কোনো limit নেই) অথবা একটি পূর্ণসংখ্যা >= 1",
    en: "maxOrgsPerUser must be null (no limit) or an integer >= 1",
  },
  "admin.methodMustBeOneOf": {
    bn: "method হতে হবে এর যেকোনো একটি {{p1}}",
    en: "method must be one of {{p1}}",
  },
  "admin.modeMustBeFlatPercentPer": {
    bn: "mode হতে হবে flat | percent | per_plan",
    en: "mode must be flat | percent | per_plan",
  },
  "admin.organizationidsIsRequired": {
    bn: "organizationIds দরকার",
    en: "organizationIds is required",
  },
  "admin.pausedMustBeABoolean": {
    bn: "paused একটি boolean হতে হবে",
    en: "paused must be a boolean",
  },
  "admin.payoutfoureyesthresholdminorMustBeANonNegative": {
    bn: "payoutFourEyesThresholdMinor একটি অ-ঋণাত্মক পূর্ণসংখ্যা (minor units) অথবা null হতে হবে",
    en: "payoutFourEyesThresholdMinor must be a non-negative integer (minor units) or null",
  },
  "admin.percentoffirstpaymentMustBe0100": {
    bn: "percentOfFirstPayment 0..100 হতে হবে",
    en: "percentOfFirstPayment must be 0..100",
  },
  "admin.planMustBeOneOf": {
    bn: "plan হতে হবে এর যেকোনো একটি {{p1}}",
    en: "plan must be one of {{p1}}",
  },
  "admin.planflagdefaultsMustBeAnObject": {
    bn: "planFlagDefaults একটি object হতে হবে",
    en: "planFlagDefaults must be an object",
  },
  "admin.planflagdefaultsMustBeAnObjectOf": {
    bn: "planFlagDefaults.{{flag}} tier -> boolean-এর object হতে হবে",
    en: "planFlagDefaults.{{flag}} must be an object of tier -> boolean",
  },
  "admin.planflagdefaultsMustBeABoolean": {
    bn: "planFlagDefaults.{{flag}}.{{tier}} একটি boolean হতে হবে",
    en: "planFlagDefaults.{{flag}}.{{tier}} must be a boolean",
  },
  "admin.planflagdefaultsUnknownTier": {
    bn: "planFlagDefaults.{{flag}}: অজানা tier \"{{tier}}\"",
    en: "planFlagDefaults.{{flag}}: unknown tier \"{{tier}}\"",
  },
  "admin.planflagdefaultsUnknownFlagKnown": {
    bn: "planFlagDefaults: অজানা flag \"{{flag}}\" (জানা: {{p2}})",
    en: "planFlagDefaults: unknown flag \"{{flag}}\" (known: {{p2}})",
  },
  "admin.planlimitsMustBeAnObject": {
    bn: "planLimits একটি object হতে হবে",
    en: "planLimits must be an object",
  },
  "admin.planlimitsMustBeAnObject2": {
    bn: "planLimits.{{tier}} একটি object হতে হবে",
    en: "planLimits.{{tier}} must be an object",
  },
  "admin.planlimitsMustBeANonNegative": {
    bn: "planLimits.{{tier}}.{{field}} একটি অ-ঋণাত্মক পূর্ণসংখ্যা হতে হবে",
    en: "planLimits.{{tier}}.{{field}} must be a non-negative integer",
  },
  "admin.portMustBe165535": {
    bn: "port 1-65535 হতে হবে",
    en: "port must be 1-65535",
  },
  "admin.providerMustBeOpenaiAnthropicGemini": {
    bn: "provider হতে হবে openai | anthropic | gemini | dev",
    en: "provider must be openai | anthropic | gemini | dev",
  },
  "admin.reasonIsTooLongMax500": {
    bn: "reason খুব লম্বা (সর্বোচ্চ ৫০০)",
    en: "reason is too long (max 500)",
  },
  "admin.rewardminorMustBeBetween0And": {
    bn: "rewardMinor 0 থেকে 100000000-এর মধ্যে হতে হবে (minor units)",
    en: "rewardMinor must be between 0 and 100000000 (minor units)",
  },
  "admin.sortorderMustBeAnInteger": {
    bn: "sortOrder একটি পূর্ণসংখ্যা হতে হবে",
    en: "sortOrder must be an integer",
  },
  "admin.startsatMustBeAValidIso": {
    bn: "startsAt একটি বৈধ ISO date হতে হবে",
    en: "startsAt must be a valid ISO date",
  },
  "admin.statusMustBeActiveSuspendedOr": {
    bn: "status হতে হবে ACTIVE, SUSPENDED অথবা DELETED",
    en: "status must be ACTIVE, SUSPENDED or DELETED",
  },
  "admin.statusMustBeOneOf": {
    bn: "status হতে হবে এর যেকোনো একটি {{p1}}",
    en: "status must be one of {{p1}}",
  },
  "admin.supportcontactMustBeAString": {
    bn: "supportContact একটি string হতে হবে",
    en: "supportContact must be a string",
  },
  "admin.tagsMustBeAnArrayOf": {
    bn: "tags strings-এর array হতে হবে",
    en: "tags must be an array of strings",
  },
  "admin.targettypeMustBeUserOrOrganization": {
    bn: "targetType হতে হবে user অথবা organization",
    en: "targetType must be user or organization",
  },
  "admin.tierMustBeSuperSupportOr": {
    bn: "tier হতে হবে SUPER, SUPPORT অথবা FINANCE",
    en: "tier must be SUPER, SUPPORT or FINANCE",
  },
  "admin.titleCannotBeEmpty": {
    bn: "title খালি হতে পারবে না",
    en: "title cannot be empty",
  },
  "admin.titleIsRequired": {
    bn: "title দরকার",
    en: "title is required",
  },
  "admin.titleIsTooLongMax200": {
    bn: "title খুব লম্বা (সর্বোচ্চ ২০০)",
    en: "title is too long (max 200)",
  },
  "admin.whitelabelMustBeABoolean": {
    bn: "whiteLabel একটি boolean হতে হবে",
    en: "whiteLabel must be a boolean",
  },
  "admin.mustBeANonNegativeInteger": {
    bn: "{{field}} একটি অ-ঋণাত্মক পূর্ণসংখ্যা অথবা null হতে হবে",
    en: "{{field}} must be a non-negative integer or null",
  },
  "admin.mustBeABoolean": {
    bn: "{{key}} একটি boolean হতে হবে",
    en: "{{key}} must be a boolean",
  },
  "admin.mustBeAnObject": {
    bn: "{{key}} একটি object হতে হবে",
    en: "{{key}} must be an object",
  },
  "admin.mustBeANonNegativeNumber": {
    bn: "{{key}}.{{tier}} একটি অ-ঋণাত্মক সংখ্যা হতে হবে (minor units)",
    en: "{{key}}.{{tier}} must be a non-negative number (minor units)",
  },
  "admin.mustBeBetween0And100000000": {
    bn: "{{label}} 0 থেকে 100000000-এর মধ্যে হতে হবে (minor units)",
    en: "{{label}} must be between 0 and 100000000 (minor units)",
  },
  "admin.outOfRange": {
    bn: "{{label}} range-এর বাইরে",
    en: "{{label}} out of range",
  },
  "admin.isNotAvailableInThisDeployment": {
    bn: "{{label}} এই deployment-এ উপলব্ধ নয় (service wired নয়) — কোনো retry করা হয়নি।",
    en: "{{label}} is not available in this deployment (service not wired) — no retry was done.",
  },
  "admin.thisPlatformHasNoInsightsSync": {
    bn: "এই Platform-এর ({{p1}}) কোনো insights sync পথ নেই — Sync retry করা যাবে না।",
    en: "This Platform ({{p1}}) has no insights sync path — Sync cannot be retried.",
  },
  "admin.thisPostIsNotInPublishing": {
    bn: "এই পোস্টটি Publishing অবস্থায় নেই (এখন: \"{{postStatus}}\") — stuck recovery শুধু Publishing-এ আটকে থাকা পোস্টের জন্য।",
    en: "This post is not in Publishing status (now: \"{{postStatus}}\") — stuck recovery is only for posts stuck in Publishing.",
  },
  "admin.onlySubmittedPendingApplicationsCanBe": {
    bn: "শুধু জমা পড়া (pending) আবেদনই রিভিউ করা যায়",
    en: "Only submitted (pending) applications can be reviewed",
  },
};
