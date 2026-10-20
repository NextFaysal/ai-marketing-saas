import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { LlmFactory, providerForOrg } from "./llm/llm.factory";
import type { LlmMessage, LlmProvider } from "./llm/llm.types";
import { OrgBrainService, performanceFactLines } from "./org-brain.service";
import { AdsIntelligenceService } from "./ads-intelligence.service";
import { CompetitorIntelligenceService } from "./competitor-intelligence.service";
import { CreativeLearningService } from "./creative-learning.service";
import { ActionEngineService } from "./actions/action-engine.service";
import { catalogAction } from "./actions/action-catalog";
import { extractGuardNumbers } from "../inbox/business-brain";
import { formatMinor } from "@repo/contracts";
import { CopilotAskDto } from "./copilot.dto";
import { ApiException, badRequest, forbidden } from "../i18n/api-exception";

/** The AIUsageRecord feature bucket for the copilot's LLM calls. */
export const COPILOT_FEATURE = "copilot";
/** Client-carried history is capped — the copilot is stateless
 *  and a runaway transcript is a cost/grounding hazard. */
export const COPILOT_HISTORY_MAX_TURNS = 6;
/** Per-section line caps keep the pack (and therefore the
 *  guard's allowed-number set) tight and source-faithful. */
const PACK_ADS_LINE_CAP = 14;
const PACK_COMPETITOR_LINE_CAP = 12;
const PACK_CREATIVE_PATTERN_CAP = 6;
const PACK_KNOWLEDGE_CAP = 3;

/**
 * Typed refusal for an org with no real LLM configured (the
 * family pattern — B19's LlmNotConfiguredError, B20's twin):
 * copilot answers without a real model would be canned text
 * passed off as AI, so the Q&A path fails with this stable
 * machine-readable code instead. The deterministic action path
 * does NOT need an LLM and keeps working (see ask()).
 */
