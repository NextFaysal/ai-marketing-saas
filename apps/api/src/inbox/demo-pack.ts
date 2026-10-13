import { formatMinor } from "@repo/contracts";

/**
 * Demo Chat Pack — pure scenario builder (extends CX12a Practice Mode).
 *
 * Builds the FULL data for 12 labelled demo conversations covering the
 * whole inbox surface (full order flow, product card, complaint +
 * handover, VIP, image product match, webchat, voice order, To Chase,
 * email, delivered + review/CSAT, snoozed, fresh unassigned). Every
 * conversation is a PRACTICE row: isPractice true, integrationId null,
 * externalContactId `practice-demo-<slug>`, contactName prefixed
 * "🎬 Demo: ". Outbound rows carry status "practice" — the exact
 * status InboxService.deliverText stores for practice sends — so a
 * demo thread can never pose as a real platform delivery, and the
 * isPractice send guard (proven in the spec) covers every one of
 * them even though their channel names are real.
 *
 * This module is PURE: no prisma, no I/O. PracticeService.loadDemoPack
 * persists what it returns. Orders are plain row data for the service
 * to create directly (NOT via createChatOrder): customerId stays null,
 * no Customer row is ever built here or there, stock is never touched.
 * CourierShipment is deliberately NOT part of the pack: the shipment
 * widget only renders for customer-linked orders and the courier sync
 * path has no practice guard, so a demo shipment would be a lie.
 */

export interface DemoPackScenarioMeta {
  slug: string;
  title: string;
  feature: string;
}

/** The 12 scenarios, in pack order. The Web UI uses these exact
 * title/feature strings — do not reword without updating the UI. */
export const DEMO_PACK_SCENARIOS: DemoPackScenarioMeta[] = [
  { slug: "wa-full-order", title: "WhatsApp — পূর্ণ অর্ডার ফ্লো", feature: "দাম জিজ্ঞাসা → AI উত্তর → COD অর্ডার → order-এর পুরো যাত্রা" },
  { slug: "msgr-product-card", title: "Messenger — Product Card", feature: "Product card, quote reply, reaction ও agent-এর উত্তর" },
  { slug: "msgr-complaint-handover", title: "Messenger — অভিযোগ ও Handover", feature: "Negative sentiment, handover queue, SLA সতর্কতা, internal note ও @mention" },
  { slug: "wa-vip", title: "WhatsApp — VIP Customer", feature: "VIP tag, বড় অর্ডার, priority ও customer context" },
  { slug: "ig-image-product", title: "Instagram — ছবি দিয়ে Product", feature: "ছবির বার্তা ও product-match উত্তরের নমুনা" },
  { slug: "webchat-visitor", title: "Webchat — Website Visitor", feature: "ওয়েবসাইট চ্যাটের সাধারণ জিজ্ঞাসা ও চলমান কথোপকথন" },
  { slug: "wa-voice-order", title: "WhatsApp — Voice Note-এ অর্ডার", feature: "Voice transcription ও অর্ধেক অর্ডার" },
  { slug: "msgr-to-chase", title: "Messenger — অসম্পূর্ণ অর্ডার (To Chase)", feature: "আটকে থাকা order bot session ও chase-এর ধারণা" },
  { slug: "email-support", title: "Email — Support Thread", feature: "Subjectসহ লম্বা support জিজ্ঞাসা" },
  { slug: "wa-delivered-review", title: "WhatsApp — Delivered + Review", feature: "Delivered অবস্থা, CSAT rating ও review উত্তর" },
  { slug: "tg-snoozed", title: "Telegram — Snoozed", feature: "Snooze — পরে জাগবে এমন কথোপকথন" },
  { slug: "wa-unassigned-new", title: "WhatsApp — নতুন Unassigned", feature: "অনির্ধারিত ও অপঠিত — smart folder ও assign" },
];

export interface DemoPackProduct {
  id: string;
  name: string;
  priceMinor: bigint;
  currency: string;
}

