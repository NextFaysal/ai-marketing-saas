import { minorToDecimal } from "./catalog-content";
import { resolveShopifyClient } from "./shopify-catalog";
import {
  errMsg, failOrder, loadCustomer, loadOrder, loadOrderItems, okOrder, orderPushBlocker,
  type OrderArgs,
} from "./order-content";
import type { AdapterExecuteResult } from "./adapter";
import type { ShopifyGraphQLClient } from "../shopify/shopify-graphql.client";

/**
 * EC5 — Shopify order write-back (GraphQL Admin API, 2025-10).
 *
 * THE HONESTY RULE (plan §৩): Shopify has no arbitrary order
 * status. An order's state is derived from fulfilment + payment.
 * So push_order_status supports exactly:
 *   - "cancelled"            -> orderCancel mutation
 *   - pending/processing/on-hold -> already the open state;
 *     verified by read-back (not cancelled, not closed)
 *   - "completed"            -> ok ONLY when the remote order is
 *     already fully fulfilled (read-back); we cannot force it
 *   - anything else (refunded / failed / returned / …)
 *     -> failed with verbatim "no_shopify_equivalent"
 * Payment-state changes are never faked.
 *
 * Tracking URL: no courier in this codebase exposes a public
 * tracking-URL pattern, so trackingInfo.url is omitted rather
 * than invented.
 */

const NO_EQUIVALENT = "no_shopify_equivalent";

function gid(kind: string, id: string): string {
  const s = String(id);
  return s.startsWith("gid://") ? s : `gid://shopify/${kind}/${s}`;
}
function gidTail(g: string): string {
  return String(g ?? "").split("/").pop() ?? "";
}

const ORDER_STATE_QUERY = `query EcOrderState($id: ID!) {
  order(id: $id) {
    id closed cancelledAt displayFulfillmentStatus displayFinancialStatus note
    fulfillments(first: 10) { id status trackingInfo { number company } }
    fulfillmentOrders(first: 5) { edges { node { id status } } }
    transactions(first: 10) { id status kind gateway }
    lineItems(first: 50) { edges { node { id quantity } } }
  }
}`;

async function orderState(client: ShopifyGraphQLClient, externalId: string): Promise<any> {
  const data = await client.request<any>(ORDER_STATE_QUERY, { id: gid("Order", externalId) });
  return data?.order ?? null;
}

function userErrors(prefix: string, payload: any): string | null {
  const errs = payload?.userErrors ?? [];
  if (Array.isArray(errs) && errs.length > 0) {
    return `${prefix}: ${errs.map((e: any) => e?.message ?? String(e)).join("; ")}`;
  }
  return null;
}

async function withOrder(args: OrderArgs, fn: (client: ShopifyGraphQLClient, order: any) => Promise<AdapterExecuteResult>): Promise<AdapterExecuteResult> {
  const order = await loadOrder(args);
  const blocker = orderPushBlocker(order, args.store);
  if (blocker) return failOrder(args, order, blocker);
  const built = await resolveShopifyClient(args as any);
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
  if (status === "cancelled") return cancelOrder(args);
  return withOrder(args, async (client, order) => {
    if (["pending", "processing", "on-hold"].includes(status)) {
      const remote = await orderState(client, order.externalId);
      if (!remote) return failOrder(args, order, "shopify_order_not_found");
      if (remote.cancelledAt || remote.closed) {
        return failOrder(args, order, `readback_mismatch: expected open order, remote cancelledAt=${remote.cancelledAt ?? "null"} closed=${remote.closed}`);
      }
      return okOrder(args, order, { platform: "shopify", externalId: order.externalId, status, note: "shopify_open_state_verified" });
    }
    if (status === "completed") {
      const remote = await orderState(client, order.externalId);
      if (!remote) return failOrder(args, order, "shopify_order_not_found");
      if (String(remote.displayFulfillmentStatus ?? "") === "FULFILLED") {
        return okOrder(args, order, { platform: "shopify", externalId: order.externalId, status, note: "fulfilled_state_verified" });
      }
      return failOrder(args, order, NO_EQUIVALENT, { localStatus: status, remoteFulfillmentStatus: remote.displayFulfillmentStatus ?? null });
    }
    return failOrder(args, order, NO_EQUIVALENT, { localStatus: status });
  });
}

