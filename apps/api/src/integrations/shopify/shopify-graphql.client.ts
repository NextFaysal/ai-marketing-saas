type FetchFn = typeof fetch;

export class ShopifyGraphQLError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ShopifyGraphQLError";
  }
}

export class ShopifyGraphQLClient {
  private readonly origin: string;
  private readonly version: string;
  constructor(
    storeUrl: string,
    private readonly accessToken: string,
    private readonly fetchFn: FetchFn = fetch,
    version?: string,
  ) {
    this.origin = new URL(storeUrl).origin;
    this.version = version ?? process.env.SHOPIFY_API_VERSION ?? "2025-10";
  }

  async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const url = `${this.origin}/admin/api/${this.version}/graphql.json`;
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": this.accessToken,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables: variables ?? {} }),
    });
    const text = await (res as any).text().catch(() => "");
    let body: any = null;
    try { body = text ? JSON.parse(text) : {}; } catch { body = null; }
    if (!(res as any).ok) {
      const excerpt = body ? JSON.stringify(body).slice(0, 500) : String(text).slice(0, 500);
      throw new ShopifyGraphQLError((res as any).status ?? 0, `Shopify GraphQL request failed (${(res as any).status}): ${excerpt}`);
    }
    if (body?.errors && Array.isArray(body.errors) && body.errors.length > 0) {
      const joined = body.errors.map((e: any) => e?.message ?? String(e)).join("; ");
      throw new ShopifyGraphQLError((res as any).status ?? 200, joined);
    }
    return body?.data as T;
  }

  /** EC12: start a bulk query operation. User errors are surfaced
   *  as a ShopifyGraphQLError — a bulk operation that never started
   *  must not be polled as if it had. */
  async runBulkOperation(query: string): Promise<any> {
    const data = await this.request<any>(
      `mutation bulkRun($query: String!) { bulkOperationRunQuery(query: $query) { bulkOperation { id status } userErrors { field message } } }`,
      { query },
    );
    const result = (data as any)?.bulkOperationRunQuery;
    const userErrors: any[] = result?.userErrors ?? [];
    if (Array.isArray(userErrors) && userErrors.length > 0) {
      throw new ShopifyGraphQLError(200, userErrors.map((e: any) => e?.message ?? String(e)).join("; "));
    }
    return result?.bulkOperation ?? null;
  }

  /** EC12: the currently running / last bulk operation, or null. */
  async currentBulkOperation(): Promise<any> {
    const data = await this.request<any>(`{ currentBulkOperation { id status errorCode objectCount url } }`);
    return (data as any)?.currentBulkOperation ?? null;
  }

  /** EC12: download a completed bulk operation's JSONL result. */
  async downloadBulkResult(url: string): Promise<string> {
    const res = await this.fetchFn(url, { method: "GET" });
    if (!(res as any).ok) {
      throw new ShopifyGraphQLError((res as any).status ?? 0, `Shopify bulk result download failed (${(res as any).status})`);
    }
    return await (res as any).text();
  }

  async shopProbe(): Promise<any> {
    const data = await this.request<any>(`query { shop { id name currencyCode primaryDomain { url } } }`);
    return data?.shop;
  }

  async accessScopes(): Promise<string[]> {
    const data = await this.request<any>(`query { currentAppInstallation { accessScopes { handle } } }`);
    const scopes = data?.currentAppInstallation?.accessScopes ?? [];
    return scopes.map((s: any) => s.handle as string);
  }

  async webhookTopics(): Promise<string[]> {
    const data = await this.request<any>(`query { webhookSubscriptions(first: 50) { edges { node { topic } } } }`);
    const edges = data?.webhookSubscriptions?.edges ?? [];
    return edges.map((e: any) => e?.node?.topic as string).filter(Boolean);
  }
}
