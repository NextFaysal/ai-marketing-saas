import type { AdapterExecuteResult } from "./adapter";

/**
 * EC5 — shared helpers for the order-side commerce adapters
 * (woo-orders.ts / shopify-orders.ts). The discipline mirrors the
 * EC3 catalog adapters:
 *  - the order row is loaded org-scoped by payload.orderId;
 *  - every platform write is verified by READ-BACK where the
 *    platform allows reading the thing we just wrote; a mismatch
 *    is a failure with a verbatim summary, never a silent success;
 *  - the outcome is mirrored onto Order.storeSyncStatus /
 *    storeSyncError (the fields chat orders already use — EC5
 *    reuses them as "last store push result" for ALL order ops,
 *    so the orders UI has exactly one place to look).
 */

export interface OrderArgs {
  prisma: any;
  organizationId: string;
  store: any;
  integration?: any;
  payload: Record<string, any>;
  fetchFn?: typeof fetch;
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function loadOrder(args: OrderArgs): Promise<any | null> {
  const orderId = args.payload?.orderId;
  if (!orderId) return null;
  try {
    return await args.prisma.order.findFirst({ where: { id: orderId, organizationId: args.organizationId } });
  } catch {
    return null;
  }
}

export async function loadOrderItems(prisma: any, orderId: string): Promise<any[]> {
  try {
    return (await prisma.orderItem.findMany({ where: { orderId } })) ?? [];
  } catch {
    return [];
  }
}

export async function loadCustomer(prisma: any, organizationId: string, customerId: string | null): Promise<any | null> {
  if (!customerId) return null;
  try {
    return await prisma.customer.findFirst({ where: { id: customerId, organizationId } });
  } catch {
    return null;
  }
}

export async function markOrderSync(
  prisma: any,
  order: any,
  ok: boolean,
  error?: string | null,
  extra?: Record<string, any>,
): Promise<void> {
  if (!order?.id) return;
  try {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        storeSyncStatus: ok ? "synced" : "failed",
        storeSyncError: ok ? null : (error ?? "unknown_error"),
        ...(extra ?? {}),
      },
    });
  } catch {
    /* the outbox row is the durable record; this mirror is best-effort */
  }
}

export async function failOrder(
  args: OrderArgs,
  order: any,
  error: string,
  responseSummary?: any,
): Promise<AdapterExecuteResult> {
  await markOrderSync(args.prisma, order, false, error);
  return { ok: false, error, ...(responseSummary !== undefined ? { responseSummary } : {}) };
}

export async function okOrder(
  args: OrderArgs,
  order: any,
  responseSummary?: any,
  extra?: Record<string, any>,
): Promise<AdapterExecuteResult> {
  await markOrderSync(args.prisma, order, true, null, extra);
  return { ok: true, ...(responseSummary !== undefined ? { responseSummary } : {}) };
}

/** An order that can be pushed to must belong to this store and
 *  carry the platform's own id. Returns a verbatim blocker or null. */
export function orderPushBlocker(order: any, store: any): string | null {
  if (!order) return "order_not_found";
  if (!order.storeId || order.storeId !== store?.id) return "order_store_mismatch";
  if (!order.externalId) return "order_external_id_missing";
  return null;
}
