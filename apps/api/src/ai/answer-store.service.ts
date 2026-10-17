import { Injectable, Logger, Optional } from "@nestjs/common";
import { Prisma } from "@repo/db";
import { formatMinor } from "@repo/contracts";
import { PrismaService } from "../prisma/prisma.service";
import {
  contactFactLines,
  deliveryFactLines,
  extractGuardNumbers,
  hoursFactLines,
  paymentFactLines,
} from "../inbox/business-brain";
import { EmbeddingsService } from "./embeddings.service";
import { vectorLiteral } from "./vector-store";

/**
 * SA-B3 (Smart AI Phase 0, P4): the Answer Store — verified
 * question -> answer pairs the Brain may serve WITHOUT an LLM
 * call (Master Plan P4: "বারবার লাগা যাচাই করা উত্তরের ভান্ডার —
 * live যাচাইসহ পুনঃব্যবহার, source বদলালে নিজে বাতিল").
 *
 * The governing laws shape every method:
 *  L1 (unique brain): organizationId is a mandatory argument on
 *     every method and appears in every query — the exact-match
 *     read, the vector search SQL and the source re-reads are all
 *     org-scoped. Org B's answers can never surface for org A.
 *  L2 (grounding): an entry exists only because a grounded
 *     answer already passed the fact pack + the deterministic
 *     number guard (autopilot), or a staff member edited an
 *     autopilot draft and sent it. Nothing is synthesised here.
 *  L3 (confidentiality): INTERNAL and CUSTOMER-OWN/personal
 *     answers are REFUSED at store time (typed result, never a
 *     throw into caller flows), and the answer text is screened
 *     for personal identifiers (see answerPiiRefusal). Only
 *     customer-audience, non-personal answers can ever be
 *     stored, so only those can ever be served.
 *  L4 (live wins): a stored answer NEVER beats live data. Every
 *     lookup re-verifies the entry against its sources BEFORE
 *     serving (verifySources): a changed/removed/reclassified
 *     source, a gone/renamed product, or a number the live
 *     sources no longer support invalidates the entry (with the
 *     reason recorded on the row) and the lookup misses.
 *
 * Embeddings behaviour (recorded choice): the normalized
 * question is embedded through EmbeddingsService. When
 * embeddings are unavailable the entry is still stored, WITHOUT
 * a vector (provider/model/dimension NULL), and is reachable
 * only by exact normalized-question match — vector search
 * filters on provider+model+dimension in SQL, so vectorless
 * rows are invisible to it by construction. A repeat exact
 * question is the dominant reuse case and works for every org,
 * including providers with no embeddings API.
 *
 * This service never throws into callers: the autopilot hot
 * path and fire-and-forget capture both depend on a storage
 * failure degrading to "no store / miss", never to a broken
 * reply.
 */

/** Cosine-similarity floor for a vector candidate to count as
 *  the same question. Deliberately strict (0.86): a looser
 *  match risks serving an answer to a DIFFERENT question
 *  (grounding failure, L2) — the cost of a miss is one normal
 *  LLM compose, the cost of a wrong hit is a wrong answer.
 *  Env-overridable for tuning: AI_ANSWER_STORE_SIMILARITY_THRESHOLD. */
export const ANSWER_STORE_SIMILARITY_THRESHOLD = (() => {
  const raw = Number(process.env.AI_ANSWER_STORE_SIMILARITY_THRESHOLD);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.86;
})();

const PROFILE_AREAS = ["delivery", "payment", "contact_hours"] as const;

export interface StoredSourceRefsInput {
  docIds?: string[];
  productIds?: string[];
  policyIds?: string[];
  /** Fact-pack profile areas: "delivery" | "payment" | "contact_hours". */
  profileAreas?: string[];
}

/** The sourceRefs shape as stored on the row (Json column):
 *  product ids enriched with the product NAME at store time so
 *  a later rename is detectable without a timestamp guess. */
export interface StoredSourceRefs {
  docIds: string[];
  products: { id: string; name: string }[];
  policyIds: string[];
  profileAreas: string[];
}

export interface StoreAnswerInput {
  question: string;
  answer: string;
  channel?: string;
  /** bn | en | mixed, as detected by the caller; null allowed. */
  language?: string | null;
  sourceRefs?: StoredSourceRefsInput;
  origin: "autopilot_grounded" | "staff_approved" | "staff_edited";
  /** When omitted, computed: any number in the answer marks it
   *  as carrying live facts (conservative — see verifySources). */
  containsLiveFacts?: boolean;
  /** Eligibility flags from the caller (L3). Defaults admit a
   *  customer-audience, non-personal answer. */
  flags?: { audience?: "customer" | "internal"; customerOwn?: boolean; personalized?: boolean };
}

