import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LlmFactory, providerForOrg } from "../ai/llm/llm.factory";
import { extractGuardNumbers } from "../inbox/business-brain";
import { detectReplyLanguage } from "../inbox/in7-ai";
import { formatMinor } from "@repo/contracts";
import { renderTemplate } from "./render";
import type { Recipient } from "./messaging.service";

/**
 * SA-B20 (Smart AI Phase 5, G2): Broadcast Personalised —
 * per-recipient personalisation on the EXISTING Messaging
 * broadcast system. Two honest tiers:
 *
 *  Tier 1 (deterministic, any scale): per-recipient merge vars
 *  from that recipient's OWN CustomerMemory (SA-B5) + their live
 *  order facts — last purchased product, its category, favorite
 *  category, observed language. The vars ride the MS1 snapshot's
 *  existing `vars` mechanism, so the send pipeline renders them
 *  through its own renderTemplate call — no forked pipeline.
 *  A recipient with no memory and no orders gets their legacy
 *  vars back UNCHANGED (their rendered body is byte-identical
 *  to the pre-G2 pipeline).
 *
 *  Tier 2 (AI hook, capped): an optional per-recipient AI
 *  opening line / product recommendation, exposed to the
 *  authored body as the {{aiHook}} variable. Grounded ONLY in
 *  the recipient's own facts + LIVE products in categories the
 *  recipient actually bought; the shared number guard judges
 *  the line; a failed line falls back to that recipient's
 *  Tier 1/base rendering and is counted — never a broken send.
 *
 * Law notes:
 *  - L3: a customer's own facts are used ONLY in that
 *    customer's variant. Facts are loaded per recipient and
 *    merged into that recipient's vars only; the preview shows
 *    staff their own CRM view (name + masked address, the CX10
 *    precedent) and nothing crosses recipients.
 *  - Suppression: this service only ever receives the
 *    recipient set AFTER resolveBroadcastRecipients has run
 *    every exclusion stage (opt-out, unsubscribed, frequency
 *    cap, WhatsApp opt-in) — nobody suppressed is personalised
 *    and no LLM call is spent on them.
 *  - There are NO per-language template variants in this tree
 *    (one authored body per broadcast), so Tier 1 does not
 *    translate anything: facts merge into the ONE authored
 *    body and the language stays the author's. Tier 2's hook
 *    follows the recipient's OBSERVED language when known.
 *  - Tier 2 is email/SMS only (the MS9 rule: WhatsApp sends
 *    approved Meta templates; there is no free-text body to
 *    personalise). Tier 1 vars DO flow to WhatsApp template
 *    params through the existing snapshot-vars substitution.
 *  - No LLM money rate is configured anywhere in this tree,
 *    so Tier 2 cost is surfaced as an LLM CALL COUNT only —
 *    a price is never invented.
 */

/** The AIUsageRecord feature bucket for Tier 2 hook calls. */
export const BROADCAST_PERSONALIZATION_FEATURE = "broadcast_personalization";
/** Tier 2 hard cap: at most this many resolved recipients may
 *  carry AI hooks in one broadcast. Above it the request is
 *  REFUSED with the honest reason — never silently degraded
 *  to Tier 1 (staff asked for hooks; a quiet downgrade would
 *  falsify the preview they approved). */
export const BROADCAST_TIER2_MAX_RECIPIENTS = 200;
/** Preview sample ceiling (staff see at most this many fully
 *  rendered variants per preview call). */
export const BROADCAST_PERSONALIZATION_SAMPLE_MAX = 5;
/** Tier 2 candidates offered to the model per recipient. */
const TIER2_CANDIDATE_LIMIT = 5;
/** A hook is ONE opening line — longer output is not a hook. */
const TIER2_HOOK_MAX_CHARS = 280;
/** Live-order scan bounds for Tier 1/Tier 2 fact loading. */
const ORDER_SCAN_LIMIT = 1000;

export interface PersonalizationConfig {
  enabled: true;
  tier2AiHook: boolean;
}

export type PersonalTier = "base" | "memory" | "ai";