export interface DemoPackMessage {
  direction: "in" | "out";
  type: string;
  content: string | null;
  status: string;
  autoReply?: boolean;
  sentByUserId?: string | null;
  intent?: string | null;
  transcription?: string | null;
  transcriptionStatus?: string | null;
  transcriptionProvider?: string | null;
  mediaUrl?: string | null;
  deliveryStatus?: string | null;
  deliveredAt?: Date | null;
  readAt?: Date | null;
  /** Symbolic quote target: the index (in this scenario's messages
   * array) of the message this one quotes. The service resolves it
   * to the created row's real id — ids do not exist at build time. */
  quoteRef?: number;
  replyToMessageId?: string | null;
  reactions?: unknown;
  pinnedAt?: Date | null;
  pinnedBy?: string | null;
  createdAt: Date;
  platformTimestamp: Date;
}

export interface DemoPackOrderItem {
  productId: string | null;
  name: string;
  quantity: number;
  priceMinor: bigint;
  totalMinor: bigint;
}

export interface DemoPackOrder {
  externalId: string;
  externalNumber: string;
  source: string;
  status: string;
  paymentMethod: string;
  isCod: boolean;
  storeSyncStatus: string;
  customerId: null;
  isPractice: true;
  address: string;
  currency: string;
  subtotalMinor: bigint;
  shippingMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  placedAt: Date;
  items: DemoPackOrderItem[];
}

export interface DemoPackScenario extends DemoPackScenarioMeta {
  conversation: Record<string, unknown>;
  messages: DemoPackMessage[];
  note?: { content: string };
  orders?: DemoPackOrder[];
  botSession?: { state: string; status: string; data: Record<string, unknown> };
}

const FALLBACK_ITEM_NAME = "🎬 Demo পণ্য — নমুনা আইটেম (আসল ক্যাটালগে নেই)";
const FALLBACK_PRICE_MINOR = 120000n;
const SHIPPING_MINOR = 6000n;

