/**
 * MB4 — messaging catalog namespace (W-3 owned).
 *
 * Pure data: messaging-module user-visible exception texts and
 * platform system strings. The messaging originals are mostly
 * ENGLISH (82% of messaging.service exceptions — inventory §৬.2);
 * for those keys the en text is faithful to the original and
 * the bn text is the translation. Where the original was
 * Bengali, bn is faithful and en is the translation.
 *
 * Merchant-authored template content is NOT here (D-MB4-5).
 * Platform preset library content (festival packs, journey
 * presets) follows D-MB4-8 as *En companions in its own data
 * files, not this catalog.
 *
 * Keys named `messaging.svc.*` are generated from
 * messaging.service.ts throw sites (one key per distinct
 * message; dynamic values are {{params}}).
 */
export const MESSAGING_CATALOG = {
  // ---- token / link errors (customer-facing, BN originals) ----
  "messaging.token.invalidOrExpired": {
    bn: "লিংকটি অবৈধ বা মেয়াদোত্তীর্ণ",
    en: "The link is invalid or has expired",
  },
  // ---- provider configuration errors (EN originals) ----
  "messaging.provider.emailNotConfigured": {
    bn: "ইমেইল কনফিগার করা হয়নি: Admin Console-এ (Settings) SMTP দিন, অথবা API environment-এ SMTP_HOST/SMTP_FROM দিন। Local development-এর জন্য docker-compose localhost:1025-এ Mailpit দেয়।",
    en: "Email is not configured: set SMTP in the Admin Console (Settings) or SMTP_HOST/SMTP_FROM in the API environment. For local development, docker-compose provides Mailpit on localhost:1025.",
  },
  "messaging.provider.emailFromNotConfigured": {
    bn: "ইমেইল কনফিগার করা হয়নি: Admin Console-এ SMTP From ঠিকানা দিন অথবা API environment-এ SMTP_FROM দিন।",
    en: "Email is not configured: set the SMTP From address in the Admin Console or SMTP_FROM in the API environment.",
  },
  "messaging.provider.smtpNoMessageId": {
    bn: "SMTP সার্ভার কোনো message id ফেরত দেয়নি; ইমেইলটি পাঠানো হয়েছে বলে গণনা করা হয়নি",
    en: "SMTP server did not return a message id; the email is NOT counted as sent",
  },
  "messaging.provider.smtpTransportFailed": {
    bn: "এই সেটিংস দিয়ে SMTP transport তৈরি করা যায়নি",
    en: "SMTP transport could not be created from these settings",
  },
  "messaging.provider.tenantSmtpTransportFailed": {
    bn: "এই সংস্থার সেটিংস দিয়ে tenant SMTP transport তৈরি করা যায়নি",
    en: "Tenant SMTP transport could not be created from this organization's settings",
  },
  "messaging.provider.smsNotConfigured": {
    bn: "SMS কনফিগার করা হয়নি: Admin Console-এ (Settings) SMS gateway দিন, অথবা API environment-এ SMS_API_TOKEN ও SMS_SENDER_ID (SSL Wireless account) দিন।",
    en: "SMS is not configured: set the SMS gateway in the Admin Console (Settings) or SMS_API_TOKEN and SMS_SENDER_ID (SSL Wireless account) in the API environment.",
  },
  "messaging.provider.smsGatewayNotConfiguredForOrg": {
    bn: "এই সংস্থার জন্য SMS gateway \"{{gateway}}\" কনফিগার করা হয়নি: একটি API key ও একটি sender ID দুটোই লাগবে।",
    en: "SMS gateway \"{{gateway}}\" is not configured for this organization: an API key and a sender ID are both required.",
  },
  "messaging.provider.unknownSmsGateway": {
    bn: "অজানা SMS gateway: {{gateway}}",
    en: "Unknown SMS gateway: {{gateway}}",
  },
  // ---- pure-helper validation (EN originals; wrapped by the service) ----
  "messaging.blocks.notArray": { bn: "blocks একটি array হতে হবে", en: "blocks must be an array" },
  "messaging.blocks.empty": { bn: "blocks খালি হতে পারবে না — অন্তত একটি block যোগ করুন", en: "blocks must not be empty — add at least one block" },
  "messaging.blocks.tooMany": { bn: "blocks: প্রতি template-এ সর্বোচ্চ ৫০টি block", en: "blocks: at most 50 blocks per template" },
  "messaging.cascade.notObject": { bn: "cascade একটি object হতে হবে", en: "cascade must be an object" },
  "messaging.cascade.channelsRequired": { bn: "cascade.channels অবশ্যই channel-এর (email, sms, whatsapp) একটি খালি-নয় array হতে হবে", en: "cascade.channels must be a non-empty array of channels (email, sms, whatsapp)" },
  "messaging.cascade.needsTwoChannels": { bn: "cascade-এ অন্তত দুটি channel লাগবে — এক channel-এর broadcast-এ cascade লাগে না", en: "cascade needs at least two channels — a single-channel broadcast needs no cascade" },
  "messaging.recurrence.notObject": { bn: "recurrence একটি object হতে হবে", en: "recurrence must be an object" },
  "messaging.recurrence.freqInvalid": { bn: "recurrence.freq অবশ্যই \"daily\" অথবা \"weekly\" হতে হবে", en: "recurrence.freq must be \"daily\" or \"weekly\"" },
  "messaging.recurrence.intervalRange": { bn: "recurrence.interval ১ থেকে ৫২-এর মধ্যে একটি integer হতে হবে", en: "recurrence.interval must be an integer between 1 and 52" },
  // ---- compose-check advisory warnings (BN originals; advisory only) ----
  "messaging.compose.spamWords": {
    bn: "স্প্যাম-ঝুঁকির শব্দ পাওয়া গেছে: {{words}} — এসব শব্দ ডেলিভারি কমিয়ে দিতে পারে।",
    en: "Spam-risk words found: {{words}} — these words can reduce delivery.",
  },
  "messaging.compose.allCapsSubject": {
    bn: "বিষয়ের বেশিরভাগ অক্ষর বড় হাতের (ALL CAPS) — স্প্যাম ফিল্টরে আটকে যাওয়ার ঝুঁকি থাকে।",
    en: "Most of the subject is in ALL CAPS — it risks being caught by spam filters.",
  },
  "messaging.compose.emptySubject": {
    bn: "ইমেইলের বিষয় (subject) খালি — একটি বিষয় যোগ করুন।",
    en: "The email subject is empty — add a subject.",
  },
  // ---- governance warnings (EN originals; advisory, returned in payloads) ----
  "messaging.governance.costNotEstimable": {
    bn: "খরচ অনুমান করা যায়নি (এই channel-এর জন্য সংস্থার দেওয়া কোনো rate নেই), তাই budget cap যাচাই করা যায়নি। সতর্কতাসহ পাঠানো অনুমোদিত — budget enforcement চালু করতে Sender settings-এ channel rate দিন।",
    en: "Cost cannot be estimated (no org-entered rate for this channel), so the budget cap could not be checked. The send is allowed with this warning — set the channel rate in Sender settings to enable budget enforcement.",
  },
  "messaging.governance.monthlyNotFullyEstimable": {
    bn: "মাসিক খরচ পুরোপুরি অনুমান করা যায়নি (এই মাসে পাঠানো কিছু broadcast-এর সংস্থার দেওয়া rate নেই), তাই মাসিক cap পুরোপুরি যাচাই করা যায়নি। সতর্কতাসহ পাঠানো অনুমোদিত।",
    en: "Monthly spend could not be fully estimated (some sent broadcasts this month have no org-entered rate), so the monthly cap could not be fully checked. The send is allowed with this warning.",
  },
  "messaging.aBBroadcastsNeedAVariant": {
    bn: "A/B broadcast-এর জন্য variant B-এর body লাগবে (abBody)",
    en: "A/B broadcasts need a variant B body (abBody)",
  },
  "messaging.aBWhatsAppBroadcastsNeedA": {
    bn: "A/B WhatsApp broadcast-এর জন্য দ্বিতীয় একটি template লাগবে (abWhatsappTemplateId)",
    en: "A/B WhatsApp broadcasts need a second template (abWhatsappTemplateId)",
  },
  "messaging.aBWhatsAppTemplateNotFound": {
    bn: "এই সংস্থায় A/B WhatsApp template পাওয়া যায়নি",
    en: "A/B WhatsApp template not found in this organization",
  },
  "messaging.aBroadcastStatusBroadcastCannotBeCancelled": {
    bn: "{{broadcastStatus}} অবস্থার broadcast বাতিল করা যাবে না",
    en: "A {{broadcastStatus}} broadcast cannot be cancelled",
  },
  "messaging.aBroadcastStatusBroadcastCannotBeDeleted": {
    bn: "{{broadcastStatus}} অবস্থার broadcast মোছা যাবে না — শুধু draft বা cancelled broadcast মোছা যায়। এর বদলে archive করুন, যাতে delivery history থেকে যায়।",
    en: "A {{broadcastStatus}} broadcast cannot be deleted — only draft or cancelled broadcasts can. Archive it instead to keep its delivery history.",
  },
  "messaging.aBroadcastStatusBroadcastCannotBeEdited": {
    bn: "{{broadcastStatus}} অবস্থার broadcast সম্পাদনা করা যাবে না (শুধু draft, scheduled, paused বা pending approval সম্পাদনাযোগ্য)",
    en: "A {{broadcastStatus}} broadcast cannot be edited (only draft, scheduled, paused or pending approval)",
  },
  "messaging.aBroadcastThatIsSendingCannot": {
    bn: "যে broadcast পাঠানো চলছে তা archive করা যাবে না — আগে pause করুন অথবা শেষ হতে দিন",
    en: "A broadcast that is sending cannot be archived — pause it or let it finish first",
  },
  "messaging.aIIsNotConfiguredForThis": {
    bn: "এই সংস্থার জন্য AI কনফিগার করা হয়নি, তাই segment draft তৈরি করা যাচ্ছে না। একটি AI provider কনফিগার করুন, অথবা condition builder দিয়ে audience বানান।",
    en: "AI is not configured for this organization, so a segment draft cannot be generated. Configure an AI provider, or build the audience with the condition builder instead.",
  },
  "messaging.aIIsNotConfiguredForThis2": {
    bn: "এই সংস্থার জন্য AI কনফিগার করা হয়নি, তাই campaign plan তৈরি করা যাচ্ছে না। একটি AI provider কনফিগার করুন, অথবা composer-এ নিজে campaign বানান।",
    en: "AI is not configured for this organization, so a campaign plan cannot be generated. Configure an AI provider, or build the campaign manually in the composer.",
  },
  "messaging.aJourneyNeedsAName": {
    bn: "একটি journey-এর নাম লাগবে",
    en: "A journey needs a name",
  },
  "messaging.aJourneyNeedsAtLeastOne": {
    bn: "একটি journey-তে অন্তত একটি step লাগবে",
    en: "A journey needs at least one step",
  },
  "messaging.aKeywordRuleNeedsAName": {
    bn: "একটি keyword rule-এর নাম লাগবে",
    en: "A keyword rule needs a name",
  },
  "messaging.aKeywordRuleNeedsAtLeast": {
    bn: "একটি keyword rule-এ অন্তত একটি action লাগবে — একটি tag অথবা একটি auto-reply লেখা। যা কিছুই করে না এমন rule সংরক্ষণ করা হয় না।",
    en: "A keyword rule needs at least one action — a tag or an auto-reply text. A rule that does nothing is not saved.",
  },
  "messaging.aPausedBroadcastSScheduleCannot": {
    bn: "Pause করা broadcast-এর schedule এখানে বদলানো যাবে না — এর বদলে resume অথবা cancel করুন",
    en: "A paused broadcast's schedule cannot be changed here — resume or cancel it instead",
  },
  "messaging.aPollNeeds2To6": {
    bn: "একটি poll-এ ২ থেকে ৬টি option লাগবে",
    en: "A poll needs 2 to 6 options",
  },
  "messaging.aSavedAudienceNeedsAName": {
    bn: "একটি saved audience-এর নাম লাগবে",
    en: "A saved audience needs a name",
  },
  "messaging.aTagValueIsRequiredWhen": {
    bn: "applyTagTo সেট থাকলে একটি tag value লাগবে",
    en: "A tag value is required when applyTagTo is set",
  },
  "messaging.aTestRecipientAddressIsRequired": {
    bn: "একটি test recipient ঠিকানা লাগবে (to)",
    en: "A test recipient address is required (to)",
  },
  "messaging.aValidTestRecipientEmailAddress": {
    bn: "একটি সঠিক test recipient ইমেইল ঠিকানা লাগবে",
    en: "A valid test recipient email address is required",
  },
  "messaging.abAutoWinnerEnabledMustBeABoolean": {
    bn: "abAutoWinnerEnabled একটি boolean হতে হবে",
    en: "abAutoWinnerEnabled must be a boolean",
  },
  "messaging.addTagStepsNeedATag": {
    bn: "add_tag step-এর একটি tag লাগবে",
    en: "add_tag steps need a tag",
  },
  "messaging.addTagStepsNeedATarget": {
    bn: "add_tag step-এর একটি target লাগবে (lead | conversation)",
    en: "add_tag steps need a target (lead | conversation)",
  },
  "messaging.addressesMustBeANonEmpty": {
    bn: "addresses একটি খালি-নয় array হতে হবে",
    en: "addresses must be a non-empty array",
  },
  "messaging.anOptInFormWithSlug": {
    bn: "\"{{slug}}\" slug-এর একটি opt-in form এই সংস্থায় ইতিমধ্যে আছে।",
    en: "An opt-in form with slug \"{{slug}}\" already exists in this organization.",
  },
  "messaging.anSMSAPIKeyIsRequired": {
    bn: "একটি SMS API key লাগবে",
    en: "An SMS API key is required",
  },
  "messaging.anSMSSenderIDIsRequired": {
    bn: "একটি SMS sender ID লাগবে",
    en: "An SMS sender ID is required",
  },
  "messaging.applyTagToMayOnlyContainCustomerLead": {
    bn: "applyTagTo-তে শুধু customer, lead বা conversation থাকতে পারে — পাওয়া গেছে \"{{t}}\"",
    en: "applyTagTo may only contain customer, lead or conversation — got \"{{t}}\"",
  },
  "messaging.applyTagToMustNameAtLeastOne": {
    bn: "একটি tag সেট থাকলে applyTagTo-কে customer, lead, conversation-এর অন্তত একটির নাম দিতে হবে",
    en: "applyTagTo must name at least one of customer, lead, conversation when a tag is set",
  },
  "messaging.approvalEnabledMustBeABoolean": {
    bn: "approvalEnabled একটি boolean হতে হবে",
    en: "approvalEnabled must be a boolean",
  },
  "messaging.approversOWNERADMINDoNotNeed": {
    bn: "Approver-দের (OWNER/ADMIN) approval লাগে না — তাদের broadcast gate করা হয় না।",
    en: "Approvers (OWNER/ADMIN) do not need approval — their broadcasts are not gated.",
  },
  "messaging.audienceCsvHasNoAddressesPasteAt": {
    bn: "audienceCsv-তে কোনো ঠিকানা নেই — অন্তত একটি ইমেইল ঠিকানা বা ফোন নম্বর paste করুন",
    en: "audienceCsv has no addresses — paste at least one email address or phone number",
  },
  "messaging.audienceHasRecipientsLengthRecipientsOverThe": {
    bn: "Audience-এ {{recipientsLength}} জন প্রাপক আছে, যা প্রতি-পাঠানোর cap {{max}}-এর বেশি। নীরবে কেটে না দিয়ে audience ছোট করুন (যেমন একটি lead stage)।",
    en: "Audience has {{recipientsLength}} recipients, over the per-send cap of {{max}}. Narrow the audience (e.g. a lead stage) instead of silently truncating.",
  },
  "messaging.audienceHasTotalRecipientsOverThe": {
    bn: "Audience-এ {{total}} জন প্রাপক আছে, যা প্রতি-পাঠানোর cap {{max}}-এর বেশি। নীরবে কেটে না দিয়ে audience ছোট করুন (যেমন একটি lead stage)।",
    en: "Audience has {{total}} recipients, over the per-send cap of {{max}}. Narrow the audience (e.g. a lead stage) instead of silently truncating.",
  },
  "messaging.audienceSavedIdIsRequiredForSavedAudience": {
    bn: "saved audience-এর জন্য audienceSavedId লাগবে",
    en: "audienceSavedId is required for saved audience",
  },
  "messaging.audienceSegmentIsRequiredForSegmentAudience": {
    bn: "segment audience-এর জন্য audienceSegment লাগবে",
    en: "audienceSegment is required for segment audience",
  },
  "messaging.audienceSegmentMustBeOneOfRFM": {
    bn: "audienceSegment অবশ্যই এর একটি হতে হবে: {{RFM_SEGMENTSJoin}}",
    en: "audienceSegment must be one of: {{RFM_SEGMENTSJoin}}",
  },
  "messaging.audienceStageIsRequiredForLeadsStage": {
    bn: "leads_stage audience-এর জন্য audienceStage লাগবে",
    en: "audienceStage is required for leads_stage audience",
  },
  "messaging.audienceStageIsRequiredForTheLeads": {
    bn: "leads_stage audience-এর জন্য audienceStage লাগবে",
    en: "audienceStage is required for the leads_stage audience",
  },
  "messaging.audienceTypeAudienceTypeIsNotAvailableFor": {
    bn: "audienceType {{audienceType}} push channel-এর জন্য পাওয়া যায় না — push audience web push subscription থেকে resolve হয় (push_subscribers, customers বা segment ব্যবহার করুন)",
    en: "audienceType {{audienceType}} is not available for the push channel — push audiences resolve from web push subscriptions (use push_subscribers, customers or segment)",
  },
  "messaging.audienceTypeAudienceTypeIsNotAvailableFor2": {
    bn: "audienceType {{audienceType}} onsite channel-এর জন্য পাওয়া যায় না — on-site notification শুধু shop customer-দের কাছে পৌঁছায় (customers বা segment ব্যবহার করুন)",
    en: "audienceType {{audienceType}} is not available for the onsite channel — on-site notifications reach shop customers only (use customers or segment)",
  },
  "messaging.audienceTypeAudienceTypeIsNotAvailableFor3": {
    bn: "audienceType {{audienceType}} telegram channel-এর জন্য পাওয়া যায় না — telegram audience সংস্থার Telegram conversation থেকে resolve হয় (telegram_subscribers, customers, leads_stage বা segment ব্যবহার করুন)",
    en: "audienceType {{audienceType}} is not available for the telegram channel — telegram audiences resolve from the org's Telegram conversations (use telegram_subscribers, customers, leads_stage or segment)",
  },
  "messaging.audienceTypeMustBeCustomersLeadsStage": {
    bn: "audienceType অবশ্যই customers, leads_stage, segment, custom, saved বা csv হতে হবে",
    en: "audienceType must be customers, leads_stage, segment, custom, saved or csv",
  },
  "messaging.autoReplyTextIsTooLong": {
    bn: "Auto-reply লেখা খুব লম্বা (সর্বোচ্চ ১০০০ অক্ষর)",
    en: "Auto-reply text is too long (max 1000 characters)",
  },
  "messaging.blocksAreOnlyAllowedForEmail": {
    bn: "blocks শুধু ইমেইল template-এর জন্য (block builder ইমেইল বানায়)",
    en: "blocks are only allowed for email templates (the block builder builds email)",
  },
  "messaging.bodyIsRequiredWriteTheMessage": {
    bn: "body লাগবে — আগে অনুবাদ করার message-টি লিখুন",
    en: "body is required — write the message to translate first",
  },
  "messaging.bodyIsTooLongToTranslate": {
    bn: "body অনুবাদের জন্য খুব লম্বা (সর্বোচ্চ ১০০০০ অক্ষর)",
    en: "body is too long to translate (max 10000 characters)",
  },
  "messaging.branchStepsNeedAtLeastOne": {
    bn: "branch step-এর একটি arm-এ অন্তত একটি sub-step লাগবে",
    en: "branch steps need at least one sub-step in an arm",
  },
  "messaging.broadcastApprovalIsNotEnabledFor": {
    bn: "এই সংস্থার জন্য broadcast approval চালু নেই (Messaging settings)।",
    en: "Broadcast approval is not enabled for this organization (Messaging settings).",
  },
  "messaging.broadcastBodyIsRequiredToPreview": {
    bn: "Personalisation preview-এর জন্য broadcast-এর body লাগবে",
    en: "Broadcast body is required to preview personalisation",
  },
  "messaging.broadcastBodyIsRequiredWriteOne": {
    bn: "Broadcast-এর body লাগবে (একটি লিখুন অথবা একটি template বেছে নিন)",
    en: "Broadcast body is required (write one or choose a template)",
  },
  "messaging.broadcastNameIsRequired": {
    bn: "Broadcast-এর নাম লাগবে",
    en: "Broadcast name is required",
  },
  "messaging.broadcastNotFound": {
    bn: "Broadcast পাওয়া যায়নি",
    en: "Broadcast not found",
  },
  "messaging.broadcastsAreTemporarilyPausedPlatformWide": {
    bn: "Platform team সাময়িকভাবে পুরো platform-এ broadcast pause করে রেখেছে (incident mode)। পরে আবার চেষ্টা করুন।",
    en: "Broadcasts are temporarily paused platform-wide by the platform team (incident mode). Try again later.",
  },
  "messaging.budgetCapMinorMustBeAPositiveInteger": {
    bn: "budgetCapMinor একটি ধনাত্মক integer হতে হবে (minor units)",
    en: "budgetCapMinor must be a positive integer (minor units)",
  },
  "messaging.budgetCapSpendBasedFromYour": {
    bn: "Budget cap (খরচ-ভিত্তিক, আপনার দেওয়া rate থেকে): {{blockReason}} audience কমান, Messaging settings-এ cap বাড়ান, অথবা cap তুলে দিন।",
    en: "Budget cap (spend-based, from your entered rates): {{blockReason}} Lower the audience, raise the cap in Messaging settings, or remove the cap.",
  },
  "messaging.cSVAudienceHasAddressesLengthAddressesOver": {
    bn: "CSV audience-এ {{addressesLength}}টি ঠিকানা আছে, যা cap {{CSV_AUDIENCE_CAP}}-এর বেশি। নীরবে কেটে না দিয়ে তালিকাটি ভাগ করুন।",
    en: "CSV audience has {{addressesLength}} addresses, over the cap of {{CSV_AUDIENCE_CAP}}. Split the list instead of silently truncating it.",
  },
  "messaging.cSVAudienceHasAudienceCsvLengthAddressesOver": {
    bn: "CSV audience-এ {{audienceCsvLength}}টি ঠিকানা আছে, যা cap {{CSV_AUDIENCE_CAP}}-এর বেশি। নীরবে কেটে না দিয়ে তালিকাটি ভাগ করুন।",
    en: "CSV audience has {{audienceCsvLength}} addresses, over the cap of {{CSV_AUDIENCE_CAP}}. Split the list instead of silently truncating it.",
  },
  "messaging.cSVHasNoDataRows": {
    bn: "CSV-তে কোনো data row নেই",
    en: "CSV has no data rows",
  },
  "messaging.cSVImportIsCappedAt5000": {
    bn: "CSV import প্রতি ফাইলে সর্বোচ্চ ৫০০০ সারিতে সীমাবদ্ধ",
    en: "CSV import is capped at 5000 rows per file",
  },
  "messaging.cSVImportIsNotAvailableDatabase": {
    bn: "CSV import পাওয়া যাচ্ছে না (database migration বাকি)।",
    en: "CSV import is not available (database migration pending).",
  },
  "messaging.cSVMustHaveAHeaderRow": {
    bn: "CSV-তে একটি header row থাকতে হবে",
    en: "CSV must have a header row",
  },
  "messaging.cascadeWhatsAppTemplateNotFoundIn": {
    bn: "এই সংস্থায় cascade WhatsApp template পাওয়া যায়নি",
    en: "Cascade WhatsApp template not found in this organization",
  },
  "messaging.channelMustBeEmailOrSms": {
    bn: "channel অবশ্যই email বা sms হতে হবে",
    en: "channel must be email or sms",
  },
  "messaging.channelMustBeEmailOrSms2": {
    bn: "AI draft-এর জন্য channel অবশ্যই email বা sms হতে হবে (WhatsApp broadcast শুধু approved Meta template পাঠায়)",
    en: "channel must be email or sms for AI drafts (WhatsApp broadcasts send approved Meta templates only)",
  },
  "messaging.channelMustBeEmailSmsOr": {
    bn: "channel অবশ্যই email, sms বা whatsapp হতে হবে",
    en: "channel must be email, sms or whatsapp",
  },
  "messaging.channelMustBeEmailSmsWhatsapp": {
    bn: "channel অবশ্যই email, sms, whatsapp, push, telegram বা onsite হতে হবে",
    en: "channel must be email, sms, whatsapp, push, telegram or onsite",
  },
  "messaging.channelMustBeEmailSmsWhatsapp2": {
    bn: "channel অবশ্যই email, sms, whatsapp বা telegram হতে হবে (push/onsite test send টাইপ করা ঠিকানায় যেতে পারে না)",
    en: "channel must be email, sms, whatsapp or telegram (push/onsite test sends cannot target a typed address)",
  },
  "messaging.channelsMustBeANonEmpty": {
    bn: "channels অবশ্যই email, sms, whatsapp-এর একটি খালি-নয় subset হতে হবে",
    en: "channels must be a non-empty subset of email, sms, whatsapp",
  },
  "messaging.conditionsMustBeAnArrayOf": {
    bn: "conditions অবশ্যই {field, op, value}-এর একটি array হতে হবে",
    en: "conditions must be an array of {field, op, value}",
  },
  "messaging.contentBlockNotFound": {
    bn: "Content block পাওয়া যায়নি",
    en: "Content block not found",
  },
  "messaging.customSavedAndCSVAudiencesAre": {
    bn: "Custom, saved ও CSV audience ইমেইল/ফোন ঠিকানা দিয়ে চেনা হয় — telegram chat এভাবে পাওয়া যায় না। Telegram-এর জন্য telegram_subscribers, customers, leads_stage অথবা segment audience ব্যবহার করুন।",
    en: "Custom, saved and CSV audiences are keyed on email/phone addresses and cannot resolve telegram chats. Use the telegram_subscribers, customers, leads_stage or segment audiences for telegram.",
  },
  "messaging.dailyAIGenerationLimitReachedFor": {
    bn: "এই সংস্থার দৈনিক AI তৈরির সীমা শেষ ({{limit}})। আগামীকাল আবার চেষ্টা করুন অথবা platform team-কে plan-এর সীমা বাড়াতে বলুন।",
    en: "Daily AI generation limit reached for this organization ({{limit}}). Try again tomorrow or ask the platform team to raise your plan limit.",
  },
  "messaging.decisionMustBeConfirmOrDismiss": {
    bn: "decision অবশ্যই \"confirm\" বা \"dismiss\" হতে হবে",
    en: "decision must be \"confirm\" or \"dismiss\"",
  },
  "messaging.descriptionIsRequiredDescribeTheSegment": {
    bn: "description লাগবে — নিজের ভাষায় segment-টি বর্ণনা করুন",
    en: "description is required — describe the segment in your own words",
  },
  "messaging.descriptionIsTooLongMax1000": {
    bn: "description খুব লম্বা (সর্বোচ্চ ১০০০ অক্ষর)",
    en: "description is too long (max 1000 characters)",
  },
  "messaging.doubleOptInNeedsAConfirmation": {
    bn: "Double opt-in-এর জন্য একটি confirmation পথ লাগবে: ইমেইল channel যোগ করুন (confirmation link) অথবা একটি WhatsApp opt-in keyword সেট করুন।",
    en: "Double opt-in needs a confirmation path: include the email channel (confirmation link) or set a WhatsApp opt-in keyword.",
  },
  "messaging.eachConditionNeedsAFieldAnd": {
    bn: "প্রতিটি condition-এ একটি field ও একটি operator লাগবে",
    en: "Each condition needs a field and an operator",
  },
  "messaging.eachJourneyStepMustBeAn": {
    bn: "প্রতিটি journey step একটি object হতে হবে",
    en: "Each journey step must be an object",
  },
  "messaging.emailBroadcastsNeedASubject": {
    bn: "ইমেইল broadcast-এর subject লাগবে",
    en: "Email broadcasts need a subject",
  },
  "messaging.emailIsRequired": {
    bn: "ইমেইল লাগবে",
    en: "Email is required",
  },
  "messaging.emailTemplatesNeedASubject": {
    bn: "ইমেইল template-এর subject লাগবে",
    en: "Email templates need a subject",
  },
  "messaging.enabledMustBeABoolean": {
    bn: "enabled একটি boolean হতে হবে",
    en: "enabled must be a boolean",
  },
  "messaging.enabledMustBeTrueFalseOr": {
    bn: "enabled অবশ্যই true, false বা null হতে হবে (সংস্থার setting inherit করে)",
    en: "enabled must be true, false, or null (inherit the organization setting)",
  },
  "messaging.festivalTemplatePackNotFound": {
    bn: "Festival template pack পাওয়া যায়নি",
    en: "Festival template pack not found",
  },
  "messaging.formNotFound": {
    bn: "Form পাওয়া যায়নি",
    en: "Form not found",
  },
  "messaging.fourEyesRuleTheBroadcastS": {
    bn: "Four-eyes নিয়ম: broadcast-এর লেখক কখনোই নিজের broadcast approve করতে পারেন না — অন্য একজন approver-কে সিদ্ধান্ত নিতে হবে।",
    en: "Four-eyes rule: the broadcast's creator can never approve their own broadcast — a different approver must decide.",
  },
  "messaging.fourEyesRuleTheBroadcastS2": {
    bn: "Four-eyes নিয়ম: broadcast-এর লেখক কখনোই নিজের broadcast reject করতে পারেন না — অন্য একজন approver-কে সিদ্ধান্ত নিতে হবে।",
    en: "Four-eyes rule: the broadcast's creator can never reject their own broadcast — a different approver must decide.",
  },
  "messaging.frequencyCapPerDayMustBeAnIntegerBetween": {
    bn: "frequencyCapPerDay ০ থেকে ২০-এর মধ্যে একটি integer হতে হবে (0 = বন্ধ)",
    en: "frequencyCapPerDay must be an integer between 0 and 20 (0 = off)",
  },
  "messaging.goalIsRequiredSayWhatThis": {
    bn: "goal লাগবে — এই message কী অর্জন করবে তা বলুন",
    en: "goal is required — say what this message should achieve",
  },
  "messaging.goalIsRequiredSayWhatThis2": {
    bn: "goal লাগবে — এই campaign কী অর্জন করবে তা বলুন",
    en: "goal is required — say what this campaign should achieve",
  },
  "messaging.goalIsTooLongMax1000": {
    bn: "goal খুব লম্বা (সর্বোচ্চ ১০০০ অক্ষর)",
    en: "goal is too long (max 1000 characters)",
  },
  "messaging.holdoutPercentMustBeAnIntegerBetween": {
    bn: "holdoutPercent ১ থেকে ৫০-এর মধ্যে একটি integer হতে হবে (holdout না চাইলে বাদ দিন)",
    en: "holdoutPercent must be an integer between 1 and 50 (omit it for no holdout)",
  },
  "messaging.htmlBodyIsOnlyAllowedForEmail": {
    bn: "htmlBody শুধু ইমেইল template-এর জন্য (SMS-এর কোনো HTML অংশ নেই)",
    en: "htmlBody is only allowed for email templates (SMS has no HTML part)",
  },
  "messaging.htmlBodyIsOnlyAllowedForEmail2": {
    bn: "htmlBody শুধু ইমেইল broadcast-এর জন্য (SMS/WhatsApp/Push-এর কোনো HTML অংশ নেই)",
    en: "htmlBody is only allowed for email broadcasts (SMS/WhatsApp/Push have no HTML part)",
  },
  "messaging.htmlBodyIsOnlyAllowedForEmail3": {
    bn: "htmlBody শুধু ইমেইল broadcast-এর জন্য (SMS/WhatsApp-এর কোনো HTML অংশ নেই)",
    en: "htmlBody is only allowed for email broadcasts (SMS/WhatsApp have no HTML part)",
  },
  "messaging.importIsCappedAt1000Addresses": {
    bn: "Import প্রতি request-এ সর্বোচ্চ ১০০০ ঠিকানায় সীমাবদ্ধ",
    en: "Import is capped at 1000 addresses per request",
  },
  "messaging.importNotFound": {
    bn: "Import পাওয়া যায়নি",
    en: "Import not found",
  },
  "messaging.invalidEmailAddress": {
    bn: "ইমেইল ঠিকানা সঠিক নয়",
    en: "Invalid email address",
  },
  "messaging.invalidEmailAddressRaw": {
    bn: "ইমেইল ঠিকানা সঠিক নয়: {{raw}}",
    en: "Invalid email address: {{raw}}",
  },
  "messaging.invalidOnsiteCustomerIdRaw": {
    bn: "Onsite customer id সঠিক নয়: {{raw}}",
    en: "Invalid onsite customer id: {{raw}}",
  },
  "messaging.invalidPhoneNumber": {
    bn: "ফোন নম্বর সঠিক নয়",
    en: "Invalid phone number",
  },
  "messaging.invalidPhoneNumberRaw": {
    bn: "ফোন নম্বর সঠিক নয়: {{raw}}",
    en: "Invalid phone number: {{raw}}",
  },
  "messaging.invalidPushSubscriptionEndpointRaw": {
    bn: "Push subscription endpoint সঠিক নয়: {{raw}}",
    en: "Invalid push subscription endpoint: {{raw}}",
  },
  "messaging.invalidTelegramChatIdRaw": {
    bn: "Telegram chat id সঠিক নয়: {{raw}}",
    en: "Invalid Telegram chat id: {{raw}}",
  },
  "messaging.itemsIsRequiredConfirmAtLeast": {
    bn: "items লাগবে — suppress করতে অন্তত একটি contact নিশ্চিত করুন",
    en: "items is required — confirm at least one contact to suppress",
  },
  "messaging.journeyNotFound": {
    bn: "Journey পাওয়া যায়নি",
    en: "Journey not found",
  },
  "messaging.journeyPresetNotFound": {
    bn: "Journey preset পাওয়া যায়নি",
    en: "Journey preset not found",
  },
  "messaging.journeyStepsMustBeAnArray": {
    bn: "Journey steps একটি array হতে হবে",
    en: "Journey steps must be an array",
  },
  "messaging.kIsAReservedKeywordSTOP": {
    bn: "\"{{k}}\" একটি সংরক্ষিত keyword (STOP/START সেট) — opt-out/opt-in handling-ই এর একমাত্র মালিক, কোনো poll option এটি দাবি করতে পারে না।",
    en: "\"{{k}}\" is a reserved keyword (STOP/START set) — opt-out/opt-in handling owns it exclusively and a poll option can never claim it.",
  },
  "messaging.keyMustBeANonNegative": {
    bn: "{{key}} একটি অঋণাত্মক integer (minor units) বা null হতে হবে",
    en: "{{key}} must be a non-negative integer (minor units) or null",
  },
  "messaging.keywordCampaignsAreNotAvailableIn": {
    bn: "Keyword campaign এই deployment-এ পাওয়া যাচ্ছে না (MX6 table নেই — migration চলেনি)।",
    en: "Keyword campaigns are not available in this deployment (the MX6 tables are missing — the migration has not run).",
  },
  "messaging.keywordCampaignsAreWhatsAppOnlyIn": {
    bn: "Keyword campaign এই version-এ শুধু WhatsApp-এর জন্য: \"{{channel}}\" channel-এর messaging-এ কোনো inbound message পথ নেই",
    en: "Keyword campaigns are WhatsApp-only in this version: channel \"{{channel}}\" has no inbound message path into messaging ",
  },
  "messaging.keywordHitNotFound": {
    bn: "Keyword hit পাওয়া যায়নি",
    en: "Keyword hit not found",
  },
  "messaging.keywordIsAReservedKeywordSTOP": {
    bn: "\"{{keyword}}\" একটি সংরক্ষিত keyword (STOP/START সেট) — এটি কখনোই opt-in keyword হতে পারে না।",
    en: "\"{{keyword}}\" is a reserved keyword (STOP/START set) and can never be an opt-in keyword.",
  },
  "messaging.keywordIsAReservedKeywordSTOP2": {
    bn: "\"{{keyword}}\" একটি সংরক্ষিত keyword (STOP/START সেট) — opt-out/opt-in handling-ই এর একমাত্র মালিক, কোনো campaign rule এটি দাবি করতে পারে না।",
    en: "\"{{keyword}}\" is a reserved keyword (STOP/START set) — opt-out/opt-in handling owns it exclusively and a campaign rule can never claim it.",
  },
  "messaging.keywordIsRequiredForAKeyword": {
    bn: "একটি keyword rule-এর জন্য keyword লাগবে",
    en: "keyword is required for a keyword rule",
  },
  "messaging.keywordIsTooLongMax100": {
    bn: "Keyword খুব লম্বা (সর্বোচ্চ ১০০ অক্ষর)",
    en: "Keyword is too long (max 100 characters)",
  },
  "messaging.keywordKeywordIsAlreadyClaimedBy": {
    bn: "\"{{keyword}}\" keyword-টি ইতিমধ্যে একটি keyword campaign rule দাবি করেছে।",
    en: "Keyword \"{{keyword}}\" is already claimed by a keyword campaign rule.",
  },
  "messaging.keywordKeywordIsAlreadyUsedBy": {
    bn: "\"{{keyword}}\" keyword-টি ইতিমধ্যে অন্য একটি opt-in form ব্যবহার করছে।",
    en: "Keyword \"{{keyword}}\" is already used by another opt-in form.",
  },
  "messaging.keywordNkIsAlreadyClaimedBy": {
    bn: "\"{{nk}}\" keyword-টি ইতিমধ্যে চালু rule \"{{name}}\" দাবি করেছে — আগে সেই rule বন্ধ বা সম্পাদনা করুন।",
    en: "Keyword \"{{nk}}\" is already claimed by the enabled rule \"{{name}}\" — disable or edit that rule first.",
  },
  "messaging.keywordRuleNotFound": {
    bn: "Keyword rule পাওয়া যায়নি",
    en: "Keyword rule not found",
  },
  "messaging.kindMustBeKeywordOrPoll": {
    bn: "kind অবশ্যই \"keyword\" বা \"poll\" হতে হবে",
    en: "kind must be \"keyword\" or \"poll\"",
  },
  "messaging.linkTrackingEnabledMustBeABoolean": {
    bn: "linkTrackingEnabled একটি boolean হতে হবে",
    en: "linkTrackingEnabled must be a boolean",
  },
  "messaging.mapTheEmailColumnForAn": {
    bn: "ইমেইল import-এর জন্য ইমেইল column map করুন",
    en: "Map the email column for an email import",
  },
  "messaging.mapThePhoneColumnForA": {
    bn: "ফোন-channel import-এর জন্য ফোন column map করুন",
    en: "Map the phone column for a phone-channel import",
  },
  "messaging.mappedColumnKeyIsNotIn": {
    bn: "\"{{key}}\" map করা column-টি CSV header-এ নেই ({{headersJoin}})",
    en: "Mapped column \"{{key}}\" is not in the CSV header ({{headersJoin}})",
  },
  "messaging.marketingMaxBroadcastsPerSweepMustBeNullPlatformDefa": {
    bn: "marketingMaxBroadcastsPerSweep অবশ্যই null (platform default) অথবা ১ থেকে {{MARKETING_SWEEP_MAX_BROADCASTS_LIMIT}}-এর মধ্যে একটি integer হতে হবে",
    en: "marketingMaxBroadcastsPerSweep must be null (platform default) or an integer between 1 and {{MARKETING_SWEEP_MAX_BROADCASTS_LIMIT}}",
  },
  "messaging.marketingMaxEntriesPerSweepMustBeNullPlatformDefault": {
    bn: "marketingMaxEntriesPerSweep অবশ্যই null (platform default) অথবা ১ থেকে {{MARKETING_SWEEP_MAX_ENTRIES_LIMIT}}-এর মধ্যে একটি integer হতে হবে",
    en: "marketingMaxEntriesPerSweep must be null (platform default) or an integer between 1 and {{MARKETING_SWEEP_MAX_ENTRIES_LIMIT}}",
  },
  "messaging.maxPerDayMustBeAnIntegerBetween": {
    bn: "maxPerDay ০ থেকে ২০-এর মধ্যে একটি integer বা null হতে হবে",
    en: "maxPerDay must be an integer between 0 and 20, or null",
  },
  "messaging.nameIsRequired": {
    bn: "name লাগবে",
    en: "name is required",
  },
  "messaging.nameMustBeAnIntegerBetween": {
    bn: "{{name}} {{min}} থেকে {{max}}-এর মধ্যে একটি integer হতে হবে",
    en: "{{name}} must be an integer between {{min}} and {{max}}",
  },
  "messaging.nameMustBeNullNoCap": {
    bn: "{{name}} অবশ্যই null (কোনো cap নয়) বা minor units-এ একটি ধনাত্মক integer হতে হবে",
    en: "{{name}} must be null (no cap) or a positive integer of minor units",
  },
  "messaging.noConnectedWhatsAppIntegrationForThis": {
    bn: "এই সংস্থার কোনো connected WhatsApp integration নেই",
    en: "No connected WhatsApp integration for this organization",
  },
  "messaging.noEmailPathIsConfiguredFor": {
    bn: "এই সংস্থার জন্য কোনো ইমেইল পথ কনফিগার করা নেই: নিজের SMTP settings সংরক্ষণ করুন অথবা platform admin-কে platform SMTP কনফিগার করতে বলুন।",
    en: "No email path is configured for this organization: save your own SMTP settings or ask the platform admin to configure platform SMTP.",
  },
  "messaging.noRecordWasFoundForThis": {
    bn: "এই সাবস্ক্রিপশনের কোনো রেকর্ড পাওয়া যায়নি।",
    en: "No record was found for this subscription.",
  },
  "messaging.onSiteBodyMustBeAt": {
    bn: "On-site body সর্বোচ্চ ২০০০ অক্ষরের হতে হবে",
    en: "On-site body must be at most 2000 characters",
  },
  "messaging.onSiteBroadcastsCannotBeTest": {
    bn: "On-site broadcast টাইপ করা ঠিকানায় test-send করা যাবে না — এগুলো কাস্টমারের shop account-এর notification center-এ দেখায়, আর একটি test আসল কাস্টমারের center দূষিত করা উচিত নয়। এর বদলে একটি সংকীর্ণ customers audience-এ (যেমন শুধু আপনার test account-এর segment) আসল broadcast পাঠান।",
    en: "On-site broadcasts cannot be test-sent to a typed address — they appear in a customer's shop account notification center, and a test must not pollute a real customer's center. Send a real broadcast to a narrow customers audience (e.g. a segment with only your test account) instead.",
  },
  "messaging.onSiteBroadcastsDoNotUse": {
    bn: "On-site broadcast message template ব্যবহার করে না — title/body সরাসরি broadcast-এই লেখা হয়",
    en: "On-site broadcasts do not use message templates — the title/body are written directly on the broadcast",
  },
  "messaging.onSiteBroadcastsDoNotUse2": {
    bn: "On-site broadcast message template ব্যবহার করে না — title/body সরাসরি সম্পাদনা করুন",
    en: "On-site broadcasts do not use message templates — edit the title/body directly",
  },
  "messaging.onSiteBroadcastsNeedATitle": {
    bn: "On-site broadcast-এর একটি title (subject) লাগবে",
    en: "On-site broadcasts need a title (subject)",
  },
  "messaging.onSiteTitleMustBeAt": {
    bn: "On-site title সর্বোচ্চ ১২০ অক্ষরের হতে হবে",
    en: "On-site title must be at most 120 characters",
  },
  "messaging.onlyADraftBroadcastCanBe": {
    bn: "শুধু draft broadcast approval-এর জন্য জমা দেওয়া যায় (এটি {{broadcastStatus}})",
    en: "Only a draft broadcast can be submitted for approval (this one is {{broadcastStatus}})",
  },
  "messaging.onlyADraftBroadcastCanBe2": {
    bn: "শুধু draft broadcast schedule করা যায় (এটি {{broadcastStatus}})",
    en: "Only a draft broadcast can be scheduled (this one is {{broadcastStatus}})",
  },
  "messaging.onlyAFinishedBroadcastSentPartial": {
    bn: "শুধু শেষ হওয়া broadcast-এর (sent/partial/failed) ব্যর্থতা retry করা যায় (এটি {{broadcastStatus}})",
    en: "Only a finished broadcast (sent/partial/failed) can retry failures (this one is {{broadcastStatus}})",
  },
  "messaging.onlyAPausedBroadcastCanBe": {
    bn: "শুধু paused broadcast resume করা যায় (এটি {{broadcastStatus}})",
    en: "Only a paused broadcast can be resumed (this one is {{broadcastStatus}})",
  },
  "messaging.onlyAScheduledBroadcastHasA": {
    bn: "শুধু scheduled broadcast-এরই বাতিল করার মতো schedule থাকে",
    en: "Only a scheduled broadcast has a schedule to cancel",
  },
  "messaging.onlyASendingOrScheduledBroadcast": {
    bn: "শুধু sending বা scheduled broadcast pause করা যায় (এটি {{broadcastStatus}})",
    en: "Only a sending or scheduled broadcast can be paused (this one is {{broadcastStatus}})",
  },
  "messaging.onlyAnOWNEROrADMINMember": {
    bn: "শুধু OWNER বা ADMIN সদস্য broadcast approve করতে পারেন।",
    en: "Only an OWNER or ADMIN member can approve a broadcast.",
  },
  "messaging.onlyAnOWNEROrADMINMember2": {
    bn: "শুধু OWNER বা ADMIN সদস্য broadcast reject করতে পারেন।",
    en: "Only an OWNER or ADMIN member can reject a broadcast.",
  },
  "messaging.onsiteUrlIsOnlyAllowedForOnsite": {
    bn: "onsiteUrl শুধু onsite broadcast-এর জন্য",
    en: "onsiteUrl is only allowed for onsite broadcasts",
  },
  "messaging.optInFormNotFound": {
    bn: "Opt-in form পাওয়া যায়নি",
    en: "Opt-in form not found",
  },
  "messaging.optInFormsAreNotAvailable": {
    bn: "Opt-in form পাওয়া যাচ্ছে না (database migration বাকি)।",
    en: "Opt-in forms are not available (database migration pending).",
  },
  "messaging.personalisationIsNotEnabledInThis": {
    bn: "এই preview request-এ personalisation চালু নেই — personalization: { enabled: true } পাঠান (AI hook-এর জন্য tier2AiHook: true সহ)",
    en: "personalisation is not enabled in this preview request — pass personalization: { enabled: true } (with tier2AiHook: true for AI hooks)",
  },
  "messaging.personalizationCannotBeCombinedWithA": {
    bn: "এই version-এ personalization channel cascade-এর সঙ্গে মেলানো যাবে না — cascade-ই প্রতি-channel content-এর মালিক",
    en: "personalization cannot be combined with a channel cascade in this version — the cascade owns per-channel content",
  },
  "messaging.personalizationIsNotAvailableForOnsite": {
    bn: "onsite broadcast-এর জন্য personalization পাওয়া যায় না (notification একটি দৈর্ঘ্য-সীমাবদ্ধ title/body — dynamic block তা ছাড়িয়ে যেতে পারে)",
    en: "personalization is not available for onsite broadcasts (the notification is a length-capped title/body — dynamic blocks could overflow it)",
  },
  "messaging.personalizationIsNotAvailableForPush": {
    bn: "push broadcast-এর জন্য personalization পাওয়া যায় না (push payload একটি দৈর্ঘ্য-সীমাবদ্ধ title/body — dynamic block তা ছাড়িয়ে যেতে পারে)",
    en: "personalization is not available for push broadcasts (the push payload is a length-capped title/body — dynamic blocks could overflow it)",
  },
  "messaging.personalizationIsNotAvailableForTelegram": {
    bn: "telegram broadcast-এর জন্য personalization পাওয়া যায় না (Telegram একটি message ৪০৯৬ অক্ষরে সীমাবদ্ধ করে — dynamic block তা ছাড়িয়ে যেতে পারে)",
    en: "personalization is not available for telegram broadcasts (Telegram caps a message at 4096 characters — dynamic blocks could overflow it)",
  },
  "messaging.personalizationIsNotAvailableForWhatsApp": {
    bn: "WhatsApp broadcast-এর জন্য personalization পাওয়া যায় না (এগুলো Meta-approved template পাঠায়, free-text content নয়)",
    en: "personalization is not available for WhatsApp broadcasts (they send Meta-approved templates, not free-text content)",
  },
  "messaging.phoneIsRequired": {
    bn: "ফোন নম্বর লাগবে",
    en: "Phone is required",
  },
  "messaging.pollKeywordKIsClaimedBy": {
    bn: "\"{{k}}\" poll keyword-টি একাধিক option দাবি করেছে (\"{{prior}}\" ও \"{{label}}\") — একটি keyword শুধু একটি option-কেই vote দিতে পারে",
    en: "Poll keyword \"{{k}}\" is claimed by more than one option (\"{{prior}}\" and \"{{label}}\") — a keyword can only vote for one option",
  },
  "messaging.pollKeywordKIsTooLong": {
    bn: "\"{{k}}\" poll keyword-টি খুব লম্বা (সর্বোচ্চ ১০০ অক্ষর)",
    en: "Poll keyword \"{{k}}\" is too long (max 100 characters)",
  },
  "messaging.pollOptionKeyNeedsALabel": {
    bn: "\"{{key}}\" poll option-টির একটি label লাগবে",
    en: "Poll option \"{{key}}\" needs a label",
  },
  "messaging.pollOptionKeysMustBeUnique": {
    bn: "Poll option key অনন্য হতে হবে — \"{{key}}\" দুবার এসেছে",
    en: "Poll option keys must be unique — \"{{key}}\" appears twice",
  },
  "messaging.pollOptionLabelNeedsAtLeast": {
    bn: "\"{{label}}\" poll option-টির অন্তত একটি keyword লাগবে",
    en: "Poll option \"{{label}}\" needs at least one keyword",
  },
  "messaging.pollOptionsBelongToPollRulesA": {
    bn: "pollOptions poll rule-এর জন্য — একটি keyword rule তার একক keyword দিয়ে match করে",
    en: "pollOptions belong to poll rules — a keyword rule matches its single keyword",
  },
  "messaging.pollRulesMatchThroughTheirOptions": {
    bn: "Poll rule তার option-গুলোর keyword দিয়ে match করে — rule-level keyword খালি থাকতে হবে",
    en: "Poll rules match through their options' keywords — the rule-level keyword must be empty",
  },
  "messaging.pollRulesOnlyRecordVotesIn": {
    bn: "Poll rule এই version-এ শুধু vote রেকর্ড করে — poll-এর জন্য tag ও auto-reply প্রয়োগ হয় না",
    en: "Poll rules only record votes in this version — tags and auto-replies are not applied for polls",
  },
  "messaging.preferenceNotFound": {
    bn: "Preference পাওয়া যায়নি",
    en: "Preference not found",
  },
  "messaging.priorityMustBeAnIntegerBetween": {
    bn: "priority ০ থেকে ১০০০-এর মধ্যে একটি integer হতে হবে (কম = আগে পাঠায়)",
    en: "priority must be an integer between 0 and 1000 (lower sends first)",
  },
  "messaging.productNotFoundInThisOrganization": {
    bn: "এই সংস্থায় পণ্য পাওয়া যায়নি",
    en: "Product not found in this organization",
  },
  "messaging.pushBodyMustBeAtMost": {
    bn: "Push body সর্বোচ্চ ৩০০ অক্ষরের হতে হবে",
    en: "Push body must be at most 300 characters",
  },
  "messaging.pushBroadcastsCannotBeTestSent": {
    bn: "Push broadcast টাইপ করা ঠিকানায় test-send করা যাবে না — push browser subscription-এ পৌঁছায়, ঠিকানায় নয়। এর বদলে Web Push panel-এ একটি test device register করে সেখান থেকে test-send করুন।",
    en: "Push broadcasts cannot be test-sent to a typed address — push reaches browser subscriptions, not addresses. Register a test device in the Web Push panel and test-send from there instead.",
  },
  "messaging.pushBroadcastsDoNotUseMessage": {
    bn: "Push broadcast message template ব্যবহার করে না — title/body সরাসরি broadcast-এই লেখা হয়",
    en: "Push broadcasts do not use message templates — the title/body are written directly on the broadcast",
  },
  "messaging.pushBroadcastsDoNotUseMessage2": {
    bn: "Push broadcast message template ব্যবহার করে না — title/body সরাসরি সম্পাদনা করুন",
    en: "Push broadcasts do not use message templates — edit the title/body directly",
  },
  "messaging.pushBroadcastsNeedATitleSubject": {
    bn: "Push broadcast-এর একটি title (subject) লাগবে",
    en: "Push broadcasts need a title (subject)",
  },
  "messaging.pushTitleMustBeAtMost": {
    bn: "Push title সর্বোচ্চ ১২০ অক্ষরের হতে হবে",
    en: "Push title must be at most 120 characters",
  },
  "messaging.pushUrlIsOnlyAllowedForPush": {
    bn: "pushUrl শুধু push broadcast-এর জন্য",
    en: "pushUrl is only allowed for push broadcasts",
  },
  "messaging.quietHoursEnabledMustBeABoolean": {
    bn: "quietHoursEnabled একটি boolean হতে হবে",
    en: "quietHoursEnabled must be a boolean",
  },
  "messaging.quietHoursEndMustBeNullOrA": {
    bn: "quietHoursEnd অবশ্যই null বা একটি HH:mm সময় হতে হবে (00:00–23:59)",
    en: "quietHoursEnd must be null or a HH:mm time (00:00–23:59)",
  },
  "messaging.quietHoursStartAndQuietHoursEndAreBothRequired": {
    bn: "quiet hours চালু করতে quietHoursStart ও quietHoursEnd দুটোই লাগবে",
    en: "quietHoursStart and quietHoursEnd are both required to enable quiet hours",
  },
  "messaging.quietHoursStartAndQuietHoursEndMustDifferAn": {
    bn: "quietHoursStart ও quietHoursEnd আলাদা হতে হবে (একটি খালি quiet window চলবে না)",
    en: "quietHoursStart and quietHoursEnd must differ (an empty quiet window is not allowed)",
  },
  "messaging.quietHoursStartMustBeNullOrA": {
    bn: "quietHoursStart অবশ্যই null বা একটি HH:mm সময় হতে হবে (00:00–23:59)",
    en: "quietHoursStart must be null or a HH:mm time (00:00–23:59)",
  },
  "messaging.recipientIdIsRequired": {
    bn: "recipientId লাগবে",
    en: "recipientId is required",
  },
  "messaging.recipientTypeMustBeCustomerOrLead": {
    bn: "recipientType অবশ্যই \"customer\" বা \"lead\" হতে হবে",
    en: "recipientType must be \"customer\" or \"lead\"",
  },
  "messaging.ruleNameIsTooLongMax": {
    bn: "Rule-এর নাম খুব লম্বা (সর্বোচ্চ ১২০ অক্ষর)",
    en: "Rule name is too long (max 120 characters)",
  },
  "messaging.sMSGatewayNotFound": {
    bn: "SMS gateway পাওয়া যায়নি",
    en: "SMS gateway not found",
  },
  "messaging.sMTPVerificationFailedNothingWasSaved": {
    bn: "SMTP verification ব্যর্থ — কিছুই সংরক্ষণ হয়নি: {{e}}",
    en: "SMTP verification failed — nothing was saved: {{e}}",
  },
  "messaging.savedAudienceNoLongerExistsIt": {
    bn: "Saved audience আর নেই — সম্ভবত মোছা হয়েছে। অন্য একটি audience বেছে নিন।",
    en: "Saved audience no longer exists — it may have been deleted. Choose another audience.",
  },
  "messaging.savedAudienceNotFound": {
    bn: "Saved audience পাওয়া যায়নি",
    en: "Saved audience not found",
  },
  "messaging.scheduledAtIsNotAValidDate": {
    bn: "scheduledAt একটি সঠিক date/time নয়",
    en: "scheduledAt is not a valid date/time",
  },
  "messaging.scheduledAtMustBeInTheFuture": {
    bn: "একটি broadcast schedule করতে scheduledAt ভবিষ্যতে হতে হবে",
    en: "scheduledAt must be in the future to schedule a broadcast",
  },
  "messaging.seedRecipientIsAChannelAddress": {
    bn: "Seed recipient একটি {{channel}} ঠিকানা, কিন্তু এই broadcast {{channel2}} — broadcast-এর channel-এর একটি seed বেছে নিন।",
    en: "Seed recipient is a {{channel}} address but this broadcast is {{channel2}} — pick a seed of the broadcast's channel.",
  },
  "messaging.seedRecipientNotFound": {
    bn: "Seed recipient পাওয়া যায়নি",
    en: "Seed recipient not found",
  },
  "messaging.seedRecipientStorageIsNotAvailable": {
    bn: "Seed recipient storage এই deployment-এ এখনো পাওয়া যাচ্ছে না (migration বাকি)।",
    en: "Seed recipient storage is not available in this deployment yet (migration pending).",
  },
  "messaging.segmentBlockSavedAudienceNotFound": {
    bn: "এই সংস্থায় segment block-এর saved audience পাওয়া যায়নি",
    en: "Segment block saved audience not found in this organization",
  },
  "messaging.slugMustContainLettersOrDigits": {
    bn: "slug-এ অক্ষর বা সংখ্যা থাকতে হবে",
    en: "slug must contain letters or digits",
  },
  "messaging.smsGatewayMustBeSslwirelessBulksmsbdOr": {
    bn: "smsGateway অবশ্যই sslwireless, bulksmsbd বা alphasms হতে হবে",
    en: "smsGateway must be sslwireless, bulksmsbd or alphasms",
  },
  "messaging.statusMustBeOptedOutOr": {
    bn: "status অবশ্যই opted_out বা opted_in হতে হবে",
    en: "status must be opted_out or opted_in",
  },
  "messaging.subjectIsRequired": {
    bn: "subject লাগবে",
    en: "subject is required",
  },
  "messaging.tagIsTooLongMax80": {
    bn: "Tag খুব লম্বা (সর্বোচ্চ ৮০ অক্ষর)",
    en: "Tag is too long (max 80 characters)",
  },
  "messaging.tallyIsOnlyAvailableForPoll": {
    bn: "Tally শুধু poll rule-এর জন্য পাওয়া যায়",
    en: "Tally is only available for poll rules",
  },
  "messaging.targetLanguageMustBeBnOrEn": {
    bn: "targetLanguage অবশ্যই \"bn\" বা \"en\" হতে হবে",
    en: "targetLanguage must be \"bn\" or \"en\"",
  },
  "messaging.telegramBroadcastsDoNotUseMessage": {
    bn: "Telegram broadcast message template ব্যবহার করে না — message-এর লেখা সরাসরি broadcast-এই লেখা হয়",
    en: "Telegram broadcasts do not use message templates — the message text is written directly on the broadcast",
  },
  "messaging.telegramBroadcastsDoNotUseMessage2": {
    bn: "Telegram broadcast message template ব্যবহার করে না — message-এর লেখা সরাসরি সম্পাদনা করুন",
    en: "Telegram broadcasts do not use message templates — edit the message text directly",
  },
  "messaging.telegramBroadcastsHaveNoSubjectThe": {
    bn: "Telegram broadcast-এর কোনো subject নেই — message-এর লেখাটাই পুরো message",
    en: "Telegram broadcasts have no subject — the message text is the whole message",
  },
  "messaging.telegramButtonsIsOnlyAllowedForTelegram": {
    bn: "telegramButtons শুধু telegram broadcast-এর জন্য",
    en: "telegramButtons is only allowed for telegram broadcasts",
  },
  "messaging.telegramMessageTextMustBeAt": {
    bn: "Telegram message-এর লেখা সর্বোচ্চ ৪০৯৬ অক্ষরের হতে হবে (Bot API-এর সীমা)",
    en: "Telegram message text must be at most 4096 characters (the Bot API limit)",
  },
  "messaging.templateBodyIsRequiredWriteOne": {
    bn: "Template-এর body লাগবে (একটি লিখুন অথবা blocks দিয়ে বানান)",
    en: "Template body is required (write one or build with blocks)",
  },
  "messaging.templateChannelChannelDoesNotMatch": {
    bn: "Template-এর channel ({{channel}}) step-এর সঙ্গে মেলে না ({{want}})",
    en: "Template channel ({{channel}}) does not match step ({{want}})",
  },
  "messaging.templateChannelDoesNotMatchThe": {
    bn: "Template-এর channel broadcast-এর channel-এর সঙ্গে মেলে না",
    en: "Template channel does not match the broadcast channel",
  },
  "messaging.templateComponentsButtonParamsIndexMustBeAn": {
    bn: "templateComponents.buttonParams: index একটি integer ≥ 0 হতে হবে",
    en: "templateComponents.buttonParams: index must be an integer ≥ 0",
  },
  "messaging.templateComponentsButtonParamsMustBeAnArray": {
    bn: "templateComponents.buttonParams একটি array হতে হবে",
    en: "templateComponents.buttonParams must be an array",
  },
  "messaging.templateComponentsButtonParamsSubTypeMustBeUrl": {
    bn: "templateComponents.buttonParams: subType অবশ্যই \"url\" বা \"quick_reply\" হতে হবে",
    en: "templateComponents.buttonParams: subType must be \"url\" or \"quick_reply\"",
  },
  "messaging.templateComponentsHeaderMediaUrlMustBeAnHttp": {
    bn: "templateComponents.headerMediaUrl একটি http(s) URL হতে হবে",
    en: "templateComponents.headerMediaUrl must be an http(s) URL",
  },
  "messaging.templateComponentsHeaderTextParamsMustBeAnArray": {
    bn: "templateComponents.headerTextParams string-এর একটি array হতে হবে",
    en: "templateComponents.headerTextParams must be an array of strings",
  },
  "messaging.templateComponentsIsOnlyAllowedForWhatsApp": {
    bn: "templateComponents শুধু WhatsApp broadcast-এর জন্য",
    en: "templateComponents is only allowed for WhatsApp broadcasts",
  },
  "messaging.templateComponentsMustBeAnObject": {
    bn: "templateComponents একটি object হতে হবে",
    en: "templateComponents must be an object",
  },
  "messaging.templateNotFound": {
    bn: "Template পাওয়া যায়নি",
    en: "Template not found",
  },
  "messaging.templateParamsMustBeAnArrayOf": {
    bn: "templateParams string-এর একটি array হতে হবে",
    en: "templateParams must be an array of strings",
  },
  "messaging.templateVersionNotFound": {
    bn: "Template version পাওয়া যায়নি",
    en: "Template version not found",
  },
  "messaging.templateVersioningIsNotAvailableIn": {
    bn: "Template versioning এই deployment-এ পাওয়া যাচ্ছে না",
    en: "Template versioning is not available in this deployment",
  },
  "messaging.tenantSMTPNeedsAtLeastA": {
    bn: "Tenant SMTP-এর জন্য অন্তত একটি host ও একটি From ঠিকানা লাগবে (এবং একটি stored password থাকলে তা decrypt-যোগ্য হতে হবে)",
    en: "Tenant SMTP needs at least a host and a From address (and a decryptable stored password, if one is set)",
  },
  "messaging.theAIResponseCouldNotBe": {
    bn: "AI উত্তর বোঝা যায়নি — আবার চেষ্টা করুন।",
    en: "The AI response could not be understood — please try again.",
  },
  "messaging.theAuthorOfThisBroadcastHas": {
    bn: "এই WhatsApp অ্যাকাউন্টে ব্রডকাস্ট পাঠানোর অনুমতি ব্রডকাস্টের লেখককে দেওয়া হয়নি — Connect Center-এর অ্যাক্সেস সেটিংসে তার এই কানেকশনের অনুমতি প্রত্যাহার করা হয়েছে।",
    en: "The author of this broadcast has not been given permission to send broadcasts on this WhatsApp account — their access to this connection has been revoked in the Connect Center access settings.",
  },
  "messaging.theRealAILLMIsNot": {
    bn: "আসল AI (LLM) কনফিগার করা হয়নি — Dev Template Adapter অনুবাদ করতে পারে না।",
    en: "The real AI (LLM) is not configured — the Dev Template Adapter cannot translate.",
  },
  "messaging.theRealAILLMIsNot2": {
    bn: "আসল AI (LLM) কনফিগার করা হয়নি — Dev Template Adapter গ্রাহকের রিপ্লাই শ্রেণিবদ্ধ করতে পারে না।",
    en: "The real AI (LLM) is not configured — the Dev Template Adapter cannot classify customer replies.",
  },
  "messaging.thereIsNoPendingAISuggestion": {
    bn: "এই hit-এ কোনো pending AI suggestion নেই — আগে classify করুন।",
    en: "There is no pending AI suggestion on this hit — classify it first.",
  },
  "messaging.thisBroadcastAlreadyFinishedBroadcastStatusThe": {
    bn: "এই broadcast ইতিমধ্যে শেষ ({{broadcastStatus}}) — auto-winner আর বদলানো যাবে না।",
    en: "This broadcast already finished ({{broadcastStatus}}) — the auto-winner can no longer be toggled.",
  },
  "messaging.thisBroadcastHasNoFailedRecipients": {
    bn: "এই broadcast-এ retry করার মতো কোনো ব্যর্থ প্রাপক নেই",
    en: "This broadcast has no failed recipients to retry",
  },
  "messaging.thisBroadcastIsArchivedUnarchiveIt": {
    bn: "এই broadcast archive করা — পাঠাতে unarchive করুন।",
    en: "This broadcast is archived — unarchive it to send.",
  },
  "messaging.thisBroadcastIsArchivedUnarchiveIt2": {
    bn: "এই broadcast archive করা — schedule করতে unarchive করুন।",
    en: "This broadcast is archived — unarchive it to schedule.",
  },
  "messaging.thisBroadcastIsArchivedUnarchiveIt3": {
    bn: "এই broadcast archive করা — সম্পাদনার আগে unarchive করুন।",
    en: "This broadcast is archived — unarchive it before editing.",
  },
  "messaging.thisBroadcastIsNotPartOf": {
    bn: "এই broadcast কোনো A/B test-এর অংশ নয় — বদলানোর মতো কোনো auto-winner নেই।",
    en: "This broadcast is not part of an A/B test — there is no auto-winner to toggle.",
  },
  "messaging.thisBroadcastIsNotPendingApproval": {
    bn: "এই broadcast approval-এর অপেক্ষায় নেই (status: {{broadcastStatus}})",
    en: "This broadcast is not pending approval (status: {{broadcastStatus}})",
  },
  "messaging.thisBroadcastIsScheduledForToISOString": {
    bn: "এই broadcast {{toISOString}}-এর জন্য schedule করা। এখনই পাঠাতে schedule বাতিল করুন।",
    en: "This broadcast is scheduled for {{toISOString}}. Cancel the schedule to send it now.",
  },
  "messaging.thisBroadcastWasAlreadySentOr": {
    bn: "এই broadcast ইতিমধ্যে পাঠানো হয়েছে (বা পাঠানো চলছে)। আবার পাঠাতে একটি নতুন broadcast বানান।",
    en: "This broadcast was already sent (or is sending). Create a new broadcast to send again.",
  },
  "messaging.thisBroadcastWasCancelledAndCan": {
    bn: "এই broadcast বাতিল করা হয়েছে এবং কখনোই পাঠানো যাবে না।",
    en: "This broadcast was cancelled and can never be sent.",
  },
  "messaging.thisConfirmationLinkIsInvalidOr": {
    bn: "এই নিশ্চিতকরণ লিংকটি অবৈধ বা মেয়াদোত্তীর্ণ। আবার সাইন আপ করুন।",
    en: "This confirmation link is invalid or has expired. Please sign up again.",
  },
  "messaging.thisImportWasAlreadyCommittedPreview": {
    bn: "এই import ইতিমধ্যে commit করা হয়েছে — নতুন import-এর জন্য আবার preview করুন।",
    en: "This import was already committed — preview again for a new import.",
  },
  "messaging.thisLinkIsInvalidOrHas": {
    bn: "এই লিংকটি অবৈধ বা মেয়াদোত্তীর্ণ। মূল বার্তার লিংকটি আবার চেষ্টা করুন।",
    en: "This link is invalid or has expired. Try the link from the original message again.",
  },
  "messaging.thisLinkIsInvalidOrHas2": {
    bn: "এই লিংকটি অবৈধ বা মেয়াদোত্তীর্ণ।",
    en: "This link is invalid or has expired.",
  },
  "messaging.thisTrackingPixelIsInvalidOr": {
    bn: "এই ট্র্যাকিং পিক্সেলটি অবৈধ বা মেয়াদোত্তীর্ণ।",
    en: "This tracking pixel is invalid or has expired.",
  },
  "messaging.thisUnsubscribeLinkIsInvalidOr": {
    bn: "এই আনসাবস্ক্রাইব লিংকটি অবৈধ বা মেয়াদোত্তীর্ণ। নতুন ইমেইলের লিংক ব্যবহার করুন।",
    en: "This unsubscribe link is invalid or has expired. Use the link from a newer email.",
  },
  "messaging.triggerTriggerCannotStartAMessaging": {
    bn: "{{trigger}} trigger একটি messaging journey শুরু করতে পারে না — এর context কোনো প্রাপক resolve করতে পারে না",
    en: "Trigger {{trigger}} cannot start a messaging journey — its context cannot resolve a recipient",
  },
  "messaging.typeStepsNeedAFieldAnd": {
    bn: "{{type}} step-এর একটি field ও একটি operator লাগবে",
    en: "{{type}} steps need a field and an operator",
  },
  "messaging.typeStepsNeedATemplateId": {
    bn: "{{type}} step-এর একটি templateId লাগবে",
    en: "{{type}} steps need a templateId",
  },
  "messaging.waitStepsNeedMinutesBetween1": {
    bn: "wait step-এর minutes ১ থেকে ৪৩২০০-এর (৩০ দিন) মধ্যে লাগবে",
    en: "wait steps need minutes between 1 and 43200 (30 days)",
  },
  "messaging.webPushSubscriptionsAreNotAvailable": {
    bn: "Web push subscription এই deployment-এ পাওয়া যাচ্ছে না (web push store নেই)",
    en: "Web push subscriptions are not available in this deployment (the web push store is missing)",
  },
  "messaging.whatsAppBroadcastBodyComesFromIts": {
    bn: "WhatsApp broadcast-এর body তার template থেকে আসে — body-এর বদলে template বদলান",
    en: "WhatsApp broadcast body comes from its template — change the template instead of the body",
  },
  "messaging.whatsAppBroadcastsHaveNoSubjectHtmlBody": {
    bn: "WhatsApp broadcast-এর কোনো subject/htmlBody/templateId নেই — এর বদলে WhatsApp template field-গুলো সম্পাদনা করুন",
    en: "WhatsApp broadcasts have no subject/htmlBody/templateId — edit the WhatsApp template fields instead",
  },
  "messaging.whatsAppBroadcastsNeedARegisteredTemplate": {
    bn: "WhatsApp broadcast-এর একটি registered template লাগবে (whatsappTemplateId)",
    en: "WhatsApp broadcasts need a registered template (whatsappTemplateId)",
  },
  "messaging.whatsAppTemplateNotFound": {
    bn: "WhatsApp template পাওয়া যায়নি",
    en: "WhatsApp template not found",
  },
  "messaging.whatsAppTemplateNotFoundInThis": {
    bn: "এই সংস্থায় WhatsApp template পাওয়া যায়নি",
    en: "WhatsApp template not found in this organization",
  },
  "messaging.whatsappOptInRequiredMustBeABoolean": {
    bn: "whatsappOptInRequired একটি boolean হতে হবে",
    en: "whatsappOptInRequired must be a boolean",
  },
  "messaging.whatsappQualityGuardEnabledMustBeABoolean": {
    bn: "whatsappQualityGuardEnabled একটি boolean হতে হবে",
    en: "whatsappQualityGuardEnabled must be a boolean",
  },
  "messaging.whatsappTemplateIdTemplateComponentsAreOnlyForWhatsA": {
    bn: "whatsappTemplateId/templateComponents শুধু WhatsApp broadcast-এর জন্য",
    en: "whatsappTemplateId/templateComponents are only for WhatsApp broadcasts",
  },
  "messaging.withBlocksBodyHtmlBodyAreRendered": {
    bn: "Blocks থাকলে body/htmlBody blocks থেকেই render হয় — সেগুলোও পাঠাবেন না",
    en: "With blocks, body/htmlBody are rendered from the blocks — do not send them too",
  },
  "messaging.workflowEngineIsNotAvailableIn": {
    bn: "Workflow engine এই deployment-এ পাওয়া যাচ্ছে না",
    en: "Workflow engine is not available in this deployment",
  },
  "messaging.telegramButtonsMustBeArrayOfLabel": {
    bn: "telegramButtons অবশ্যই {label, url} জোড়ার একটি array হতে হবে",
    en: "telegramButtons must be an array of {label, url} pairs",
  },
  "messaging.telegramButtonsMayCarryAtMost4": {
    bn: "telegramButtons-এ সর্বোচ্চ ৪টি button থাকতে পারে",
    en: "telegramButtons may carry at most 4 buttons",
  },
  "messaging.eachTelegramButtonNeedsALabelOf": {
    bn: "প্রতিটি telegram button-এর ১–৬৪ অক্ষরের একটি label লাগবে",
    en: "Each telegram button needs a label of 1–64 characters",
  },
  "messaging.telegramButtonNeedsAnHttpsUrl": {
    bn: 'Telegram button "{{label}}"-এর একটি https URL লাগবে',
    en: 'Telegram button "{{label}}" needs an https URL',
  },
  "messaging.pushUrlMustBeAShopRelativePath": {
    bn: "pushUrl একটি shop-relative path হতে হবে (যেমন /sale) — web push-এর জন্য বাইরের URL অনুমোদিত নয়",
    en: "pushUrl must be a shop-relative path (e.g. /sale) — external URLs are not allowed for web push",
  },
  "messaging.onsiteUrlMustBeAShopRelativePath": {
    bn: "onsiteUrl একটি shop-relative path হতে হবে (যেমন /sale) — on-site notification-এর জন্য বাইরের URL অনুমোদিত নয়",
    en: "onsiteUrl must be a shop-relative path (e.g. /sale) — external URLs are not allowed for on-site notifications",
  },
  "messaging.aiPausedPlatformWide": {
    bn: "Platform team সাময়িকভাবে পুরো platform-এ AI feature pause করে রেখেছে।",
    en: "AI features are temporarily paused platform-wide by the platform team.",
  },
  "messaging.aiDisabledForOrg": {
    bn: "Platform team এই সংস্থার জন্য AI feature সাময়িকভাবে বন্ধ রেখেছে।",
    en: "AI features are temporarily disabled for this organization by the platform team.",
  },
  "messaging.broadcastRejectedInReviewCannotBe": {
    bn: "এই broadcast review-তে REJECTED হয়েছে — পাঠানো বা schedule করা যাবে না। সম্পাদনা করে আবার approval-এর জন্য জমা দিন।",
    en: "This broadcast was REJECTED in review and cannot be sent or scheduled. Edit it and submit it for approval again.",
  },
  "messaging.broadcastPendingApprovalCannotBeSent": {
    bn: "এই broadcast approval-এর অপেক্ষায় আছে — অন্য কোনো অনুমোদিত approver (OWNER/ADMIN) approve না করা পর্যন্ত পাঠানো বা schedule করা যাবে না।",
    en: "This broadcast is pending approval and cannot be sent or scheduled until a different authorised approver (OWNER/ADMIN) approves it.",
  },
  "messaging.audienceEmptyAfterExclusions": {
    bn: "বাদ দেওয়ার পর audience খালি: audience-এ {{audienceTotal}} জন, {{excluded}} জন বাদ (আগের প্রাপক {{prev}}, opted out {{suppressed}}, frequency cap {{freq}}, WhatsApp opt-in নেই {{noOptIn}})।",
    en: "Audience is empty after exclusions: {{audienceTotal}} in the audience, {{excluded}} excluded (previous recipients {{prev}}, opted out {{suppressed}}, frequency cap {{freq}}, no WhatsApp opt-in {{noOptIn}}).",
  },
  "messaging.audienceEmptyAfterExclusionsHeldout": {
    bn: "বাদ দেওয়ার পর audience খালি: audience-এ {{audienceTotal}} জন, {{excluded}} জন বাদ (আগের প্রাপক {{prev}}, opted out {{suppressed}}, frequency cap {{freq}}, WhatsApp opt-in নেই {{noOptIn}}), {{heldOut}} জন held out (holdout {{percent}}%)।",
    en: "Audience is empty after exclusions: {{audienceTotal}} in the audience, {{excluded}} excluded (previous recipients {{prev}}, opted out {{suppressed}}, frequency cap {{freq}}, no WhatsApp opt-in {{noOptIn}}), {{heldOut}} held out (holdout {{percent}}%).",
  },
  "messaging.audienceEmptyAfterHoldout": {
    bn: "Holdout-এর পর audience খালি: {{heldOut}} জন প্রাপক held out (holdout {{percent}}%)। Holdout-এর শতাংশ কমান।",
    en: "Audience is empty after the holdout: {{heldOut}} recipients held out (holdout {{percent}}%). Lower the holdout percentage.",
  },
  "messaging.audienceEmptyNoUsableAddress": {
    bn: "Audience খালি: এই channel-এর জন্য ব্যবহারযোগ্য ঠিকানাসহ কোনো প্রাপক নেই",
    en: "Audience is empty: no recipients with a usable address for this channel",
  },
  // ── MB4 coordinator finishing pass: (a2) computed content ──
  "messaging.composeSpamWords": { bn: "স্প্যাম-ঝুঁকির শব্দ পাওয়া গেছে: {{words}} — এসব শব্দ ডেলিভারি কমিয়ে দিতে পারে।", en: "Spam-risk words found: {{words}} — these words can reduce delivery." },
  "messaging.composeCapsSubject": { bn: "বিষয়ের বেশিরভাগ অক্ষর বড় হাতের (ALL CAPS) — স্প্যাম ফিল্টরে আটকে যাওয়ার ঝুঁকি থাকে।", en: "Most of the subject is in capital letters (ALL CAPS) — it risks being caught by spam filters." },
  "messaging.composeManyLinks": { bn: "বার্তায় {{count}}টি লিংক আছে — {{max}}টির বেশি লিংক স্প্যাম-ঝুঁকি বাড়ায়।", en: "The message has {{count}} links — more than {{max}} links increases spam risk." },
  "messaging.composeMissingSubject": { bn: "ইমেইলের বিষয় (subject) খালি — একটি বিষয় যোগ করুন।", en: "The email subject is empty — add a subject." },
  "messaging.composeSmsParts": { bn: "এই SMS-টি {{parts}} পার্টে পাঠানো হবে — {{max}} পার্টের বেশি হলে খরচ বেড়ে যায়।", en: "This SMS will be sent in {{parts}} parts — more than {{max}} parts costs more." },
  "messaging.composeBodyTooLong": { bn: "বার্তাটি {{length}} অক্ষরের — {{max}} অক্ষরের বেশি লম্বা বার্তা অনেক প্রোভাইডারে কেটে যেতে পারে।", en: "The message is {{length}} characters — messages longer than {{max}} characters may be cut off by many providers." },
  "messaging.abNoData": { bn: "দুটি ভ্যারিয়েন্টের ডেটাই পাওয়া যায়নি — পরামর্শ দেওয়া যাচ্ছে না।", en: "No data was found for either variant — no suggestion can be given." },
  "messaging.abNoComparable": { bn: "এই চ্যানেলে তুলনার মতো read/click ডেটা পাওয়া যায় না — পরামর্শ দেওয়া যাচ্ছে না।", en: "This channel has no comparable read/click data — no suggestion can be given." },
  "messaging.abSampleTooSmall": { bn: "নমুনা খুব ছোট (A: {{aSent}}টি, B: {{bSent}}টি পাঠানো; কমপক্ষে ৩০টি করে দরকার) — পরামর্শ দেওয়া হচ্ছে না।", en: "The sample is too small (A: {{aSent}} sent, B: {{bSent}} sent; at least 30 each are needed) — no suggestion is given." },
  "messaging.abTie": { bn: "দুটি ভ্যারিয়েন্টের হার সমান ({{rate}}) — কোনোটিকেই এগিয়ে বলা যাচ্ছে না।", en: "Both variants have the same rate ({{rate}}) — neither can be called the leader." },
  "messaging.abNote": { bn: "{{basis}} হার — A: {{aRate}}, B: {{bRate}}। এটি শুধু পরামর্শ; কিছুই স্বয়ংক্রিয়ভাবে পাঠানো বা বেছে নেওয়া হয়নি।", en: "{{basis}} rate — A: {{aRate}}, B: {{bRate}}. This is only a suggestion; nothing was sent or chosen automatically." },
  "messaging.qualityGuardRejected": { bn: "WhatsApp Quality Guard চালু আছে: \"{{name}}\" টেমপ্লেটটি Meta প্রত্যাখ্যান করেছে (status: REJECTED) — এই টেমপ্লেট দিয়ে নতুন Broadcast পাঠানো যাবে না। অন্য অনুমোদিত টেমপ্লেট বেছে নিন, অথবা সেটিংসে Quality Guard বন্ধ করুন।", en: "WhatsApp Quality Guard is on: the template \"{{name}}\" was rejected by Meta (status: REJECTED) — new broadcasts cannot be sent with this template. Choose another approved template, or turn off the Quality Guard in settings." },
  "messaging.qualityGuardRedRating": { bn: "WhatsApp Quality Guard চালু আছে: \"{{name}}\" টেমপ্লেটের Meta Quality Rating RED (সর্বনিম্ন) — এই টেমপ্লেট দিয়ে নতুন Broadcast পাঠানো যাবে না। Meta-তে মান উন্নত হলে Sync করে আবার চেষ্টা করুন, অথবা সেটিংসে Quality Guard বন্ধ করুন।", en: "WhatsApp Quality Guard is on: the template \"{{name}}\" has a Meta Quality Rating of RED (lowest) — new broadcasts cannot be sent with this template. Once the quality improves on Meta, sync and try again, or turn off the Quality Guard in settings." },
  "messaging.unnamedTemplate": { bn: "(নামহীন)", en: "(unnamed)" },
  "messaging.carouselCardsCount": { bn: "Carousel টেমপ্লেটে ২ থেকে ১০টি কার্ড থাকতে হবে।", en: "A carousel template must have 2 to 10 cards." },
  "messaging.carouselParamExamples": { bn: "কার্ড {{card}}: মূল লেখায় {{{{max}}}} পর্যন্ত প্যারামিটার আছে — প্রতিটির একটি করে উদাহরণ মান (exampleValues) দিতে হবে, মোট {{max}}টি।", en: "Card {{card}}: the body text has parameters up to {{{{max}}}} — one example value (exampleValues) is needed for each, {{max}} in total." },
  "messaging.carouselHeaderFormat": { bn: "কার্ড {{card}}: হেডার শুধু image বা video হতে হবে।", en: "Card {{card}}: the header can only be image or video." },
  "messaging.carouselHeaderHandle": { bn: "কার্ড {{card}}: ছবি/ভিডিও হেডারের জন্য Meta-র Resumable Upload API থেকে পাওয়া উদাহরণ আপলোড হ্যান্ডল (headerHandle) আবশ্যক — হ্যান্ডল ছাড়া কার্ড তৈরি করা যাবে না।", en: "Card {{card}}: an example upload handle (headerHandle) from Meta's Resumable Upload API is required for an image/video header — the card cannot be created without a handle." },
  "messaging.carouselBodyRequired": { bn: "কার্ড {{card}}: মূল লেখা (bodyText) আবশ্যক।", en: "Card {{card}}: the body text (bodyText) is required." },
  "messaging.carouselMaxButtons": { bn: "কার্ড {{card}}: একটি কার্ডে সর্বোচ্চ ২টি বাটন থাকতে পারে।", en: "Card {{card}}: a card can have at most 2 buttons." },
  "messaging.carouselButtonText": { bn: "কার্ড {{card}}: বাটনের লেখা আবশ্যক এবং সর্বোচ্চ ২৫ অক্ষরের হতে হবে।", en: "Card {{card}}: the button text is required and can be at most 25 characters." },
  "messaging.carouselButtonUrl": { bn: "কার্ড {{card}}: URL বাটনের জন্য http(s) দিয়ে শুরু হওয়া একটি বৈধ url আবশ্যক।", en: "Card {{card}}: a URL button needs a valid url starting with http(s)." },
  "messaging.carouselButtonType": { bn: "কার্ড {{card}}: বাটনের ধরন url বা quick_reply হতে হবে।", en: "Card {{card}}: the button type must be url or quick_reply." },
  "messaging.segmentReasonAtRisk": { bn: "{{count}} জন কাস্টমার \"At Risk\" সেগমেন্টে আছেন — আগে নিয়মিত কিনতেন, এখন অনেকদিন অর্ডার করেননি। একটি Win-back Broadcast পাঠানোর কথা ভাবুন।", en: "{{count}} customers are in the \"At Risk\" segment — they used to buy regularly but have not ordered in a long time. Consider sending a Win-back broadcast." },
  "messaging.segmentReasonLost": { bn: "{{count}} জন কাস্টমার \"Lost\" সেগমেন্টে আছেন — দীর্ঘদিন কোনো অর্ডার নেই। একটি পুনরায় সক্রিয় করার (Reactivation) অফার পাঠানো যেতে পারে।", en: "{{count}} customers are in the \"Lost\" segment — no orders for a long time. A reactivation offer could be sent." },
  "messaging.segmentReasonChampions": { bn: "{{count}} জন কাস্টমার \"Champions\" সেগমেন্টে আছেন — আপনার সেরা কাস্টমার। নতুন পণ্য বা অফারের Early Access সবার আগে এদের দিন।", en: "{{count}} customers are in the \"Champions\" segment — your best customers. Give them early access to new products or offers first." },
  "messaging.segmentReasonNew": { bn: "{{count}} জন কাস্টমার \"New\" সেগমেন্টে আছেন — সম্প্রতি প্রথম অর্ডার করেছেন। একটি Welcome / দ্বিতীয় অর্ডারের উৎসাহমূলক Broadcast পাঠানো যেতে পারে।", en: "{{count}} customers are in the \"New\" segment — they recently placed their first order. A welcome / second-order encouragement broadcast could be sent." },
  "messaging.sendTimeReason": { bn: "গত ৯০ দিনে মোট {{events}}টি Open/Read/Click ইভেন্ট আছে — পাঠানোর সেরা সময়ের নির্ভরযোগ্য পরামর্শের জন্য কমপক্ষে {{min}}টি ইভেন্ট দরকার। আরও কিছু Broadcast পাঠিয়ে আবার দেখুন।", en: "There are {{events}} Open/Read/Click events in the last 90 days in total — a reliable best-time suggestion needs at least {{min}} events. Send a few more broadcasts and check again." },
  "messaging.sendTimeMethod": { bn: "গত ৯০ দিনের আসল Open/Read/Click ইভেন্ট ঢাকার স্থানীয় সময়ের ঘণ্টা অনুযায়ী গোনা হয়েছে। এটি ঐতিহাসিক সম্পর্ক — কোন ঘণ্টায় পাঠালেই বেশি সাড়া মিলবে, এমন গ্যারান্টি নয়।", en: "Real Open/Read/Click events from the last 90 days were counted by Dhaka local hour. This is a historical association — no guarantee that sending at a particular hour brings more response." },
  "messaging.segmentWhatsappOptInReason": { bn: "WhatsApp Opt-in আবশ্যক করা আছে, কিন্তু এখনো কোনো প্রাপক Opt-in করেননি — এই অবস্থায় WhatsApp Broadcast পাঠালে সবাই বাদ পড়বেন। আগে Inbox বা দোকান থেকে Opt-in সংগ্রহ করুন।", en: "WhatsApp opt-in is required, but no recipient has opted in yet — a WhatsApp broadcast sent in this state would exclude everyone. Collect opt-ins from the Inbox or the shop first." },
  "messaging.audienceDraftInvalid": { bn: "খসড়াটি যাচাইয়ে পাস করেনি — কিছুই তৈরি হয়নি। ত্রুটি দেখে ঠিক করে তারপর Saved Audience হিসেবে সংরক্ষণ করুন।", en: "The draft did not pass validation — nothing was created. Fix the errors and then save it as a Saved Audience." },
  "messaging.audienceDraftOk": { bn: "এটি শুধু একটি খসড়া (draft) — এখনো কোনো Audience তৈরি হয়নি। পর্যালোচনা করে \"Saved Audience তৈরি করুন\" চাপলেই কেবল তৈরি হবে।", en: "This is only a draft — no audience has been created yet. Review it and press \"Create Saved Audience\" — only then will it be created." },
  "messaging.suppressionNote": { bn: "এগুলো শুধু পরামর্শ — তালিকা দেখলেই কেউ বাদ পড়ে না। Suppression কার্যকর হবে কেবল আপনি নিশ্চিত করে Apply চাপলে, আসল Preference Store-এ Opt-out হিসেবে।", en: "These are only suggestions — nobody is excluded just by viewing the list. Suppression takes effect only when you confirm and press Apply, as an opt-out in the actual Preference Store." },
  "messaging.testEmailSubject": { bn: "Test email — আপনার প্রেরক সেটিংস পরীক্ষা", en: "Test email — checking your sender settings" },
  "messaging.testEmailText": { bn: "এটি একটি পরীক্ষামূলক ইমেইল। আপনার Messaging প্রেরক সেটিংস সঠিকভাবে কাজ করছে। (This is a test email from your Messaging sender settings.)", en: "This is a test email. Your Messaging sender settings are working correctly." },
  "messaging.devAdapterDraftNotice": { bn: "আসল AI (LLM) কনফিগার করা হয়নি — এগুলো Dev Template Adapter দিয়ে বানানো সাধারণ টেমপ্লেট, আসল AI জেনারেশন নয়।", en: "Real AI (LLM) is not configured — these are plain templates made by the Dev Template Adapter, not real AI generation." },
  "messaging.devAdapterSuggestionNotice": { bn: "আসল AI (LLM) কনফিগার করা হয়নি — এগুলো Dev Template Adapter-এর সাধারণ রূপ, আসল AI প্রস্তাব নয়।", en: "Real AI (LLM) is not configured — these are plain forms from the Dev Template Adapter, not real AI suggestions." },
  "messaging.unsubscribeFooter": { bn: "এই ইমেইলটি পেতে না চাইলে আনসাবস্ক্রাইব করুন: {{url}}", en: "If you do not want to receive this email, unsubscribe here: {{url}}" },
  "messaging.unsubscribeFooterHtml": { bn: "এই ইমেইলটি পেতে না চাইলে <a href=\"{{url}}\">আনসাবস্ক্রাইব করুন</a>", en: "If you do not want to receive this email, <a href=\"{{url}}\">unsubscribe</a>" },
  "messaging.abScopeNote": { bn: "Auto-winner শুধু Recipient-Table (MX1) পথে কাজ করে; Legacy Snapshot-path Broadcast-এ সিদ্ধান্ত হয় না। Cascade Broadcast-এও হয় না (Cascade নিজে Channel Content নির্ধারণ করে)।", en: "Auto-winner only works on the Recipient-Table (MX1) path; no decision is made on legacy Snapshot-path broadcasts. It does not apply to Cascade broadcasts either (Cascade decides the channel content itself)." },
  "messaging.analyticsCsvTitle": { bn: "মেসেজিং তুলনামূলক Analytics (MX16) · সময়সীমা: {{from}} থেকে {{to}} (ঢাকা)", en: "Messaging comparative Analytics (MX16) · Range: {{from}} to {{to}} (Dhaka)" },
  "messaging.analyticsCsvAssociation": { bn: "আয়/অর্ডারের সব সংখ্যা: {{label}}", en: "All revenue/order figures: {{label}}" },
  "messaging.analyticsCsvByBroadcast": { bn: "Broadcast অনুযায়ী", en: "By broadcast" },
  "messaging.analyticsCsvByChannel": { bn: "Channel অনুযায়ী Funnel", en: "Funnel by channel" },
  "messaging.smsGatewayNone": { bn: "কোনো SMS Gateway নেই", en: "No SMS gateway" },

  "messaging.checkUrlLabel": { bn: "লিংকের ফরম্যাট", en: "Link format" },
  "messaging.checkUrlNone": { bn: "বিষয়/বার্তা/HTML-এ কোনো http(s) লিংক পাওয়া যায়নি, তাই যাচাই করার কিছু ছিল না।", en: "No http(s) links were found in the subject/body/HTML, so there was nothing to validate." },
  "messaging.checkUrlNoneVerified": { bn: "কোনো লিংক নেই — কিছু fetch বা যাচাই করা হয়নি।", en: "No links present — nothing was fetched or validated." },
  "messaging.checkUrlBad": { bn: "{{total}}টি লিংকের মধ্যে {{bad}}টি বৈধ absolute http(s) URL নয়: {{list}}", en: "{{bad}} of {{total}} link(s) are not valid absolute http(s) URLs: {{list}}" },
  "messaging.checkUrlOk": { bn: "সব {{total}}টি লিংক বৈধ absolute http(s) URL হিসেবে parse হয়।", en: "All {{total}} link(s) parse as valid absolute http(s) URLs." },
  "messaging.checkUrlParsedVerified": { bn: "URL parser দিয়ে {{total}}টি লিংক parse করা হয়েছে (শুধু ফরম্যাট — কোনো লিংক fetch করা হয়নি, পৌঁছানো যাবে এমন দাবি করা হচ্ছে না)।", en: "Parsed {{total}} link(s) with the URL parser (format only — no link was fetched, reachability is not claimed)." },
  "messaging.checkLinksLabel": { bn: "লিংক ট্র্যাকিং", en: "Links tracked" },
  "messaging.checkLinksNone": { bn: "বার্তায় কোনো লিংক নেই, তাই তুলনা করার মতো tracked-link সেট নেই।", en: "No links in the content, so there is no tracked-link set to compare against." },
  "messaging.checkLinksNoneVerified": { bn: "বার্তার লিংকগুলো send engine যেগুলো wrap করবে তার সঙ্গে তুলনা করা হয়েছে — কোনো লিংক ছিল না।", en: "Compared the content's links against the set the send engine will wrap — no links existed." },
  "messaging.checkLinksOff": { bn: "Messaging সেটিংসে Link tracking বন্ধ: সব {{total}}টি লিংক হুবহু যেভাবে লেখা হয়েছে সেভাবেই পাঠানো হবে এবং ক্লিক রেকর্ড হবে না।", en: "Link tracking is OFF in Messaging settings: all {{total}} link(s) will be sent exactly as authored and clicks will not be recorded." },
  "messaging.checkLinksOffVerified": { bn: "প্রতিষ্ঠানের linkTrackingEnabled সেটিং পড়া হয়েছে; বন্ধ থাকলে tracked সেট খালি থাকে।", en: "Read the org's linkTrackingEnabled setting; the tracked set is empty while it is off." },
  "messaging.checkLinksOk": { bn: "সব {{total}}টি লিংক tracked সেটে আছে: পাঠানোর সময় প্রতিটি UTM প্যারামিটার ও signed redirect wrap পাবে (ক্লিক রেকর্ড হবে)।", en: "All {{total}} link(s) are in the tracked set: at send time each will gain UTM parameters and the signed redirect wrap (clicks recorded)." },
  "messaging.checkLinksOkVerified": { bn: "Tracking চালু থাকলে send engine বার্তার প্রতিটি http(s) লিংক wrap করে — তাই tracked সেট আর পাওয়া সেট গঠনগতভাবে সমান।", en: "The send engine wraps every http(s) link in the body when tracking is on — the tracked set equals the found set by construction." },
  "messaging.checkVarsLabel": { bn: "ভেরিয়েবল পূরণ (নমুনা)", en: "Variables filled (sample)" },
  "messaging.checkVarsNone": { bn: "বার্তায় কোনো {{{{variable}}}} নেই, তাই কোনো প্রাপক খালি substitution পাবেন না।", en: "The content uses no {{{{variable}}}}, so no recipient can receive an empty substitution." },
  "messaging.checkVarsNoneVerified": { bn: "বিষয়/বার্তা/HTML-এ {{{{variable}}}} placeholder খোঁজা হয়েছে — পাওয়া যায়নি।", en: "Scanned subject/body/HTML for {{{{variable}}}} placeholders — none found." },
  "messaging.checkVarsNotRun": { bn: "বার্তায় {{keys}} আছে, কিন্তু প্রাপকের কোনো নমুনা পাওয়া যায়নি (audience কাউকে resolve করেনি, বা audience দেওয়া হয়নি), তাই পূরণ যাচাই করা যায়নি।", en: "The content uses {{keys}}, but no recipient sample was available (the audience resolved to nobody, or no audience was supplied), so fill could not be checked." },
  "messaging.checkVarsNotRunVerified": { bn: "চালানো হয়নি — render করার মতো আসল প্রাপক নমুনা ছিল না।", en: "Not run — no real recipient sample existed to render against." },
  "messaging.checkVarsEmpty": { bn: "{{sample}} জন আসল প্রাপকের নমুনায় এই ভেরিয়েবলগুলো খালি render হয়: {{empties}}। ওই প্রাপকেরা বার্তাটির সেই অংশ খালি পাবেন — পূরণ করতে কিছু বানানো হয় না।", en: "In a sample of {{sample}} real recipient(s), these variables render EMPTY: {{empties}}. Those recipients would receive the message with that part blank — nothing is invented to fill it." },
  "messaging.checkVarsEmptyVerified": { bn: "{{sample}} জন নমুনা প্রাপকের আসল per-recipient vars দিয়ে প্রতিটি ভেরিয়েবল render করা হয়েছে (পাঠানোর সময় যে vars তৈরি হয়)।", en: "Rendered each variable against the real per-recipient vars of {{sample}} sampled recipient(s) (the same vars a send builds)." },
  "messaging.checkVarsOk": { bn: "সব ভেরিয়েবল ({{keys}}) নমুনার {{sample}} জন প্রাপকের প্রত্যেকের জন্য খালি-ছাড়া render হয়। নমুনার বাইরের প্রাপকদের যাচাই করা হয়নি।", en: "All variables ({{keys}}) render non-empty for every one of the {{sample}} sampled recipient(s). Recipients outside the sample were not checked." },
  "messaging.checkVarsOkVerified": { bn: "{{sample}} জন নমুনা প্রাপকের আসল per-recipient vars দিয়ে প্রতিটি ভেরিয়েবল render করা হয়েছে।", en: "Rendered each variable against the real per-recipient vars of {{sample}} sampled recipient(s)." },
  "messaging.checkImageLabel": { bn: "ছবির আকার", en: "Image size" },
  "messaging.checkImageNone": { bn: "HTML/বার্তায় কোনো ছবির URL পাওয়া যায়নি, তাই আকার যাচাই করার মতো ছবি ছিল না।", en: "No image URLs were found in the HTML/body, so there was no image to size-check." },
  "messaging.checkImageNoneVerified": { bn: "HTML-এ <img> ট্যাগ ও বার্তায় ছবি-ফাইলের লিংক খোঁজা হয়েছে — পাওয়া যায়নি।", en: "Scanned the HTML for <img> tags and the body for image-file links — none found." },
  "messaging.checkImageNoMeta": { bn: "{{images}}টি ছবি পাওয়া গেছে, কিন্তু এই সিস্টেমে কোথাও তাদের আকারের metadata রাখা হয় না (product/catalog row-তে শুধু ছবির URL থাকে, byte আকার কখনো নয়), তাই আকার যাচাই করা যায়নি এবং মাপতে কোনো ছবি fetch-ও করা হয়নি।", en: "{{images}} image(s) found, but no size metadata is stored for them anywhere in this system (product/catalog rows carry only the image URL, never byte size), so sizes could not be verified and no image was fetched to measure it." },
  "messaging.checkImageNoMetaVerified": { bn: "চালানো হয়নি — এই ছবিগুলোর কোনো asset metadata নেই; মাপতে fetch করা এমন network দাবি এই check করে না।", en: "Not run — no asset metadata exists for these images; fetching them to measure would be a network claim this check does not make." },
  "messaging.checkImageBig": { bn: "সংরক্ষিত metadata অনুযায়ী {{big}}টি ছবি 1 MB-এর বেশি: {{list}}। বড় ছবি ইমেইল লোড ধীর করে এবং clipping ঘটাতে পারে।", en: "{{big}} image(s) exceed 1 MB by their stored metadata: {{list}}. Large images slow email loading and can trigger clipping." },
  "messaging.checkImageBigVerified": { bn: "{{images}}টির মধ্যে {{withMeta}}টি ছবির সংরক্ষিত আকার metadata 1 MB threshold-এর সঙ্গে তুলনা করা হয়েছে।", en: "Compared stored size metadata for {{withMeta}} of {{images}} image(s) against the 1 MB threshold." },
  "messaging.checkImageOk": { bn: "সংরক্ষিত আকার metadata আছে এমন সব {{withMeta}}টি ছবি 1 MB বা তার নিচে।{{unchecked}}", en: "All {{withMeta}} image(s) with stored size metadata are at or under 1 MB.{{unchecked}}" },
  "messaging.checkImageUncheckedSuffix": { bn: " {{count}}টি ছবির metadata ছিল না, যাচাই করা হয়নি।", en: " {{count}} image(s) had no metadata and were not checked." },
  "messaging.checkImageOkVerified": { bn: "{{withMeta}}টি ছবির সংরক্ষিত আকার metadata 1 MB threshold-এর সঙ্গে তুলনা করা হয়েছে।", en: "Compared stored size metadata for {{withMeta}} image(s) against the 1 MB threshold." },
  "messaging.checkSpamLabel": { bn: "স্প্যাম শব্দ (heuristic)", en: "Spam words (heuristic)" },
  "messaging.checkSpamWarnVerified": { bn: "শুধু HEURISTIC: নিচের নির্দিষ্ট শব্দ-তালিকার (MS5 তালিকা) সঙ্গে বার্তা মেলানো হয়েছে। কোনো provider-এর filter নিয়ে এটি কিছু ভবিষ্যদ্বাণী করে না — deliverability-র কোনো নিশ্চয়তা দেওয়া হয় না।", en: "HEURISTIC ONLY: matched the content against the fixed word list below (the MS5 list). It predicts nothing about any provider's filter — no deliverability guarantee is made." },
  "messaging.checkSpamPass": { bn: "বিষয়/বার্তায় নিচের স্প্যাম-শব্দ তালিকার কোনো শব্দ নেই।", en: "No word from the spam-word list below appears in the subject/body." },
  "messaging.checkSpamPassVerified": { bn: "শুধু HEURISTIC: নিচের নির্দিষ্ট শব্দ-তালিকার (MS5 তালিকা) সঙ্গে বার্তা মেলানো হয়েছে। Pass মানে শুধু তালিকার কোনো শব্দ মেলেনি — এটি deliverability-র নিশ্চয়তা নয়।", en: "HEURISTIC ONLY: matched the content against the fixed word list below (the MS5 list). A pass means only that none of these listed words matched — it is not a deliverability guarantee." },
  "messaging.spamListLabel": { bn: "Heuristic শব্দ-তালিকা (প্রতিষ্ঠান দেখতে পারে) — এই শব্দগুলো মেলা একটি ঝুঁকির ইঙ্গিত, কোনো provider-এর রায় নয়।", en: "Heuristic word list (org-visible) — matching these words is a risk hint, not a provider verdict." },
  // MB5 (ML14) — MessageTemplate per-locale variants validation.
  "messaging.templateVariantsInvalid": { bn: "template variants সঠিক নয় — bn/en-এর প্রতিটিতে subject/body/htmlBody শুধু string অথবা null হতে পারে", en: "Template variants are invalid — each of bn/en may carry subject/body/htmlBody only as a string or null" },
} as const;

export type MessagingCatalogKey = keyof typeof MESSAGING_CATALOG;

/** Coordinator wiring alias (catalog/index.ts convention). */
export const messagingCatalog = MESSAGING_CATALOG;
