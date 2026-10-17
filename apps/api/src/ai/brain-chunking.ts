import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

/**
 * SA-B2 (P2): index-time chunking for Brain embeddings.
 *
 * This file is the ONE place @langchain/textsplitters is imported
 * (Master Plan §11: LangChain is confined to the Brain's RAG
 * plumbing, pinned exact, replaceable without touching the rest
 * of the system — a grep for "@langchain" across apps/api/src
 * proves the confinement). It is used ONLY to re-derive chunks
 * from stored document content at index time; user-facing chunk
 * storage stays the existing KnowledgeDocument rows.
 *
 * Size: the splitter is character-based. 2400 chars ≈ 600 tokens
 * at the codebase's own estimateTokens heuristic (~4 chars per
 * token) — inside the plan's ~500–1000 token band — with 240
 * chars of overlap so a sentence straddling a boundary keeps its
 * context in both chunks. The Bengali danda "।" is an explicit
 * separator (plan §11) so Bengali sentences split at sentence
 * ends, not mid-word.
 */

export const BRAIN_CHUNK_CHARS = 2400;
export const BRAIN_CHUNK_OVERLAP = 240;

const SEPARATORS = ["\n\n", "\n", "। ", "।", ". ", "! ", "? ", "; ", ": ", ", ", " ", ""];

let splitter: RecursiveCharacterTextSplitter | null = null;

export async function splitForEmbedding(text: string): Promise<string[]> {
  const clean = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= BRAIN_CHUNK_CHARS) return [clean];
  splitter ??= new RecursiveCharacterTextSplitter({
    chunkSize: BRAIN_CHUNK_CHARS,
    chunkOverlap: BRAIN_CHUNK_OVERLAP,
    separators: SEPARATORS,
  });
  const raw = await splitter.splitText(clean);
  // The splitter can leave a separator remnant (a leading "।") at
  // a chunk start; a sentence never begins with its own
  // terminator, so strip exactly that artifact — the stored chunk
  // is what a match later quotes, and it must read cleanly.
  return raw.map((c) => c.trim().replace(/^।\s*/, "").trim()).filter((c) => c.length > 0);
}
