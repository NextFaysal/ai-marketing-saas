import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { parseMoneyToMinor } from "@repo/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CampaignsService } from "../campaigns/campaigns.service";
import { MessagingService } from "../messaging/messaging.service";
import { ProductsService } from "../products/products.service";
import { InventoryService } from "../inventory/inventory.service";
import { CommerceService } from "../commerce/commerce.service";
import { DiscountsService } from "../commerce/discounts.service";
import { LlmFactory, providerForOrg } from "./llm/llm.factory";
import { PROPOSAL_TOOL_ROLES } from "./planner";
import { badRequest, forbidden, notFound } from "../i18n/api-exception";

export const PROPOSAL_TYPES = ["pause_campaign", "pause_ad_set", "resume_campaign", "resume_ad_set", "create_broadcast_draft", "create_followup_task", "create_quick_reply", "propose_price_change", "propose_stock_adjust", "propose_listing_publish", "propose_listing_unpublish", "propose_create_discount", "propose_product_copy"] as const;
export type ProposalType = (typeof PROPOSAL_TYPES)[number];

export interface ProposalInput {
  type: string;
  planId?: string;
  adSetId?: string;
  recommendationId?: string;
  // broadcast draft fields (flat, validated server-side)
  name?: string;
  channel?: string;
  subject?: string;
  body?: string;
  audienceType?: string;
  audienceStage?: string;
  audienceSegment?: string;
  whatsappTemplateId?: string;
  // AP5 fields (flat, validated server-side)
  leadId?: string;
  dueAt?: string;
  note?: string;
  title?: string;
  content?: string;
  // EC11 commerce fields (flat, validated server-side)
  productId?: string;
  listingId?: string;
  newPrice?: string;
  newQuantity?: number;
  delta?: number;
  discountCode?: string;
  discountKind?: string;
  discountValue?: number;
  discountMinOrderMinor?: string;
  discountUsageLimit?: number;
}

