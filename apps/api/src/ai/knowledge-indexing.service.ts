import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { EmbeddingsService } from "./embeddings.service";
import { PgVectorStore } from "./pgvector-store";
import { splitForEmbedding } from "./brain-chunking";
import { VECTOR_STORE, type VectorStore } from "./vector-store";

/**
 * SA-B2 (Smart AI Phase 0, P2): the indexing pipeline behind
 * hybrid retrieval. It owns turning stored content into
 * KnowledgeEmbedding rows — and keeping them honest:
 *
 *  - Content-hash skip: a chunk whose text (and the provider/
 *    model that embedded it, and its visibility snapshot) is
 *    unchanged is NEVER re-embedded — re-indexing an unchanged
 *    document inserts 0 rows. A changed chunk re-embeds alone;
 *    chunks that vanished are deleted.
 *  - The document CRUD paths call this fire-and-forget: an
 *    embeddings outage can never fail or block a save. Every
 *    method here is self-guarding and returns a status instead
 *    of throwing; failures are logged (never silent) and the
 *    knowledge_index_sweep backfill reconciles anything missed.
 *  - No status column was added to KnowledgeDocument: the model
 *    carries no processing-state fields today, so index state is
 *    the embedding rows themselves (present = indexed), exactly
 *    as the batch brief's fallback prescribes.
 *  - Products index name/description/category text ONLY — never
 *    price or stock (those facts are always read live, L4) — and
 *    only ACTIVE products. Product text is public catalog copy,
 *    so its visibility snapshot is always "public".
 *  - SA-B4 (P5a) coverage record: product embed text = name,
 *    nameEn, legacy category string, structured Category name,
 *    Brand name, ProductTag names, variant names + scalar
 *    attribute values, description, descriptionEn,
 *    seoDescription. Deliberately excluded (live-read or
 *    non-semantic): every price/stock field on product and
 *    variant, SKUs, wholesale tiers, bump fields.
 */

export interface IndexResult {
  status: "indexed" | "unavailable" | "failed" | "skipped";
  reason?: string;
  chunks?: number;
  inserted?: number;
  deleted?: number;
  skippedChunks?: number;
}

const KNOWLEDGE_SOURCE = "knowledge_chunk";
const PRODUCT_SOURCE = "product";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

