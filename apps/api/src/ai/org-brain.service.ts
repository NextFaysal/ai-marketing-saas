import { Inject, Injectable, Optional } from "@nestjs/common";
import { formatMinor } from "@repo/contracts";
import { PrismaService } from "../prisma/prisma.service";
import {
  contactFactLines,
  deliveryFactLines,
  hoursFactLines,
  matchKnowledge,
  paymentFactLines,
} from "../inbox/business-brain";
import { EmbeddingsService } from "./embeddings.service";
import { VECTOR_STORE, type VectorStore } from "./vector-store";
import { AdsIntelligenceService, type AdsDigest } from "./ads-intelligence.service";
import { CompetitorIntelligenceService, type CompetitorDigest } from "./competitor-intelligence.service";

/**
 * SA-B1 (Smart AI Phase 0, P1): OrgBrainService — the ONE context
 * service every AI consumer reads business knowledge through
 * (Master Plan P1). It replaces the per-consumer hand-rolled
 * profile/policy/knowledge loading with a single audience-aware
 * read, enforcing the governing laws at the data layer:
 *
 *  L1 (unique brain): every query is scoped to the one
 *      organizationId argument — there is no cross-org read path.
 *  L2 (grounding): the context contains only facts sourced from
 *      this org's own rows (profile fact lines, policies, matched
 *      knowledge documents); nothing is synthesised here.
 *  L3 (confidentiality): the audience decides what may enter the
 *      context BEFORE any model sees it. A "customer" context can
 *      never contain internal-visibility knowledge documents or
 *      INTERNAL profile fields (see the classification below) —
 *      the model cannot leak what it was never given.
 *  L4 (live wins): fact lines are rebuilt from the live profile
 *      row on every call; nothing is cached from older reads.
 *
 * Profile field classification (SA-B1, implemented in this file —
 * the acceptance doc carries the same table):
 *  PUBLIC (both audiences, via the business-brain fact builders):
 *    delivery charges/days/free-delivery/minimum order, COD +
 *    bKash/Nagad payment numbers + advance % + payment note,
 *    contact phone/email, public address/city, website URL,
 *    business hours, return window — plus the marketing identity
 *    fields industry / description / brandVoice.
 *  INTERNAL (internal audience only, via `internalProfile`):
 *    goals, monthlyBudgetMinor, budgetCurrency, targetCustomers,
 *    businessModel, uniqueSellingPoints, tradeLicenseNo,
 *    billingEmails. (uniqueSellingPoints is INTERNAL by deliberate
 *    choice: it is owner-drafted positioning that has never been
 *    part of the customer fact pack and may carry comparative
 *    claims not vetted for verbatim customer quoting.)
 *  NEVER surfaced by this service to any audience (as before):
 *    metaCapiToken (a secret), metaPixelId, tikTokPixelId,
 *    aiInstructionsDraft (unpublished working copy), billingAddress,
 *    billingBin, businessAddress (verification record), COD/deposit
 *    rule internals beyond the public payment fact lines.
 *  BEHAVIOUR (both audiences, published text only — it steers
 *    style, never facts, Milestone 77 discipline):
 *    aiInstructions, aiReplyLanguage.
 *
 * SA-B5 additions, same discipline:
 *  PERFORMANCE (P7): the latest PerformanceSnapshot is read
 *    ONLY for the internal audience — it is INTERNAL class
 *    (order counts, revenue, campaign returns) and a
 *    customer-class context never contains its numbers.
 *  VOICE (P8a): an ACTIVE learned brand-voice profile renders
 *    as `styleInstructions` — wording guidance kept separate
 *    from facts; a merely-suggested profile affects nothing,
 *    and the owner's explicit brandVoice text takes precedence
 *    inside the block when both exist.
 *  CUSTOMER MEMORY (P8b): CUSTOMER-OWN class. Admitted only
 *    for the "own_customer" audience or an internal context
 *    explicitly carrying that customer's key; a plain
 *    "customer" context never reads the memory table.
 *
 * SA-B7 addition (Phase 1, R1):
 *  PRODUCT MATCHES: the vector path also searches the
 *    "product" source type SA-B2/B4 indexed (qualitative
 *    catalog text only — price/stock are never in the index
 *    and keep arriving from live rows in the consumers).
 *    Admission is through the LIVE product row (org-scoped,
 *    ACTIVE, current name), exactly like document hits.
 *
 * SA-B14 addition (Phase 3, A1):
 *  ADS DIGEST: the deterministic AdsIntelligenceService
 *    digest (period-over-period totals, platform split,
 *    top/bottom campaigns, pacing, anomaly flags) is computed
 *    live and exposed ONLY for the internal audience — ad
 *    spend/ROAS are INTERNAL class exactly like performance,
 *    and a customer-class context never contains them.
 *
 * SA-B17 addition (Phase 4, C1):
 *  COMPETITOR DIGEST: the deterministic
 *    CompetitorIntelligenceService digest over the competitor
 *    rows the org already collects (Ad Library sync activity,
 *    creative-theme counts, scanner price series) is computed
 *    live and exposed ONLY for the internal audience — a
 *    rival's prices and ad activity are the org's private
 *    intelligence (INTERNAL class, law L3), and a
 *    customer-class context never contains a competitor's
 *    name or prices. Approved competitor LearnedItems join
 *    the same section, and approval also lands them as
 *    internal KnowledgeDocuments through the normal SA-B4
 *    channel (retrieval-by-query) — verified, not duplicated.
 *
 * SA-B22 addition (Phase 6, T1):
 *  PLATFORM GUIDANCE: SUPER-admin teaching (PlatformTeaching
 *    rows, the Admin Training Console) is PLATFORM scope — the
 *    one deliberate exception to "everything here is this org's
 *    rows", and it is guidance, never facts. It is assembled
 *    LAST (after every org section) as `platformGuidance`, in
 *    the guidance channel next to styleInstructions, under a
 *    heading that states it yields to the org's own facts and
 *    instructions on any conflict (plan D8: admin global
 *    teaching ranks BELOW org instructions). It is never merged
 *    into facts / factsText / knowledge matches, so its
 *    numbers can never enter a fact pack, pass the number
 *    guard, or ground an Answer Store entry — teaching can
 *    shape how the AI speaks, never what it claims about a
 *    shop. Precedence here is structural + labelling (section
 *    placement and the yield heading), not a mechanical
 *    conflict resolver — recorded honestly.
 */