export async function cancelOrder(args: OrderArgs): Promise<AdapterExecuteResult> {
  return withOrder(args, async (client, order) => {
    const data = await client.request<any>(
      `mutation EcOrderCancel($orderId: ID!, $refund: Boolean!, $restock: Boolean!, $reason: OrderCancelReason!, $notifyCustomer: Boolean!, $staffNote: String) {
        orderCancel(orderId: $orderId, refund: $refund, restock: $restock, reason: $reason, notifyCustomer: $notifyCustomer, staffNote: $staffNote) {
          job { id } userErrors { field message }
        }
      }`,
      { orderId: gid("Order", order.externalId), refund: false, restock: false, reason: "OTHER", notifyCustomer: false, staffNote: args.payload?.reason ?? "Cancelled from Qosprey SaaS" },
    );
    const ue = userErrors("shopify_order_cancel", data?.orderCancel);
    if (ue) return failOrder(args, order, ue);
    const remote = await orderState(client, order.externalId);
    if (!remote?.cancelledAt && remote?.closed !== true) {
      // orderCancel is job-based; the cancel may still be processing.
      // We only claim success when the read-back shows it — otherwise
      // the push is recorded failed and can be replayed/checked.
      return failOrder(args, order, "readback_mismatch: order not cancelled on read-back (cancel job may still be running)");
    }
    return okOrder(args, order, { platform: "shopify", externalId: order.externalId, status: "cancelled" });
  });
}

export async function createFulfillment(args: OrderArgs): Promise<AdapterExecuteResult> {
  const trackingCode = String(args.payload?.trackingCode ?? "");
  const provider = String(args.payload?.courierProvider ?? "");
  if (!trackingCode) return failOrder(args, await loadOrder(args), "tracking_code_missing");
  return withOrder(args, async (client, order) => {
    const state = await orderState(client, order.externalId);
    if (!state) return failOrder(args, order, "shopify_order_not_found");
    const foEdges = state.fulfillmentOrders?.edges ?? [];
    const open = foEdges.find((e: any) => ["OPEN", "IN_PROGRESS", "SCHEDULED"].includes(String(e?.node?.status ?? "OPEN"))) ?? foEdges[0];
    if (!open?.node?.id) return failOrder(args, order, "shopify_fulfillment_order_missing");
    const data = await client.request<any>(
      `mutation EcFulfillmentCreate($fulfillment: FulfillmentV2Input!) {
        fulfillmentCreateV2(fulfillment: $fulfillment) {
          fulfillment { id status trackingInfo { number company } }
          userErrors { field message }
        }
      }`,
      {
        fulfillment: {
          notifyCustomer: true,
          trackingInfo: { number: trackingCode, company: provider || undefined },
          lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: open.node.id }],
        },
      },
    );
    const ue = userErrors("shopify_fulfillment_create", data?.fulfillmentCreateV2);
    if (ue) return failOrder(args, order, ue);
    const created = data?.fulfillmentCreateV2?.fulfillment;
    if (!created?.id) return failOrder(args, order, "shopify_fulfillment_missing_id");
    // Read-back: a fulfilment carrying our tracking number must exist.
    const after = await orderState(client, order.externalId);
    const found = (after?.fulfillments ?? []).some((f: any) => String(f?.trackingInfo?.number ?? "") === trackingCode);
    if (!found) return failOrder(args, order, "readback_mismatch: tracking number not found on read-back");
    return okOrder(args, order, { platform: "shopify", externalId: order.externalId, fulfillmentId: gidTail(created.id), trackingCode });
  });
}

export async function pushOrderNote(args: OrderArgs): Promise<AdapterExecuteResult> {
  const note = String(args.payload?.note ?? "").trim();
  if (!note) return failOrder(args, await loadOrder(args), "note_missing");
  return withOrder(args, async (client, order) => {
    // Shopify's order note is a single field (no append API): we set
    // it to the merchant's note — documented behaviour, the note the
    // merchant sends from the SaaS replaces the store note field.
    const data = await client.request<any>(
      `mutation EcOrderNote($input: OrderInput!) {
        orderUpdate(input: $input) { order { id note } userErrors { field message } }
      }`,
      { input: { id: gid("Order", order.externalId), note } },
    );
    const ue = userErrors("shopify_order_update", data?.orderUpdate);
    if (ue) return failOrder(args, order, ue);
    const remote = await orderState(client, order.externalId);
    if (String(remote?.note ?? "") !== note) return failOrder(args, order, "readback_mismatch: note differs on read-back");
    return okOrder(args, order, { platform: "shopify", externalId: order.externalId });
  });
}

