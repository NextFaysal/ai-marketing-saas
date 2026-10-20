/**
 * MB4 (ML10) — ai catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the ai module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const aiCatalog: CatalogNamespace = {
  "ai.aLandingLinkIsRequiredPass": {
    bn: "একটি landing link দরকার: linkUrl পাঠান অথবা Business Knowledge-তে business website URL সেট করুন",
    en: "A landing link is required: pass linkUrl or set the business website URL in Business Knowledge",
  },
  "ai.apiKeyNotFound": {
    bn: "API key পাওয়া যায়নি",
    en: "API key not found",
  },
  "ai.actionProposalNotFound": {
    bn: "Action proposal পাওয়া যায়নি",
    en: "Action proposal not found",
  },
  "ai.adSetNotFound": {
    bn: "Ad set পাওয়া যায়নি",
    en: "Ad set not found",
  },
  "ai.adSetNotFoundInThis": {
    bn: "এই organization-এ ad set পাওয়া যায়নি",
    en: "Ad set not found in this organization",
  },
  "ai.answerStoreRefusedThisSuggestion": {
    bn: "Answer Store এই suggestion প্রত্যাখ্যান করেছে: {{resultReason}}",
    en: "Answer Store refused this suggestion: {{resultReason}}",
  },
  "ai.brandVoiceProfileIsAlreadyActive": {
    bn: "Brand voice profile ইতিমধ্যে সক্রিয়",
    en: "Brand voice profile is already active",
  },
  "ai.brandVoiceProfileNotFound": {
    bn: "Brand voice profile পাওয়া যায়নি",
    en: "Brand voice profile not found",
  },
  "ai.broadcastBodyIsRequired": {
    bn: "Broadcast body দরকার",
    en: "Broadcast body is required",
  },
  "ai.aBroadcastDraftNeedsAName": {
    bn: "Broadcast draft-এর একটি নাম দরকার",
    en: "A Broadcast draft needs a name",
  },
  "ai.csv": {
    bn: "CSV ফাইল থেকে কোনো লেখা পাওয়া যায়নি",
    en: "CSV ফাইল থেকে কোনো লেখা পাওয়া যায়নি",
  },
  "ai.csvUtf8": {
    bn: "CSV ফাইলটি পাঠযোগ্য টেক্সট (UTF-8) নয়",
    en: "CSV ফাইলটি পাঠযোগ্য টেক্সট (UTF-8) নয়",
  },
  "ai.campaignPlanNotFoundInThis": {
    bn: "এই organization-এ campaign plan পাওয়া যায়নি",
    en: "Campaign plan not found in this organization",
  },
  "ai.campaignsServiceIsNotAvailableIn": {
    bn: "এই context-এ campaigns service পাওয়া যাচ্ছে না",
    en: "Campaigns service is not available in this context",
  },
  "ai.commentNotFoundInThisOrganization": {
    bn: "এই organization-এ comment পাওয়া যায়নি",
    en: "Comment not found in this organization",
  },
  "ai.conversationNotFound": {
    bn: "Conversation পাওয়া যায়নি",
    en: "Conversation not found",
  },
  "ai.conversationNotFoundInThisOrganization": {
    bn: "এই organization-এ conversation পাওয়া যায়নি",
    en: "Conversation not found in this organization",
  },
  "ai.customerMemoryNotFound": {
    bn: "Customer memory পাওয়া যায়নি",
    en: "Customer memory not found",
  },
  "ai.dailyAiGenerationLimitReachedFor": {
    bn: "এই organization-এর জন্য daily AI generation limit পূর্ণ হয়েছে ({{limit}})। আগামীকাল আবার চেষ্টা করুন অথবা platform team-কে আপনার plan limit বাড়াতে বলুন।",
    en: "Daily AI generation limit reached for this organization ({{limit}}). Try again tomorrow or ask the platform team to raise your plan limit.",
  },
  "ai.dailyAiLimitReachedForThis": {
    bn: "এই organization-এর জন্য daily AI limit পূর্ণ হয়েছে ({{limit}})। আগামীকাল আবার চেষ্টা করুন অথবা platform team-কে আপনার plan limit বাড়াতে বলুন।",
    en: "Daily AI limit reached for this organization ({{limit}}). Try again tomorrow or ask the platform team to raise your plan limit.",
  },
  "ai.dailyAiMessageLimitReachedFor": {
    bn: "এই organization-এর জন্য daily AI message limit পূর্ণ হয়েছে ({{limit}})। আগামীকাল আবার চেষ্টা করুন অথবা platform team-কে আপনার plan limit বাড়াতে বলুন।",
    en: "Daily AI message limit reached for this organization ({{limit}}). Try again tomorrow or ask the platform team to raise your plan limit.",
  },
  "ai.emailBroadcastsNeedASubject": {
    bn: "Email broadcast-এর জন্য subject লাগবে",
    en: "Email broadcasts need a subject",
  },
  "ai.invalidCalltoactionMustBeOneOf": {
    bn: "অবৈধ callToAction \"{{callToAction}}\"। হতে হবে এর যেকোনো একটি: {{p2}}",
    en: "Invalid callToAction \"{{callToAction}}\". Must be one of: {{p2}}",
  },
  "ai.invalidNewprice": {
    bn: "অবৈধ newPrice: {{dtoNewPrice}}",
    en: "Invalid newPrice: {{dtoNewPrice}}",
  },
  "ai.invalidOrRevokedApiKey": {
    bn: "অবৈধ অথবা revoked API key",
    en: "Invalid or revoked API key",
  },
  "ai.invalidStatus": {
    bn: "অবৈধ status",
    en: "Invalid status",
  },
  "ai.theLlmGaveNoValidDescription": {
    bn: "LLM কোনো বৈধ description দেয়নি — কিছুই সংরক্ষণ করা হয়নি।",
    en: "The LLM gave no valid description — nothing was saved.",
  },
  "ai.theCopyFromTheLlmCould": {
    bn: "LLM থেকে পাওয়া কপি JSON হিসেবে পড়া যায়নি — কিছুই সংরক্ষণ করা হয়নি।",
    en: "The copy from the LLM could not be read as JSON — nothing was saved.",
  },
  "ai.theLlmServiceIsNotAvailable": {
    bn: "LLM সেবা এই context-এ পাওয়া যাচ্ছে না — কপি তৈরি করা যাবে না।",
    en: "The LLM service is not available in this context — copy cannot be generated.",
  },
  "ai.leadNotFoundInThisOrganization": {
    bn: "এই organization-এ lead পাওয়া যায়নি",
    en: "Lead not found in this organization",
  },
  "ai.learnedItemIsAlready": {
    bn: "Learned item ইতিমধ্যে {{itemStatus}}",
    en: "Learned item is already {{itemStatus}}",
  },
  "ai.learnedItemNotFound": {
    bn: "Learned item পাওয়া যায়নি",
    en: "Learned item not found",
  },
  "ai.listingNotFoundInThisOrganization": {
    bn: "এই organization-এ listing পাওয়া যায়নি",
    en: "Listing not found in this organization",
  },
  "ai.nothingToDismissTheActiveProfile": {
    bn: "Dismiss করার কিছু নেই: সক্রিয় profile-এ কোনো pending suggestion নেই",
    en: "Nothing to dismiss: the active profile has no pending suggestion",
  },
  "ai.nothingToUpdateSendTitlePinned": {
    bn: "Update করার কিছু নেই: title, pinned অথবা/এবং persona পাঠান",
    en: "Nothing to update: send title, pinned and/or persona",
  },
  "ai.orderNotFoundInThisOrganization": {
    bn: "এই organization-এ order পাওয়া যায়নি",
    en: "Order not found in this organization",
  },
  "ai.productNotFoundInThisOrganization": {
    bn: "এই organization-এ product পাওয়া যায়নি",
    en: "Product not found in this organization",
  },
  "ai.promptNotFound": {
    bn: "Prompt পাওয়া যায়নি",
    en: "Prompt not found",
  },
  "ai.thePromptBodyCannotBeLeft": {
    bn: "Prompt-এর body খালি রাখা যাবে না।",
    en: "The Prompt body cannot be left empty.",
  },
  "ai.bothThePromptTitleAndBody": {
    bn: "Prompt-এর title ও body দুটোই লাগবে।",
    en: "Both the Prompt title and body are needed.",
  },
  "ai.thePromptTitleCannotBeLeft": {
    bn: "Prompt-এর title খালি রাখা যাবে না।",
    en: "The Prompt title cannot be left empty.",
  },
  "ai.proposalNotFound": {
    bn: "Proposal পাওয়া যায়নি",
    en: "Proposal not found",
  },
  "ai.publishingServiceIsNotAvailableIn": {
    bn: "এই context-এ publishing service পাওয়া যাচ্ছে না",
    en: "Publishing service is not available in this context",
  },
  "ai.quickReplyContentIsNeeded": {
    bn: "Quick reply-এর content দরকার",
    en: "Quick reply content is needed",
  },
  "ai.quickReplyNeedsATitle": {
    bn: "Quick reply-এর একটি title দরকার",
    en: "Quick reply needs a title",
  },
  "ai.recommendationNotFound": {
    bn: "Recommendation পাওয়া যায়নি",
    en: "Recommendation not found",
  },
  "ai.reportNotFoundInThisOrganization": {
    bn: "এই organization-এ report পাওয়া যায়নি",
    en: "Report not found in this organization",
  },
  "ai.storedAnswerNotFound": {
    bn: "Stored answer পাওয়া যায়নি",
    en: "Stored answer not found",
  },
  "ai.theAiProviderReturnedNoUsable": {
    bn: "AI provider কোনো ব্যবহারযোগ্য copy variant দেয়নি। কিছু সেভ হয়নি।",
    en: "The AI provider returned no usable copy variants. Nothing was saved.",
  },
  "ai.thisActionProposalWasAlreadyDecided": {
    bn: "এই action proposal ইতিমধ্যে decided",
    en: "This action proposal was already decided",
  },
  "ai.thisActionProposalWasAlreadyDecided2": {
    bn: "এই action proposal ইতিমধ্যে decided (status: {{rowStatus}})",
    en: "This action proposal was already decided (status: {{rowStatus}})",
  },
  "ai.thisAnswerWasInvalidatedAndCannot": {
    bn: "এই answer-টি invalidated হয়েছে ({{p1}}) এবং আবার enable করা যাবে না। এটিকে মুছুন, অথবা একটি fresh verified answer-কে এর বদলি হতে দিন।",
    en: "This answer was invalidated ({{p1}}) and cannot be re-enabled. Delete it, or let a fresh verified answer replace it.",
  },
  "ai.thisProposalWasAlreadyDecided": {
    bn: "এই proposal ইতিমধ্যে decided",
    en: "This proposal was already decided",
  },
  "ai.thisProposalWasAlreadyDecidedStatus": {
    bn: "এই proposal ইতিমধ্যে decided (status: {{rowStatus}})",
    en: "This proposal was already decided (status: {{rowStatus}})",
  },
  "ai.titleCannotBeEmpty": {
    bn: "Title খালি হতে পারবে না",
    en: "Title cannot be empty",
  },
  "ai.unknownAdsLifecycleRoute": {
    bn: "অজানা ads lifecycle route: {{p1}}",
    en: "Unknown ads lifecycle route: {{p1}}",
  },
  "ai.unknownCatalogAction": {
    bn: "অজানা catalog action",
    en: "Unknown catalog action",
  },
  "ai.unknownCatalogAction2": {
    bn: "অজানা catalog action: {{actionId}}",
    en: "Unknown catalog action: {{actionId}}",
  },
  "ai.unknownLearnedItemKind": {
    bn: "অজানা learned item kind: {{itemKind}}",
    en: "Unknown learned item kind: {{itemKind}}",
  },
  "ai.aRegisteredTemplateIsNeededFor": {
    bn: "WhatsApp draft-এর জন্য একটি registered template দরকার (whatsappTemplateId)",
    en: "A registered template is needed for a WhatsApp draft (whatsappTemplateId)",
  },
  "ai.whatsappTemplateNotFoundInThis": {
    bn: "এই organization-এ WhatsApp template পাওয়া যায়নি",
    en: "WhatsApp template not found in this organization",
  },
  "ai.adsetidIsRequiredForPauseAd": {
    bn: "pause_ad_set-এর জন্য adSetId দরকার",
    en: "adSetId is required for pause_ad_set",
  },
  "ai.adsetidIsRequiredForResumeAd": {
    bn: "resume_ad_set-এর জন্য adSetId দরকার",
    en: "adSetId is required for resume_ad_set",
  },
  "ai.addtagsMustBeANonEmpty": {
    bn: "addTags tag strings-এর একটি non-empty array হতে হবে",
    en: "addTags must be a non-empty array of tag strings",
  },
  "ai.addtagsHasNoValidTagEmpty": {
    bn: "addTags-এ কোনো বৈধ ট্যাগ নেই (খালি/শুধু space)।",
    en: "addTags has no valid tag (empty/only spaces).",
  },
  "ai.assigneduseridMustBeAUserId": {
    bn: "assignedUserId একটি user id string অথবা null (unassign) হতে হবে",
    en: "assignedUserId must be a user id string or null (unassign)",
  },
  "ai.audiencetypeMustBeCustomersLeadsStage": {
    bn: "audienceType হতে হবে customers, leads_stage অথবা segment",
    en: "audienceType must be customers, leads_stage or segment",
  },
  "ai.channelMustBeEmailSmsOr": {
    bn: "channel হতে হবে email, sms অথবা whatsapp",
    en: "channel must be email, sms or whatsapp",
  },
  "ai.daysMustBeOneOf": {
    bn: "days হতে হবে এর যেকোনো একটি {{p1}}",
    en: "days must be one of {{p1}}",
  },
  "ai.deltaMustBeANonZero": {
    bn: "delta অবশ্যই 0 ছাড়া অন্য পূর্ণসংখ্যা হতে হবে",
    en: "delta must be a non-zero integer",
  },
  "ai.applyingDeltaWouldMakeTheStock": {
    bn: "delta প্রয়োগ করলে স্টক ঋণাত্মক হয়ে যাবে",
    en: "Applying delta would make the stock negative",
  },
  "ai.discountcodeIsRequiredForProposeCreate": {
    bn: "propose_create_discount-এর জন্য discountCode দরকার",
    en: "discountCode is required for propose_create_discount",
  },
  "ai.discountkindMustBePercentFixedOr": {
    bn: "discountKind হতে হবে percent, fixed অথবা free_shipping",
    en: "discountKind must be percent, fixed or free_shipping",
  },
  "ai.discountminorderminorMustBeAnIntegerMinor": {
    bn: "discountMinOrderMinor একটি পূর্ণসংখ্যা minor-unit string হতে হবে",
    en: "discountMinOrderMinor must be an integer minor-unit string",
  },
  "ai.discountusagelimitMustBeAPositiveInteger": {
    bn: "discountUsageLimit অবশ্যই ধনাত্মক পূর্ণসংখ্যা হতে হবে",
    en: "discountUsageLimit must be a positive integer",
  },
  "ai.faqPairSuggestionIsMissingIts": {
    bn: "faq_pair suggestion-এর question অথবা answer নেই",
    en: "faq_pair suggestion is missing its question or answer",
  },
  "ai.headlineIsRequired": {
    bn: "headline দরকার",
    en: "headline is required",
  },
  "ai.kindMustBeOneOf": {
    bn: "kind হতে হবে এর যেকোনো একটি {{p1}}",
    en: "kind must be one of {{p1}}",
  },
  "ai.leadidIsRequiredForCreateFollowup": {
    bn: "create_followup_task-এর জন্য leadId দরকার",
    en: "leadId is required for create_followup_task",
  },
  "ai.levelMustBe01Or": {
    bn: "level হতে হবে 0, 1 অথবা 2",
    en: "level must be 0, 1 or 2",
  },
  "ai.listingidIsRequiredFor": {
    bn: "{{dtoType}}-এর জন্য listingId দরকার",
    en: "listingId is required for {{dtoType}}",
  },
  "ai.theMessageCanBeAtMost": {
    bn: "message সর্বোচ্চ ১০০০ অক্ষরের হতে পারবে।",
    en: "The message can be at most 1000 characters.",
  },
  "ai.newpriceIsRequiredForProposePrice": {
    bn: "propose_price_change-এর জন্য newPrice দরকার",
    en: "newPrice is required for propose_price_change",
  },
  "ai.newpriceMustBeMoreThan0": {
    bn: "newPrice অবশ্যই 0-এর বেশি হতে হবে",
    en: "newPrice must be more than 0",
  },
  "ai.newquantityOrDeltaExactlyOneMust": {
    bn: "newQuantity অথবা delta — ঠিক একটি দিতে হবে (দুটোই বা কোনোটিই নয়)",
    en: "newQuantity or delta — exactly one must be given (not both or neither)",
  },
  "ai.newquantityMustBeAnIntegerOf": {
    bn: "newQuantity অবশ্যই 0 বা তার বেশি পূর্ণসংখ্যা হতে হবে",
    en: "newQuantity must be an integer of 0 or more",
  },
  "ai.numberGuardTheseNumbersInThe": {
    bn: "number guard: উত্তরের এই সংখ্যাগুলো তাজা যাচাইকৃত তথ্যে নেই — {{p1}}। অনুমোদনের পর তথ্য বদলে গেছে (বা লেখাটি কখনোই grounded ছিল না) — কিছুই পোস্ট হয়নি।",
    en: "Number guard: these numbers in the answer are not in fresh verified data — {{p1}}. The data changed after approval (or the text was never grounded) — nothing was posted.",
  },
  "ai.personaMustBeOneOf": {
    bn: "persona হতে হবে এর যেকোনো একটি: {{p1}}",
    en: "persona must be one of: {{p1}}",
  },
  "ai.planidIsRequiredForPauseCampaign": {
    bn: "pause_campaign-এর জন্য planId দরকার",
    en: "planId is required for pause_campaign",
  },
  "ai.planidIsRequiredForResumeCampaign": {
    bn: "resume_campaign-এর জন্য planId দরকার",
    en: "planId is required for resume_campaign",
  },
  "ai.platformMustBeMetaGoogleOr": {
    bn: "platform হতে হবে meta, google অথবা tiktok (পাওয়া গেছে \"{{platform}}\") — manual/CSV-only data-র উপর কাজ করার কোনো platform নেই",
    en: "platform must be meta, google or tiktok (got \"{{platform}}\") — manual/CSV-only data has no platform to act on",
  },
  "ai.primarytextIsRequired": {
    bn: "primaryText দরকার",
    en: "primaryText is required",
  },
  "ai.productidIsRequiredForProposePrice": {
    bn: "propose_price_change-এর জন্য productId দরকার",
    en: "productId is required for propose_price_change",
  },
  "ai.productidIsRequiredForProposeProduct": {
    bn: "propose_product_copy-এর জন্য productId দরকার",
    en: "productId is required for propose_product_copy",
  },
  "ai.productidIsRequiredForProposeStock": {
    bn: "propose_stock_adjust-এর জন্য productId দরকার",
    en: "productId is required for propose_stock_adjust",
  },
  "ai.proposedbyMustBeAiOrStaff": {
    bn: "proposedBy হতে হবে \\\"ai\\\" অথবা \\\"staff\\\"",
    en: "proposedBy must be \\\"ai\\\" or \\\"staff\\\"",
  },
  "ai.replytextCanBeAtMost1000": {
    bn: "replyText সর্বোচ্চ ১০০০ অক্ষরের হতে পারবে (SA-B8 grounded compose-এর সীমা)।",
    en: "replyText can be at most 1000 characters (the SA-B8 grounded compose limit).",
  },
  "ai.requestedbudgetminorMustBeAnIntegerAmount": {
    bn: "requestedBudgetMinor minor units-এ একটি পূর্ণসংখ্যা পরিমাণ হতে হবে",
    en: "requestedBudgetMinor must be an integer amount in minor units",
  },
  "ai.requestedbudgetminorMustBePositive": {
    bn: "requestedBudgetMinor ধনাত্মক হতে হবে",
    en: "requestedBudgetMinor must be positive",
  },
  "ai.statusMustBeActiveOrDisabled": {
    bn: "status হতে হবে \\\"active\\\" অথবা \\\"disabled\\\"",
    en: "status must be \\\"active\\\" or \\\"disabled\\\"",
  },
  "ai.typeMustBeDailyWeeklyOr": {
    bn: "type হতে হবে daily, weekly অথবা monthly",
    en: "type must be daily, weekly or monthly",
  },
  "ai.typeMustBeOneOf": {
    bn: "type হতে হবে এর যেকোনো একটি: {{p1}}",
    en: "type must be one of: {{p1}}",
  },
  "ai.visibilityMustBePublicOrInternal": {
    bn: "visibility হতে হবে public অথবা internal",
    en: "visibility must be public or internal",
  },
  "ai.isRequired": {
    bn: "{{field}} দরকার",
    en: "{{field}} is required",
  },
  "ai.suggestionIsMissingItsText": {
    bn: "{{itemKind}} suggestion-এর text নেই",
    en: "{{itemKind}} suggestion is missing its text",
  },
  "ai.theApprovalLinkIsNotEnabled": {
    bn: "অনুমোদন লিংক চালু নেই — সার্ভারে ASSISTANT_LINK_SECRET (বা INTERNAL_JOB_SECRET) সেট করা হয়নি।",
    en: "The approval link is not enabled — ASSISTANT_LINK_SECRET (or INTERNAL_JOB_SECRET) is not set on the server.",
  },
  "ai.youCanSaveAtMostPrompts": {
    bn: "আপনি সর্বোচ্চ {{SAVED_PROMPT_CAP}}টি prompt save করতে পারবেন। নতুন যোগ করতে পুরনো কোনোটি মুছে ফেলুন।",
    en: "You can save at most {{SAVED_PROMPT_CAP}} prompts. Delete an old one to add a new one.",
  },
  "ai.thisAdSetHasNoMeta": {
    bn: "এই ad set-এর কোনো Meta ad set ID নেই — pause করার মতো কিছু নেই।",
    en: "This ad set has no Meta ad set ID — there is nothing to pause.",
  },
  "ai.thisAdSetHasNoMeta2": {
    bn: "এই ad set-এর কোনো Meta ad set ID নেই — resume করার মতো কিছু নেই।",
    en: "This ad set has no Meta ad set ID — there is nothing to resume.",
  },
  "ai.yourRoleDoesNotHavePermission": {
    bn: "এই commerce প্রস্তাব অনুমোদনের অনুমতি আপনার ভূমিকায় নেই",
    en: "Your role does not have permission to approve this commerce proposal",
  },
  "ai.thisOrgHasNoRecordOf": {
    bn: "এই org-এ {{platform}} campaign \"{{campaignExternalId}}\"-এর কোনো record নেই — campaign-টি আগে sync/connect করুন।",
    en: "This org has no record of the {{platform}} campaign \"{{campaignExternalId}}\" — sync/connect the campaign first.",
  },
  "ai.thisConversationIsAlreadyOpenThere": {
    bn: "এই কথোপকথনটি ইতিমধ্যে খোলা (open) আছে — আবার খোলার কিছু নেই।",
    en: "This conversation is already open — there is nothing to reopen.",
  },
  "ai.thisConversationIsAlreadyClosedThere": {
    bn: "এই কথোপকথনটি ইতিমধ্যে বন্ধ আছে — বন্ধ করার কিছু নেই।",
    en: "This conversation is already closed — there is nothing to close.",
  },
  "ai.thisConversationIsAlreadyMarkedAs": {
    bn: "এই কথোপকথনটি ইতিমধ্যে স্প্যাম হিসেবে চিহ্নিত — আবার চিহ্নিত করার কিছু নেই।",
    en: "This conversation is already marked as spam — there is nothing to mark again.",
  },
  "ai.thisCommentHasAlreadyBeenDeleted": {
    bn: "এই কমেন্টটি ইতিমধ্যে মুছে ফেলা হয়েছে — আবার মোছার কিছু নেই।",
    en: "This comment has already been deleted — there is nothing to delete again.",
  },
  "ai.thisCommentIsAlreadyHiddenThere": {
    bn: "এই কমেন্টটি ইতিমধ্যে লুকানো আছে — লুকানোর কিছু নেই।",
    en: "This comment is already hidden — there is nothing to hide.",
  },
  "ai.thisCommentHasBeenDeletedIt": {
    bn: "এই কমেন্টটি মুছে ফেলা হয়েছে — এর উত্তর দেওয়া যায় না।",
    en: "This comment has been deleted — it cannot be replied to.",
  },
  "ai.thisCommentHasBeenDeletedIts": {
    bn: "এই কমেন্টটি মুছে ফেলা হয়েছে — এর লেখককে DM পাঠানো যায় না।",
    en: "This comment has been deleted — its author cannot be DM'd.",
  },
  "ai.thisCommentIsNotInHidden": {
    bn: "এই কমেন্টটি লুকানো (HIDDEN) অবস্থায় নেই (বর্তমান status: {{p1}}) — আবার দেখানোর কিছু নেই।",
    en: "This comment is not in HIDDEN status (current status: {{p1}}) — there is nothing to show again.",
  },
  "ai.aPrivateReplyDmHasAlready": {
    bn: "এই কমেন্টের জন্য ইতিমধ্যে একটি private reply (DM) পাঠানো হয়েছে — Meta প্রতি কমেন্টে একটির বেশি private reply দেয় না।",
    en: "A private reply (DM) has already been sent for this comment — Meta does not allow more than one private reply per comment.",
  },
  "ai.aDiscountAlreadyExistsWithThis": {
    bn: "এই কোডে ইতিমধ্যে একটি ডিসকাউন্ট আছে",
    en: "A discount already exists with this code",
  },
  "ai.thisCampaignIsNotPausedNow": {
    bn: "এই ক্যাম্পেইনটি এখন PAUSED নয় (বর্তমান Meta status: {{p1}}) — resume করার কিছু নেই।",
    en: "This campaign is not PAUSED now (current Meta status: {{p1}}) — there is nothing to resume.",
  },
  "ai.theseTagsAreAlreadyOnThe": {
    bn: "এই ট্যাগগুলো কথোপকথনে ইতিমধ্যে আছে — যোগ করার কিছু নেই।",
    en: "These tags are already on the conversation — there is nothing to add.",
  },
  "ai.thisProductSStockIsNot": {
    bn: "এই পণ্যের স্টক ট্র্যাক করা হচ্ছে না — আগে পণ্যের স্টক সংখ্যা বসান",
    en: "This product's stock is not tracked — set the product's stock quantity first",
  },
  "ai.thisSenderIsAlreadyBlockedThere": {
    bn: "এই প্রেরক ইতিমধ্যে ব্লক করা আছে — আবার ব্লক করার কিছু নেই।",
    en: "This sender is already blocked — there is nothing to block again.",
  },
  "ai.thisListingIsNotPublishedThere": {
    bn: "এই লিস্টিংটি published নয় — unpublish করার কিছু নেই",
    en: "This listing is not published — there is nothing to unpublish",
  },
  "ai.thisListingIsAlreadyPublished": {
    bn: "এই লিস্টিংটি ইতিমধ্যে published আছে",
    en: "This listing is already published",
  },
  "ai.theSameCampaignIdExistsIn": {
    bn: "একই campaign id ({{campaignExternalId}}) এই org-এর একাধিক {{platform}} অ্যাকাউন্টে আছে — কোন অ্যাকাউন্টের campaign তা adAccountId দিয়ে নির্দিষ্ট করুন।",
    en: "The same campaign id ({{campaignExternalId}}) exists in multiple {{platform}} accounts of this org — specify which account's campaign with adAccountId.",
  },
  "ai.writeAQuestionOrAnInstruction": {
    bn: "একটি প্রশ্ন বা নির্দেশ লিখুন।",
    en: "Write a question or an instruction.",
  },
  "ai.aValidDueatIsoDateIs": {
    bn: "একটি বৈধ dueAt (ISO date) দরকার",
    en: "A valid dueAt (ISO date) is needed",
  },
  "ai.noRealLlmIsConfiguredFalse": {
    bn: "কোনো আসল LLM কনফিগার করা নেই — dev-template দিয়ে বানানো (মিথ্যা) কপি তৈরি করা হবে না। LLM সেটিংসে আসল provider যোগ করুন।",
    en: "No real LLM is configured — (false) copy made with the dev-template will not be generated. Add a real provider in LLM settings.",
  },
  "ai.noFileWasFound": {
    bn: "কোনো ফাইল পাওয়া যায়নি",
    en: "No file was found",
  },
  "ai.noDescriptionCouldBeObtainedFrom": {
    bn: "ছবিটি থেকে কোনো বর্ণনা পাওয়া যায়নি",
    en: "No description could be obtained from this image",
  },
  "ai.theValueOfAFixedAmount": {
    bn: "নির্দিষ্ট পরিমাণ ডিসকাউন্টের মান কমপক্ষে 1 হতে হবে",
    en: "The value of a fixed-amount discount must be at least 1",
  },
  "ai.noTextWasFoundInThe": {
    bn: "ফাইল থেকে কোনো লেখা পাওয়া যায়নি",
    en: "No text was found in the file",
  },
  "ai.theFileIsLargerThan10mb": {
    bn: "ফাইলটি 10MB-এর বেশি বড়",
    en: "The file is larger than 10MB",
  },
  "ai.theFileIsEmpty": {
    bn: "ফাইলটি খালি",
    en: "The file is empty",
  },
  "ai.aReasonIsNeededInThe": {
    bn: "রিফান্ডের অনুরোধে একটি কারণ (reason) দরকার",
    en: "A reason is needed in the refund request",
  },
  "ai.theValueOfAPercentageDiscount": {
    bn: "শতাংশ ডিসকাউন্টের মান 1 থেকে 90-এর মধ্যে হতে হবে",
    en: "The value of a percentage discount must be between 1 and 90",
  },
  "ai.onlyAPublishedCampaignCanBe": {
    bn: "শুধুমাত্র published ক্যাম্পেইনই pause করা যায় — এই প্ল্যানটি এখনো Meta-তে published নয়।",
    en: "Only a published campaign can be paused — this plan is not published on Meta yet.",
  },
  "ai.onlyAPublishedCampaignCanBe2": {
    bn: "শুধুমাত্র published ক্যাম্পেইনই resume করা যায় — এই প্ল্যানটি এখনো Meta-তে published নয়।",
    en: "Only a published campaign can be resumed — this plan is not published on Meta yet.",
  },
  "ai.onlyAPublishedPlanSAd": {
    bn: "শুধুমাত্র published প্ল্যানের ad set pause করা যায়।",
    en: "Only a published plan's ad set can be paused.",
  },
  "ai.onlyAPublishedPlanSAd2": {
    bn: "শুধুমাত্র published প্ল্যানের ad set resume করা যায়।",
    en: "Only a published plan's ad set can be resumed.",
  },
  "ai.level3ActingOnItsOwn": {
    bn: "স্তর ৩ (তত্ত্বাবধানে নিজে করা) এই build-এ চালু করা যায় না — এর জন্য মালিকের আলাদা সিদ্ধান্ত দরকার (পরিকল্পনা D5)।",
    en: "Level 3 (acting on its own under supervision) cannot be enabled in this build — it needs the owner's separate decision (plan D5).",
  },
  "ai.theAccountOfTheCampaignIs": {
    bn: "“{{rowName}}” campaign-এর অ্যাকাউন্ট ({{p2}}) API দিয়ে connected নয় (CSV/manual) — platform-এ সরাসরি কাজ করার কোনো পথ এই system-এ নেই; campaign-টি Ads Manager থেকে পরিচালনা করুন।",
    en: "The account ({{p2}}) of the \"{{rowName}}\" campaign is not connected via API (CSV/manual) — this system has no path to act directly on the platform; manage the campaign from Ads Manager.",
  },
  "ai.theCurrentBudgetOfTheCampaign": {
    bn: "“{{tCampaignName}}” campaign-এর বর্তমান বাজেট এই system-এ পড়ার কোনো পথ নেই (কোনো platform client-এ budget read নেই, আর এই campaign-এর hub-এ কোনো সংরক্ষিত budget record-ও নেই) — বর্তমান বাজেট না জানিয়ে বাজেট-বদলের প্রস্তাব তৈরি করা হয় না। বাজেট জানতে/বদলাতে Ads Manager বা hub-এর campaign plan দেখুন।",
    en: "The current budget of the \"{{tCampaignName}}\" campaign cannot be read in this system in any way (no platform client has a budget read, and this campaign has no stored budget record in the hub either) — a budget-change proposal is not created without knowing the current budget. See Ads Manager or the hub's campaign plan to know/change the budget.",
  },
  "ai.aiFeaturesTemporarilyPausedPlatformWide": {
    bn: "AI features প্ল্যাটফর্ম team দ্বারা পুরো প্ল্যাটফর্মে সাময়িকভাবে বন্ধ রাখা হয়েছে।",
    en: "AI features are temporarily paused platform-wide by the platform team.",
  },
  "ai.aiFeaturesTemporarilyDisabledForThisOrganization": {
    bn: "AI features প্ল্যাটফর্ম team দ্বারা এই organization-এর জন্য সাময়িকভাবে বন্ধ আছে।",
    en: "AI features are temporarily disabled for this organization by the platform team.",
  },
};