/**
 * SA-B5 (P8b): a third audience joins the SA-B1 pair.
 * "own_customer" is customer-class in every filter (public
 * knowledge only, no internal profile, no performance) PLUS the
 * one customer's own memory, and it exists only together with
 * that customer's key — the inbox passes it when it builds the
 * fact pack for the customer's own conversation. A plain
 * "customer" context NEVER carries a memory, even if a key is
 * passed by mistake: customer memory is CUSTOMER-OWN class
 * (law L3) and the audience is the switch that admits it.
 */
export type BrainAudience = "customer" | "own_customer" | "internal";

export interface BrainKnowledgeMatch {
  docId: string;
  kind: string;
  title: string;
  content: string;
  /** The document's disclosure class: "public" | "internal". */
  visibility: string;
  score: number;
  /** SA-B2: which retriever produced this match. Keyword scores
   *  are overlap counts; vector scores are cosine similarities —
   *  the two scales are never compared against each other (the
   *  merge is vector-first, keyword fill — see getContext). */
  via?: "keyword" | "vector";
  /** SA-B2: the sub-chunk of the document a vector match hit. */
  chunkIndex?: number;
}

/** SA-B7 (Phase 1, R1): a semantic match against the org's
 * indexed PRODUCT text (SA-B2/B4 index product descriptions,
 * categories, tags, attributes — never prices or stock, which
 * stay live-read only). The chunk text comes from the index;
 * the product NAME is re-read from the live row at context
 * time, and a product that is gone or no longer ACTIVE never
 * surfaces — a stale index row cannot resurrect it (L4). */
export interface BrainProductMatch {
  productId: string;
  /** The product's CURRENT name from its live row. */
  name: string;
  /** The matched index chunk (qualitative text — by the SA-B2
   * indexing rule it contains no price/stock values). */
  content: string;
  score: number;
  via: "vector";
}

/**
 * SA-B2: the floor a vector hit must clear to count as knowledge.
 * Below it, a "nearest" row is treated as NO match — grounding a
 * reply on a weak semantic neighbour would violate L2 (the
 * system would rather say it does not know). Deliberately
 * conservative; the merge spec pins the behaviour.
 */
export const MIN_VECTOR_SIMILARITY = 0.35;

/** SA-B5 (P8a): the org's learned brand voice, as stored by
 * VoiceLearningService. Traits use closed vocabularies; the
 * snippets are PII-masked staff excerpts verified verbatim
 * against the samples they were drawn from. */
export interface BrainVoiceTraits {
  formality: string | null;
  emojiUse: string | null;
  greetingStyle: string | null;
  languageMix: string | null;
  avgSentence: string | null;
  signaturePhrases: string[];
}

export interface BrainVoiceProfile {
  status: string;
  traits: BrainVoiceTraits;
  exampleSnippets: string[];
  /** A newer proposal waiting for a human decision — present
   * only for the internal audience; never affects style. */
  pendingTraits: BrainVoiceTraits | null;
  pendingExamples: string[] | null;
}

/** SA-B5 (P8b): one customer's memory (CUSTOMER-OWN class). */
export interface BrainCustomerMemory {
  customerKey: string;
  displayName: string | null;
  languagePref: string | null;
  topics: { productId: string | null; name: string; via: string }[];
  orderCount: number;
  lastOrderAt: string | null;
  notes: { kind: string; text: string; conversationId: string | null; at: string | null }[];
  lastInteractionAt: string | null;
}

export interface BrainInternalProfile {
  goals: string | null;
  monthlyBudgetMinor: string | null;
  budgetCurrency: string | null;
  targetCustomers: unknown;
  businessModel: string | null;
  uniqueSellingPoints: string | null;
  tradeLicenseNo: string | null;
  billingEmails: unknown;
}

