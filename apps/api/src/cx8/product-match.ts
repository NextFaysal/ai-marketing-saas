/**
 * CX8 (খ) Image product recognition — pure description parsing +
 * catalog scoring.
 *
 * HONESTY: this is NOT image-to-image similarity. A vision model
 * DESCRIBES the customer's photo in words; this scorer matches
 * those words against the catalog's own text fields (name,
 * category, description, SKU). The UI carries the wording:
 * "এটি ছবির সাথে ছবির মিল নয় — AI ছবিটি বর্ণনা করে, সেই বর্ণনা
 * দিয়ে catalog খোঁজা হয়".
 *
 * Audit note (Product model, packages/db schema): a product has
 * name, category, description, sku and ONE imageUrl — there is no
 * images[] array, no tags and no keywords field. The "has catalog
 * image" boost therefore reads imageUrl (bumpImageUrl does NOT
 * count — it is an upsell accessory image, not the product's own).
 */

export interface ProductDescription {
  category?: string;
  color?: string;
  type?: string;
  visibleText?: string;
  keywords: string[];
}

export const PRODUCT_DESCRIBE_PROMPT = `You are describing a product photo a customer sent to an online shop, so the shop can search its catalog. Describe ONLY what is visibly in the image — never guess a brand, model or product that is not clearly shown.
Respond with strict JSON only:
{"category": string|null, "color": string|null, "type": string|null, "visibleText": string|null, "keywords": string[]}
- category: the broad product category (e.g. "clothing", "shoes", "electronics").
- color: the dominant visible color.
- type: the specific kind of item (e.g. "panjabi", "sneakers", "handbag").
- visibleText: any text/logo wording clearly readable in the image, or null.
- keywords: up to 8 short search keywords (English or Bengali) for the visible item's features, material, pattern or use.`;

const MAX_KEYWORDS = 8;

function cleanTextField(raw: unknown, maxLen: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim().slice(0, maxLen);
  return v ? v : undefined;
}

/** Defensive parse of the vision description — same discipline as
 *  the label extraction: garbage → an empty description, which the
 *  scorer then (correctly) matches against nothing. */
export function parseProductDescription(text: string): ProductDescription {
  const empty: ProductDescription = { keywords: [] };
  try {
    const cleaned = String(text ?? "").replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return empty;
    const raw = JSON.parse(cleaned.slice(start, end + 1));
    if (!raw || typeof raw !== "object") return empty;
    const keywords = Array.isArray(raw.keywords)
      ? raw.keywords.filter((k: unknown) => typeof k === "string").map((k: string) => k.trim().toLowerCase()).filter(Boolean).slice(0, MAX_KEYWORDS)
      : [];
    return {
      category: cleanTextField(raw.category, 80)?.toLowerCase(),
      color: cleanTextField(raw.color, 40)?.toLowerCase(),
      type: cleanTextField(raw.type, 80)?.toLowerCase(),
      visibleText: cleanTextField(raw.visibleText, 120),
      keywords,
    };
  } catch {
    return empty;
  }
}

export interface CatalogProduct {
  id: string;
  name: string;
  category?: string | null;
  description?: string | null;
  sku?: string | null;
  imageUrl?: string | null;
  priceMinor: bigint | number | string;
  currency?: string | null;
}

export interface ProductCandidate {
  product: CatalogProduct;
  score: number;
  reasons: string[];
}

/** Conservative floor: a lone weak keyword overlap is not a
 *  candidate. A type/category hit (or one keyword in the product
 *  name) clears it alone; keyword-only matches need several
 *  distinct hits (two in the category, three in the description). */
export const PRODUCT_MATCH_FLOOR = 3;

function tokenize(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9\u0980-\u09FF]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function fieldTokens(p: CatalogProduct) {
  return {
    name: new Set(tokenize(p.name)),
    category: new Set(tokenize(p.category ?? "")),
    description: new Set(tokenize(p.description ?? "")),
    sku: new Set(tokenize(p.sku ?? "")),
  };
}

function descriptionNeedles(d: ProductDescription): { term: string; field: "type" | "category" | "color" | "keyword" | "visibleText" }[] {
  const out: { term: string; field: "type" | "category" | "color" | "keyword" | "visibleText" }[] = [];
  const push = (value: string | undefined, field: "type" | "category" | "color" | "keyword" | "visibleText") => {
    if (!value) return;
    for (const t of tokenize(value)) out.push({ term: t, field });
  };
  push(d.type, "type");
  push(d.category, "category");
  push(d.color, "color");
  for (const k of d.keywords) push(k, "keyword");
  push(d.visibleText, "visibleText");
  return out;
}

const FIELD_WEIGHT: Record<string, number> = { type: 3, category: 2, color: 1, keyword: 1, visibleText: 2 };

/**
 * Pure scorer. Score = weighted token overlap of the description
 * against the product's own fields (name hits weigh most, then
 * category, then description/SKU). At EQUAL text score a product
 * WITH its own catalog image ranks above a name-only product (the
 * boost is a tiebreak ordering key, not extra score, so scores
 * stay honest and comparable). Below the floor → no candidate.
 * Max 5, each with the human-readable reasons that produced it.
 */
export function rankProductCandidates(
  description: ProductDescription,
  products: CatalogProduct[],
  opts: { floor?: number; max?: number } = {},
): ProductCandidate[] {
  const floor = opts.floor ?? PRODUCT_MATCH_FLOOR;
  const max = opts.max ?? 5;
  const needles = descriptionNeedles(description);
  if (needles.length === 0) return [];

  const scored: (ProductCandidate & { hasImage: boolean })[] = [];
  for (const p of products) {
    const fields = fieldTokens(p);
    let score = 0;
    const reasons: string[] = [];
    const seen = new Set<string>();
    for (const { term, field } of needles) {
      const key = `${field}:${term}`;
      if (seen.has(key)) continue;
      let hitIn: string | null = null;
      let weight = 0;
      if (fields.name.has(term)) { hitIn = "নামে"; weight = FIELD_WEIGHT[field] + 2; }
      else if (fields.category.has(term)) { hitIn = "ক্যাটাগরিতে"; weight = FIELD_WEIGHT[field] + 1; }
      else if (fields.description.has(term)) { hitIn = "বিবরণে"; weight = FIELD_WEIGHT[field]; }
      else if (fields.sku.has(term)) { hitIn = "SKU-তে"; weight = FIELD_WEIGHT[field]; }
      if (!hitIn) continue;
      seen.add(key);
      score += weight;
      reasons.push(`"${term}" ${hitIn} মিলেছে`);
    }
    if (score < floor) continue;
    const hasImage = Boolean(p.imageUrl);
    if (hasImage) reasons.push("ক্যাটালগে ছবি আছে");
    scored.push({ product: p, score, reasons, hasImage });
  }
  scored.sort((a, b) => (b.score - a.score) || (Number(b.hasImage) - Number(a.hasImage)) || a.product.name.localeCompare(b.product.name));
  return scored.slice(0, max).map(({ product, score, reasons }) => ({ product, score, reasons }));
}
