/**
 * MB2 Finisher F2 — `shared` namespace: UI copy owned by the
 * SHARED lib helpers (lib/global-assistant.ts, org-switcher.ts,
 * agency-nf15.ts, personas.ts, ab8.ts, connect-forms.ts,
 * workflow-graph.ts, ab7.ts, loyalty.ts, email-blocks.ts) that
 * converted dashboard pages/components render.
 *
 * Convention (same as every MB2 namespace): bn values are the
 * existing Bengali copy VERBATIM; en values are faithful plain
 * English. The lib helpers keep their bn constants as the bn
 * source (several test suites pin the bn output byte-for-byte)
 * and resolve through these objects via a trailing
 * `locale = "bn"` parameter, so existing callers and tests are
 * byte-identical on the default.
 *
 * Key prefixes: ga (global-assistant), org/role (org-switcher),
 * ag (agency console), persona (personas), scope/key/export/
 * size/tbl/skip/imp/job (ab8), cf (connect-forms), step/graph/
 * wg (workflow-graph), push/seq/basis/variant (ab7), loy
 * (loyalty), eb (email-blocks).
 *
 * The coordinator assembles this file into dict.ts as `shared`.
 */

export const sharedBn = {
  // ---- global-assistant.ts: starter suggestions + fallback ----
  gaSugSales7d: "গত ৭ দিনে বিক্রি কেমন ছিল?",
  gaSugBestCampaigns: "আমার সবচেয়ে ভালো ক্যাম্পেইন কোনগুলো?",
  gaSugAnomaly: "কোনো অস্বাভাবিক কিছু ঘটেছে কি?",
  gaSugOrderFollowUp: "কোন অর্ডারগুলোর ফলো-আপ দরকার?",
  gaSugCourierPerf: "কুরিয়ারদের পারফরম্যান্স কেমন?",
  gaSugProfitProduct: "কোন পণ্যে সবচেয়ে বেশি লাভ হয়?",
  gaSugSegments: "কাস্টমার সেগমেন্টগুলো দেখাও",
  gaSugStock: "স্টকের অবস্থা কেমন?",
  // Verbatim: the bn source itself offers this one in English.
  gaSugBestMargin: "Which products have the best margin?",
  gaPageFallback: "Dashboard",

  // ---- org-switcher.ts: state badges + membership roles ----
  orgBadgeSuspended: "স্থগিত",
  orgBadgeArchived: "আর্কাইভ করা",
  roleOwner: "মালিক (Owner)",
  roleAdmin: "অ্যাডমিন",
  roleMarketingManager: "মার্কেটিং ম্যানেজার",
  roleAdvertiser: "বিজ্ঞাপনদাতা",
  roleSupportAgent: "সাপোর্ট এজেন্ট",
  roleAnalyst: "অ্যানালিস্ট",
  roleViewer: "শুধু দেখতে পারেন",
  roleSuperAdmin: "সুপার অ্যাডমিন",

  // ---- agency-nf15.ts: agency console ----
  agCommissionRecords:
    "কমিশন এখানে শুধু রেকর্ড হিসেবে রাখা হয় — কোনো টাকা স্বয়ংক্রিয়ভাবে কাটা বা পাঠানো হয় না। পেআউট OU11 আইনি গেটের অধীনে বন্ধ আছে।",
  agSummaryError: "তথ্য লোড হয়নি",
  agTotalsBanner: "শুধু তালিকাভুক্ত প্রতিষ্ঠানগুলোর মোট ({count}টি)",
  agRoleOwner: "মালিক (OWNER)",
  agRoleAdmin: "অ্যাডমিন (ADMIN)",
  agRoleMarketingManager: "মার্কেটিং ম্যানেজার",
  agRoleAdvertiser: "বিজ্ঞাপনদাতা",
  agRoleSupportAgent: "সাপোর্ট এজেন্ট",
  agRoleAnalyst: "অ্যানালিস্ট",
  agRoleViewer: "দর্শক (VIEWER)",

  // ---- personas.ts ----
  personaGeneral: "সাধারণ সহকারী",
  personaAdsAnalyst: "Ads Analyst",
  personaInboxCoach: "Inbox Coach",
  personaFinanceAnalyst: "Finance Analyst",

  // ---- ab8.ts: merchant API scopes ----
  scopeProductsRead: "পণ্য পড়া (products:read)",
  scopeProductsWrite: "পণ্য লেখা/বদলানো (products:write)",
  scopeOrdersRead: "অর্ডার পড়া (orders:read)",
  scopeCustomersRead: "গ্রাহক পড়া (customers:read)",
  // ---- ab8.ts: API key status + create-form validation ----
  keyStatusActive: "সক্রিয়",
  keyStatusRevoked: "বাতিল করা",
  keyNameRequired: "কী-এর নাম লিখুন।",
  keyNameTooLong: "কী-এর নাম সর্বোচ্চ ৮০ অক্ষরের হতে পারবে।",
  keyScopeRequired: "অন্তত একটি স্কোপ বেছে নিন।",
  keyScopeInvalid: "একটি স্কোপ সঠিক নয়।",
  // ---- ab8.ts: data exports ----
  exportKindManual: "ম্যানুয়াল",
  exportKindBackup: "স্বয়ংক্রিয় ব্যাকআপ",
  exportStatusPending: "তৈরি হচ্ছে…",
  exportStatusReady: "প্রস্তুত",
  exportStatusFailed: "ব্যর্থ",
  exportStatusExpired: "মেয়াদ শেষ",
  sizeUnitByte: "বাইট",
  // ---- ab8.ts: data import table labels ----
  tblOrganization: "প্রতিষ্ঠান",
  tblBusinessProfile: "ব্যবসার প্রোফাইল",
  tblMembers: "সদস্যরা",
  tblProducts: "পণ্য",
  tblOrders: "অর্ডার",
  tblCustomers: "ক্রেতা",
  tblLeads: "লিড",
  tblConversations: "কথোপকথন",
  tblCampaignPlans: "ক্যাম্পেইন পরিকল্পনা",
  tblIntegrations: "সংযোগসমূহ",
  tblSubscription: "সাবস্ক্রিপশন",
  tblPayments: "পেমেন্ট",
  tblSupportTickets: "সাপোর্ট টিকিট",
  tblOrderItems: "অর্ডারের আইটেম",
  tblMediaAssets: "মিডিয়া ফাইল",
  // ---- ab8.ts: import skip reasons ----
  skipTargetIdentity: "এই প্রতিষ্ঠানের নিজের পরিচয়ই থাকবে",
  skipPeopleNotRestored: "সদস্যপদ ও ব্যবহারকারী ফিরিয়ে আনা হয় না",
  skipBillingState: "বিলিং অবস্থা স্থানান্তর হয় না",
  skipBillingLedger: "বিলিং লেজার স্থানান্তর হয় না",
  skipConnectionsNotRestored: "সংযোগের credential bundle-এ থাকে না",
  skipTranscriptsNotInBundle: "বার্তাগুলো bundle-এ নেই",
  skipAdChildrenNotInBundle: "বিজ্ঞাপনের বিস্তারিত bundle-এ নেই",
  skipMessagesNotInBundle: "টিকিটের বার্তা bundle-এ নেই",
  skipBytesNotInBundle: "ফাইলের বাইট bundle-এ নেই, শুধু তথ্য থাকে",
  // ---- ab8.ts: import errors + job status ----
  impErrTargetNotEmpty:
    "এই প্রতিষ্ঠানটি খালি নয় — ইমপোর্ট শুধু একদম নতুন, খালি প্রতিষ্ঠানে করা যায়।",
  impErrBundleNotObject: "ফাইলটি সঠিক bundle ফরম্যাটে নয়।",
  impErrRowCapExceeded:
    "Bundle-টি এই পদ্ধতির জন্য বড় — মোট ফিরিয়ে-আনা সারি সীমার বেশি।",
  impErrCredentialField:
    "Bundle-এ credential-জাতীয় তথ্য আছে — নিরাপত্তার কারণে পুরো bundle বাতিল করা হয়েছে।",
  impErrSourceTruncated:
    "উৎস এক্সপোর্টটি অসম্পূর্ণ ছিল (কিছু ডেটা কাটা পড়েছিল) — অসম্পূর্ণ bundle ফিরিয়ে আনা হয় না।",
  impErrDataInconsistent:
    "Bundle-এর ভেতরের ডেটায় অসঙ্গতি আছে — ফাইলটি বদলানো বা নষ্ট হয়ে থাকতে পারে।",
  jobStatusRunning: "চলছে…",
  jobStatusCompleted: "সম্পন্ন",
  jobStatusFailed: "ব্যর্থ",

  // ---- connect-forms.ts: connect result lines ----
  cfConnectedBot: "কানেক্ট হয়েছে: {bot}",
  cfReconnectedBot: "আবার কানেক্ট হয়েছে (একই বটের রো হালনাগাদ হয়েছে): {bot}",
  cfWebhookRegistered: "নিবন্ধিত ✅",
  cfWebhookFailed: "হয়নি — {error}",
  cfConnectedMailbox: "কানেক্ট হয়েছে: {mailbox}",
  cfReconnectedMailbox:
    "আবার কানেক্ট হয়েছে (একই মেইলবক্সের রো হালনাগাদ হয়েছে): {mailbox}",

  // ---- workflow-graph.ts: step type labels ----
  stepSendEmail: "Email পাঠান",
  stepSendSms: "SMS পাঠান",
  stepAddLeadActivity: "Lead এ Note যোগ করুন",
  stepAddConversationNote: "Conversation এ Internal Note",
  stepWait: "অপেক্ষা (Wait)",
  stepCondition: "শর্ত (Branch)",
  stepSendInboxMessage: "Inbox এ বার্তা পাঠান",
  stepAssignConversation: "কথোপকথন Assign করুন",
  stepChangeLeadStage: "Lead Stage বদলান",
  stepAddTag: "Tag যোগ করুন",
  stepNotifyTeam: "টিমকে জানান",
  stepCreateFollowUp: "Follow-up তৈরি করুন",
  stepHttpWebhook: "Webhook পাঠান",
  stepBranch: "শাখা (যদি / নয়তো)",
  stepNotifyChannel: "চ্যানেল অ্যালার্ট (Slack/Discord)",
  stepAiGenerate: "AI টেক্সট / নোট জেনারেশন",
  stepUnknown: "অজানা ধাপ (Locked)",
  // ---- workflow-graph.ts: structural error messages ----
  graphErrMultiplePaths: "একটি ধাপ থেকে একাধিক পথ বের হয়েছে ({source})",
  graphErrNotConnectedToEnd:
    "Flow-টি শেষ ধাপ (End) পর্যন্ত যুক্ত নয় — মাঝের সংযোগ ভেঙে গেছে",
  graphErrUnknownTarget: "অজানা ধাপে সংযোগ গেছে ({target})",
  graphErrWrongTarget: "সংযোগ ভুল জায়গায় গেছে",
  graphErrCycle: "Flow-তে বৃত্ত (cycle) তৈরি হয়েছে",
  graphErrOrphanSteps:
    "কিছু ধাপ মূল Flow-র সাথে যুক্ত নেই — সব ধাপ এক লাইনে যুক্ত করুন, নয়তো অপ্রয়োজনীয় ধাপ মুছে ফেলুন",
  // ---- workflow-graph.ts: step summaries ----
  wgWaitSummary: "{minutes} মিনিট অপেক্ষা",
  wgTemplateSet: "Template নির্ধারিত",
  wgTemplateNotSet: "Template বেছে নেওয়া হয়নি",
  wgMessageEmpty: "বার্তা খালি",
  wgNoteEmpty: "Note খালি",
  wgBranchSummary: "{cond} · ✓ {thenCount} ধাপ / ✗ {elseCount} ধাপ",
  wgChannelAlertText: "চ্যানেল অ্যালার্ট: {text}",
  wgChannelAlert: "চ্যানেল অ্যালার্ট",
  wgAiStep: "AI অ্যাসিস্ট্যান্ট ধাপ",
  wgLockedStep: "ক্যানভাসে বদলানো যাবে না — যেমন আছে তেমনই থাকবে",

  // ---- ab7.ts: web push campaign status ----
  pushSent: "পাঠানো হয়েছে",
  pushSending: "পাঠানো হচ্ছে…",
  pushQueued: "সারিতে আছে",
  pushDraft: "খসড়া",
  pushFailed: "ব্যর্থ",
  pushPartial: "আংশিক পাঠানো হয়েছে",
  pushTest: "টেস্ট",
  // ---- ab7.ts: abandoned sequence status ----
  seqRunning: "চলমান",
  seqCompleted: "সম্পন্ন",
  seqFailed: "ব্যর্থ",
  seqWaiting: "অপেক্ষমাণ",
  seqSent: "পাঠানো হয়েছে",
  seqSkipped: "বাদ দেওয়া হয়েছে",
  seqCancelled: "বন্ধ করা হয়েছে",
  // ---- ab7.ts: inventory demand basis + landing significance ----
  basisTrendSeasonal: "ট্রেন্ড+সিজনাল",
  basisVelocity: "গতি-ভিত্তিক",
  variantInsufficient: "পর্যাপ্ত ডেটা নেই",
  variantSignificant: "তাৎপর্যপূর্ণ",

  // ---- loyalty.ts: ledger reason + note labels ----
  loyReasonEarn: "পয়েন্ট অর্জন",
  loyReasonRedeem: "পয়েন্ট খরচ",
  loyReasonExpire: "মেয়াদ উত্তীর্ণ",
  loyReasonAdjust: "সমন্বয়",
  loyReasonReferral: "রেফারেল পুরস্কার",
  loyNoteRedeemReversal: "অর্ডার বাতিলে ফেরত",
  loyNoteEarnClawback: "রিফান্ডে কর্তন",
  loyNoteReferralClawback: "রেফারেল পুরস্কারে কর্তন",

  // ---- email-blocks.ts: block type labels ----
  ebText: "📝 লেখা",
  ebImage: "🖼️ ছবি",
  ebButton: "🔘 বাটন",
  ebProduct: "🛍️ পণ্য",
  ebCoupon: "🎟️ কুপন",
  ebDivider: "➖ বিভাজক",
};