export interface OrgBrainContext {
  audience: BrainAudience;
  orgName: string | null;
  /** PUBLIC verified fact lines (delivery+payment+contact+hours). */
  facts: string[];
  factsText: string;
  deliveryFacts: string[];
  paymentFacts: string[];
  contactFacts: string[];
  hoursFacts: string[];
  /** Marketing identity fields, safe for both audiences. */
  publicProfile: {
    industry: string | null;
    description: string | null;
    brandVoice: string | null;
    websiteUrl: string | null;
  } | null;
  /** This org's policies (first 20, as the tools path always read). */
  policies: any[];
  /** The first policy of `policyType`, when one was requested. */
  typedPolicy: any | null;
  /** Recent documents — only when includeRecentDocs was requested;
   *  audience-filtered (customer: public only). */
  documents: any[];
  /** Matched documents for `query` (empty without a query);
   *  audience-filtered and labelled with their visibility. */
  knowledgeMatches: BrainKnowledgeMatch[];
  /** SA-B7 (R1): semantic matches over the indexed product text
   *  (see BrainProductMatch). Vector-only: without a working
   *  embeddings path this is empty and behaviour is exactly the
   *  pre-SA-B7 one — products never had a keyword description
   *  matcher, and none is invented here. */
  productMatches: BrainProductMatch[];
  /** SA-B2: how knowledgeMatches were retrieved — "hybrid" when
   *  the vector search actually ran for this call, "keyword" when
   *  it could not (embeddings unavailable / not wired). The label
   *  is honest by construction: it flips to "hybrid" only after a
   *  successful query embedding + store search. */
  retrievalMode: "keyword" | "hybrid";
  /** INTERNAL profile fields — null unless audience is internal. */
  internalProfile: BrainInternalProfile | null;
  /** Published owner behaviour (both audiences). */
  ownerInstructions: string | null;
  replyLanguage: string | null;
  sources: any[];
  /** SA-B5 (P7): the latest performance snapshot — INTERNAL
   * audience only (business metrics are INTERNAL class, law
   * L3). Null for customer-class audiences and for orgs with no
   * snapshot yet; `performanceFacts` is its rendered, period-
   * labelled form. */
  performance: { periodStart: string; periodEnd: string; windowDays: number; metrics: any } | null;
  performanceFacts: string[];
  /** SA-B14 (A1): the deterministic ads digest — INTERNAL
   * audience only (ad spend/ROAS are INTERNAL class, law L3).
   * Null for customer-class audiences and for orgs with no
   * campaign-level ad data in the window; `adsFacts` is its
   * rendered, period-labelled form. */
  adsDigest: AdsDigest | null;
  adsFacts: string[];
  /** SA-B16 (A3): APPROVED creative-pattern learnings —
   * INTERNAL audience only (creative CTR/ROAS are INTERNAL
   * class, law L3). The statements of the org's approved
   * LearnedItems with sourceType "creative", newest first
   * (cap 5). Empty for customer-class audiences and for orgs
   * with no approved creative learning yet — suggested items
   * never appear here (D3: suggested is not knowledge). */
  creativeFacts: string[];
  /** SA-B17 (C1): the deterministic competitor digest —
   *  INTERNAL audience only (rival prices/activity are
   *  INTERNAL class, law L3, and strictly per-org, law L1).
   *  Null for customer-class audiences and for orgs tracking
   *  no competitors; `competitorFacts` is its rendered form
   *  plus the org's APPROVED competitor learnings. */
  competitorDigest: CompetitorDigest | null;
  competitorFacts: string[];
  /** SA-B5 (P8a): the learned brand voice. For customer-class
   * audiences only an ACTIVE profile is exposed; the internal
   * audience also sees a suggested profile and any pending
   * re-learn proposal (the review surface's data). */
  voiceProfile: BrainVoiceProfile | null;
  /** SA-B5 (P8a): the style block reply composition injects —
   * WORDING guidance only, kept structurally separate from
   * facts. Non-null only when an ACTIVE learned profile
   * exists; the owner's explicit brandVoice text, when set,
   * leads it under a precedence label. With no active learned
   * profile this is null and reply behaviour is exactly what
   * it was before SA-B5. */
  styleInstructions: string | null;
  /** SA-B5 (P8b): the requested customer's memory — present
   * only for audience "own_customer" (the customer's own
   * conversation) or for "internal" WITH an explicit
   * customerKey (staff viewing that customer's thread). */
  customerMemory: BrainCustomerMemory | null;
  customerMemoryFacts: string[];
  /** SA-B22 (T1): platform guidance from the Admin Training
   *  Console (PlatformTeaching) — the guidance channel, NOT
   *  facts. Present for every audience (it steers wording and
   *  conduct platform-wide), rendered under the yield heading
   *  (PLATFORM_GUIDANCE_HEADING): it ranks BELOW this org's own
   *  facts and the owner's instructions (D8). Null when no
   *  enabled teaching exists, and consumers then compose
   *  exactly as they did before SA-B22. It is structurally
   *  separate from `facts`/`factsText` — the number guard and
   *  the Answer Store never see it as grounding. */
  platformGuidance: string | null;
}

export interface OrgBrainQuery {
  audience: BrainAudience;
  query?: string;
  /** Knowledge match cap (inbox fact pack: 2, tools: 5). Default 2. */
  matchLimit?: number;
  /** Also return the recent-documents list (tools path). */
  includeRecentDocs?: boolean;
  /** Also return the first policy of this type (inbox intent path). */
  policyType?: string;
  /** SA-B5 (P8b): the customer whose memory may be read —
   * "<channel>:<externalContactId>" (see CustomerMemory). Only
   * honoured for the "own_customer" and "internal" audiences. */
  customerKey?: string;
}

const visibilityOf = (doc: any): string => (doc?.visibility === "internal" ? "internal" : "public");

/** SA-B5: coerce a stored traits Json into the closed shape —
 * the write side validates too, but a context read never trusts
 * a Json column blindly. Unknown values become null. */
export function normalizeVoiceTraits(raw: any): BrainVoiceTraits {
  const t = raw && typeof raw === "object" ? raw : {};
  const pick = (v: any, allowed: string[]): string | null =>
    typeof v === "string" && allowed.includes(v) ? v : null;
  return {
    formality: pick(t.formality, ["formal", "neutral", "friendly"]),
    emojiUse: pick(t.emojiUse, ["none", "light", "frequent"]),
    greetingStyle: typeof t.greetingStyle === "string" && t.greetingStyle.trim() ? t.greetingStyle.slice(0, 120) : null,
    languageMix: pick(t.languageMix, ["bn", "en", "mixed"]),
    avgSentence: pick(t.avgSentence, ["short", "medium", "long"]),
    signaturePhrases: Array.isArray(t.signaturePhrases)
      ? t.signaturePhrases.filter((x: any) => typeof x === "string" && x.trim()).slice(0, 5).map((x: string) => x.slice(0, 60))
      : [],
  };
}