export class CopilotLlmNotConfiguredError extends HttpException {
  constructor() {
    super(
      {
        code: "LLM_NOT_CONFIGURED",
        message:
          "আসল AI (LLM) configure করা নেই — Copilot-এর উত্তর দেওয়ার জন্য Admin Panel → Platform Config-এ LLM সেট করুন। Dev template দিয়ে উত্তর বানানো হবে না।",
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

export interface CopilotSection {
  /** performance_snapshot | ads_digest | competitor_digest |
   *  creative_report | brain_internal */
  source: string;
  /** "7d" | "30d" | null (brain facts are not windowed). */
  window: string | null;
  lines: string[];
}

export interface CopilotCampaignCandidate {
  name: string;
  platform: string;
}

export interface CopilotAskResult {
  kind: "answer" | "proposal" | "clarification" | "refusal";
  answer: string;
  language: "bn" | "en";
  /** The exact fact sections the answer stands on (Q&A path;
   *  empty for the deterministic paths). */
  sections: CopilotSection[];
  /** null | "regenerated" | "dropped_unsupported_numbers" */
  guardNote: string | null;
  droppedNumbers?: string[];
  proposal?: {
    id: string;
    actionId: string;
    title: string;
    preview: string;
    status: string;
    moneyAdjacent: boolean;
    deduped: boolean;
  } | null;
  candidates?: CopilotCampaignCandidate[] | null;
}

interface CampaignTarget extends CopilotCampaignCandidate {
  campaignExternalId: string;
  adAccountId: string | null;
}

// ----------------------------------------------------------------
// Deterministic intent layer. The LLM never decides an action:
// verbs are matched here, targets are resolved against live rows
// here, and the engine's propose() is the only effect an ask can
// have. Everything the LLM writes is prose over the fact pack.
// ----------------------------------------------------------------

const normText = (s: unknown): string =>
  String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

const BN_DIGIT_MAP: Record<string, string> = {
  "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
  "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
};
const bnDigitsToEn = (s: string): string => s.replace(/[০-৯]/g, (d) => BN_DIGIT_MAP[d] ?? d);

const PAUSE_RE = /(pause|পজ|বন্ধ\s*কর|থামিয়ে|থামাও|stop)/;
const RESUME_RE = /(resume|চালু\s*কর|আবার\s*চালু|restart|সক্রিয়\s*কর)/;
const BUDGET_RE = /(বাজেট|budget)/;
const REFUND_RE = /(refund|রিফান্ড|টাকা\s*ফেরত|money\s*back)/;
const CAMPAIGN_CTX_RE = /(campaign|ক্যাম্পেইন|বিজ্ঞাপন|\bad\b)/;

/** Catalog acts the copilot deliberately does NOT perform: they
 *  are anchored to a specific conversation/comment the dashboard
 *  chat does not carry. Matched deterministically so the refusal
 *  never depends on the LLM remembering it cannot act. */
const UNSUPPORTED_ASK: Array<{ re: RegExp; actBn: string; actEn: string; whereBn: string; whereEn: string }> = [
  {
    re: /(কথোপকথন|কনভারসেশন|চ্যাট|conversation|chat).{0,24}(বন্ধ|close|ট্যাগ|tag|assign|অ্যাসাইন|ব্লক|block|স্প্যাম|spam)|(বন্ধ|close|ট্যাগ|tag|assign|অ্যাসাইন|ব্লক|block).{0,24}(কথোপকথন|কনভারসেশন|চ্যাট|conversation|chat)/,
    actBn: "কথোপকথনের কাজ (বন্ধ/ট্যাগ/অ্যাসাইন/ব্লক)",
    actEn: "conversation actions (close/tag/assign/block)",
    whereBn: "Inbox-এ নির্দিষ্ট কথোপকথনটি খুলে, অথবা Control Center-এর প্রস্তাব তালিকা থেকে",
    whereEn: "from the specific conversation in the Inbox, or the proposal queue in the Control Center",
  },
  {
    re: /(কমেন্ট|comment).{0,24}(লুকা|মুছে|ডিলিট|hide|delete|উত্তর|reply)|(লুকিয়ে|মুছে|hide|delete).{0,24}(কমেন্ট|comment)/,
    actBn: "কমেন্টের কাজ (লুকানো/মুছে ফেলা/উত্তর)",
    actEn: "comment actions (hide/delete/reply)",
    whereBn: "comment moderation তালিকা থেকে, অথবা Control Center-এর প্রস্তাব তালিকা থেকে",
    whereEn: "from the comment moderation queue, or the proposal queue in the Control Center",
  },
];

/** Strip action verbs + fillers so a bare remainder can be
 *  matched against campaign names ("winter campaign pause করো"
 *  → "winter"). Only used when no full campaign name appears in
 *  the ask — the weaker signal, so it demands containment both
 *  ways at match time. */
function askRemainder(askNorm: string, budget: boolean): string {
  let t = askNorm;
  t = t.replace(/(pause|resume|restart|stop|পজ|বন্ধ\s*করে?\s*দাও|বন্ধ\s*করো?|বন্ধ|থামিয়ে\s*দাও|থামাও|চালু\s*করে?\s*দাও|চালু\s*করো?|চালু|আবার|সক্রিয়\s*করো?)/g, " ");
  if (budget) {
    t = t.replace(/(বাজেট|budget)/g, " ");
    t = t.replace(/[0-9০-৯][0-9০-৯,.]*/g, " ");
    t = t.replace(/(টাকা|taka|bdt|হাজার|thousand)/g, " ");
  }
  t = t.replace(/(campaign|ক্যাম্পেইন|বিজ্ঞাপন|\bad\b|টা|টি|টির|এর|আমার|এই|ওই|the|my|this|that|please|plz|করো|করুন|করে|কর|দাও|দিন|চাই|দরকার|হবে|করতে)/g, " ");
  return t.replace(/[?？।.,!"'«»]/g, " ").replace(/\s+/g, " ").trim();
}

/** The budget amount in an ask, in minor units — the LAST number
 *  token (the campaign name's own digits are removed first, so
 *  "Eid 2026 campaign-এর বাজেট ৫০০০" reads 5000, not 2026). A
 *  trailing k/হাজার multiplies by 1000. Null when absent. */
export function extractBudgetAmountMinor(ask: string, matchedName: string | null): number | null {
  let text = bnDigitsToEn(normText(ask));
  if (matchedName) text = text.replace(bnDigitsToEn(normText(matchedName)), " ");
  const tokens = [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k|হাজার|thousand)?/g)];
  if (!tokens.length) return null;
  const last = tokens[tokens.length - 1];
  let value = Number(last[1].replace(/,/g, ""));
  if (last[2]) value *= 1000;
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

/**
 * SA-B21 (Smart AI Phase 5, G3) — the Owner Copilot.
 *
 * A staff-facing conversational layer over EXACTLY what already
 * exists — no new analytics, no new actions:
 *  - QUESTIONS are answered by the org's LLM over an INTERNAL
 *    context pack assembled from the deterministic digests
 *    (latest PerformanceSnapshots 7d+30d, the SA-B14 ads
 *    digest, the SA-B17 competitor digest, the SA-B16 creative
 *    report) + the Brain's internal facts (OrgBrainService,
 *    internal audience). Every answer passes the shared number
 *    guard (SA-B3 extraction) against the pack: one invented
 *    number → ONE regeneration → still invented → the prose is
 *    withheld and the verified fact sections are returned
 *    instead (the SA-B14 narration discipline — facts always
 *    available, prose is the bonus).
 *  - ACTION asks are resolved by a DETERMINISTIC intent layer
 *    (verbs + live campaign-name matching) into Action Engine
 *    proposals — propose() only; the copilot holds no reference
 *    path to execute() and the ads set it can reach is
 *    medium-risk + money-adjacent, which the engine never
 *    auto-executes at any autonomy level. Money asks stay
 *    proposals (the engine's L5 wall), said out loud in the
 *    answer. Refunds are proposal-only too AND need a concrete
 *    conversation — from a bare dashboard ask there is none, so
 *    the copilot says so and points at the Inbox flow instead
 *    of fabricating a linkage.
 *  - STATELESS: the client may pass recent turns; no copilot
 *    table exists (a history store is Phase-6/T4 scope).
 *  - Enforcement mirrors the family: the platform AI kill
 *    switch gates the whole surface (403); the daily AI cap
 *    (bucket "copilot") gates the LLM-consuming Q&A path; each
 *    provider call writes its AIUsageRecord after success.
 */
@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmFactory,
    private readonly brain: OrgBrainService,
    private readonly ads: AdsIntelligenceService,
    private readonly competitor: AdsIntelligenceService,
    private readonly creative: CreativeLearningService,
    private readonly engine: ActionEngineService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private p(): any {
    return this.prisma as any;
  }

  // ---------------- enforcement (family shapes) ----------------

  private async checkKillSwitch(organizationId: string) {
    const { killSwitches, isAiDisabledForOrg } = await import("../common/platform-settings");
    const ks = await killSwitches(this.prisma as any);
    if (isAiDisabledForOrg(ks, organizationId)) {
      throw forbidden(ks.aiGloballyPaused ? "ai.aiFeaturesTemporarilyPausedPlatformWide" : "ai.aiFeaturesTemporarilyDisabledForThisOrganization");
    }
  }

  private async checkDailyLimit(organizationId: string) {
    const { effectiveLimits } = await import("../common/platform-settings");
    const baseline = Number(process.env.AI_DAILY_MESSAGE_LIMIT ?? 200);
    const { aiDaily: limit } = await effectiveLimits(this.prisma as any, organizationId, { aiDaily: baseline, broadcastCap: 1000 });
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const used = await this.p().aIUsageRecord.count({
      where: { organizationId, feature: COPILOT_FEATURE, createdAt: { gte: startOfDay } },
    });
    if (used >= limit) {
      throw new ApiException("ai.dailyAiLimitReachedForThis", { limit: limit }, 429);
    }
  }

  private async resolveLanguage(organizationId: string, dtoLanguage?: string): Promise<"bn" | "en"> {
    if (dtoLanguage === "en" || dtoLanguage === "bn") return dtoLanguage;
    const profile = await this.p().businessProfile
      ?.findUnique({ where: { organizationId }, select: { aiReplyLanguage: true } })
      .catch(() => null);
    return String(profile?.aiReplyLanguage ?? "").toLowerCase() === "en" ? "en" : "bn";
  }

  // ---------------- campaign target resolution ----------------

  /** The org's actionable campaigns, from the same live rows the
   *  SA-B15 builders resolve against: published CampaignPlans
   *  (Meta hub objects) + synced AdCampaign rows. Deduped by the
   *  engine's campaignKey; the plan's name wins (it is the
   *  dashboard's own object). */
  private async listCampaignTargets(organizationId: string): Promise<CampaignTarget[]> {
    const out: CampaignTarget[] = [];
    const seen = new Set<string>();
    const push = (t: CampaignTarget) => {
      const key = `${t.platform}::${t.adAccountId ?? ""}::${t.campaignExternalId}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(t);
    };
    const plans = await this.p().campaignPlan
      .findMany({ where: { organizationId, status: "published" } })
      .catch(() => []);
    for (const plan of plans as any[]) {
      if (!plan?.externalCampaignId) continue;
      push({
        name: String(plan.name ?? plan.externalCampaignId),
        platform: "meta",
        campaignExternalId: String(plan.externalCampaignId),
        adAccountId: plan.adAccountId ?? null,
      });
    }
    const rows = await this.p().adCampaign
      .findMany({ where: { organizationId }, include: { adAccount: true } })
      .catch(() => []);
    for (const row of rows as any[]) {
      const platform = String(row?.adAccount?.platform ?? "").toLowerCase();
      if (!["meta", "google", "tiktok"].includes(platform) || !row?.externalId) continue;
      push({
        name: String(row.name ?? row.externalId),
        platform,
        campaignExternalId: String(row.externalId),
        adAccountId: row.adAccountId ?? null,
      });
    }
    return out;
  }

  /** Name matching, strongest signal first: (1) a campaign's
   *  full name appears in the ask; (2) the ask's remainder (verbs
   *  + fillers stripped) equals or contains/is-contained-by a
   *  name. Distinct campaignKeys only — duplicates of one
   *  campaign are one match, two different campaigns are an
   *  ambiguity, never a coin flip. */
  private matchCampaignTargets(askNorm: string, targets: CampaignTarget[], budget: boolean): CampaignTarget[] {
    const distinct = (list: CampaignTarget[]): CampaignTarget[] => {
      const byKey = new Map<string, CampaignTarget>();
      for (const t of list) byKey.set(`${t.platform}::${t.adAccountId ?? ""}::${t.campaignExternalId}`, t);
      return [...byKey.values()];
    };
    const inAsk = targets.filter((t) => t.name && askNorm.includes(normText(t.name)));
    if (inAsk.length) return distinct(inAsk);
    const remainder = askRemainder(askNorm, budget);
    if (remainder.length >= 2) {
      const exact = targets.filter((t) => normText(t.name) === remainder);
      if (exact.length) return distinct(exact);
      const contains = targets.filter(
        (t) => normText(t.name).includes(remainder) || remainder.includes(normText(t.name)),
      );
      if (contains.length) return distinct(contains);
    }
    return [];
  }

  // ---------------- main entry ----------------

  async ask(organizationId: string, userId: string, dto: CopilotAskDto): Promise<CopilotAskResult> {
    const question = typeof dto?.question === "string" ? dto.question.trim() : "";
    if (!question) throw badRequest("ai.writeAQuestionOrAnInstruction");
    await this.checkKillSwitch(organizationId);
    const language = await this.resolveLanguage(organizationId, dto?.language);
    const bn = language === "bn";
    const askNorm = normText(question);

    // Money first: a refund can only ever be a proposal, and the
    // engine's refund proposal is anchored to ONE conversation.
    // A dashboard ask carries none — the honest answer explains
    // the wall and the real path; nothing is created (no
    // fabricated conversation linkage, ever).
    if (REFUND_RE.test(askNorm)) {
      return this.refusal(
        language,
        bn
          ? "রিফান্ড আমি এখান থেকে করতে বা প্রস্তাব করতে পারি না। রিফান্ড সবসময় শুধু প্রস্তাব আকারে থাকে (আইন L5 — AI কখনো টাকা ফেরত দেয় না), আর সেই প্রস্তাব নির্দিষ্ট কথোপকথনের সঙ্গে বাঁধা থাকে। সংশ্লিষ্ট customer-এর কথোপকথনটি Inbox-এ খুলুন — সেখান থেকেই রিফান্ডের প্রস্তাব তৈরি করা যায়; অনুমোদনের পরও টিমকে বিদ্যমান staff refund পথে নিজে রিফান্ড সম্পন্ন করতে হয়।"
          : "I cannot make or propose a refund from here. Refunds are always proposal-only (law L5 — the AI never moves money), and that proposal is anchored to one specific conversation. Open the customer's conversation in the Inbox to file the refund proposal there; even after approval, the team completes the refund through the existing staff refund path.",
        "refund_needs_conversation",
      );
    }

    // Ads actions: deterministic verbs over live campaign rows.
    const adsAction: "pause_campaign" | "resume_campaign" | "set_campaign_budget" | null = BUDGET_RE.test(askNorm)
      ? "set_campaign_budget"
      : PAUSE_RE.test(askNorm)
        ? "pause_campaign"
        : RESUME_RE.test(askNorm)
          ? "resume_campaign"
          : null;
    if (adsAction) {
      const targets = await this.listCampaignTargets(organizationId);
      const matched = this.matchCampaignTargets(askNorm, targets, adsAction === "set_campaign_budget");
      // A lifecycle verb with no campaign context and no name
      // match is not an ads ask at all ("app-টা বন্ধ করো") —
      // fall through to the unsupported/Q&A paths below.
      if (adsAction === "set_campaign_budget" || CAMPAIGN_CTX_RE.test(askNorm) || matched.length > 0) {
        return this.handleAdsAction(organizationId, userId, adsAction, question, targets, matched, language);
      }
    }

    // Catalog acts the copilot does not perform (they need a
    // concrete conversation/comment) — deterministic refusal.
    for (const u of UNSUPPORTED_ASK) {
      if (u.re.test(askNorm)) {
        return this.refusal(
          language,
          bn
            ? `আমি ${u.actBn} এখান থেকে করতে পারি না — এই কাজের জন্য নির্দিষ্ট ${u.whereBn} যেতে হয়। আমি ব্যবসার প্রশ্নের উত্তর দিতে আর campaign (pause/resume/বাজেট) প্রস্তাব তৈরি করতে পারি।`
            : `I cannot do ${u.actEn} from here — that act needs to start ${u.whereEn}. I can answer business questions and create campaign proposals (pause/resume/budget).`,
          "unsupported_action",
        );
      }
    }

    return this.answerQuestion(organizationId, userId, question, dto, language);
  }

  private refusal(language: "bn" | "en", answer: string, _reason: string): CopilotAskResult {
    return { kind: "refusal", answer, language, sections: [], guardNote: null, proposal: null, candidates: null };
  }

  private clarification(
    language: "bn" | "en",
    answer: string,
    candidates: CopilotCampaignCandidate[],
  ): CopilotAskResult {
    return { kind: "clarification", answer, language, sections: [], guardNote: null, proposal: null, candidates };
  }

  // ---------------- action path (propose only) ----------------

  private async handleAdsAction(
    organizationId: string,
    userId: string,
    actionId: "pause_campaign" | "resume_campaign" | "set_campaign_budget",
    question: string,
    targets: CampaignTarget[],
    matched: CampaignTarget[],
    language: "bn" | "en",
  ): Promise<CopilotAskResult> {
    const bn = language === "bn";
    const actBn =
      actionId === "pause_campaign" ? "বন্ধ (pause)" : actionId === "resume_campaign" ? "আবার চালু (resume)" : "বাজেট বদল";
    const actEn = actionId === "pause_campaign" ? "pause" : actionId === "resume_campaign" ? "resume" : "budget change";

    if (targets.length === 0) {
      return this.refusal(
        language,
        bn
          ? "এই org-এ এমন কোনো campaign পাইনি যেটায় কাজ করা যাবে (কোনো published plan বা synced campaign নেই) — আগে Ads Manager/hub থেকে campaign connect বা sync করুন।"
          : "I found no actionable campaign in this organization (no published plan or synced campaign) — connect or sync campaigns from the Ads Manager/hub first.",
        "no_campaigns",
      );
    }

    const listText = (list: CampaignTarget[]) =>
      list.map((t) => `“${t.name}” (${t.platform})`).join(", ");

    if (matched.length === 0) {
      const shown = targets.slice(0, 10);
      return this.clarification(
        language,
        bn
          ? `কোন campaign-টি ${actBn} করতে চান, নাম ধরে বুঝতে পারিনি। আপনার campaigns: ${listText(shown)}${targets.length > shown.length ? ` (আরও ${targets.length - shown.length}টি আছে)` : ""}। campaign-এর পুরো নাম লিখে আবার বলুন।`
          : `I could not tell which campaign you want to ${actEn}. Your campaigns: ${listText(shown)}${targets.length > shown.length ? ` (and ${targets.length - shown.length} more)` : ""}. Please repeat with the campaign's full name.`,
        shown.map(({ name, platform }) => ({ name, platform })),
      );
    }

    if (matched.length > 1) {
      return this.clarification(
        language,
        bn
          ? `একাধিক campaign মিলেছে: ${listText(matched)}। কোনটি ${actBn} করতে চান, পুরো নাম লিখে বলুন। কিছুই তৈরি হয়নি।`
          : `More than one campaign matches: ${listText(matched)}. Which one should I ${actEn}? Say the full name — nothing has been created.`,
        matched.map(({ name, platform }) => ({ name, platform })),
      );
    }

    const target = matched[0];

    let payload: Record<string, unknown> = {
      platform: target.platform,
      campaignExternalId: target.campaignExternalId,
      ...(target.adAccountId ? { adAccountId: target.adAccountId } : {}),
    };
    if (actionId === "set_campaign_budget") {
      const amountMinor = extractBudgetAmountMinor(question, target.name);
      if (amountMinor === null) {
        return this.clarification(
          language,
          bn
            ? `“${target.name}” campaign-এর নতুন দৈনিক বাজেট কত টাকা হবে, সেটা বলেননি। যেমন: “${target.name} campaign-এর বাজেট ৫০০০ টাকা করো”।`
            : `You did not say the new daily budget for “${target.name}”. For example: “set the budget of ${target.name} to 5000 taka”.`,
          [{ name: target.name, platform: target.platform }],
        );
      }
      payload = { ...payload, requestedBudgetMinor: String(amountMinor), budgetKind: "daily" };
    }

    let res: any;
    try {
      res = await this.engine.propose(organizationId, actionId, payload, {
        proposedBy: "staff",
        actorUserId: userId,
        sourceRef: { via: "copilot" },
      });
    } catch (e) {
      // The builders refuse honestly (no-op state, no budget
      // source, CSV/manual account) with a named Bengali reason —
      // that reason IS the answer; nothing was created.
      if (e instanceof HttpException) {
        const body: any = e.getResponse();
        const message = typeof body === "string" ? body : (body?.message ?? "প্রস্তাব তৈরি করা যায়নি।");
        return this.refusal(language, Array.isArray(message) ? message.join(" ") : String(message), "builder_refused");
      }
      throw e;
    }
    if (!res?.ok || !res.proposal) {
      return this.refusal(language, String(res?.message ?? "প্রস্তাব তৈরি হয়নি।"), String(res?.reason ?? "propose_failed"));
    }

    const proposal = res.proposal;
    const entry = catalogAction(actionId);
    const queueLine = bn
      ? "এটি Control Center-এর “AI নিয়ন্ত্রণ” প্রস্তাব তালিকায় অনুমোদনের অপেক্ষায় আছে — অনুমোদন ছাড়া কিছুই কার্যকর হবে না।"
      : "It is waiting in the Control Center's proposal queue — nothing takes effect without approval.";
    const moneyLine =
      actionId === "set_campaign_budget"
        ? bn
          ? " মনে রাখুন: বাজেট প্রস্তাব অনুমোদন হলেও engine নিজে বাজেট বদলায় না (আইন L5) — টিমকে Ads Manager/hub থেকে নিজে বদলাতে হয়।"
          : " Note: even if approved, the engine never changes a budget itself (law L5) — the team applies it in the Ads Manager/hub."
        : "";
    const answer = res.deduped
      ? (bn
          ? `এই প্রস্তাবটি আগেই খোলা আছে — নতুন করে তৈরি হয়নি।\n${proposal.title}\n${proposal.preview}\n${queueLine}${moneyLine}`
          : `This proposal is already open — no duplicate was created.\n${proposal.title}\n${proposal.preview}\n${queueLine}${moneyLine}`)
      : (bn
          ? `প্রস্তাব তৈরি হয়েছে।\n${proposal.title}\n${proposal.preview}\n${queueLine}${moneyLine}`
          : `Proposal created.\n${proposal.title}\n${proposal.preview}\n${queueLine}${moneyLine}`);

    await this.audit?.log({
      organizationId,
      userId,
      action: "ai.copilot_action_proposed",
      entityType: "AIActionProposal",
      entityId: proposal.id,
      metadata: { actionId, via: "copilot", deduped: !!res.deduped },
    }).catch(() => undefined);

    return {
      kind: "proposal",
      answer,
      language,
      sections: [],
      guardNote: null,
      proposal: {
        id: proposal.id,
        actionId,
        title: proposal.title,
        preview: proposal.preview,
        status: proposal.status,
        moneyAdjacent: !!entry?.moneyAdjacent,
        deduped: !!res.deduped,
      },
      candidates: null,
    };
  }

  // ---------------- Q&A path (grounded prose) ----------------

  /** Assemble the INTERNAL context pack: deterministic digests +
   *  Brain internal facts, each section labelled with its source
   *  and window. A section with no data is omitted — the model's
   *  "জানি না" duty and the guard both key off what is actually
   *  here. Every loader degrades to empty on failure (the digest
   *  services already never-throw; the wraps are belt-and-braces
   *  so one broken source cannot sink the whole pack). */
  private async buildPack(organizationId: string, question: string): Promise<CopilotSection[]> {
    const sections: CopilotSection[] = [];

    // Performance — the latest stored snapshot per window (the
    // sweep's deterministic aggregates, SA-B5). Read-only: an
    // ask never triggers a recompute or files suggestions.
    try {
      const snaps = await this.p().performanceSnapshot
        .findMany({ where: { organizationId }, orderBy: { computedAt: "desc" }, take: 6 })
        .catch(() => []);
      const byWindow = new Map<number, any>();
      for (const snap of snaps as any[]) {
        const days = Number(snap?.metrics?.windowDays ?? 0);
        if ((days === 7 || days === 30) && !byWindow.has(days)) byWindow.set(days, snap);
      }
      for (const days of [7, 30]) {
        const snap = byWindow.get(days);
        if (!snap) continue;
        const lines = performanceFactLines(snap.metrics);
        if (lines.length) sections.push({ source: "performance_snapshot", window: `${days}d`, lines });
      }
    } catch { /* section omitted */ }

    // Ads digest (SA-B14) — 7-day window; its fact lines carry
    // their own prior-period deltas.
    try {
      const digest = await this.ads.computeDigest(organizationId, { days: 7 });
      if (digest?.hasData && digest.factLines?.length) {
        sections.push({
          source: "ads_digest",
          window: `${digest.windowDays ?? 7}d`,
          lines: digest.factLines.slice(0, PACK_ADS_LINE_CAP),
        });
      }
    } catch { /* section omitted */ }

    // Competitor digest (SA-B17) — 30-day window built in.
    try {
      const digest = await this.competitor.computeDigest(organizationId);
      if (digest?.hasData && digest.factLines?.length) {
        sections.push({ source: "competitor_digest", window: "30d", lines: digest.factLines.slice(0, PACK_COMPETITOR_LINE_CAP) });
      }
    } catch { /* section omitted */ }

    // Creative report (SA-B16) — computed pattern statements
    // only (never raw exemplar texts: another surface's numbers
    // discipline, the SA-B19 rule).
    try {
      const report = await this.creative.computeReport(organizationId);
      const lines: string[] = [];
      if (report && report.baseline?.ctrPercent != null && (report.creativesQualifying ?? 0) > 0) {
        lines.push(
          `Creative (গত ${report.windowDays ?? 30} দিন): ${report.creativesQualifying}টি যথেষ্ট-ডেটাসহ creative-এর গড় CTR ${report.baseline.ctrPercent}%।`,
        );
      }
      for (const pat of (report?.patterns ?? []).slice(0, PACK_CREATIVE_PATTERN_CAP)) {
        if (pat?.statement) lines.push(pat.statement);
      }
      if (lines.length) sections.push({ source: "creative_report", window: `${report?.windowDays ?? 30}d`, lines });
    } catch { /* section omitted */ }

    // Brain internal facts (SA-B1 service, internal audience):
    // the org's own internal profile + the knowledge matched to
    // THIS question (internal documents included — this audience
    // is the owner themself). SECRET-class fields (trade licence,
    // billing emails) are deliberately not rendered: the copilot
    // answers business questions, it does not recite credentials.
    try {
      const ctx = await this.brain.getContext(organizationId, {
        audience: "internal",
        query: question,
        matchLimit: PACK_KNOWLEDGE_CAP,
      });
      const lines: string[] = [];
      const prof = ctx?.internalProfile;
      if (prof?.goals) lines.push(`ব্যবসার লক্ষ্য: ${prof.goals}`);
      if (prof?.monthlyBudgetMinor) {
        try {
          lines.push(`মাসিক বাজেট: ${formatMinor(BigInt(prof.monthlyBudgetMinor), prof.budgetCurrency ?? "BDT")}`);
        } catch { /* malformed budget contributes no line */ }
      }
      if (prof?.businessModel) lines.push(`ব্যবসার মডেল: ${prof.businessModel}`);
      if (prof?.uniqueSellingPoints) lines.push(`বিশেষত্ব (USP): ${prof.uniqueSellingPoints}`);
      if (prof?.targetCustomers) {
        const tc = typeof prof.targetCustomers === "string" ? prof.targetCustomers : JSON.stringify(prof.targetCustomers);
        if (tc && tc !== "null") lines.push(`টার্গেট customer: ${tc.slice(0, 300)}`);
      }
      if (ctx?.ownerInstructions) lines.push(`মালিকের নির্দেশনা: ${String(ctx.ownerInstructions).slice(0, 400)}`);
      for (const m of (ctx?.knowledgeMatches ?? []).slice(0, PACK_KNOWLEDGE_CAP)) {
        if (m?.content) lines.push(`জ্ঞান (“${m.title ?? m.kind ?? "নথি"}”): ${String(m.content).slice(0, 400)}`);
      }
      if (lines.length) sections.push({ source: "brain_internal", window: null, lines });
    } catch { /* section omitted */ }

    return sections;
  }

  private async answerQuestion(
    organizationId: string,
    userId: string,
    question: string,
    dto: CopilotAskDto,
    language: "bn" | "en",
  ): Promise<CopilotAskResult> {
    const bn = language === "bn";
    await this.checkDailyLimit(organizationId);

    const sections = await this.buildPack(organizationId, question);
    const packLines = sections.flatMap((s) => s.lines);
    if (packLines.length === 0) {
      // Nothing verified exists to answer FROM — saying so is
      // deterministic; spending an LLM call to phrase a
      // data-absence would only risk invented content.
      return {
        kind: "answer",
        answer: bn
          ? "এখনো আপনার ব্যবসার যাচাইকৃত তথ্য এই system-এ জমা হয়নি (performance/ads/competitor কোনো হিসাবই তৈরি হয়নি), তাই এই প্রশ্নের উত্তর দেওয়ার মতো তথ্য আমার কাছে নেই। ডেটা জমা হলে আবার জিজ্ঞেস করুন।"
          : "No verified information about your business has accumulated in this system yet (no performance/ads/competitor figures exist), so I have nothing to answer this question from. Please ask again once data has accumulated.",
        language,
        sections,
        guardNote: null,
        proposal: null,
        candidates: null,
      };
    }

    const provider: LlmProvider = await providerForOrg(this.llm, organizationId);
    if (!provider.isRealLlm) throw new CopilotLlmNotConfiguredError();

    const packText = sections
      .map((s) => `## [source: ${s.source}${s.window ? `, window: ${s.window}` : ""}]\n${s.lines.join("\n")}`)
      .join("\n\n");
    const allowed = new Set(extractGuardNumbers(packText));

    const system = bn
      ? [
          "আপনি এই ব্যবসার Owner Copilot — মালিকের নিজের ডেটা দেখে প্রশ্নের উত্তর দেন।",
          "শুধুমাত্র নিচের যাচাইকৃত তথ্য ব্যবহার করুন। তথ্যে উত্তর না থাকলে স্পষ্ট বলুন: “এই তথ্যটা আমার কাছে নেই।”",
          "কোনো সংখ্যা বানাবেন না — উত্তরের প্রতিটি সংখ্যা অবশ্যই যাচাইকৃত তথ্যে হুবহু থাকতে হবে।",
          "বাংলায় (বাংলা হরফে), সংক্ষেপে ও সরাসরি উত্তর দিন।",
        ].join("\n")
      : [
          "You are this business's Owner Copilot — you answer the owner's questions from their own data.",
          "Use ONLY the verified facts below. If the facts do not contain the answer, say plainly: “I don't have that information.”",
          "Never invent a number — every number in your answer must appear exactly in the verified facts.",
          "Answer in English, briefly and directly.",
        ].join("\n");

    const history: LlmMessage[] = (Array.isArray(dto.history) ? dto.history : [])
      .filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string" && h.content.trim())
      .slice(-COPILOT_HISTORY_MAX_TURNS)
      .map((h) => ({ role: h.role as "user" | "assistant", content: h.content.slice(0, 1000) }));

    const callModel = async (extraSystem: string | null): Promise<{ text: string }> => {
      const messages: LlmMessage[] = [
        { role: "system", content: extraSystem ? `${system}\n${extraSystem}` : system },
        ...history,
        { role: "user", content: `যাচাইকৃত তথ্য:\n${packText}\n\nপ্রশ্ন: ${question}` },
      ];
      let result;
      try {
        result = await provider.complete(messages, { maxTokens: 700 });
      } catch (e: any) {
        throw new BadRequestException(e?.message ?? String(e));
      }
      // Usage AFTER provider success, per call (house
      // discipline) — a regeneration is a second real call and
      // is accounted as one.
      await this.p().aIUsageRecord.create({
        data: {
          organizationId,
          userId,
          feature: COPILOT_FEATURE,
          provider: provider.name,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          estimated: result.tokensEstimated,
        },
      }).catch(() => undefined);
      return { text: String(result.text ?? "").trim() };
    };

    const first = await callModel(null);
    let answer = first.text;
    let guardNote: string | null = null;
    let dropped = answer ? [...new Set(extractGuardNumbers(answer).filter((n) => !allowed.has(n)))] : [];

    if (answer && dropped.length > 0) {
      // ONE regeneration with the offending numbers named (the
      // guard's complaint is specific, so the correction can be).
      const corrective = bn
        ? `আপনার আগের উত্তরটি ফিরিয়ে দেওয়া হয়েছে, কারণ এতে যাচাইকৃত তথ্যে নেই এমন সংখ্যা ছিল: ${dropped.join(", ")}। উত্তরটি আবার লিখুন — শুধু যাচাইকৃত তথ্যের সংখ্যা ব্যবহার করে; তথ্যে উত্তর না থাকলে স্পষ্ট বলুন “এই তথ্যটা আমার কাছে নেই।”`
        : `Your previous answer was rejected because it used numbers that are NOT in the verified facts: ${dropped.join(", ")}. Rewrite the answer using only numbers from the verified facts; if the facts do not answer the question, say plainly “I don't have that information.”`;
      const second = await callModel(corrective);
      const secondDropped = second.text
        ? [...new Set(extractGuardNumbers(second.text).filter((n) => !allowed.has(n)))]
        : [];
      if (second.text && secondDropped.length === 0) {
        answer = second.text;
        guardNote = "regenerated";
        dropped = [];
      } else {
        dropped = secondDropped.length ? secondDropped : dropped;
        answer = "";
      }
    }

    if (!answer) {
      // The prose failed the guard twice (or came back empty):
      // withhold it and hand over the verified facts themselves
      // — facts always available, prose is the bonus (SA-B14).
      await this.audit?.log({
        organizationId,
        userId,
        action: "ai.copilot_answer_dropped",
        entityType: "Organization",
        entityId: organizationId,
        metadata: { droppedNumbers: dropped },
      }).catch(() => undefined);
      return {
        kind: "answer",
        answer: bn
          ? "AI-এর উত্তরটি যাচাইকৃত সংখ্যার সঙ্গে মেলাতে পারিনি, তাই সেটি দেখাচ্ছি না। আপনার ব্যবসার যাচাইকৃত তথ্যগুলো সঙ্গে দিলাম — উত্তরটি সেখানেই আছে।"
          : "I could not reconcile the AI's answer with the verified figures, so I am not showing it. Your verified facts are attached — the answer is in them.",
        language,
        sections,
        guardNote: "dropped_unsupported_numbers",
        droppedNumbers: dropped,
        proposal: null,
        candidates: null,
      };
    }

    await this.audit?.log({
      organizationId,
      userId,
      action: "ai.copilot_ask",
      entityType: "Organization",
      entityId: organizationId,
      metadata: { kind: "answer", guardNote },
    }).catch(() => undefined);

    return { kind: "answer", answer, language, sections, guardNote, proposal: null, candidates: null };
  }
}
