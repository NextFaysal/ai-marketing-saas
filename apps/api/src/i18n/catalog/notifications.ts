/**
 * MB4 (ML11) — notifications catalog namespace (W-3 owned).
 *
 * Pure data: platform-authored notification content only —
 * order-notification platform defaults, voice TwiML fallback
 * lines, webpush validation/system messages and the
 * order-notification config validator messages. Merchant-authored
 * templates (MessageTemplate rows, OrderNotificationSetting
 * overrides) are NOT here and are never translated (D-MB4-5).
 *
 * Shape per CD-2: `{ bn, en }` per key, `{{param}}` syntax
 * (D-MB4-10). The bn text is faithful to the pre-MB4 originals;
 * where the original was English-only, the en text is faithful
 * and the bn text is the translation.
 */
export const NOTIFICATIONS_CATALOG = {
  // ---- ON5 platform default templates (were BN-only code defaults) ----
  "orderNotification.default.order_placed": {
    bn: "আসসালামু আলাইকুম {{customerName}}, {{shopName}} থেকে আপনার অর্ডার {{orderNumber}} গ্রহণ করা হয়েছে। মোট: {{total}}। ধন্যবাদ!",
    en: "Hello {{customerName}}, your order {{orderNumber}} from {{shopName}} has been received. Total: {{total}}. Thank you!",
  },
  "orderNotification.default.order_packed": {
    bn: "আসসালামু আলাইকুম {{customerName}}, আপনার অর্ডার {{orderNumber}} প্যাক করা হয়েছে — শীঘ্রই কুরিয়ারে দেওয়া হবে। — {{shopName}}",
    en: "Hello {{customerName}}, your order {{orderNumber}} has been packed and will be handed to the courier soon. — {{shopName}}",
  },
  "orderNotification.default.handed_to_courier": {
    bn: "আসসালামু আলাইকুম {{customerName}}, আপনার অর্ডার {{orderNumber}} {{courierName}} কুরিয়ারে দেওয়া হয়েছে। ট্র্যাকিং কোড: {{trackingCode}}। ট্র্যাক করুন: {{trackingUrl}} — {{shopName}}",
    en: "Hello {{customerName}}, your order {{orderNumber}} has been handed to {{courierName}} courier. Tracking code: {{trackingCode}}. Track here: {{trackingUrl}} — {{shopName}}",
  },
  "orderNotification.default.out_for_delivery": {
    bn: "আসসালামু আলাইকুম {{customerName}}, আপনার অর্ডার {{orderNumber}} আজ ডেলিভারির জন্য বের হয়েছে ({{courierName}})। বকেয়া: {{due}}। — {{shopName}}",
    en: "Hello {{customerName}}, your order {{orderNumber}} is out for delivery today ({{courierName}}). Amount due: {{due}}. — {{shopName}}",
  },
  "orderNotification.default.delivered": {
    bn: "আসসালামু আলাইকুম {{customerName}}, আপনার অর্ডার {{orderNumber}} ডেলিভারি সম্পন্ন হয়েছে। {{shopName}} থেকে কেনাকাটা করার জন্য ধন্যবাদ!",
    en: "Hello {{customerName}}, your order {{orderNumber}} has been delivered. Thank you for shopping with {{shopName}}!",
  },
  "orderNotification.default.delivery_failed": {
    bn: "আসসালামু আলাইকুম {{customerName}}, দুঃখিত — আপনার অর্ডার {{orderNumber}} ডেলিভারি করা যায়নি। বিস্তারিত জানতে {{shopName}}-এ যোগাযোগ করুন।",
    en: "Hello {{customerName}}, sorry — your order {{orderNumber}} could not be delivered. Please contact {{shopName}} for details.",
  },
  "orderNotification.default.parcel_stuck": {
    bn: "আসসালামু আলাইকুম {{customerName}}, আপনার অর্ডার {{orderNumber}}-এর পার্সেলটি ({{courierName}}, ট্র্যাকিং: {{trackingCode}}) আটকে আছে বলে মনে হচ্ছে — আমরা খোঁজ নিচ্ছি। — {{shopName}}",
    en: "Hello {{customerName}}, the parcel for your order {{orderNumber}} ({{courierName}}, tracking: {{trackingCode}}) appears to be stuck — we are looking into it. — {{shopName}}",
  },
  "orderNotification.default.delivery_rescheduled": {
    bn: "আসসালামু আলাইকুম {{customerName}}, আপনার অর্ডার {{orderNumber}}-এর ডেলিভারি পুনঃনির্ধারণ করা হয়েছে। ট্র্যাক করুন: {{trackingUrl}} — {{shopName}}",
    en: "Hello {{customerName}}, the delivery of your order {{orderNumber}} has been rescheduled. Track here: {{trackingUrl}} — {{shopName}}",
  },
  "orderNotification.emailSubject": {
    bn: "অর্ডার {{orderNumber}} — {{shopName}}",
    en: "Order {{orderNumber}} — {{shopName}}",
  },
  "orderNotification.orderNotFound": {
    bn: "এই সংস্থায় অর্ডারটি পাওয়া যায়নি",
    en: "Order not found in this organization",
  },
  // ---- ON5 config validator (order-notifications.ts validateConfig) ----
  "orderNotification.config.notObject": {
    bn: "notification config একটি object হতে হবে",
    en: "Notification config must be an object",
  },
  "orderNotification.config.unknownEvent": {
    bn: "অজানা notification event: \"{{eventKey}}\" — সঠিক event: {{events}}",
    en: "Unknown notification event: \"{{eventKey}}\" — valid events: {{events}}",
  },
  "orderNotification.config.eventNotObject": {
    bn: "\"{{eventKey}}\" event-এর config একটি object হতে হবে",
    en: "The config for event \"{{eventKey}}\" must be an object",
  },
  "orderNotification.config.enabledNotBoolean": {
    bn: "\"{{eventKey}}\" event-এর enabled boolean হতে হবে",
    en: "The enabled flag for event \"{{eventKey}}\" must be a boolean",
  },
  "orderNotification.config.channelsNotArray": {
    bn: "\"{{eventKey}}\" event-এর channels একটি array হতে হবে",
    en: "The channels for event \"{{eventKey}}\" must be an array",
  },
  "orderNotification.config.unknownChannel": {
    bn: "\"{{eventKey}}\" event-এ অজানা channel: \"{{channel}}\" — সঠিক channel: {{channels}}",
    en: "Unknown channel \"{{channel}}\" in event \"{{eventKey}}\" — valid channels: {{channels}}",
  },
  "orderNotification.config.templatesNotObject": {
    bn: "\"{{eventKey}}\" event-এর templates একটি object হতে হবে",
    en: "The templates for event \"{{eventKey}}\" must be an object",
  },
  "orderNotification.config.templatesUnknownChannel": {
    bn: "\"{{eventKey}}\" event-এর templates-এ অজানা channel: \"{{channel}}\"",
    en: "Unknown channel \"{{channel}}\" in the templates of event \"{{eventKey}}\"",
  },
  "orderNotification.config.templateNotString": {
    bn: "\"{{eventKey}}\" event-এর {{channel}} template string অথবা null হতে হবে",
    en: "The {{channel}} template of event \"{{eventKey}}\" must be a string or null",
  },
  "orderNotification.config.unknownVariable": {
    bn: "\"{{eventKey}}\" event-এর {{channel}} template-এ অজানা variable: \"{{{{variable}}}}\" — সঠিক variable: {{variables}}",
    en: "Unknown variable \"{{{{variable}}}}\" in the {{channel}} template of event \"{{eventKey}}\" — valid variables: {{variables}}",
  },
  // ---- Voice TwiML fallback lines (voice.service / voice-conversation) ----
  "voice.callNotFound": {
    bn: "অর্ডার কল পাওয়া যায়নি।",
    en: "The order call could not be found.",
  },
  "voice.noResponse": {
    bn: "আমরা কোনো সাড়া পাইনি। ধন্যবাদ।",
    en: "We did not receive a response. Thank you.",
  },
  "voice.confirmed": {
    bn: "ধন্যবাদ! আপনার অর্ডারটি নিশ্চিত করা হয়েছে। আমরা দ্রুত ডেলিভারির ব্যবস্থা করছি।",
    en: "Thank you! Your order has been confirmed. We are arranging delivery as quickly as possible.",
  },
  "voice.rejected": {
    bn: "আপনার অর্ডারটি বাতিলের অনুরোধ গ্রহণ করা হয়েছে। ধন্যবাদ।",
    en: "Your request to cancel the order has been received. Thank you.",
  },
  "voice.defaultPrompt": {
    bn: "আপনার অর্ডারটি নিশ্চিত করতে ১ চাপুন, বাতিল করতে ২ চাপুন।",
    en: "Press 1 to confirm your order, or press 2 to cancel it.",
  },
  "voice.followUpTitle": {
    bn: "ভয়েস কল ফলো-আপ প্রয়োজন (WhatsApp — ম্যানুয়াল)",
    en: "Voice call follow-up needed (WhatsApp — manual)",
  },
  "voice.followUpBody": {
    bn: "অর্ডার {{orderId}}-এর গ্রাহককে ভয়েস কলে পাওয়া যায়নি। অনুগ্রহ করে ইনবক্স থেকে WhatsApp-এ ম্যানুয়ালি ফলো-আপ করুন — কোনো স্বয়ংক্রিয় বার্তা পাঠানো হয়নি।",
    en: "The customer for order {{orderId}} could not be reached by voice call. Please follow up manually on WhatsApp from the inbox — no automated message has been sent.",
  },
  "voice.orderNotFound": {
    bn: "অর্ডারটি পাওয়া যায়নি",
    en: "Order not found",
  },
  "voice.callRecordNotFound": {
    bn: "কলের রেকর্ড পাওয়া যায়নি",
    en: "Call record not found",
  },
  "voice.notCodOrder": {
    bn: "এটি একটি ক্যাশ অন ডেলিভারি (COD) অর্ডার নয়",
    en: "This is not a cash on delivery (COD) order",
  },
  "voice.phoneMissing": {
    bn: "গ্রাহকের ফোন নম্বর পাওয়া যায়নি — সঠিক মোবাইল নম্বর নিশ্চিত করুন",
    en: "The customer's phone number was not found — make sure a correct mobile number is on the order",
  },
  "voice.conversationModeInvalid": {
    bn: "conversationMode শুধু simulation অথবা twilio_relay হতে পারে",
    en: "conversationMode must be simulation or twilio_relay",
  },
  "voice.agentNotEnabled": {
    bn: "ভয়েস কনভারসেশন এজেন্ট চালু নেই — প্রথমে ভয়েস সেটিংসে enabled ও conversationAgentEnabled চালু করুন",
    en: "The voice conversation agent is not enabled — first turn on enabled and conversationAgentEnabled in voice settings",
  },
  "voice.maxAttemptsReached": {
    bn: "এই অর্ডারের জন্য সর্বোচ্চ {{max}} বার কল চেষ্টা করা হয়েছে — আর কল করা যাবে না",
    en: "The maximum of {{max}} call attempts has been reached for this order — no more calls can be made",
  },
  "voice.relayNotConfigured": {
    bn: "ConversationRelay কনফিগার করা নেই — conversationMode=twilio_relay ও relayWebsocketUrl সেট করুন (relay not configured)",
    en: "ConversationRelay is not configured — set conversationMode=twilio_relay and relayWebsocketUrl (relay not configured)",
  },
  "voice.aiDisabledForOrg": {
    bn: "প্ল্যাটফর্ম টিম এই সংস্থার জন্য AI features সাময়িকভাবে বন্ধ করে রেখেছে।",
    en: "AI features are temporarily disabled for this organization by the platform team.",
  },
  "voice.staffDeliveryTimeTitle": {
    bn: "ভয়েস কল: ডেলিভারি সময় পরিবর্তনের অনুরোধ",
    en: "Voice call: delivery time change request",
  },
  "voice.staffDeliveryTimeBody": {
    bn: "অর্ডার {{orderId}}-এর গ্রাহক ভয়েস কলে ডেলিভারির সময় বদলাতে চেয়েছেন: {{timeText}}। অর্ডারের অভ্যন্তরীণ নোটে এটি লেখা হয়েছে — অনুগ্রহ করে ব্যবস্থা নিন।",
    en: "The customer for order {{orderId}} asked on a voice call to change the delivery time: {{timeText}}. It has been written in the order's internal note — please take action.",
  },
  "voice.staffHumanTitle": {
    bn: "ভয়েস কল: গ্রাহক কর্মীর সঙ্গে কথা বলতে চান",
    en: "Voice call: customer wants to talk to a staff member",
  },
  "voice.staffHumanBody": {
    bn: "অর্ডার {{orderId}}-এর গ্রাহক ভয়েস কলে কর্মীর সঙ্গে কথা বলতে চেয়েছেন ({{reason}})। অনুগ্রহ করে গ্রাহককে কল করুন।",
    en: "The customer for order {{orderId}} asked on a voice call to talk to a staff member ({{reason}}). Please call the customer.",
  },
  "voice.summaryDeliveryTimeUnverified": {
    bn: "অর্ডার {{orderId}}: ডেলিভারি সময়ের নোট যাচাই করা যায়নি",
    en: "Order {{orderId}}: the delivery time note could not be verified",
  },
  "voice.summaryDeliveryTimeChanged": {
    bn: "অর্ডার {{orderId}}: গ্রাহক ভয়েস কলে ডেলিভারির সময় বদলাতে চেয়েছেন — {{timeText}}",
    en: "Order {{orderId}}: the customer asked on a voice call to change the delivery time — {{timeText}}",
  },
  "voice.summaryHumanHandoff": {
    bn: "অর্ডার {{orderId}}: গ্রাহককে কর্মীর কাছে হস্তান্তর করা হয়েছে ({{reason}})।",
    en: "Order {{orderId}}: the customer was handed over to a staff member ({{reason}}).",
  },
  // ---- WebPush validation / system messages (webpush.service) ----
  "webpush.promptDelayRange": {
    bn: "প্রম্পট দেখানোর বিলম্ব ৫ থেকে ৩০০ সেকেন্ডের মধ্যে হতে হবে",
    en: "The prompt display delay must be between 5 and 300 seconds",
  },
  "webpush.shopNotFound": {
    bn: "দোকানটি পাওয়া যায়নি",
    en: "Shop not found",
  },
  "webpush.endpointInvalid": {
    bn: "সাবস্ক্রিপশনের endpoint সঠিক নয়",
    en: "The subscription endpoint is not valid",
  },
  "webpush.endpointMustBeHttps": {
    bn: "সাবস্ক্রিপশনের endpoint অবশ্যই https হতে হবে",
    en: "The subscription endpoint must be https",
  },
  "webpush.keysInvalid": {
    bn: "সাবস্ক্রিপশনের keys সঠিক নয়",
    en: "The subscription keys are not valid",
  },
  "webpush.pushDisabledForShop": {
    bn: "এই দোকানে ওয়েব পুশ এখন চালু নেই",
    en: "Web push is not enabled for this shop right now",
  },
  "webpush.titleRequired": {
    bn: "পুশের শিরোনাম আবশ্যক এবং সর্বোচ্চ ১২০ অক্ষরের হতে হবে",
    en: "A push title is required and must be at most 120 characters",
  },
  "webpush.bodyRequired": {
    bn: "পুশের বার্তা আবশ্যক এবং সর্বোচ্চ ৩০০ অক্ষরের হতে হবে",
    en: "A push body is required and must be at most 300 characters",
  },
  "webpush.linkMustBeOwnShop": {
    bn: "পুশের লিংক অবশ্যই দোকানের নিজের পেজের হতে হবে (যেমন /sale) — বাইরের লিংক দেওয়া যাবে না",
    en: "The push link must be a page of the shop itself (e.g. /sale) — external links are not allowed",
  },
  "webpush.vapidNotCreated": {
    bn: "ওয়েব পুশের VAPID key এখনো তৈরি হয়নি — আগে সেটিংসে পুশ চালু করুন",
    en: "The web push VAPID keys have not been created yet — enable push in settings first",
  },
  "webpush.campaignPushDisabled": {
    bn: "ওয়েব পুশ চালু না থাকলে ক্যাম্পেইন পাঠানো যাবে না — আগে সেটিংসে পুশ চালু করুন",
    en: "Campaigns cannot be sent while web push is disabled — enable push in settings first",
  },
  "webpush.campaignNotFound": {
    bn: "পুশ ক্যাম্পেইনটি পাওয়া যায়নি",
    en: "Push campaign not found",
  },
} as const;

export type NotificationsCatalogKey = keyof typeof NOTIFICATIONS_CATALOG;

/** Coordinator wiring alias (catalog/index.ts convention). */
export const notificationsCatalog = NOTIFICATIONS_CATALOG;
