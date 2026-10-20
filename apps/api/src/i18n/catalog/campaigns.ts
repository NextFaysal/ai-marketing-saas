/**
 * MB4 (ML10) — campaigns catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the campaigns module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const campaignsCatalog: CatalogNamespace = {
  "campaigns.aCarouselAdNeeds210": {
    bn: "Carousel বিজ্ঞাপনে ২–১০টি কার্ড লাগে",
    en: "A carousel ad needs 2-10 cards",
  },
  "campaigns.aCatalogAdSetOptimizesOn": {
    bn: "Catalog ad set তার product set-এর উপর optimize করে — catalog বিজ্ঞাপনের জন্য conversionEvent পাঠানো হয় না; যেকোনো একটি সরান",
    en: "A catalog ad set optimizes on its product set — conversionEvent is not sent for catalog ads; clear one of them",
  },
  "campaigns.aLandingLinkIsRequiredPass": {
    bn: "একটি landing link দরকার: linkUrl পাঠান অথবা Business Knowledge-এ business website URL সেট করুন",
    en: "A landing link is required: pass linkUrl or set the business website URL in Business Knowledge",
  },
  "campaigns.aLeadFormCarriesAtMost": {
    bn: "একটি lead form-এ এই builder-এ সর্বোচ্চ ১২টি প্রশ্ন থাকতে পারে",
    en: "A lead form carries at most 12 questions in this builder",
  },
  "campaigns.aLeadFormNeedsAPrivacy": {
    bn: "Lead form-এর জন্য একটি Privacy Policy URL (https://...) দরকার — এটি ছাড়া Meta lead form চালাবে না",
    en: "A lead form needs a Privacy Policy URL (https://...) — Meta will not run a lead form without one",
  },
  "campaigns.aLeadFormNeedsAtLeast": {
    bn: "Lead form-এ অন্তত একটি প্রশ্ন লাগবে",
    en: "A lead form needs at least one question",
  },
  "campaigns.aPositiveTotalDailyBudgetIs": {
    bn: "একটি ধনাত্মক মোট দৈনিক বাজেট দরকার",
    en: "A positive total daily budget is required",
  },
  "campaigns.aSearchQueryIsRequired": {
    bn: "একটি search query দরকার",
    en: "A search query is required",
  },
  "campaigns.aValidPlanObjectiveIsRequired": {
    bn: "একটি বৈধ plan objective দরকার",
    en: "A valid plan objective is required",
  },
  "campaigns.aVideoAdNeedsAVideoassetid": {
    bn: "Video বিজ্ঞাপনের জন্য creative library থেকে একটি videoAssetId লাগবে",
    en: "A video ad needs a videoAssetId from the creative library",
  },
  "campaigns.aVideoFromTheSocialStudio": {
    bn: "Social/Studio library-র ভিডিও সরাসরি Meta video ad হিসেবে চালানো যায় না — Meta-র দরকার Creative Library দিয়ে আপলোড করা ভিডিও (যা তার Meta video id তৈরি করে)। সেখানে আপলোড করুন, তারপর creative asset থেকে variant বানান।",
    en: "A video from the Social/Studio library cannot run as a Meta video ad directly — Meta needs a video uploaded through the Creative Library (which creates its Meta video id). Upload it there, then make the variant from the creative asset.",
  },
  "campaigns.noTranslationWasReturnedFromThe": {
    bn: "AI Provider থেকে অনুবাদ পাওয়া যায়নি — কিছুক্ষণ পরে আবার চেষ্টা করুন",
    en: "No translation was returned from the AI provider — please try again in a little while",
  },
  "campaigns.aiImageGenerationIsNotAvailable": {
    bn: "এই context-এ AI image generation পাওয়া যাচ্ছে না",
    en: "AI image generation is not available in this context",
  },
  "campaigns.aiVideoGenerationIsNotAvailable": {
    bn: "এই context-এ AI video generation পাওয়া যাচ্ছে না",
    en: "AI video generation is not available in this context",
  },
  "campaigns.theAiTranslationCouldNotBe": {
    bn: "AI-এর অনুবাদ পড়া যায়নি (JSON নয়) — কিছু সেভ হয়নি",
    en: "The AI translation could not be read (not JSON) — nothing was saved",
  },
  "campaigns.apiPublicUrlIsNotConfigured": {
    bn: "এই deployment-এ API_PUBLIC_URL configure করা নেই — Meta media image-টি fetch করতে পারেনি, তাই variant তৈরি হয়নি",
    en: "API_PUBLIC_URL is not configured on this deployment — Meta could not fetch the media image, so the variant was not created",
  },
  "campaigns.adAccountNoLongerExists": {
    bn: "Ad account-টি আর নেই",
    en: "Ad account no longer exists",
  },
  "campaigns.adAccountNotFound": {
    bn: "Ad account পাওয়া যায়নি",
    en: "Ad account not found",
  },
  "campaigns.adAccountNotFoundInThis": {
    bn: "এই organization-এ ad account পাওয়া যায়নি",
    en: "Ad account not found in this organization",
  },
  "campaigns.adNotFoundInThisPlan": {
    bn: "এই plan-এ ad পাওয়া যায়নি",
    en: "Ad not found in this plan",
  },
  "campaigns.adSetTheAttachedLeadForm": {
    bn: "Ad set \"{{adSetName}}\": সংযুক্ত lead form-টি আর নেই",
    en: "Ad set \"{{adSetName}}\": the attached lead form no longer exists",
  },
  "campaigns.adSetNotFoundInThis": {
    bn: "এই plan-এ ad set পাওয়া যায়নি",
    en: "Ad set not found in this plan",
  },
  "campaigns.adVersionNotFound": {
    bn: "Ad version পাওয়া যায়নি",
    en: "Ad version not found",
  },
  "campaigns.theAdWasNotFoundIn": {
    bn: "Ad টি এই Plan-এ পাওয়া যায়নি",
    en: "The ad was not found in this plan",
  },
  "campaigns.advantageCanOnlyBeChangedBefore": {
    bn: "Advantage+ শুধু publish করার আগেই বদলানো যায় — budget structure তৈরির সময়ই ঠিক হয়ে যায়",
    en: "Advantage+ can only be changed before publishing — the budget structure is fixed at creation time",
  },
  "campaigns.advantageRunsOnTheSalesOr": {
    bn: "Advantage+ Sales অথবা App Promotion objective-এ চলে: plan objective হতে হবে OUTCOME_SALES অথবা OUTCOME_APP_PROMOTION",
    en: "Advantage+ runs on the Sales or App Promotion objectives: the plan objective must be OUTCOME_SALES or OUTCOME_APP_PROMOTION",
  },
  "campaigns.anEndedSeriesCannotBePaused": {
    bn: "শেষ হয়ে যাওয়া series pause করা যায় না",
    en: "An ended series cannot be paused",
  },
  "campaigns.anEndedSeriesCannotBeResumed": {
    bn: "শেষ হয়ে যাওয়া series resume করা যায় না — বদলে নতুন series তৈরি করুন",
    en: "An ended series cannot be resumed — create a new series instead",
  },
  "campaigns.anExperimentNeedsTwoDifferentVariant": {
    bn: "Experiment-এর জন্য দুটি আলাদা variant plan লাগে",
    en: "An experiment needs TWO different variant plans",
  },
  "campaigns.approvalSettingsAreNotAvailableIn": {
    bn: "এই context-এ approval settings পাওয়া যাচ্ছে না (CampaignApprovalSetting table নেই)",
    en: "Approval settings are not available in this context (CampaignApprovalSetting table missing)",
  },
  "campaigns.atLeastOneTargetCountryIs": {
    bn: "অন্তত একটি target country দরকার",
    en: "At least one target country is required",
  },
  "campaigns.atMostDescriptionOptions": {
    bn: "সর্বোচ্চ {{capsDescriptions}}টি description option",
    en: "At most {{capsDescriptions}} description options",
  },
  "campaigns.atMostHeadlineOptions": {
    bn: "সর্বোচ্চ {{capsHeadlines}}টি headline option",
    en: "At most {{capsHeadlines}} headline options",
  },
  "campaigns.atMostPrimaryTextOptionsMeta": {
    bn: "সর্বোচ্চ {{capsPrimaryTexts}}টি primary text option (Meta-র dynamic creative limit)",
    en: "At most {{capsPrimaryTexts}} primary text options (Meta's dynamic creative limit)",
  },
  "campaigns.audienceHasNoMetaAudienceId": {
    bn: "Audience \"{{recordName}}\"-এর এখনো কোনো Meta audience id নেই — এটিকে target করা যাবে না",
    en: "Audience \"{{recordName}}\" has no Meta audience id yet — it cannot be targeted",
  },
  "campaigns.audienceIsNotReadyStatus": {
    bn: "Audience \"{{recordName}}\" তৈরি নয় (status: {{recordStatus}})",
    en: "Audience \"{{recordName}}\" is not ready (status: {{recordStatus}})",
  },
  "campaigns.audienceStudioIsNotWiredIn": {
    bn: "এই deployment-এ Audience Studio wired নয় (AudiencesService পাওয়া যাচ্ছে না)",
    en: "Audience Studio is not wired in this deployment (AudiencesService unavailable)",
  },
  "campaigns.audienceRecordNotFoundInThis": {
    bn: "এই organization-এ audience record পাওয়া যায়নি",
    en: "Audience record not found in this organization",
  },
  "campaigns.automationRuleNotFoundInThis": {
    bn: "এই organization-এ automation rule পাওয়া যায়নি",
    en: "Automation rule not found in this organization",
  },
  "campaigns.blueprintDataIsNotAvailableYet": {
    bn: "Blueprint data এখনো পাওয়া যাচ্ছে না (Migration বাকি)।",
    en: "Blueprint data is not available yet (migration pending).",
  },
  "campaigns.blueprintNotFound": {
    bn: "Blueprint পাওয়া যায়নি",
    en: "Blueprint not found",
  },
  "campaigns.bothPlansMustBeVariantsOf": {
    bn: "দুটি plan-ই একই A/B group-এর variant হতে হবে — আগে variant তৈরি করুন (A/B Variant), তারপর experiment শুরু করুন",
    en: "Both plans must be variants of the SAME A/B group — create the variant first (A/B Variant), then start the experiment",
  },
  "campaigns.bothVariantPlansMustRunOn": {
    bn: "দুটি variant plan-ই একই ad account-এ চলতে হবে — একটি Meta study একটি business/account-এর ভিতরেই থাকে",
    en: "Both variant plans must run on the same ad account — a Meta study lives inside one business/account",
  },
  "campaigns.forABudgetShiftTheRecommendation": {
    bn: "Budget Shift প্রয়োগে Recommendation-এর proposal পাঠাতে হবে — proposal ছাড়া কোনো সংখ্যা প্রয়োগ হবে না।",
    en: "For a Budget Shift, the recommendation's proposal must be sent — no number is applied without a proposal.",
  },
  "campaigns.budgetMustBeAPositiveAmount": {
    bn: "বাজেট একটি ধনাত্মক পরিমাণ হতে হবে",
    en: "Budget must be a positive amount",
  },
  "campaigns.builderInboxSignalNotFound": {
    bn: "Builder inbox signal পাওয়া যায়নি",
    en: "Builder inbox signal not found",
  },
  "campaigns.campaignBudgetCboNeedsACampaign": {
    bn: "Campaign budget (CBO)-এর জন্য plan-এ একটি campaign daily অথবা lifetime বাজেট লাগে (Advantage+ ছাড়া হলে ad set-এ দৈনিক বাজেট লাগে)",
    en: "Campaign budget (CBO) needs a campaign daily or lifetime budget on the plan (Advantage+ without one needs an ad set with a daily budget)",
  },
  "campaigns.campaignPlanNotFoundInThis": {
    bn: "এই organization-এ campaign plan পাওয়া যায়নি",
    en: "Campaign plan not found in this organization",
  },
  "campaigns.catalogAdsNeedBothACatalog": {
    bn: "Catalog বিজ্ঞাপনের জন্য catalog এবং product set দুটোই লাগে (catalogRecordId + productSetId)",
    en: "Catalog ads need BOTH a catalog and a product set (catalogRecordId + productSetId)",
  },
  "campaigns.catalogNotFoundInThisOrganization": {
    bn: "এই organization-এ catalog পাওয়া যায়নি",
    en: "Catalog not found in this organization",
  },
  "campaigns.chooseExactlyOneAssetCreativeassetidCreative": {
    bn: "ঠিক একটি asset বেছে নিন: creativeAssetId (creative library) অথবা mediaAssetId (social/studio library)",
    en: "Choose exactly one asset: creativeAssetId (creative library) or mediaAssetId (social/studio library)",
  },
  "campaigns.cityDistanceunitMustBeMileOr": {
    bn: "City \"{{cKey}}\": distanceUnit হতে হবে \"mile\" অথবা \"kilometer\"",
    en: "City \"{{cKey}}\": distanceUnit must be \"mile\" or \"kilometer\"",
  },
  "campaigns.cityRadiusMustBeBetween1": {
    bn: "City \"{{cKey}}\": radius ১ থেকে ৮০-এর মধ্যে হতে হবে",
    en: "City \"{{cKey}}\": radius must be between 1 and 80",
  },
  "campaigns.commentCannotBeEmpty": {
    bn: "Comment খালি হতে পারবে না",
    en: "Comment cannot be empty",
  },
  "campaigns.competitorAdNotFound": {
    bn: "Competitor ad পাওয়া যায়নি",
    en: "Competitor ad not found",
  },
  "campaigns.competitorAdNotFoundInThis": {
    bn: "এই organization-এ competitor ad পাওয়া যায়নি",
    en: "Competitor ad not found in this organization",
  },
  "campaigns.competitorInsightNotFoundInThis": {
    bn: "এই organization-এ competitor insight পাওয়া যায়নি",
    en: "Competitor insight not found in this organization",
  },
  "campaigns.competitorNotFoundInThisOrganization": {
    bn: "এই organization-এ competitor পাওয়া যায়নি",
    en: "Competitor not found in this organization",
  },
  "campaigns.competitorPriceObservationNotFoundIn": {
    bn: "এই organization-এ competitor price observation পাওয়া যায়নি",
    en: "Competitor price observation not found in this organization",
  },
  "campaigns.creativeAssetKindCannotCarryAn": {
    bn: "Creative asset kind \"{{assetKind}}\" ad variant বহন করতে পারে না",
    en: "Creative asset kind \"{{assetKind}}\" cannot carry an ad variant",
  },
  "campaigns.creativeAssetNotFoundInThis": {
    bn: "এই organization-এ creative asset পাওয়া যায়নি",
    en: "Creative asset not found in this organization",
  },
  "campaigns.crossAccountCloneMetaAdAccount": {
    bn: "Cross-account clone supports Meta ad accounts only — Google/TikTok যাওয়ার পথ Cross-Platform Draft (CB6/CN9)",
    en: "Cross-account clone শুধু Meta ad account সমর্থন করে — Google/TikTok-এর পথ হলো Cross-Platform Draft (CB6/CN9)",
  },
  "campaigns.crossPlatformDraftNotFoundFor": {
    bn: "এই plan-এর জন্য cross-platform draft পাওয়া যায়নি",
    en: "Cross-platform draft not found for this plan",
  },
  "campaigns.crossPlatformDraftsNeedAnApproved": {
    bn: "Cross-platform draft-এর জন্য approved plan লাগে (বর্তমান: {{planStatus}})",
    en: "Cross-platform drafts need an approved plan (current: {{planStatus}})",
  },
  "campaigns.crossPlatformPublishingIsNotAvailable": {
    bn: "এই context-এ cross-platform publishing পাওয়া যাচ্ছে না",
    en: "Cross-platform publishing is not available in this context",
  },
  "campaigns.dismissedSignalsDoNotProduceDrafts": {
    bn: "Dismissed সিগন্যাল থেকে Draft তৈরি হয় না",
    en: "Dismissed signals do not produce drafts",
  },
  "campaigns.theDonorAdSetSBudget": {
    bn: "Donor Ad Set-এর বাজেট কমেছে, কিন্তু Winner Ad Set-এ বাড়ানো যায়নি: {{p1}}{{p2}}",
    en: "The donor ad set's budget was reduced, but the winner ad set's could not be increased: {{p1}}{{p2}}",
  },
  "campaigns.duplicateQuestionKey": {
    bn: "Duplicate প্রশ্নের key: {{key}}",
    en: "Duplicate question key: {{key}}",
  },
  "campaigns.eachCityNeedsItsMetaLocation": {
    bn: "প্রতিটি city-র জন্য তার Meta location key লাগবে (Targeting Search দিয়ে খুঁজুন)",
    en: "Each city needs its Meta location key (use Targeting Search to find it)",
  },
  "campaigns.eachLeadFormQuestionNeedsA": {
    bn: "প্রতিটি lead form প্রশ্নের একটি key লাগবে",
    en: "Each lead form question needs a key",
  },
  "campaigns.eachPostcodeMustBeItsMeta": {
    bn: "প্রতিটি postcode তার Meta zip key হতে হবে (যেমন US:90210 — Targeting Search দিয়ে খুঁজুন)",
    en: "Each postcode must be its Meta zip key (e.g. US:90210 — find it via Targeting Search)",
  },
  "campaigns.eachWindowNeedsDay06": {
    bn: "প্রতিটি window-তে day 0-6, startHour 0-23 এবং endHour 1-24 থাকতে হবে, start < end সহ",
    en: "Each window needs day 0-6, startHour 0-23 and endHour 1-24 with start < end",
  },
  "campaigns.eitherADailyOrALifetime": {
    bn: "দৈনিক অথবা lifetime — যেকোনো একটি বাজেট লাগবেই",
    en: "Either a daily or a lifetime budget is required",
  },
  "campaigns.experimentNotFoundInThisOrganization": {
    bn: "এই organization-এ experiment পাওয়া যায়নি",
    en: "Experiment not found in this organization",
  },
  "campaigns.fanOutRequiresAnApprovedPlan": {
    bn: "Fan-out-এর জন্য Approved Plan দরকার (বর্তমান: {{planStatus}})",
    en: "Fan-out requires an approved plan (current: {{planStatus}})",
  },
  "campaigns.fixedAdjustWouldTakeAdSet": {
    bn: "Fixed adjust {{deltaMinor}} দিলে ad set \"{{sName}}\" <= 0 হয়ে যাবে — প্রত্যাখ্যান করা হলো, কিছু বদলায়নি",
    en: "Fixed adjust {{deltaMinor}} would take ad set \"{{sName}}\" to <= 0 — refused, nothing changed",
  },
  "campaigns.geoHoldoutStoreNotFound": {
    bn: "Geo Holdout Store পাওয়া যাচ্ছে না",
    en: "Geo Holdout Store not found",
  },
  "campaigns.holdoutWindowCanBeAtMost": {
    bn: "Holdout Window সর্বোচ্চ {{CampaignsServiceHOLDOUT_MAX_WINDOW_DAYS}} দিন হতে পারে",
    en: "Holdout Window can be at most {{CampaignsServiceHOLDOUT_MAX_WINDOW_DAYS}} days",
  },
  "campaigns.holdoutDefinitionNotFoundInThis": {
    bn: "এই organization-এ holdout definition পাওয়া যায়নি",
    en: "Holdout definition not found in this organization",
  },
  "campaigns.invalidLocaleIdMetaLocaleIds": {
    bn: "অবৈধ locale id: {{l}} (Meta locale id ধনাত্মক পূর্ণসংখ্যা হয় — Targeting Search দিয়ে খুঁজুন)",
    en: "Invalid locale id: {{l}} (Meta locale ids are positive integers — find them via Targeting Search)",
  },
  "campaigns.invalidLocationTypeAllowed": {
    bn: "অবৈধ location type: {{lt}} (অনুমোদিত: {{p2}})",
    en: "Invalid location type: {{lt}} (allowed: {{p2}})",
  },
  "campaigns.invalidObjective": {
    bn: "অবৈধ objective",
    en: "Invalid objective",
  },
  "campaigns.invalidOptimizationGoal": {
    bn: "অবৈধ optimization goal",
    en: "Invalid optimization goal",
  },
  "campaigns.invalidAllowed": {
    bn: "অবৈধ {{label}}: {{v}} (অনুমোদিত: {{p3}})",
    en: "Invalid {{label}}: {{v}} (allowed: {{p3}})",
  },
  "campaigns.theLandingServiceIsNotWired": {
    bn: "Landing Service এই Build-এ যুক্ত নয় — Builder থেকে Landing তৈরি করা যাচ্ছে না (Landings পেজ থেকে তৈরি করা যাবে)।",
    en: "The Landing Service is not wired in this build — a landing cannot be created from the Builder (it can be created from the Landings page).",
  },
  "campaigns.landingPageNotFoundInThis": {
    bn: "এই organization-এ landing page পাওয়া যায়নি",
    en: "Landing page not found in this organization",
  },
  "campaigns.launchTimeMustBeAtLeast": {
    bn: "Launch time অন্তত ৩০ সেকেন্ড ভবিষ্যতে হতে হবে",
    en: "Launch time must be at least 30 seconds in the future",
  },
  "campaigns.leadFormBelongsToPageBut": {
    bn: "Lead form \"{{formName}}\" Page {{formPageId}}-এর, কিন্তু এই ad set ব্যবহার করে Page {{sPageId}} — একটি form শুধু তার নিজের Page-এই চলতে পারে",
    en: "Lead form \"{{formName}}\" belongs to Page {{formPageId}}, but this ad set uses Page {{sPageId}} — a form can only run on its own Page",
  },
  "campaigns.leadFormNameIsRequired": {
    bn: "Lead form-এর নাম দরকার",
    en: "Lead form name is required",
  },
  "campaigns.leadFormNeedsTheMetaPage": {
    bn: "Lead form-এর জন্য সেটির মালিক Meta Page-এর id লাগবে (pageId)",
    en: "Lead form needs the Meta Page id that owns it (pageId)",
  },
  "campaigns.leadFormNotFoundInThis": {
    bn: "এই organization-এ lead form পাওয়া যায়নি",
    en: "Lead form not found in this organization",
  },
  "campaigns.mediaAssetNotFoundInThis": {
    bn: "এই organization-এ media asset পাওয়া যায়নি",
    en: "Media asset not found in this organization",
  },
  "campaigns.metaRefusedToCreateTheExperiment": {
    bn: "Meta Experiment তৈরি করতে অস্বীকার করেছে: {{message}}",
    en: "Meta refused to create the experiment: {{message}}",
  },
  "campaigns.metaDidNotConfirmTheStatus": {
    bn: "Meta did NOT confirm the status change: {{message}}. Local status is unchanged.",
    en: "Meta did NOT confirm the status change: {{message}}. Local status is unchanged.",
  },
  "campaigns.metaIntegrationCredentialsAreMissing": {
    bn: "Meta integration credentials নেই",
    en: "Meta integration credentials are missing",
  },
  "campaigns.metaLeadFormCreationDidNot": {
    bn: "Meta lead form creation did NOT succeed: {{message}}",
    en: "Meta lead form creation did NOT succeed: {{message}}",
  },
  "campaigns.metaReturnedNoBusinessForThis": {
    bn: "Meta এই Ad Account-এর কোনো Business ফেরত দেয়নি — Ad Study Business Node-এ তৈরি হয়, তাই এই Account থেকে Experiment তৈরি করা যাচ্ছে না",
    en: "Meta returned no Business for this Ad Account — an Ad Study is created on a Business node, so an Experiment cannot be created from this Account",
  },
  "campaigns.noStudyReadBackWasReturned": {
    bn: "Meta থেকে Study Read-back পাওয়া যায়নি: {{p1}}",
    en: "No Study read-back was returned from Meta: {{p1}}",
  },
  "campaigns.theBusinessOfThisAdAccount": {
    bn: "Meta থেকে এই Ad Account-এর Business পড়া যায়নি: {{p1}}",
    en: "The Business of this Ad Account could not be read from Meta: {{p1}}",
  },
  "campaigns.milestone9PublishingSupportsMetaAd": {
    bn: "Milestone 9 publishing শুধু Meta ad account সমর্থন করে",
    en: "Milestone 9 publishing supports Meta ad accounts only",
  },
  "campaigns.namingSettingsAreNotAvailableIn": {
    bn: "এই context-এ naming settings পাওয়া যাচ্ছে না (BusinessProfile table নেই)",
    en: "Naming settings are not available in this context (BusinessProfile table missing)",
  },
  "campaigns.noWinnerYetVerdictEveryVariant": {
    bn: "এখনো কোনো winner নেই (verdict: {{p1}}) — প্রতিটি variant-এর আগে spend ও conversion data লাগবে",
    en: "No winner yet (verdict: {{p1}}) — every variant needs spend and conversion data first",
  },
  "campaigns.onlyApprovedPlansCanBeScheduled": {
    bn: "শুধু approved plan-ই launch-এর জন্য schedule করা যায় (বর্তমান: {{planStatus}})",
    en: "Only approved plans can be scheduled to launch (current: {{planStatus}})",
  },
  "campaigns.onlyPendingApprovalPlansCanBe": {
    bn: "শুধু pending_approval plan-ই approve করা যায় (বর্তমান: {{planStatus}})",
    en: "Only pending_approval plans can be approved (current: {{planStatus}})",
  },
  "campaigns.onlyPendingApprovalPlansCanBe2": {
    bn: "শুধু pending_approval plan-ই reject করা যায় (বর্তমান: {{planStatus}})",
    en: "Only pending_approval plans can be rejected (current: {{planStatus}})",
  },
  "campaigns.onlyPublishedPlansCanBeActivated": {
    bn: "শুধু published plan-ই activate অথবা pause করা যায়",
    en: "Only published plans can be activated or paused",
  },
  "campaigns.onlyPublishedPlansHaveLiveBudgets": {
    bn: "শুধু published plan-এরই live বাজেট edit করা যায়",
    en: "Only published plans have live budgets to edit",
  },
  "campaigns.onlyPublishedPlansHaveLiveSchedules": {
    bn: "শুধু published plan-এরই live schedule edit করা যায়",
    en: "Only published plans have live schedules to edit",
  },
  "campaigns.planChangedSinceApprovalThePublished": {
    bn: "অনুমোদনের পর plan বদলে গেছে — published content অনুমোদিত snapshot-এর সঙ্গে মিলতে হবে। আগে আবার approval-এর জন্য পাঠান।",
    en: "Plan changed since approval — the published content must match the approved snapshot. Re-submit for approval first.",
  },
  "campaigns.planDailyBudgetCapExceededMinor": {
    bn: "Plan-এর দৈনিক বাজেট cap ছাড়িয়ে গেছে: দিনে {{p1}} {{p2}} minor units, cap হলো {{p3}}। একটি বাজেট কমান অথবা cap বাড়ান।",
    en: "Plan daily budget cap exceeded: {{p1}} {{p2}} minor units per day, cap is {{p3}}. Lower a budget or raise the cap.",
  },
  "campaigns.planInStatusCannotBeSubmitted": {
    bn: "\"{{planStatus}}\" অবস্থার plan submit করা যাবে না",
    en: "Plan in status \"{{planStatus}}\" cannot be submitted",
  },
  "campaigns.planIsAndCanNoLonger": {
    bn: "Plan-টি \"{{planStatus}}\" অবস্থায় আছে এবং আর edit করা যাবে না। শুধু draft/rejected plan-ই editable।",
    en: "Plan is \"{{planStatus}}\" and can no longer be edited. Only draft/rejected plans are editable.",
  },
  "campaigns.planIsARegionDraftCan": {
    bn: "Plan is \"{{planStatus}}\" — Region Draft শুধু Draft/Rejected অথবা Live Campaign-ওয়ালা Published Plan-এ বানানো যায়",
    en: "Plan is \"{{planStatus}}\" — a Region Draft can only be made on a Draft/Rejected plan or a Published plan with a live Campaign",
  },
  "campaigns.planIsNotReadyForApproval": {
    bn: "Plan approval-এর জন্য তৈরি নয়: {{p1}}",
    en: "Plan is not ready for approval: {{p1}}",
  },
  "campaigns.planMustBeApprovedBeforePublishing": {
    bn: "Publish করার আগে plan approve করতে হবে (বর্তমান: {{planStatus}})। লিপিবদ্ধ approval ছাড়া publish করা সম্ভব নয়।",
    en: "Plan must be approved before publishing (current: {{planStatus}}). Publishing without recorded approval is not possible.",
  },
  "campaigns.planNoLongerValidates": {
    bn: "Plan আর validate হচ্ছে না: {{p1}}",
    en: "Plan no longer validates: {{p1}}",
  },
  "campaigns.planVersionNotFoundInThis": {
    bn: "এই organization-এ plan version পাওয়া যায়নি",
    en: "Plan version not found in this organization",
  },
  "campaigns.planVersionsAreNotAvailableIn": {
    bn: "এই context-এ plan versions পাওয়া যাচ্ছে না (CampaignPlanVersion table নেই)",
    en: "Plan versions are not available in this context (CampaignPlanVersion table missing)",
  },
  "campaigns.platformBlueprintsCannotBeDeletedThey": {
    bn: "Platform Blueprint মুছা যায় না — এটি Platform-এর সম্পত্তি।",
    en: "Platform Blueprints cannot be deleted — they are the Platform's property.",
  },
  "campaigns.thePlatformDidNotConfirmThe": {
    bn: "Platform Budget বদল নিশ্চিত করেনি: {{message}}। Local Record অপরিবর্তিত আছে।",
    en: "The Platform did not confirm the Budget change: {{message}}. The local record is unchanged.",
  },
  "campaigns.thePlatformDidNotConfirmThe2": {
    bn: "Platform Status বদল নিশ্চিত করেনি: {{message}}। Local Record অপরিবর্তিত আছে।",
    en: "The Platform did not confirm the Status change: {{message}}. The local record is unchanged.",
  },
  "campaigns.platformBlueprintNotFound": {
    bn: "Platform blueprint পাওয়া যায়নি",
    en: "Platform blueprint not found",
  },
  "campaigns.productNotFound": {
    bn: "Product পাওয়া যায়নি",
    en: "Product not found",
  },
  "campaigns.productNotFoundInThisOrganization": {
    bn: "এই organization-এ product পাওয়া যায়নি",
    en: "Product not found in this organization",
  },
  "campaigns.productSetIsNotCreatedOn": {
    bn: "Product set \"{{setName}}\" এখনো Meta-তে তৈরি হয়নি (status: {{setStatus}}) — আগে Catalogs পেজ থেকে publish করুন; শুধু local set দিয়ে catalog বিজ্ঞাপন চলবে না",
    en: "Product set \"{{setName}}\" is not created on Meta yet (status: {{setStatus}}) — publish it from the Catalogs page first; a local-only set cannot run catalog ads",
  },
  "campaigns.productSetNotFoundInThis": {
    bn: "এই organization-এ product set পাওয়া যায়নি",
    en: "Product set not found in this organization",
  },
  "campaigns.provideDailybudgetOrLifetimebudget": {
    bn: "dailyBudget অথবা lifetimeBudget দিন",
    en: "Provide dailyBudget or lifetimeBudget",
  },
  "campaigns.provideStarttimeOrEndtime": {
    bn: "startTime অথবা endTime দিন",
    en: "Provide startTime or endTime",
  },
  "campaigns.publishedPlansCannotBeDeletedThey": {
    bn: "Published plan মোছা যায় না (সেগুলো Meta-তে আছে)। বদলে archive করুন।",
    en: "Published plans cannot be deleted (they exist on Meta). Archive them instead.",
  },
  "campaigns.publishingDidNotCompleteAlreadyCreated": {
    bn: "Publishing did NOT complete: {{message}}. Already-created objects are saved; retrying Publish resumes without duplicating them.",
    en: "Publishing did NOT complete: {{message}}. Already-created objects are saved; retrying Publish resumes without duplicating them.",
  },
  "campaigns.questionACustomQuestionNeedsA": {
    bn: "প্রশ্ন \"{{key}}\": একটি CUSTOM প্রশ্নের label লাগবে",
    en: "Question \"{{key}}\": a CUSTOM question needs a label",
  },
  "campaigns.questionAtMost10Options": {
    bn: "প্রশ্ন \"{{key}}\": সর্বোচ্চ ১০টি option",
    en: "Question \"{{key}}\": at most 10 options",
  },
  "campaigns.questionEachOptionNeedsAValue": {
    bn: "প্রশ্ন \"{{key}}\": প্রতিটি option-এর একটি value লাগবে",
    en: "Question \"{{key}}\": each option needs a value",
  },
  "campaigns.questionTypeIsNotAMeta": {
    bn: "প্রশ্ন \"{{key}}\": type \"{{qType}}\" কোনো Meta lead form question type নয়",
    en: "Question \"{{key}}\": type \"{{qType}}\" is not a Meta lead form question type",
  },
  "campaigns.resumeTimeMustBeAfterThe": {
    bn: "Resume-এর সময় Pause-এর পরে হতে হবে",
    en: "Resume time must be after the Pause time",
  },
  "campaigns.savedViewFiltersAreTooLarge": {
    bn: "Saved view filters খুব বড় (সর্বোচ্চ 10000 অক্ষরের JSON)",
    en: "Saved view filters are too large (max 10000 characters of JSON)",
  },
  "campaigns.savedViewFiltersMustBeAn": {
    bn: "Saved view filters একটি object হতে হবে (hub-এর filter state)",
    en: "Saved view filters must be an object (the hub's filter state)",
  },
  "campaigns.savedViewNeedsANamePlease": {
    bn: "Saved view needs a name — একটি নাম দিন",
    en: "Saved view needs a name — please give a name",
  },
  "campaigns.savedViewNotFound": {
    bn: "Saved view পাওয়া যায়নি",
    en: "Saved view not found",
  },
  "campaigns.savedViewsAreNotAvailableIn": {
    bn: "এই context-এ saved views পাওয়া যাচ্ছে না (CampaignSavedView table নেই)",
    en: "Saved views are not available in this context (CampaignSavedView table missing)",
  },
  "campaigns.seriesNotFoundInThisOrganization": {
    bn: "এই organization-এ series পাওয়া যায়নি",
    en: "Series not found in this organization",
  },
  "campaigns.setTheBusinessWebsiteUrlFirst": {
    bn: "আগে business website URL সেট করুন (Organization Settings) — বিজ্ঞাপনের জন্য আসল landing link লাগে",
    en: "Set the business website URL first (Organization Settings) — ads need a real landing link",
  },
  "campaigns.targetAccountIsAAccountNot": {
    bn: "Target account-টি একটি {{accountPlatform}} account, {{dtoPlatform}} নয়",
    en: "Target account is a {{accountPlatform}} account, not {{dtoPlatform}}",
  },
  "campaigns.theTargetAccountIsTheSame": {
    bn: "Target account টি Source-এর একই — একই Account-এ কপি চাইলে Duplicate ব্যবহার করুন",
    en: "The target account is the same as the source — use Duplicate to copy within the same account",
  },
  "campaigns.targetAdAccountNotFoundIn": {
    bn: "এই organization-এ target ad account পাওয়া যায়নি",
    en: "Target ad account not found in this organization",
  },
  "campaigns.targetingIdWasNotFoundOn": {
    bn: "Targeting \"{{entryName}}\" (id {{entryId}}) Meta তে পাওয়া যায়নি — ID টি ভুল হতে পারে। Targeting Search দিয়ে সঠিক Entry বেছে নিন।",
    en: "Targeting \"{{entryName}}\" (id {{entryId}}) was not found on Meta — the ID may be wrong. Pick the correct entry via Targeting Search.",
  },
  "campaigns.targetingIdCouldNotBeVerified": {
    bn: "Targeting \"{{entryName}}\" (id {{entryId}}) Meta দিয়ে যাচাই করা যায়নি: {{p3}} — যাচাই ছাড়া এটি সেভ করা হবে না।",
    en: "Targeting \"{{entryName}}\" (id {{entryId}}) could not be verified with Meta: {{p3}} — it will not be saved without verification.",
  },
  "campaigns.theTargetingIdCouldNotBe": {
    bn: "Targeting ID যাচাই করা যায়নি: {{p1}} — ID-সহ Entry সেভ করতে আগে Meta Connect করুন, অথবা ID ছাড়া শুধু নাম দিন (নাম-ভিত্তিক Entry Readiness এ অযাচাইকৃত হিসেবে চিহ্নিত থাকবে)।",
    en: "The Targeting ID could not be verified: {{p1}} — connect Meta first to save entries with IDs, or give only the name without an ID (name-based entries stay marked unverified in Readiness).",
  },
  "campaigns.targetingSearchIsAMetaFeature": {
    bn: "Targeting search একটি Meta feature",
    en: "Targeting search is a Meta feature",
  },
  "campaigns.theTemplateCanBeAtMost": {
    bn: "Template সর্বোচ্চ ২০০ অক্ষরের হতে পারে",
    en: "The Template can be at most 200 characters",
  },
  "campaigns.giveAtLeastOneKeyIn": {
    bn: "Template-এ অন্তত একটি Key দিন — Template মুছতে চাইলে null পাঠান",
    en: "Give at least one key in the Template — send null to delete the Template",
  },
  "campaigns.theTemplateMustContainAtLeast": {
    bn: "Template-এ অন্তত একটি token থাকতে হবে — নইলে সব নাম একই হয়ে যাবে",
    en: "The Template must contain at least one token — otherwise every name would be the same",
  },
  "campaigns.thatWhatsappConnectionHasNoPhone": {
    bn: "সেই WhatsApp connection-এ কোনো phone number id লিপিবদ্ধ নেই — Connect Center-এ আবার connect করুন",
    en: "That WhatsApp connection has no phone number id recorded — reconnect it in the Connect Center",
  },
  "campaigns.thatWhatsappConnectionIsReconnectIt": {
    bn: "সেই WhatsApp connection-টি {{p1}} — এটিতে Click-to-WhatsApp বিজ্ঞাপন চালানোর আগে Connect Center-এ আবার connect করুন",
    en: "That WhatsApp connection is {{p1}} — reconnect it in the Connect Center before running Click-to-WhatsApp ads on it",
  },
  "campaigns.thatWhatsappConnectionWasNotFound": {
    bn: "সেই WhatsApp connection-টি এই organization-এ পাওয়া যায়নি — organization-এর connected WhatsApp নম্বরগুলোর একটি বেছে নিন",
    en: "That WhatsApp connection was not found in this organization — pick one of the organization's connected WhatsApp numbers",
  },
  "campaigns.thatAudienceBelongsToADifferent": {
    bn: "সেই audience-টি এই plan-এর থেকে আলাদা ad account-এর",
    en: "That audience belongs to a different ad account than this plan",
  },
  "campaigns.thatProductSetBelongsToA": {
    bn: "সেই product set-টি অন্য catalog-এর — বেছে নেওয়া catalog থেকে একটি set নিন",
    en: "That product set belongs to a different catalog — pick a set from the chosen catalog",
  },
  "campaigns.theAiProviderReturnedNoUsable": {
    bn: "AI provider কোনো ব্যবহারযোগ্য copy variant দেয়নি। কিছু সেভ হয়নি।",
    en: "The AI provider returned no usable copy variants. Nothing was saved.",
  },
  "campaigns.thisAdAccountHasNoMeta": {
    bn: "এই ad account-এর কোনো Meta API connection নেই (এটি CSV/manual data-র জন্য তৈরি) এবং এটি publish করতে পারে না। আগে Meta connect করুন।",
    en: "This ad account has no Meta API connection (it was created for CSV/manual data) and cannot publish. Connect Meta first.",
  },
  "campaigns.thisAdHasNoMetaAd": {
    bn: "এই ad-এর কোনো Meta ad id নেই",
    en: "This ad has no Meta ad id",
  },
  "campaigns.thisAdSetHasNoMeta": {
    bn: "এই ad set-এর কোনো Meta ad set id নেই",
    en: "This ad set has no Meta ad set id",
  },
  "campaigns.thisAdSetHasNoMeta2": {
    bn: "এই ad set-এর কোনো Meta ad set id নেই (published নয়)",
    en: "This ad set has no Meta ad set id (not published)",
  },
  "campaigns.thisExperimentHasNoMetaStudy": {
    bn: "এই experiment-এর কোনো Meta study id নেই — read back করার কিছু নেই",
    en: "This experiment has no Meta study id — nothing to read back",
  },
  "campaigns.thisLifecyclePathIsMetaOnly": {
    bn: "এই lifecycle path শুধু Meta-র জন্য",
    en: "This lifecycle path is Meta-only",
  },
  "campaigns.thisMediaAssetHasNoPublic": {
    bn: "এই media asset-এর কোনো public link token নেই — Meta ছবিটি fetch করতে পারেনি। Social library থেকে আবার import করুন যাতে এটি একটি public URL পায়।",
    en: "This media asset has no public link token — Meta could not fetch the image. Re-import it from the Social library so it carries a public URL.",
  },
  "campaigns.thisPlanHasNoMetaCampaign": {
    bn: "এই plan-এর এখনো কোনো Meta campaign নেই (published নয়)",
    en: "This plan has no Meta campaign yet (not published)",
  },
  "campaigns.thisPlanIsNotPartOf": {
    bn: "এই plan কোনো A/B test-এর অংশ নয়",
    en: "This plan is not part of an A/B test",
  },
  "campaigns.thisPlanUsesACampaignLevel": {
    bn: "এই plan campaign-level বাজেট (CBO) ব্যবহার করে — Meta-তে ad set-গুলোর নিজস্ব বাজেট থাকে না, তাই edit করার মতো ad set বাজেট নেই",
    en: "This plan uses a campaign-level budget (CBO) — ad sets carry no budget of their own on Meta, so there is no ad set budget to edit",
  },
  "campaigns.thisStatusReadIsMetaOnly": {
    bn: "এই status read শুধু Meta-র জন্য",
    en: "This status read is Meta-only",
  },
  "campaigns.thisVersionDoesNotCarryA": {
    bn: "এই version-টি পুনরুদ্ধারযোগ্য plan definition বহন করে না",
    en: "This version does not carry a restorable plan definition",
  },
  "campaigns.utmTemplateMustBeAnObject": {
    bn: "UTM Template অবজেক্ট হতে হবে",
    en: "UTM Template must be an object",
  },
  "campaigns.unknownBlueprint": {
    bn: "অজানা blueprint",
    en: "Unknown blueprint",
  },
  "campaigns.unknownDemographicsFieldAllowedEducationstatusesRelation": {
    bn: "অজানা demographics field: {{k}} (অনুমোদিত: educationStatuses, relationshipStatuses, lifeEvents, workPositions)",
    en: "Unknown demographics field: {{k}} (allowed: educationStatuses, relationshipStatuses, lifeEvents, workPositions)",
  },
  "campaigns.unknownRetargetingPresetAllowedProductViewers": {
    bn: "অজানা retargeting preset \"{{dtoKind}}\" (অনুমোদিত: product_viewers, add_to_cart)",
    en: "Unknown retargeting preset \"{{dtoKind}}\" (allowed: product_viewers, add_to_cart)",
  },
  "campaigns.variantASAdSetsCarry": {
    bn: "Variant A-এর ad set-গুলোতে কোনো pixel নেই — একটি CONVERSIONS study objective-এর জন্য plans-এর pixel ও conversion event লাগে (CN3)। আগে variant ad set-গুলোতে pixel + conversion event সেট করুন",
    en: "Variant A's ad sets carry no pixel — a CONVERSIONS study objective needs the plans' pixel and conversion event (CN3). Set a pixel + conversion event on the variant ad sets first",
  },
  "campaigns.variantIsNotPublishedYetA": {
    bn: "Variant {{label}} (\"{{pName}}\") এখনো published নয় — একটি Meta study live campaign পরীক্ষা করে। আগে স্বাভাবিক approval flow দিয়ে publish করুন (এটি PAUSED থাকে); experiment নিজে কিছুই publish করে না",
    en: "Variant {{label}} (\"{{pName}}\") is not published yet — a Meta study tests live campaigns. Publish it through the normal approval flow first (it stays PAUSED); the experiment itself never publishes anything",
  },
  "campaigns.theVersionTableIsNotAvailable": {
    bn: "Version table পাওয়া যাচ্ছে না — Migration বাকি থাকতে পারে।",
    en: "The version table is not available — a migration may be pending.",
  },
  "campaigns.whatsappConnectionsAreNotAvailableIn": {
    bn: "এই deployment-এ WhatsApp connections পাওয়া যাচ্ছে না — আগে Connect Center-এ WhatsApp connect করুন",
    en: "WhatsApp connections are not available in this deployment — connect WhatsApp in the Connect Center first",
  },
  "campaigns.theWindowSEndMustBe": {
    bn: "Window-এর শেষ শুরুর পরে হতে হবে",
    en: "The window's end must be after its start",
  },
  "campaigns.actionMustBePauseOrResume": {
    bn: "action হতে হবে \"pause\" অথবা \"resume\" (পাওয়া গেছে \"{{action}}\")",
    en: "action must be \"pause\" or \"resume\" (got \"{{action}}\")",
  },
  "campaigns.actionMustBePauseActivateBudget": {
    bn: "action হতে হবে pause, activate, budget_percent, budget_fixed অথবা duplicate",
    en: "action must be pause, activate, budget_percent, budget_fixed or duplicate",
  },
  "campaigns.actionMustBePauseResumeOr": {
    bn: "action হতে হবে pause, resume অথবা end (পাওয়া গেছে \"{{action}}\")",
    en: "action must be pause, resume or end (got \"{{action}}\")",
  },
  "campaigns.budgetmodeMustBeAboOrCbo": {
    bn: "budgetMode হতে হবে \"abo\" অথবা \"cbo\" (পাওয়া গেছে \"{{v}}\")",
    en: "budgetMode must be \"abo\" or \"cbo\" (got \"{{v}}\")",
  },
  "campaigns.countryMustBeAnIso2": {
    bn: "country একটি ISO 2-letter code হতে হবে (যেমন \"BD\") — পাওয়া গেছে \"{{dtoCountry}}\"",
    en: "country must be an ISO 2-letter code (e.g. \"BD\") — got \"{{dtoCountry}}\"",
  },
  "campaigns.creativeenhancementsKeyIsNotAMeta": {
    bn: "creativeEnhancements key \"{{k}}\" এমন কোনো Meta creative feature নয় যা এই builder map করতে পারে (অনুমোদিত: {{p2}})",
    en: "creativeEnhancements key \"{{k}}\" is not a Meta creative feature this builder can map (allowed: {{p2}})",
  },
  "campaigns.creativeenhancementsMustBeTrueOrFalse": {
    bn: "creativeEnhancements.{{k}} true অথবা false হতে হবে",
    en: "creativeEnhancements.{{k}} must be true or false",
  },
  "campaigns.dailybudgetMustBeAPositiveAmount": {
    bn: "dailyBudget একটি ধনাত্মক পরিমাণ হতে হবে (টাকা)",
    en: "dailyBudget must be a positive amount (taka)",
  },
  "campaigns.demographicsMustBeAnObject": {
    bn: "demographics একটি object হতে হবে",
    en: "demographics must be an object",
  },
  "campaigns.demographicsMustBePositiveIntegerIds": {
    bn: "demographics.{{k}} ধনাত্মক পূর্ণসংখ্যা id হতে হবে",
    en: "demographics.{{k}} must be positive integer ids",
  },
  "campaigns.durationdaysMustBeAnIntegerBetween": {
    bn: "durationDays ১ থেকে ৩০-এর মধ্যে একটি পূর্ণসংখ্যা হতে হবে",
    en: "durationDays must be an integer between 1 and 30",
  },
  "campaigns.endtimeIsNotAValidDate": {
    bn: "endTime বৈধ date/time নয়",
    en: "endTime is not a valid date/time",
  },
  "campaigns.endtimeMustBeAfterStarttime": {
    bn: "endTime startTime-এর পরে হতে হবে",
    en: "endTime must be after startTime",
  },
  "campaigns.endsatIsNotAValidDate": {
    bn: "endsAt সঠিক তারিখ নয়",
    en: "endsAt is not a valid date",
  },
  "campaigns.externalcampaignidIsRequiredToChangeCampaign": {
    bn: "campaign status বদলাতে externalCampaignId দরকার",
    en: "externalCampaignId is required to change campaign status",
  },
  "campaigns.fieldmappingForTargetsCustomFieldWhich": {
    bn: "fieldMapping \"{{qk}}\"-এর জন্য custom field \"{{ck}}\"-কে target করে, যা এই organization-এর কোনো live lead Custom Field নয় — আগে CRM-এ তৈরি করুন",
    en: "fieldMapping for \"{{qk}}\" targets custom field \"{{ck}}\", which is not a live lead Custom Field in this organization — create it in CRM first",
  },
  "campaigns.fieldmappingForTargetMustBeName": {
    bn: "\"{{qk}}\"-এর fieldMapping: target হতে হবে name, email, phone, notes অথবা custom:<fieldKey>",
    en: "fieldMapping for \"{{qk}}\": target must be name, email, phone, notes or custom:<fieldKey>",
  },
  "campaigns.fieldmappingNamesQuestionWhichIsNot": {
    bn: "fieldMapping প্রশ্ন \"{{qk}}\"-এর নাম দেয়, যা এই form-এর প্রশ্নগুলোর একটি নয়",
    en: "fieldMapping names question \"{{qk}}\", which is not one of this form's questions",
  },
  "campaigns.fieldsMustBeAnObject": {
    bn: "fields অবজেক্ট হতে হবে",
    en: "fields must be an object",
  },
  "campaigns.fixedminorMustBeAnIntegerMinor": {
    bn: "fixedMinor একটি পূর্ণসংখ্যা minor-unit পরিমাণ হতে হবে",
    en: "fixedMinor must be an integer minor-unit amount",
  },
  "campaigns.fixedminorMustBeNonZero": {
    bn: "fixedMinor শূন্য ছাড়া হতে হবে",
    en: "fixedMinor must be non-zero",
  },
  "campaigns.formatMustBeLinkVideoOr": {
    bn: "format হতে হবে link, video অথবা carousel",
    en: "format must be link, video or carousel",
  },
  "campaigns.googleDraftKindMustBeSearch": {
    bn: "google draft kind হতে হবে search অথবা pmax",
    en: "google draft kind must be search or pmax",
  },
  "campaigns.kindMustBeOneOf": {
    bn: "kind হতে হবে এর যেকোনো একটি: {{p1}}",
    en: "kind must be one of: {{p1}}",
  },
  "campaigns.linkurlIsRequiredForTheStarter": {
    bn: "starter ads-এর জন্য linkUrl দরকার",
    en: "linkUrl is required for the starter ads",
  },
  "campaigns.metriceventIsNotAValidMeta": {
    bn: "metricEvent \"{{metricEvent}}\" কোনো বৈধ Meta event name নয়",
    en: "metricEvent \"{{metricEvent}}\" is not a valid Meta event name",
  },
  "campaigns.nameIsRequired": {
    bn: "name দরকার",
    en: "name is required",
  },
  "campaigns.pauseatIsNotAValidTime": {
    bn: "pauseAt সঠিক সময় নয়",
    en: "pauseAt is not a valid time",
  },
  "campaigns.percentMustBeANonZero": {
    bn: "percent একটি শূন্য-ছাড়া সংখ্যা হতে হবে",
    en: "percent must be a non-zero number",
  },
  "campaigns.percentMustBeBetween90And": {
    bn: "percent -90 থেকে +900-এর মধ্যে হতে হবে",
    en: "percent must be between -90 and +900",
  },
  "campaigns.placementassetsAreNotSupportedForFormat": {
    bn: "placementAssets format \"{{format}}\"-এর জন্য সমর্থিত নয় — carousel card-গুলোর নিজস্ব ছবি থাকে",
    en: "placementAssets are not supported for format \"{{format}}\" — carousel cards carry their own images",
  },
  "campaigns.placementassetsGroupIsNotSupportedAllowed": {
    bn: "placementAssets group \"{{group}}\" সমর্থিত নয় (অনুমোদিত: {{p2}})",
    en: "placementAssets group \"{{group}}\" is not supported (allowed: {{p2}})",
  },
  "campaigns.placementassetsNeedsAnImageassetidVideoassetidOr": {
    bn: "placementAssets.{{group}}-এর জন্য imageAssetId, videoAssetId অথবা imageUrl লাগবে",
    en: "placementAssets.{{group}} needs an imageAssetId, videoAssetId or imageUrl",
  },
  "campaigns.placementassetsALinkAdSPlacement": {
    bn: "placementAssets.{{group}}: link ad-এর placement override একটি ছবি হতে হবে (imageAssetId অথবা imageUrl), ভিডিও নয়",
    en: "placementAssets.{{group}}: a link ad's placement override must be an image (imageAssetId or imageUrl), not a video",
  },
  "campaigns.placementassetsAVideoAdSPlacement": {
    bn: "placementAssets.{{group}}: video ad-এর placement override creative library থেকে একটি videoAssetId হতে হবে",
    en: "placementAssets.{{group}}: a video ad's placement override must be a videoAssetId from the creative library",
  },
  "campaigns.planaidAndPlanbidAreRequired": {
    bn: "planAId ও planBId দরকার",
    en: "planAId and planBId are required",
  },
  "campaigns.planidsIsRequired": {
    bn: "planIds দরকার",
    en: "planIds is required",
  },
  "campaigns.platformMustBeGoogleOrTiktok": {
    bn: "platform হতে হবে google অথবা tiktok",
    en: "platform must be google or tiktok",
  },
  "campaigns.presetMustBeOneOf": {
    bn: "preset হতে হবে এর যেকোনো একটি {{p1}}",
    en: "preset must be one of {{p1}}",
  },
  "campaigns.primarytextIsRequiredTheStarterAds": {
    bn: "primaryText দরকার — starter ads মালিকের নিজের copy বহন করে, কিছু উদ্ভাবন করা হয় না",
    en: "primaryText is required — the starter ads carry the owner's own copy, nothing is invented",
  },
  "campaigns.prospectingLayerConfigIsRequiredIt": {
    bn: "prospecting layer config দরকার — এটি সেই market (countries) বহন করে যা প্রতিটি layer ভাগ করে",
    en: "prospecting layer config is required — it carries the market (countries) every layer shares",
  },
  "campaigns.resumeatIsNotAValidTime": {
    bn: "resumeAt সঠিক সময় নয়",
    en: "resumeAt is not a valid time",
  },
  "campaigns.roasgoalMustBeAPositiveNumber": {
    bn: "roasGoal একটি ধনাত্মক সংখ্যা হতে হবে যেমন \\\"2.0\\\"",
    en: "roasGoal must be a positive number like \\\"2.0\\\"",
  },
  "campaigns.sourceMustBeCompetitorInsightCompetitor": {
    bn: "source হতে হবে competitor_insight | competitor_price | competitor_ad, একটি sourceRefId সহ",
    en: "source must be competitor_insight | competitor_price | competitor_ad with a sourceRefId",
  },
  "campaigns.splitaMustBeAnIntegerBetween": {
    bn: "splitA ১০ থেকে ৯০-এর মধ্যে একটি পূর্ণসংখ্যা হতে হবে (Meta cell-গুলোর প্রতিটির অন্তত ১০% লাগে; দুটি cell মিলে ১০০ হয়)",
    en: "splitA must be an integer between 10 and 90 (Meta cells need at least 10% each; the two cells sum to 100)",
  },
  "campaigns.starttimeIsNotAValidDate": {
    bn: "startTime বৈধ date/time নয়",
    en: "startTime is not a valid date/time",
  },
  "campaigns.startsatIsNotAValidDate": {
    bn: "startsAt সঠিক তারিখ নয়",
    en: "startsAt is not a valid date",
  },
  "campaigns.suggestplanDidNotCreateADraft": {
    bn: "suggestPlan একটি Draft তৈরি করেনি — সিগন্যাল অপরিবর্তিত রাখা হলো",
    en: "suggestPlan did not create a draft — the signal was left unchanged",
  },
  "campaigns.targetMustBeActiveOrPaused": {
    bn: "target হতে হবে ACTIVE অথবা PAUSED (পাওয়া গেছে \"{{target}}\")",
    en: "target must be ACTIVE or PAUSED (got \"{{target}}\")",
  },
  "campaigns.targetMustBeActiveOrPaused2": {
    bn: "target হতে হবে ACTIVE বা PAUSED",
    en: "target must be ACTIVE or PAUSED",
  },
  "campaigns.targetlocaleMustBeBnOrEn": {
    bn: "targetLocale হতে হবে bn অথবা en",
    en: "targetLocale must be bn or en",
  },
  "campaigns.tiktokObjectivetypeMustBeTrafficWeb": {
    bn: "tiktok objectiveType হতে হবে TRAFFIC, WEB_CONVERSIONS অথবা LEAD_GENERATION",
    en: "tiktok objectiveType must be TRAFFIC, WEB_CONVERSIONS or LEAD_GENERATION",
  },
  "campaigns.theValueOfUtmCannotBe": {
    bn: "utm_{{k}}-এর মান খালি হতে পারবে না",
    en: "The value of utm_{{k}} cannot be empty",
  },
  "campaigns.theValueOfUtmCanBe": {
    bn: "utm_{{k}}-এর মান সর্বোচ্চ ১২০ অক্ষরের হতে পারে",
    en: "The value of utm_{{k}} can be at most 120 characters",
  },
  "campaigns.eachEntryMustBeAName": {
    bn: "{{label}}: প্রতিটি entry একটি name অথবা { id, name } হতে হবে",
    en: "{{label}}: each entry must be a name or { id, name }",
  },
  "campaigns.emptyEntry": {
    bn: "{{label}}: খালি entry",
    en: "{{label}}: empty entry",
  },
  "campaigns.didNotConfirmTheStatusChange": {
    bn: "{{platformLabel}} did NOT confirm the status change: {{message}}. Local status is unchanged.",
    en: "{{platformLabel}} did NOT confirm the status change: {{message}}. Local status is unchanged.",
  },
  "campaigns.unknownTokenUsable": {
    bn: "অজানা Token: {{p1}} — ব্যবহারযোগ্য: {{p2}}",
    en: "Unknown Token: {{p1}} — usable: {{p2}}",
  },
  "campaigns.unknownUtmKeyUsable": {
    bn: "অজানা UTM Key: {{p1}} — ব্যবহারযোগ্য: {{p2}}",
    en: "Unknown UTM Key: {{p1}} — usable: {{p2}}",
  },
  "campaigns.unknownTokenUsableTokens": {
    bn: "অজানা token: {{p1}} — ব্যবহারযোগ্য token: {{p2}}",
    en: "Unknown token: {{p1}} — usable tokens: {{p2}}",
  },
  "campaigns.theNumberOfChangedInTranslation": {
    bn: "অনুবাদে {{key}}-এর সংখ্যা বদলে গেছে (আছে {{p2}}টি, অনুবাদে {{p3}}টি) — নিরাপত্তার জন্য কিছু সেভ হয়নি",
    en: "The number of {{key}} changed in translation (there are {{p2}}, in translation {{p3}}) — nothing was saved for safety",
  },
  "campaigns.numbersPricesChangedInTranslationThe": {
    bn: "অনুবাদে সংখ্যা/দাম বদলে গেছে — Source-এ ছিল [{{p1}}], অনুবাদে এসেছে [{{p2}}]। সংখ্যা লক করা থাকে বলে কিছু সেভ হয়নি",
    en: "Numbers/prices changed in translation — the source had [{{p1}}], the translation has [{{p2}}]. Nothing was saved because numbers stay locked",
  },
  "campaigns.aRealAiProviderIsNeeded": {
    bn: "অনুবাদের জন্য আসল AI Provider দরকার — Organization Settings-এ LLM Provider configure করুন। Template দিয়ে অনুবাদ করা হয় না।",
    en: "A real AI Provider is needed for translation — configure the LLM Provider in Organization Settings. Translation is not done with templates.",
  },
  "campaigns.atLeastOneHoldoutRegionMust": {
    bn: "অন্তত একটি Holdout Region দিতে হবে",
    en: "At least one Holdout Region must be given",
  },
  "campaigns.selectAtLeastOnePlan": {
    bn: "অন্তত একটি Plan বেছে নিন",
    en: "Select at least one Plan",
  },
  "campaigns.giveAtLeastOneTargetAccount": {
    bn: "অন্তত একটি Target Account দিন (Google বা TikTok)",
    en: "Give at least one Target Account (Google or TikTok)",
  },
  "campaigns.atLeastOneTestRegionMust": {
    bn: "অন্তত একটি Test Region দিতে হবে",
    en: "At least one Test Region must be given",
  },
  "campaigns.noProductSetIsAttachedTo": {
    bn: "এই Ad Set-এ কোনো Product Set যুক্ত নেই — আগে Ad Set-এ Catalog Product Set বাছাই করুন, অথবা productSetId পাঠান।",
    en: "No Product Set is attached to this Ad Set — select a Catalog Product Set on the Ad Set first, or send productSetId.",
  },
  "campaigns.thereIsNoTextInThis": {
    bn: "এই Ad-এ অনুবাদ করার মতো কোনো Text নেই",
    en: "There is no text in this Ad to translate",
  },
  "campaigns.thisDeploymentHasNoPlatformStatus": {
    bn: "এই Deployment-এ Platform Status বদলের Path যুক্ত নেই",
    en: "This deployment has no Platform Status change path wired",
  },
  "campaigns.thisDraftIsNotCreatedOn": {
    bn: "এই Draft এখনো Platform-এ তৈরি হয়নি — Budget বদলানো যাবে না",
    en: "This Draft is not created on the Platform yet — the Budget cannot be changed",
  },
  "campaigns.thisDraftIsNotCreatedOn2": {
    bn: "এই Draft এখনো Platform-এ তৈরি হয়নি — Status বদলানো যাবে না",
    en: "This Draft is not created on the Platform yet — the Status cannot be changed",
  },
  "campaigns.thisDraftSCreationRecordHas": {
    bn: "এই Draft-এর Creation Record-এ Google Budget Resource নেই — Budget বদলানো যাবে না (Re-publish করলে নতুন Record তৈরি হবে)",
    en: "This Draft's Creation Record has no Google Budget Resource — the Budget cannot be changed (Re-publishing will create a new Record)",
  },
  "campaigns.thisDraftSCreationRecordHas2": {
    bn: "এই Draft-এর Creation Record-এ TikTok Ad Group ID নেই — Budget বদলানো যাবে না (Re-publish করলে নতুন Record তৈরি হবে)",
    en: "This Draft's Creation Record has no TikTok Ad Group ID — the Budget cannot be changed (Re-publishing will create a new Record)",
  },
  "campaigns.thisHoldoutDefinitionHasAlreadyBeen": {
    bn: "এই Holdout Definition আগেই শেষ করা হয়েছে",
    en: "This Holdout Definition has already been ended",
  },
  "campaigns.thisLandingIsNowInStatus": {
    bn: "এই Landing টি এখন \"{{landingStatus}}\" অবস্থায় আছে — Publish করা Landing ছাড়া Ad-এ বসানো যায় না, কারণ Public পেজ শুধু Published Landing-ই দেখায়। আগে Landings পেজ থেকে Publish করুন।",
    en: "This Landing is now in \"{{landingStatus}}\" status — only a Published Landing can be placed in an Ad, because the Public page only shows Published Landings. Publish it from the Landings page first.",
  },
  "campaigns.thisPlanAlreadyHasAnActive": {
    bn: "এই Plan-এ ইতিমধ্যে একটি Active Holdout Definition আছে — নতুন বানাতে চাইলে আগেরটি শেষ (End) করুন",
    en: "This Plan already has an Active Holdout Definition — End the previous one to create a new one",
  },
  "campaigns.noAdInThisPlanHas": {
    bn: "এই Plan-এর কোনো Ad-তেই Product যুক্ত নেই — Landing Page Product ছাড়া তৈরি হয় না।",
    en: "No Ad in this Plan has a Product attached — a Landing Page is not created without a Product.",
  },
  "campaigns.notEnoughProductsWereFoundFor": {
    bn: "এই Product Set-এর শর্তে যথেষ্ট Product পাওয়া যায়নি (পাওয়া গেছে {{productsLength}}টি, Carousel-এ কমপক্ষে ২টি লাগে) — Set-এর শর্ত শিথিল করুন বা Product যোগ করুন।",
    en: "Not enough Products were found for this Product Set's conditions (found {{productsLength}}, a Carousel needs at least 2) — loosen the Set's conditions or add Products.",
  },
  "campaigns.thisRuleIsNotAttachedTo": {
    bn: "এই Rule টি এই Plan-এ যুক্ত নয়",
    en: "This Rule is not attached to this Plan",
  },
  "campaigns.youHaveNotBeenGivenPermission": {
    bn: "এই বিজ্ঞাপন অ্যাকাউন্টে ক্যাম্পেইন চালু/প্রকাশ করার অনুমতি আপনাকে দেওয়া হয়নি — Connect Center-এর অ্যাক্সেস সেটিংস দেখুন বা OWNER/ADMIN-কে বলুন।",
    en: "You have not been given permission to run/publish campaigns on this ad account — see the access settings in the Connect Center or ask an OWNER/ADMIN.",
  },
  "campaigns.aDraftHasAlreadyBeenCreated": {
    bn: "এই সিগন্যাল থেকে ইতিমধ্যে Draft তৈরি হয়েছে",
    en: "A Draft has already been created from this signal",
  },
  "campaigns.thisRecommendationIsNotAppliedFrom": {
    bn: "এই সুপারিশ এখান থেকে প্রয়োগ হয় না — Budget Shift-এর জন্য Recommendation-এর Apply বোতাম (বা Live Budget Edit), Pause-এর জন্য Ad Set Pause বোতাম ব্যবহার করুন (সবই বিদ্যমান স্পষ্ট পথ)।",
    en: "This recommendation is not applied from here — for a Budget Shift use the Recommendation's Apply button (or Live Budget Edit), for a Pause use the Ad Set Pause button (all existing explicit paths).",
  },
  "campaigns.theSameRegionIsInBoth": {
    bn: "একই Region দুই দলেই আছে: {{p1}} — একটি Region হয় Test, নয় Holdout",
    en: "The same Region is in both groups: {{p1}} — a Region is either Test or Holdout",
  },
  "campaigns.atMost50PlansAtA": {
    bn: "একবারে সর্বোচ্চ ৫০টি Plan",
    en: "At most 50 Plans at a time",
  },
  "campaigns.thisIsAPlatformBlueprintClone": {
    bn: "এটি Platform Blueprint — বদলাতে হলে আগে নিজের কপি বানান (Clone)।",
    en: "This is a Platform Blueprint — Clone it first to change it.",
  },
  "campaigns.noNamingTemplateIsSetSet": {
    bn: "কোনো Naming Template সেট করা নেই — আগে Organization Settings / Campaign Settings-এ Template বসান",
    en: "No Naming Template is set — set the Template in Organization Settings / Campaign Settings first",
  },
  "campaigns.noRegionHasAnyConversionA": {
    bn: "কোনো Region-এই কনভার্সন নেই — শীর্ষ Region দিয়ে Draft বানানো যাচ্ছে না",
    en: "No Region has any conversion — a Draft cannot be made with the top Region",
  },
  "campaigns.noRegionSMetaKeyCould": {
    bn: "কোনো Region-এরই Meta Key resolve হয়নি — Draft বানানো যাচ্ছে না। {{p1}}",
    en: "No Region's Meta Key could be resolved — a Draft cannot be made. {{p1}}",
  },
  "campaigns.inTwoStepApprovalTheSecond": {
    bn: "দুই ধাপের অনুমোদনে দ্বিতীয় অনুমোদনটি অন্য একজন Approver-এর হতে হবে — Two-step approval requires a DIFFERENT second approver; your step-1 approval is already recorded.",
    en: "In two-step approval, the second approval must come from a DIFFERENT approver; your step-1 approval is already recorded.",
  },
  "campaigns.theDailyBudgetMustBeA": {
    bn: "দৈনিক বাজেট ধনাত্মক সংখ্যা হতে হবে",
    en: "The daily budget must be a positive number",
  },
  "campaigns.atLeastOneAllocationMustBe": {
    bn: "প্রয়োগের জন্য অন্তত একটি Allocation পাঠাতে হবে",
    en: "At least one Allocation must be sent to apply",
  },
  "campaigns.atLeastOneNameMustBe": {
    bn: "প্রয়োগের জন্য অন্তত একটি নাম পাঠাতে হবে",
    en: "At least one name must be sent to apply",
  },
  "campaigns.theProposalSAdSetWas": {
    bn: "প্রস্তাবের Ad Set পাওয়া যায়নি",
    en: "The proposal's Ad Set was not found",
  },
  "campaigns.theSelectedAdHasNoProduct": {
    bn: "বেছে নেওয়া Ad-টিতে কোনো Product যুক্ত নেই — Landing Page Product ছাড়া তৈরি হয় না। Ad-তে Product বাছাই করুন, অথবা Product-সহ অন্য Ad বেছে নিন।",
    en: "The selected Ad has no Product attached — a Landing Page is not created without a Product. Select a Product on the Ad, or choose another Ad with a Product.",
  },
  "campaigns.theTotalExtraBudgetMustBe": {
    bn: "মোট অতিরিক্ত বাজেট ধনাত্মক হতে হবে (minor units)",
    en: "The total extra budget must be positive (minor units)",
  },
  "campaigns.onlyNewSignalsCanBeDismissed": {
    bn: "শুধু 'new' অবস্থার সিগন্যাল Dismiss করা যায় — Drafted সিগন্যালের ইতিহাস থাকে",
    en: "Only 'new' signals can be Dismissed — Drafted signals keep their history",
  },
  "campaigns.pauseWindowsCanOnlyBeSet": {
    bn: "শুধু Published Plan-এ Pause Window বসানো যায় — Pause Live Campaign-এর জন্যই অর্থবহ",
    en: "Pause Windows can only be set on Published Plans — Pause is meaningful only for Live Campaigns",
  },
  "campaigns.onlyACreatedDraftSPlatform": {
    bn: "শুধু তৈরি (created) Draft-এরই প্ল্যাটফর্ম Status বদলানো যায় — এই Draft-এর Status \"{{draftStatus}}\"{{p2}}।",
    en: "Only a created Draft's platform Status can be changed — this Draft's Status is \"{{draftStatus}}\"{{p2}}.",
  },
  "campaigns.webPublicUrlAppPublicUrl": {
    bn: "সার্ভারে WEB_PUBLIC_URL/APP_PUBLIC_URL সেট নেই — Landing-এর পূর্ণ URL জানা যাচ্ছে না, তাই Ad-এ বসানো হয়নি (আপেক্ষিক Path Meta-র কাছে পৌঁছাবে না)।",
    en: "WEB_PUBLIC_URL/APP_PUBLIC_URL is not set on the server — the Landing's full URL is unknown, so it was not placed in the Ad (a relative Path will not reach Meta).",
  },
  "campaigns.theSignalTextMustBeAt": {
    bn: "সিগন্যালের লেখা কমপক্ষে {{CampaignsServiceBUILDER_SIGNAL_MIN_CHARS}} অক্ষরের হতে হবে",
    en: "The signal text must be at least {{CampaignsServiceBUILDER_SIGNAL_MIN_CHARS}} characters",
  },
  "campaigns.theSignalTextCanBeAt": {
    bn: "সিগন্যালের লেখা সর্বোচ্চ {{CampaignsServiceBUILDER_SIGNAL_MAX_CHARS}} অক্ষর",
    en: "The signal text can be at most {{CampaignsServiceBUILDER_SIGNAL_MAX_CHARS}} characters",
  },
  "campaigns.adTextAlreadyLooksBengali": {
    bn: "Ad-এর Text এমনিতেই বাংলায় আছে বলে মনে হচ্ছে (Script দেখে আন্দাজ) — আবার অনুবাদের দরকার নেই",
    en: "The Ad's Text already looks like it is in Bengali (guessed from the script) — no need to translate again",
  },
  "campaigns.adTextAlreadyLooksEnglish": {
    bn: "Ad-এর Text এমনিতেই English-এ আছে বলে মনে হচ্ছে (Script দেখে আন্দাজ) — আবার অনুবাদের দরকার নেই",
    en: "The Ad's Text already looks like it is in English (guessed from the script) — no need to translate again",
  },
  "campaigns.budgetShiftNoCurrentProposal": {
    bn: "এই মুহূর্তে কোনো Budget Shift প্রস্তাব নেই — ডেটা বদলে গেছে। নতুন প্রস্তাব দেখে আবার নিশ্চিত করুন।",
    en: "There is no Budget Shift proposal right now — the data has changed. Review the new proposal and confirm again.",
  },
  "campaigns.budgetShiftNumbersChanged": {
    bn: "সংখ্যা বদলে গেছে — আপনি যে প্রস্তাব দেখে নিশ্চিত করেছিলেন তা আর হুবহু নেই। নতুন প্রস্তাবটি দেখে আবার নিশ্চিত করুন; পুরনো সংখ্যা প্রয়োগ হয়নি।",
    en: "The numbers have changed — the proposal you confirmed is no longer exactly the same. Review the new proposal and confirm again; the old numbers were not applied.",
  },  "campaigns.geoHoldoutMethod": {
    bn: "এটি Meta Experiment নয় — Ad Study-তে Geo Split নেই (CA19 spike, Meta-র অফিসিয়াল ডকুমেন্টেশন)। এটি সংরক্ষিত Region Breakdown Row-এর পর্যবেক্ষণমূলক (observational) তুলনা: Test ও Holdout Region-এর জনসংখ্যা, চাহিদা ও প্রতিযোগিতা আলাদা, তাই দুই পাশের পার্থক্য মানেই বিজ্ঞাপনের কারণে হওয়া প্রভাব (lift) নয়",
    en: "This is not a Meta Experiment — Ad Study has no Geo Split (CA19 spike, Meta's official documentation). It is an observational comparison of stored Region Breakdown Rows: Test and Holdout regions differ in population, demand and competition, so a difference between the two sides does not by itself mean an advertising-caused effect (lift).",
  },
  "campaigns.geoHoldoutDeliveryNote": {
    bn: "এই Definition নিজে থেকে Delivery বদলায় না — Holdout Region-এ বিজ্ঞাপন বন্ধ রাখতে চাইলে Plan-এর Targeting থেকে ওই Region বাদ দিতে হবে; Definition শুধু কোন Region কোন দলে তা মনে রাখে আর Window জুড়ে আসল Breakdown Row তুলনা করে",
    en: "This definition does not change delivery by itself — to keep ads off in a Holdout Region, exclude that region from the Plan's targeting; the definition only remembers which region is in which group and compares the actual Breakdown Rows across the window.",
  },
  "campaigns.geoHoldoutStoreUnavailable": {
    bn: "Geo Holdout Store পাওয়া যাচ্ছে না",
    en: "The Geo Holdout store is not available",
  },
  "campaigns.geoHoldoutNoneDefined": {
    bn: "এই Plan-এ কোনো Geo Holdout Definition নেই",
    en: "This Plan has no Geo Holdout definition",
  },
  "campaigns.geoHoldoutPlanNotPublished": {
    bn: "Plan এখনো Publish হয়নি — Measurement শুধু Publish হওয়া Campaign-এর সংরক্ষিত Breakdown Row থেকে আসে",
    en: "The Plan is not published yet — measurement comes only from the stored Breakdown Rows of a published Campaign",
  },
  "campaigns.geoHoldoutBreakdownStoreUnavailable": {
    bn: "Breakdown Store পাওয়া যাচ্ছে না",
    en: "The Breakdown store is not available",
  },
};
