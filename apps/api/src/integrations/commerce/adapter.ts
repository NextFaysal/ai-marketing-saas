export type CommerceOperation =
  | "push_product"
  | "push_inventory"
  | "archive_product"
  | "delete_product_remote"
  | "push_category"
  | "push_price"
  | "push_order_status"
  | "create_fulfillment"
  | "push_order_note"
  | "push_refund"
  | "cancel_order"
  | "push_order_address"
  | "create_draft_order"
  | "create_fulfillment"
  | "push_refund"
  | "push_customer"
  | "push_discount"
  | "register_webhooks";

export interface CommerceAdapterContext {
  organizationId: string;
  store: any;
  integration?: any;
  operation: CommerceOperation | string;
  payload: Record<string, any>;
}

export interface AdapterExecuteResult {
  ok: boolean;
  error?: string;
  responseSummary?: any;
}

export interface CommerceAdapter {
  platform: string;
  capabilities: Record<string, boolean>;
  execute(ctx: CommerceAdapterContext): Promise<AdapterExecuteResult>;
}

export const CAPABILITY_NOT_IMPLEMENTED = "capability_not_implemented";