const snippetList = (raw: any): string[] =>
  Array.isArray(raw) ? raw.filter((x: any) => typeof x === "string" && x.trim()).slice(0, 3).map((x: string) => x.slice(0, 300)) : [];

/** SA-B5 (P8a): render the learned voice as a style block.
 * Every line is wording guidance; nothing here is a fact. */
export function renderVoiceStyle(traits: BrainVoiceTraits, examples: string[]): string {
  const lines: string[] = [];
  if (traits.formality) lines.push(`Tone: ${traits.formality}`);
  if (traits.emojiUse) lines.push(`Emoji use: ${traits.emojiUse}`);
  if (traits.greetingStyle) lines.push(`Greeting style: ${traits.greetingStyle}`);
  if (traits.languageMix) {
    lines.push(`Language mix: ${traits.languageMix === "bn" ? "mainly Bengali" : traits.languageMix === "en" ? "mainly English" : "Bengali and English mixed (Banglish)"}`);
  }
  if (traits.avgSentence) lines.push(`Sentence length: ${traits.avgSentence}`);
  if (traits.signaturePhrases.length) lines.push(`Signature phrases: ${traits.signaturePhrases.join(" · ")}`);
  if (examples.length) {
    lines.push("Example replies in this voice (style reference only — never quote them as facts):");
    for (const ex of examples) lines.push(`- ${ex}`);
  }
  return lines.join("\n");
}

/** SA-B5 (P8a): the style block for reply composition.
 * Precedence (recorded): the owner's explicit brandVoice text
 * is a standing instruction and WINS — when both exist it leads
 * under a precedence label and the learned style applies only
 * where it does not conflict. Non-null ONLY when an active
 * learned profile exists, so an org without one composes
 * exactly as it did before SA-B5. */
export function buildStyleInstructions(ownerBrandVoice: string | null, profile: any): string | null {
  if (!profile || profile.status !== "active") return null;
  const learned = renderVoiceStyle(normalizeVoiceTraits(profile.traits), snippetList(profile.exampleSnippets));
  if (!learned) return null;
  const owner = ownerBrandVoice?.trim() ? ownerBrandVoice.trim() : null;
  if (!owner) return learned;
  return [
    `Owner's brand voice — standing instruction; it takes precedence over the learned style below wherever they conflict:`,
    owner,
    `Learned style from the shop's own replies (applies only where it does not conflict with the owner's text above):`,
    learned,
  ].join("\n");
}

/** SA-B22 (T1): the yield heading of the platform-guidance
 * block — the label IS the precedence mechanism (with the
 * section's last-place assembly). It states, verbatim, that
 * platform teaching is general guidance only and that the
 * shop's own facts and instructions win on any conflict (D8).
 * Specs pin this string so the label can never silently
 * weaken. */
export const PLATFORM_GUIDANCE_HEADING =
  "Platform guidance (general guidance from the platform team — it shapes wording and conduct ONLY, never facts about this shop. Where it conflicts with this shop's own verified facts or the owner's instructions, the SHOP's facts and instructions win — always):";

/** SA-B22 (T1): render enabled PlatformTeaching rows as the
 * guidance block. Caps keep one runaway console from flooding
 * every prompt: at most 10 items, each content clipped to 600
 * chars. Empty input renders null (consumers then compose
 * exactly as before SA-B22). */
export function renderPlatformGuidance(items: any[]): string | null {
  const rows = (Array.isArray(items) ? items : [])
    .filter((r: any) => r && r.enabled !== false && String(r.content ?? "").trim())
    .slice(0, 10);
  if (!rows.length) return null;
  const lines = rows.map((r: any) => {
    const kind = String(r.kind ?? "guidance");
    const title = String(r.title ?? "").trim();
    const content = String(r.content).trim().slice(0, 600);
    return `- [${kind}]${title ? ` ${title}:` : ""} ${content}`;
  });
  return [PLATFORM_GUIDANCE_HEADING, ...lines].join("\n");
}

const moneyText = (minorStr: any, currency: string | null): string => {
  try {
    return formatMinor(BigInt(minorStr ?? 0), currency ?? "BDT");
  } catch {
    return String(minorStr ?? 0);
  }
};
const dayLabel = (iso: any): string => String(iso ?? "").slice(0, 10);

/** SA-B5 (P7): render a performance snapshot as period-labelled
 * fact lines for the INTERNAL audience. Every number comes from
 * the snapshot's deterministic aggregates; the period is always
 * named so a metric is never mistaken for an all-time figure. */
