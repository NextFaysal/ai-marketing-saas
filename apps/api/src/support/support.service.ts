import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EmailProvider } from "../messaging/email.provider";

/**
 * Milestone 38 (Admin Phase A2): support tickets.
 * Tenants open tickets inside their own workspace; platform
 * admins work the queue from the Admin Console. Admin replies
 * notify the tenant side by email — the notification counts
 * only when the mail provider confirms a send, and a failed
 * notification never fails the reply itself (reported honestly
 * in the response).
 */
const STATUSES = ["open", "pending", "resolved", "closed"] as const;

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async orgName(organizationId: string): Promise<string | null> {
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } }).catch(() => null);
    return org?.name ?? null;
  }

  private async withCounts(tickets: any[]) {
    if (!tickets.length) return [];
    const ids = tickets.map((t) => t.id);
    const messages = await (this.prisma as any).supportTicketMessage.findMany({
      where: { ticketId: { in: ids } },
    }).catch(() => []);
    const counts = new Map<string, number>();
    for (const m of messages as any[]) counts.set(m.ticketId, (counts.get(m.ticketId) ?? 0) + 1);
    return tickets.map((t) => ({ ...t, messageCount: counts.get(t.id) ?? 0 }));
  }

  // ---------------- Tenant side ----------------

  async createTicket(organizationId: string, userId: string, dto: { subject: string; body: string; priority?: string }) {
    const subject = String(dto.subject ?? "").trim();
    const body = String(dto.body ?? "").trim();
    if (subject.length < 3) throw new BadRequestException("Subject is required (min 3 characters)");
    if (body.length < 1) throw new BadRequestException("Message body is required");
    const priority = dto.priority === "high" ? "high" : "normal";
    const ticket = await (this.prisma as any).supportTicket.create({
      data: { organizationId, createdById: userId, subject, priority, status: "open" },
    });
    await (this.prisma as any).supportTicketMessage.create({
      data: { ticketId: ticket.id, authorId: userId, authorKind: "tenant", body },
    });
    return this.getTicket(organizationId, ticket.id);
  }

  async listTickets(organizationId: string) {
    const rows = await (this.prisma as any).supportTicket.findMany({
      where: { organizationId }, orderBy: { lastMessageAt: "desc" }, take: 100,
    });
    return this.withCounts(rows);
  }

  async getTicket(organizationId: string, ticketId: string) {
    const ticket = await (this.prisma as any).supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.organizationId !== organizationId) throw new NotFoundException("Ticket not found");
    const messages = await (this.prisma as any).supportTicketMessage.findMany({
      where: { ticketId }, orderBy: { createdAt: "asc" },
    });
    return { ...ticket, messages };
  }

  async replyAsTenant(organizationId: string, userId: string, ticketId: string, body: string) {
    const ticket = await (this.prisma as any).supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.organizationId !== organizationId) throw new NotFoundException("Ticket not found");
    const text = String(body ?? "").trim();
    if (!text) throw new BadRequestException("Message body is required");
    const message = await (this.prisma as any).supportTicketMessage.create({
      data: { ticketId, authorId: userId, authorKind: "tenant", body: text },
    });
    const reopen = ticket.status === "resolved" || ticket.status === "closed";
    await (this.prisma as any).supportTicket.update({
      where: { id: ticketId },
      data: { lastMessageAt: new Date(), ...(reopen ? { status: "open" } : {}) },
    });
    return message;
  }

  async setTenantStatus(organizationId: string, ticketId: string, status: string) {
    if (status !== "closed" && status !== "open") throw new BadRequestException("Tenants can close or reopen a ticket");
    const ticket = await (this.prisma as any).supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.organizationId !== organizationId) throw new NotFoundException("Ticket not found");
    return (this.prisma as any).supportTicket.update({ where: { id: ticketId }, data: { status } });
  }

  // ---------------- Admin side ----------------

  async listTicketsAdmin(filter?: { status?: string; organizationId?: string }) {
    const where: any = {};
    if (filter?.status) where.status = filter.status;
    if (filter?.organizationId) where.organizationId = filter.organizationId;
    const rows = await (this.prisma as any).supportTicket.findMany({
      where, orderBy: { lastMessageAt: "desc" }, take: 100,
    });
    const withCounts = await this.withCounts(rows);
    const out: any[] = [];
    for (const t of withCounts) {
      out.push({ ...t, organizationName: await this.orgName(t.organizationId) });
    }
    return out;
  }

  async getTicketAdmin(ticketId: string) {
    const ticket = await (this.prisma as any).supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException("Ticket not found");
    const messages = await (this.prisma as any).supportTicketMessage.findMany({
      where: { ticketId }, orderBy: { createdAt: "asc" },
    });
    const creator = await (this.prisma as any).user.findUnique({ where: { id: ticket.createdById } }).catch(() => null);
    return {
      ...ticket, messages,
      organizationName: await this.orgName(ticket.organizationId),
      creatorEmail: creator?.email ?? null,
    };
  }

  async replyAsAdmin(actor: any, ticketId: string, body: string, ip?: string) {
    const ticket = await (this.prisma as any).supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException("Ticket not found");
    const text = String(body ?? "").trim();
    if (!text) throw new BadRequestException("Message body is required");
    const message = await (this.prisma as any).supportTicketMessage.create({
      data: { ticketId, authorId: actor.id, authorKind: "admin", body: text },
    });
    await (this.prisma as any).supportTicket.update({
      where: { id: ticketId },
      data: { lastMessageAt: new Date(), ...(ticket.status === "open" ? { status: "pending" } : {}) },
    });
    await this.audit.log({
      organizationId: ticket.organizationId, userId: actor.id,
      action: "admin.ticket_replied", entityType: "SupportTicket", entityId: ticketId, ipAddress: ip,
    });
    // Notify tenant OWNER/ADMIN members + the ticket creator.
    let emailSent = 0;
    let emailError: string | null = null;
    try {
      const memberships = await (this.prisma as any).membership.findMany({
        where: { organizationId: ticket.organizationId, role: { in: ["OWNER", "ADMIN"] } }, include: { user: true },
      });
      const recipients = new Set<string>();
      for (const m of memberships as any[]) if (m.user?.email) recipients.add(m.user.email);
      const orgName = await this.orgName(ticket.organizationId);
      const email = new EmailProvider();
      for (const to of recipients) {
        await email.send({
          to,
          subject: `Support: ${ticket.subject}`,
          text: `আপনার Support Ticket "${ticket.subject}" (${orgName ?? ""}) এ প্ল্যাটফর্ম টিম উত্তর দিয়েছে:\n\n${text}\n\n— Ticket টি আপনার ওয়ার্কস্পেসের Support পেজে দেখুন।`,
        });
        emailSent++;
      }
    } catch (e) {
      emailError = e instanceof Error ? e.message : "email failed";
    }
    return { message, emailSent, emailError };
  }

  async updateAsAdmin(actor: any, ticketId: string, dto: { status?: string; assignedToId?: string | null; priority?: string }, ip?: string) {
    const ticket = await (this.prisma as any).supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException("Ticket not found");
    const data: Record<string, unknown> = {};
    if (dto.status !== undefined) {
      if (!(STATUSES as readonly string[]).includes(dto.status)) throw new BadRequestException(`status must be one of ${STATUSES.join(", ")}`);
      data.status = dto.status;
    }
    if (dto.assignedToId !== undefined) data.assignedToId = dto.assignedToId;
    if (dto.priority !== undefined) {
      if (dto.priority !== "normal" && dto.priority !== "high") throw new BadRequestException("priority must be normal | high");
      data.priority = dto.priority;
    }
    const updated = await (this.prisma as any).supportTicket.update({ where: { id: ticketId }, data });
    await this.audit.log({
      organizationId: ticket.organizationId, userId: actor.id,
      action: "admin.ticket_updated", entityType: "SupportTicket", entityId: ticketId,
      metadata: { changes: data }, ipAddress: ip,
    });
    return updated;
  }
}
