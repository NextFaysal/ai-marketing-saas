import { normalizeTags } from "../inbox/inbox.service";
import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { parseMoneyToMinor } from "@repo/contracts";
import { EventsService } from "../common/events.service";

export const LEAD_STAGES = ["new", "contacted", "qualified", "proposal", "won", "lost"] as const;
export const LEAD_SOURCES = ["manual", "whatsapp", "messenger", "woocommerce", "website"] as const;

@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly events?: EventsService) {}

  private async log(leadId: string, userId: string | null, type: string, content: string) {
    await (this.prisma as any).leadActivity.create({ data: { leadId, userId, type, content } });
  }

  private toPublic(lead: any) {
    return { ...lead, valueMinor: lead.valueMinor != null ? String(lead.valueMinor) : null };
  }

  async create(organizationId: string, actorId: string, dto: {
    name: string; phone?: string; email?: string; source?: string; stage?: string;
    value?: string; currency?: string; notes?: string; nextFollowUpAt?: string;
  }) {
    if (dto.source && !(LEAD_SOURCES as readonly string[]).includes(dto.source)) throw new BadRequestException("Invalid source");
    if (dto.stage && !(LEAD_STAGES as readonly string[]).includes(dto.stage)) throw new BadRequestException("Invalid stage");
    const lead = await (this.prisma as any).lead.create({
      data: {
        organizationId, name: dto.name, phone: dto.phone ?? null, email: dto.email?.toLowerCase() ?? null,
        source: dto.source ?? "manual", stage: dto.stage ?? "new",
        valueMinor: dto.value !== undefined ? parseMoneyToMinor(dto.value) : null,
        currency: dto.currency ?? "BDT", notes: dto.notes ?? null, ownerUserId: actorId,
        nextFollowUpAt: dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : null,
      },
    });
    await this.log(lead.id, actorId, "created", `Lead created (source: ${lead.source})`);
    this.events?.emit("lead.created", {
      organizationId,
      context: { leadId: lead.id, name: lead.name, email: lead.email, phone: lead.phone, stage: lead.stage, source: lead.source },
    });
    return this.toPublic(lead);
  }

  async list(organizationId: string, filters: { stage?: string; source?: string; search?: string } = {}) {
    const items = await (this.prisma as any).lead.findMany({
      where: {
        organizationId,
        ...(filters.stage ? { stage: filters.stage } : {}),
        ...(filters.source ? { source: filters.source } : {}),
        ...(filters.search ? { OR: [
          { name: { contains: filters.search, mode: "insensitive" } },
          { phone: { contains: filters.search } },
          { email: { contains: filters.search, mode: "insensitive" } },
        ] } : {}),
      },
      orderBy: { updatedAt: "desc" }, take: 200,
    });
    // Merged leads disappear from the pipeline (their history lives on
    // the surviving lead).
    return items.filter((l: any) => !l.mergedIntoId).map((l: any) => this.toPublic(l));
  }

  /** Groups of unmerged leads sharing a phone number (last 10 digits). */
  async duplicates(organizationId: string) {
    const all = await (this.prisma as any).lead.findMany({ where: { organizationId }, take: 500 });
    const groups = new Map<string, any[]>();
    for (const lead of all) {
      if (lead.mergedIntoId || !lead.phone) continue;
      const key = String(lead.phone).replace(/\D/g, "").slice(-10);
      if (key.length < 6) continue;
      const list = groups.get(key) ?? [];
      list.push(lead);
      groups.set(key, list);
    }
    return [...groups.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([key, list]) => ({
        phoneKey: key,
        leads: list.map((l: any) => ({ id: l.id, name: l.name, phone: l.phone, stage: l.stage, source: l.source, createdAt: l.createdAt })),
      }));
  }

  /**
   * Merge a duplicate lead INTO the target lead: activities and
   * conversations move, tags union, the source is marked merged (never
   * deleted - its history stays auditable through the target).
   */
  async merge(organizationId: string, actorId: string, targetId: string, sourceId: string) {
    if (targetId === sourceId) throw new BadRequestException("Cannot merge a lead into itself");
    const target = await this.getOrThrow(organizationId, targetId);
    const source = await this.getOrThrow(organizationId, sourceId);
    if (source.mergedIntoId) throw new BadRequestException("Source lead is already merged");
    if (target.mergedIntoId) throw new BadRequestException("Target lead is itself merged into another lead");

    const activities = await (this.prisma as any).leadActivity.findMany({ where: { leadId: sourceId }, take: 500 });
    for (const a of activities) {
      await (this.prisma as any).leadActivity.update({ where: { id: a.id }, data: { leadId: targetId } });
    }
    const convs = await (this.prisma as any).channelConversation.findMany({ where: { leadId: sourceId }, take: 200 });
    for (const c of convs) {
      await (this.prisma as any).channelConversation.update({ where: { id: c.id }, data: { leadId: targetId } });
    }
    const mergedTags = normalizeTags([...(target.tags ?? []), ...(source.tags ?? [])]);
    await (this.prisma as any).lead.update({ where: { id: targetId }, data: { tags: mergedTags } });
    await (this.prisma as any).lead.update({ where: { id: sourceId }, data: { mergedIntoId: targetId } });
    await this.log(targetId, actorId, "merged", `Duplicate lead "${source.name}" (${sourceId}) merged into this lead: ${activities.length} activities, ${convs.length} conversations moved.`);
    // The merge is recorded as a lead activity above (this service has
    // no audit dependency; the activity + mergedIntoId are the record).
    return this.getOne(organizationId, targetId);
  }

  private async getOrThrow(organizationId: string, leadId: string) {
    const lead = await (this.prisma as any).lead.findFirst({ where: { id: leadId, organizationId } });
    if (!lead) throw new NotFoundException("Lead not found in this organization");
    return lead;
  }

  async getOne(organizationId: string, leadId: string) {
    const lead = await this.getOrThrow(organizationId, leadId);
    const activities = await (this.prisma as any).leadActivity.findMany({
      where: { leadId }, orderBy: { createdAt: "desc" }, take: 50,
    });
    return { ...this.toPublic(lead), activities };
  }

  async update(organizationId: string, actorId: string, leadId: string, dto: {
    name?: string; phone?: string; email?: string; stage?: string; value?: string | null;
    notes?: string; ownerUserId?: string | null; nextFollowUpAt?: string | null; tags?: string[];
  }) {
    const lead = await this.getOrThrow(organizationId, leadId);
    if (dto.stage && !(LEAD_STAGES as readonly string[]).includes(dto.stage)) throw new BadRequestException("Invalid stage");
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email?.toLowerCase();
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.ownerUserId !== undefined) data.ownerUserId = dto.ownerUserId;
    if (dto.value !== undefined) data.valueMinor = dto.value === null ? null : parseMoneyToMinor(dto.value);
    if (dto.tags !== undefined) data.tags = normalizeTags(dto.tags);
    if (dto.nextFollowUpAt !== undefined) data.nextFollowUpAt = dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : null;
    const fromStage = lead.stage;
    const stageChanged = dto.stage && dto.stage !== fromStage;
    if (dto.stage) { data.stage = dto.stage; data.lastContactedAt = new Date(); }
    const updated = await (this.prisma as any).lead.update({ where: { id: leadId }, data });
    if (stageChanged) {
      await this.log(leadId, actorId, "stage_change", `Stage: ${fromStage} -> ${dto.stage}`);
      this.events?.emit("lead.stage_changed", {
        organizationId,
        context: { leadId, name: updated.name, email: updated.email, phone: updated.phone, stage: dto.stage, previousStage: fromStage },
      });
    }
    return this.toPublic(updated);
  }

  async addNote(organizationId: string, actorId: string, leadId: string, content: string) {
    await this.getOrThrow(organizationId, leadId);
    await this.log(leadId, actorId, "note", content.slice(0, 2000));
    await (this.prisma as any).lead.update({ where: { id: leadId }, data: { lastContactedAt: new Date() } });
    return this.getOne(organizationId, leadId);
  }

  async pipeline(organizationId: string) {
    const leads = await (this.prisma as any).lead.findMany({ where: { organizationId }, select: { stage: true, valueMinor: true } });
    const byStage: Record<string, { count: number; valueMinor: string }> = {};
    for (const stage of LEAD_STAGES) byStage[stage] = { count: 0, valueMinor: "0" };
    let totalValue = 0n;
    for (const lead of leads) {
      const bucket = byStage[lead.stage] ?? (byStage[lead.stage] = { count: 0, valueMinor: "0" });
      bucket.count++;
      const value = lead.valueMinor != null ? BigInt(lead.valueMinor) : 0n;
      bucket.valueMinor = String(BigInt(bucket.valueMinor) + value);
      if (lead.stage !== "lost") totalValue += value;
    }
    return { byStage, totalLeads: leads.length, openPipelineValueMinor: String(totalValue) };
  }

  async convertToCustomer(organizationId: string, actorId: string, leadId: string) {
    const lead = await this.getOrThrow(organizationId, leadId);
    if (lead.customerId) {
      const existing = await (this.prisma as any).customer.findUnique({ where: { id: lead.customerId } });
      return { lead: this.toPublic(lead), customer: existing, alreadyConverted: true };
    }
    let customer = null;
    if (lead.email) customer = await (this.prisma as any).customer.findFirst({ where: { organizationId, email: lead.email } });
    if (!customer && lead.phone) customer = await (this.prisma as any).customer.findFirst({ where: { organizationId, phone: lead.phone } });
    if (!customer) {
      const [firstName, ...rest] = String(lead.name).trim().split(/\s+/);
      customer = await (this.prisma as any).customer.create({
        data: { organizationId, source: "lead", firstName, lastName: rest.join(" ") || null, email: lead.email ?? null, phone: lead.phone ?? null },
      });
    }
    const updated = await (this.prisma as any).lead.update({ where: { id: leadId }, data: { customerId: customer.id } });
    await this.log(leadId, actorId, "converted", `Converted to customer ${customer.id}`);
    return { lead: this.toPublic(updated), customer, alreadyConverted: false };
  }

  async delete(organizationId: string, leadId: string) {
    await this.getOrThrow(organizationId, leadId);
    await (this.prisma as any).lead.delete({ where: { id: leadId } });
    return { deleted: true };
  }
}
