import { resolveShopifyClient } from "./shopify-catalog";
import { loadCustomerForPush, loadCustomerIdentity, saveCustomerIdentity } from "./customer-content";

/**
 * EC6 — Shopify customer write-back (GraphQL Admin API).
 * customerCreate / customerUpdate with read-back email check,
 * mirroring the Woo discipline. userErrors are surfaced verbatim.
 */

export interface CustomerArgs {
  prisma: any;
  organizationId: string;
  store: any;
  integration?: any;
  payload: Record<string, any>;
  fetchFn?: typeof fetch;
}

function gidFor(kind: string, id: string): string {
  const s = String(id);
  return s.startsWith("gid://") ? s : `gid://shopify/${kind}/${s}`;
}

function gidTail(g: string): string {
  return String(g ?? "").split("/").pop() ?? "";
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function userErrorsOf(payload: any): string | null {
  const errs = payload?.userErrors;
  if (Array.isArray(errs) && errs.length > 0) {
    return errs.map((e: any) => e?.message ?? String(e)).join("; ");
  }
  return null;
}

const CUSTOMER_CREATE = `mutation ecCustomerCreate($input: CustomerInput!) {
  customerCreate(input: $input) {
    customer { id email }
    userErrors { field message }
  }
}`;

const CUSTOMER_UPDATE = `mutation ecCustomerUpdate($input: CustomerInput!) {
  customerUpdate(input: $input) {
    customer { id email }
    userErrors { field message }
  }
}`;

const CUSTOMER_READBACK = `query ecCustomerRead($id: ID!) { customer(id: $id) { id email } }`;

export async function pushCustomer(args: CustomerArgs): Promise<{ ok: boolean; error?: string; responseSummary?: any }> {
  const customerId = args.payload?.customerId as string | undefined;
  if (!customerId) return { ok: false, error: "customer_not_found" };
  const customer = await loadCustomerForPush(args.prisma, args.organizationId, customerId);
  if (!customer) return { ok: false, error: "customer_not_found" };

  const resolved = await resolveShopifyClient(args as any);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const client = resolved.client;

  try {
    const storeId = String(args.store.id);
    const identity = await loadCustomerIdentity(args.prisma, storeId, customer.id);

    const input: Record<string, any> = {
      email: customer.email ?? undefined,
      firstName: customer.firstName ?? undefined,
      lastName: customer.lastName ?? undefined,
      phone: customer.phone ?? undefined,
    };

    let data: any;
    let payload: any;
    if (identity?.externalId) {
      input.id = gidFor("Customer", String(identity.externalId));
      data = await client.request<any>(CUSTOMER_UPDATE, { input });
      payload = data?.customerUpdate ?? data;
    } else {
      data = await client.request<any>(CUSTOMER_CREATE, { input });
      payload = data?.customerCreate ?? data;
    }

    const ue = userErrorsOf(payload);
    if (ue) return { ok: false, error: ue };

    const remoteCustomer = payload?.customer ?? payload;
    const remoteGid = remoteCustomer?.id;
    if (!remoteGid) return { ok: false, error: "shopify_customer_id_missing" };
    const externalId = gidTail(String(remoteGid));

    // Read-back verification.
    const rb = await client.request<any>(CUSTOMER_READBACK, { id: gidFor("Customer", externalId) });
    const remote = rb?.customer ?? rb;
    if (customer.email != null && remote?.email != null) {
      if (String(customer.email).toLowerCase() !== String(remote.email).toLowerCase()) {
        return { ok: false, error: `readback_mismatch: email expected ${customer.email} got ${remote.email}` };
      }
    }

    await saveCustomerIdentity(args.prisma, {
      organizationId: args.organizationId,
      customerId: customer.id,
      storeId,
      externalId,
      email: customer.email ?? null,
      phone: customer.phone ?? null,
    });

    return { ok: true, responseSummary: { platform: "shopify", externalId } };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}
