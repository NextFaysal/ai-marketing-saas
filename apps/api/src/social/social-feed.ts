/**
 * SN8 — a dependency-free RSS 2.0 / Atom feed parser for the
 * syndication sweep. It is deliberately small: it extracts only
 * the fields a syndication draft needs (identity, title, link,
 * publication date) from <item> / <entry> blocks, unwraps CDATA,
 * decodes the basic XML entities, and preserves the feed's own
 * order (normally newest first). Items with an empty title or an
 * empty link are dropped — a draft needs both.
 */

export interface FeedItem {
  externalId: string;
  title: string;
  link: string;
  publishedAt: string | null;
}

/** Unwrap CDATA sections and decode the basic XML entities. */
function decodeXml(raw: string): string {
  let out = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, inner: string) => inner);
  out = out
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    })
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  return out.trim();
}

/** The decoded text content of the first <tag>…</tag> in a block,
 * or "" when the tag is absent / self-closing / empty. */
function tagText(block: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = re.exec(block);
  return m ? decodeXml(m[1]) : "";
}

/** All <link …> attribute sets in an Atom entry, in order. */
function atomLinks(block: string): { href: string; rel: string | null }[] {
  const links: { href: string; rel: string | null }[] = [];
  const re = /<link\b([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const attrs = m[1] ?? "";
    const hrefMatch = /href\s*=\s*"([^"]*)"/i.exec(attrs) ?? /href\s*=\s*'([^']*)'/i.exec(attrs);
    if (!hrefMatch) continue;
    const relMatch = /rel\s*=\s*"([^"]*)"/i.exec(attrs) ?? /rel\s*=\s*'([^']*)'/i.exec(attrs);
    links.push({
      href: decodeXml(hrefMatch[1]),
      rel: relMatch ? decodeXml(relMatch[1]) : null,
    });
  }
  return links;
}

function blocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function parseRssItems(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const block of blocks(xml, "item")) {
    const title = tagText(block, "title");
    const link = tagText(block, "link");
    if (!title || !link) continue;
    const guid = tagText(block, "guid");
    const pubDate = tagText(block, "pubDate");
    items.push({
      externalId: guid || link,
      title,
      link,
      publishedAt: pubDate || null,
    });
  }
  return items;
}

function parseAtomEntries(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const block of blocks(xml, "entry")) {
    const title = tagText(block, "title");
    const links = atomLinks(block);
    const chosen = links.find((l) => l.rel === "alternate") ?? links[0];
    const link = chosen?.href ?? "";
    if (!title || !link) continue;
    const id = tagText(block, "id");
    const published = tagText(block, "updated") || tagText(block, "published");
    items.push({
      externalId: id || link,
      title,
      link,
      publishedAt: published || null,
    });
  }
  return items;
}

/**
 * Parse an RSS 2.0 or Atom feed document. RSS <item> blocks win
 * when present; otherwise Atom <entry> blocks are read. Anything
 * unrecognised yields an empty list, never a throw.
 */
export function parseFeed(xml: string): FeedItem[] {
  if (typeof xml !== "string" || !xml.trim()) return [];
  const rss = parseRssItems(xml);
  if (rss.length > 0) return rss;
  // A feed whose items were all dropped for empty title/link
  // still counts as an RSS document — do not fall through to
  // Atom parsing of the same blocks (there are no <entry>s in
  // an RSS document anyway, so this is just the plain path).
  if (/<item\b/i.test(xml)) return rss;
  return parseAtomEntries(xml);
}