export function buildDemoPack(ctx: {
  now: Date;
  actorId: string;
  product: DemoPackProduct | null;
}): DemoPackScenario[] {
  const now = ctx.now;
  const actorId = ctx.actorId;
  const product = ctx.product;
  const itemName = product?.name ?? FALLBACK_ITEM_NAME;
  const unitPrice = product?.priceMinor ?? FALLBACK_PRICE_MINOR;
  const currency = product?.currency ?? "BDT";
  const priceText = formatMinor(unitPrice, currency);

  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60000);
  const ahead = (minutes: number) => new Date(now.getTime() + minutes * 60000);

  let orderSeq = 1000;
  function makeOrder(slug: string, perScenarioN: number, quantity: number, status: string, placedMinutesAgo: number, address: string): DemoPackOrder {
    orderSeq += 1;
    const subtotal = unitPrice * BigInt(quantity);
    return {
      externalId: `demo-order-${slug}-${perScenarioN}`,
      externalNumber: `DEMO-${orderSeq}`,
      source: "chat",
      status,
      paymentMethod: "cod",
      isCod: true,
      storeSyncStatus: "local_only",
      customerId: null,
      isPractice: true,
      address,
      currency,
      subtotalMinor: subtotal,
      shippingMinor: SHIPPING_MINOR,
      discountMinor: 0n,
      taxMinor: 0n,
      totalMinor: subtotal + SHIPPING_MINOR,
      placedAt: at(placedMinutesAgo),
      items: [{
        productId: product?.id ?? null,
        name: itemName,
        quantity,
        priceMinor: unitPrice,
        totalMinor: subtotal,
      }],
    };
  }

  function msg(partial: Partial<DemoPackMessage> & { direction: "in" | "out"; minutesAgo: number }): DemoPackMessage {
    const { minutesAgo, ...rest } = partial;
    const ts = at(minutesAgo);
    return {
      type: "text",
      content: null,
      status: partial.direction === "in" ? "received" : "practice",
      ...rest,
      createdAt: ts,
      platformTimestamp: ts,
    } as DemoPackMessage;
  }

  function conv(partial: Record<string, unknown>): Record<string, unknown> {
    return {
      integrationId: null,
      customerId: null,
      isPractice: true,
      status: "open",
      pipelineStage: "new",
      priority: "normal",
      sentimentFlag: null,
      tags: [],
      assignedUserId: null,
      autoReplyPaused: false,
      handoverReason: null,
      handoverAt: null,
      firstResponseAt: null,
      unreadCount: 0,
      snoozedUntil: null,
      subject: null,
      outcome: null,
      ...partial,
    };
  }

  const meta = (slug: string) => DEMO_PACK_SCENARIOS.find((s) => s.slug === slug)!;
  const scenarios: DemoPackScenario[] = [];

  // ---------------------------------------------------------------
  // 1. wa-full-order — price ask → grounded AI answer → details →
  //    confirmed COD order. Anchor: starts ~2 hours ago.
  // ---------------------------------------------------------------
  {
    const order = makeOrder("wa-full-order", 1, 1, "pending", 95, "বাড়ি ১২, রোড ৫, ধানমন্ডি, ঢাকা");
    const totalText = formatMinor(order.totalMinor, currency);
    const messages = [
      msg({ direction: "in", minutesAgo: 120, intent: "price", content: "আসসালামু আলাইকুম, এই কটন শাড়িটার দাম কত? ঢাকায় ডেলিভারি চার্জ কত টাকা?" }),
      msg({
        direction: "out", minutesAgo: 118, autoReply: true,
        deliveryStatus: "read", deliveredAt: at(117), readAt: at(116),
        content: `আসসালামু আলাইকুম! 🌸 "${itemName}"-এর দাম ${priceText}। ঢাকার ভিতরে ডেলিভারি চার্জ ৳৬০, আর ক্যাশ অন ডেলিভারিতে পেমেন্ট করতে পারবেন — পণ্য হাতে পেয়ে টাকা দিলেই হবে।`,
      }),
      msg({ direction: "in", minutesAgo: 110, intent: "order", content: "দাম ঠিক আছে, আমি একটা অর্ডার করতে চাই।" }),
      msg({ direction: "out", minutesAgo: 108, autoReply: true, content: "অবশ্যই! 😊 অর্ডারের জন্য আপনার নাম, মোবাইল নম্বর আর পুরো ঠিকানা এই চ্যাটেই পাঠান।" }),
      msg({ direction: "in", minutesAgo: 100, content: "নাম: রহিম উদ্দিন, ফোন: 01711111111, ঠিকানা: বাড়ি ১২, রোড ৫, ধানমন্ডি, ঢাকা", pinnedAt: at(99), pinnedBy: actorId }),
      msg({
        direction: "out", minutesAgo: 95, autoReply: true,
        content: `ধন্যবাদ রহিম উদ্দিন! ✅ আপনার অর্ডার নিশ্চিত হয়েছে — অর্ডার নম্বর ${order.externalNumber}। পণ্য: ${itemName} × ১, মোট ${totalText} (ডেলিভারি চার্জসহ), ক্যাশ অন ডেলিভারি। ২-৩ কর্মদিবসে পৌঁছে যাবে ইনশাআল্লাহ।`,
      }),
    ];
    scenarios.push({
      ...meta("wa-full-order"),
      conversation: conv({
        channel: "whatsapp",
        externalContactId: "practice-demo-wa-full-order",
        contactName: "🎬 Demo: রহিম উদ্দিন (WhatsApp অর্ডার)",
        contactPhone: "01711111111",
        status: "open",
        pipelineStage: "ordered",
        assignedUserId: actorId,
        firstResponseAt: at(118),
        unreadCount: 0,
        createdAt: at(125),
        lastMessageAt: at(95),
        lastCustomerMessageAt: at(100),
        lastMessagePreview: messages[messages.length - 1].content!.slice(0, 120),
      }),
      messages,
      orders: [order],
    });
  }

  // ---------------------------------------------------------------
  // 2. msgr-product-card — price/stock ask → product card → agent
  //    quote-reply → customer ❤️ reaction on the card.
  // ---------------------------------------------------------------
  {
    const cardText = [
      `🛍️ ${itemName}`,
      `দাম: ${priceText}`,
      "অর্ডার করতে চাইলে আপনার নাম, ঠিকানা ও ফোন নম্বর এই চ্যাটেই পাঠান।",
    ].join("\n");
    const messages = [
      msg({ direction: "in", minutesAgo: 48, intent: "stock", content: "আপু, এই শাড়িটা কি স্টকে আছে? দাম কত পড়বে?" }),
      msg({
        direction: "out", minutesAgo: 45, content: cardText, sentByUserId: actorId,
        reactions: [{ emoji: "❤️", actor: "customer", at: at(38).toISOString() }],
      }),
      msg({ direction: "out", minutesAgo: 40, content: "জি, স্টকে আছে 😊 উপরের কার্ডে দামসহ সব তথ্য দেওয়া আছে। অর্ডার করতে চাইলে জানাবেন, সাথে সাথে কনফার্ম করে দেব।", sentByUserId: actorId, quoteRef: 0 }),
    ];
    scenarios.push({
      ...meta("msgr-product-card"),
      conversation: conv({
        channel: "messenger",
        externalContactId: "practice-demo-msgr-product-card",
        contactName: "🎬 Demo: শারমিন আক্তার (Product Card)",
        contactPhone: null,
        status: "open",
        pipelineStage: "talking",
        assignedUserId: actorId,
        firstResponseAt: at(45),
        createdAt: at(50),
        lastMessageAt: at(40),
        lastCustomerMessageAt: at(48),
        lastMessagePreview: messages[messages.length - 1].content!.slice(0, 120),
      }),
      messages,
    });
  }

  // ---------------------------------------------------------------
  // 3. msgr-complaint-handover — angry complaint, escalated 3h ago,
  //    still awaiting its first human response (SLA breach shape).
  // ---------------------------------------------------------------
  {
    const messages = [
      msg({ direction: "in", minutesAgo: 290, intent: "complaint", content: "আপনারা কী ধরনের সার্ভিস দেন?? অর্ডার করেছি ৫ দিন হলো, এখনো পণ্য পাইনি! কল ধরেন না, মেসেজের উত্তর দেন না। টাকা ফেরত চাই — এই রকম ধোঁকাবাজি একদমই ভালো লাগে না 😡" }),
      msg({ direction: "in", minutesAgo: 285, intent: "complaint", content: "কেউ উত্তর দিচ্ছেন না কেন? খুবই হতাশ হলাম। আজকের মধ্যে আপডেট না পেলে গ্রুপে পোস্ট দেব।" }),
    ];
    scenarios.push({
      ...meta("msgr-complaint-handover"),
      conversation: conv({
        channel: "messenger",
        externalContactId: "practice-demo-msgr-complaint-handover",
        contactName: "🎬 Demo: আরিফুল ইসলাম (অভিযোগ)",
        contactPhone: null,
        status: "open",
        pipelineStage: "talking",
        priority: "high",
        sentimentFlag: "negative",
        autoReplyPaused: true,
        // "complaint" is the escalateAutopilot vocabulary for a
        // complaint-intent escalation (inbox.service.ts).
        handoverReason: "complaint",
        handoverAt: at(180),
        firstResponseAt: null,
        unreadCount: 1,
        assignedUserId: null,
        createdAt: at(300),
        lastMessageAt: at(285),
        lastCustomerMessageAt: at(285),
        lastMessagePreview: messages[messages.length - 1].content!.slice(0, 120),
      }),
      messages,
      note: { content: "@owner এই কাস্টমার খুব রাগান্বিত — অর্ডার ৫ দিন ধরে আটকে আছে, এখনো কোনো আপডেট পায়নি। কুরিয়ার টিমের সাথে যাচাই করে আজই কল করে আপডেট দিতে হবে।" },
    });
  }

  // ---------------------------------------------------------------
  // 4. wa-vip — VIP tag, high priority, two large practice orders,
  //    a repeat buyer whose thread started 2 days ago.
  // ---------------------------------------------------------------
  {
    const orderA = makeOrder("wa-vip", 1, 3, "processing", 2860, "ফ্ল্যাট ৮বি, গুলশান এভিনিউ, গুলশান-১, ঢাকা");
    const orderB = makeOrder("wa-vip", 2, 2, "pending", 180, "ফ্ল্যাট ৮বি, গুলশান এভিনিউ, গুলশান-১, ঢাকা");
    const messages = [
      msg({ direction: "in", minutesAgo: 2870, content: "আপু, আগেরবারের শাড়ি দুটো খুব সুন্দর ছিল! এবার ঈদের জন্য আরও কয়েকটা নিতে চাই, পরিবারের সবার জন্য।" }),
      msg({ direction: "out", minutesAgo: 2860, sentByUserId: actorId, content: "অনেক ধন্যবাদ আপু! 🌸 আপনি আমাদের নিয়মিত কাস্টমার — আপনার অর্ডারটা আগের মতোই যত্নে পাঠিয়ে দিচ্ছি। ৩টা শাড়ির অর্ডার কনফার্ম করলাম।" }),
      msg({ direction: "in", minutesAgo: 200, content: "আরও ২টা যোগ করুন, মোট ৫টা হবে। আগের ঠিকানাতেই পাঠাবেন। মোট কত হলো জানাবেন।" }),
      msg({ direction: "out", minutesAgo: 180, sentByUserId: actorId, content: `কনফার্ম করেছি আপু ✅ নতুন ২টার অর্ডার (${orderB.externalNumber}) আগের ঠিকানায় যাচ্ছে, মোট ${formatMinor(orderB.totalMinor, currency)} ক্যাশ অন ডেলিভারি। VIP কাস্টমার হিসেবে ডেলিভারিতে অগ্রাধিকার থাকবে।` }),
    ];
    scenarios.push({
      ...meta("wa-vip"),
      conversation: conv({
        channel: "whatsapp",
        externalContactId: "practice-demo-wa-vip",
        contactName: "🎬 Demo: ফারিয়া আক্তার (VIP)",
        contactPhone: "01822222222",
        status: "open",
        pipelineStage: "repeat",
        priority: "high",
        tags: ["vip"],
        assignedUserId: actorId,
        firstResponseAt: at(2860),
        createdAt: at(2880),
        lastMessageAt: at(180),
        lastCustomerMessageAt: at(200),
        lastMessagePreview: messages[messages.length - 1].content!.slice(0, 120),
      }),
      messages,
      orders: [orderA, orderB],
    });
  }

  // ---------------------------------------------------------------
  // 5. ig-image-product — photo message → careful product-match
  //    answer (CX8 style: a possible match, never a certainty).
  //    No mediaUrl is fabricated — the row is honestly text-labelled.
  // ---------------------------------------------------------------
  {
    const messages = [
      msg({ direction: "in", minutesAgo: 65, type: "image", mediaUrl: null, content: "📷 [Demo ছবি] এই ডিজাইনের শাড়িটা আছে? দাম কত?" }),
      msg({
        direction: "out", minutesAgo: 60, sentByUserId: actorId,
        content: `ছবির ডিজাইনটি আমাদের "${itemName}"-এর সাথে মিলে যাচ্ছে বলে মনে হচ্ছে — দাম ${priceText}। পুরোপুরি নিশ্চিত হতে চাইলে পণ্যের কোডটা বা আরেকটু পরিষ্কার ছবি পাঠাবেন, স্টক যাচাই করে জানিয়ে দিচ্ছি।`,
      }),
    ];
    scenarios.push({
      ...meta("ig-image-product"),
      conversation: conv({
        channel: "instagram",
        externalContactId: "practice-demo-ig-image-product",
        contactName: "🎬 Demo: নুসরাত জাহান (Instagram)",
        contactPhone: null,
        status: "open",
        pipelineStage: "talking",
        assignedUserId: actorId,
        firstResponseAt: at(60),
        createdAt: at(70),
        lastMessageAt: at(60),
        lastCustomerMessageAt: at(65),
        lastMessagePreview: messages[0].content!.slice(0, 120),
      }),
      messages,
    });
  }

  // ---------------------------------------------------------------
  // 6. webchat-visitor — delivery-charge question, still live:
  //    unassigned, one unread follow-up from 10 minutes ago.
  // ---------------------------------------------------------------
  {
    const messages = [
      msg({ direction: "in", minutesAgo: 20, intent: "delivery", content: "হ্যালো, ওয়েবসাইটে ডেলিভারি চার্জটা খুঁজে পাচ্ছি না। ঢাকার বাইরে পাঠাতে কত লাগবে?" }),
      msg({ direction: "out", minutesAgo: 15, autoReply: true, content: "হ্যালো! 👋 ঢাকার বাইরে ডেলিভারি চার্জ ৳১২০, আর পৌঁছাতে সময় লাগে ৩-৫ কর্মদিবস। ক্যাশ অন ডেলিভারিও আছে।" }),
      msg({ direction: "in", minutesAgo: 10, intent: "delivery", content: "খুলনায় পাঠাতে পারবেন তো? ক্যাশ অন ডেলিভারি হবে?" }),
    ];
    scenarios.push({
      ...meta("webchat-visitor"),
      conversation: conv({
        channel: "webchat",
        externalContactId: "practice-demo-webchat-visitor",
        contactName: "🎬 Demo: ওয়েবসাইট Visitor (খুলনা)",
        contactPhone: null,
        status: "open",
        pipelineStage: "talking",
        assignedUserId: null,
        firstResponseAt: at(15),
        unreadCount: 1,
        createdAt: at(25),
        lastMessageAt: at(10),
        lastCustomerMessageAt: at(10),
        lastMessagePreview: messages[messages.length - 1].content!.slice(0, 120),
      }),
      messages,
    });
  }

  // ---------------------------------------------------------------
  // 7. wa-voice-order — voice note with a stored transcription;
  //    the AI follows up for the missing name/address (half order).
  // ---------------------------------------------------------------
  {
    const messages = [
      msg({
        direction: "in", minutesAgo: 35, type: "audio", mediaUrl: null, content: null,
        transcription: "আমি একটা কটন শাড়ি অর্ডার করতে চাই, লাল রঙেরটা",
        transcriptionStatus: "done", transcriptionProvider: "demo",
      }),
      msg({ direction: "out", minutesAgo: 30, autoReply: true, content: "ধন্যবাদ! 🎙️ আপনার ভয়েস মেসেজ পেয়েছি — লাল কটন শাড়ি অর্ডার করতে চান। অর্ডার সম্পূর্ণ করতে শুধু আপনার নাম, মোবাইল নম্বর আর ঠিকানা পাঠালেই হবে।" }),
    ];
    scenarios.push({
      ...meta("wa-voice-order"),
      conversation: conv({
        channel: "whatsapp",
        externalContactId: "practice-demo-wa-voice-order",
        contactName: "🎬 Demo: মাহমুদা বেগম (Voice Order)",
        contactPhone: "01555555555",
        status: "open",
        pipelineStage: "talking",
        assignedUserId: actorId,
        firstResponseAt: at(30),
        createdAt: at(40),
        lastMessageAt: at(30),
        lastCustomerMessageAt: at(35),
        lastMessagePreview: "🎙️ ভয়েস মেসেজ — কটন শাড়ি অর্ডার করতে চান",
      }),
      messages,
    });
  }

  // ---------------------------------------------------------------
  // 8. msgr-to-chase — order bot stuck at ask_address for a day;
  //    the bot session row is part of the scenario data.
  // ---------------------------------------------------------------
  {
    const messages = [
      msg({ direction: "in", minutesAgo: 1500, intent: "order", content: "শাড়িটা অর্ডার করতে চাই, একটা নেব।" }),
      msg({ direction: "out", minutesAgo: 1495, autoReply: true, content: "ধন্যবাদ! 😊 অর্ডারের জন্য প্রথমে আপনার নাম আর মোবাইল নম্বর পাঠান।" }),
      msg({ direction: "in", minutesAgo: 1490, content: "আমার নাম সুমাইয়া রহমান, ফোন 01933333333" }),
      msg({ direction: "out", minutesAgo: 1485, autoReply: true, content: "ধন্যবাদ সুমাইয়া! এখন আপনার পুরো ডেলিভারি ঠিকানাটা পাঠান — তাহলেই অর্ডার কনফার্ম হয়ে যাবে।" }),
    ];
    scenarios.push({
      ...meta("msgr-to-chase"),
      conversation: conv({
        channel: "messenger",
        externalContactId: "practice-demo-msgr-to-chase",
        contactName: "🎬 Demo: সুমাইয়া রহমান (To Chase)",
        contactPhone: "01933333333",
        status: "open",
        pipelineStage: "talking",
        assignedUserId: null,
        firstResponseAt: at(1495),
        createdAt: at(1510),
        lastMessageAt: at(1485),
        lastCustomerMessageAt: at(1490),
        lastMessagePreview: messages[messages.length - 1].content!.slice(0, 120),
      }),
      messages,
      botSession: {
        state: "ask_address",
        status: "active",
        data: {
          productId: product?.id ?? null,
          productName: itemName,
          quantity: 1,
          name: "সুমাইয়া রহমান",
          phone: "01933333333",
        },
      },
    });
  }

  // ---------------------------------------------------------------
  // 9. email-support — long polite bulk-order enquiry with subject,
  //    detailed agent answer, thread left pending since yesterday.
  // ---------------------------------------------------------------
  {
    const inbound = [
      "আসসালামু আলাইকুম,",
      "আমি চট্টগ্রামে একটি ছোট বুটিক চালাই। আপনাদের কটন শাড়ির কালেকশন আমার খুব পছন্দ হয়েছে — বাল্কে ৫০ পিসের মতো নিতে আগ্রহী। বাল্ক অর্ডারে কোনো বিশেষ ছাড় আছে কিনা, আর পাইকারি দামের তালিকা পাঠানো যাবে কিনা জানাবেন।",
      "আরেকটি বিষয়: চট্টগ্রামে ডেলিভারি পলিসি কেমন? বাল্ক অর্ডার কি কুরিয়ারে পাঠান, নাকি নিজস্ব পরিবহনে? ডেলিভারি চার্জ ও সময় সম্পর্কে বিস্তারিত জানালে সুবিধা হয়। অগ্রিম ধন্যবাদ।",
      "— তানভীর হাসান, রংধনু বুটিক, চট্টগ্রাম",
    ].join("\n\n");
    const answer = [
      "আসসালামু আলাইকুম তানভীর সাহেব, আগ্রহের জন্য ধন্যবাদ।",
      "বাল্ক অর্ডারের ক্ষেত্রে ৫০ পিস বা তার বেশি হলে আমরা পাইকারি দাম প্রয়োগ করি — পরিমাণ অনুযায়ী ধাপে ধাপে ছাড় বাড়ে। হালনাগাদ পাইকারি তালিকা এই ইমেইলের উত্তরে পাঠিয়ে দিচ্ছি, আর কোনো ডিজাইনের স্টক জানতে চাইলে কোডসহ জানাবেন।",
      "ডেলিভারির বিষয়ে: ঢাকার বাইরে বাল্ক অর্ডার কুরিয়ারে পাঠানো হয়, সময় লাগে ৩-৫ কর্মদিবস; চার্জ ওজন অনুযায়ী হিসাব হয়। নিয়মিত বাল্ক ক্রেতাদের জন্য আংশিক অগ্রিম + বাকি ক্যাশ অন ডেলিভারির ব্যবস্থাও আছে।",
      "কোনো প্রশ্ন থাকলে এই থ্রেডেই উত্তর দিলেই হবে।",
    ].join("\n\n");
    const messages = [
      msg({ direction: "in", minutesAgo: 1560, content: inbound }),
      msg({ direction: "out", minutesAgo: 1440, content: answer, sentByUserId: actorId }),
    ];
    scenarios.push({
      ...meta("email-support"),
      conversation: conv({
        channel: "email",
        externalContactId: "practice-demo-email-support",
        contactName: "🎬 Demo: তানভীর হাসান (Email)",
        contactPhone: null,
        subject: "বাল্ক অর্ডার ও ডেলিভারি পলিসি নিয়ে জিজ্ঞাসা",
        status: "pending",
        pipelineStage: "talking",
        assignedUserId: actorId,
        firstResponseAt: at(1440),
        createdAt: at(1570),
        lastMessageAt: at(1440),
        lastCustomerMessageAt: at(1560),
        lastMessagePreview: messages[messages.length - 1].content!.slice(0, 120),
      }),
      messages,
    });
  }

  // ---------------------------------------------------------------
  // 10. wa-delivered-review — full journey to delivered: practice
  //     order (delivered), review ask, happy reply, CSAT 5, closed.
  // ---------------------------------------------------------------
  {
    const order = makeOrder("wa-delivered-review", 1, 1, "delivered", 4270, "মিরপুর ১০, ঢাকা");
    const messages = [
      msg({ direction: "in", minutesAgo: 4300, intent: "price", content: "শাড়িটার দাম কত? অর্ডার করতে চাই।" }),
      msg({ direction: "out", minutesAgo: 4290, autoReply: true, content: `"${itemName}"-এর দাম ${priceText}, ডেলিভারি চার্জ ৳৬০। অর্ডার করতে নাম, ফোন আর ঠিকানা পাঠান।` }),
      msg({ direction: "in", minutesAgo: 4280, content: "নাম: কামরুল হাসান, ফোন: 01644444444, ঠিকানা: মিরপুর ১০, ঢাকা" }),
      msg({ direction: "out", minutesAgo: 4270, autoReply: true, content: `অর্ডার নিশ্চিত হয়েছে ✅ অর্ডার নম্বর ${order.externalNumber}। ক্যাশ অন ডেলিভারিতে পেমেন্ট করলেই হবে।` }),
      msg({ direction: "out", minutesAgo: 140, autoReply: true, content: "আপনার অর্ডারটি ডেলিভারি হয়েছে ✅ পণ্যটি কেমন লাগলো? ১-৫-এর মধ্যে একটি রেটিং দিয়ে জানাবেন।" }),
      msg({ direction: "in", minutesAgo: 130, content: "৫ — শাড়িটা অসাধারণ, কাপড়ের মান খুব ভালো! আবার কিনব ইনশাআল্লাহ 😍" }),
    ];
    scenarios.push({
      ...meta("wa-delivered-review"),
      conversation: conv({
        channel: "whatsapp",
        externalContactId: "practice-demo-wa-delivered-review",
        contactName: "🎬 Demo: কামরুল হাসান (Delivered)",
        contactPhone: "01644444444",
        status: "closed",
        pipelineStage: "delivered",
        outcome: "sale",
        assignedUserId: actorId,
        firstResponseAt: at(4290),
        resolvedAt: at(130),
        csatSentAt: at(140),
        csatRating: 5,
        csatRatedAt: at(130),
        createdAt: at(4320),
        lastMessageAt: at(130),
        lastCustomerMessageAt: at(130),
        lastMessagePreview: messages[messages.length - 1].content!.slice(0, 120),
      }),
      messages,
      orders: [order],
    });
  }

  // ---------------------------------------------------------------
  // 11. tg-snoozed — parked follow-up: snoozed until tomorrow.
  // ---------------------------------------------------------------
  {
    const messages = [
      msg({ direction: "in", minutesAgo: 350, content: "আগের অর্ডারটা পেয়ে গেছি, ধন্যবাদ। আরেকটা গিফট হিসেবে পাঠাতে চাই — কিন্তু কাকে পাঠাব সেটা ঠিক করে কাল জানাব।" }),
      msg({ direction: "out", minutesAgo: 340, sentByUserId: actorId, content: "অবশ্যই! 😊 আপনি কাল জানালেই তখন অর্ডার করে দেব। ততক্ষণ কথোপকথনটা স্নুজ করে রাখলাম, যাতে হারিয়ে না যায়।" }),
    ];
    scenarios.push({
      ...meta("tg-snoozed"),
      conversation: conv({
        channel: "telegram",
        externalContactId: "practice-demo-tg-snoozed",
        contactName: "🎬 Demo: রাফিদ আহমেদ (Telegram)",
        contactPhone: null,
        status: "open",
        pipelineStage: "talking",
        assignedUserId: actorId,
        firstResponseAt: at(340),
        snoozedUntil: ahead(24 * 60),
        createdAt: at(360),
        lastMessageAt: at(340),
        lastCustomerMessageAt: at(350),
        lastMessagePreview: messages[messages.length - 1].content!.slice(0, 120),
      }),
      messages,
    });
  }

  // ---------------------------------------------------------------
  // 12. wa-unassigned-new — brand-new, unassigned, 2 unread asks
  //     from 5 minutes ago. Banglish flavour.
  // ---------------------------------------------------------------
  {
    const messages = [
      msg({ direction: "in", minutesAgo: 7, intent: "price", content: "Assalamu alaikum, ei saree tar price koto?" }),
      msg({ direction: "in", minutesAgo: 5, intent: "delivery", content: "Dhaka te delivery pete kotodin lagbe?" }),
    ];
    scenarios.push({
      ...meta("wa-unassigned-new"),
      conversation: conv({
        channel: "whatsapp",
        externalContactId: "practice-demo-wa-unassigned-new",
        contactName: "🎬 Demo: নতুন কাস্টমার (Unassigned)",
        contactPhone: "01766666666",
        status: "open",
        pipelineStage: "new",
        assignedUserId: null,
        firstResponseAt: null,
        unreadCount: 2,
        createdAt: at(8),
        lastMessageAt: at(5),
        lastCustomerMessageAt: at(5),
        lastMessagePreview: messages[messages.length - 1].content!.slice(0, 120),
      }),
      messages,
    });
  }

  return scenarios;
}
