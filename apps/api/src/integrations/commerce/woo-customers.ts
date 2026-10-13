import { decryptJson } from "../crypto";
import { WooClient } from "../woocommerce/woo.client";
import { loadCustomerForPush, loadCustomerIdentity, saveCustomerIdentity } from "./customer-content";
import type { AdapterExecuteResult } from "./adapter";

/**
 * EC6 — WooCommerce customer write-back (REST v3).
 * Success is only recorded after a read-back GET matches the
 * customer's email (when both sides have one).
 */

export interface CustomerArgs {
  prisma: any;
  organizationId: string;
  store: any;
  integration?: any;
  payload: Record<string, any>;
  fetchFn?: typeof fetch;
}

function getEncrypted(integration: any): string | null {
  return integration?.credential?.encryptedData ?? integration?.credential?.encrypted_data ?? null;
}

function buildClient(args: CustomerArgs): { client: WooClient } | { error: string } {
  const encrypted = getEncrypted(args.integration);
  if (!encrypted) return { error: "woo_credentials_missing" };
  let secrets: any;
  try {
    secrets = decryptJson<any>(encrypted);
  } catch {
    return { error: "woo_credentials_missing" };
  }
  if (!secrets?.consumerKey || !secrets?.consumerSecret) return { error: "woo_credentials_missing" };
  const client = new WooClient(
    args.store.url,
    { consumerKey: secrets.consumerKey, consumerSecret: secrets.consumerSecret },
    args.fetchFn,
  );
  return { client };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function pushCustomer(args: CustomerArgs): Promise<{ ok: boolean; error?: string; responseSummary?: any }> {
  const customerId = args.payload?.customerId as string | undefined;
  if (!customerId) return { ok: false, error: "customer_not_found" };
  const customer = await loadCustomerForPush(args.prisma, args.organizationId, customerId);
  if (!customer) return { ok: false, error: "customer_not_found" };

  const built = buildClient(args);
  if ("error" in built) return { ok: false, error: built.error };
  const client = built.client;

  try {
    const storeId = String(args.store.id);
    const identity = await loadCustomerIdentity(args.prisma, storeId, customer.id);

    const body: Record<string, any> = {
      email: customer.email ?? undefined,
      first_name: customer.firstName ?? undefined,
      last_name: customer.lastName ?? undefined,
      billing: {
        first_name: customer.firstName ?? undefined,
        last_name: customer.lastName ?? undefined,
        email: customer.email ?? undefined,
        phone: customer.phone ?? undefined,
        address_1: customer.address?.address_1 ?? customer.address?.address1 ?? undefined,
      },
    };

    let response: any;
    if (identity?.externalId) {
      response = (await client.put<any>(`/customers/${identity.externalId}`, body)).data;
    } else {
      response = (await client.post<any>("/customers", body)).data;
    }

    const externalIdRaw = response?.id;
    if (externalIdRaw === undefined || externalIdRaw === null || externalIdRaw === "") {
      return { ok: false, error: "woo_customer_id_missing" };
    }
    const externalId = String(externalIdRaw);

    // Read-back verification.
    const remote = (await client.get<any>(`/customers/${externalId}`)).data;
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

    return { ok: true, responseSummary: { platform: "woocommerce", externalId } };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}
