/**
 * Shopify Admin API client (REST). Auth: X-Shopify-Access-Token header
 * with a custom app's Admin API access token (shpat_). API version is
 * pinned via SHOPIFY_API_VERSION (default 2024-10) because Shopify
 * sunsets versions quarterly. Pagination uses since_id.
 */
type FetchFn = typeof fetch;

export interface ShopifySecrets { accessToken: string; apiSecret: string }

export class ShopifyClient {
  private readonly base: string;
  constructor(storeUrl: string, private readonly secrets: ShopifySecrets, private readonly fetchFn: FetchFn = fetch, version?: string) {
    const origin = new URL(storeUrl).origin;
    this.base = `${origin}/admin/api/${version ?? process.env.SHOPIFY_API_VERSION ?? "2024-10"}`;
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await this.fetchFn(url.toString(), {
      headers: { "X-Shopify-Access-Token": this.secrets.accessToken, Accept: "application/json" },
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Shopify request failed (${res.status}): ${body?.errors ?? "unknown error"}`);
    return body as T;
  }

  async testConnection(): Promise<{ id: number; name: string; currency: string; domain: string }> {
    const res = await this.get<any>("/shop.json");
    const shop = res.shop;
    return { id: shop.id, name: shop.name, currency: shop.currency, domain: shop.domain };
  }

  async listProducts(updatedAtMin?: string, maxPages = 10): Promise<any[]> {
    return this.paginate("/products.json", "products", updatedAtMin, maxPages);
  }
  async listOrders(updatedAtMin?: string, maxPages = 10): Promise<any[]> {
    return this.paginate("/orders.json", "orders", updatedAtMin, maxPages, { status: "any" });
  }

  /**
   * REST checkouts endpoint = abandoned checkouts list; used by
   * the EC10 backfill. GraphQL 2025-10 exposes no abandoned-
   * checkout query, so REST is the only read path for these.
   */
  async listCheckouts(): Promise<any[]> {
    const data = await this.get<any>("/checkouts.json", { limit: "250" });
    return (data as any)?.checkouts ?? (Array.isArray(data) ? data : []);
  }

  private async paginate(path: string, key: string, updatedAtMin: string | undefined, maxPages: number, extra: Record<string, string> = {}): Promise<any[]> {
    const out: any[] = [];
    let sinceId: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const res = await this.get<any>(path, {
        limit: "250", ...extra,
        ...(updatedAtMin ? { updated_at_min: updatedAtMin } : {}),
        ...(sinceId ? { since_id: sinceId } : {}),
      });
      const items: any[] = res[key] ?? [];
      out.push(...items);
      if (items.length < 250) break;
      sinceId = String(items[items.length - 1].id);
    }
    return out;
  }
}
