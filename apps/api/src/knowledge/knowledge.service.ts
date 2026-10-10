import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreatePolicyDto, UpdatePolicyDto, CreateKnowledgeDocDto } from "./knowledge.dto";

@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async listPolicies(organizationId: string) {
    return (this.prisma as any).businessPolicy.findMany({ where: { organizationId }, orderBy: [{ type: "asc" }, { createdAt: "asc" }] });
  }
  async createPolicy(organizationId: string, actorId: string, dto: CreatePolicyDto) {
    const policy = await (this.prisma as any).businessPolicy.create({ data: { organizationId, ...dto } });
    await this.audit.log({ organizationId, userId: actorId, action: "policy.create", entityType: "BusinessPolicy", entityId: policy.id });
    return policy;
  }
  async updatePolicy(organizationId: string, actorId: string, policyId: string, dto: UpdatePolicyDto) {
    const existing = await (this.prisma as any).businessPolicy.findFirst({ where: { id: policyId, organizationId } });
    if (!existing) throw new NotFoundException("Policy not found in this organization");
    const updated = await (this.prisma as any).businessPolicy.update({ where: { id: policyId }, data: dto });
    await this.audit.log({ organizationId, userId: actorId, action: "policy.update", entityType: "BusinessPolicy", entityId: policyId });
    return updated;
  }
  async deletePolicy(organizationId: string, actorId: string, policyId: string) {
    const existing = await (this.prisma as any).businessPolicy.findFirst({ where: { id: policyId, organizationId } });
    if (!existing) throw new NotFoundException("Policy not found in this organization");
    await (this.prisma as any).businessPolicy.delete({ where: { id: policyId } });
    await this.audit.log({ organizationId, userId: actorId, action: "policy.delete", entityType: "BusinessPolicy", entityId: policyId });
    return { deleted: true };
  }

  async listDocs(organizationId: string, kind?: string) {
    return (this.prisma as any).knowledgeDocument.findMany({
      where: { organizationId, ...(kind ? { kind } : {}) }, orderBy: { createdAt: "desc" },
    });
  }
  async createDoc(organizationId: string, actorId: string, dto: CreateKnowledgeDocDto) {
    const doc = await (this.prisma as any).knowledgeDocument.create({ data: { organizationId, kind: dto.kind ?? "faq", title: dto.title, content: dto.content } });
    await this.audit.log({ organizationId, userId: actorId, action: "knowledge.create", entityType: "KnowledgeDocument", entityId: doc.id });
    return doc;
  }
  async deleteDoc(organizationId: string, actorId: string, docId: string) {
    const existing = await (this.prisma as any).knowledgeDocument.findFirst({ where: { id: docId, organizationId } });
    if (!existing) throw new NotFoundException("Document not found in this organization");
    await (this.prisma as any).knowledgeDocument.delete({ where: { id: docId } });
    await this.audit.log({ organizationId, userId: actorId, action: "knowledge.delete", entityType: "KnowledgeDocument", entityId: docId });
    return { deleted: true };
  }
}