/**
 * Typed refusal for an org with no real LLM configured (the
 * MS9/B19 honest pattern, same stable machine-readable code):
 * a Tier 2 hook without a real model would be a template
 * dressed as AI, so the call fails instead.
 */
export class BroadcastPersonalizationLlmNotConfiguredError extends HttpException {
  constructor() {
    super(
      {
        code: "LLM_NOT_CONFIGURED",
        message:
          "আসল AI (LLM) configure করা নেই — Broadcast Tier 2 (AI hook)-এর জন্য LLM সেট করুন। Template দিয়ে AI hook বানানো হবে না।",
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

/**
 * Validate + normalize the staff-supplied personalisation
 * config. Absent / disabled ⇒ null (the row stores null and
 * every code path stays byte-identical to pre-G2). Anything
 * malformed is a 400 — a config is never reinterpreted.
 */
export function normalizePersonalizationConfig(raw: unknown, channel: string): PersonalizationConfig | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new BadRequestException("personalization must be an object like { enabled: true, tier2AiHook: true }");
  }
  const cfg = raw as Record<string, unknown>;
  if (cfg.enabled !== true) return null;
  const tier2AiHook = cfg.tier2AiHook === true;
  if (tier2AiHook && channel === "whatsapp") {
    throw new BadRequestException(
      "Tier 2 AI hooks are not available for WhatsApp broadcasts — WhatsApp sends approved Meta templates only (no free-text body to personalise). Tier 1 variables still work.",
    );
  }
  return { enabled: true, tier2AiHook };
}

/** Tier 2 needs the {{aiHook}} placeholder in the authored
 *  body: the hook is a variable the author places (the MS5
 *  variable discipline), never a surprise prepend. Tier 2 on
 *  without the placeholder would burn LLM calls on text that
 *  can never appear — refused honestly instead. */
export function assertTier2HookPlaceholder(body: string, config: PersonalizationConfig | null): void {
  if (!config?.tier2AiHook) return;
  if (!/\{\{\s*aiHook\s*\}\}/.test(String(body ?? ""))) {
    throw new BadRequestException(
      "Tier 2 (AI hook) is on but the message body has no {{aiHook}} placeholder — add {{aiHook}} where the personal line should appear, or turn Tier 2 off.",
    );
  }
}

/**
 * THE render both the preview and the send use. sendToRecipient
 * renders `renderTemplate(body, { name, ...vars })` — this is
 * that exact merge, exported so the preview (and its spec) can
 * pin byte-equality with what the pipeline will send (before
 * send-time additions every broadcast gets: link tracking and
 * the email unsubscribe footer).
 */
export function renderPersonalizedBody(body: string, recipient: { name: string }, vars: Record<string, unknown>): string {
  return renderTemplate(body, { name: recipient.name, ...vars });
}

export interface RecipientFacts {
  languagePref: string | null;
  /** Purchased product names, deduped — memory's ordered
   *  topics first (stored order), then live-order items. */
  orderedNames: string[];
  /** Categories of purchased products, deduped, in the order
   *  the purchases evidence them. */
  boughtCategories: string[];
  /** Product ids the purchase evidence links (memory topics +
   *  order items) — already-bought products are never
   *  "recommended" back by Tier 2. */
  boughtProductIds: string[];
  lastProductName: string;
  lastCategory: string;
  favoriteCategory: string;
  hasMemory: boolean;
  hasFacts: boolean;
}

interface ProductLite {
  id: string;
  name: string;
  category: string | null;
  status: string;
  priceMinor: unknown;
  currency: string | null;
}

const EMPTY_FACTS: RecipientFacts = {
  languagePref: null,
  orderedNames: [],
  boughtCategories: [],
  boughtProductIds: [],
  lastProductName: "",
  lastCategory: "",
  favoriteCategory: "",
  hasMemory: false,
  hasFacts: false,
};

@Injectable()
export class BroadcastPersonalizationService {
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly llm?: LlmFactory,
  ) {}

  private db(): any {
    if (!this.prisma) throw new Error("BroadcastPersonalizationService: PrismaService is not available");
    return this.prisma as any;
  }

  private factory(): LlmFactory {
    return this.llm ?? new LlmFactory();
  }

  /**
   * Load each recipient's OWN facts: CustomerMemory (via their
   * conversations — the only link that exists; no cross-channel
   * identity is invented) merged with their live order facts.
   * Every query is org-scoped. CSV/test recipients have no org
   * entity and always get EMPTY_FACTS.
   */
  async loadRecipientFacts(organizationId: string, recipients: Recipient[]): Promise<RecipientFacts[]> {
    const p = this.db();
    const facts: RecipientFacts[] = recipients.map(() => ({ ...EMPTY_FACTS, orderedNames: [], boughtCategories: [], boughtProductIds: [] }));
    const customerIdx = recipients.map((r, i) => ({ r, i })).filter(({ r }) => r.type === "customer" && r.id);
    const leadIdx = recipients.map((r, i) => ({ r, i })).filter(({ r }) => r.type === "lead" && r.id);
    if (!customerIdx.length && !leadIdx.length) return facts;

    // ---- memories, via conversations (customerId / leadId) ----
    const memoryByEntity = new Map<string, any[]>();
    const loadMemoriesFor = async (field: "customerId" | "leadId", ids: string[], type: "customer" | "lead") => {
      if (!ids.length) return;
      const convs: any[] = await p.channelConversation
        .findMany({ where: { organizationId, [field]: { in: ids } }, select: { customerId: true, leadId: true, channel: true, externalContactId: true } })
        .catch(() => []);
      const keysByEntity = new Map<string, Set<string>>();
      const allKeys = new Set<string>();
      for (const c of convs ?? []) {
        const entityId = field === "customerId" ? c.customerId : c.leadId;
        if (!entityId || !c.channel || !c.externalContactId) continue;
        const key = `${c.channel}:${c.externalContactId}`;
        allKeys.add(key);
        const set = keysByEntity.get(entityId) ?? new Set<string>();
        set.add(key);
        keysByEntity.set(entityId, set);
      }
      if (!allKeys.size) return;
      const rows: any[] = await p.customerMemory
        .findMany({ where: { organizationId, customerKey: { in: [...allKeys] } } })
        .catch(() => []);
      const byKey = new Map<string, any>((rows ?? []).map((m: any) => [String(m.customerKey), m]));
      for (const [entityId, keys] of keysByEntity) {
        const found = [...keys].map((k) => byKey.get(k)).filter(Boolean);
        if (found.length) memoryByEntity.set(`${type}:${entityId}`, found);
      }
    };
    await loadMemoriesFor("customerId", [...new Set(customerIdx.map(({ r }) => r.id!))], "customer");
    await loadMemoriesFor("leadId", [...new Set(leadIdx.map(({ r }) => r.id!))], "lead");

    // ---- live orders (customers only) ----
    const orderNamesByCustomer = new Map<string, string[]>();
    const orderProductIdsByCustomer = new Map<string, string[]>();
    const productIdsWanted = new Set<string>();
    if (customerIdx.length) {
      const ids = [...new Set(customerIdx.map(({ r }) => r.id!))];
      const orders: any[] = await p.order
        .findMany({
          where: { organizationId, customerId: { in: ids }, status: { not: "cancelled" } },
          orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
          take: ORDER_SCAN_LIMIT,
        })
        .catch(() => []);
      const orderIds = (orders ?? []).map((o: any) => o.id).filter(Boolean);
      const itemsByOrder = new Map<string, any[]>();
      if (orderIds.length) {
        const items: any[] = await p.orderItem.findMany({ where: { orderId: { in: orderIds } } }).catch(() => []);
        for (const it of items ?? []) {
          const list = itemsByOrder.get(it.orderId) ?? [];
          list.push(it);
          itemsByOrder.set(it.orderId, list);
          if (it.productId) productIdsWanted.add(String(it.productId));
        }
      }
      for (const o of orders ?? []) {
        const names = orderNamesByCustomer.get(o.customerId) ?? [];
        const pids = orderProductIdsByCustomer.get(o.customerId) ?? [];
        for (const it of itemsByOrder.get(o.id) ?? []) {
          if (it.name) names.push(String(it.name));
          if (it.productId) pids.push(String(it.productId));
        }
        orderNamesByCustomer.set(o.customerId, names);
        orderProductIdsByCustomer.set(o.customerId, pids);
      }
    }

    // Memory ordered topics also reference products (category
    // evidence) — collect their ids for the same product read.
    for (const rows of memoryByEntity.values()) {
      for (const m of rows) {
        for (const t of Array.isArray(m.topics) ? m.topics : []) {
          if (t?.productId) productIdsWanted.add(String(t.productId));
        }
      }
    }
    const productsById = new Map<string, ProductLite>();
    if (productIdsWanted.size) {
      const rows: any[] = await p.product
        .findMany({ where: { organizationId, id: { in: [...productIdsWanted] } } })
        .catch(() => []);
      for (const pr of rows ?? []) {
        productsById.set(String(pr.id), {
          id: String(pr.id), name: String(pr.name ?? ""), category: pr.category ?? null,
          status: String(pr.status ?? ""), priceMinor: pr.priceMinor, currency: pr.currency ?? null,
        });
      }
    }

    const build = (entityKey: string | null, customerId: string | null): RecipientFacts => {
      const memRows = entityKey ? [...(memoryByEntity.get(entityKey) ?? [])] : [];
      // Merge rule (recorded): the most recently updated memory
      // wins for language; topics union across the customer's
      // memories, ordered-via first, each in stored order.
      memRows.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
      let languagePref: string | null = null;
      for (const m of memRows) {
        if (!languagePref && typeof m.languagePref === "string" && m.languagePref) languagePref = m.languagePref;
      }
      const orderedEntries: { name: string; productId: string | null }[] = [];
      const seenNames = new Set<string>();
      const pushEntry = (name: unknown, productId: unknown) => {
        const n = String(name ?? "").trim();
        if (!n || seenNames.has(n)) return;
        seenNames.add(n);
        orderedEntries.push({ name: n, productId: productId ? String(productId) : null });
      };
      for (const m of memRows) {
        for (const t of Array.isArray(m.topics) ? m.topics : []) if (t?.via === "ordered") pushEntry(t.name, t.productId);
      }
      if (customerId) {
        const pids = orderProductIdsByCustomer.get(customerId) ?? [];
        const names = orderNamesByCustomer.get(customerId) ?? [];
        names.forEach((n, ix) => pushEntry(n, pids[ix] ?? null));
      }
      const boughtCategories: string[] = [];
      for (const e of orderedEntries) {
        const cat = e.productId ? productsById.get(e.productId)?.category : null;
        if (cat && !boughtCategories.includes(cat)) boughtCategories.push(cat);
      }
      const orderedNames = orderedEntries.map((e) => e.name);
      const lastProductName = orderedNames[0] ?? "";
      const lastCategory = orderedEntries.length
        ? (orderedEntries[0].productId ? productsById.get(orderedEntries[0].productId)?.category ?? "" : "")
        : "";
      let favoriteCategory = "";
      if (boughtCategories.length) {
        const counts = new Map<string, number>();
        for (const e of orderedEntries) {
          const cat = e.productId ? productsById.get(e.productId)?.category : null;
          if (cat) counts.set(cat, (counts.get(cat) ?? 0) + 1);
        }
        let best = -1;
        for (const cat of boughtCategories) {
          const c = counts.get(cat) ?? 0;
          if (c > best) { best = c; favoriteCategory = cat; }
        }
      }
      const hasMemory = memRows.length > 0;
      const hasFacts = Boolean(languagePref || orderedNames.length || boughtCategories.length);
      return {
        languagePref, orderedNames, boughtCategories,
        boughtProductIds: [...new Set(orderedEntries.map((e) => e.productId).filter(Boolean) as string[])],
        lastProductName, lastCategory: lastCategory || boughtCategories[0] || "", favoriteCategory,
        hasMemory, hasFacts,
      };
    };

    for (const { r, i } of customerIdx) facts[i] = build(`customer:${r.id}`, r.id);
    for (const { r, i } of leadIdx) facts[i] = build(`lead:${r.id}`, null);
    return facts;
  }

  /** The live product pool for a category set (one query per
   *  distinct set per personalise run, cached by the caller).
   *  Per-recipient exclusion + slicing happens in
   *  candidatesFor — the pool itself is org data, not
   *  recipient data. */
  private async loadCandidatePool(organizationId: string, categories: string[]): Promise<ProductLite[]> {
    if (!categories.length) return [];
    const rows: any[] = await this.db().product
      .findMany({ where: { organizationId, status: "ACTIVE", category: { in: categories } } })
      .catch(() => []);
    return (rows ?? [])
      .map((pr: any) => ({
        id: String(pr.id), name: String(pr.name ?? ""), category: pr.category ?? null,
        status: String(pr.status ?? ""), priceMinor: pr.priceMinor, currency: pr.currency ?? null,
      }))
      .filter((pr: ProductLite) => pr.name)
      .sort((a: ProductLite, b: ProductLite) => a.name.localeCompare(b.name));
  }

  /** Live, in-bought-category products the recipient has NOT
   *  already bought — the ONLY recommendation candidates. */
  private candidatesFor(pool: ProductLite[], facts: RecipientFacts): ProductLite[] {
    const bought = new Set(facts.boughtProductIds);
    return pool
      .filter((pr) => pr.category !== null && facts.boughtCategories.includes(pr.category) && !bought.has(pr.id))
      .slice(0, TIER2_CANDIDATE_LIMIT);
  }

  /** MS9/B19 discipline for this service's bucket: platform
   *  kill switch (403) → daily cap (429 when already
   *  exhausted). Returns the number of calls still available
   *  today; mid-run exhaustion falls back per recipient
   *  (counted), it does not kill a send already in flight. */
  private async tier2CallBudget(organizationId: string): Promise<number> {
    const { killSwitches, effectiveLimits, isAiDisabledForOrg } = await import("../common/platform-settings");
    const ks = await killSwitches(this.db());
    if (isAiDisabledForOrg(ks, organizationId)) {
      throw new HttpException(ks.aiGloballyPaused ? "AI features are temporarily paused platform-wide by the platform team." : "AI features are temporarily disabled for this organization by the platform team.", 403);
    }
    const baseline = Number(process.env.AI_DAILY_MESSAGE_LIMIT ?? 200);
    const { aiDaily: limit } = await effectiveLimits(this.db(), organizationId, { aiDaily: baseline, broadcastCap: 1000 });
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const used = await this.db().aIUsageRecord.count({
      where: { organizationId, feature: BROADCAST_PERSONALIZATION_FEATURE, createdAt: { gte: startOfDay } },
    });
    const remaining = limit - used;
    if (remaining <= 0) {
      throw new HttpException(
        `Daily AI generation limit reached for this organization (${limit}). Try again tomorrow or ask the platform team to raise your plan limit.`,
        429,
      );
    }
    return remaining;
  }

  /**
   * THE shared core — prepareBroadcast and the preview endpoint
   * both call exactly this, so what staff preview is what the
   * send renders. `generateFor` lets the preview generate hooks
   * only for its sampled recipients (facts + tier classification
   * still cover the whole resolved set, without LLM spend).
   */
  async personaliseRecipients(input: {
    organizationId: string;
    channel: string;
    body: string;
    subject?: string | null;
    recipients: Recipient[];
    baseVarsList: Record<string, unknown>[];
    config: PersonalizationConfig;
    actorId: string;
    generateFor?: (index: number) => boolean;
  }): Promise<{
    varsList: Record<string, unknown>[];
    tiers: PersonalTier[];
    counts: { total: number; base: number; memory: number; ai: number; tier2Eligible: number; tier2Fallbacks: number };
    tier2FallbackReasons: Record<string, number>;
    llmCallsMade: number;
    llmCallsProjected: number;
  }> {
    const { organizationId, channel, recipients, config } = input;
    if (!config?.enabled) throw new BadRequestException("personalisation is not enabled for this broadcast");

    let provider: any = null;
    let callsRemaining = Number.POSITIVE_INFINITY;
    if (config.tier2AiHook) {
      assertTier2HookPlaceholder(input.body, config);
      if (recipients.length > BROADCAST_TIER2_MAX_RECIPIENTS) {
        throw new BadRequestException(
          `Tier 2 (AI hook) supports at most ${BROADCAST_TIER2_MAX_RECIPIENTS} recipients per broadcast — this audience has ${recipients.length}. Narrow the audience or turn Tier 2 off; the hooks will not be silently dropped.`,
        );
      }
      provider = await providerForOrg(this.factory(), organizationId);
      if (!provider.isRealLlm) throw new BroadcastPersonalizationLlmNotConfiguredError();
      callsRemaining = await this.tier2CallBudget(organizationId);
    }

    const factsList = await this.loadRecipientFacts(organizationId, recipients);

    // Business facts for the Tier 2 prompt — the same
    // BusinessProfile fields MS9 reads; only fields that exist.
    let businessFacts: string[] = [];
    if (config.tier2AiHook) {
      const profile = await this.db().businessProfile?.findUnique({ where: { organizationId } }).catch(() => null);
      if (profile) {
        if (profile.description) businessFacts.push(`Business: ${profile.description}`);
        if (profile.industry) businessFacts.push(`Industry: ${profile.industry}`);
        if (profile.brandVoice) businessFacts.push(`Brand voice: ${profile.brandVoice}`);
      }
    }

    const varsList: Record<string, unknown>[] = input.baseVarsList.map((v) => ({ ...v }));
    const tiers: PersonalTier[] = recipients.map(() => "base");
    const fallbackReasons: Record<string, number> = {};
    let tier2Eligible = 0;
    let llmCallsMade = 0;
    const noteFallback = (reason: string) => { fallbackReasons[reason] = (fallbackReasons[reason] ?? 0) + 1; };
    const poolCache = new Map<string, ProductLite[]>();
    const poolFor = async (categories: string[]): Promise<ProductLite[]> => {
      const key = [...categories].sort().join(" ");
      const hit = poolCache.get(key);
      if (hit) return hit;
      const pool = await this.loadCandidatePool(organizationId, categories);
      poolCache.set(key, pool);
      return pool;
    };

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const facts = factsList[i];
      if (!facts.hasFacts) continue; // tier "base": vars stay byte-identical to the legacy pipeline
      const vars = varsList[i];
      if (facts.lastProductName) vars.lastProductName = facts.lastProductName;
      if (facts.lastCategory) vars.lastCategory = facts.lastCategory;
      if (facts.favoriteCategory) vars.favoriteCategory = facts.favoriteCategory;
      if (facts.languagePref) vars.languagePref = facts.languagePref;
      tiers[i] = "memory";
      if (!config.tier2AiHook) continue;
      if (channel !== "email" && channel !== "sms") continue;
      if (recipient.type !== "customer" || !facts.boughtCategories.length) continue;

      const candidates = this.candidatesFor(await poolFor(facts.boughtCategories), facts);
      if (!candidates.length) continue;
      tier2Eligible++;
      if (input.generateFor && !input.generateFor(i)) continue; // preview: counts only, no spend
      if (callsRemaining <= 0) { noteFallback("daily_cap"); continue; }

      const hook = await this.generateHook({
        organizationId, provider, actorId: input.actorId,
        body: input.body, subject: input.subject ?? null,
        businessFacts, facts, candidates,
      });
      llmCallsMade += hook.callsMade;
      callsRemaining -= hook.callsMade;
      if (hook.hook) {
        vars.aiHook = hook.hook;
        tiers[i] = "ai";
      } else {
        noteFallback(hook.reason ?? "guard");
      }
    }

    const counts = {
      total: recipients.length,
      base: tiers.filter((t) => t === "base").length,
      memory: tiers.filter((t) => t === "memory").length,
      ai: tiers.filter((t) => t === "ai").length,
      tier2Eligible,
      tier2Fallbacks: Object.values(fallbackReasons).reduce((a, b) => a + b, 0),
    };
    return {
      varsList, tiers, counts,
      tier2FallbackReasons: fallbackReasons,
      llmCallsMade,
      llmCallsProjected: tier2Eligible,
    };
  }

