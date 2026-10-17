import type { BrainAudience } from "./org-brain.service";

/**
 * SA-B2 (Smart AI Phase 0, P2): the VectorStore port (Master Plan
 * §3). Every vector read/write in the Brain goes through this
 * interface so the storage engine can be swapped without touching
 * retrieval logic: pgvector inside the org's own Postgres today
 * (PgVectorStore), self-hosted Qdrant when total vectors reach
 * roughly 2–5 million or latency demands it. Managed external
 * vector services stay rejected (extra subscription + tenant data
 * leaving the owner's server — plan §3).
 *
 * The laws are part of the port's contract, not the caller's
 * goodwill:
 *  - L1: organizationId is a mandatory argument on EVERY method
 *    and appears in every underlying query — no exceptions.
 *  - L3: search takes the audience and the implementation must
 *    apply the visibility filter in the storage query itself
 *    (customer ⇒ visibility = 'public' only), never in post-
 *    processing after rows have been fetched.
 */

export interface EmbeddingRowInput {
  organizationId: string;
  sourceType: string; // knowledge_chunk | product
  sourceId: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  provider: string;
  model: string;
  dimension: number;
  embedding: number[];
  visibility: string; // public | internal (snapshot of the source)
}

export interface EmbeddingRowMeta {
  id: string;
  organizationId: string;
  sourceType: string;
  sourceId: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  provider: string;
  model: string;
  dimension: number;
  visibility: string;
}

export interface VectorSearchHit {
  id: string;
  sourceType: string;
  sourceId: string;
  chunkIndex: number;
  content: string;
  visibility: string;
  /** Cosine similarity in [−1, 1]; higher is closer. */
  similarity: number;
}

export interface VectorSearchOptions {
  provider: string;
  model: string;
  limit: number;
  audience: BrainAudience;
  sourceTypes?: string[];
}

export interface VectorStore {
  /** Metadata for every stored row of one source (hash-skip
   *  decisions read this; the vector column itself is not read). */
  listBySource(organizationId: string, sourceType: string, sourceId: string): Promise<EmbeddingRowMeta[]>;
  insertRows(rows: EmbeddingRowInput[]): Promise<number>;
  /** Org-scoped by construction: ids from another org never match. */
  deleteByIds(organizationId: string, ids: string[]): Promise<number>;
  deleteBySource(organizationId: string, sourceType: string, sourceId: string): Promise<number>;
  search(organizationId: string, queryVector: number[], opts: VectorSearchOptions): Promise<VectorSearchHit[]>;
}

/** Nest DI token for the port (implementations bind to it). */
export const VECTOR_STORE = "VECTOR_STORE";

/**
 * Render a JS number array as a pgvector literal. Every component
 * must be a finite number — anything else is a programming error
 * and throws HERE rather than producing malformed SQL (a vector
 * is never silently repaired or fabricated).
 */
export function vectorLiteral(vector: number[]): string {
  if (!Array.isArray(vector) || !vector.length) throw new Error("vectorLiteral: empty vector");
  for (const n of vector) {
    if (typeof n !== "number" || !Number.isFinite(n)) throw new Error("vectorLiteral: non-finite component");
  }
  return `[${vector.join(",")}]`;
}
