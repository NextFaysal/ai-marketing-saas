import { Prisma } from "@repo/db";

/**
 * AB6 (AX11) — pure helpers for the FTS shop search: term
 * normalization, merchant-synonym expansion and tsquery
 * construction. No I/O — unit-tested in ab6-search.spec.ts.
 */

/** Trim, lowercase, collapse internal whitespace to single spaces. */
export function normalizeSearchTerm(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Expand a raw query into the phrase list OR-ed into the tsquery.
 *
 * RULE (pinned): normalize the query; phrases start as
 * [normalizedQuery]. If the WHOLE normalized query equals a
 * synonym term, append that synonym's expansions. Otherwise, for
 * each whitespace token of the query that equals a synonym term,
 * append that term's expansions. Expansions are normalized the
 * same way; the result is deduped, empties dropped, and the total
 * is capped at 11 phrases (the original + at most 10 expansions).
 */
export function expandSynonymQueries(
  query: string,
  synonyms: Array<{ term: string; expansions: string[] }>,
): string[] {
  const normalizedQuery = normalizeSearchTerm(query);
  if (!normalizedQuery) return [];
  const phrases: string[] = [normalizedQuery];
  const seen = new Set<string>([normalizedQuery]);
  const appendExpansions = (expansions: string[]) => {
    for (const raw of expansions ?? []) {
      const e = normalizeSearchTerm(raw);
      if (!e || seen.has(e)) continue;
      if (phrases.length >= 11) return;
      seen.add(e);
      phrases.push(e);
    }
  };
  const tokens = normalizedQuery.split(" ");
  for (const syn of synonyms ?? []) {
    if (phrases.length >= 11) break;
    const term = normalizeSearchTerm(syn?.term);
    if (!term) continue;
    const expansions = Array.isArray(syn?.expansions) ? syn.expansions : [];
    if (normalizedQuery === term || tokens.includes(term)) {
      appendExpansions(expansions);
    }
  }
  return phrases.slice(0, 11);
}

/**
 * Build the tsquery for a phrase list with parameter binding
 * ONLY (user text never enters the SQL text): one phrase is a
 * plain plainto_tsquery; several phrases are OR-ed through their
 * text forms and cast back to tsquery.
 */
export function buildTsQuerySql(phrases: string[]): Prisma.Sql {
  const list = phrases.length > 0 ? phrases : [""];
  if (list.length === 1) {
    return Prisma.sql`plainto_tsquery('simple', ${list[0]})`;
  }
  const parts = list.map((p) => Prisma.sql`plainto_tsquery('simple', ${p})::text`);
  const joined = Prisma.join(parts, " || ' | ' || ");
  return Prisma.sql`(${joined})::tsquery`;
}
