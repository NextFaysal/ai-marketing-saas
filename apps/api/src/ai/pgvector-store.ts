import { Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@repo/db";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  vectorLiteral,
  type EmbeddingRowInput,
  type EmbeddingRowMeta,
  type VectorSearchHit,
  type VectorSearchOptions,
  type VectorStore,
} from "./vector-store";

/**
 * SA-B2 (P2): the pgvector implementation of the VectorStore
 * port. Metadata columns go through the Prisma client; the
 * vector column itself is Unsupported in the schema (the
 * Product.searchVector precedent) and is written/read ONLY via
 * raw SQL here.
 *
 * Search semantics:
 *  - Cosine distance (`<=>`), returned as similarity = 1 − d.
 *  - The WHERE clause ALWAYS carries organizationId (L1),
 *    provider + model + dimension of the query vector (rows from
 *    other models are incomparable and are excluded in SQL, not
 *    in code), and — for a customer audience — visibility =
 *    'public' (L3 enforced in the query itself).
 *  - Exact scan, no ANN index: pgvector cannot build HNSW over
 *    an untyped vector column, and per-tenant row counts are
 *    small (documents, not web scale). This is the recorded
 *    trade-off; the Qdrant path behind this port is the scale
 *    answer (plan §3), not a future index on mixed dimensions.
 */
@Injectable()
export class PgVectorStore implements VectorStore {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  private db(): any {
    if (!this.prisma) throw new Error("PgVectorStore: PrismaService is not available");
    return this.prisma as any;
  }

  async listBySource(organizationId: string, sourceType: string, sourceId: string): Promise<EmbeddingRowMeta[]> {
    const rows = await this.db().knowledgeEmbedding.findMany({
      where: { organizationId, sourceType, sourceId },
      select: {
        id: true, organizationId: true, sourceType: true, sourceId: true, chunkIndex: true,
        content: true, contentHash: true, provider: true, model: true, dimension: true, visibility: true,
      },
      orderBy: { chunkIndex: "asc" },
    });
    return rows as EmbeddingRowMeta[];
  }

  async insertRows(rows: EmbeddingRowInput[]): Promise<number> {
    if (!rows.length) return 0;
    const values = rows.map(
      (r) => Prisma.sql`(${randomUUID()}, ${r.organizationId}, ${r.sourceType}, ${r.sourceId}, ${r.chunkIndex},
        ${r.content}, ${r.contentHash}, ${r.provider}, ${r.model}, ${r.dimension},
        ${vectorLiteral(r.embedding)}::vector, ${r.visibility}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    );
    const count = await this.db().$executeRaw(
      Prisma.sql`INSERT INTO "KnowledgeEmbedding"
        ("id", "organizationId", "sourceType", "sourceId", "chunkIndex", "content", "contentHash",
         "provider", "model", "dimension", "embedding", "visibility", "createdAt", "updatedAt")
        VALUES ${Prisma.join(values)}`,
    );
    return Number(count ?? 0);
  }

  async deleteByIds(organizationId: string, ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const res = await this.db().knowledgeEmbedding.deleteMany({
      where: { organizationId, id: { in: ids } },
    });
    return Number(res?.count ?? 0);
  }

  async deleteBySource(organizationId: string, sourceType: string, sourceId: string): Promise<number> {
    const res = await this.db().knowledgeEmbedding.deleteMany({
      where: { organizationId, sourceType, sourceId },
    });
    return Number(res?.count ?? 0);
  }

  async search(organizationId: string, queryVector: number[], opts: VectorSearchOptions): Promise<VectorSearchHit[]> {
    const literal = vectorLiteral(queryVector);
    // SA-B7 (R1): customer-CLASS audiences get the public-only
    // filter in SQL — that is "customer" AND "own_customer"
    // (SA-B5 added the third audience after this store was
    // written; OrgBrainService also re-filters admitted hits
    // through their live rows, but L3 wants the filter in the
    // query itself, never only in post-processing).
    const audienceFilter =
      opts.audience !== "internal" ? Prisma.sql`AND "visibility" = 'public'` : Prisma.empty;
    const sourceFilter = opts.sourceTypes?.length
      ? Prisma.sql`AND "sourceType" IN (${Prisma.join(opts.sourceTypes.map((t) => Prisma.sql`${t}`))})`
      : Prisma.empty;
    const rows = await this.db().$queryRaw(
      Prisma.sql`SELECT "id", "sourceType", "sourceId", "chunkIndex", "content", "visibility",
          1 - ("embedding" <=> ${literal}::vector) AS "similarity"
        FROM "KnowledgeEmbedding"
        WHERE "organizationId" = ${organizationId}
          AND "provider" = ${opts.provider}
          AND "model" = ${opts.model}
          AND "dimension" = ${queryVector.length}
          ${audienceFilter}
          ${sourceFilter}
        ORDER BY "embedding" <=> ${literal}::vector ASC
        LIMIT ${Math.max(1, Math.floor(opts.limit) || 1)}`,
    );
    return (rows as any[]).map((r) => ({
      id: String(r.id),
      sourceType: String(r.sourceType),
      sourceId: String(r.sourceId),
      chunkIndex: Number(r.chunkIndex),
      content: String(r.content ?? ""),
      visibility: String(r.visibility ?? "public"),
      similarity: Number(r.similarity),
    }));
  }
}
