export interface WooCredentials { consumerKey: string; consumerSecret: string }

export interface WooPage<T> { items: T[]; totalPages: number; total: number }

export class WooApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type FetchFn = typeof fetch;

/**
 * Thin WooCommerce REST API client (WC v3).
 * Auth: HTTP Basic with consumer key/secret over HTTPS (WooCommerce also
 * supports query-string keys, Basic-over-HTTPS is the cleaner default).
 * The base URL is the store's WordPress home URL, trailing slash trimmed.
 */
export class WooClient {
  private readonly base: string;
  private readonly authHeader: string;
  constructor(storeUrl: string, creds: WooCredentials, private readonly fetchFn: FetchFn = fetch) {
    this.base = storeUrl.replace(/\/+$/, "") + "/wp-json/wc/v3";
    this.authHeader = "Basic " + Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString("base64");
  }

  async get<T>(path: string, params: Record<string, string | number> = {}): Promise<{ data: T; headers: Headers }> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await this.fetchFn(url.toString(), {
      headers: { Authorization: this.authHeader, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new WooApiError(res.status, `WooCommerce request failed (${res.status}): ${text.slice(0, 300)}`);
    }
    return { data: (await res.json()) as T, headers: res.headers };
  }

  async post<T>(path: string, body: unknown): Promise<{ data: T }> {
    const res = await this.fetchFn(this.base + path, {
      method: "POST",
      headers: { Authorization: this.authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new WooApiError(res.status, `WooCommerce request failed (${res.status}): ${text.slice(0, 300)}`);
    }
    return { data: (await res.json()) as T };
  }

  async put<T>(path: string, body: unknown): Promise<{ data: T }> {
    const res = await this.fetchFn(this.base + path, {
      method: "PUT",
      headers: { Authorization: this.authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new WooApiError(res.status, `WooCommerce request failed (${res.status}): ${text.slice(0, 300)}`);
    }
    return { data: (await res.json()) as T };
  }

  async delete<T = any>(path: string): Promise<{ data: T }> {
    const res = await this.fetchFn(this.base + path, {
      method: "DELETE",
      headers: { Authorization: this.authHeader, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new WooApiError(res.status, `WooCommerce request failed (${res.status}): ${text.slice(0, 300)}`);
    }
    // DELETE may return empty body
    const data = await res.json().catch(() => ({} as T));
    return { data: data as T };
  }

  async listWebhooks(page = 1, perPage = 100): Promise<any[]> {
    const { data } = await this.get<any[]>("/webhooks", { page, per_page: perPage });
    return Array.isArray(data) ? data : [];
  }

  async createWebhook(payload: Record<string, unknown>): Promise<any> {
    const { data } = await this.post<any>("/webhooks", payload);
    return data;
  }

  async deleteWebhook(id: number | string): Promise<any> {
    const { data } = await this.delete<any>(`/webhooks/${id}?force=true`);
    return data;
  }

  /** Create an order in the store. Returns Woo's own order object. */
  async createOrder(payload: Record<string, unknown>): Promise<any> {
    const { data } = await this.post<any>("/orders", payload);
    return data;
  }

  /** EC3: POST /products/batch ({create, update, delete}). Chunking is the caller's job. */
  async batchProducts(payload: Record<string, unknown>): Promise<any> {
    const { data } = await this.post<any>("/products/batch", payload);
    return data;
  }

  /** EC3: POST /products/{id}/variations/batch ({create, update, delete}). */
  async batchVariations(productId: number | string, payload: Record<string, unknown>): Promise<any> {
    const { data } = await this.post<any>(`/products/${productId}/variations/batch`, payload);
    return data;
  }

  async testConnection(): Promise<{ storeName?: string; version?: string }> {
    const { data } = await this.get<any>("/system_status");
    return { storeName: data?.environment?.site_title, version: data?.environment?.version };
  }

  async listProducts(page = 1, perPage = 100, modifiedAfter?: string): Promise<WooPage<any>> {
    const params: Record<string, string | number> = { page, per_page: perPage, orderby: "date_modified", order: "asc" };
    if (modifiedAfter) params.modified_after = modifiedAfter;
    const { data, headers } = await this.get<any[]>("/products", params);
    return { items: data, totalPages: Number(headers.get("x-wp-totalpages") ?? 1), total: Number(headers.get("x-wp-total") ?? data.length) };
  }

  async listVariations(productId: number | string, page = 1, perPage = 100): Promise<any[]> {
    const { data } = await this.get<any[]>(`/products/${productId}/variations`, { page, per_page: perPage });
    return data;
  }

  async listOrders(page = 1, perPage = 100, modifiedAfter?: string): Promise<WooPage<any>> {
    const params: Record<string, string | number> = { page, per_page: perPage, orderby: "date_modified", order: "asc" };
    if (modifiedAfter) params.modified_after = modifiedAfter;
    const { data, headers } = await this.get<any[]>("/orders", params);
    return { items: data, totalPages: Number(headers.get("x-wp-totalpages") ?? 1), total: Number(headers.get("x-wp-total") ?? data.length) };
  }

  async listCustomers(page = 1, perPage = 100, modifiedAfter?: string): Promise<WooPage<any>> {
    const params: Record<string, string | number> = { page, per_page: perPage, orderby: "date_modified", order: "asc" };
    if (modifiedAfter) params.modified_after = modifiedAfter;
    const { data, headers } = await this.get<any[]>("/customers", params);
    return { items: data, totalPages: Number(headers.get("x-wp-totalpages") ?? 1), total: Number(headers.get("x-wp-total") ?? data.length) };
  }
}