export function performanceFactLines(metrics: any): string[] {
  if (!metrics || typeof metrics !== "object") return [];
  const lines: string[] = [];
  const head = `কর্মক্ষমতা (${dayLabel(metrics.periodStart)} – ${dayLabel(metrics.periodEnd)}, গত ${metrics.windowDays} দিন):`;
  const inbox = metrics.inbox ?? {};
  if (inbox.closed || inbox.conversationsHandled) {
    let line = `ইনবক্স: ${inbox.conversationsHandled ?? 0}টি কথোপকথন সক্রিয় ছিল, ${inbox.closed ?? 0}টি বন্ধ হয়েছে`;
    if (inbox.closed) {
      line += `; নিজে থেকে (AI) সমাধান হয়েছে ${inbox.aiResolved ?? 0}টি`;
      if (inbox.aiResolvedShare != null) line += ` (${Math.round(Number(inbox.aiResolvedShare) * 100)}%)`;
    }
    if (inbox.ordersFromInbox) line += `; চ্যাট থেকে অর্ডার ${inbox.ordersFromInbox}টি (মূল্য ${moneyText(inbox.ordersFromInboxValueMinor, null)})`;
    if (inbox.csatCount) line += `; customer সন্তুষ্টি গড় ${inbox.csatAvg}/৫ (${inbox.csatCount}টি রেটিং)`;
    lines.push(line + "।");
  }
  const sales = metrics.sales ?? {};
  if (sales.orders) {
    let line = `বিক্রি: মোট ${sales.orders}টি অর্ডার, আয় ${moneyText(sales.revenueMinor, null)}`;
    const top = sales.topProducts?.[0];
    if (top) line += `; সেরা বিক্রিত পণ্য "${top.name}" (${top.qty}টি)`;
    if (sales.returns?.total) line += `; রিটার্ন অনুরোধ ${sales.returns.total}টি`;
    lines.push(line + "।");
    if (sales.reviews?.count) {
      lines.push(`রিভিউ: গড় রেটিং ${sales.reviews.avgRating}/৫ (${sales.reviews.count}টি রিভিউ)।`);
    }
  }
  const ads = metrics.ads ?? {};
  if (ads.topCampaigns?.length || (ads.spendMinor && ads.spendMinor !== "0")) {
    let line = `বিজ্ঞাপন: মোট ব্যয় ${moneyText(ads.spendMinor, ads.currency)}`;
    const top = ads.topCampaigns?.[0];
    if (top) line += `; সেরা campaign "${top.name}" (ROAS ${top.roas ?? "—"})`;
    lines.push(line + "।");
  }
  const social = metrics.social ?? {};
  if (social.topPosts?.length) {
    const top = social.topPosts[0];
    lines.push(`সোশ্যাল: সেরা পোস্টের engagement ${top.engagement} ("${String(top.caption ?? "").slice(0, 60)}")।`);
  }
  return lines.length ? [head, ...lines] : [];
}

/** SA-B5 (P8b): render one customer's memory as fact lines for
 * THEIR OWN context. Commerce facts only — language observed,
 * products asked/bought, order history, recorded outcomes. */
export function customerMemoryFactLines(memory: BrainCustomerMemory): string[] {
  const lines: string[] = [];
  if (memory.languagePref === "bn") lines.push("এই customer সাধারণত বাংলায় কথা বলেন।");
  else if (memory.languagePref === "en") lines.push("This customer usually writes in English.");
  else if (memory.languagePref === "mixed") lines.push("এই customer বাংলা ও ইংরেজি মিশিয়ে (Banglish) কথা বলেন।");
  const ordered = memory.topics.filter((t) => t.via === "ordered").map((t) => t.name);
  const asked = memory.topics.filter((t) => t.via !== "ordered").map((t) => t.name);
  if (ordered.length) lines.push(`আগে কিনেছেন: ${ordered.join(", ")}।`);
  if (asked.length) lines.push(`আগে যেসব পণ্যের কথা জিজ্ঞেস করেছেন: ${asked.join(", ")}।`);
  if (memory.orderCount > 0) {
    lines.push(
      `এই customer-এর মোট অর্ডার: ${memory.orderCount}টি${memory.lastOrderAt ? `; সর্বশেষ অর্ডার: ${dayLabel(memory.lastOrderAt)}` : ""}।`,
    );
  }
  for (const note of memory.notes.slice(0, 5)) {
    if (note.text) lines.push(`আগের নোট: ${note.text}`);
  }
  return lines;
}

@Injectable()
export class OrgBrainService {
  constructor(
    private readonly prisma: PrismaService,
    // SA-B2: hybrid retrieval collaborators. Optional so every
    // existing positional construction (`new OrgBrainService(
    // prisma)` in specs and in the consumers' lazy fallbacks)
    // keeps working and yields exactly the SA-B1 keyword
    // behaviour; the running app always wires both via
    // OrgBrainModule.
    @Optional() private readonly embeddings?: EmbeddingsService,
    @Optional() @Inject(VECTOR_STORE) private readonly vectorStore?: VectorStore,
    // SA-B14 (A1): the ads digest collaborator. Optional for
    // the same reason as the retrieval pair above — positional
    // constructions keep working; the fallback computes from
    // the same prisma handle, and OrgBrainModule wires the
    // shared instance in the running app.
    @Optional() private readonly adsIntelligence?: AdsIntelligenceService,
    // SA-B17 (C1): the competitor digest collaborator.
    // Optional for the same reason as the ads one above.
    @Optional() private readonly competitorIntelligence?: CompetitorIntelligenceService,
  ) {}

  private adsFallback?: AdsIntelligenceService;
  private ads(): AdsIntelligenceService {
    return this.adsIntelligence ?? (this.adsFallback ??= new AdsIntelligenceService(this.prisma as any));
  }

  private competitorFallback?: CompetitorIntelligenceService;
  private competitor(): CompetitorIntelligenceService {
    return this.competitorIntelligence ?? (this.competitorFallback ??= new CompetitorIntelligenceService(this.prisma as any));
  }

  /** Defensive read: a missing table/model on a partial prisma
   *  double means "no facts", never a throw (the discipline the
   *  inbox fact pack always had). */
  private async safe<T>(call: (() => unknown) | undefined, fallback: T): Promise<T> {
    try {
      const value = await (call ? call() : undefined);
      return (value ?? fallback) as T;
    } catch {
      return fallback;
    }
  }

