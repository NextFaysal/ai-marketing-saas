/**
 * UX0 — Inbox Visual QA seed (DEMO ORG ONLY).
 *
 * Creates the conversation matrix the UX0 screenshot checklist needs:
 * long Bengali + English names, a very long message preview, image /
 * voice / failed messages, an SLA-breach thread (old, unanswered),
 * an unread-heavy thread, and one conversation whose latest linked
 * order is large (VIP folder — only appears if the org's
 * escalationThresholdMinor is set at or below the order total).
 *
 * Safety: refuses to run unless INBOX_QA_CONFIRM=demo-only AND
 * INBOX_QA_ORG_ID points at the demo organization. Never run against
 * a real tenant. Idempotent-ish: re-running adds a fresh set with a
 * run suffix in externalContactId.
 *
 * Run (when a sandbox stack exists):
 *   INBOX_QA_CONFIRM=demo-only INBOX_QA_ORG_ID=<demo org id> \
 *     pnpm --filter @repo/db exec tsx prisma/seed-inbox-qa.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  if (process.env.INBOX_QA_CONFIRM !== "demo-only") {
    throw new Error("Refusing to run: set INBOX_QA_CONFIRM=demo-only (demo org only).");
  }
  const orgId = process.env.INBOX_QA_ORG_ID;
  if (!orgId) throw new Error("INBOX_QA_ORG_ID is required (the DEMO organization id).");
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) throw new Error(`Organization ${orgId} not found.`);

  const run = Date.now().toString(36);
  const hour = 3600_000;
  const now = Date.now();

  const convs: Array<Record<string, unknown>> = [
    {
      key: "sla", channel: "whatsapp",
      contactName: "মোহাম্মদ আব্দুল্লাহ আল মামুন (ঢাকা, মিরপুর ১০)",
      contactPhone: "+8801711000001",
      status: "open", unreadCount: 3,
      lastMessagePreview: "ভাইয়া, তিন দিন আগে অর্ডার করেছি, এখনো কোনো আপডেট পাইনি। পার্সেলটা আসলে কোথায় আছে একটু জানাবেন প্লিজ?",
      lastMessageAt: new Date(now - 3 * hour), createdAt: new Date(now - 5 * hour),
    },
    {
      key: "vip", channel: "messenger",
      contactName: "Ayesha Rahman — Repeat Buyer (Chattogram)",
      contactPhone: "+8801811000002",
      status: "open", unreadCount: 1,
      lastMessagePreview: "আপু, আগের শাড়িটা খুব ভালো ছিল। এবার একই ডিজাইনের আরও পাঁচটা নিতে চাই, বাল্ক প্রাইস হবে?",
      lastMessageAt: new Date(now - 25 * 60_000), createdAt: new Date(now - 2 * hour),
    },
    {
      key: "media", channel: "instagram",
      contactName: "tanvir.hasan.1998.with.a.very.long.username",
      contactPhone: null,
      status: "open", unreadCount: 2,
      lastMessagePreview: "এই ছবির প্রোডাক্টটা কি স্টকে আছে?",
      lastMessageAt: new Date(now - 12 * 60_000), createdAt: new Date(now - 1 * hour),
    },
    {
      key: "failed", channel: "whatsapp",
      contactName: "রুমানা আক্তার",
      contactPhone: "+8801911000004",
      status: "open", unreadCount: 0,
      lastMessagePreview: "ধন্যবাদ আপু, পেয়ে গেছি!",
      lastMessageAt: new Date(now - 40 * 60_000), createdAt: new Date(now - 26 * hour),
    },
    {
      key: "long", channel: "webchat",
      contactName: "Website Visitor with an Extremely Long Name That Tests Every Truncation Rule in the Interface",
      contactPhone: null,
      status: "pending", unreadCount: 0,
      lastMessagePreview: "Hello, I wanted to ask whether the winter collection will be available in extra-large sizes this year and whether cash on delivery is supported outside Dhaka city corporation area or not",
      lastMessageAt: new Date(now - 8 * 60_000), createdAt: new Date(now - 30 * 60_000),
    },
  ];

  const created: Record<string, string> = {};
  for (const c of convs) {
    const { key, ...data } = c as any;
    const row = await prisma.channelConversation.create({
      data: {
        organizationId: orgId,
        externalContactId: `qa-${run}-${key}`,
        pipelineStage: "new",
        ...(data as object),
      } as any,
    });
    created[key] = row.id;
    console.log(`conversation ${key}: ${row.id}`);
  }

  const msgs: Array<Record<string, unknown>> = [
    { conversationId: created.sla, direction: "in", type: "text", status: "received", content: "আসসালামু আলাইকুম, অর্ডার #A1023-এর আপডেট জানতে চাই।", createdAt: new Date(now - 5 * hour) },
    { conversationId: created.sla, direction: "in", type: "text", status: "received", content: "তিন দিন হয়ে গেল, কুরিয়ার থেকে কোনো ফোন পাইনি।", createdAt: new Date(now - 4 * hour) },
    { conversationId: created.sla, direction: "in", type: "text", status: "received", content: "পার্সেলটা আসলে কোথায় আছে একটু জানাবেন প্লিজ?", createdAt: new Date(now - 3 * hour) },
    { conversationId: created.vip, direction: "in", type: "text", status: "received", content: "আপু, আগের শাড়িটা খুব ভালো ছিল। এবার একই ডিজাইনের আরও পাঁচটা নিতে চাই, বাল্ক প্রাইস হবে?", createdAt: new Date(now - 25 * 60_000) },
    { conversationId: created.media, direction: "in", type: "image", status: "received", content: "এই ছবির প্রোডাক্টটা কি স্টকে আছে?", mediaUrl: "https://picsum.photos/seed/ux0/600/900", createdAt: new Date(now - 14 * 60_000) },
    { conversationId: created.media, direction: "in", type: "audio", status: "received", content: null, createdAt: new Date(now - 12 * 60_000) },
    { conversationId: created.failed, direction: "in", type: "text", status: "received", content: "ধন্যবাদ আপু, পেয়ে গেছি!", createdAt: new Date(now - 41 * 60_000) },
    { conversationId: created.failed, direction: "out", type: "text", status: "failed", content: "জি আপু, স্বাগতম! আবার দরকার হলে জানাবেন।", error: "QA seed: simulated platform failure (not a real send)", createdAt: new Date(now - 40 * 60_000) },
    { conversationId: created.long, direction: "in", type: "text", status: "received", content: "Hello, I wanted to ask whether the winter collection will be available in extra-large sizes this year and whether cash on delivery is supported outside Dhaka city corporation area or not", createdAt: new Date(now - 8 * 60_000) },
  ];
  for (const m of msgs) {
    await prisma.channelMessage.create({ data: m as any });
  }

  // VIP linkage: the latest linked order on the "vip" conversation.
  const order = await prisma.order.create({
    data: {
      organizationId: orgId,
      conversationId: created.vip,
      externalId: `qa-${run}-order`,
      externalNumber: "QA-1001",
      status: "delivered",
      source: "manual",
      isCod: true,
      currency: "BDT",
      totalMinor: 250_000n,
    } as any,
  });
  console.log(`order (VIP link): ${order.id} — VIP folder needs escalationThresholdMinor <= 250000 set in Inbox settings.`);
  console.log("UX0 seed complete for org", orgId);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