/** Render integer minor units as a decimal string ("123450" -> "1234.50"). */
export function minorToDecimal(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

function toBigIntOrZero(v: unknown): bigint {
  try { return BigInt(v as any); } catch { return 0n; }
}

const PAUSE_WORDS = ["pause", "পজ", "বন্ধ কর", "বন্ধ করে দাও", "বন্ধ করুন", "stop campaign"];
const RESUME_WORDS = ["resume", "চালু কর", "চালু করে দাও", "চালু করুন", "আবার চালু", "সক্রিয় কর", "start campaign", "activate"];

/**
 * Milestone 47 — Write Actions with Approval.
 *
 * The assistant (or the user, via the AI page) may PROPOSE a write
 * action. Proposing validates the target against real rows and stores
 * an exact preview of what approval will do — and executes NOTHING.
 * Approval is a separate explicit user action; only then does the
 * executor call the existing confirmed service paths:
 *   - CampaignsService.setMetaStatus / setAdSetStatus (Meta confirms
 *     first; the service itself refuses to change local state without
 *     that confirmation)
 *   - MessagingService.createBroadcast (creates a DRAFT only — this
 *     proposal type can never send)
 * If the underlying call throws or is unconfirmed, the proposal is
 * recorded FAILED with the platform's error verbatim. Success is
 * only ever recorded after the service returns.
 */
@Injectable()
export class ProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly campaigns?: CampaignsService,
    @Optional() private readonly messaging?: MessagingService,
    @Optional() private readonly products?: ProductsService,
    @Optional() private readonly inventory?: InventoryService,
    @Optional() private readonly commerce?: CommerceService,
    @Optional() private readonly discounts?: DiscountsService,
    @Optional() private readonly llmFactory?: LlmFactory,
  ) {}

  private p(): any { return this.prisma as any; }

  // ---------- validation + preview (shared by API + chat paths) ----------
  private async build(orgId: string, dto: ProposalInput): Promise<{ type: ProposalType; title: string; preview: string; payload: any }> {
    if (!PROPOSAL_TYPES.includes(dto.type as ProposalType)) {
      throw badRequest("ai.typeMustBeOneOf", { p1: PROPOSAL_TYPES.join(", ") });
    }
    if (dto.type === "pause_campaign") {
      if (!dto.planId) throw badRequest("ai.planidIsRequiredForPauseCampaign");
      const plan = await this.p().campaignPlan.findFirst({ where: { id: dto.planId, organizationId: orgId } });
      if (!plan) throw notFound("ai.campaignPlanNotFoundInThis");
      if (plan.status !== "published" || !plan.externalCampaignId) {
        throw badRequest("ai.onlyAPublishedCampaignCanBe");
      }
      return {
        type: "pause_campaign",
        title: `ক্যাম্পেইন Pause: ${plan.name}`,
        preview: `অনুমোদন দিলে “${plan.name}” ক্যাম্পেইনটি Meta-তে PAUSED করা হবে (Meta Campaign ID: ${plan.externalCampaignId})। Meta নিশ্চিত না করলে প্রস্তাবটি ব্যর্থ হিসেবে রেকর্ড হবে এবং কোনো local status বদলাবে না। এখনো কিছুই করা হয়নি।`,
        payload: { planId: plan.id, planName: plan.name, externalCampaignId: plan.externalCampaignId },
      };
    }
    if (dto.type === "pause_ad_set") {
      if (!dto.adSetId) throw badRequest("ai.adsetidIsRequiredForPauseAd");
      const adSet = await this.p().campaignAdSet.findFirst({ where: { id: dto.adSetId } });
      if (!adSet) throw notFound("ai.adSetNotFound");
      const plan = await this.p().campaignPlan.findFirst({ where: { id: adSet.planId, organizationId: orgId } });
      if (!plan) throw notFound("ai.adSetNotFoundInThis");
      if (plan.status !== "published") throw badRequest("ai.onlyAPublishedPlanSAd");
      if (!adSet.externalAdSetId) throw badRequest("ai.thisAdSetHasNoMeta");
      return {
        type: "pause_ad_set",
        title: `Ad Set Pause: ${adSet.name ?? adSet.id}`,
        preview: `অনুমোদন দিলে “${plan.name}” প্ল্যানের “${adSet.name ?? adSet.id}” ad set-টি Meta-তে PAUSED করা হবে (Meta Ad Set ID: ${adSet.externalAdSetId})। Meta নিশ্চিত না করলে প্রস্তাবটি ব্যর্থ হিসেবে রেকর্ড হবে। এখনো কিছুই করা হয়নি।`,
        payload: { planId: plan.id, planName: plan.name, adSetId: adSet.id, adSetName: adSet.name ?? null, externalAdSetId: adSet.externalAdSetId },
      };
    }
    if (dto.type === "resume_campaign") {
      if (!dto.planId) throw badRequest("ai.planidIsRequiredForResumeCampaign");
      const plan = await this.p().campaignPlan.findFirst({ where: { id: dto.planId, organizationId: orgId } });
      if (!plan) throw notFound("ai.campaignPlanNotFoundInThis");
      if (plan.status !== "published" || !plan.externalCampaignId) {
        throw badRequest("ai.onlyAPublishedCampaignCanBe2");
      }
      if (plan.metaStatus !== "PAUSED") {
        throw badRequest("ai.thisCampaignIsNotPausedNow", { p1: plan.metaStatus ?? "অজানা" });
      }
      return {
        type: "resume_campaign",
        title: `ক্যাম্পেইন Resume: ${plan.name}`,
        preview: `অনুমোদন দিলে “${plan.name}” ক্যাম্পেইনটি Meta-তে আবার ACTIVE করা হবে (Meta Campaign ID: ${plan.externalCampaignId})। Meta নিশ্চিত না করলে প্রস্তাবটি ব্যর্থ হিসেবে রেকর্ড হবে। এখনো কিছুই করা হয়নি।`,
        payload: { planId: plan.id, planName: plan.name, externalCampaignId: plan.externalCampaignId },
      };
    }
    if (dto.type === "resume_ad_set") {
      if (!dto.adSetId) throw badRequest("ai.adsetidIsRequiredForResumeAd");
      const adSet = await this.p().campaignAdSet.findFirst({ where: { id: dto.adSetId } });
      if (!adSet) throw notFound("ai.adSetNotFound");
      const plan = await this.p().campaignPlan.findFirst({ where: { id: adSet.planId, organizationId: orgId } });
      if (!plan) throw notFound("ai.adSetNotFoundInThis");
      if (plan.status !== "published") throw badRequest("ai.onlyAPublishedPlanSAd2");
      if (!adSet.externalAdSetId) throw badRequest("ai.thisAdSetHasNoMeta2");
      return {
        type: "resume_ad_set",
        title: `Ad Set Resume: ${adSet.name ?? adSet.id}`,
        preview: `অনুমোদন দিলে “${plan.name}” প্ল্যানের “${adSet.name ?? adSet.id}” ad set-টি Meta-তে আবার ACTIVE করা হবে (Meta Ad Set ID: ${adSet.externalAdSetId})। Ad set-এর বর্তমান status শুধু Meta-র কাছেই জানা যায় — Meta নিশ্চিত না করলে প্রস্তাবটি ব্যর্থ হিসেবে রেকর্ড হবে। এখনো কিছুই করা হয়নি।`,
        payload: { planId: plan.id, planName: plan.name, adSetId: adSet.id, adSetName: adSet.name ?? null, externalAdSetId: adSet.externalAdSetId },
      };
    }
    if (dto.type === "create_followup_task") {
      if (!dto.leadId) throw badRequest("ai.leadidIsRequiredForCreateFollowup");
      const lead = await this.p().lead.findFirst({ where: { id: dto.leadId, organizationId: orgId, mergedIntoId: null } });
      if (!lead) throw notFound("ai.leadNotFoundInThisOrganization");
      const due = dto.dueAt ? new Date(dto.dueAt) : null;
      if (!due || Number.isNaN(due.getTime())) throw badRequest("ai.aValidDueatIsoDateIs");
      const dueStr = due.toISOString().slice(0, 10);
      return {
        type: "create_followup_task",
        title: `ফলো-আপ টাস্ক: ${lead.name}`,
        preview: `অনুমোদন দিলে লিড “${lead.name}”-এর জন্য ${dueStr} তারিখে ফলো-আপ সেট হবে (CRM-এ next follow-up)${dto.note?.trim() ? ` — নোট: “${dto.note.trim().slice(0, 200)}”` : ""}। এখনো কিছুই করা হয়নি।`,
        payload: { leadId: lead.id, leadName: lead.name, dueAt: due.toISOString(), note: dto.note?.trim().slice(0, 500) ?? "" },
      };
    }
    if (dto.type === "create_quick_reply") {
      const title = dto.title?.trim() ?? "";
      const content = dto.content?.trim() ?? "";
      if (!title) throw badRequest("ai.quickReplyNeedsATitle");
      if (!content) throw badRequest("ai.quickReplyContentIsNeeded");
      return {
        type: "create_quick_reply",
        title: `Quick Reply: ${title.slice(0, 80)}`,
        preview: `অনুমোদন দিলে Inbox-এর জন্য একটি quick reply তৈরি হবে — Title: “${title.slice(0, 120)}”, Content: “${content.slice(0, 200)}”। এটি শুধু সেভ হবে, কোথাও পাঠানো হবে না। এখনো কিছুই তৈরি হয়নি।`,
        payload: { quickReply: { title: title.slice(0, 120), content: content.slice(0, 4000) } },
      };
    }
    if (dto.type === "propose_price_change") {
      if (!dto.productId) throw badRequest("ai.productidIsRequiredForProposePrice");
      const product = await this.p().product.findFirst({ where: { id: dto.productId, organizationId: orgId } });
      if (!product) throw notFound("ai.productNotFoundInThisOrganization");
      if (!dto.newPrice || !String(dto.newPrice).trim()) throw badRequest("ai.newpriceIsRequiredForProposePrice");
      let parsed: bigint;
      try { parsed = parseMoneyToMinor(dto.newPrice); } catch { throw badRequest("ai.invalidNewprice", { dtoNewPrice: dto.newPrice }); }
      if (parsed <= 0n) throw badRequest("ai.newpriceMustBeMoreThan0");
      const currentMinor = toBigIntOrZero(product.priceMinor);
      return {
        type: "propose_price_change",
        title: `পণ্যের দাম পরিবর্তন: ${product.name}`,
        preview: `অনুমোদন দিলে “${product.name}” পণ্যের দাম ${minorToDecimal(currentMinor)} থেকে ${minorToDecimal(parsed)}-এ বদলাবে। অনুমোদনের পর স্টোরে পুশ পণ্যের স্বাভাবিক full-manage নিয়ম অনুযায়ী হবে। এখনো কিছুই করা হয়নি।`,
        payload: { productId: product.id, productName: product.name, newPrice: String(dto.newPrice), newPriceMinor: String(parsed), currentPriceMinor: String(currentMinor) },
      };
    }
    if (dto.type === "propose_stock_adjust") {
      if (!dto.productId) throw badRequest("ai.productidIsRequiredForProposeStock");
      const product = await this.p().product.findFirst({ where: { id: dto.productId, organizationId: orgId } });
      if (!product) throw notFound("ai.productNotFoundInThisOrganization");
      const hasNew = dto.newQuantity !== undefined && dto.newQuantity !== null;
      const hasDelta = dto.delta !== undefined && dto.delta !== null;
      if (hasNew === hasDelta) throw badRequest("ai.newquantityOrDeltaExactlyOneMust");
      if (product.stockQuantity === null || product.stockQuantity === undefined) {
        throw badRequest("ai.thisProductSStockIsNot");
      }
      const currentQuantity = Number(product.stockQuantity);
      let resultingQuantity: number;
      let mode: "set" | "delta";
      const extra: Record<string, unknown> = {};
      if (hasNew) {
        if (!Number.isInteger(dto.newQuantity) || (dto.newQuantity as number) < 0) throw badRequest("ai.newquantityMustBeAnIntegerOf");
        mode = "set"; resultingQuantity = dto.newQuantity as number; extra.setTo = dto.newQuantity;
      } else {
        if (!Number.isInteger(dto.delta) || dto.delta === 0) throw badRequest("ai.deltaMustBeANonZero");
        mode = "delta"; resultingQuantity = currentQuantity + (dto.delta as number); extra.delta = dto.delta;
        if (resultingQuantity < 0) throw badRequest("ai.applyingDeltaWouldMakeTheStock");
      }
      return {
        type: "propose_stock_adjust",
        title: `স্টক সমন্বয়: ${product.name}`,
        preview: `অনুমোদন দিলে “${product.name}” পণ্যের স্টক ${currentQuantity}টি থেকে ${resultingQuantity}টি হবে (${mode === "set" ? `setTo: ${dto.newQuantity}` : `delta: ${dto.delta}`})। এখনো কিছুই করা হয়নি।`,
        payload: { productId: product.id, productName: product.name, mode, ...extra, currentQuantity, resultingQuantity },
      };
    }
    if (dto.type === "propose_listing_publish" || dto.type === "propose_listing_unpublish") {
      const isPublish = dto.type === "propose_listing_publish";
      if (!dto.listingId) throw badRequest("ai.listingidIsRequiredFor", { dtoType: dto.type });
      const listing = await this.p().storeListing.findFirst({ where: { id: dto.listingId, organizationId: orgId } });
      if (!listing) throw notFound("ai.listingNotFoundInThisOrganization");
      const store = await this.p().store.findFirst({ where: { id: listing.storeId, organizationId: orgId } }).catch(() => null);
      const product = await this.p().product.findFirst({ where: { id: listing.productId, organizationId: orgId } }).catch(() => null);
      const storeName = store?.name ?? listing.storeId;
      const productName = product?.name ?? listing.productId;
      if (isPublish && listing.publishState === "published") throw badRequest("ai.thisListingIsAlreadyPublished");
      if (!isPublish && listing.publishState !== "published") throw badRequest("ai.thisListingIsNotPublishedThere");
      return {
        type: isPublish ? "propose_listing_publish" : "propose_listing_unpublish",
        title: isPublish ? `লিস্টিং Publish: ${productName}` : `লিস্টিং Unpublish: ${productName}`,
        preview: `অনুমোদন দিলে “${storeName}” স্টোরে “${productName}” পণ্যের লিস্টিংটি ${isPublish ? "published করা হবে" : "unpublish (draft) করা হবে"}। এখনো কিছুই করা হয়নি।`,
        payload: { listingId: listing.id, storeId: listing.storeId, productId: listing.productId, storeName, productName },
      };
    }
    if (dto.type === "propose_create_discount") {
      const code = String(dto.discountCode ?? "").trim().toUpperCase();
      if (!code) throw badRequest("ai.discountcodeIsRequiredForProposeCreate");
      const kind = dto.discountKind ?? "";
      if (!["percent", "fixed", "free_shipping"].includes(kind)) throw badRequest("ai.discountkindMustBePercentFixedOr");
      let value: number;
      if (kind === "free_shipping") value = 0;
      else if (kind === "percent") {
        if (!Number.isInteger(dto.discountValue) || (dto.discountValue as number) < 1 || (dto.discountValue as number) > 90) throw badRequest("ai.theValueOfAPercentageDiscount");
        value = dto.discountValue as number;
      } else {
        if (!Number.isInteger(dto.discountValue) || (dto.discountValue as number) < 1) throw badRequest("ai.theValueOfAFixedAmount");
        value = dto.discountValue as number;
      }
      if (dto.discountMinOrderMinor !== undefined && dto.discountMinOrderMinor !== null && !/^\d+$/.test(String(dto.discountMinOrderMinor))) {
        throw badRequest("ai.discountminorderminorMustBeAnIntegerMinor");
      }
      if (dto.discountUsageLimit !== undefined && dto.discountUsageLimit !== null && (!Number.isInteger(dto.discountUsageLimit) || (dto.discountUsageLimit as number) < 1)) {
        throw badRequest("ai.discountusagelimitMustBeAPositiveInteger");
      }
      const existing = this.p().storeDiscount?.findFirst ? await this.p().storeDiscount.findFirst({ where: { organizationId: orgId, code } }) : null;
      if (existing) throw badRequest("ai.aDiscountAlreadyExistsWithThis");
      const discount = { code, kind, value, minOrderMinor: dto.discountMinOrderMinor ?? null, usageLimit: dto.discountUsageLimit ?? null };
      return {
        type: "propose_create_discount",
        title: `ডিসকাউন্ট তৈরি: ${code}`,
        preview: `অনুমোদন দিলে “${code}” কোডের ডিসকাউন্টটি শুধুমাত্র এই SaaS-এর ভিতরে স্থানীয়ভাবে তৈরি হবে — এটি কোনো স্টোরে পাঠানো হবে না। স্টোর বেছে দেওয়া পরে Discounts পেজ থেকে করতে হবে। এখনো কিছুই তৈরি হয়নি।`,
        payload: { discount },
      };
    }
    if (dto.type === "propose_product_copy") {
      if (!dto.productId) throw badRequest("ai.productidIsRequiredForProposeProduct");
      const product = await this.p().product.findFirst({ where: { id: dto.productId, organizationId: orgId } });
      if (!product) throw notFound("ai.productNotFoundInThisOrganization");
      if (!this.llmFactory) throw badRequest("ai.theLlmServiceIsNotAvailable");
      const provider: any = await providerForOrg(this.llmFactory, orgId);
      if (!provider?.isRealLlm) throw badRequest("ai.noRealLlmIsConfiguredFalse");
      let variants: any[] = Array.isArray(product.variants) ? product.variants : [];
      if (!variants.length && this.p().productVariant?.findMany) {
        variants = await this.p().productVariant.findMany({ where: { productId: product.id } }).catch(() => []);
      }
      const facts = {
        name: product.name,
        category: product.category ?? null,
        description: product.description ?? null,
        price: minorToDecimal(toBigIntOrZero(product.priceMinor)),
        compareAt: product.compareAtMinor != null ? minorToDecimal(toBigIntOrZero(product.compareAtMinor)) : null,
        sku: product.sku ?? null,
        barcode: product.barcode ?? null,
        variants: (variants as any[]).map((v) => ({ name: v.name, price: v.priceMinor != null ? minorToDecimal(toBigIntOrZero(v.priceMinor)) : null })),
        stock: product.stockQuantity ?? null,
      };
      let result: any;
      try {
        result = await provider.complete([
          { role: "system", content: "You write e-commerce product copy. Return ONLY JSON with keys description, seoTitle, seoDescription. Write in the organisation's language style (Bengali-friendly). Use ONLY the real product facts given; invent nothing." },
          { role: "user", content: JSON.stringify(facts) },
        ], { jsonMode: true });
      } catch (e) {
        throw new BadRequestException(e instanceof Error ? e.message : "LLM copy generation failed");
      }
      let parsedCopy: any;
      try {
        const raw = String(result?.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        parsedCopy = JSON.parse(raw);
      } catch {
        throw badRequest("ai.theCopyFromTheLlmCould");
      }
      const description = typeof parsedCopy?.description === "string" ? parsedCopy.description.trim().slice(0, 5000) : "";
      if (!description) throw badRequest("ai.theLlmGaveNoValidDescription");
      const copy = {
        description,
        seoTitle: typeof parsedCopy?.seoTitle === "string" ? parsedCopy.seoTitle.slice(0, 200) : "",
        seoDescription: typeof parsedCopy?.seoDescription === "string" ? parsedCopy.seoDescription.slice(0, 500) : "",
      };
      return {
        type: "propose_product_copy",
        title: `পণ্যের কপি: ${product.name}`,
        preview: `অনুমোদন দিলে নিচের কপি “${product.name}” পণ্যে লেখা হবে।\nDescription: ${copy.description.slice(0, 300)}\nSEO Title: ${copy.seoTitle}\nSEO Description: ${copy.seoDescription}\nএখনো কিছুই লেখা হয়নি।`,
        payload: { productId: product.id, productName: product.name, copy },
      };
    }
    // create_broadcast_draft
    const channel = dto.channel ?? "";
    if (!["email", "sms", "whatsapp"].includes(channel)) throw badRequest("ai.channelMustBeEmailSmsOr");
    if (!dto.name?.trim()) throw badRequest("ai.aBroadcastDraftNeedsAName");
    const audienceType = dto.audienceType ?? "customers";
    if (!["customers", "leads_stage", "segment"].includes(audienceType)) throw badRequest("ai.audiencetypeMustBeCustomersLeadsStage");
    if (channel === "whatsapp") {
      if (!dto.whatsappTemplateId) throw badRequest("ai.aRegisteredTemplateIsNeededFor");
      const tpl = await this.p().whatsAppTemplate.findFirst({ where: { id: dto.whatsappTemplateId, organizationId: orgId } });
      if (!tpl) throw notFound("ai.whatsappTemplateNotFoundInThis");
    } else {
      if (!dto.body?.trim()) throw badRequest("ai.broadcastBodyIsRequired");
      if (channel === "email" && !dto.subject?.trim()) throw badRequest("ai.emailBroadcastsNeedASubject");
    }
    const broadcast = {
      name: dto.name.trim().slice(0, 160), channel,
      subject: dto.subject ?? undefined, body: dto.body ?? undefined,
      audienceType, audienceStage: dto.audienceStage, audienceSegment: dto.audienceSegment,
      whatsappTemplateId: dto.whatsappTemplateId,
    };
    return {
      type: "create_broadcast_draft",
      title: `Broadcast Draft: ${broadcast.name}`,
      preview: `অনুমোদন দিলে একটি ${channel} broadcast শুধুমাত্র DRAFT হিসেবে তৈরি হবে (“${broadcast.name}”, audience: ${audienceType})। এটি পাঠানো হবে না — পাঠাতে হলে Broadcasts পেজ থেকে আলাদাভাবে পাঠাতে হবে। এখনো কিছুই তৈরি হয়নি।`,
      payload: { broadcast },
    };
  }

  private async logAiAction(orgId: string, userId: string, row: any, toolName: string, status: string, error?: string) {
    await this.p().aIAction.create({
      data: { organizationId: orgId, userId, conversationId: row.conversationId ?? null, toolName, args: { proposalId: row.id, type: row.type } as any, status, error: error ?? null },
    }).catch(() => undefined);
  }

  async propose(orgId: string, userId: string, dto: ProposalInput, conversationId?: string) {
    const built = await this.build(orgId, dto);
    // Dedupe: an identical still-open proposal is returned, not duplicated.
    const open = await this.p().aIActionProposal.findMany({ where: { organizationId: orgId, status: "proposed", type: built.type }, take: 100 });
    const targetKey = built.payload.planId ?? built.payload.adSetId ?? built.payload.leadId ?? built.payload.quickReply?.title ?? built.payload.broadcast?.name ?? built.payload.productId ?? built.payload.listingId ?? built.payload.discount?.code;
    const existing = (open as any[]).find((r) => (r.payload?.planId ?? r.payload?.adSetId ?? r.payload?.leadId ?? r.payload?.quickReply?.title ?? r.payload?.broadcast?.name ?? r.payload?.productId ?? r.payload?.listingId ?? r.payload?.discount?.code) === targetKey && r.type === built.type);
    if (existing) return existing;
    const row = await this.p().aIActionProposal.create({
      data: {
        organizationId: orgId, userId, conversationId: conversationId ?? null,
        recommendationId: dto.recommendationId ?? null,
        type: built.type, title: built.title, preview: built.preview, payload: built.payload as any, status: "proposed",
      },
    });
    await this.logAiAction(orgId, userId, row, `proposal.${built.type}`, "success");
    await this.audit.log({ organizationId: orgId, userId, action: "ai.proposal_created", entityType: "AIActionProposal", entityId: row.id, metadata: { type: built.type } });
    // AP7 autonomy level 2: the org owner has pre-authorized
    // INTERNAL-ONLY types (quick-reply save, CRM follow-up —
    // reversible, non-money, never sends anything) to execute
    // without a second approval click. Execution still goes
    // through approve() (atomic claim + confirmed path + audit)
    // and the result is marked autonomous. All other types always
    // wait for a human, at every level. Default level 0 = off.
    if (["create_quick_reply", "create_followup_task"].includes(built.type)) {
      const setting = await this.p().aIProactiveSetting?.findFirst({ where: { organizationId: orgId } }).catch(() => null);
      if (setting && Number(setting.autonomyLevel ?? 0) >= 2) {
        return this.approve(orgId, userId, row.id, { autonomous: true });
      }
    }
    return row;
  }

  async list(orgId: string, status?: string) {
    return this.p().aIActionProposal.findMany({
      where: { organizationId: orgId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" }, take: 50,
    });
  }

  /** Real targets a user may propose against (published plans + ad sets). */
  async targets(orgId: string) {
    const plans = await this.p().campaignPlan.findMany({
      where: { organizationId: orgId, status: "published" }, orderBy: { updatedAt: "desc" }, take: 50,
    });
    const planIds = (plans as any[]).map((pl) => pl.id);
    const adSets = planIds.length
      ? await this.p().campaignAdSet.findMany({ where: { planId: { in: planIds } }, take: 200 })
      : [];
    const byPlan = new Map((plans as any[]).map((pl) => [pl.id, pl.name]));
    return {
      campaigns: (plans as any[]).map((pl) => ({ id: pl.id, name: pl.name, metaStatus: pl.metaStatus ?? null, externalCampaignId: pl.externalCampaignId })),
      adSets: (adSets as any[]).filter((a) => a.externalAdSetId).map((a) => ({ id: a.id, name: a.name ?? a.id, planId: a.planId, planName: byPlan.get(a.planId) ?? "" })),
    };
  }

  private async getOrThrow(orgId: string, proposalId: string) {
    const row = await this.p().aIActionProposal.findFirst({ where: { id: proposalId, organizationId: orgId } });
    if (!row) throw notFound("ai.proposalNotFound");
    return row;
  }

  /** Approve = the explicit human decision. Executes via confirmed paths. */
  async approve(orgId: string, actorId: string, proposalId: string, opts?: { autonomous?: boolean } | string) {
    // Integration: EC11 callers pass the actor role positionally;
    // the AP7 autonomy path passes { autonomous: true }.
    const actorRole = typeof opts === "string" ? opts : undefined;
    const autonomous = typeof opts === "object" && !!opts?.autonomous;
    const row = await this.getOrThrow(orgId, proposalId);
    // EC11: service-level role floor for commerce proposal types.
    const requiredRoles = PROPOSAL_TOOL_ROLES[row.type];
    if (requiredRoles && actorRole !== undefined && !requiredRoles.includes(actorRole)) {
      throw forbidden("ai.yourRoleDoesNotHavePermission");
    }
    if (row.status !== "proposed") throw badRequest("ai.thisProposalWasAlreadyDecidedStatus", { rowStatus: row.status });
    const claim = await this.p().aIActionProposal.updateMany({
      where: { id: proposalId, organizationId: orgId, status: "proposed" },
      data: { status: "approved", decidedById: actorId, decidedAt: new Date() },
    });
    if (!claim?.count) throw badRequest("ai.thisProposalWasAlreadyDecided");
    await this.audit.log({ organizationId: orgId, userId: actorId, action: "ai.proposal_approved", entityType: "AIActionProposal", entityId: proposalId, metadata: { type: row.type, ...(autonomous ? { autonomous: true } : {}) } });
    try {
      const rawResult = await this.execute(orgId, actorId, row);
      const result = autonomous ? { ...rawResult, autonomous: true } : rawResult;
      const updated = await this.p().aIActionProposal.update({
        where: { id: proposalId }, data: { status: "executed", executedAt: new Date(), result: result as any, error: null },
      });
      await this.logAiAction(orgId, actorId, row, `execute.${row.type}`, "success");
      await this.audit.log({ organizationId: orgId, userId: actorId, action: "ai.proposal_executed", entityType: "AIActionProposal", entityId: proposalId, metadata: { type: row.type } });
      return updated;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Execution failed";
      const updated = await this.p().aIActionProposal.update({
        where: { id: proposalId }, data: { status: "failed", error: message },
      });
      await this.logAiAction(orgId, actorId, row, `execute.${row.type}`, "error", message);
      await this.audit.log({ organizationId: orgId, userId: actorId, action: "ai.proposal_failed", entityType: "AIActionProposal", entityId: proposalId, metadata: { type: row.type, error: message } });
      return updated; // the FAILED state is the honest result of the approval call
    }
  }

  private async execute(orgId: string, actorId: string, row: any): Promise<Record<string, unknown>> {
    const payload = row.payload ?? {};
    if (row.type === "pause_campaign" || row.type === "resume_campaign") {
      if (!this.campaigns) throw new Error("CampaignsService is not available in this context");
      const target = row.type === "pause_campaign" ? "PAUSED" : "ACTIVE";
      // AP5 dry-run discipline: the CURRENT state is re-read at
      // approval time (not trusted from propose time) and recorded
      // as before → after in the result.
      const before: any = await this.p().campaignPlan.findFirst({ where: { id: payload.planId, organizationId: orgId } });
      const plan: any = await this.campaigns.setMetaStatus(orgId, actorId, payload.planId, target);
      return { planId: payload.planId, before: before?.metaStatus ?? null, after: plan?.metaStatus ?? target, metaStatus: plan?.metaStatus ?? target, confirmedBy: "meta" };
    }
    if (row.type === "pause_ad_set" || row.type === "resume_ad_set") {
      if (!this.campaigns) throw new Error("CampaignsService is not available in this context");
      const target = row.type === "pause_ad_set" ? "PAUSED" : "ACTIVE";
      const res: any = await this.campaigns.setAdSetStatus(orgId, actorId, payload.planId, payload.adSetId, target);
      // Ad-set status lives only on Meta — before is honestly null.
      return { adSetId: res?.adSetId ?? payload.adSetId, before: null, after: res?.target ?? target, target: res?.target ?? target, confirmedBy: "meta" };
    }
    if (row.type === "create_followup_task") {
      const lead = await this.p().lead.findFirst({ where: { id: payload.leadId, organizationId: orgId, mergedIntoId: null } });
      if (!lead) throw new Error("Lead no longer exists in this organization");
      await this.p().lead.update({ where: { id: lead.id }, data: { nextFollowUpAt: new Date(payload.dueAt) } });
      await this.p().leadActivity.create({
        data: { leadId: lead.id, userId: actorId, type: "note", content: `AI প্রস্তাব থেকে ফলো-আপ টাস্ক সেট হয়েছে (${String(payload.dueAt).slice(0, 10)})${payload.note ? `: ${payload.note}` : ""}` },
      });
      return { leadId: lead.id, nextFollowUpAt: payload.dueAt };
    }
    if (row.type === "create_quick_reply") {
      // Same write InboxService.createQuickReply performs (identical
      // validation + row shape); the inbox module is not imported
      // here to keep the AI module free of an inbox dependency.
      const qr = payload.quickReply ?? {};
      if (!qr.title?.trim() || !qr.content?.trim()) throw new Error("Quick reply title/content missing from payload");
      const created = await this.p().quickReply.create({
        data: { organizationId: orgId, title: String(qr.title).trim().slice(0, 120), content: String(qr.content).slice(0, 4000), createdByUserId: actorId },
      });
      return { quickReplyId: created.id, title: created.title };
    }
    if (row.type === "create_broadcast_draft") {
      if (!this.messaging) throw new Error("MessagingService is not available in this context");
      const created: any = await this.messaging.createBroadcast(orgId, actorId, payload.broadcast);
      if (created?.variants) return { broadcastIds: created.variants.map((v: any) => v.id), status: "draft" };
      if (!created?.id) throw new Error("Broadcast service returned no draft");
      if (created.status !== "draft") throw new Error(`Broadcast was created with unexpected status "${created.status}" — not counted as a draft success`);
      return { broadcastId: created.id, status: created.status };
    }
    if (row.type === "propose_price_change") {
      if (!this.products) throw new Error("ProductsService is not available in this context");
      const before: any = await this.p().product.findFirst({ where: { id: payload.productId, organizationId: orgId } });
      if (!before) throw new Error("Product no longer exists in this organization");
      const updated: any = await this.products.update(orgId, actorId, payload.productId, { price: payload.newPrice });
      return { productId: payload.productId, beforePriceMinor: String(before.priceMinor), afterPriceMinor: String(updated.priceMinor) };
    }
    if (row.type === "propose_stock_adjust") {
      if (!this.inventory) throw new Error("InventoryService is not available in this context");
      const before: any = await this.p().product.findFirst({ where: { id: payload.productId, organizationId: orgId } });
      if (!before) throw new Error("Product no longer exists in this organization");
      const res: any = await this.inventory.adjust(orgId, actorId, payload.productId, payload.mode === "set" ? { setTo: payload.setTo, reason: "ai_proposal" } : { delta: payload.delta, reason: "ai_proposal" });
      return { productId: payload.productId, before: before.stockQuantity ?? null, after: res.stockQuantity };
    }
    if (row.type === "propose_listing_publish" || row.type === "propose_listing_unpublish") {
      if (!this.commerce) throw new Error("CommerceService is not available in this context");
      if (row.type === "propose_listing_publish") await this.commerce.publishListing(orgId, actorId, payload.listingId);
      else await this.commerce.unpublishListing(orgId, actorId, payload.listingId);
      const listing: any = await this.p().storeListing.findFirst({ where: { id: payload.listingId, organizationId: orgId } });
      return { listingId: payload.listingId, publishState: listing?.publishState ?? null };
    }
    if (row.type === "propose_create_discount") {
      if (!this.discounts) throw new Error("DiscountsService is not available in this context");
      const d = payload.discount ?? {};
      const created: any = await this.discounts.create(orgId, actorId, {
        code: d.code, kind: d.kind, value: d.value,
        minOrderMinor: d.minOrderMinor ?? undefined,
        scopeType: "all",
        usageLimit: d.usageLimit ?? undefined,
      });
      return { discountId: created.discount?.id ?? created.id, code: d.code };
    }
    if (row.type === "propose_product_copy") {
      if (!this.products) throw new Error("ProductsService is not available in this context");
      const copy = payload.copy ?? {};
      await this.products.update(orgId, actorId, payload.productId, {
        description: copy.description, seoTitle: copy.seoTitle || undefined, seoDescription: copy.seoDescription || undefined,
      });
      return { productId: payload.productId, applied: ["description", "seoTitle", "seoDescription"] };
    }
    throw new Error(`Unknown proposal type: ${row.type}`);
  }

  /**
   * AP5 bulk approval: approve up to 20 proposals one by one
   * through the SAME approve() path (atomic claim + confirmed
   * execution per item). One item's failure never stops the rest;
   * every item's outcome is reported verbatim.
   */
  async approveMany(orgId: string, actorId: string, ids: string[], actorRole?: string) {
    const unique = [...new Set((ids ?? []).filter((x) => typeof x === "string" && x))].slice(0, 20);
    const results: { id: string; status: string; error?: string }[] = [];
    for (const id of unique) {
      try {
        const updated: any = await this.approve(orgId, actorId, id, actorRole);
        results.push({ id, status: updated.status, ...(updated.error ? { error: String(updated.error) } : {}) });
      } catch (e) {
        results.push({ id, status: "error", error: e instanceof Error ? e.message : "Approval failed" });
      }
    }
    return {
      results,
      executed: results.filter((r) => r.status === "executed").length,
      failed: results.filter((r) => r.status !== "executed").length,
    };
  }

  async reject(orgId: string, actorId: string, proposalId: string) {
    const row = await this.getOrThrow(orgId, proposalId);
    if (row.status !== "proposed") throw badRequest("ai.thisProposalWasAlreadyDecidedStatus", { rowStatus: row.status });
    const claim = await this.p().aIActionProposal.updateMany({
      where: { id: proposalId, organizationId: orgId, status: "proposed" },
      data: { status: "rejected", decidedById: actorId, decidedAt: new Date() },
    });
    if (!claim?.count) throw badRequest("ai.thisProposalWasAlreadyDecided");
    await this.audit.log({ organizationId: orgId, userId: actorId, action: "ai.proposal_rejected", entityType: "AIActionProposal", entityId: proposalId, metadata: { type: row.type } });
    return this.getOrThrow(orgId, proposalId);
  }

  /**
   * Deterministic chat proposal detection. Only fires when the
   * message asks to pause AND names a real published campaign plan
   * or ad set (exact name match against stored rows). Anything else
   * creates nothing. Never executes — propose() only.
   */
  async detectFromChat(orgId: string, userId: string, conversationId: string, content: string) {
    const text = content.toLowerCase();
    const wantsResume = RESUME_WORDS.some((w) => text.includes(w));
    const wantsPause = PAUSE_WORDS.some((w) => text.includes(w));
    if (!wantsPause && !wantsResume) return null;
    const plans = await this.p().campaignPlan.findMany({ where: { organizationId: orgId, status: "published" }, take: 50 });
    const planIds = (plans as any[]).map((pl) => pl.id);
    const adSets = planIds.length ? await this.p().campaignAdSet.findMany({ where: { planId: { in: planIds } }, take: 200 }) : [];
    // Prefer the most specific (longest) matching name; ad sets first on ties.
    const candidates: { kind: "adSet" | "plan"; id: string; name: string }[] = [];
    for (const a of adSets as any[]) {
      const name = String(a.name ?? "").trim();
      if (name.length >= 3 && a.externalAdSetId && text.includes(name.toLowerCase())) candidates.push({ kind: "adSet", id: a.id, name });
    }
    for (const pl of plans as any[]) {
      const name = String(pl.name ?? "").trim();
      if (name.length >= 3 && pl.externalCampaignId && text.includes(name.toLowerCase())) candidates.push({ kind: "plan", id: pl.id, name });
    }
    if (!candidates.length) return null;
    candidates.sort((x, y) => y.name.length - x.name.length || (x.kind === "adSet" ? -1 : 1));
    const hit = candidates[0];
    if (wantsResume && !wantsPause) {
      return this.propose(orgId, userId,
        hit.kind === "plan" ? { type: "resume_campaign", planId: hit.id } : { type: "resume_ad_set", adSetId: hit.id },
        conversationId).catch(() => null);
    }
    return this.propose(orgId, userId,
      hit.kind === "plan" ? { type: "pause_campaign", planId: hit.id } : { type: "pause_ad_set", adSetId: hit.id },
      conversationId);
  }
}
