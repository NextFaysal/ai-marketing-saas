import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AnswerStoreService } from "./answer-store.service";
import { tokenize } from "../inbox/business-brain";
import { detectReplyLanguage } from "../inbox/in7-ai";

/**
 * SA-B5 (Smart AI Phase 0, P8b): per-customer memory — the
 * commerce facts the Brain may use when this customer writes
 * again: the language they write in, the products they asked
 * about or bought, how many orders they have placed, and the
 * recorded outcomes of their earlier conversations.
 *
 * Discipline:
 *  - DETERMINISTIC, no LLM. Every field is computed from real
 *    rows (the customer's own messages, their orders, their
 *    conversations' outcome/CSAT stamps). Nothing is inferred:
 *    no guessed preferences, no sensitive traits — commerce
 *    facts only.
 *  - CUSTOMER-OWN class (plan law L3): the memory is keyed by
 *    the conversation identity the org already holds —
 *    "<channel>:<externalContactId>" (WhatsApp wa_id /
 *    Messenger PSID) — and OrgBrainService serves it only
 *    inside that customer's own conversation context.
 *    Recorded limit: the same human on WhatsApp and Messenger
 *    is two memories; no cross-channel identity resolution
 *    exists in the product, and none is invented here.
 *  - Notes are SYSTEM-generated strings (outcome / CSAT of the
 *    customer's own conversations) carrying their source
 *    conversation id, and still pass the Answer Store's PII
 *    screen before storage — free text from any other source
 *    is never written into a memory.
 *
 * Refresh cadence (recorded): memories are refreshed for orgs
 * that opted into conversation learning (D4 — studying a
 * customer's conversation history IS conversation learning),
 * inside the conversation_learning_sweep's pass, and can be
 * refreshed per conversation on demand. There is no central
 * order-created hook in this codebase (orders arrive via
 * store sync, the chat order bot, manual entry and landing
 * endpoints), so order facts are recomputed from the orders
 * table at refresh time rather than maintained by hooks —
 * the numbers are never staler than the last refresh, and the
 * refresh derives them from ALL of the customer's orders.
 */

const MAX_SIBLING_CONVERSATIONS = 5;
const MAX_MESSAGES_PER_CONVERSATION = 100;
const MAX_TOPICS = 10;
const MAX_NOTES = 10;
const MAX_ORG_CONVERSATIONS = 50;

export interface MemoryTopic {
  productId: string | null;
  name: string;
  via: "asked" | "ordered";
}

export interface MemoryNote {
  kind: "outcome" | "csat";
  text: string;
  conversationId: string;
  at: string | null;
}

/** The memory key for a conversation, or null when the
 * conversation carries no real channel identity (practice
 * threads use synthetic tokens and are always excluded). */
export function customerKeyForConversation(conv: any): string | null {
  if (!conv || conv.isPractice) return null;
  const channel = String(conv.channel ?? "").trim();
  const external = String(conv.externalContactId ?? "").trim();
  if (!channel || !external) return null;
  return `${channel}:${external}`;
}

