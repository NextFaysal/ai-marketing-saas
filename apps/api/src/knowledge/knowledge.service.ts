import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreatePolicyDto, UpdatePolicyDto, CreateKnowledgeDocDto, UpdateKnowledgeDocDto, IngestKnowledgeFileDto } from "./knowledge.dto";
import { baseTitleFromFilename, chunkKnowledgeText, extractKnowledgeText } from "./extract";
import { KnowledgeIndexingService } from "../ai/knowledge-indexing.service";
import { badRequest, notFound } from "../i18n/api-exception";

/**
 * SA-B1 (Smart AI Phase 0, P3): the visibility a new knowledge
 * document gets. An explicit value always wins (the DTOs validate
 * the closed set public|internal, anything else is a 400 before it
 * reaches here). When omitted, kind "note" defaults to "internal" —
 * notes are the owner's working material, not customer copy — and
 * every other kind defaults to "public", the schema default and
 * the behaviour documents had before this field existed.
 */
export function resolveKnowledgeVisibility(kind: string | undefined, visibility: string | undefined): string {
  if (visibility === "public" || visibility === "internal") return visibility;
  return kind === "note" ? "internal" : "public";
}

@Injectable()
export class KnowledgeService {
  private indexingFallback?: KnowledgeIndexingService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly indexing?: KnowledgeIndexingService,
  ) {}

  /**
   * SA-B2 (P2): embedding indexing runs FIRE-AND-FORGET behind
   * every document mutation — an embeddings outage must never
   * fail or block a save (the indexing service itself never
   * throws; the knowledge_index_sweep reconciles any miss).
   * Specs that construct this service positionally get the lazy
   * same-prisma fallback, the SA-B1 brainSvc() pattern.
   */
  private indexingSvc(): KnowledgeIndexingService {
    return this.indexing ?? (this.indexingFallback ??= new KnowledgeIndexingService(this.prisma as any));
  }

  private indexDoc(doc: any): void {
    void this.indexingSvc().indexDocument(doc).catch(() => undefined);
  }

  private unindexDoc(organizationId: string, docId: string): void {
    void this.indexingSvc().removeDocument(organizationId, docId).catch(() => undefined);
  }

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
    if (!existing) throw notFound("knowledge.policyNotFoundInThisOrganization");
    const updated = await (this.prisma as any).businessPolicy.update({ where: { id: policyId }, data: dto });
    await this.audit.log({ organizationId, userId: actorId, action: "policy.update", entityType: "BusinessPolicy", entityId: policyId });
    return updated;
  }
  async deletePolicy(organizationId: string, actorId: string, policyId: string) {
    const existing = await (this.prisma as any).businessPolicy.findFirst({ where: { id: policyId, organizationId } });
    if (!existing) throw notFound("knowledge.policyNotFoundInThisOrganization");
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
    const kind = dto.kind ?? "faq";
    const doc = await (this.prisma as any).knowledgeDocument.create({
      data: { organizationId, kind, title: dto.title, content: dto.content, visibility: resolveKnowledgeVisibility(kind, dto.visibility) },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "knowledge.create", entityType: "KnowledgeDocument", entityId: doc.id });
    this.indexDoc(doc);
    return doc;
  }
  /**
   * SA-B1 (P3): partial update of a knowledge document — this route
   * did not exist before (documents could only be created and
   * deleted); it exists now so the owner can reclassify a document's
   * visibility without recreating it. Visibility changes ONLY when
   * explicitly provided (no kind-based defaulting on update).
   */
  async updateDoc(organizationId: string, actorId: string, docId: string, dto: UpdateKnowledgeDocDto) {
    const existing = await (this.prisma as any).knowledgeDocument.findFirst({ where: { id: docId, organizationId } });
    if (!existing) throw notFound("knowledge.documentNotFoundInThisOrganization");
    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.content !== undefined) data.content = dto.content;
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.visibility !== undefined) data.visibility = dto.visibility;
    const updated = await (this.prisma as any).knowledgeDocument.update({ where: { id: docId }, data });
    await this.audit.log({ organizationId, userId: actorId, action: "knowledge.update", entityType: "KnowledgeDocument", entityId: docId });
    this.indexDoc(updated);
    return updated;
  }
  /**
   * CX9: ingest an uploaded file (.pdf/.docx/.txt/.md) as knowledge.
   * Extraction + chunking fully validate BEFORE any document row is
   * created, so a rejected file saves nothing (all-or-nothing). One
   * KnowledgeDocument per chunk (kind "note" — file content is
   * reference material, not a single Q/A pair), one audit entry for
   * the whole upload.
   */
  async uploadDocFile(
    organizationId: string,
    actorId: string,
    file: { originalname?: string; buffer?: Buffer } | undefined,
  ) {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw badRequest("knowledge.noFileWasFound");
    }
    const filename = file.originalname ?? "file";
    const text = await extractKnowledgeText(filename, file.buffer);
    const chunks = chunkKnowledgeText(text);
    if (!chunks.length) throw badRequest("knowledge.noTextWasFoundInThe");
    const baseTitle = baseTitleFromFilename(filename);
    const total = chunks.length;
    const created: any[] = [];
    for (let i = 0; i < total; i++) {
      const title = total > 1 ? `${baseTitle} (অংশ ${i + 1})` : baseTitle;
      const doc = await (this.prisma as any).knowledgeDocument.create({
        // SA-B1 (P3): uploads are kind "note" with no explicit
        // visibility, so the service rule makes them internal —
        // uploaded reference material is not customer copy until
        // the owner reclassifies it.
        data: { organizationId, kind: "note", title, content: chunks[i], source: `file:${filename}`, visibility: resolveKnowledgeVisibility("note", undefined) },
      });
      created.push(doc);
      this.indexDoc(doc);
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "knowledge.upload",
      entityType: "KnowledgeDocument", entityId: created[0].id,
      metadata: { filename, chunks: total, chars: text.length },
    });
    return { documentsCreated: total, charsExtracted: text.length, title: baseTitle };
  }
  async deleteDoc(organizationId: string, actorId: string, docId: string) {
    const existing = await (this.prisma as any).knowledgeDocument.findFirst({ where: { id: docId, organizationId } });
    if (!existing) throw notFound("knowledge.documentNotFoundInThisOrganization");
    await (this.prisma as any).knowledgeDocument.delete({ where: { id: docId } });
    await this.audit.log({ organizationId, userId: actorId, action: "knowledge.delete", entityType: "KnowledgeDocument", entityId: docId });
    this.unindexDoc(organizationId, docId);
    return { deleted: true };
  }

  /**
   * CX9: Knowledge Base — File Ingestion.
   * Extracts text from uploaded files (TXT, Markdown, CSV, PDF, JSON),
   * splits long documents into manageable chunks (max ~1500 chars),
   * and saves each chunk as a KnowledgeDocument with sourceFile & chunkIndex.
   */
  async ingestFile(organizationId: string, actorId: string, dto: IngestKnowledgeFileDto) {
    if (!dto.dataBase64) throw badRequest("knowledge.fileDataBase64IsRequired");
    const buffer = Buffer.from(dto.dataBase64, "base64");
    if (buffer.length === 0) throw badRequest("knowledge.anEmptyFileCannotBeUploaded");
    if (buffer.length > 10 * 1024 * 1024) throw badRequest("knowledge.theFileSizeCanBeAt");

    const text = this.extractTextFromFile(dto.filename, buffer);
    if (!text || text.trim().length < 5) {
      throw badRequest("knowledge.noReadableInformationWasFoundInside");
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
          // SA-B1 (P3): same visibility rule as every other path.
          visibility: resolveKnowledgeVisibility(kind, dto.visibility),
          sourceFile: dto.filename,
          chunkIndex: i,
          totalChunks: total,
        },
      });
      created.push(doc);
      this.indexDoc(doc);
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
