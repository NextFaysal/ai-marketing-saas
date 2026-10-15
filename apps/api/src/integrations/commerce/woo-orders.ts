import { decryptJson } from "../crypto";
import { WooClient } from "../woocommerce/woo.client";
import { minorToDecimal } from "./catalog-content";
import {
  errMsg, failOrder, loadCustomer, loadOrder, loadOrderItems, okOrder, orderPushBlocker,
  type OrderArgs,
} from "./order-content";
import type { AdapterExecuteResult } from "./adapter";

/**
 * EC5 — WooCommerce order write-back (REST v3).
 *
 * Honest platform notes:
 *  - Woo core has NO tracking field. A fulfilment is therefore a
 *    customer-visible order note (which Woo emails per its own
 *    settings) + tracking meta_data keys (tracking_provider /
 *    tracking_number, plus the store's configured shipment-plugin
 *    key when Store.courierTrackingMetaKey is set).
 *  - Refund restock only happens through refund line_items in
 *    Woo's real shape; we include them only when the refund amount
 *    exactly equals the matched remote lines' total (a partial
 *    amount-only refund cannot name lines truthfully) and say so
 *    in the response summary otherwise.
 *  - The local delivery address is one free string, so it is
 *    pushed as shipping.address_1 only — documented limit.
 */

function buildClient(args: OrderArgs): { client: WooClient } | { error: string } {
  const encrypted = args.integration?.credential?.encryptedData ?? args.integration?.credential?.encrypted_data ?? null;
  if (!encrypted) return { error: "woo_credentials_missing" };
  let secrets: any;
  try { secrets = decryptJson<any>(encrypted); } catch { return { error: "woo_credentials_missing" }; }
  if (!secrets?.consumerKey || !secrets?.consumerSecret) return { error: "woo_credentials_missing" };
  return { client: new WooClient(args.store.url, { consumerKey: secrets.consumerKey, consumerSecret: secrets.consumerSecret }, args.fetchFn) };
}

async function withOrder(args: OrderArgs, fn: (client: WooClient, order: any) => Promise<AdapterExecuteResult>): Promise<AdapterExecuteResult> {
  const order = await loadOrder(args);
  const blocker = orderPushBlocker(order, args.store);
  if (blocker) return failOrder(args, order, blocker);
  const built = buildClient(args);
  if ("error" in built) return failOrder(args, order, built.error);
  try {
    return await fn(built.client, order);
  } catch (e) {
    return failOrder(args, order, errMsg(e));
  }
}

export async function pushOrderStatus(args: OrderArgs): Promise<AdapterExecuteResult> {
  const status = String(args.payload?.status ?? "");
  if (!status) return failOrder(args, await loadOrder(args), "status_missing");
  return withOrder(args, async (client, order) => {
    await client.put<any>(`/orders/${order.externalId}`, { status });
    const { data: remote } = await client.get<any>(`/orders/${order.externalId}`);
    if (String(remote?.status ?? "") !== status) {
      return failOrder(args, order, `readback_mismatch: status expected ${status} got ${remote?.status ?? "?"}`);
    }
    return okOrder(args, order, { platform: "woocommerce", externalId: order.externalId, status });
  });
}

export async function cancelOrder(args: OrderArgs): Promise<AdapterExecuteResult> {
  return pushOrderStatus({ ...args, payload: { ...args.payload, status: "cancelled" } });
}

export async function createFulfillment(args: OrderArgs): Promise<AdapterExecuteResult> {
  const trackingCode = String(args.payload?.trackingCode ?? "");
  const provider = String(args.payload?.courierProvider ?? "");
  if (!trackingCode) return failOrder(args, await loadOrder(args), "tracking_code_missing");
  return withOrder(args, async (client, order) => {
    const noteText = `আপনার পার্সেলটি ${provider || "কুরিয়ার"}-এ পাঠানো হয়েছে। Tracking: ${trackingCode}`;
    await client.post<any>(`/orders/${order.externalId}/notes`, { note: noteText, customer_note: true });
    const meta: any[] = [
      { key: "tracking_provider", value: provider },
      { key: "tracking_number", value: trackingCode },
    ];
    const pluginKey = args.store?.courierTrackingMetaKey;
    if (pluginKey) meta.push({ key: String(pluginKey), value: trackingCode });
    await client.put<any>(`/orders/${order.externalId}`, { meta_data: meta });
    // Read-back: the customer note carrying the tracking code must exist.
    const { data: notes } = await client.get<any[]>(`/orders/${order.externalId}/notes`);
    const found = (notes ?? []).some((n: any) => String(n?.note ?? "").includes(trackingCode));
    if (!found) return failOrder(args, order, "readback_mismatch: tracking note not found after create");
    return okOrder(args, order, { platform: "woocommerce", externalId: order.externalId, trackingCode, pluginMetaKey: pluginKey ?? null });
  });
}

export async function pushOrderNote(args: OrderArgs): Promise<AdapterExecuteResult> {
  const note = String(args.payload?.note ?? "").trim();
  if (!note) return failOrder(args, await loadOrder(args), "note_missing");
  return withOrder(args, async (client, order) => {
    await client.post<any>(`/orders/${order.externalId}/notes`, { note, customer_note: true });
    const { data: notes } = await client.get<any[]>(`/orders/${order.externalId}/notes`);
    const found = (notes ?? []).some((n: any) => String(n?.note ?? "") === note);
    if (!found) return failOrder(args, order, "readback_mismatch: note not found after create");
    return okOrder(args, order, { platform: "woocommerce", externalId: order.externalId });
  });
}

