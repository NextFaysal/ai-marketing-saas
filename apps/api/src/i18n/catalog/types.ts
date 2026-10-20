/** ML10 catalog entry: every key carries bn + en text (ML-L6). */
export interface CatalogEntry {
  bn: string;
  en: string;
}

/** One domain namespace file: full dotted codes → entries. */
export type CatalogNamespace = Record<string, CatalogEntry>;
