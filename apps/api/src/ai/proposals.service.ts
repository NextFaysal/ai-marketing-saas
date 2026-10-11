import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CampaignsService } from "../campaigns/campaigns.service";
import { MessagingService } from "../messaging/messaging.service";

export const PROPOSAL_TYPES = ["pause_campaign", "pause_ad_set", "create_broadcast_draft"] as const;
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
}

const PAUSE_WORDS = ["pause", "পজ", "বন্ধ কর", "বন্ধ করে দাও", "বন্ধ করুন", "stop campaign"];

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
  ) {}

  private p(): any { return this.prisma as any; }

  // ---------- validation + preview (shared by API + chat paths) ----------
  private async build(orgId: string, dto: ProposalInput): Promise<{ type: ProposalType; title: string; preview: string; payload: any }> {
    if (!PROPOSAL_TYPES.includes(dto.type as ProposalType)) {
      throw new BadRequestException(`type must be one of: ${PROPOSAL_TYPES.join(", ")}`);
    }
    if (dto.type === "pause_campaign") {
      if (!dto.planId) throw new BadRequestException("planId is required for pause_campaign");
      const plan = await this.p().campaignPlan.findFirst({ where: { id: dto.planId, organizationId: orgId } });
      if (!plan) throw new NotFoundException("Campaign plan not found in this organization");
      if (plan.status !== "published" || !plan.externalCampaignId) {
        throw new BadRequestException("শুধুমাত্র published ক্যাম্পেইনই pause করা যায় — এই প্ল্যানটি এখনো Meta-তে published নয়।");
      }
      return {
        type: "pause_campaign",
        title: `ক্যাম্পেইন Pause: ${plan.name}`,
        preview: `অনুমোদন দিলে “${plan.name}” ক্যাম্পেইনটি Meta-তে PAUSED করা হবে (Meta Campaign ID: ${plan.externalCampaignId})। Meta নিশ্চিত না করলে প্রস্তাবটি ব্যর্থ হিসেবে রেকর্ড হবে এবং কোনো local status বদলাবে না। এখনো কিছুই করা হয়নি।`,
        payload: { planId: plan.id, planName: plan.name, externalCampaignId: plan.externalCampaignId },
      };
    }
    if (dto.type === "pause_ad_set") {
      if (!dto.adSetId) throw new BadRequestException("adSetId is required for pause_ad_set");
      const adSet = await this.p().campaignAdSet.findFirst({ where: { id: dto.adSetId } });
      if (!adSet) throw new NotFoundException("Ad set not found");
      const plan = await this.p().campaignPlan.findFirst({ where: { id: adSet.planId, organizationId: orgId } });
      if (!plan) throw new NotFoundException("Ad set not found in this organization");
      if (plan.status !== "published") throw new BadRequestException("শুধুমাত্র published প্ল্যানের ad set pause করা যায়।");
      if (!adSet.externalAdSetId) throw new BadRequestException("এই ad set-এর কোনো Meta ad set ID নেই — pause করার মতো কিছু নেই।");
      return {
        type: "pause_ad_set",
        title: `Ad Set Pause: ${adSet.name ?? adSet.id}`,
        preview: `অনুমোদন দিলে “${plan.name}” প্ল্যানের “${adSet.name ?? adSet.id}” ad set-টি Meta-তে PAUSED করা হবে (Meta Ad Set ID: ${adSet.externalAdSetId})। Meta নিশ্চিত না করলে প্রস্তাবটি ব্যর্থ হিসেবে রেকর্ড হবে। এখনো কিছুই করা হয়নি।`,
        payload: { planId: plan.id, planName: plan.name, adSetId: adSet.id, adSetName: adSet.name ?? null, externalAdSetId: adSet.externalAdSetId },
      };
    }
    // create_broadcast_draft
    const channel = dto.channel ?? "";
    if (!["email", "sms", "whatsapp"].includes(channel)) throw new BadRequestException("channel must be email, sms or whatsapp");
    if (!dto.name?.trim()) throw new BadRequestException("Broadcast draft-এর একটি নাম দরকার");
    const audienceType = dto.audienceType ?? "customers";
    if (!["customers", "leads_stage", "segment"].includes(audienceType)) throw new BadRequestException("audienceType must be customers, leads_stage or segment");
    if (channel === "whatsapp") {
      if (!dto.whatsappTemplateId) throw new BadRequestException("WhatsApp draft-এর জন্য একটি registered template দরকার (whatsappTemplateId)");
      const tpl = await this.p().whatsAppTemplate.findFirst({ where: { id: dto.whatsappTemplateId, organizationId: orgId } });
      if (!tpl) throw new NotFoundException("WhatsApp template not found in this organization");
    } else {
      if (!dto.body?.trim()) throw new BadRequestException("Broadcast body is required");
      if (channel === "email" && !dto.subject?.trim()) throw new BadRequestException("Email broadcasts need a subject");
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
    const targetKey = built.payload.planId ?? built.payload.adSetId ?? built.payload.broadcast?.name;
    const existing = (open as any[]).find((r) => (r.payload?.planId ?? r.payload?.adSetId ?? r.payload?.broadcast?.name) === targetKey && r.type === built.type);
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
    if (!row) throw new NotFoundException("Proposal not found");
    return row;
  }

  /** Approve = the explicit human decision. Executes via confirmed paths. */
  async approve(orgId: string, actorId: string, proposalId: string) {
    const row = await this.getOrThrow(orgId, proposalId);
    if (row.status !== "proposed") throw new BadRequestException(`This proposal was already decided (status: ${row.status})`);
    const claim = await this.p().aIActionProposal.updateMany({
      where: { id: proposalId, organizationId: orgId, status: "proposed" },
      data: { status: "approved", decidedById: actorId, decidedAt: new Date() },
    });
    if (!claim?.count) throw new BadRequestException("This proposal was already decided");
    await this.audit.log({ organizationId: orgId, userId: actorId, action: "ai.proposal_approved", entityType: "AIActionProposal", entityId: proposalId, metadata: { type: row.type } });
    try {
      const result = await this.execute(orgId, actorId, row);
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
    if (row.type === "pause_campaign") {
      if (!this.campaigns) throw new Error("CampaignsService is not available in this context");
      const plan: any = await this.campaigns.setMetaStatus(orgId, actorId, payload.planId, "PAUSED");
      return { planId: payload.planId, metaStatus: plan?.metaStatus ?? "PAUSED", confirmedBy: "meta" };
    }
    if (row.type === "pause_ad_set") {
      if (!this.campaigns) throw new Error("CampaignsService is not available in this context");
      const res: any = await this.campaigns.setAdSetStatus(orgId, actorId, payload.planId, payload.adSetId, "PAUSED");
      return { adSetId: res?.adSetId ?? payload.adSetId, target: res?.target ?? "PAUSED", confirmedBy: "meta" };
    }
    if (row.type === "create_broadcast_draft") {
      if (!this.messaging) throw new Error("MessagingService is not available in this context");
      const created: any = await this.messaging.createBroadcast(orgId, actorId, payload.broadcast);
      if (created?.variants) return { broadcastIds: created.variants.map((v: any) => v.id), status: "draft" };
      if (!created?.id) throw new Error("Broadcast service returned no draft");
      if (created.status !== "draft") throw new Error(`Broadcast was created with unexpected status "${created.status}" — not counted as a draft success`);
      return { broadcastId: created.id, status: created.status };
    }
    throw new Error(`Unknown proposal type: ${row.type}`);
  }

  async reject(orgId: string, actorId: string, proposalId: string) {
    const row = await this.getOrThrow(orgId, proposalId);
    if (row.status !== "proposed") throw new BadRequestException(`This proposal was already decided (status: ${row.status})`);
    const claim = await this.p().aIActionProposal.updateMany({
      where: { id: proposalId, organizationId: orgId, status: "proposed" },
      data: { status: "rejected", decidedById: actorId, decidedAt: new Date() },
    });
    if (!claim?.count) throw new BadRequestException("This proposal was already decided");
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
    if (!PAUSE_WORDS.some((w) => text.includes(w))) return null;
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
    return this.propose(orgId, userId,
      hit.kind === "plan" ? { type: "pause_campaign", planId: hit.id } : { type: "pause_ad_set", adSetId: hit.id },
      conversationId);
  }
}
