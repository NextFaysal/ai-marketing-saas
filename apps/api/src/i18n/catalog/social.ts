/**
 * MB4 (ML10) — social catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the social module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const socialCatalog: CatalogNamespace = {
  "social.theAiReturnedNoUsableCarousel": {
    bn: "AI কোনো ব্যবহারযোগ্য carousel outline দেয়নি — আবার চেষ্টা করুন।",
    en: "The AI returned no usable carousel outline — please try again.",
  },
  "social.theAiReturnedNoUsablePlan": {
    bn: "AI কোনো ব্যবহারযোগ্য plan item দেয়নি — আবার চেষ্টা করুন।",
    en: "The AI returned no usable plan item — please try again.",
  },
  "social.theAiReturnedNoUsableScript": {
    bn: "AI কোনো ব্যবহারযোগ্য script দেয়নি — আবার চেষ্টা করুন।",
    en: "The AI returned no usable script — please try again.",
  },
  "social.theAiReturnedNoUsableVariant": {
    bn: "AI কোনো ব্যবহারযোগ্য variant দেয়নি — আবার চেষ্টা করুন।",
    en: "The AI returned no usable variant — please try again.",
  },
  "social.theAiReturnedNoUsableTranslation": {
    bn: "AI কোনো ব্যবহারযোগ্য অনুবাদ দেয়নি — আবার চেষ্টা করুন।",
    en: "The AI returned no usable translation — please try again.",
  },
  "social.theAiImageGenerationProviderIs": {
    bn: "AI ছবি তৈরির provider configure করা নেই — Admin Panel থেকে সেট করুন, অথবা Template Poster ব্যবহার করুন",
    en: "The AI image generation provider is not configured — set it from the Admin Panel, or use the Template Poster",
  },
  "social.aBotTokenIsRequiredCreate": {
    bn: "Bot Token প্রয়োজন — Telegram-এ @BotFather দিয়ে একটি Bot বানিয়ে তার Token-টি দিন।",
    en: "A Bot Token is required — create a Bot with @BotFather on Telegram and give its Token.",
  },
  "social.botVerificationFailedCheckWhetherThe": {
    bn: "Bot যাচাই ব্যর্থ হয়েছে — Token-টি সঠিক কিনা দেখুন। Telegram-এর বার্তা: {{p1}}",
    en: "Bot verification failed — check whether the Token is correct. Telegram's message: {{p1}}",
  },
  "social.theBotSChannelMembershipCould": {
    bn: "Bot-এর Channel-সদস্যতা যাচাই করা যায়নি। Telegram-এর বার্তা: {{p1}}",
    en: "The Bot's Channel membership could not be verified. Telegram's message: {{p1}}",
  },
  "social.theBotIsAnAdminBut": {
    bn: "Bot-টি Admin হলেও Channel-এ পোস্ট করার অনুমতি (Post Messages) বন্ধ আছে — Channel-এর Admin সেটিংসে Bot-এর 'Post Messages' অনুমতি চালু করুন, তারপর আবার চেষ্টা করুন।",
    en: "The Bot is an Admin but its permission to post in the Channel (Post Messages) is off — turn on the Bot's 'Post Messages' permission in the Channel's Admin settings, then try again.",
  },
  "social.theBotIsNotAnAdmin": {
    bn: "Bot-টি এই Channel-এর Admin নয় (বর্তমান অবস্থা: {{p1}}) — Channel Settings → Administrators-এ Bot-টিকে Admin করুন, তারপর আবার চেষ্টা করুন।",
    en: "The Bot is not an Admin of this Channel (current status: {{p1}}) — make the Bot an Admin in Channel Settings → Administrators, then try again.",
  },
  "social.brandOverlayCanOnlyBePlaced": {
    bn: "Brand overlay শুধু ছবিতে বসানো যায় — ভিডিওতে overlay এই মুহূর্তে নেই।",
    en: "Brand overlay can only be placed on images — overlay is not available on videos at the moment.",
  },
  "social.theCsvFileIsTooLarge": {
    bn: "CSV ফাইলটি অনেক বড় — সর্বোচ্চ ৫ MB-এর মধ্যে রাখুন।",
    en: "The CSV file is too large — keep it within 5 MB.",
  },
  "social.thereMustBeACaptionColumn": {
    bn: "CSV-তে caption কলাম থাকতে হবে — প্রথম সারিতে caption,accountId,linkUrl,scheduledAt হেডার দিন।",
    en: "There must be a caption column in the CSV — give the header caption,accountId,linkUrl,scheduledAt in the first row.",
  },
  "social.thereIsNoDataRowIn": {
    bn: "CSV-তে কোনো ডেটা সারি নেই — অন্তত একটি পোস্টের সারি দিন।",
    en: "There is no data row in the CSV — give at least one post row.",
  },
  "social.aCaptionTestCanOnlyBe": {
    bn: "Caption Test শুধু Draft পোস্ট থেকে তৈরি করা যায়।",
    en: "A Caption Test can only be created from a Draft post.",
  },
  "social.theCaptionTestPairIsAlready": {
    bn: "Caption Test-এর জোড়া ইতিমধ্যে পূর্ণ — একটি টেস্টে সর্বোচ্চ দুটি পোস্ট থাকে।",
    en: "The Caption Test pair is already full — a test holds at most two posts.",
  },
  "social.writeACaption": {
    bn: "Caption লিখুন।",
    en: "Write a Caption.",
  },
  "social.channelNotFoundCheckWhetherThe": {
    bn: "Channel পাওয়া যায়নি — Username/ID সঠিক কিনা এবং Bot-টি Channel-এ যোগ করা হয়েছে কিনা দেখুন। Telegram-এর বার্তা: {{p1}}",
    en: "Channel not found — check whether the Username/ID is correct and whether the Bot has been added to the Channel. Telegram's message: {{p1}}",
  },
  "social.theChannelSelectionLinkHasAlready": {
    bn: "Channel বেছে নেওয়ার লিংকটি ইতিমধ্যে ব্যবহৃত হয়েছে — Social Posts পেজে অ্যাকাউন্টটি যুক্ত হয়েছে কিনা দেখুন, না হলে আবার Connect করুন।",
    en: "The channel selection link has already been used — check whether the account has been added on the Social Posts page, otherwise Connect again.",
  },
  "social.theChannelSelectionLinkHasExpired": {
    bn: "Channel বেছে নেওয়ার লিংকটি মেয়াদোত্তীর্ণ বা অবৈধ — YouTube Connect আবার শুরু করুন।",
    en: "The channel selection link has expired or is invalid — start YouTube Connect again.",
  },
  "social.aChannelUsernameEGMychannel": {
    bn: "Channel-এর Username (যেমন @mychannel) অথবা numeric Chat ID প্রয়োজন।",
    en: "A Channel Username (e.g. @mychannel) or numeric Chat ID is required.",
  },
  "social.theConnectInformationCouldNotBe": {
    bn: "Connect-এর তথ্য পড়া যাচ্ছে না — Google Business Profile Connect আবার শুরু করুন।",
    en: "The Connect information could not be read — start Google Business Profile Connect again.",
  },
  "social.theConnectInformationCouldNotBe2": {
    bn: "Connect-এর তথ্য পড়া যাচ্ছে না — LinkedIn Connect আবার শুরু করুন।",
    en: "The Connect information could not be read — start LinkedIn Connect again.",
  },
  "social.theConnectInformationCouldNotBe3": {
    bn: "Connect-এর তথ্য পড়া যাচ্ছে না — YouTube Connect আবার শুরু করুন।",
    en: "The Connect information could not be read — start YouTube Connect again.",
  },
  "social.contentPlanNotFoundInThis": {
    bn: "এই organization-এ content plan পাওয়া যায়নি",
    en: "Content plan not found in this organization",
  },
  "social.aLogoIsNeededForA": {
    bn: "Corner overlay-এর জন্য একটি Logo লাগবে — Branding-এ logo আপলোড করুন অথবা Library থেকে একটি logo ছবি বেছে দিন, না হলে উপরে/নিচে bar বেছে নিন।",
    en: "A Logo is needed for a corner overlay — upload a logo in Branding or choose a logo image from the Library, otherwise pick the top/bottom bar.",
  },
  "social.couldNotListMetaPages": {
    bn: "Meta pages তালিকা করা যায়নি: {{p1}}",
    en: "Could not list Meta pages: {{p1}}",
  },
  "social.dailyAiGenerationLimitReachedFor": {
    bn: "এই organization-এর জন্য daily AI generation limit পূর্ণ হয়েছে ({{limit}})।",
    en: "Daily AI generation limit reached for this organization ({{limit}}).",
  },
  "social.dailyAiGenerationLimitReachedFor2": {
    bn: "এই organization-এর জন্য daily AI generation limit পূর্ণ হয়েছে ({{limit}})। আগামীকাল আবার চেষ্টা করুন অথবা platform team-কে আপনার plan limit বাড়াতে বলুন।",
    en: "Daily AI generation limit reached for this organization ({{limit}}). Try again tomorrow or ask the platform team to raise your plan limit.",
  },
  "social.groupVariant": {
    bn: "Group-এ অন্তত একটি Variant দিতে হবে।",
    en: "Group-এ অন্তত একটি Variant দিতে হবে।",
  },
  "social.group": {
    bn: "Group-এর নাম দিন।",
    en: "Group-এর নাম দিন।",
  },
  "social.hashtagSetNotFoundInThis": {
    bn: "এই organization-এ hashtag set পাওয়া যায়নি",
    en: "Hashtag set not found in this organization",
  },
  "social.headline": {
    bn: "Headline সর্বোচ্চ ১২০ অক্ষরের হতে পারবে।",
    en: "Headline সর্বোচ্চ ১২০ অক্ষরের হতে পারবে।",
  },
  "social.importUrl": {
    bn: "Import করার ফাইলের URL পাওয়া যায়নি।",
    en: "Import করার ফাইলের URL পাওয়া যায়নি।",
  },
  "social.learnedItemNotFoundInThis": {
    bn: "এই organization-এ learned item পাওয়া যায়নি",
    en: "Learned item not found in this organization",
  },
  "social.linkNotFound": {
    bn: "Link পাওয়া যায়নি",
    en: "Link not found",
  },
  "social.locationSocialPostsConnect": {
    bn: "Location বেছে নেওয়ার লিংকটি ইতিমধ্যে ব্যবহৃত হয়েছে — Social Posts পেজে অ্যাকাউন্টটি যুক্ত হয়েছে কিনা দেখুন, না হলে আবার Connect করুন।",
    en: "Location বেছে নেওয়ার লিংকটি ইতিমধ্যে ব্যবহৃত হয়েছে — Social Posts পেজে অ্যাকাউন্টটি যুক্ত হয়েছে কিনা দেখুন, না হলে আবার Connect করুন।",
  },
  "social.locationGoogleBusinessProfileConnect": {
    bn: "Location বেছে নেওয়ার লিংকটি মেয়াদোত্তীর্ণ বা অবৈধ — Google Business Profile Connect আবার শুরু করুন।",
    en: "Location বেছে নেওয়ার লিংকটি মেয়াদোত্তীর্ণ বা অবৈধ — Google Business Profile Connect আবার শুরু করুন।",
  },
  "social.logoBytesStorage": {
    bn: "Logo ছবির bytes storage-এ পাওয়া যায়নি",
    en: "Logo ছবির bytes storage-এ পাওয়া যায়নি",
  },
  "social.logoImageAsset": {
    bn: "Logo হিসেবে একটি ছবি (image) asset বেছে নিন।",
    en: "Logo হিসেবে একটি ছবি (image) asset বেছে নিন।",
  },
  "social.materializeDeployment": {
    bn: "Materialize এই deployment-এ উপলব্ধ নয় — পরে আবার চেষ্টা করুন।",
    en: "Materialize এই deployment-এ উপলব্ধ নয় — পরে আবার চেষ্টা করুন।",
  },
  "social.mediaAssetNotFoundInThis": {
    bn: "এই organization-এ media asset পাওয়া যায়নি",
    en: "Media asset not found in this organization",
  },
  "social.mediaBytesNotFoundInStorage": {
    bn: "Media bytes storage-এ পাওয়া যায়নি",
    en: "Media bytes not found in storage",
  },
  "social.mediaFolderNotFoundInThis": {
    bn: "এই organization-এ media folder পাওয়া যায়নি",
    en: "Media folder not found in this organization",
  },
  "social.mediaNotFound": {
    bn: "Media পাওয়া যায়নি",
    en: "Media not found",
  },
  "social.metaTokenVerificationFailed": {
    bn: "Meta token verification ব্যর্থ হয়েছে: {{p1}}",
    en: "Meta token verification failed: {{p1}}",
  },
  "social.pageConnect": {
    bn: "Page বেছে নেওয়ার লিংকটি ইতিমধ্যে ব্যবহৃত হয়েছে — কানেক্ট সেন্টারে অ্যাকাউন্টটি যুক্ত হয়েছে কিনা দেখুন, না হলে আবার Connect করুন।",
    en: "Page বেছে নেওয়ার লিংকটি ইতিমধ্যে ব্যবহৃত হয়েছে — কানেক্ট সেন্টারে অ্যাকাউন্টটি যুক্ত হয়েছে কিনা দেখুন, না হলে আবার Connect করুন।",
  },
  "social.pageLinkedinConnect": {
    bn: "Page বেছে নেওয়ার লিংকটি মেয়াদোত্তীর্ণ বা অবৈধ — LinkedIn Connect আবার শুরু করুন।",
    en: "Page বেছে নেওয়ার লিংকটি মেয়াদোত্তীর্ণ বা অবৈধ — LinkedIn Connect আবার শুরু করুন।",
  },
  "social.pexelsApiKey": {
    bn: "Pexels API key দিন।",
    en: "Pexels API key দিন।",
  },
  "social.pexelsRequestFailedHttp": {
    bn: "Pexels অনুরোধ ব্যর্থ হয়েছে (HTTP {{status}}){{p2}}",
    en: "Pexels request failed (HTTP {{status}}){{p2}}",
  },
  "social.pexelsDidNotGiveADownloadable": {
    bn: "Pexels এই item-এর ডাউনলোডযোগ্য ফাইল দেয়নি — অন্য একটি item বেছে নিন।",
    en: "Pexels did not give a downloadable file for this item — choose another item.",
  },
  "social.pexelsRespondedInAWayThat": {
    bn: "Pexels এমন উত্তর দিয়েছে যা পড়া যাচ্ছে না — আবার চেষ্টা করুন।",
    en: "Pexels responded in a way that could not be read — please try again.",
  },
  "social.couldNotConnectToPexels": {
    bn: "Pexels-এ সংযোগ করা যায়নি: {{p1}}",
    en: "Could not connect to Pexels: {{p1}}",
  },
  "social.aPlaylistIsOnlyForYoutube": {
    bn: "Playlist শুধু YouTube অ্যাকাউন্টের জন্য — এই অ্যাকাউন্টটি YouTube চ্যানেল নয়।",
    en: "A Playlist is only for YouTube accounts — this account is not a YouTube channel.",
  },
  "social.posterHeadline": {
    bn: "Poster-এর Headline দিন।",
    en: "Poster-এর Headline দিন।",
  },
  "social.postingSlotNotFoundInThis": {
    bn: "এই organization-এ posting slot পাওয়া যায়নি",
    en: "Posting slot not found in this organization",
  },
  "social.productNotFoundInThisOrganization": {
    bn: "এই organization-এ product পাওয়া যায়নি",
    en: "Product not found in this organization",
  },
  "social.productTopic": {
    bn: "Product বেছে নিন অথবা একটা বিষয় (Topic) লিখুন।",
    en: "Product বেছে নিন অথবা একটা বিষয় (Topic) লিখুন।",
  },
  "social.theProviderReturnedDataThatCould": {
    bn: "Provider এমন ডেটা ফেরত দিয়েছে যা ছবি হিসেবে পড়া যাচ্ছে না — Asset তৈরি হয়নি।",
    en: "The provider returned data that could not be read as an image — no Asset was created.",
  },
  "social.theRssFeedUrlIsNot": {
    bn: "RSS Feed URL-টি সঠিক http/https ঠিকানা নয়।",
    en: "The RSS Feed URL is not a valid http/https address.",
  },
  "social.toRescheduleANewDateAnd": {
    bn: "Reschedule করতে হলে নতুন তারিখ ও সময় (scheduledAt) দিতে হবে।",
    en: "To Reschedule, a new date and time (scheduledAt) must be given.",
  },
  "social.set": {
    bn: "Set-এর নাম দিন।",
    en: "Set-এর নাম দিন।",
  },
  "social.set2": {
    bn: "Set-এর নাম সর্বোচ্চ ৮০ অক্ষরের হতে পারবে।",
    en: "Set-এর নাম সর্বোচ্চ ৮০ অক্ষরের হতে পারবে।",
  },
  "social.shareLinkNotFoundInThis": {
    bn: "এই organization-এ share link পাওয়া যায়নি",
    en: "Share link not found in this organization",
  },
  "social.slotHhMm1030": {
    bn: "Slot-এর সময় সঠিক HH:MM আকারে দিন (যেমন 10:30)।",
    en: "Slot-এর সময় সঠিক HH:MM আকারে দিন (যেমন 10:30)।",
  },
  "social.socialAccountNotFoundInThis": {
    bn: "এই organization-এ social account পাওয়া যায়নি",
    en: "Social account not found in this organization",
  },
  "social.socialPostGroupNotFoundIn": {
    bn: "এই organization-এ social post group পাওয়া যায়নি",
    en: "Social post group not found in this organization",
  },
  "social.socialPostNotFoundInThis": {
    bn: "এই organization-এ social post পাওয়া যায়নি",
    en: "Social post not found in this organization",
  },
  "social.socialPostNoteNotFoundIn": {
    bn: "এই organization-এ social post note পাওয়া যায়নি",
    en: "Social post note not found in this organization",
  },
  "social.socialPostVersionNotFoundIn": {
    bn: "এই organization-এ social post version পাওয়া যায়নি",
    en: "Social post version not found in this organization",
  },
  "social.targetLanguageCanOnlyBeBn": {
    bn: "Target language শুধু bn অথবা en হতে পারে।",
    en: "Target language can only be bn or en.",
  },
  "social.templatePosterImageAsset": {
    bn: "Template Poster-এর জন্য একটি ছবি (image) asset লাগবে।",
    en: "Template Poster-এর জন্য একটি ছবি (image) asset লাগবে।",
  },
  "social.templatePoster": {
    bn: "Template Poster-এর জন্য একটি ছবি বেছে নিন।",
    en: "Template Poster-এর জন্য একটি ছবি বেছে নিন।",
  },
  "social.theAiProviderReturnedNoUsable": {
    bn: "AI provider কোনো ব্যবহারযোগ্য caption variant দেয়নি। কিছু সেভ হয়নি।",
    en: "The AI provider returned no usable caption variants. Nothing was saved.",
  },
  "social.theUrlRedirectedHttpButDid": {
    bn: "URL redirect করেছে (HTTP {{status}}) কিন্তু কোথায় যাবে তা জানায়নি — import করা গেল না।",
    en: "The URL redirected (HTTP {{status}}) but did not say where to go — it could not be imported.",
  },
  "social.theUrlRedirectedTooManyTimes": {
    bn: "URL অনেক বেশিবার redirect করেছে — import করা গেল না।",
    en: "The URL redirected too many times — it could not be imported.",
  },
  "social.theFileCouldNotBeFetched": {
    bn: "URL থেকে ফাইল আনা যায়নি: {{p1}}",
    en: "The file could not be fetched from the URL: {{p1}}",
  },
  "social.noResponseWasReceivedFromThe": {
    bn: "URL থেকে সাড়া পাওয়া যায়নি (HTTP {{status}})।",
    en: "No response was received from the URL (HTTP {{status}}).",
  },
  "social.appsourceMustBePlatformOrOwn": {
    bn: "appSource platform অথবা own হতে হবে",
    en: "appSource must be platform or own",
  },
  "social.learnedItemSourceLearneditemid": {
    bn: "learned_item source-এর জন্য learnedItemId দিন।",
    en: "learned_item source-এর জন্য learnedItemId দিন।",
  },
  "social.linkurlHttpSUrl": {
    bn: "linkUrl সঠিক http(s) URL হতে হবে।",
    en: "linkUrl সঠিক http(s) URL হতে হবে।",
  },
  "social.productSourceProductid": {
    bn: "product source-এর জন্য productId দিন।",
    en: "product source-এর জন্য productId দিন।",
  },
  "social.topicSourceTopic": {
    bn: "topic source-এর জন্য একটা বিষয় (topic) লিখুন।",
    en: "topic source-এর জন্য একটা বিষয় (topic) লিখুন।",
  },
  "social.unknownBulkActionSendDeleteDrafts": {
    bn: "অজানা Bulk কাজ — delete_drafts অথবা reschedule পাঠান।",
    en: "Unknown Bulk action — send delete_drafts or reschedule.",
  },
  "social.theTranslationContainsANumberThat": {
    bn: "অনুবাদে মূল লেখায় নেই এমন সংখ্যা এসেছে — আবার চেষ্টা করুন।",
    en: "The translation contains a number that is not in the original text — please try again.",
  },
  "social.giveTextToTranslate": {
    bn: "অনুবাদের জন্য লেখা (Text) দিন।",
    en: "Give text to translate.",
  },
  "social.chooseAtLeastOneValidPlatform": {
    bn: "অন্তত একটা সঠিক Platform বেছে নিন (meta_page, instagram, tiktok, youtube অথবা linkedin)।",
    en: "Choose at least one valid Platform (meta_page, instagram, tiktok, youtube or linkedin).",
  },
  "social.chooseAtLeastOneTargetAccount": {
    bn: "অন্তত একটি Target অ্যাকাউন্ট বেছে দিন।",
    en: "Choose at least one Target account.",
  },
  "social.onlyAnOwnerAdminCanDelete": {
    bn: "অন্যের নোট শুধু OWNER/ADMIN মুছতে পারেন।",
    en: "Only an OWNER/ADMIN can delete someone else's note.",
  },
  "social.invalidPostStatus": {
    bn: "অবৈধ পোস্ট status: {{queryStatus}}",
    en: "Invalid post status: {{queryStatus}}",
  },
  "social.unsupportedAspectRatio": {
    bn: "অসমর্থিত aspect ratio: {{aspect}}",
    en: "Unsupported aspect ratio: {{aspect}}",
  },
  "social.noFreePostingSlotWasFound": {
    bn: "আগামী এক বছরের মধ্যে কোনো খালি Posting Slot পাওয়া যায়নি — Slot বাড়িয়ে আবার চেষ্টা করুন।",
    en: "No free Posting Slot was found within the next year — increase the Slots and try again.",
  },
  "social.addYourOwnPexelsApiKey": {
    bn: "আগে নিজের Pexels API key যোগ করুন — Library-র Stock অংশে key দিলে তবেই stock ছবি/ভিডিও খোঁজা যাবে।",
    en: "Add your own Pexels API key first — stock images/videos can only be searched once the key is given in the Stock section of the Library.",
  },
  "social.giveYourNameAReviewCannot": {
    bn: "আপনার নাম দিন — নাম ছাড়া রিভিউ গ্রহণ করা যাবে না।",
    en: "Give your name — a review cannot be accepted without a name.",
  },
  "social.realAiLlmIsNotConfigured": {
    bn: "আসল AI (LLM) configure করা নেই — Carousel Outline বানাতে Admin Panel → Platform Config-এ LLM সেট করুন। Dev template দিয়ে outline বানানো হবে না।",
    en: "Real AI (LLM) is not configured — set the LLM in Admin Panel → Platform Config to build a Carousel Outline. The outline will not be made with the dev template.",
  },
  "social.realAiLlmIsNotConfigured2": {
    bn: "আসল AI (LLM) configure করা নেই — Content Plan বানাতে Admin Panel → Platform Config-এ LLM সেট করুন। Dev template দিয়ে মাসের plan বানানো হবে না।",
    en: "Real AI (LLM) is not configured — set the LLM in Admin Panel → Platform Config to build a Content Plan. The month's plan will not be made with the dev template.",
  },
  "social.realAiLlmIsNotConfigured3": {
    bn: "আসল AI (LLM) configure করা নেই — Platform Variant বানাতে Admin Panel → Platform Config-এ LLM সেট করুন। Dev template দিয়ে variant বানানো হবে না।",
    en: "Real AI (LLM) is not configured — set the LLM in Admin Panel → Platform Config to build a Platform Variant. The variant will not be made with the dev template.",
  },
  "social.realAiLlmIsNotConfigured4": {
    bn: "আসল AI (LLM) configure করা নেই — Script বানাতে Admin Panel → Platform Config-এ LLM সেট করুন। Dev template দিয়ে script বানানো হবে না।",
    en: "Real AI (LLM) is not configured — set the LLM in Admin Panel → Platform Config to build a Script. The script will not be made with the dev template.",
  },
  "social.realAiLlmIsNotConfigured5": {
    bn: "আসল AI (LLM) configure করা নেই — অনুবাদ করতে Admin Panel → Platform Config-এ LLM সেট করুন। Dev template দিয়ে অনুবাদ করা হবে না।",
    en: "Real AI (LLM) is not configured — set the LLM in Admin Panel → Platform Config to translate. Translation will not be done with the dev template.",
  },
  "social.postApprovalIsNotEnabledIn": {
    bn: "এই Organization-এ পোস্ট অনুমোদন ব্যবস্থা চালু নেই — চালু করতে Social Posts পেজের সেটিংসে যান।",
    en: "Post approval is not enabled in this Organization — enable it from the Social Posts page settings.",
  },
  "social.thisProductHasNoImageUrl": {
    bn: "এই Product-এর কোনো ছবির URL নেই — আগে Product-এ ছবির URL (imageUrl) যোগ করুন, তারপর import করুন।",
    en: "This Product has no image URL — add an image URL (imageUrl) to the Product first, then import.",
  },
  "social.noImageWasFoundAtThis": {
    bn: "এই URL থেকে ছবি পাওয়া যায়নি — পাওয়া গেছে {{what}}। শুধু PNG/JPEG/GIF/WebP ছবি import করা যায়।",
    en: "No image was found at this URL — got {{what}}. Only PNG/JPEG/GIF/WebP images can be imported.",
  },
  "social.noImageVideoWasFoundAt": {
    bn: "এই URL থেকে ছবি/ভিডিও পাওয়া যায়নি — পাওয়া গেছে {{what}}।",
    en: "No image/video was found at this URL — got {{what}}.",
  },
  "social.thePostCannotBeQueuedIn": {
    bn: "এই অবস্থায় পোস্টটি Queue-তে দেওয়া যাবে না (বর্তমান অবস্থা: {{postStatus}})।",
    en: "The post cannot be queued in this state (current status: {{postStatus}}).",
  },
  "social.thePostCannotBeScheduledIn": {
    bn: "এই অবস্থায় পোস্টটি শিডিউল করা যাবে না (বর্তমান অবস্থা: {{fromStatus}})।",
    en: "The post cannot be scheduled in this state (current status: {{fromStatus}}).",
  },
  "social.aSlotAlreadyExistsForThis": {
    bn: "এই অ্যাকাউন্টে ওই দিন ও সময়ে একটি Slot আগেই আছে।",
    en: "A Slot already exists for this account on that day and time.",
  },
  "social.thereIsNoPostingSlotFor": {
    bn: "এই অ্যাকাউন্টের জন্য কোনো Posting Slot নেই — আগে Slot যোগ করুন",
    en: "There is no Posting Slot for this account — add a Slot first",
  },
  "social.aHashtagSetWithThisName": {
    bn: "এই নামে একটি Hashtag Set আগেই আছে।",
    en: "A Hashtag Set with this name already exists.",
  },
  "social.aFolderWithThisNameAlready": {
    bn: "এই নামে একটি ফোল্ডার আগেই আছে।",
    en: "A folder with this name already exists.",
  },
  "social.filesOnThisPathCanBe": {
    bn: "এই পথে ফাইলের আকার সর্বোচ্চ {{p1}} হতে পারবে — বড় ভিডিওর জন্য ফাইল আপলোড ব্যবহার করুন।",
    en: "Files on this path can be at most {{p1}} in size — use file upload for large videos.",
  },
  "social.thisPostIsNotCoveredBy": {
    bn: "এই পোস্টটি এই শেয়ার লিংকের আওতায় নেই — এই লিংক দিয়ে ওই পোস্টে রিভিউ দেওয়া যাবে না।",
    en: "This post is not covered by this share link — a review cannot be given on that post with this link.",
  },
  "social.thisPostCannotBePublishedNow": {
    bn: "এই পোস্টটি এখন প্রকাশ করা যাবে না — এটি ইতিমধ্যে প্রকাশিত/প্রকাশ হচ্ছে/বাতিল অবস্থায় আছে।",
    en: "This post cannot be published now — it is already published/publishing/cancelled.",
  },
  "social.thisShareLinkHasBeenRevoked": {
    bn: "এই শেয়ার লিংকটি বাতিল করা হয়েছে — এটি আর কাজ করবে না। নতুন লিংকের জন্য পাঠানো দলের সঙ্গে যোগাযোগ করুন।",
    en: "This share link has been revoked — it will no longer work. Contact the sending team for a new link.",
  },
  "social.thisShareLinkHasExpiredContact": {
    bn: "এই শেয়ার লিংকটির মেয়াদ শেষ হয়ে গেছে। নতুন লিংকের জন্য পাঠানো দলের সঙ্গে যোগাযোগ করুন।",
    en: "This share link has expired. Contact the sending team for a new link.",
  },
  "social.ffmpegWasNotFoundOnThis": {
    bn: "এই সার্ভারে ffmpeg পাওয়া যায়নি — ভিডিও থেকে cover তোলা এখন সম্ভব নয়। Server-এ ffmpeg install থাকলে এই feature কাজ করবে।",
    en: "ffmpeg was not found on this server — taking a cover from a video is not possible now. This feature will work if ffmpeg is installed on the Server.",
  },
  "social.youHaveNotBeenGivenPermission": {
    bn: "এই সোশ্যাল অ্যাকাউন্টে পোস্ট করার অনুমতি আপনাকে দেওয়া হয়নি — Connect Center-এর অ্যাক্সেস সেটিংস দেখুন বা OWNER/ADMIN-কে বলুন।",
    en: "You have not been given permission to post on this social account — see the access settings in the Connect Center or ask an OWNER/ADMIN.",
  },
  "social.writeATopic": {
    bn: "একটা বিষয় (Topic) লিখুন।",
    en: "Write a topic.",
  },
  "social.aHashtagCanBeAtMost": {
    bn: "একটি Hashtag সর্বোচ্চ ১০০ অক্ষরের হতে পারবে।",
    en: "A Hashtag can be at most 100 characters.",
  },
  "social.aSetCanHoldAtMost": {
    bn: "একটি Set-এ সর্বোচ্চ ৩০টি Hashtag রাখা যায়।",
    en: "A Set can hold at most 30 Hashtags.",
  },
  "social.bulkActionsCanBeAppliedTo": {
    bn: "একবারে সর্বোচ্চ ১০০টি পোস্টে Bulk কাজ করা যায়।",
    en: "Bulk actions can be applied to at most 100 posts at a time.",
  },
  "social.atMost200RowsCanBe": {
    bn: "একবারে সর্বোচ্চ ২০০টি সারি Import করা যায়।",
    en: "At most 200 rows can be Imported at a time.",
  },
  "social.thisIsNotAChannelType": {
    bn: "এটি একটি Channel নয় (ধরন: {{p1}}) — Telegram পোস্টিং এই সংস্করণে শুধু Channel-এ হয়। Channel-এর Username/ID দিন।",
    en: "This is not a Channel (type: {{p1}}) — Telegram posting in this version happens only in Channels. Give the Channel's Username/ID.",
  },
  "social.sayWhichPostThisReviewIs": {
    bn: "কোন পোস্টের রিভিউ তা জানাতে হবে (postId আবশ্যক)।",
    en: "Say which post this review is for (postId is required).",
  },
  "social.noPageHasBeenSelectedChoose": {
    bn: "কোনো Page নির্বাচন করা হয়নি — অন্তত একটি Page বেছে নিন।",
    en: "No Page has been selected — choose at least one Page.",
  },
  "social.noPostHasBeenSelectedChoose": {
    bn: "কোনো পোস্ট বেছে নেওয়া হয়নি — অন্তত একটি পোস্ট বেছে দিন।",
    en: "No post has been selected — choose at least one post.",
  },
  "social.noMediaHasBeenSelected": {
    bn: "কোনো মিডিয়া নির্বাচন করা হয়নি।",
    en: "No media has been selected.",
  },
  "social.thereIsNoActiveProductAdd": {
    bn: "কোনো সক্রিয় Product নেই — আগে Product যোগ করুন অথবা একটা Focus লিখুন।",
    en: "There is no active Product — add a Product first or write a Focus.",
  },
  "social.theCaptionCannotBeLeftEmpty": {
    bn: "ক্যাপশন খালি রাখা যাবে না।",
    en: "The caption cannot be left empty.",
  },
  "social.theImageVideoDataIsNot": {
    bn: "ছবি/ভিডিওর ডেটা সঠিক base64 নয় — আবার আপলোড করে চেষ্টা করুন।",
    en: "The image/video data is not valid base64 — upload again and try.",
  },
  "social.theImageIsTooLargeImages": {
    bn: "ছবিটি অনেক বড় — সর্বোচ্চ ২.১ MB পর্যন্ত ছবি import করা যাবে।",
    en: "The image is too large — images of at most 2.1 MB can be imported.",
  },
  "social.theImageSizeCouldNotBe": {
    bn: "ছবিটির আকার পড়া যাচ্ছে না — overlay করা গেল না।",
    en: "The image size could not be read — the overlay could not be applied.",
  },
  "social.theImageUrlMustStartWith": {
    bn: "ছবির URL অবশ্যই https:// দিয়ে শুরু হতে হবে — http বা অন্য protocol থেকে import করা যাবে না।",
    en: "The image URL must start with https:// — import from http or other protocols is not allowed.",
  },
  "social.theImageUrlPointsToA": {
    bn: "ছবির URL একটি private/internal ঠিকানায় নির্দেশ করে — নিরাপত্তার কারণে সেখান থেকে ছবি import করা যাবে না।",
    en: "The image URL points to a private/internal address — for security, images cannot be imported from there.",
  },
  "social.noHostWasFoundInThe": {
    bn: "ছবির URL-এ host পাওয়া যায়নি।",
    en: "No host was found in the image URL.",
  },
  "social.theImageUrlCannotContainA": {
    bn: "ছবির URL-এ username/password থাকা যাবে না।",
    en: "The image URL cannot contain a username/password.",
  },
  "social.onlyPort443WorksInThe": {
    bn: "ছবির URL-এ শুধু port 443 চলবে (দেওয়া হয়েছে {{urlPort}})।",
    en: "Only port 443 works in the image URL (given {{urlPort}}).",
  },
  "social.theImageUrlSHostCould": {
    bn: "ছবির URL-এর host ({{hostname}}) খুঁজে পাওয়া যায়নি: {{p2}}",
    en: "The image URL's host ({{hostname}}) could not be found: {{p2}}",
  },
  "social.noAddressWasFoundForThe": {
    bn: "ছবির URL-এর host ({{hostname}})-এর কোনো ঠিকানা পাওয়া যায়নি।",
    en: "No address was found for the image URL's host ({{hostname}}).",
  },
  "social.theImageUrlIsNotA": {
    bn: "ছবির URLটি সঠিক URL নয়: {{rawUrl}}",
    en: "The image URL is not a valid URL: {{rawUrl}}",
  },
  "social.theImageSizeCanBeAt": {
    bn: "ছবির আকার সর্বোচ্চ {{p1}} হতে পারবে।",
    en: "The image size can be at most {{p1}}.",
  },
  "social.giveTheImageDescriptionPrompt": {
    bn: "ছবির বর্ণনা (Prompt) দিন।",
    en: "Give the image description (Prompt).",
  },
  "social.theSelectedChannelIsNotIn": {
    bn: "নির্বাচিত Channelটি এই Connect-এর তালিকায় নেই — তালিকা থেকে একটি Channel বেছে নিন।",
    en: "The selected Channel is not in this Connect's list — choose a Channel from the list.",
  },
  "social.theSelectedLocationIsNotIn": {
    bn: "নির্বাচিত Locationটি এই Connect-এর তালিকায় নেই — তালিকা থেকে একটি Location বেছে নিন।",
    en: "The selected Location is not in this Connect's list — choose a Location from the list.",
  },
  "social.theSelectedPageWasNotFound": {
    bn: "নির্বাচিত Page এই Token-এর অধীনে পাওয়া যায়নি: {{p1}} — Tokenটি ওই Pageগুলোতে Access পায় কিনা যাচাই করুন।",
    en: "The selected Page was not found under this Token: {{p1}} — verify the Token has Access to those Pages.",
  },
  "social.theSelectedPageIsNotIn": {
    bn: "নির্বাচিত Pageটি এই Connect-এর তালিকায় নেই — তালিকা থেকে একটি Page বেছে নিন।",
    en: "The selected Page is not in this Connect's list — choose a Page from the list.",
  },
  "social.theSelectedSocialAccountIsNot": {
    bn: "নির্বাচিত Social অ্যাকাউন্টটি এই Organization-এর সংযুক্ত (connected) অ্যাকাউন্ট নয়।",
    en: "The selected Social account is not a connected account of this Organization.",
  },
  "social.theSelectedMemberIsNotAn": {
    bn: "নির্বাচিত সদস্য এই Organization-এর সক্রিয় সদস্য নন — আগে Team-এ যোগ করুন।",
    en: "The selected member is not an active member of this Organization — add them to the Team first.",
  },
  "social.theNoteCannotBeLeftEmpty": {
    bn: "নোট খালি রাখা যাবে না — কিছু লিখুন।",
    en: "The note cannot be left empty — write something.",
  },
  "social.toGiveARepeatIntervalFirst": {
    bn: "পুনরাবৃত্তির ব্যবধান দিতে হলে আগে পুনরাবৃত্তির ধরন (প্রতিদিন/সাপ্তাহিক/মাসিক) বেছে দিতে হবে।",
    en: "To give a repeat interval, first choose the repeat type (daily/weekly/monthly).",
  },
  "social.thePostIsNotAwaitingApproval": {
    bn: "পোস্টটি অনুমোদনের অপেক্ষায় নেই।",
    en: "The post is not awaiting approval.",
  },
  "social.thePostIsNotApprovedWhen": {
    bn: "পোস্টটি অনুমোদিত নয় — অনুমোদন ব্যবস্থা চালু থাকলে প্রকাশের আগে OWNER/ADMIN-এর অনুমোদন লাগবে। আগে পোস্টটি অনুমোদনের জন্য পাঠান।",
    en: "The post is not approved — when the approval system is on, an OWNER/ADMIN's approval is required before publishing. Submit the post for approval first.",
  },
  "social.thePostIsNotApprovedWhen2": {
    bn: "পোস্টটি অনুমোদিত নয় — অনুমোদন ব্যবস্থা চালু থাকলে শিডিউলের আগে OWNER/ADMIN-এর অনুমোদন লাগবে। আগে পোস্টটি অনুমোদনের জন্য পাঠান।",
    en: "The post is not approved — when the approval system is on, an OWNER/ADMIN's approval is required before scheduling. Submit the post for approval first.",
  },
  "social.thePostIsBeingPublishedBy": {
    bn: "পোস্টটি অন্য একটি প্রক্রিয়ায় প্রকাশ হচ্ছে — কিছুক্ষণ পর আবার চেষ্টা করুন।",
    en: "The post is being published by another process — try again in a little while.",
  },
  "social.thePostIsAlreadyAwaitingApproval": {
    bn: "পোস্টটি ইতিমধ্যে অনুমোদনের অপেক্ষায় আছে।",
    en: "The post is already awaiting approval.",
  },
  "social.thePostIsAlreadyApprovedYou": {
    bn: "পোস্টটি ইতিমধ্যে অনুমোদিত — শিডিউল বা প্রকাশ করতে পারেন।",
    en: "The post is already approved — you can schedule or publish it.",
  },
  "social.thePostWasApprovedInThe": {
    bn: "পোস্টটি প্রথম ধাপে অনুমোদিত হয়ে চূড়ান্ত অনুমোদনের অপেক্ষায় আছে — আবার পাঠানো যাবে না।",
    en: "The post was approved in the first step and awaits final approval — it cannot be submitted again.",
  },
  "social.theDailyMaximumDraftCountMust": {
    bn: "প্রতিদিনের সর্বোচ্চ Draft সংখ্যা ১ থেকে ২০-এর মধ্যে হতে হবে।",
    en: "The daily maximum Draft count must be between 1 and 20.",
  },
  "social.aReasonForRejectionNoteMust": {
    bn: "প্রত্যাখ্যানের কারণ (note) লিখতে হবে — লেখক যেন বুঝতে পারেন কী ঠিক করতে হবে।",
    en: "A reason for rejection (note) must be written — so the author understands what to fix.",
  },
  "social.anEmptyFileCannotBeUploaded": {
    bn: "ফাঁকা ফাইল আপলোড করা যাবে না।",
    en: "An empty file cannot be uploaded.",
  },
  "social.theFileSaveWasIncompleteUpload": {
    bn: "ফাইল সংরক্ষণ অসম্পূর্ণ হয়েছে — আবার আপলোড করে চেষ্টা করুন।",
    en: "The file save was incomplete — upload again and try.",
  },
  "social.theFolderWasNotFound": {
    bn: "ফোল্ডারটি পাওয়া যায়নি",
    en: "The folder was not found",
  },
  "social.giveTheFolderAName": {
    bn: "ফোল্ডারের নাম দিন।",
    en: "Give the folder a name.",
  },
  "social.theVideoSizeCanBeAt": {
    bn: "ভিডিওর আকার সর্বোচ্চ {{p1}} হতে পারবে।",
    en: "The video size can be at most {{p1}}.",
  },
  "social.giveTheMonthInProperYyyy": {
    bn: "মাস সঠিক YYYY-MM আকারে দিন (যেমন 2026-11)।",
    en: "Give the month in proper YYYY-MM form (e.g. 2026-11).",
  },
  "social.theMonthFormatIsNotCorrect": {
    bn: "মাসের ফরম্যাট সঠিক নয় — YYYY-MM আকারে দিন (যেমন 2026-10)।",
    en: "The month format is not correct — give it in YYYY-MM form (e.g. 2026-10).",
  },
  "social.mediaAssetNotFound": {
    bn: "মিডিয়া asset পাওয়া যায়নি: {{refAssetId}}",
    en: "Media asset not found: {{refAssetId}}",
  },
  "social.mediaAssetTypeMismatchTheAsset": {
    bn: "মিডিয়া asset-এর ধরন মেলে না: {{refAssetId}} (asset-টি {{assetKind}}, দেওয়া হয়েছে {{refKind}})",
    en: "Media asset type mismatch: {{refAssetId}} (the asset is {{assetKind}}, given {{refKind}})",
  },
  "social.theMediaNameCannotBeLeft": {
    bn: "মিডিয়ার নাম খালি রাখা যাবে না।",
    en: "The media name cannot be left empty.",
  },
  "social.theExpiryMustBeBetween1": {
    bn: "মেয়াদ ১ থেকে {{SHARE_LINK_MAX_EXPIRY_DAYS}} দিনের মধ্যে হতে হবে।",
    en: "The expiry must be between 1 and {{SHARE_LINK_MAX_EXPIRY_DAYS}} days.",
  },
  "social.theScheduledTimeCannotBeIn": {
    bn: "শিডিউলের সময় অতীতে হতে পারবে না — ভবিষ্যতের সময় দিন।",
    en: "The scheduled time cannot be in the past — give a future time.",
  },
  "social.onlyDraftPostsCanBeSubmitted": {
    bn: "শুধু Draft পোস্ট অনুমোদনের জন্য পাঠানো যায়।",
    en: "Only Draft posts can be submitted for approval.",
  },
  "social.onlyDraftPostsCanBeDeleted": {
    bn: "শুধু Draft পোস্ট মুছে ফেলা যায়।",
    en: "Only Draft posts can be deleted.",
  },
  "social.onlyDraftPostsCanBeEdited": {
    bn: "শুধু Draft পোস্ট সম্পাদনা করা যায়।",
    en: "Only Draft posts can be edited.",
  },
  "social.onlyOnDraftPostsCanA": {
    bn: "শুধু Draft পোস্টে আগের Version ফিরিয়ে আনা যায়।",
    en: "Only on Draft posts can a previous Version be restored.",
  },
  "social.onlyFailedPostsCanBeRetried": {
    bn: "শুধু Failed পোস্টই আবার চেষ্টা (retry) করা যায় — এই পোস্টটি এখন \"{{postStatus}}\" অবস্থায় আছে।",
    en: "Only Failed posts can be retried — this post is now in \"{{postStatus}}\" status.",
  },
  "social.onlyOwnerAdminCanApproveA": {
    bn: "শুধু OWNER/ADMIN পোস্ট অনুমোদন করতে পারেন।",
    en: "Only OWNER/ADMIN can approve a post.",
  },
  "social.onlyOwnerAdminCanRejectA": {
    bn: "শুধু OWNER/ADMIN পোস্ট প্রত্যাখ্যান করতে পারেন।",
    en: "Only OWNER/ADMIN can reject a post.",
  },
  "social.dataCanOnlyBeFetchedFor": {
    bn: "শুধু Published পোস্টের Data আনা যায় — এই পোস্টটি এখনো প্রকাশিত হয়নি।",
    en: "Data can only be fetched for Published posts — this post is not published yet.",
  },
  "social.aPngVersionCanOnlyBe": {
    bn: "শুধু SVG ছবির PNG সংস্করণ তৈরি করা যায় — এই ফাইলটি SVG নয়।",
    en: "A PNG version can only be made of SVG images — this file is not an SVG.",
  },
  "social.contentCanOnlyBeMadeFrom": {
    bn: "শুধু অনুমোদিত (approved) শেখা তথ্য দিয়ে content বানানো যায় — এই item-টি এখনো review queue-তে আছে। আগে Learning queue থেকে approve করুন।",
    en: "Content can only be made from approved learned items — this item is still in the review queue. Approve it from the Learning queue first.",
  },
  "social.onlyImagesOrVideosCanBe": {
    bn: "শুধু ছবি বা ভিডিও আপলোড করা যাবে।",
    en: "Only images or videos can be uploaded.",
  },
  "social.onlyAnImageSAspectRatio": {
    bn: "শুধু ছবির aspect ratio বদলানো যায় — এটি একটি ভিডিও ফাইল।",
    en: "Only an image's aspect ratio can be changed — this is a video file.",
  },
  "social.aCoverCanOnlyBeTaken": {
    bn: "শুধু ভিডিও থেকেই cover তোলা যায় — এটি একটি ছবি ফাইল।",
    en: "A cover can only be taken from a video — this is an image file.",
  },
  "social.onlyAScheduledPostSSchedule": {
    bn: "শুধু শিডিউল করা পোস্টের শিডিউল বাতিল করা যায়।",
    en: "Only a scheduled post's schedule can be cancelled.",
  },
  "social.aShareLinkIsForOne": {
    bn: "শেয়ার লিংক একটি পোস্ট অথবা একটি গ্রুপের জন্য হবে — ঠিক একটি বেছে দিন।",
    en: "A share link is for one post or one group — choose exactly one.",
  },
  "social.theShareLinkCouldNotBe": {
    bn: "শেয়ার লিংক তৈরি করা যায়নি — আবার চেষ্টা করুন।",
    en: "The share link could not be created — please try again.",
  },
  "social.theShareLinkWasNotFound": {
    bn: "শেয়ার লিংকটি পাওয়া যায়নি।",
    en: "The share link was not found.",
  },
  "social.chooseAValidStockItem": {
    bn: "সঠিক Stock item বেছে নিন।",
    en: "Choose a valid Stock item.",
  },
  "social.giveAValidDateAndTime": {
    bn: "সঠিক তারিখ ও সময় দিন।",
    en: "Give a valid date and time.",
  },
  "social.chooseAValidMemberOrSend": {
    bn: "সঠিক সদস্য বেছে দিন, অথবা দায়িত্ব সরাতে খালি পাঠান।",
    en: "Choose a valid member, or send empty to remove responsibility.",
  },
  "social.theDayOfTheWeekMust": {
    bn: "সপ্তাহের দিন ০ (রবিবার) থেকে ৬ (শনিবার)-এর মধ্যে হতে হবে।",
    en: "The day of the week must be between 0 (Sunday) and 6 (Saturday).",
  },
  "social.asADecisionOnlyApprovedOr": {
    bn: "সিদ্ধান্ত হিসেবে শুধু approved অথবা changes_requested দেওয়া যাবে।",
    en: "As a decision, only approved or changes_requested can be given.",
  },
  "social.thereIsNotEnoughDataTo": {
    bn: "সেরা সময় বের করার মতো যথেষ্ট Data নেই — অন্তত ১০টি Published পোস্টের Insights লাগবে, এখন আছে {{bn}}টি।",
    en: "There is not enough Data to find the best time — Insights from at least 10 Published posts are needed, there are {{bn}} now.",
  },
  "social.aiFeaturesTemporarilyPausedPlatformWide": {
    bn: "AI features প্ল্যাটফর্ম team দ্বারা পুরো প্ল্যাটফর্মে সাময়িকভাবে বন্ধ রাখা হয়েছে।",
    en: "AI features are temporarily paused platform-wide by the platform team.",
  },
  "social.aiFeaturesTemporarilyDisabledForThisOrganization": {
    bn: "AI features প্ল্যাটফর্ম team দ্বারা এই organization-এর জন্য সাময়িকভাবে বন্ধ আছে।",
    en: "AI features are temporarily disabled for this organization by the platform team.",
  },
  "social.aiVariantsAllDroppedNumbersOutsideFacts": {
    bn: "AI-এর {{droppedCount}}টি variant-ই বাদ পড়েছে — প্রতিটিতে fact-এর বাইরের সংখ্যা ছিল। কিছুই save হয়নি; আবার চেষ্টা করুন।",
    en: "All {{droppedCount}} of the AI's variants were dropped — each had a number outside the facts. Nothing was saved; please try again.",
  },
};