export type StoreAnswerResult =
  | { stored: true; entryId: string; replaced: boolean; vectorStored: boolean }
  | { stored: false; reason: string };

export type LookupAnswerResult =
  | {
      hit: true;
      entryId: string;
      answer: string;
      sourceRefs: StoredSourceRefs;
      via: "exact" | "vector";
      similarity?: number;
    }
  | { hit: false; reason: string; invalidatedEntryId?: string; invalidReason?: string };

/**
 * Question normalization for the store: lowercase, every run of
 * non-letter/mark/number characters collapses to one space
 * (the Bengali danda "।" is punctuation and separates; Bengali
 * letters and their vowel-sign marks are kept intact), trimmed
 * and length-capped. Two phrasings of the same question that
 * differ only in punctuation/spacing/case map to the same key.
 */
export function normalizeQuestion(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

/** An answer carries live facts when it states any number at
 *  all — price, stock, charge, days, a year. Conservative by
 *  design: verifySources then requires every stated number to
 *  still be supported by the live sources at lookup time. */
export function answerContainsLiveFacts(answerText: string): boolean {
  return extractGuardNumbers(answerText).length > 0;
}

// --- PII / personal-content screen (store-time refusal) ------
// Patterns mirror the codebase's own shapes (inbox/pii-mask.ts):
// BD mobile numbers, card-like long digit runs, TrxID-shaped
// alphanumeric tokens. Order references are added here: an
// answer quoting a specific order is CUSTOMER-OWN content even
// when no flag said so (L3 defence in depth).
const BD_PHONE_RE = /(\+?880|0)1[3-9](?:[ -]?\d){8}/g;
const CARD_LIKE_RE = /\d{13,19}/;
const TRX_TOKEN_RE = /\b(?=[A-Za-z0-9]{10,24}\b)(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{10,24}\b/;
const ORDER_REF_RES = [/#\s*\d{2,}/, /অর্ডার\s*(নম্বর|আইডি|#)/, /\border\s*(#|no\.?|number|id)\s*:?\s*\S+/i];

const bengaliDigitsToLatin = (s: string) =>
  String(s ?? "").replace(/[০-৯]/g, (d) => "০১২৩৪৫৬৭৮৯".indexOf(d).toString());

/** Canonical digit form of a phone-ish string: digits only,
 *  country code folded to the local 0-prefixed form. */
const canonicalPhone = (s: string) => {
  const digits = bengaliDigitsToLatin(s).replace(/\D/g, "");
  return digits.startsWith("880") ? `0${digits.slice(3)}` : digits;
};

const emptyRefs = (): StoredSourceRefs => ({ docIds: [], products: [], policyIds: [], profileAreas: [] });

export function parseSourceRefs(raw: unknown): StoredSourceRefs {
  const r = (raw ?? {}) as any;
  return {
    docIds: Array.isArray(r.docIds) ? r.docIds.filter((x: unknown) => typeof x === "string") : [],
    products: Array.isArray(r.products)
      ? r.products
          .filter((p: any) => p && typeof p.id === "string")
          .map((p: any) => ({ id: p.id, name: String(p.name ?? "") }))
      : [],
    policyIds: Array.isArray(r.policyIds) ? r.policyIds.filter((x: unknown) => typeof x === "string") : [],
    profileAreas: Array.isArray(r.profileAreas) ? r.profileAreas.filter((x: unknown) => typeof x === "string") : [],
  };
}

@Injectable()
export class AnswerStoreService {
  private readonly logger = new Logger(AnswerStoreService.name);

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly embeddings?: EmbeddingsService,
  ) {}

  private db(): any {
    if (!this.prisma) throw new Error("AnswerStoreService: PrismaService is not available");
    return this.prisma as any;
  }

  /**
   * SA-B13 (Phase 2, W4): the per-org Answer Store switch
   * (BusinessProfile.answerStoreEnabled, default TRUE — the
   * SA-B4 getToggles read pattern: only an explicit false
   * disables). This gate is the ONE enforcement point every
   * serve/capture path flows through — the inbox autopilot
   * lookup + suggestDraft lookup + both inbox captures
   * (SA-B3), the comment lookup + capture (SA-B8) — so no
   * channel can serve or learn while the owner has the store
   * off. A missing profile row (or a pre-SA-B13 fake) reads as
   * enabled, matching the schema default. Deliberately NOT
   * gated: screenAnswerPii (a safety screen other services
   * borrow — mining/memory keep working), invalidate() and
   * the BrainAdmin management surface (list/status/delete —
   * existing rows stay manageable while off).
   */
  private async storeEnabled(organizationId: string): Promise<boolean> {
    const profile = await this.db()
      .businessProfile?.findUnique?.({ where: { organizationId }, select: { answerStoreEnabled: true } })
      ?.catch?.(() => null);
    return profile?.answerStoreEnabled !== false;
  }

  // ---------------------------------------------------------
  // STORE
  // ---------------------------------------------------------

  async store(organizationId: string, input: StoreAnswerInput): Promise<StoreAnswerResult> {
    try {
      if (!organizationId) return { stored: false, reason: "missing_organization" };
      const question = String(input?.question ?? "").trim();
      const answer = String(input?.answer ?? "").trim();
      if (!question || !answer) return { stored: false, reason: "empty_question_or_answer" };

      // SA-B13: the per-org switch stops the store LEARNING on
      // its own — the automatic captures (autopilot_grounded,
      // staff_edited) write nothing while off. A staff_approved
      // store is a deliberate human act in the Learn Dashboard
      // review queue, so it may still land; it simply cannot be
      // SERVED while off (lookup is gated for everyone below).
      if (input.origin !== "staff_approved" && !(await this.storeEnabled(organizationId))) {
        return { stored: false, reason: "answer_store_disabled" };
      }

      // L3 eligibility: typed refusals, never a throw.
      const flags = input.flags ?? {};
      if (flags.audience === "internal") return { stored: false, reason: "audience_internal" };
      if (flags.customerOwn) return { stored: false, reason: "customer_own" };
      if (flags.personalized) return { stored: false, reason: "personalized" };
      const piiReason = await this.answerPiiRefusal(organizationId, answer);
      if (piiReason) return { stored: false, reason: piiReason };

      const normalizedQuestion = normalizeQuestion(question);
      if (!normalizedQuestion) return { stored: false, reason: "empty_question_or_answer" };
      const channel = String(input.channel ?? "inbox").trim() || "inbox";
      const sourceRefs = await this.normalizeSourceRefs(organizationId, input.sourceRefs);
      const containsLiveFacts = input.containsLiveFacts ?? answerContainsLiveFacts(answer);

      // Embed the normalized question (best effort). A failed or
      // unavailable embedding NEVER blocks the store — the row
      // is written vectorless and serves exact matches only.
      let vector: { embedding: number[]; provider: string; model: string; dimension: number } | null = null;
      if (this.embeddings) {
        const emb = await this.embeddings.embedOne(organizationId, normalizedQuestion).catch(() => null);
        if (emb?.ok) {
          vector = { embedding: emb.vectors[0], provider: emb.provider, model: emb.model, dimension: emb.dimension };
        }
      }

      const db = this.db();
      const existing = await db.aiStoredAnswer
        .findFirst({ where: { organizationId, normalizedQuestion, channel }, select: { id: true, status: true } })
        .catch(() => null);
      const now = new Date();
      const meta = {
        questionText: question.slice(0, 1000),
        answerText: answer.slice(0, 4000),
        language: input.language ?? null,
        sourceRefs: sourceRefs as any,
        containsLiveFacts,
        // A re-grounded answer revives an invalidated entry, but
        // never a DISABLED one: disable is a deliberate human act
        // (the P9 management surface) and only a human re-enables.
        status: existing?.status === "disabled" ? "disabled" : "active",
        invalidReason: null,
        origin: input.origin,
        groundedAt: now,
        provider: vector?.provider ?? null,
        model: vector?.model ?? null,
        dimension: vector?.dimension ?? null,
      };
      // Replace semantics on the (org, normalizedQuestion,
      // channel) unique key: ONE row per question; hitCount and
      // lastHitAt are deliberately absent from the update, so a
      // re-grounded answer keeps its service history.
      const row = await db.aiStoredAnswer.upsert({
        where: {
          organizationId_normalizedQuestion_channel: { organizationId, normalizedQuestion, channel },
        },
        create: { organizationId, normalizedQuestion, channel, hitCount: 0, ...meta },
        update: { ...meta },
      });
      // The vector column is Unsupported in Prisma (the SA-B2
      // precedent): written via raw SQL only, org-scoped. A
      // re-store without a fresh vector clears the old one —
      // a stale vector must never outlive its grounding.
      if (vector) {
        await db.$executeRaw(
          Prisma.sql`UPDATE "AiStoredAnswer" SET "embedding" = ${vectorLiteral(vector.embedding)}::vector WHERE "id" = ${row.id} AND "organizationId" = ${organizationId}`,
        );
      } else if (existing) {
        await db
          .$executeRaw(
            Prisma.sql`UPDATE "AiStoredAnswer" SET "embedding" = NULL WHERE "id" = ${row.id} AND "organizationId" = ${organizationId}`,
          )
          .catch(() => undefined);
      }
      return { stored: true, entryId: row.id, replaced: !!existing, vectorStored: !!vector };
    } catch (e) {
      this.logger.warn(
        `answer store write failed for org ${organizationId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { stored: false, reason: "store_failed" };
    }
  }

  /**
   * The PII screen. Returns a refusal reason or null. The one
   * deliberate exception: a BD phone number that IS the org's
   * own published payment/contact number (BusinessProfile
   * bkashNumber / nagadNumber / contactPhone) is PUBLIC-class
   * business data — the fact pack itself serves it — so an
   * answer quoting the shop's own number is not personal data.
   * A customer's number can never equal the shop's, so the
   * exception cannot launder personal data.
   */
  private async answerPiiRefusal(organizationId: string, answer: string): Promise<string | null> {
    const digitText = bengaliDigitsToLatin(answer).replace(/,/g, "");
    if (CARD_LIKE_RE.test(digitText.replace(/ /g, ""))) return "pii_card_like_in_answer";
    if (TRX_TOKEN_RE.test(answer)) return "pii_trxid_in_answer";
    for (const re of ORDER_REF_RES) if (re.test(answer)) return "order_reference_in_answer";
    const phones = digitText.match(BD_PHONE_RE) ?? [];
    if (phones.length) {
      let own: Set<string> = new Set();
      try {
        const profile = await this.db().businessProfile?.findUnique?.({ where: { organizationId } });
        own = new Set(
          [profile?.bkashNumber, profile?.nagadNumber, profile?.contactPhone]
            .filter(Boolean)
            .map((v: any) => canonicalPhone(String(v))),
        );
      } catch {
        /* a profile read failure closes the exception, never opens it */
      }
      if (phones.some((m) => !own.has(canonicalPhone(m)))) return "pii_phone_in_answer";
    }
    return null;
  }

  /** SA-B4: the same screen, exposed for the conversation
   * miner's post-filter — a mined suggestion must pass exactly
   * the gate a stored answer passes, no weaker copy. */
  async screenAnswerPii(organizationId: string, answer: string): Promise<string | null> {
    return this.answerPiiRefusal(organizationId, answer);
  }

  /** Resolve caller-supplied refs into the stored shape:
   *  org-scoped throughout; product ids are enriched with the
   *  live product name (and dropped when the product does not
   *  resolve in this org); profile areas are closed-set. */
  private async normalizeSourceRefs(
    organizationId: string,
    input?: StoredSourceRefsInput,
  ): Promise<StoredSourceRefs> {
    const refs = emptyRefs();
    if (!input) return refs;
    refs.docIds = [...new Set((input.docIds ?? []).filter((x) => typeof x === "string" && x))];
    refs.policyIds = [...new Set((input.policyIds ?? []).filter((x) => typeof x === "string" && x))];
    refs.profileAreas = [...new Set((input.profileAreas ?? []).filter((x) => (PROFILE_AREAS as readonly string[]).includes(x)))];
    const productIds = [...new Set((input.productIds ?? []).filter((x) => typeof x === "string" && x))];
    if (productIds.length) {
      try {
        const rows = await this.db().product.findMany({
          where: { organizationId, id: { in: productIds } },
          select: { id: true, name: true },
        });
        const byId = new Map((rows as any[]).map((r) => [r.id, r]));
        for (const id of productIds) {
          const row = byId.get(id);
          if (row) refs.products.push({ id, name: String(row.name ?? "") });
        }
      } catch {
        /* unresolved products are simply not recorded as sources */
      }
    }
    return refs;
  }

  // ---------------------------------------------------------
  // LOOKUP
  // ---------------------------------------------------------

  async lookup(
    organizationId: string,
    question: string,
    opts?: { channel?: string; language?: string | null },
  ): Promise<LookupAnswerResult> {
    try {
      if (!organizationId) return { hit: false, reason: "missing_organization" };
      const channel = String(opts?.channel ?? "inbox").trim() || "inbox";
      const normalized = normalizeQuestion(question);
      if (!normalized) return { hit: false, reason: "empty_question" };
      // SA-B13: the per-org switch — while off, the store
      // serves NOTHING on any channel (a clean miss; callers
      // fall through to the LLM path exactly as on any miss).
      // Stored rows are untouched and keep their state for
      // when the owner turns the store back on.
      if (!(await this.storeEnabled(organizationId))) {
        return { hit: false, reason: "answer_store_disabled" };
      }
      const db = this.db();

      // 1) Exact normalized match — works for every org,
      //    including vectorless rows (embeddings unavailable).
      const exact = await db.aiStoredAnswer
        .findFirst({ where: { organizationId, normalizedQuestion: normalized, channel, status: "active" } })
        .catch(() => null);
      if (exact) {
        const served = await this.verifyAndServe(organizationId, exact, "exact", undefined, opts?.language);
        if (served) return served;
      }

      // 2) Vector match over this org's active entries, same
      //    provider/model/dimension as the query vector — the
      //    filters live in the SQL (L1), never in post-filter
      //    goodwill. The best candidate at/above the threshold
      //    is verified; a stale best candidate invalidates and
      //    misses (no second-guessing down the list).
      if (this.embeddings) {
        const emb = await this.embeddings.embedOne(organizationId, normalized).catch(() => null);
        if (emb?.ok) {
          const literal = vectorLiteral(emb.vectors[0]);
          const rows: any[] = await db
            .$queryRaw(
              Prisma.sql`SELECT "id", 1 - ("embedding" <=> ${literal}::vector) AS "similarity"
                FROM "AiStoredAnswer"
                WHERE "organizationId" = ${organizationId}
                  AND "status" = 'active'
                  AND "channel" = ${channel}
                  AND "provider" = ${emb.provider}
                  AND "model" = ${emb.model}
                  AND "dimension" = ${emb.vectors[0].length}
                  AND "embedding" IS NOT NULL
                ORDER BY "embedding" <=> ${literal}::vector ASC
                LIMIT 5`,
            )
            .catch(() => []);
          const candidate = (rows ?? []).find((r) => Number(r?.similarity) >= ANSWER_STORE_SIMILARITY_THRESHOLD);
          if (candidate) {
            const entry = await db.aiStoredAnswer
              .findFirst({ where: { id: String(candidate.id), organizationId } })
              .catch(() => null);
            if (entry) {
              const served = await this.verifyAndServe(
                organizationId,
                entry,
                "vector",
                Number(candidate.similarity),
                opts?.language,
              );
              if (served) return served;
            }
          }
        }
      }
      return { hit: false, reason: "no_match" };
    } catch (e) {
      this.logger.warn(
        `answer store lookup failed for org ${organizationId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { hit: false, reason: "lookup_failed" };
    }
  }

  /**
   * Verify a candidate against LIVE data, then serve it. The
   * result is definitive for this candidate: a hit, a plain miss
   * (language — the entry itself is fine), or an invalidation
   * miss. A verification failure invalidates the entry with its
   * reason recorded — the same question will take the normal
   * LLM path and, if it grounds again, re-store a fresh answer.
   */
  private async verifyAndServe(
    organizationId: string,
    entry: any,
    via: "exact" | "vector",
    similarity: number | undefined,
    language?: string | null,
  ): Promise<LookupAnswerResult | null> {
    // Language gate: an answer stored from a Bengali question is
    // not served to an English asker (or vice versa). "mixed"
    // and undetected languages impose no constraint. A mismatch
    // is a miss, NOT an invalidation — the entry is fine.
    if (
      entry.language &&
      language &&
      (entry.language === "bn" || entry.language === "en") &&
      (language === "bn" || language === "en") &&
      entry.language !== language
    ) {
      return { hit: false, reason: "language_mismatch" };
    }
    const refs = parseSourceRefs(entry.sourceRefs);
    const check = await this.verifySources(organizationId, entry, refs);
    if (!check.ok) {
      await this.invalidate(organizationId, entry.id, check.reason);
      return { hit: false, reason: "invalidated", invalidatedEntryId: entry.id, invalidReason: check.reason };
    }
    await this.db()
      .aiStoredAnswer.update({
        where: { id: entry.id },
        data: { hitCount: { increment: 1 }, lastHitAt: new Date() },
      })
      .catch(() => undefined);
    return { hit: true, entryId: entry.id, answer: entry.answerText, sourceRefs: refs, via, similarity };
  }

  /**
   * The live re-verification (L4). Source rows are re-read
   * org-scoped and compared against the entry's grounding:
   *  - knowledge docs / policies / the business profile are
   *    timestamp-checked against groundedAt (these rows change
   *    only on deliberate edits, so an edit after grounding
   *    retires answers built on the old text);
   *  - products are VALUE-checked (existence, ACTIVE status,
   *    the name snapshot, and the number set from the live
   *    formatted price/stock lines) because product rows mutate
   *    constantly (stock moves on every order) — a pure
   *    timestamp check would retire price answers on the first
   *    unrelated order, while the value check retires exactly
   *    the answers whose quoted price/stock no longer holds;
   *  - when the answer carries live facts, EVERY number it
   *    states must still be supported by the live sources above
   *    (the same extraction the number guard uses).
   */
  private async verifySources(
    organizationId: string,
    entry: any,
    refs: StoredSourceRefs,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const db = this.db();
    const groundedAt = new Date(entry.groundedAt).getTime();
    const allowed = new Set<string>();
    const collect = (text: string) => {
      for (const n of extractGuardNumbers(text)) allowed.add(n);
    };

    for (const docId of refs.docIds) {
      const doc = await db.knowledgeDocument
        ?.findFirst?.({ where: { id: docId, organizationId } })
        .catch(() => null);
      if (!doc) return { ok: false, reason: "source_doc_removed" };
      if (doc.visibility === "internal") return { ok: false, reason: "source_doc_reclassified" };
      if (doc.updatedAt && new Date(doc.updatedAt).getTime() > groundedAt) {
        return { ok: false, reason: "source_doc_changed" };
      }
      collect(`${doc.title ?? ""}\n${doc.content ?? ""}`);
    }
    for (const policyId of refs.policyIds) {
      const policy = await db.businessPolicy
        ?.findFirst?.({ where: { id: policyId, organizationId } })
        .catch(() => null);
      if (!policy) return { ok: false, reason: "source_policy_removed" };
      if (policy.updatedAt && new Date(policy.updatedAt).getTime() > groundedAt) {
        return { ok: false, reason: "source_policy_changed" };
      }
      collect(String(policy.content ?? ""));
    }
    if (refs.profileAreas.length) {
      const profile = await db.businessProfile
        ?.findUnique?.({ where: { organizationId } })
        .catch(() => null);
      if (!profile) return { ok: false, reason: "source_profile_changed" };
      if (profile.updatedAt && new Date(profile.updatedAt).getTime() > groundedAt) {
        return { ok: false, reason: "source_profile_changed" };
      }
      const lines: string[] = [];
      if (refs.profileAreas.includes("delivery")) lines.push(...deliveryFactLines(profile));
      if (refs.profileAreas.includes("payment")) lines.push(...paymentFactLines(profile));
      if (refs.profileAreas.includes("contact_hours")) {
        lines.push(...contactFactLines(profile), ...hoursFactLines(profile));
      }
      collect(lines.join("\n"));
    }
    for (const ref of refs.products) {
      const product = await db.product
        ?.findFirst?.({ where: { id: ref.id, organizationId } })
        .catch(() => null);
      if (!product || product.status !== "ACTIVE") return { ok: false, reason: "product_unavailable" };
      if (String(product.name ?? "") !== ref.name) return { ok: false, reason: "product_changed" };
      const lines = [`দাম: ${formatMinor(BigInt(product.priceMinor), product.currency)} (${product.currency})`];
      if (product.stockQuantity != null) lines.push(`স্টক: ${product.stockQuantity}টি`);
      collect(lines.join("\n"));
    }

    if (entry.containsLiveFacts) {
      const invented = extractGuardNumbers(entry.answerText).filter((n) => !allowed.has(n));
      if (invented.length) return { ok: false, reason: "live_facts_changed" };
    }
    return { ok: true };
  }

  /** Record an invalidation on the row (status + reason) — the
   *  audit trail the Learn Dashboard will read (P9). Public:
   *  the inbox integration calls it when a served candidate
   *  fails the fresh fact-pack number guard. Never throws. */
  async invalidate(organizationId: string, entryId: string, reason: string): Promise<void> {
    try {
      await this.db().aiStoredAnswer.updateMany({
        where: { id: entryId, organizationId },
        data: { status: "invalidated", invalidReason: reason },
      });
    } catch {
      /* invalidation is bookkeeping; a failure here must never break a reply */
    }
  }
}
