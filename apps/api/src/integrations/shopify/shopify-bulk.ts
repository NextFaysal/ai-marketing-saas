/**
 * EC12: Shopify bulk product export (Bulk Operations API).
 *
 * The bulk query uses the documented bulk form: connections carry
 * no pagination arguments inside a bulk operation. Results come
 * back as JSONL where child lines (variants) carry `__parentId`
 * pointing at their product's gid. `parseBulkProductsJsonl` is a
 * pure function that reshapes those lines into the REST product
 * shape `normalizeShopifyProduct` already consumes, so bulk and
 * paginated sync share one ingest path.
 */
export const BULK_PRODUCTS_QUERY = `{
  products {
    edges {
      node {
        id
        title
        bodyHtml
        status
        productType
        updatedAt
        featuredImage { url }
        variants {
          edges {
            node {
              id
              title
              sku
              price
              compareAtPrice
              inventoryQuantity
            }
          }
        }
      }
    }
  }
}`;

/** Last path segment of a Shopify gid ("gid://shopify/Product/123" -> "123"). */
export function gidNumeric(gid: unknown): string {
  const parts = String(gid ?? "").split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

/**
 * Parse bulk-operation JSONL into REST-like product raws.
 * Product lines have no `__parentId`; variant lines do, and are
 * attached to the product whose gid matches. Unparseable lines
 * are skipped rather than failing the whole import.
 */
export function parseBulkProductsJsonl(text: string): any[] {
  const products = new Map<string, any>();
  const order: string[] = [];
  const children = new Map<string, any[]>();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: any;
    try { obj = JSON.parse(trimmed); } catch { continue; }
    if (!obj || typeof obj !== "object") continue;
    if (obj.__parentId) {
      const list = children.get(obj.__parentId) ?? [];
      list.push(obj);
      children.set(obj.__parentId, list);
    } else if (obj.id) {
      if (!products.has(obj.id)) order.push(obj.id);
      products.set(obj.id, obj);
    }
  }
  return order.map((gid) => {
    const p = products.get(gid);
    const variants = (children.get(gid) ?? []).map((v: any) => ({
      id: Number(gidNumeric(v.id)),
      title: v.title,
      sku: v.sku ?? undefined,
      price: v.price != null ? String(v.price) : undefined,
      compare_at_price: v.compareAtPrice != null ? String(v.compareAtPrice) : null,
      inventory_quantity: typeof v.inventoryQuantity === "number" ? v.inventoryQuantity : undefined,
    }));
    return {
      id: Number(gidNumeric(p.id)),
      title: p.title,
      body_html: p.bodyHtml ?? undefined,
      status: String(p.status ?? "").toLowerCase(),
      product_type: p.productType ?? undefined,
      updated_at: p.updatedAt ?? undefined,
      images: p.featuredImage?.url ? [{ src: p.featuredImage.url }] : [],
      variants,
    };
  });
}
