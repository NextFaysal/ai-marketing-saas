import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreatePolicyDto, UpdatePolicyDto, CreateKnowledgeDocDto, IngestKnowledgeFileDto } from "./knowledge.dto";

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

  /**
   * CX9: Knowledge Base — File Ingestion.
   * Extracts text from uploaded files (TXT, Markdown, CSV, PDF, JSON),
   * splits long documents into manageable chunks (max ~1500 chars),
   * and saves each chunk as a KnowledgeDocument with sourceFile & chunkIndex.
   */
  async ingestFile(organizationId: string, actorId: string, dto: IngestKnowledgeFileDto) {
    if (!dto.dataBase64) throw new BadRequestException("ফাইল ডেটা (base64) প্রয়োজন");
    const buffer = Buffer.from(dto.dataBase64, "base64");
    if (buffer.length === 0) throw new BadRequestException("খালি ফাইল আপলোড করা যাবে না");
    if (buffer.length > 10 * 1024 * 1024) throw new BadRequestException("ফাইলের সাইজ সর্বোচ্চ 10MB হতে পারে");

    const text = this.extractTextFromFile(dto.filename, buffer);
    if (!text || text.trim().length < 5) {
      throw new BadRequestException("ফাইলের ভেতর কোনো পাঠযোগ্য তথ্য পাওয়া যায়নি");
    }

    const chunks = this.chunkText(text.trim(), 1500);
    const baseName = dto.filename.replace(/\.[^/.]+$/, "");
    const kind = dto.kind ?? "file_doc";
    const total = chunks.length;

    const created: any[] = [];
    for (let i = 0; i < total; i++) {
      const title = total > 1 ? `${baseName} (অংশ ${i + 1}/${total})` : baseName;
      const doc = await (this.prisma as any).knowledgeDocument.create({
        data: {
          organizationId,
          title,
          content: chunks[i],
          kind,
          sourceFile: dto.filename,
          chunkIndex: i,
          totalChunks: total,
        },
      });
      created.push(doc);
    }

    await this.audit.log({
      organizationId,
      userId: actorId,
      action: "knowledge.file_ingest",
      entityType: "KnowledgeDocument",
      entityId: created[0]?.id ?? "bulk",
      metadata: {
        filename: dto.filename,
        totalChunks: total,
        charCount: text.length,
        bytes: buffer.length,
      },
    });

    return {
      success: true,
      filename: dto.filename,
      totalChunks: total,
      charCount: text.length,
      documents: created,
    };
  }

  private extractTextFromFile(filename: string, buffer: Buffer): string {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    if (["txt", "md", "markdown", "csv", "json", "html", "htm"].includes(ext)) {
      let content = buffer.toString("utf-8");
      if (ext === "html" || ext === "htm") {
        content = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ");
      }
      return content;
    }

    if (ext === "pdf") {
      const raw = buffer.toString("latin1");
      const textBlocks: string[] = [];
      const btBlocks = raw.match(/BT[\s\S]*?ET/g) ?? [];
      for (const block of btBlocks) {
        const tjMatches = block.match(/\((.*?)\)\s*Tj/g);
        if (tjMatches) {
          for (const m of tjMatches) {
            const inner = m.replace(/^\(/, "").replace(/\)\s*Tj$/, "");
            textBlocks.push(inner);
          }
        }
        const tjArrayMatches = block.match(/\[(.*?)\]\s*TJ/g);
        if (tjArrayMatches) {
          for (const m of tjArrayMatches) {
            const strings = m.match(/\((.*?)\)/g);
            if (strings) {
              for (const s of strings) {
                textBlocks.push(s.slice(1, -1));
              }
            }
          }
        }
      }
      if (textBlocks.length > 0) {
        return textBlocks.join(" ").replace(/\\([()\\])/g, "$1");
      }
      return raw.replace(/[^\x20-\x7E\u0980-\u09FF\n\r\t]/g, " ");
    }

    return buffer.toString("utf-8");
  }

  private chunkText(text: string, maxChunkLength: number = 1500): string[] {
    const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    if (normalized.length <= maxChunkLength) return [normalized];

    const paragraphs = normalized.split("\n\n");
    const chunks: string[] = [];
    let current = "";

    for (const p of paragraphs) {
      const trimmed = p.trim();
      if (!trimmed) continue;
      if (current.length + trimmed.length + 2 <= maxChunkLength) {
        current = current ? `${current}\n\n${trimmed}` : trimmed;
      } else {
        if (current) chunks.push(current);
        if (trimmed.length > maxChunkLength) {
          const sentences = trimmed.split(/(?<=[।.\n!?])/);
          let subChunk = "";
          for (const s of sentences) {
            if (subChunk.length + s.length <= maxChunkLength) {
              subChunk += s;
            } else {
              if (subChunk) chunks.push(subChunk.trim());
              subChunk = s;
            }
          }
          current = subChunk.trim();
        } else {
          current = trimmed;
        }
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.length > 0 ? chunks : [normalized.slice(0, maxChunkLength)];
  }
}