export async function pushRefund(args: OrderArgs): Promise<AdapterExecuteResult> {
  const amountMinor = String(args.payload?.amountMinor ?? "");
  if (!/^\d+$/.test(amountMinor) || amountMinor === "0") return failOrder(args, await loadOrder(args), "refund_amount_invalid");
  return withOrder(args, async (client, order) => {
    const state = await orderState(client, order.externalId);
    if (!state) return failOrder(args, order, "shopify_order_not_found");
    const input: Record<string, any> = { orderId: gid("Order", order.externalId), note: args.payload?.reason ?? undefined, notify: false };
    let restockApplied = false;
    if (args.payload?.restock === true) {
      const locTable = (args.prisma as any).storeLocation;
      const loc = locTable?.findFirst ? await locTable.findFirst({ where: { organizationId: args.organizationId, storeId: args.store.id, isDefault: true } }).catch(() => null) : null;
      const lineEdges = state.lineItems?.edges ?? [];
      if (loc?.externalLocationId && lineEdges.length > 0) {
        input.refundLineItems = lineEdges.map((e: any) => ({
          lineItemId: e.node.id, quantity: e.node.quantity, restockType: "RETURN",
          locationId: gid("Location", loc.externalLocationId),
        }));
        restockApplied = true;
      }
    }
    if (!restockApplied) {
      const parent = (state.transactions ?? []).find((t: any) => t.status === "SUCCESS" && ["SALE", "CAPTURE"].includes(String(t.kind)));
      if (!parent) return failOrder(args, order, "shopify_refund_no_parent_transaction");
      input.transactions = [{
        orderId: gid("Order", order.externalId), parentId: parent.id, gateway: parent.gateway ?? undefined,
        kind: "REFUND", amount: minorToDecimal(amountMinor),
      }];
    }
    const data = await client.request<any>(
      `mutation EcRefundCreate($input: RefundInput!) {
        refundCreate(input: $input) { refund { id } userErrors { field message } }
      }`,
      { input },
    );
    const ue = userErrors("shopify_refund_create", data?.refundCreate);
    if (ue) return failOrder(args, order, ue);
    const refundId = data?.refundCreate?.refund?.id;
    if (!refundId) return failOrder(args, order, "shopify_refund_missing_id");
    return okOrder(args, order, { platform: "shopify", externalId: order.externalId, refundId: gidTail(refundId), restockApplied });
  });
}

export async function pushOrderAddress(args: OrderArgs): Promise<AdapterExecuteResult> {
  const order = await loadOrder(args);
  const parts = args.payload?.addressParts;
  if (!parts || typeof parts !== "object" || !parts.address1) {
    // The local model stores ONE free-string address; Shopify needs
    // structured MailingAddress fields. Refuse honestly (task rule).
    return failOrder(args, order, "shopify_address_needs_structured_fields");
  }
  return withOrder(args, async (client, o) => {
    const data = await client.request<any>(
      `mutation EcOrderAddress($input: OrderInput!) {
        orderUpdate(input: $input) { order { id } userErrors { field message } }
      }`,
      { input: { id: gid("Order", o.externalId), shippingAddress: parts } },
    );
    const ue = userErrors("shopify_order_update", data?.orderUpdate);
    if (ue) return failOrder(args, o, ue);
    return okOrder(args, o, { platform: "shopify", externalId: o.externalId });
  });
}

export async function createDraftOrder(args: OrderArgs): Promise<AdapterExecuteResult> {
  const order = await loadOrder(args);
  if (!order) return failOrder(args, order, "order_not_found");
  if (order.storeDraftId || (order.storeId && order.source === "shopify")) {
    return failOrder(args, order, "order_already_in_store");
  }
  const built = await resolveShopifyClient(args as any);
  if ("error" in built) return failOrder(args, order, built.error);
  const client = built.client;
  try {
    const items = await loadOrderItems(args.prisma, order.id);
    if (!items.length) return failOrder(args, order, "order_has_no_items");
    const lineItems: any[] = [];
    for (const item of items) {
      if (!item.externalVariationId) return failOrder(args, order, `shopify_draft_item_variant_unknown: ${item.name}`);
      lineItems.push({ variantId: gid("ProductVariant", item.externalVariationId), quantity: item.quantity });
    }
    const customer = await loadCustomer(args.prisma, args.organizationId, order.customerId);
    const input: Record<string, any> = { lineItems };
    if (customer?.email) input.email = customer.email;
    if (order.address) input.shippingAddress = { address1: order.address, firstName: customer?.firstName ?? undefined, lastName: customer?.lastName ?? undefined, phone: customer?.phone ?? undefined };
    const data = await client.request<any>(
      `mutation EcDraftCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) { draftOrder { id invoiceUrl } userErrors { field message } }
      }`,
      { input },
    );
    const ue = userErrors("shopify_draft_create", data?.draftOrderCreate);
    if (ue) return failOrder(args, order, ue);
    const draft = data?.draftOrderCreate?.draftOrder;
    if (!draft?.id || !draft?.invoiceUrl) return failOrder(args, order, "shopify_draft_missing_invoice_url");
    // Read-back: the draft must exist with the same invoice URL.
    const rb = await client.request<any>(
      `query EcDraftRead($id: ID!) { draftOrder(id: $id) { id invoiceUrl } }`,
      { id: draft.id },
    );
    if (String(rb?.draftOrder?.invoiceUrl ?? "") !== String(draft.invoiceUrl)) {
      return failOrder(args, order, "readback_mismatch: draft invoiceUrl differs on read-back");
    }
    return okOrder(args, order, { platform: "shopify", draftId: gidTail(draft.id), invoiceUrl: draft.invoiceUrl }, {
      storeDraftId: gidTail(draft.id),
      storeInvoiceUrl: draft.invoiceUrl,
      storeId: args.store.id,
    });
  } catch (e) {
    return failOrder(args, order, errMsg(e));
  }
}