export const sharedEn: typeof sharedBn = {
  // ---- global-assistant.ts ----
  gaSugSales7d: "How were sales in the last 7 days?",
  gaSugBestCampaigns: "Which are my best campaigns?",
  gaSugAnomaly: "Has anything unusual happened?",
  gaSugOrderFollowUp: "Which orders need follow-up?",
  gaSugCourierPerf: "How are the couriers performing?",
  gaSugProfitProduct: "Which product is the most profitable?",
  gaSugSegments: "Show me the customer segments",
  gaSugStock: "How is the stock looking?",
  gaSugBestMargin: "Which products have the best margin?",
  gaPageFallback: "Dashboard",

  // ---- org-switcher.ts ----
  orgBadgeSuspended: "Suspended",
  orgBadgeArchived: "Archived",
  roleOwner: "Owner",
  roleAdmin: "Admin",
  roleMarketingManager: "Marketing Manager",
  roleAdvertiser: "Advertiser",
  roleSupportAgent: "Support Agent",
  roleAnalyst: "Analyst",
  roleViewer: "View only",
  roleSuperAdmin: "Super Admin",

  // ---- agency-nf15.ts ----
  agCommissionRecords:
    "Commissions are kept here as records only — no money is deducted or sent automatically. Payouts are closed under the OU11 legal gate.",
  agSummaryError: "Data could not be loaded",
  agTotalsBanner: "Total for the listed organizations only ({count})",
  agRoleOwner: "Owner (OWNER)",
  agRoleAdmin: "Admin (ADMIN)",
  agRoleMarketingManager: "Marketing Manager",
  agRoleAdvertiser: "Advertiser",
  agRoleSupportAgent: "Support Agent",
  agRoleAnalyst: "Analyst",
  agRoleViewer: "Viewer (VIEWER)",

  // ---- personas.ts ----
  personaGeneral: "General Assistant",
  personaAdsAnalyst: "Ads Analyst",
  personaInboxCoach: "Inbox Coach",
  personaFinanceAnalyst: "Finance Analyst",

  // ---- ab8.ts: merchant API scopes ----
  scopeProductsRead: "Read products (products:read)",
  scopeProductsWrite: "Write/edit products (products:write)",
  scopeOrdersRead: "Read orders (orders:read)",
  scopeCustomersRead: "Read customers (customers:read)",
  // ---- ab8.ts: API key status + validation ----
  keyStatusActive: "Active",
  keyStatusRevoked: "Revoked",
  keyNameRequired: "Enter a name for the key.",
  keyNameTooLong: "The key name can be at most 80 characters.",
  keyScopeRequired: "Select at least one scope.",
  keyScopeInvalid: "One of the scopes is not valid.",
  // ---- ab8.ts: data exports ----
  exportKindManual: "Manual",
  exportKindBackup: "Automatic backup",
  exportStatusPending: "Preparing…",
  exportStatusReady: "Ready",
  exportStatusFailed: "Failed",
  exportStatusExpired: "Expired",
  sizeUnitByte: "Bytes",
  // ---- ab8.ts: import tables ----
  tblOrganization: "Organization",
  tblBusinessProfile: "Business profile",
  tblMembers: "Members",
  tblProducts: "Products",
  tblOrders: "Orders",
  tblCustomers: "Customers",
  tblLeads: "Leads",
  tblConversations: "Conversations",
  tblCampaignPlans: "Campaign plans",
  tblIntegrations: "Connections",
  tblSubscription: "Subscription",
  tblPayments: "Payments",
  tblSupportTickets: "Support tickets",
  tblOrderItems: "Order items",
  tblMediaAssets: "Media files",
  // ---- ab8.ts: import skip reasons ----
  skipTargetIdentity: "This organization's own identity will be kept",
  skipPeopleNotRestored: "Memberships and users are not restored",
  skipBillingState: "Billing state is not transferred",
  skipBillingLedger: "The billing ledger is not transferred",
  skipConnectionsNotRestored: "Connections are not in the credential bundle",
  skipTranscriptsNotInBundle: "Messages are not in the bundle",
  skipAdChildrenNotInBundle: "Ad details are not in the bundle",
  skipMessagesNotInBundle: "Ticket messages are not in the bundle",
  skipBytesNotInBundle: "File bytes are not in the bundle, only the metadata is kept",
  // ---- ab8.ts: import errors + job status ----
  impErrTargetNotEmpty:
    "This organization is not empty — imports can only be made into a brand-new, empty organization.",
  impErrBundleNotObject: "The file is not in the correct bundle format.",
  impErrRowCapExceeded:
    "The bundle is too large for this method — it exceeds the total restored-rows limit.",
  impErrCredentialField:
    "The bundle contains credential-like information — the whole bundle has been rejected for security reasons.",
  impErrSourceTruncated:
    "The source export was incomplete (some data was cut off) — an incomplete bundle is not restored.",
  impErrDataInconsistent:
    "There is an inconsistency in the data inside the bundle — the file may have been changed or corrupted.",
  jobStatusRunning: "Running…",
  jobStatusCompleted: "Completed",
  jobStatusFailed: "Failed",

  // ---- connect-forms.ts ----
  cfConnectedBot: "Connected: {bot}",
  cfReconnectedBot: "Reconnected (the same bot's row was updated): {bot}",
  cfWebhookRegistered: "Registered ✅",
  cfWebhookFailed: "Not registered — {error}",
  cfConnectedMailbox: "Connected: {mailbox}",
  cfReconnectedMailbox:
    "Reconnected (the same mailbox's row was updated): {mailbox}",

  // ---- workflow-graph.ts: step type labels ----
  stepSendEmail: "Send email",
  stepSendSms: "Send SMS",
  stepAddLeadActivity: "Add a note to the lead",
  stepAddConversationNote: "Internal note on the conversation",
  stepWait: "Wait",
  stepCondition: "Condition (branch)",
  stepSendInboxMessage: "Send an inbox message",
  stepAssignConversation: "Assign conversation",
  stepChangeLeadStage: "Change lead stage",
  stepAddTag: "Add tag",
  stepNotifyTeam: "Notify the team",
  stepCreateFollowUp: "Create follow-up",
  stepHttpWebhook: "Send webhook",
  stepBranch: "Branch (if / else)",
  stepNotifyChannel: "Channel alert (Slack/Discord)",
  stepAiGenerate: "AI text / note generation",
  stepUnknown: "Unknown step (locked)",
  // ---- workflow-graph.ts: structural errors ----
  graphErrMultiplePaths: "More than one path leaves a single step ({source})",
  graphErrNotConnectedToEnd:
    "The flow is not connected through to the End step — a link in the middle is broken",
  graphErrUnknownTarget: "A connection goes to an unknown step ({target})",
  graphErrWrongTarget: "A connection goes to the wrong place",
  graphErrCycle: "The flow contains a cycle",
  graphErrOrphanSteps:
    "Some steps are not connected to the main flow — connect all steps in one line, or delete the steps you do not need",
  // ---- workflow-graph.ts: step summaries ----
  wgWaitSummary: "Wait {minutes} minutes",
  wgTemplateSet: "Template set",
  wgTemplateNotSet: "No template selected",
  wgMessageEmpty: "Message is empty",
  wgNoteEmpty: "Note is empty",
  wgBranchSummary: "{cond} · ✓ {thenCount} steps / ✗ {elseCount} steps",
  wgChannelAlertText: "Channel alert: {text}",
  wgChannelAlert: "Channel alert",
  wgAiStep: "AI assistant step",
  wgLockedStep: "Cannot be changed on the canvas — it will stay exactly as it is",

  // ---- ab7.ts ----
  pushSent: "Sent",
  pushSending: "Sending…",
  pushQueued: "Queued",
  pushDraft: "Draft",
  pushFailed: "Failed",
  pushPartial: "Partially sent",
  pushTest: "Test",
  seqRunning: "Running",
  seqCompleted: "Completed",
  seqFailed: "Failed",
  seqWaiting: "Waiting",
  seqSent: "Sent",
  seqSkipped: "Skipped",
  seqCancelled: "Stopped",
  basisTrendSeasonal: "Trend + seasonal",
  basisVelocity: "Velocity-based",
  variantInsufficient: "Not enough data",
  variantSignificant: "Significant",

  // ---- loyalty.ts ----
  loyReasonEarn: "Points earned",
  loyReasonRedeem: "Points redeemed",
  loyReasonExpire: "Expired",
  loyReasonAdjust: "Adjustment",
  loyReasonReferral: "Referral reward",
  loyNoteRedeemReversal: "Returned on order cancellation",
  loyNoteEarnClawback: "Deducted on refund",
  loyNoteReferralClawback: "Deducted from referral reward",

  // ---- email-blocks.ts ----
  ebText: "📝 Text",
  ebImage: "🖼️ Image",
  ebButton: "🔘 Button",
  ebProduct: "🛍️ Product",
  ebCoupon: "🎟️ Coupon",
  ebDivider: "➖ Divider",
};