export async function pushRefund(args: OrderArgs): Promise<AdapterExecuteResult> {
  const amountMinor = String(args.payload?.amountMinor ?? "");
  if (!/^\d+$/.test(amountMinor) || amountMinor === "0") return failOrder(args, await loadOrder(args), "refund_amount_invalid");
  return withOrder(args, async (client, order) => {
    const body: Record<string, any> = { amount: minorToDecimal(amountMinor), reason: args.payload?.reason ?? undefined };
    let restockApplied = false;
    if (args.payload?.restock === true) {
      const { data: remote } = await client.get<any>(`/orders/${order.externalId}`);
      const remoteLines: any[] = remote?.line_items ?? [];
      const matched = remoteLines.map((l: any) => ({
        id: l.id,
        quantity: l.quantity,
        refund_total: minorToDecimal(Math.round(Number(l.total ?? 0) * 100)),
        totalMinor: Math.round(Number(l.total ?? 0) * 100),
      }));
      const linesTotal = matched.reduce((s, l) => s + l.totalMinor, 0);
      if (matched.length > 0 && linesTotal === Number(BigInt(amountMinor))) {
        body.line_items = matched.map(({ id, quantity, refund_total }) => ({ id, quantity, refund_total, restock: true }));
        restockApplied = true;
      }
    }
    const { data: refund } = await client.post<any>(`/orders/${order.externalId}/refunds`, body);
    if (!refund?.id) return failOrder(args, order, "woo_refund_missing_id");
    // Read-back: the refund must be listed on the order.
    const { data: refunds } = await client.get<any[]>(`/orders/${order.externalId}/refunds`);
    const found = (refunds ?? []).some((r: any) => String(r?.id) === String(refund.id));
    if (!found) return failOrder(args, order, "readback_mismatch: refund not found after create");
    return okOrder(args, order, { platform: "woocommerce", externalId: order.externalId, refundId: String(refund.id), restockApplied });
  });
}

export async function pushOrderAddress(args: OrderArgs): Promise<AdapterExecuteResult> {
  const address = String(args.payload?.address ?? "").trim();
  if (!address) return failOrder(args, await loadOrder(args), "address_missing");
  return withOrder(args, async (client, order) => {
    await client.put<any>(`/orders/${order.externalId}`, { shipping: { address_1: address } });
    const { data: remote } = await client.get<any>(`/orders/${order.externalId}`);
    if (String(remote?.shipping?.address_1 ?? "") !== address) {
      return failOrder(args, order, `readback_mismatch: shipping.address_1 expected ${address} got ${remote?.shipping?.address_1 ?? "?"}`);
    }
    return okOrder(args, order, { platform: "woocommerce", externalId: order.externalId, limit: "address_1_only_free_string" });
  });
}

/**
 * Draft order = a real Woo order in "pending" status (the
 * generalized form of the chat-order createOrder path). On success
 * the local order BECOMES the store order through the existing
 * identity: externalId/externalNumber/source/storeId are linked.
 */
export async function createDraftOrder(args: OrderArgs): Promise<AdapterExecuteResult> {
  const order = await loadOrder(args);
  if (!order) return failOrder(args, order, "order_not_found");
  if (order.storeDraftId || (order.storeId && order.source === "woocommerce")) {
    return failOrder(args, order, "order_already_in_store");
  }
  const built = buildClient(args);
  if ("error" in built) return failOrder(args, order, built.error);
  const client = built.client;
  try {
    const items = await loadOrderItems(args.prisma, order.id);
    if (!items.length) return failOrder(args, order, "order_has_no_items");
    const lineItems: any[] = [];
    for (const item of items) {
      if (!item.externalProductId) return failOrder(args, order, `woo_draft_item_not_in_store: ${item.name}`);
      lineItems.push({
        product_id: Number(item.externalProductId),
        ...(item.externalVariationId ? { variation_id: Number(item.externalVariationId) } : {}),
        quantity: item.quantity,
      });
    }
    const customer = await loadCustomer(args.prisma, args.organizationId, order.customerId);
    const nameParts = [customer?.firstName, customer?.lastName].filter(Boolean).join(" ");
    const created = await client.createOrder({
      status: "pending",
      set_paid: false,
      currency: order.currency ?? "BDT",
      line_items: lineItems,
      billing: { first_name: nameParts || undefined, email: customer?.email ?? undefined, phone: customer?.phone ?? undefined, address_1: order.address ?? undefined },
      shipping: { first_name: nameParts || undefined, address_1: order.address ?? undefined },
    });
    if (!created?.id) return failOrder(args, order, "woo_draft_missing_id");
    const { data: remote } = await client.get<any>(`/orders/${created.id}`);
    if (String(remote?.status ?? "") !== "pending") {
      return failOrder(args, order, `readback_mismatch: draft status expected pending got ${remote?.status ?? "?"}`);
    }
    return okOrder(args, order, { platform: "woocommerce", externalId: String(created.id), draft: true }, {
      externalId: String(created.id),
      externalNumber: created.number != null ? String(created.number) : order.externalNumber,
      source: "woocommerce",
      storeId: args.store.id,
    });
  } catch (e) {
    return failOrder(args, order, errMsg(e));
  }
}