@Injectable()
export class KnowledgeIndexingService {
  private readonly logger = new Logger(KnowledgeIndexingService.name);
  private embeddingsFallback?: EmbeddingsService;
  private storeFallback?: PgVectorStore;

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly embeddings?: EmbeddingsService,
    @Optional() @Inject(VECTOR_STORE) private readonly store?: VectorStore,
  ) {}

  private emb(): EmbeddingsService {
    return this.embeddings ?? (this.embeddingsFallback ??= new EmbeddingsService(this.prisma as any));
  }

  private vectors(): VectorStore {
    return this.store ?? (this.storeFallback ??= new PgVectorStore(this.prisma as any));
  }

  /** Index (or refresh) one knowledge document. Never throws. */
  async indexDocument(doc: {
    id?: string;
    organizationId?: string;
    title?: string | null;
    content?: string | null;
    visibility?: string | null;
  }): Promise<IndexResult> {
    const organizationId = String(doc?.organizationId ?? "");
    const sourceId = String(doc?.id ?? "");
    if (!organizationId || !sourceId) return { status: "skipped", reason: "missing_identity" };
    try {
      const title = String(doc?.title ?? "").trim();
      const chunks = await splitForEmbedding(String(doc?.content ?? ""));
      const visibility = doc?.visibility === "internal" ? "internal" : "public";
      // The embedded text leads with the title (retrieval matches
      // how people refer to the document); the STORED content is
      // the bare chunk, which is what a match quotes.
      const embedTexts = chunks.map((c) => (title ? `${title}\n\n${c}` : c));
      return await this.reindex(organizationId, KNOWLEDGE_SOURCE, sourceId, chunks, embedTexts, visibility);
    } catch (e) {
      return this.failed("knowledge document", organizationId, sourceId, e);
    }
  }

  /** Index (or refresh) one product's public text. Never throws. */
  async indexProduct(product: {
    id?: string;
    organizationId?: string;
    name?: string | null;
    nameEn?: string | null;
    category?: string | null;
    description?: string | null;
    descriptionEn?: string | null;
    seoDescription?: string | null;
    categoryId?: string | null;
    brandId?: string | null;
    status?: string | null;
    // Optional pre-loaded relations (callers that already hold
    // them may pass them; otherwise they are read from Prisma).
    categoryRef?: { name?: string | null } | null;
    brand?: { name?: string | null } | null;
    tagAssignments?: { tag?: { name?: string | null } | null }[] | null;
    variants?: { name?: string | null; attributes?: unknown }[] | null;
  }): Promise<IndexResult> {
    const organizationId = String(product?.organizationId ?? "");
    const sourceId = String(product?.id ?? "");
    if (!organizationId || !sourceId) return { status: "skipped", reason: "missing_identity" };
    try {
      if (product?.status && product.status !== "ACTIVE") {
        // Not sellable ⇒ not retrievable: drop any stored rows.
        await this.vectors().deleteBySource(organizationId, PRODUCT_SOURCE, sourceId);
        return { status: "skipped", reason: "product_not_active" };
      }
      // SA-B4 (P5a): the embed text also carries the RELATIONAL
      // catalog facts SA-B2 could not see — structured category
      // name, brand name, tag names, variant names + attribute
      // values — so the Brain can answer ABOUT the product
      // ("লাল রঙের XL আছে?") semantically. The B2 rule is
      // unchanged and absolute: price / compare-at / bump /
      // wholesale / stock values (product AND variant) are NEVER
      // in this text — those facts are read live at answer time.
      const relationLines = await this.productRelationLines(product, organizationId, sourceId);
      const text = [
        product?.name, product?.nameEn, product?.category,
        ...relationLines,
        product?.description, product?.descriptionEn, product?.seoDescription,
      ]
        .map((v) => String(v ?? "").trim())
        .filter(Boolean)
        .join("\n");
      const chunks = await splitForEmbedding(text);
      return await this.reindex(organizationId, PRODUCT_SOURCE, sourceId, chunks, chunks, "public");
    } catch (e) {
      return this.failed("product", organizationId, sourceId, e);
    }
  }

  /**
   * SA-B4 (P5a): relational catalog lines for the product embed
   * text. Pre-loaded relations on the passed object win; missing
   * ones are read org-scoped from Prisma. A read failure degrades
   * to fewer lines — enrichment must never fail indexing (the
   * knowledge_index_sweep reconciles on the next run). Attribute
   * keys that smell like money/stock are skipped by name, and
   * only scalar attribute values are flattened.
   */
  private async productRelationLines(
    product: {
      categoryId?: string | null;
      brandId?: string | null;
      categoryRef?: { name?: string | null } | null;
      brand?: { name?: string | null } | null;
      tagAssignments?: { tag?: { name?: string | null } | null }[] | null;
      variants?: { name?: string | null; attributes?: unknown }[] | null;
    },
    organizationId: string,
    sourceId: string,
  ): Promise<string[]> {
    const lines: string[] = [];
    try {
      const db: any = this.prisma as any;
      let categoryName = product.categoryRef?.name ?? null;
      if (!categoryName && product.categoryId && db?.category?.findFirst) {
        const row = await db.category.findFirst({
          where: { id: product.categoryId, organizationId },
          select: { name: true },
        }).catch(() => null);
        categoryName = row?.name ?? null;
      }
      if (categoryName) lines.push(`Category: ${String(categoryName).trim()}`);

      let brandName = product.brand?.name ?? null;
      if (!brandName && product.brandId && db?.brand?.findFirst) {
        const row = await db.brand.findFirst({
          where: { id: product.brandId, organizationId },
          select: { name: true },
        }).catch(() => null);
        brandName = row?.name ?? null;
      }
      if (brandName) lines.push(`Brand: ${String(brandName).trim()}`);

      let tagNames = (product.tagAssignments ?? [])
        .map((a) => a?.tag?.name)
        .filter((n): n is string => typeof n === "string" && n.trim().length > 0);
      if (!tagNames.length && db?.productTagAssignment?.findMany) {
        const rows = await db.productTagAssignment.findMany({
          where: { productId: sourceId },
          include: { tag: { select: { name: true, organizationId: true } } },
        }).catch(() => []);
        tagNames = (rows ?? [])
          .filter((r: any) => r?.tag?.organizationId === organizationId)
          .map((r: any) => r?.tag?.name)
          .filter((n: unknown): n is string => typeof n === "string" && n.trim().length > 0);
      }
      if (tagNames.length) lines.push(`Tags: ${tagNames.map((t) => t.trim()).join(", ")}`);

      let variants = product.variants ?? null;
      if (!variants && db?.productVariant?.findMany) {
        variants = await db.productVariant.findMany({
          where: { productId: sourceId },
          select: { name: true, attributes: true },
          take: 50,
        }).catch(() => []);
      }
      for (const v of variants ?? []) {
        const parts: string[] = [];
        if (v?.name && String(v.name).trim()) parts.push(String(v.name).trim());
        const attrs = v?.attributes;
        if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
          for (const [key, value] of Object.entries(attrs as Record<string, unknown>)) {
            if (/price|stock|cost|sku/i.test(key)) continue;
            if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
              parts.push(`${key}: ${String(value)}`);
            }
          }
        }
        if (parts.length) lines.push(`Variant: ${parts.join(" · ")}`);
      }
    } catch (e) {
      this.logger.warn(
        `product relation enrichment skipped for org ${organizationId} product ${sourceId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return lines;
  }

  /** Remove every embedding row of one source. Never throws. */
  async removeSource(organizationId: string, sourceType: string, sourceId: string): Promise<void> {
    if (!organizationId || !sourceId) return;
    try {
      await this.vectors().deleteBySource(organizationId, sourceType, sourceId);
    } catch (e) {
      this.logger.error(
        `embedding cleanup failed for org ${organizationId} ${sourceType}/${sourceId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async removeDocument(organizationId: string, docId: string): Promise<void> {
    return this.removeSource(organizationId, KNOWLEDGE_SOURCE, docId);
  }

  async removeProduct(organizationId: string, productId: string): Promise<void> {
    return this.removeSource(organizationId, PRODUCT_SOURCE, productId);
  }

  /**
   * Idempotent backfill for one org (the knowledge_index_sweep
   * job body): every knowledge document + every ACTIVE product,
   * hash-skipped where already current. Per-source failures are
   * collected and returned — visible in the job run result —
   * never swallowed. A kill-switched or provider-less org comes
   * back "unavailable" with the typed reason, and its sources
   * simply stay keyword-only (the honest label OrgBrain reports).
   */
  async backfillOrg(organizationId: string): Promise<{
    organizationId: string;
    status: "done" | "unavailable";
    reason?: string;
    docsIndexed: number;
    docsSkipped: number;
    productsIndexed: number;
    productsSkipped: number;
    failures: { sourceType: string; sourceId: string; reason: string }[];
  }> {
    const out = {
      organizationId, status: "done" as "done" | "unavailable", reason: undefined as string | undefined,
      docsIndexed: 0, docsSkipped: 0, productsIndexed: 0, productsSkipped: 0,
      failures: [] as { sourceType: string; sourceId: string; reason: string }[],
    };
    if (!this.prisma) { out.status = "unavailable"; out.reason = "missing_prisma"; return out; }
    const resolved = await this.emb().resolveConfig(organizationId);
    if (!resolved.ok) { out.status = "unavailable"; out.reason = resolved.reason; return out; }
    const p = this.prisma as any;
    const docs = await p.knowledgeDocument?.findMany?.({ where: { organizationId } }).catch(() => []);
    for (const doc of docs ?? []) {
      const r = await this.indexDocument(doc);
      if (r.status === "indexed") out.docsIndexed++;
      else if (r.status === "failed") out.failures.push({ sourceType: KNOWLEDGE_SOURCE, sourceId: String(doc.id), reason: r.reason ?? "failed" });
      else out.docsSkipped++;
    }
    const products = await p.product?.findMany?.({ where: { organizationId, status: "ACTIVE" } }).catch(() => []);
    for (const product of products ?? []) {
      const r = await this.indexProduct(product);
      if (r.status === "indexed") out.productsIndexed++;
      else if (r.status === "failed") out.failures.push({ sourceType: PRODUCT_SOURCE, sourceId: String(product.id), reason: r.reason ?? "failed" });
      else out.productsSkipped++;
    }
    if (out.failures.length) {
      this.logger.error(
        `knowledge backfill for org ${organizationId}: ${out.failures.length} source(s) failed: ${out.failures.map((f) => `${f.sourceType}/${f.sourceId}`).join(", ")}`,
      );
    }
    return out;
  }

  /**
   * The shared refresh: diff desired chunks against stored rows
   * (same chunkIndex + same content hash + same provider/model +
   * same visibility ⇒ keep, untouched), embed only the rest, then
   * delete stale rows and insert the fresh ones. The provider
   * call happens BEFORE any mutation, so a provider failure
   * leaves the previous index fully intact.
   */
  private async reindex(
    organizationId: string,
    sourceType: string,
    sourceId: string,
    chunks: string[],
    embedTexts: string[],
    visibility: string,
  ): Promise<IndexResult> {
    const store = this.vectors();
    if (!chunks.length) {
      const deleted = await store.deleteBySource(organizationId, sourceType, sourceId);
      return { status: "indexed", chunks: 0, inserted: 0, deleted, skippedChunks: 0 };
    }
    const resolved = await this.emb().resolveConfig(organizationId);
    if (!resolved.ok) return { status: "unavailable", reason: resolved.reason };
    const { provider, model } = resolved.config;
    const hashes = embedTexts.map(sha256);
    const existing = await store.listBySource(organizationId, sourceType, sourceId);
    const byIndex = new Map(existing.map((r) => [r.chunkIndex, r]));
    const keep = new Set<string>();
    const toEmbed: { chunkIndex: number; chunk: string; text: string; hash: string }[] = [];
    chunks.forEach((chunk, i) => {
      const row = byIndex.get(i);
      if (row && row.contentHash === hashes[i] && row.provider === provider && row.model === model && row.visibility === visibility) {
        keep.add(row.id);
      } else {
        toEmbed.push({ chunkIndex: i, chunk, text: embedTexts[i], hash: hashes[i] });
      }
    });
    let inserted = 0;
    if (toEmbed.length) {
      const res = await this.emb().embed(organizationId, toEmbed.map((t) => t.text));
      if (!res.ok) return { status: "unavailable", reason: res.reason };
      const staleIds = existing.filter((r) => !keep.has(r.id)).map((r) => r.id);
      const deletedCount = staleIds.length ? await store.deleteByIds(organizationId, staleIds) : 0;
      inserted = await store.insertRows(
        toEmbed.map((t, k) => ({
          organizationId, sourceType, sourceId, chunkIndex: t.chunkIndex,
          content: t.chunk, contentHash: t.hash,
          provider: res.provider, model: res.model, dimension: res.dimension,
          embedding: res.vectors[k], visibility,
        })),
      );
      return { status: "indexed", chunks: chunks.length, inserted, deleted: deletedCount, skippedChunks: keep.size };
    }
    const staleIds = existing.filter((r) => !keep.has(r.id)).map((r) => r.id);
    const deleted = staleIds.length ? await store.deleteByIds(organizationId, staleIds) : 0;
    return { status: "indexed", chunks: chunks.length, inserted: 0, deleted, skippedChunks: keep.size };
  }

  private failed(kind: string, organizationId: string, sourceId: string, e: unknown): IndexResult {
    const reason = e instanceof Error ? e.message : String(e);
    this.logger.error(`embedding indexing failed for ${kind} org ${organizationId} source ${sourceId}: ${reason}`);
    return { status: "failed", reason };
  }
}