  async getContext(organizationId: string, opts: OrgBrainQuery): Promise<OrgBrainContext> {
    const p = this.prisma as any;
    const audience = opts.audience;
    // SA-B5: "own_customer" is customer-class for EVERY filter
    // below; only the memory admission at the end differs.
    const customer = audience !== "internal";

    const profile = await this.safe<any>(
      () => p.businessProfile?.findUnique?.({ where: { organizationId } }),
      null,
    );
    const org = await this.safe<any>(
      () => p.organization?.findUnique?.({ where: { id: organizationId }, select: { name: true } }),
      null,
    );
    const policies = await this.safe<any[]>(
      () => p.businessPolicy?.findMany?.({ where: { organizationId }, take: 20 }),
      [],
    );
    const typedPolicy = opts.policyType
      ? await this.safe<any>(
          () => p.businessPolicy?.findFirst?.({ where: { organizationId, type: opts.policyType } }),
          null,
        )
      : null;

    // Knowledge: one org-scoped pool, filtered by audience HERE —
    // a customer context is built only from public documents.
    let documents: any[] = [];
    if (opts.includeRecentDocs) {
      const recent = await this.safe<any[]>(
        () => p.knowledgeDocument?.findMany?.({ where: { organizationId }, take: 20, orderBy: { createdAt: "desc" } }),
        [],
      );
      documents = customer ? recent.filter((d: any) => visibilityOf(d) === "public") : recent;
    }
    let knowledgeMatches: BrainKnowledgeMatch[] = [];
    let productMatches: BrainProductMatch[] = [];
    let retrievalMode: "keyword" | "hybrid" = "keyword";
    if (opts.query) {
      const pool = await this.safe<any[]>(
        () => p.knowledgeDocument?.findMany?.({ where: { organizationId }, take: 100 }),
        [],
      );
      const visible = customer ? pool.filter((d: any) => visibilityOf(d) === "public") : pool;
      const matchLimit = opts.matchLimit ?? 2;
      const keywordMatches: BrainKnowledgeMatch[] = matchKnowledge(opts.query, visible as any[], matchLimit).map((m) => ({
        docId: m.doc.id,
        kind: m.doc.kind,
        title: m.doc.title,
        content: String(m.doc.content ?? ""),
        visibility: visibilityOf(m.doc),
        score: m.score,
        via: "keyword" as const,
      }));
      knowledgeMatches = keywordMatches;

      // SA-B2 hybrid retrieval: the vector path ADDS semantic
      // matches on top of the keyword result; it never replaces
      // it. Merge rule (deterministic, recorded in the acceptance
      // doc): vector hits first (best similarity first, at most
      // one per document), then keyword hits for documents the
      // vector path did not already cover, capped at matchLimit.
      // Any failure or unavailability leaves the keyword result
      // EXACTLY as SA-B1 produced it, labelled "keyword".
      if (this.embeddings && this.vectorStore) {
        try {
          const emb = await this.embeddings.embedOne(organizationId, opts.query);
          if (emb.ok) {
            const hits = await this.vectorStore.search(organizationId, emb.vectors[0], {
              provider: emb.provider,
              model: emb.model,
              limit: matchLimit * 2,
              audience,
              sourceTypes: ["knowledge_chunk"],
            });
            retrievalMode = "hybrid";
            const strong = hits.filter((h) => h.similarity >= MIN_VECTOR_SIMILARITY);
            if (strong.length) {
              // Defence in depth for L3/L4: a hit is admitted
              // only through its LIVE document row — org-scoped
              // and audience-filtered here as well as in SQL — so
              // a stale embedding row (source deleted or
              // reclassified internal after indexing) can never
              // reach a customer context.
              const hitDocIds = [...new Set(strong.map((h) => h.sourceId))];
              const hitDocs = await this.safe<any[]>(
                () => p.knowledgeDocument?.findMany?.({ where: { organizationId, id: { in: hitDocIds } } }),
                [],
              );
              const docById = new Map(
                (customer ? hitDocs.filter((d: any) => visibilityOf(d) === "public") : hitDocs).map((d: any) => [d.id, d]),
              );
              const seen = new Set<string>();
              const vectorMatches: BrainKnowledgeMatch[] = [];
              for (const hit of strong) {
                const doc = docById.get(hit.sourceId);
                if (!doc || seen.has(hit.sourceId)) continue;
                seen.add(hit.sourceId);
                vectorMatches.push({
                  docId: hit.sourceId,
                  kind: doc.kind,
                  title: doc.title,
                  content: hit.content,
                  visibility: visibilityOf(doc),
                  score: hit.similarity,
                  via: "vector",
                  chunkIndex: hit.chunkIndex,
                });
              }
              const fill = keywordMatches.filter((m) => !seen.has(m.docId));
              knowledgeMatches = [...vectorMatches, ...fill].slice(0, matchLimit);
            }
          }
        } catch {
          retrievalMode = "keyword";
          knowledgeMatches = keywordMatches;
        }
      }

      // SA-B7 (R1): semantic PRODUCT matches — the second
      // retrieval surface over the same index. SA-B2/B4 indexed
      // the catalog's qualitative text (description, category,
      // tags, attributes, variant names — never price/stock),
      // but no consumer ever searched the "product" source
      // type; R1 wires it here so every Brain consumer (inbox
      // fact pack, draft composer, order bot) can answer
      // questions ABOUT a product, not only its price. Its own
      // try/catch: a product-path failure degrades to "no
      // product matches" and can never disturb the knowledge
      // result above. Admission mirrors the document rule
      // (L3/L4): a hit counts only through its LIVE product
      // row — org-scoped, ACTIVE, name re-read from the row —
      // so an archived/renamed product's stale chunk cannot
      // speak for it, and another org's product can never
      // appear (the search itself is org-bound in SQL).
      if (this.embeddings && this.vectorStore) {
        try {
          const emb = await this.embeddings.embedOne(organizationId, opts.query);
          if (emb.ok) {
            const hits = await this.vectorStore.search(organizationId, emb.vectors[0], {
              provider: emb.provider,
              model: emb.model,
              limit: matchLimit * 2,
              audience,
              sourceTypes: ["product"],
            });
            const strong = hits.filter((h) => h.similarity >= MIN_VECTOR_SIMILARITY);
            if (strong.length) {
              const hitProductIds = [...new Set(strong.map((h) => h.sourceId))];
              const liveRows = await this.safe<any[]>(
                () => p.product?.findMany?.({ where: { organizationId, id: { in: hitProductIds } } }),
                [],
              );
              const liveById = new Map(
                (liveRows ?? []).filter((r: any) => r && r.status === "ACTIVE").map((r: any) => [r.id, r]),
              );
              const seen = new Set<string>();
              for (const hit of strong) {
                const row = liveById.get(hit.sourceId);
                if (!row || seen.has(hit.sourceId)) continue;
                seen.add(hit.sourceId);
                productMatches.push({
                  productId: hit.sourceId,
                  name: String(row.name ?? ""),
                  content: hit.content,
                  score: hit.similarity,
                  via: "vector",
                });
                if (productMatches.length >= matchLimit) break;
              }
            }
          }
        } catch {
          productMatches = [];
        }
      }
    }

    const deliveryFacts = profile ? deliveryFactLines(profile) : [];
    const paymentFacts = profile ? paymentFactLines(profile) : [];
    const contactFacts = profile ? contactFactLines(profile) : [];
    const hoursFacts = profile ? hoursFactLines(profile) : [];
    const facts = [...deliveryFacts, ...paymentFacts, ...contactFacts, ...hoursFacts];

    const sources: any[] = [];
    if (facts.length) sources.push({ type: "business_profile" });
    for (const policy of policies) sources.push({ type: "business_policy", policyId: policy.id });
    for (const m of knowledgeMatches) sources.push({ type: "knowledge", docId: m.docId, kind: m.kind, visibility: m.visibility, ...(m.via ? { via: m.via } : {}) });
    for (const m of productMatches) sources.push({ type: "product_knowledge", productId: m.productId, via: m.via });

    // SA-B5 (P7): performance — INTERNAL audience only. The
    // snapshot table is read live (latest 7-day window
    // preferred); a customer-class context does not even
    // contain the numbers, exactly like internalProfile.
    let performance: OrgBrainContext["performance"] = null;
    let performanceFacts: string[] = [];
    if (!customer) {
      const snapshots = await this.safe<any[]>(
        () => p.performanceSnapshot?.findMany?.({ where: { organizationId }, orderBy: { computedAt: "desc" }, take: 6 }),
        [],
      );
      const snap = (snapshots ?? []).find((s: any) => Number(s?.metrics?.windowDays) === 7) ?? (snapshots ?? [])[0];
      if (snap?.metrics) {
        performance = {
          periodStart: snap.periodStart instanceof Date ? snap.periodStart.toISOString() : String(snap.periodStart),
          periodEnd: snap.periodEnd instanceof Date ? snap.periodEnd.toISOString() : String(snap.periodEnd),
          windowDays: Number(snap.metrics.windowDays ?? 0),
          metrics: snap.metrics,
        };
        performanceFacts = performanceFactLines(snap.metrics);
      }
    }

    // SA-B14 (A1): ads digest — INTERNAL audience only, the
    // same structural rule as performance above: a customer-
    // class context does not even contain the numbers.
    // Computed live from DailyAdMetric (no snapshot table —
    // the digest IS the computation), trailing 7 days vs the
    // prior 7.
    let adsDigest: AdsDigest | null = null;
    let adsFacts: string[] = [];
    if (!customer) {
      const digest = await this.safe<AdsDigest | null>(
        () => this.ads().computeDigest(organizationId, { days: 7 }),
        null,
      );
      if (digest?.hasData) {
        adsDigest = digest;
        adsFacts = digest.factLines;
      }
    }

    // SA-B16 (A3): approved creative patterns — INTERNAL
    // audience only, the same structural rule as performance
    // and ads above. The normal learned-fact channel is the
    // LearnedItem approval flow (SA-B4): mining SUGGESTS,
    // a human approves, and only then does a pattern become
    // Brain knowledge. (Approval also lands the statement as
    // an internal KnowledgeDocument for query retrieval —
    // this section is the always-on summary surface, read
    // from the approved items themselves so it can never
    // drift from the review record.)
    let creativeFacts: string[] = [];
    if (!customer) {
      const approvedCreative = await this.safe<any[]>(
        () =>
          p.learnedItem?.findMany?.({
            where: { organizationId, sourceType: "creative", status: "approved" },
            orderBy: { reviewedAt: "desc" },
            take: 5,
          }),
        [],
      );
      const statements = (approvedCreative ?? [])
        .map((it: any) => String(it?.content?.text ?? "").trim())
        .filter(Boolean);
      if (statements.length) {
        creativeFacts = [`শেখা creative pattern (অনুমোদিত):`, ...statements.map((s: string) => `- ${s}`)];
      }
    }

    // SA-B17 (C1): competitor digest + approved competitor
    // learnings — INTERNAL audience only, the same structural
    // rule as performance/ads/creative above: a customer-class
    // context does not even contain a competitor's name. The
    // digest is computed live from the org's own collected
    // rows (Ad Library sync + price observations); approved
    // competitor facts join it here AND land as internal
    // KnowledgeDocuments via the SA-B4 approval channel.
    let competitorDigest: CompetitorDigest | null = null;
    let competitorFacts: string[] = [];
    if (!customer) {
      const digest = await this.safe<CompetitorDigest | null>(
        () => this.competitor().computeDigest(organizationId),
        null,
      );
      if (digest?.hasData) {
        competitorDigest = digest;
        competitorFacts = [...digest.factLines];
      }
      const approvedCompetitor = await this.safe<any[]>(
        () =>
          p.learnedItem?.findMany?.({
            where: { organizationId, sourceType: "competitor", status: "approved" },
            orderBy: { reviewedAt: "desc" },
            take: 5,
          }),
        [],
      );
      const statements = (approvedCompetitor ?? [])
        .map((it: any) => String(it?.content?.text ?? "").trim())
        .filter(Boolean);
      if (statements.length) {
        competitorFacts = [...competitorFacts, `শেখা competitor তথ্য (অনুমোদিত):`, ...statements.map((s: string) => `- ${s}`)];
      }
    }

    // SA-B5 (P8a): learned brand voice. Customer-class audiences
    // see only an ACTIVE profile; the internal audience also
    // sees the suggested/pending state (the review surface).
    const voiceRow = await this.safe<any>(
      () => p.aiBrandVoiceProfile?.findUnique?.({ where: { organizationId } }),
      null,
    );
    let voiceProfile: BrainVoiceProfile | null = null;
    if (voiceRow && (!customer || voiceRow.status === "active")) {
      voiceProfile = {
        status: String(voiceRow.status ?? "suggested"),
        traits: normalizeVoiceTraits(voiceRow.traits),
        exampleSnippets: snippetList(voiceRow.exampleSnippets),
        pendingTraits: !customer && voiceRow.pendingTraits ? normalizeVoiceTraits(voiceRow.pendingTraits) : null,
        pendingExamples: !customer && voiceRow.pendingExamples ? snippetList(voiceRow.pendingExamples) : null,
      };
    }
    const styleInstructions = buildStyleInstructions(profile?.brandVoice ?? null, voiceRow);

    // SA-B5 (P8b): customer memory — admitted ONLY for the
    // customer's own context ("own_customer") or an internal
    // context explicitly carrying their key. A plain "customer"
    // context never reads the table at all.
    let customerMemory: BrainCustomerMemory | null = null;
    let customerMemoryFacts: string[] = [];
    const memoryAdmitted = Boolean(opts.customerKey) && (audience === "own_customer" || audience === "internal");
    if (memoryAdmitted) {
      const row = await this.safe<any>(
        () =>
          p.customerMemory?.findUnique?.({
            where: { organizationId_customerKey: { organizationId, customerKey: opts.customerKey } },
          }),
        null,
      );
      if (row) {
        customerMemory = {
          customerKey: String(row.customerKey),
          displayName: row.displayName ?? null,
          languagePref: row.languagePref ?? null,
          topics: Array.isArray(row.topics)
            ? row.topics
                .filter((t: any) => t && typeof t.name === "string")
                .map((t: any) => ({ productId: t.productId ?? null, name: String(t.name), via: String(t.via ?? "asked") }))
            : [],
          orderCount: Number(row.orderCount ?? 0),
          lastOrderAt: row.lastOrderAt ? (row.lastOrderAt instanceof Date ? row.lastOrderAt.toISOString() : String(row.lastOrderAt)) : null,
          notes: Array.isArray(row.notes)
            ? row.notes
                .filter((n: any) => n && typeof n.text === "string")
                .map((n: any) => ({
                  kind: String(n.kind ?? "note"),
                  text: String(n.text),
                  conversationId: n.conversationId ?? null,
                  at: n.at ?? null,
                }))
            : [],
          lastInteractionAt: row.lastInteractionAt
            ? row.lastInteractionAt instanceof Date
              ? row.lastInteractionAt.toISOString()
              : String(row.lastInteractionAt)
            : null,
        };
        customerMemoryFacts = customerMemoryFactLines(customerMemory);
      }
    }

    // SA-B22 (T1): platform guidance — assembled LAST, after
    // every org section above, because it ranks below all of
    // them (D8). Platform scope on purpose: the read carries no
    // organizationId (the teaching is the platform's, identical
    // for every org), and a missing table on a partial double
    // means "no guidance", never a throw. It lands ONLY in
    // `platformGuidance` — the facts assembled above are
    // already final and never see it.
    const teachingRows = await this.safe<any[]>(
      () =>
        p.platformTeaching?.findMany?.({
          where: { enabled: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          take: 10,
        }),
      [],
    );
    const platformGuidance = renderPlatformGuidance(teachingRows ?? []);

    return {
      audience,
      orgName: org?.name ?? null,
      facts,
      factsText: facts.join("\n"),
      deliveryFacts,
      paymentFacts,
      contactFacts,
      hoursFacts,
      publicProfile: profile
        ? {
            industry: profile.industry ?? null,
            description: profile.description ?? null,
            brandVoice: profile.brandVoice ?? null,
            websiteUrl: profile.websiteUrl ?? null,
          }
        : null,
      policies,
      typedPolicy,
      documents,
      knowledgeMatches,
      productMatches,
      retrievalMode,
      internalProfile:
        !customer && profile
          ? {
              goals: profile.goals ?? null,
              monthlyBudgetMinor: profile.monthlyBudgetMinor != null ? String(profile.monthlyBudgetMinor) : null,
              budgetCurrency: profile.budgetCurrency ?? null,
              targetCustomers: profile.targetCustomers ?? null,
              businessModel: profile.businessModel ?? null,
              uniqueSellingPoints: profile.uniqueSellingPoints ?? null,
              tradeLicenseNo: profile.tradeLicenseNo ?? null,
              billingEmails: profile.billingEmails ?? null,
            }
          : null,
      ownerInstructions: profile?.aiInstructions ?? null,
      replyLanguage: profile?.aiReplyLanguage ?? null,
      sources,
      performance,
      performanceFacts,
      adsDigest,
      adsFacts,
      creativeFacts,
      competitorDigest,
      competitorFacts,
      voiceProfile,
      styleInstructions,
      customerMemory,
      customerMemoryFacts,
      platformGuidance,
    };
  }
}