@Injectable()
export class CustomerMemoryService {
  private readonly logger = new Logger(CustomerMemoryService.name);
  private storeFallback?: AnswerStoreService;

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly answerStore?: AnswerStoreService,
  ) {}

  private db(): any {
    if (!this.prisma) throw new Error("CustomerMemoryService: PrismaService is not available");
    return this.prisma as any;
  }

  private store(): AnswerStoreService {
    return this.answerStore ?? (this.storeFallback ??= new AnswerStoreService(this.prisma as any));
  }

  /** Majority observed language over the given inbound texts:
   * a strict majority wins; a real mix is "mixed"; nothing
   * observed is null (never guessed). */
  static languageFromTexts(texts: string[]): string | null {
    const counts = { bn: 0, en: 0, mixed: 0 };
    for (const t of texts) {
      const lang = detectReplyLanguage(t);
      if (lang) counts[lang]++;
    }
    const total = counts.bn + counts.en + counts.mixed;
    if (!total) return null;
    if (counts.bn > total / 2) return "bn";
    if (counts.en > total / 2) return "en";
    return "mixed";
  }

  /** Products whose names the customer mentioned, by the
   * codebase tokenizer: a product matches when its name tokens
   * overlap the message tokens (both tokens for names of 3+,
   * one for shorter names). */
  static askedTopics(texts: string[], products: any[]): MemoryTopic[] {
    const topics: MemoryTopic[] = [];
    const seen = new Set<string>();
    const productTokens = (products ?? []).map((p: any) => ({
      id: p.id ?? null,
      name: String(p.name ?? ""),
      tokens: new Set(tokenize(String(p.name ?? ""))),
    }));
    for (const text of texts) {
      const msgTokens = new Set(tokenize(text));
      for (const p of productTokens) {
        if (!p.name || seen.has(p.name)) continue;
        let overlap = 0;
        for (const tok of p.tokens) if (msgTokens.has(tok)) overlap++;
        const needed = p.tokens.size >= 3 ? 2 : 1;
        if (p.tokens.size > 0 && overlap >= needed) {
          seen.add(p.name);
          topics.push({ productId: p.id, name: p.name, via: "asked" });
        }
      }
    }
    return topics;
  }

  /** Recompute one customer's memory from their conversations
   * and orders. Never throws. */
  async refreshForConversation(
    organizationId: string,
    anchor: any,
  ): Promise<{ refreshed: boolean; reason?: string; customerKey?: string }> {
    const customerKey = customerKeyForConversation(anchor);
    if (!customerKey || !anchor?.id) return { refreshed: false, reason: "no_customer_key" };
    try {
      const p = this.db();
      const siblings = await p.channelConversation.findMany({
        where: {
          organizationId,
          channel: anchor.channel,
          externalContactId: anchor.externalContactId,
          isPractice: false,
        },
        orderBy: { lastMessageAt: "desc" },
      });
      const sibs: any[] = siblings ?? [];
      if (!sibs.length) return { refreshed: false, reason: "no_conversations" };
      const recent = sibs.slice(0, MAX_SIBLING_CONVERSATIONS);
      const sibIds = sibs.map((c: any) => c.id);
      const customerIds = [...new Set(sibs.map((c: any) => c.customerId).filter(Boolean))];

      // Language + asked-topics from the customer's own
      // inbound messages across their recent conversations.
      const inboundTexts: string[] = [];
      for (const conv of recent) {
        const messages = await p.channelMessage.findMany({
          where: { conversationId: conv.id, direction: "in" },
          orderBy: { createdAt: "asc" },
          take: MAX_MESSAGES_PER_CONVERSATION,
        });
        for (const m of messages ?? []) {
          const text = String(m?.content ?? "").trim();
          if (text) inboundTexts.push(text);
        }
      }
      const languagePref = CustomerMemoryService.languageFromTexts(inboundTexts);

      // Orders: everything this customer placed — linked by
      // any of their conversations, or by their Customer row.
      const orderWhere: any = { organizationId, isPractice: false, OR: [{ conversationId: { in: sibIds } }] };
      if (customerIds.length) orderWhere.OR.push({ customerId: { in: customerIds } });
      const orders = await p.order.findMany({ where: orderWhere, orderBy: { createdAt: "desc" } });
      const orderRows: any[] = orders ?? [];
      const lastOrderAt = orderRows.length ? orderRows[0].createdAt ?? null : null;

      const orderedTopics: MemoryTopic[] = [];
      if (orderRows.length) {
        const items = await p.orderItem.findMany({ where: { orderId: { in: orderRows.map((o: any) => o.id) } } });
        const seenOrdered = new Set<string>();
        for (const it of items ?? []) {
          const name = String(it.name ?? "");
          if (!name || seenOrdered.has(name)) continue;
          seenOrdered.add(name);
          orderedTopics.push({ productId: it.productId ?? null, name, via: "ordered" });
        }
      }

      let asked: MemoryTopic[] = [];
      if (inboundTexts.length) {
        const products = await p.product
          .findMany({ where: { organizationId, status: "ACTIVE" }, take: 200 })
          .catch(() => []);
        asked = CustomerMemoryService.askedTopics(inboundTexts, products ?? []);
      }
      const topicByName = new Map<string, MemoryTopic>();
      for (const t of [...orderedTopics, ...asked]) if (!topicByName.has(t.name)) topicByName.set(t.name, t);
      const topics = [...topicByName.values()].slice(0, MAX_TOPICS);

      // Notes: system facts from the customer's own
      // conversations (outcome + CSAT), newest first, each
      // carrying its source conversation, PII-screened.
      const noteCandidates: MemoryNote[] = [];
      for (const conv of sibs) {
        const at = (conv.resolvedAt ?? conv.updatedAt ?? null) as Date | null;
        const atIso = at ? new Date(at).toISOString() : null;
        if (conv.outcome) {
          noteCandidates.push({
            kind: "outcome",
            text: `Conversation closed with outcome: ${String(conv.outcome)}`,
            conversationId: conv.id,
            at: atIso,
          });
        }
        if (conv.csatRating != null) {
          noteCandidates.push({
            kind: "csat",
            text: `Customer rated a conversation ${conv.csatRating}/5`,
            conversationId: conv.id,
            at: atIso,
          });
        }
      }
      noteCandidates.sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
      const notes: MemoryNote[] = [];
      for (const note of noteCandidates.slice(0, MAX_NOTES)) {
        if (await this.store().screenAnswerPii(organizationId, note.text)) continue;
        notes.push(note);
      }

      const displayName = anchor.contactName ?? sibs.map((c: any) => c.contactName).find(Boolean) ?? null;
      const lastInteractionAt = sibs.reduce<Date | null>((max, c: any) => {
        const t = c.lastMessageAt ?? c.updatedAt ?? null;
        if (!t) return max;
        const d = t instanceof Date ? t : new Date(t);
        return !max || d > max ? d : max;
      }, null);

      const data = {
        displayName,
        languagePref,
        topics: topics as any,
        orderCount: orderRows.length,
        lastOrderAt,
        notes: notes as any,
        lastInteractionAt,
      };
      await p.customerMemory.upsert({
        where: { organizationId_customerKey: { organizationId, customerKey } },
        create: { organizationId, customerKey, ...data },
        update: data,
      });
      return { refreshed: true, customerKey };
    } catch (e) {
      this.logger.error(
        `customer memory refresh failed for org ${organizationId} key ${customerKey}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { refreshed: false, reason: "refresh_failed" };
    }
  }

  /** Refresh memories for an org's recently active customers
   * (one refresh per customer key, anchored on their most
   * recent conversation). Never throws. */
  async refreshOrg(organizationId: string): Promise<{ customers: number }> {
    try {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const conversations = await this.db().channelConversation.findMany({
        where: { organizationId, isPractice: false, lastMessageAt: { gte: since } },
        orderBy: { lastMessageAt: "desc" },
        take: MAX_ORG_CONVERSATIONS,
      });
      const seenKeys = new Set<string>();
      let customers = 0;
      for (const conv of conversations ?? []) {
        const key = customerKeyForConversation(conv);
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);
        const r = await this.refreshForConversation(organizationId, conv);
        if (r.refreshed) customers++;
      }
      return { customers };
    } catch (e) {
      this.logger.error(`customer memory refreshOrg failed for org ${organizationId}: ${e instanceof Error ? e.message : String(e)}`);
      return { customers: 0 };
    }
  }

  async getMemory(organizationId: string, customerKey: string) {
    return this.db().customerMemory.findUnique({
      where: { organizationId_customerKey: { organizationId, customerKey } },
    });
  }
}
