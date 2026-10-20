/**
 * MB4 (ML10) — inbox catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the inbox module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const inboxCatalog: CatalogNamespace = {
  "inbox.aTelegramBotTokenIsRequired": {
    bn: "একটি Telegram bot token দরকার",
    en: "A Telegram bot token is required",
  },
  "inbox.aConfirmationRequestIsAlreadyAwaiting": {
    bn: "একটি confirmation request ইতিমধ্যে customer-এর উত্তরের অপেক্ষায় আছে",
    en: "A confirmation request is already awaiting the customer's reply",
  },
  "inbox.aPrivateReplyWasAlreadySent": {
    bn: "এই comment-এর জন্য ইতিমধ্যে একটি private reply পাঠানো হয়েছে — Meta প্রতি comment-এ শুধু একটি private reply অনুমোদন করে",
    en: "A private reply was already sent for this comment — Meta allows only one private reply per comment",
  },
  "inbox.aScopedTeamReportRequiresAn": {
    bn: "একটি scoped team report-এর জন্য identified viewer দরকার",
    en: "A scoped team report requires an identified viewer",
  },
  "inbox.aScopedTeamScorecardRequiresAn": {
    bn: "একটি scoped team scorecard-এর জন্য identified viewer দরকার",
    en: "A scoped team scorecard requires an identified viewer",
  },
  "inbox.theAiChangedANumberSo": {
    bn: "AI সংখ্যা বদলে ফেলেছে, তাই এই রিরাইটটি প্রয়োগ করা হয়নি। আবার চেষ্টা করুন।",
    en: "The AI changed a number, so this rewrite was not applied. Please try again.",
  },
  "inbox.actorIsNotAnActiveMember": {
    bn: "Actor এই organization-এর সক্রিয় সদস্য নন",
    en: "Actor is not an active member of this organization",
  },
  "inbox.agentsCanOnlyManageTheirOwn": {
    bn: "Agents শুধু নিজের schedule-ই manage করতে পারেন",
    en: "Agents can only manage their own schedule",
  },
  "inbox.agentsCanOnlySetTheirOwn": {
    bn: "Agents শুধু নিজের schedule-ই সেট করতে পারেন",
    en: "Agents can only set their own schedule",
  },
  "inbox.anAppSecretIsRequiredProvide": {
    bn: "একটি app secret দরকার: আপনার Meta app secret দিন, অথবা platform admin-কে Admin Console-এ platform Meta app configure করতে বলুন",
    en: "An app secret is required: provide your Meta app secret, or ask the platform admin to configure the platform Meta app in the Admin Console",
  },
  "inbox.inTheAssignStepSayWho": {
    bn: "Assign ধাপে কাকে অ্যাসাইন করা হবে তা দিন (সদস্যের id, \\\"me\\\" অথবা null = অ্যাসাইন তুলে নিন)।",
    en: "In the Assign step, say who to assign to (a member's id, \\\"me\\\", or null = remove the assignment).",
  },
  "inbox.assigneeIsNotAMemberOf": {
    bn: "Assignee এই organization-এর সদস্য নন",
    en: "Assignee is not a member of this organization",
  },
  "inbox.atLeastOneItemIsRequired": {
    bn: "অন্তত একটি item দরকার",
    en: "At least one item is required",
  },
  "inbox.aCarouselTemplateHasNoSeparate": {
    bn: "Carousel টেমপ্লেটে আলাদা Header থাকে না — প্রতিটি কার্ডের নিজের ছবি/ভিডিও Header থাকে। headerType 'none' রাখুন।",
    en: "A Carousel template has no separate Header — each card has its own image/video Header. Keep headerType 'none'.",
  },
  "inbox.channelsendserviceDoesNotHandleChannel": {
    bn: "ChannelSendService channel \"{{convChannel}}\" handle করে না",
    en: "ChannelSendService does not handle channel \"{{convChannel}}\"",
  },
  "inbox.chatIsNotAvailableForThis": {
    bn: "এই site-এর জন্য chat পাওয়া যাচ্ছে না",
    en: "Chat is not available for this site",
  },
  "inbox.theCloseStepSOutcomeIs": {
    bn: "Close ধাপের outcome সঠিক নয়।",
    en: "The Close step's outcome is invalid.",
  },
  "inbox.commentNotFound": {
    bn: "Comment পাওয়া যায়নি",
    en: "Comment not found",
  },
  "inbox.conversationNotFoundForKeywordAuto": {
    bn: "Keyword auto-reply-এর জন্য conversation পাওয়া যায়নি",
    en: "Conversation not found for keyword auto-reply",
  },
  "inbox.conversationNotFoundInThisOrganization": {
    bn: "এই organization-এ conversation পাওয়া যায়নি",
    en: "Conversation not found in this organization",
  },
  "inbox.customerMergeIsNotAvailableIn": {
    bn: "এই deployment-এ customer merge পাওয়া যাচ্ছে না",
    en: "Customer merge is not available in this deployment",
  },
  "inbox.customerNotFoundInThisOrganization": {
    bn: "এই organization-এ customer পাওয়া যায়নি",
    en: "Customer not found in this organization",
  },
  "inbox.dailyAiGenerationLimitReachedFor": {
    bn: "এই organization-এর জন্য daily AI generation limit পূর্ণ হয়েছে ({{limit}})। আগামীকাল আবার চেষ্টা করুন অথবা platform team-কে আপনার plan limit বাড়াতে বলুন।",
    en: "Daily AI generation limit reached for this organization ({{limit}}). Try again tomorrow or ask the platform team to raise your plan limit.",
  },
  "inbox.dailyAiLimitReachedForThis": {
    bn: "এই organization-এর জন্য daily AI limit পূর্ণ হয়েছে ({{limit}})। আগামীকাল আবার চেষ্টা করুন অথবা platform team-কে আপনার plan limit বাড়াতে বলুন।",
    en: "Daily AI limit reached for this organization ({{limit}}). Try again tomorrow or ask the platform team to raise your plan limit.",
  },
  "inbox.draftIsNoLongerPending": {
    bn: "Draft আর pending নেই",
    en: "Draft is no longer pending",
  },
  "inbox.draftNotFound": {
    bn: "Draft পাওয়া যায়নি",
    en: "Draft not found",
  },
  "inbox.imapHostSmtpHostUserAnd": {
    bn: "IMAP host, SMTP host, user ও password — সবই দরকার",
    en: "IMAP host, SMTP host, user and password are all required",
  },
  "inbox.imapLoginFailed": {
    bn: "IMAP login ব্যর্থ হয়েছে: {{p1}}",
    en: "IMAP login failed: {{p1}}",
  },
  "inbox.imageWasNotSent": {
    bn: "ছবি পাঠানো হয়নি: {{error}}",
    en: "Image was NOT sent: {{error}}",
  },
  "inbox.integrationNotFound": {
    bn: "Integration পাওয়া যায়নি",
    en: "Integration not found",
  },
  "inbox.invalidAireplydelaysecondsForChannelMustBe": {
    bn: "Channel {{channel}}-এর জন্য aiReplyDelaySeconds অবৈধ: একটি পূর্ণসংখ্যা 0..600 হতে হবে",
    en: "Invalid aiReplyDelaySeconds for channel {{channel}}: must be an integer 0..600",
  },
  "inbox.invalidBulkActionCloseAssignTag": {
    bn: "অবৈধ bulk action (close | assign | tag-add | mark-read)",
    en: "Invalid bulk action (close | assign | tag-add | mark-read)",
  },
  "inbox.invalidChatSessionToken": {
    bn: "অবৈধ chat session token",
    en: "Invalid chat session token",
  },
  "inbox.invalidConversationOutcome": {
    bn: "অবৈধ conversation outcome",
    en: "Invalid conversation outcome",
  },
  "inbox.invalidModeForChannel": {
    bn: "Channel {{channel}}-এর জন্য অবৈধ mode: {{m}}",
    en: "Invalid mode for channel {{channel}}: {{m}}",
  },
  "inbox.invalidModeFor": {
    bn: "{{intent}}-এর জন্য অবৈধ mode: {{mode}}",
    en: "Invalid mode for {{intent}}: {{mode}}",
  },
  "inbox.invalidPipelineStage": {
    bn: "অবৈধ pipeline stage",
    en: "Invalid pipeline stage",
  },
  "inbox.invalidSlaMinutesForChannelMust": {
    bn: "Channel {{channel}}-এর জন্য sla minutes অবৈধ: একটি পূর্ণসংখ্যা 1..10080 হতে হবে",
    en: "Invalid sla minutes for channel {{channel}}: must be an integer 1..10080",
  },
  "inbox.invalidStatus": {
    bn: "অবৈধ status",
    en: "Invalid status",
  },
  "inbox.invalidWebhookSecret": {
    bn: "অবৈধ webhook secret",
    en: "Invalid webhook secret",
  },
  "inbox.invalidWebhookSignature": {
    bn: "অবৈধ webhook signature",
    en: "Invalid webhook signature",
  },
  "inbox.invalidWindowsUseWeekdayKeysMon": {
    bn: "অবৈধ windows: weekday keys (mon..sun) ব্যবহার করুন [\\\"HH:MM\\\",\\\"HH:MM\\\"] pairs সহ; start ও end আলাদা হতে হবে",
    en: "Invalid windows: use weekday keys (mon..sun) with [\\\"HH:MM\\\",\\\"HH:MM\\\"] pairs; start and end must differ",
  },
  "inbox.macroNotFoundInThisOrganization": {
    bn: "এই organization-এ macro পাওয়া যায়নি",
    en: "Macro not found in this organization",
  },
  "inbox.mediaFetchFailed": {
    bn: "Media fetch ব্যর্থ হয়েছে ({{resStatus}})",
    en: "Media fetch failed ({{resStatus}})",
  },
  "inbox.mediaNotFoundForThisConversation": {
    bn: "এই conversation-এর জন্য media পাওয়া যায়নি",
    en: "Media not found for this conversation",
  },
  "inbox.mediaWasNotSent": {
    bn: "Media পাঠানো হয়নি: {{error}}",
    en: "Media was NOT sent: {{error}}",
  },
  "inbox.messageContentIsEmpty": {
    bn: "Message content খালি",
    en: "Message content is empty",
  },
  "inbox.messageIsTooLongMax2000": {
    bn: "Message খুব লম্বা (সর্বোচ্চ ২০০০ অক্ষর)",
    en: "Message is too long (max 2000 characters)",
  },
  "inbox.messageNotFoundInThisConversation": {
    bn: "এই conversation-এ message পাওয়া যায়নি",
    en: "Message not found in this conversation",
  },
  "inbox.messageNotFoundOrHasNo": {
    bn: "Message পাওয়া যায়নি অথবা এতে কোনো text নেই",
    en: "Message not found or has no text",
  },
  "inbox.messageTextIsRequired": {
    bn: "Message text দরকার",
    en: "Message text is required",
  },
  "inbox.messageWasNotSent": {
    bn: "Message পাঠানো হয়নি: {{error}}",
    en: "Message was NOT sent: {{error}}",
  },
  "inbox.messagingIntegrationIsNotConfigured": {
    bn: "Messaging integration configure করা নেই",
    en: "Messaging integration is not configured",
  },
  "inbox.metaGraphCommentActionsAreNot": {
    bn: "Platform \"{{platform}}\"-এর জন্য Meta Graph comment actions পাওয়া যাচ্ছে না — এর জন্য কোনো Graph comment API path wired নেই, তাই কিছু পাঠানো বা বদলানো হয়নি",
    en: "Meta Graph comment actions are not available for platform \"{{platform}}\" — no Graph comment API path is wired for it, so nothing was sent or changed",
  },
  "inbox.missingChatSessionToken": {
    bn: "Chat session token নেই",
    en: "Missing chat session token",
  },
  "inbox.noConnectedMetaMessengerInstagramIntegration": {
    bn: "এই organization-এর জন্য কোনো connected Meta (Messenger/Instagram) integration নেই — comment action Meta Graph-এ পৌঁছাতে পারছে না, তাই কিছু পাঠানো বা বদলানো হয়নি",
    en: "No connected Meta (Messenger/Instagram) integration for this organization — the comment action cannot reach Meta Graph, so nothing was sent or changed",
  },
  "inbox.noConnectedWhatsappIntegrationForThis": {
    bn: "এই organization-এর জন্য কোনো connected WhatsApp integration নেই",
    en: "No connected WhatsApp integration for this organization",
  },
  "inbox.noConnectedEmailIntegrationForThis": {
    bn: "এই organization-এর জন্য কোনো connected email integration নেই",
    en: "No connected email integration for this organization",
  },
  "inbox.noConnectedIntegrationForThisOrganization": {
    bn: "এই organization-এর জন্য কোনো connected {{convChannel}} integration নেই",
    en: "No connected {{convChannel}} integration for this organization",
  },
  "inbox.noConnectedIntegrationForThisOrganization2": {
    bn: "এই organization-এর জন্য কোনো connected {{conversationChannel}} integration নেই",
    en: "No connected {{conversationChannel}} integration for this organization",
  },
  "inbox.noteContentIsRequired": {
    bn: "Note content দরকার",
    en: "Note content is required",
  },
  "inbox.notificationNotFound": {
    bn: "Notification পাওয়া যায়নি",
    en: "Notification not found",
  },
  "inbox.onlyTheTeamSLeadOr": {
    bn: "শুধু team-এর lead অথবা একজন organization manager এটি করতে পারেন",
    en: "Only the team's lead or an organization manager can do this",
  },
  "inbox.onlyTheTeamSLeadOr2": {
    bn: "শুধু team-এর lead অথবা একজন organization manager roster সেট করতে পারেন",
    en: "Only the team's lead or an organization manager can set the roster",
  },
  "inbox.orderNotFoundInThisOrganization": {
    bn: "এই organization-এ order পাওয়া যায়নি",
    en: "Order not found in this organization",
  },
  "inbox.orderStatusCannotBeConfirmedVia": {
    bn: "Order status \"{{orderStatus}}\" chat দিয়ে confirm করা যাবে না",
    en: "Order status \"{{orderStatus}}\" cannot be confirmed via chat",
  },
  "inbox.organizationNotFound": {
    bn: "Organization পাওয়া যায়নি",
    en: "Organization not found",
  },
  "inbox.thePipelineStepSStageIs": {
    bn: "Pipeline ধাপের stage সঠিক নয় — হতে পারে {{p1}}।",
    en: "The Pipeline step's stage is invalid — it can be {{p1}}.",
  },
  "inbox.practiceModeIsOffTurnIt": {
    bn: "Practice Mode বন্ধ আছে — আগে চালু করুন",
    en: "Practice Mode is off — turn it on first",
  },
  "inbox.productNotFoundInThisOrganization": {
    bn: "এই organization-এ product পাওয়া যায়নি",
    en: "Product not found in this organization",
  },
  "inbox.productNotFoundInThisOrganization2": {
    bn: "এই organization-এ product পাওয়া যায়নি: {{itemProductId}}",
    en: "Product not found in this organization: {{itemProductId}}",
  },
  "inbox.theQuickReplyTextIsEmpty": {
    bn: "Quick Reply-এর লেখা খালি।",
    en: "The Quick Reply text is empty.",
  },
  "inbox.quickReplyNotFoundInThis": {
    bn: "এই organization-এ quick reply পাওয়া যায়নি",
    en: "Quick reply not found in this organization",
  },
  "inbox.theQuotedMessageWasNotFound": {
    bn: "Quote করা মেসেজটি এই কথোপকথনে পাওয়া যায়নি — অন্য থ্রেডের মেসেজ quote করা যাবে না।",
    en: "The quoted message was not found in this conversation — a message from another thread cannot be quoted.",
  },
  "inbox.theReactionEmojiIsInvalid": {
    bn: "Reaction emoji সঠিক নয়।",
    en: "The reaction emoji is invalid.",
  },
  "inbox.realtimeIsNotAvailableInThis": {
    bn: "এই deployment-এ realtime পাওয়া যাচ্ছে না",
    en: "Realtime is not available in this deployment",
  },
  "inbox.forTheReplyStepChooseA": {
    bn: "Reply ধাপের জন্য একটি Quick Reply বেছে নিন।",
    en: "For the Reply step, choose a Quick Reply.",
  },
  "inbox.smtpDidNotConfirmTheEmail": {
    bn: "SMTP email send confirm করেনি",
    en: "SMTP did not confirm the email send",
  },
  "inbox.smtpVerificationFailed": {
    bn: "SMTP verification ব্যর্থ হয়েছে: {{p1}}",
    en: "SMTP verification failed: {{p1}}",
  },
  "inbox.savedViewNotFoundInThis": {
    bn: "এই organization-এ saved view পাওয়া যায়নি",
    en: "Saved view not found in this organization",
  },
  "inbox.siteNameIsRequired": {
    bn: "Site name দরকার",
    en: "Site name is required",
  },
  "inbox.theSnoozeStepMustBeBetween": {
    bn: "Snooze ধাপ ৫ থেকে ১০০৮০ মিনিটের মধ্যে হতে হবে।",
    en: "The Snooze step must be between 5 and 10080 minutes.",
  },
  "inbox.snoozeMustBeBetween5And": {
    bn: "Snooze ৫ থেকে ১০০৮০ মিনিটের মধ্যে হতে হবে।",
    en: "Snooze must be between 5 and 10080 minutes.",
  },
  "inbox.forSnoozeGiveExactlyOneOf": {
    bn: "Snooze-এর জন্য minutes অথবা until — ঠিক একটি দিন।",
    en: "For Snooze, give exactly one of minutes or until.",
  },
  "inbox.theSnoozeTimeMustBeIn": {
    bn: "Snooze-এর সময় ভবিষ্যতে হতে হবে (কমপক্ষে ১ মিনিট পরে)।",
    en: "The Snooze time must be in the future (at least 1 minute later).",
  },
  "inbox.inTheTagStepGiveThe": {
    bn: "Tag ধাপে ট্যাগের লেখা দিন।",
    en: "In the Tag step, give the tag text.",
  },
  "inbox.teamNameIsRequired": {
    bn: "Team name দরকার",
    en: "Team name is required",
  },
  "inbox.teamNotFound": {
    bn: "Team পাওয়া যায়নি",
    en: "Team not found",
  },
  "inbox.telegram": {
    bn: "Telegram: {{p1}}",
    en: "Telegram: {{p1}}",
  },
  "inbox.templateMessageWasNotSent": {
    bn: "Template message পাঠানো হয়নি: {{error}}",
    en: "Template message was NOT sent: {{error}}",
  },
  "inbox.templateMessagesAreWhatsappOnly": {
    bn: "Template messages শুধু WhatsApp-এর জন্য",
    en: "Template messages are WhatsApp-only",
  },
  "inbox.templateNameIsRequiredMustMatch": {
    bn: "Template name দরকার (Meta-র নামের সঙ্গে হুবহু মিলতে হবে)",
    en: "Template name is required (must match the name in Meta exactly)",
  },
  "inbox.templateNotFoundInThisOrganization": {
    bn: "এই organization-এ template পাওয়া যায়নি",
    en: "Template not found in this organization",
  },
  "inbox.thatUserIsNotAMember": {
    bn: "সেই user এই organization-এর সদস্য নন",
    en: "That user is not a member of this organization",
  },
  "inbox.theConnectedMetaIntegrationHasNo": {
    bn: "Connected Meta integration-এর কোনো access token নেই — comment action Meta Graph-এ পৌঁছাতে পারছে না, তাই কিছু পাঠানো বা বদলানো হয়নি",
    en: "The connected Meta integration has no access token — the comment action cannot reach Meta Graph, so nothing was sent or changed",
  },
  "inbox.theLeadMustBeAMember": {
    bn: "Lead-কে এই organization-এর সদস্য হতে হবে",
    en: "The lead must be a member of this organization",
  },
  "inbox.thisIsNotACashOn": {
    bn: "এটি cash-on-delivery order নয়",
    en: "This is not a cash-on-delivery order",
  },
  "inbox.thisMessageHasNoMedia": {
    bn: "এই message-এ কোনো media নেই",
    en: "This message has no media",
  },
  "inbox.thisOrderIsAlreadyConfirmed": {
    bn: "এই order ইতিমধ্যে confirmed",
    en: "This order is already confirmed",
  },
  "inbox.thisOrderIsNotLinkedTo": {
    bn: "এই order conversation-এর customer-এর সঙ্গে linked নয়",
    en: "This order is not linked to the conversation's customer",
  },
  "inbox.thisTemplateNameLanguageIsAlready": {
    bn: "এই template name + language ইতিমধ্যে registered",
    en: "This template name + language is already registered",
  },
  "inbox.aUrlButtonNeedsAValid": {
    bn: "URL বাটনের জন্য http(s) দিয়ে শুরু হওয়া একটি বৈধ url আবশ্যক।",
    en: "A URL button needs a valid URL starting with http(s).",
  },
  "inbox.unansweredQuestionNotFoundInThis": {
    bn: "এই organization-এ unanswered question পাওয়া যায়নি",
    en: "Unanswered question not found in this organization",
  },
  "inbox.unknownChannel": {
    bn: "অজানা channel: {{channel}}",
    en: "Unknown channel: {{channel}}",
  },
  "inbox.unknownIntent": {
    bn: "অজানা intent: {{intent}}",
    en: "Unknown intent: {{intent}}",
  },
  "inbox.unknownTimezone": {
    bn: "অজানা timezone: {{timezone}}",
    en: "Unknown timezone: {{timezone}}",
  },
  "inbox.userIsNotAMemberOf": {
    bn: "User {{mUserId}} এই organization-এর সদস্য নন",
    en: "User {{mUserId}} is not a member of this organization",
  },
  "inbox.variantNotFoundForProduct": {
    bn: "Product {{productName}}-এর variant পাওয়া যায়নি",
    en: "Variant not found for product {{productName}}",
  },
  "inbox.versionNotFoundInThisOrganization": {
    bn: "এই organization-এ version পাওয়া যায়নি",
    en: "Version not found in this organization",
  },
  "inbox.noWabaIdIsSetCollect": {
    bn: "WABA ID সেট করা নেই — WhatsApp Manager / Meta Business Settings থেকে WhatsApp Business Account ID সংগ্রহ করে Inbox-এর WhatsApp সেটিংসে বসান।",
    en: "No WABA ID is set — collect the WhatsApp Business Account ID from WhatsApp Manager / Meta Business Settings and put it in the Inbox WhatsApp settings.",
  },
  "inbox.theWhatsapp24HourWindowIs": {
    bn: "WhatsApp ২৪ ঘণ্টার উইন্ডো বন্ধ — এই কথোপকথনে এখন Quick Reply পাঠানো যাবে না; Template ব্যবহার করুন।",
    en: "The WhatsApp 24-hour window is closed — a Quick Reply cannot be sent in this conversation now; use a Template.",
  },
  "inbox.widgetSiteNotFound": {
    bn: "Widget site পাওয়া যায়নি",
    en: "Widget site not found",
  },
  "inbox.aireplydelaybychannelMustBeAnObjectMapping": {
    bn: "aiReplyDelayByChannel একটি object হতে হবে যা channel-কে seconds-এ map করে",
    en: "aiReplyDelayByChannel must be an object mapping channel to seconds",
  },
  "inbox.aireplydelaysecondsMustBeAnInteger0": {
    bn: "aiReplyDelaySeconds একটি পূর্ণসংখ্যা 0..600 হতে হবে",
    en: "aiReplyDelaySeconds must be an integer 0..600",
  },
  "inbox.aischedulebychannelIsInvalidEachChannelMust": {
    bn: "aiScheduleByChannel সঠিক নয় — প্রতিটি channel-এ enabled (true/false) ও সর্বোচ্চ ৮টি window (days 0–6, start/end HH:mm) থাকতে হবে",
    en: "aiScheduleByChannel is invalid — each channel must have enabled (true/false) and at most 8 windows (days 0–6, start/end HH:mm)",
  },
  "inbox.appsourceMustBePlatformOrOwn": {
    bn: "appSource platform অথবা own হতে হবে",
    en: "appSource must be platform or own",
  },
  "inbox.assigneduseridIsRequiredForTheAssign": {
    bn: "assign action-এর জন্য assignedUserId দরকার",
    en: "assignedUserId is required for the assign action",
  },
  "inbox.autoreplymodeMustBeOffDraftAuto": {
    bn: "autoReplyMode হতে হবে off | draft | auto",
    en: "autoReplyMode must be off | draft | auto",
  },
  "inbox.channelMustBeWhatsappMessengerOr": {
    bn: "channel হতে হবে whatsapp, messenger অথবা instagram",
    en: "channel must be whatsapp, messenger or instagram",
  },
  "inbox.chasefirstdelayminutesMustBeAnInteger15": {
    bn: "chaseFirstDelayMinutes একটি পূর্ণসংখ্যা 15..1440 হতে হবে",
    en: "chaseFirstDelayMinutes must be an integer 15..1440",
  },
  "inbox.chaseintervalminutesMustBeAnInteger60": {
    bn: "chaseIntervalMinutes একটি পূর্ণসংখ্যা 60..2880 হতে হবে",
    en: "chaseIntervalMinutes must be an integer 60..2880",
  },
  "inbox.chasemaxattemptsMustBeAnInteger1": {
    bn: "chaseMaxAttempts একটি পূর্ণসংখ্যা 1..5 হতে হবে",
    en: "chaseMaxAttempts must be an integer 1..5",
  },
  "inbox.chasequietendhourMustBeAnInteger0": {
    bn: "chaseQuietEndHour একটি পূর্ণসংখ্যা 0..23 হতে হবে",
    en: "chaseQuietEndHour must be an integer 0..23",
  },
  "inbox.chasequietstarthourMustBeAnInteger0": {
    bn: "chaseQuietStartHour একটি পূর্ণসংখ্যা 0..23 হতে হবে",
    en: "chaseQuietStartHour must be an integer 0..23",
  },
  "inbox.confidencethresholdMustBe0100": {
    bn: "confidenceThreshold 0..100 হতে হবে",
    en: "confidenceThreshold must be 0..100",
  },
  "inbox.customeridIsRequired": {
    bn: "customerId দরকার",
    en: "customerId is required",
  },
  "inbox.imageurlMustBeAPublicHttps": {
    bn: "imageUrl একটি public https URL হতে হবে",
    en: "imageUrl must be a public https URL",
  },
  "inbox.instructionsMustBeAString": {
    bn: "instructions একটি string হতে হবে",
    en: "instructions must be a string",
  },
  "inbox.instructionsMustBeAtMost2000": {
    bn: "instructions সর্বোচ্চ ২০০০ অক্ষরের হতে হবে",
    en: "instructions must be at most 2000 characters",
  },
  "inbox.pageidTheFacebookPageLinkedTo": {
    bn: "Instagram-এর জন্য pageId (Instagram account-এর সঙ্গে linked Facebook Page) দরকার",
    en: "pageId (the Facebook Page linked to the Instagram account) is required for Instagram",
  },
  "inbox.phonenumberidIsRequiredForWhatsapp": {
    bn: "WhatsApp-এর জন্য phoneNumberId দরকার",
    en: "phoneNumberId is required for WhatsApp",
  },
  "inbox.questionIsRequired1500Characters": {
    bn: "question দরকার (1..500 অক্ষর)",
    en: "question is required (1..500 characters)",
  },
  "inbox.reviewrequestdelayhoursMustBeAnInteger0": {
    bn: "reviewRequestDelayHours একটি পূর্ণসংখ্যা 0..168 হতে হবে",
    en: "reviewRequestDelayHours must be an integer 0..168",
  },
  "inbox.slabychannelMustBeAnObjectMapping": {
    bn: "slaByChannel একটি object হতে হবে যা channel-কে minutes-এ map করে",
    en: "slaByChannel must be an object mapping channel to minutes",
  },
  "inbox.slaescalateafterminutesMustBeAnInteger1": {
    bn: "slaEscalateAfterMinutes একটি পূর্ণসংখ্যা 1..1440 হতে হবে",
    en: "slaEscalateAfterMinutes must be an integer 1..1440",
  },
  "inbox.slavipminutesMustBeNullOrAn": {
    bn: "slaVipMinutes null অথবা একটি পূর্ণসংখ্যা 1..10080 হতে হবে",
    en: "slaVipMinutes must be null or an integer 1..10080",
  },
  "inbox.smartassignMustBeOffRoundRobin": {
    bn: "smartAssign হতে হবে off | round_robin | least_busy",
    en: "smartAssign must be off | round_robin | least_busy",
  },
  "inbox.sourcecustomeridAndTargetcustomeridAreRequired": {
    bn: "sourceCustomerId ও targetCustomerId দরকার",
    en: "sourceCustomerId and targetCustomerId are required",
  },
  "inbox.sourcecustomeridIsRequired": {
    bn: "sourceCustomerId দরকার",
    en: "sourceCustomerId is required",
  },
  "inbox.statusMustBeOneOf": {
    bn: "status হতে হবে এর যেকোনো একটি: {{p1}}",
    en: "status must be one of: {{p1}}",
  },
  "inbox.statusMustBeOnlineBusyAway": {
    bn: "status হতে হবে online | busy | away",
    en: "status must be online | busy | away",
  },
  "inbox.tagIsRequiredForTheTag": {
    bn: "tag-add action-এর জন্য tag দরকার",
    en: "tag is required for the tag-add action",
  },
  "inbox.targetMustBeEnOrBn": {
    bn: "target হতে হবে en অথবা bn",
    en: "target must be en or bn",
  },
  "inbox.titleAndContentAreRequired": {
    bn: "title ও content দরকার",
    en: "title and content are required",
  },
  "inbox.toneMustBePoliteProfessionalOr": {
    bn: "tone হতে হবে polite, professional অথবা sales",
    en: "tone must be polite, professional or sales",
  },
  "inbox.visitoridIsRequired": {
    bn: "visitorId দরকার",
    en: "visitorId is required",
  },
  "inbox.unknownMacroStepStepsCanBe": {
    bn: "অজানা ম্যাক্রো ধাপ: {{p1}} — ধাপ হতে পারে reply | assign | tag | pipeline | close | snooze।",
    en: "Unknown macro step: {{p1}} — steps can be reply | assign | tag | pipeline | close | snooze.",
  },
  "inbox.aRealLlmProviderIsNeeded": {
    bn: "অনুবাদের জন্য একটি আসল LLM provider দরকার (LLM_PROVIDER ও API key সেট করুন)। Dev template দিয়ে অনুবাদ সম্ভব নয়।",
    en: "A real LLM provider is needed for translation (set LLM_PROVIDER and the API key). Translation is not possible with the dev template.",
  },
  "inbox.practiceSessionNotFound": {
    bn: "অনুশীলন সেশন পাওয়া যায়নি",
    en: "Practice session not found",
  },
  "inbox.turnOnPracticeModeFirstThen": {
    bn: "আগে Practice Mode চালু করুন — তারপর Demo Chat লোড হবে",
    en: "Turn on Practice Mode first — then the Demo Chat will load",
  },
  "inbox.turnOnPracticeModeFirstThen2": {
    bn: "আগে Practice Mode চালু করুন — তারপর প্র্যাক্টিস কথোপকথন তৈরি হবে",
    en: "Turn on Practice Mode first — then a practice conversation will be created",
  },
  "inbox.yourMacroLimit50IsFull": {
    bn: "আপনার ম্যাক্রোর সীমা (৫০টি) পূর্ণ হয়ে গেছে — পুরোনো কোনোটি মুছে আবার চেষ্টা করুন।",
    en: "Your macro limit (50) is full — delete an old one and try again.",
  },
  "inbox.yourSavedViewLimit50Is": {
    bn: "আপনার সেভ করা ভিউয়ের সীমা (৫০টি) পূর্ণ হয়ে গেছে — পুরোনো কোনোটি মুছে আবার চেষ্টা করুন।",
    en: "Your saved view limit (50) is full — delete an old one and try again.",
  },
  "inbox.thisPracticeSessionIsNotActive": {
    bn: "এই অনুশীলন সেশনটি সক্রিয় নয়",
    en: "This practice session is not active",
  },
  "inbox.thisOrderHasNoCourierBooking": {
    bn: "এই অর্ডারের কোনো কুরিয়ার বুকিং/ট্র্যাকিং এখনো নেই",
    en: "This order has no courier booking/tracking yet",
  },
  "inbox.youHaveNotBeenGivenPermission": {
    bn: "এই অ্যাকাউন্টে কমেন্টের উত্তর পাঠানোর অনুমতি আপনাকে দেওয়া হয়নি — Connect Center-এর অ্যাক্সেস সেটিংস দেখুন বা OWNER/ADMIN-কে বলুন।",
    en: "You have not been given permission to reply to comments on this account — see the access settings in the Connect Center or ask an OWNER/ADMIN.",
  },
  "inbox.youHaveNotBeenGivenPermission2": {
    bn: "এই অ্যাকাউন্টে মেসেজ পাঠানোর অনুমতি আপনাকে দেওয়া হয়নি — Connect Center-এর অ্যাক্সেস সেটিংস দেখুন বা OWNER/ADMIN-কে বলুন।",
    en: "You have not been given permission to send messages on this account — see the access settings in the Connect Center or ask an OWNER/ADMIN.",
  },
  "inbox.automatedMessagesCannotBeSentOn": {
    bn: "এই অ্যাকাউন্টে স্বয়ংক্রিয় বার্তা পাঠানো যাবে না — দায়িত্বপ্রাপ্ত সদস্যের এই কানেকশন ব্যবহারের অনুমতি Connect Center-এর অ্যাক্সেস সেটিংসে প্রত্যাহার করা হয়েছে।",
    en: "Automated messages cannot be sent on this account — the responsible member's permission to use this connection has been revoked in the Connect Center access settings.",
  },
  "inbox.thisUnmergeIsNotRelatedTo": {
    bn: "এই আনমার্জটি এই কথোপকথনের গ্রাহকের সাথে সম্পর্কিত নয়।",
    en: "This unmerge is not related to this conversation's customer.",
  },
  "inbox.thisConversationIsAlreadyLinkedTo": {
    bn: "এই কথোপকথন ইতিমধ্যে একজন Customer-এর সাথে যুক্ত — বদলাতে হলে মার্জ/আনমার্জ ব্যবহার করুন।",
    en: "This conversation is already linked to a Customer — use merge/unmerge to change it.",
  },
  "inbox.thereAreNoMessagesInThis": {
    bn: "এই কথোপকথনে কোনো বার্তা নেই",
    en: "There are no messages in this conversation",
  },
  "inbox.noOrdersWereFoundForThis": {
    bn: "এই গ্রাহকের কোনো অর্ডার পাওয়া যায়নি",
    en: "No orders were found for this customer",
  },
  "inbox.thereIsNoRealWayTo": {
    bn: "এই চ্যানেলে প্ল্যাটফর্ম reaction পাঠানোর সত্যিকারের উপায় নেই — reaction শুধু Messenger/Instagram-এ পাঠানো যায়।",
    en: "There is no real way to send platform reactions on this channel — reactions can only be sent on Messenger/Instagram.",
  },
  "inbox.thisFileFormatCannotBeSent": {
    bn: "এই ফাইল ফরম্যাটটি পাঠানো যায় না — ছবি (PNG/JPG/WebP/GIF), অডিও/ভয়েস, MP4/WebM ভিডিও অথবা PDF দিন।",
    en: "This file format cannot be sent — give an image (PNG/JPG/WebP/GIF), audio/voice, MP4/WebM video, or a PDF.",
  },
  "inbox.thisMessageHasNoPlatformId": {
    bn: "এই মেসেজের প্ল্যাটফর্ম আইডি নেই — reaction পাঠানো যাবে না।",
    en: "This message has no platform ID — a reaction cannot be sent.",
  },
  "inbox.aTemplateCanHaveAtMost": {
    bn: "একটি টেমপ্লেটে সর্বোচ্চ ১০টি বাটন থাকতে পারে।",
    en: "A template can have at most 10 buttons.",
  },
  "inbox.bulkActionsCanBeAppliedTo": {
    bn: "একবারে সর্বোচ্চ ২৫টি কথোপকথনে বাল্ক অ্যাকশন করা যাবে।",
    en: "Bulk actions can be applied to at most 25 conversations at a time.",
  },
  "inbox.bulkRepliesCanBeSentTo": {
    bn: "একবারে সর্বোচ্চ ২৫টি কথোপকথনে বাল্ক রিপ্লাই করা যাবে।",
    en: "Bulk replies can be sent to at most 25 conversations at a time.",
  },
  "inbox.thisIsNotAPracticeConversation": {
    bn: "এটি প্র্যাক্টিস কথোপকথন নয় — আসল কথোপকথনে এভাবে বার্তা পাঠানো যায় না",
    en: "This is not a practice conversation — messages cannot be sent this way in a real conversation",
  },
  "inbox.thatCustomerRecordHasBeenMerged": {
    bn: "ওই Customer রেকর্ডটি অন্য রেকর্ডে মার্জ হয়ে গেছে — survivor রেকর্ডটির সাথে যুক্ত করুন।",
    en: "That Customer record has been merged into another record — link to the survivor record.",
  },
  "inbox.selectAtLeastOneConversation": {
    bn: "কমপক্ষে একটি কথোপকথন বেছে নিন।",
    en: "Select at least one conversation.",
  },
  "inbox.typeAtLeast2CharactersTo": {
    bn: "খুঁজতে অন্তত ২টি অক্ষর লিখুন।",
    en: "Type at least 2 characters to search.",
  },
  "inbox.forAnImageHeaderTheExample": {
    bn: "ছবির হেডারের জন্য Meta-র Resumable Upload API থেকে পাওয়া উদাহরণ আপলোড হ্যান্ডল (headerHandle) আবশ্যক — এই মুহূর্তে হ্যান্ডল ছাড়া তৈরি করা যাবে না।",
    en: "For an image header, the example upload handle from Meta's Resumable Upload API (headerHandle) is required — it cannot be created without a handle at this moment.",
  },
  "inbox.aTimedAssignmentMustBeBetween": {
    bn: "টাইমড অ্যাসাইনমেন্ট ৫ থেকে ৪৮০ মিনিটের মধ্যে হতে হবে।",
    en: "A timed assignment must be between 5 and 480 minutes.",
  },
  "inbox.forATimedAssignmentSayWho": {
    bn: "টাইমড অ্যাসাইনমেন্টের জন্য কাকে অ্যাসাইন করা হবে তা দিন।",
    en: "For a timed assignment, say who to assign to.",
  },
  "inbox.headertextIsRequiredForAText": {
    bn: "টেক্সট হেডারের জন্য headerText আবশ্যক।",
    en: "headerText is required for a text header.",
  },
  "inbox.theTemplateCategoryMustBeOne": {
    bn: "টেমপ্লেটের ক্যাটাগরি MARKETING, UTILITY বা AUTHENTICATION-এর একটি হতে হবে।",
    en: "The template category must be one of MARKETING, UTILITY or AUTHENTICATION.",
  },
  "inbox.theTemplateNameMayOnlyUse": {
    bn: "টেমপ্লেটের নাম শুধু ছোট হাতের ইংরেজি অক্ষর, সংখ্যা ও আন্ডারস্কোর (_) দিয়ে হতে হবে (সর্বোচ্চ ৫১২ অক্ষর) — যেমন eid_offer_2026।",
    en: "The template name may only use lowercase English letters, digits and underscores (_) (at most 512 characters) — e.g. eid_offer_2026.",
  },
  "inbox.theTemplateSMainTextBodytext": {
    bn: "টেমপ্লেটের মূল লেখা (bodyText) আবশ্যক।",
    en: "The template's main text (bodyText) is required.",
  },
  "inbox.aRealLlmProviderIsNeeded2": {
    bn: "টোন বদলাতে একটি আসল LLM provider দরকার (LLM_PROVIDER ও API key সেট করুন)। Dev template দিয়ে টোন বদলানো সম্ভব নয়।",
    en: "A real LLM provider is needed to change tone (set LLM_PROVIDER and the API key). Tone cannot be changed with the dev template.",
  },
  "inbox.yourOwnMetaAppIsNot": {
    bn: "নিজের Meta অ্যাপ কনফিগার করা নেই — আগে কানেক্ট সেন্টারে (কানেক্ট সেন্টার → নিজের অ্যাপ) আপনার Meta অ্যাপটি যোগ করুন, অথবা প্ল্যাটফর্মের অ্যাপ দিয়ে কানেক্ট করুন।",
    en: "Your own Meta app is not configured — add your Meta app in the Connect Center (Connect Center → Your App) first, or connect with the platform's app.",
  },
  "inbox.theFileIsTooLargeUploads": {
    bn: "ফাইল খুব বড় — সর্বোচ্চ {{p1}}MB পর্যন্ত আপলোড করা যাবে।",
    en: "The file is too large — uploads of at most {{p1}}MB are allowed.",
  },
  "inbox.theFileIsEmptyOrCould": {
    bn: "ফাইলটি খালি অথবা পড়া যায়নি।",
    en: "The file is empty or could not be read.",
  },
  "inbox.theButtonTypeMustBeUrl": {
    bn: "বাটনের ধরন url বা quick_reply হতে হবে।",
    en: "The button type must be url or quick_reply.",
  },
  "inbox.theButtonTextIsRequiredAnd": {
    bn: "বাটনের লেখা আবশ্যক এবং সর্বোচ্চ ২৫ অক্ষরের হতে হবে।",
    en: "The button text is required and can be at most 25 characters.",
  },
  "inbox.theMessageCannotBeEmpty": {
    bn: "বার্তা খালি হতে পারবে না",
    en: "The message cannot be empty",
  },
  "inbox.theMessageCannotBeEmpty2": {
    bn: "বার্তা খালি হতে পারে না",
    en: "The message cannot be empty",
  },
  "inbox.theMessageCanBeAtMost": {
    bn: "বার্তা সর্বোচ্চ ২০০০ অক্ষরের হতে পারবে",
    en: "The message can be at most 2000 characters",
  },
  "inbox.forABulkReplyChooseExactly": {
    bn: "বাল্ক রিপ্লাইয়ের জন্য Quick Reply অথবা Template — ঠিক একটি বেছে নিন।",
    en: "For a bulk reply, choose exactly one of Quick Reply or Template.",
  },
  "inbox.giveTheViewAName": {
    bn: "ভিউয়ের একটি নাম দিন।",
    en: "Give the view a name.",
  },
  "inbox.atLeastOneSideOfThe": {
    bn: "মার্জের অন্তত এক পক্ষ এই কথোপকথনের গ্রাহক হতে হবে।",
    en: "At least one side of the merge must be this conversation's customer.",
  },
  "inbox.theOriginalTextHasParametersUp": {
    bn: "মূল লেখায় {{{{maxParam}}}} পর্যন্ত প্যারামিটার আছে — Meta-র জন্য প্রতিটি প্যারামিটারের একটি করে উদাহরণ মান (exampleValues) দিতে হবে, মোট {{maxParam2}}টি।",
    en: "The original text has parameters up to {{{{maxParam}}}} — for Meta, an example value (exampleValues) must be given for each parameter, {{maxParam2}} in total.",
  },
  "inbox.aMacroMustHaveAtLeast": {
    bn: "ম্যাক্রোতে অন্তত একটি ধাপ থাকতে হবে।",
    en: "A macro must have at least one step.",
  },
  "inbox.aMacroCanHaveAtMost": {
    bn: "ম্যাক্রোতে সর্বোচ্চ ১০টি ধাপ থাকতে পারবে।",
    en: "A macro can have at most 10 steps.",
  },
  "inbox.theMacroSQuickReplyWas": {
    bn: "ম্যাক্রোর Quick Replyটি পাওয়া যায়নি — হয়তো মুছে ফেলা হয়েছে।",
    en: "The macro's Quick Reply was not found — it may have been deleted.",
  },
  "inbox.giveTheMacroAName": {
    bn: "ম্যাক্রোর একটি নাম দিন।",
    en: "Give the macro a name.",
  },
  "inbox.theTextIsEmptyWriteSomething": {
    bn: "লেখা খালি — আগে কিছু লিখুন।",
    en: "The text is empty — write something first.",
  },
  "inbox.theTextIsTooLongAt": {
    bn: "লেখা খুব লম্বা (সর্বোচ্চ ২০০০ অক্ষর)।",
    en: "The text is too long (at most 2000 characters).",
  },
  "inbox.onlyTheViewSOwnerCan": {
    bn: "শুধু ভিউয়ের মালিকই এটি বদলাতে পারবেন।",
    en: "Only the view's owner can change it.",
  },
  "inbox.onlyTheViewSOwnerCan2": {
    bn: "শুধু ভিউয়ের মালিকই এটি মুছতে পারবেন।",
    en: "Only the view's owner can delete it.",
  },
  "inbox.onlyTheMacroSOwnerCan": {
    bn: "শুধু ম্যাক্রোর মালিকই এটি বদলাতে পারবেন।",
    en: "Only the macro's owner can change it.",
  },
  "inbox.onlyTheMacroSOwnerCan2": {
    bn: "শুধু ম্যাক্রোর মালিকই এটি মুছতে পারবেন।",
    en: "Only the macro's owner can delete it.",
  },
  "inbox.ifTheHeaderHasAParameter": {
    bn: "হেডারে {{1}} প্যারামিটার থাকলে তার উদাহরণ মান (headerExample) দিতে হবে।",
    en: "If the header has a {{1}} parameter, its example value (headerExample) must be given.",
  },
  "inbox.aiFeaturesTemporarilyPausedPlatformWide": {
    bn: "AI features প্ল্যাটফর্ম team দ্বারা পুরো প্ল্যাটফর্মে সাময়িকভাবে বন্ধ রাখা হয়েছে।",
    en: "AI features are temporarily paused platform-wide by the platform team.",
  },
  "inbox.aiFeaturesTemporarilyDisabledForThisOrganization": {
    bn: "AI features প্ল্যাটফর্ম team দ্বারা এই organization-এর জন্য সাময়িকভাবে বন্ধ আছে।",
    en: "AI features are temporarily disabled for this organization by the platform team.",
  },
};