  /** ONE Tier 2 generation for ONE recipient. Every failure
   *  mode returns a reason instead of throwing — one
   *  recipient's bad generation never kills a send. */
  private async generateHook(input: {
    organizationId: string;
    provider: any;
    actorId: string;
    body: string;
    subject: string | null;
    businessFacts: string[];
    facts: RecipientFacts;
    candidates: ProductLite[];
  }): Promise<{ hook: string | null; reason?: string; callsMade: number }> {
    const { facts, candidates } = input;
    const priceOf = (pr: ProductLite): string => {
      try { return formatMinor(BigInt(pr.priceMinor as any), pr.currency ?? "BDT"); } catch { return ""; }
    };
    const factLines: string[] = [
      ...input.businessFacts,
      ...(facts.orderedNames.length ? [`এই customer আগে কিনেছেন: ${facts.orderedNames.slice(0, 5).join(", ")}`] : []),
      ...(facts.boughtCategories.length ? [`কেনা category: ${facts.boughtCategories.join(", ")}`] : []),
      "Recommendation candidates (একমাত্র এগুলো থেকেই বেছে নেওয়া যাবে):",
      ...candidates.map((c) => `- id=${c.id} | ${c.name} | category: ${c.category ?? ""} | price: ${priceOf(c)}`),
      `Broadcast message (staff-authored): ${input.body}`,
    ];
    const factsText = factLines.join("\n");
    const detected = detectReplyLanguage(input.body);
    const language = facts.languagePref === "bn" || facts.languagePref === "en"
      ? facts.languagePref
      : detected === "en" ? "en" : "bn";
    const systemPrompt = [
      "You write ONE personal opening line for a broadcast message to THIS customer only.",
      "Use ONLY the given facts. Never invent prices, discounts, stock, delivery promises or results.",
      "Any number you write must appear in the given facts, exactly as given.",
      "You may recommend at most ONE product, and only from the given candidate list, by its exact name.",
      language === "bn" ? "Write in Bengali (Bangla script)." : "Write in English.",
      `Return ONLY JSON {"hook": string, "productId": string|null} — hook is one line, at most ${TIER2_HOOK_MAX_CHARS} characters. productId is the recommended candidate's id, or null when the line recommends nothing.`,
    ].join("\n");

    let result: any;
    try {
      result = await input.provider.complete(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Facts:\n${factsText}` },
        ],
        { jsonMode: true, maxTokens: 400 },
      );
    } catch {
      return { hook: null, reason: "provider_error", callsMade: 0 };
    }
    // Usage AFTER provider success, BEFORE parsing (house
    // discipline) — the row stands even when the guard drops
    // the line below: the provider did the work.
    await this.db().aIUsageRecord.create({
      data: {
        organizationId: input.organizationId,
        userId: input.actorId,
        feature: BROADCAST_PERSONALIZATION_FEATURE,
        provider: input.provider.name,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimated: result.tokensEstimated,
      },
    }).catch(() => undefined);

    let parsed: any = null;
    try { parsed = JSON.parse(result.text); } catch { parsed = null; }
    const hook = typeof parsed?.hook === "string" ? parsed.hook.trim() : "";
    if (!hook || hook.length > TIER2_HOOK_MAX_CHARS) return { hook: null, reason: "parse", callsMade: 1 };
    const productId = parsed?.productId ?? null;
    if (productId !== null) {
      const chosen = candidates.find((c) => c.id === String(productId));
      if (!chosen) return { hook: null, reason: "product", callsMade: 1 };
      if (!hook.includes(chosen.name)) return { hook: null, reason: "product", callsMade: 1 };
    }
    // The shared number guard: the hook may carry ONLY numbers
    // present in this recipient's fact pack (their facts + the
    // candidates' real prices + the staff-authored body).
    const allowed = new Set<string>(extractGuardNumbers(factsText));
    const ungrounded = extractGuardNumbers(hook).filter((n) => !allowed.has(n));
    if (ungrounded.length) return { hook: null, reason: "guard", callsMade: 1 };
    return { hook, callsMade: 1 };
  }
}
