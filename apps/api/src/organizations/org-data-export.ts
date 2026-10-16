import { NotFoundException } from "@nestjs/common";

/**
 * AB8 (AX25) — shared organization data-bundle builder.
 *
 * Extracted from AdminService.exportOrgData (Milestone 40) so the
 * platform-admin export and the merchant Data Tools export build
 * EXACTLY the same core bundle from one code path.
 *
 * `legacyBundle` is byte-identical in shape to what the admin
 * export has always returned: the same 12 core tables, the same
 * key names, the same safe integration subset, money columns
 * stringified, and the same BigInt → string jsonSafe pass over
 * the whole object. AdminService returns `legacyBundle`
 * untouched, so the historical admin response never changes.
 *
 * The merchant file pipeline wraps:
 *   { manifest, data: { ...legacyBundle, orderItems, mediaAssets } }
 * where the two extensions are deliberate and bounded:
 *  - orderItems: the org's orders' line items (OrderItem has no
 *    organizationId — it is reached through the org's order ids);
 *  - mediaAssets: METADATA ONLY (id, kind, name, contentType,
 *    sizeBytes, storageKey, origin, createdAt) — never the bytes.
 *
 * Credential tables are NEVER included — integrations export as
 * provider/status metadata only, exactly as the admin builder
 * has always done.
 *
 * Pagination: the historical builder used a flat `take: 5000`
 * per table, silently dropping everything past it. This builder
 * pages each table by id cursor in chunks of 1,000 up to a hard
 * ceiling of 200,000 rows per table; the manifest records the
 * real row count per table and `truncated: true` when the
 * ceiling cut a table short (proven by a one-row probe past the
 * ceiling) — truncation is reported, never hidden.
 */

export const ORG_EXPORT_PAGE_SIZE = 1000;
export const ORG_EXPORT_MAX_ROWS_PER_TABLE = 200_000;

export interface OrgExportTableStat { rows: number; truncated: boolean }

export interface OrgDataBundleResult {
  /** Exactly what AdminService.exportOrgData has always returned. */
  legacyBundle: Record<string, any>;
  manifest: {
    exportedAt: string;
    exportedBy: string;
    tables: Record<string, OrgExportTableStat>;
  };
  counts: Record<string, number>;
  orderItems: any[];
  mediaAssets: any[];
  /** legacyBundle + the two deliberate extensions (file pipeline `data`). */
  data: Record<string, any>;
}

/** Money columns are BigInt — the export must be plain JSON. */
export function jsonSafe(v: any): any {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x)]));
  }
  return v;
}

interface PageResult { rows: any[]; truncated: boolean }

/**
 * Page one org-scoped table by id cursor. A missing delegate or
 * a failing first page yields [] (the historical grab semantics);
 * a failure mid-pagination keeps the rows already fetched.
 */
async function grabPaged(
  p: any,
  table: string,
  where: Record<string, unknown>,
  opts: { select?: Record<string, boolean> } = {},
): Promise<PageResult> {
  const delegate = p?.[table];
  if (!delegate?.findMany) return { rows: [], truncated: false };
  const rows: any[] = [];
  let cursorId: string | undefined;
  while (rows.length < ORG_EXPORT_MAX_ROWS_PER_TABLE) {
    const take = Math.min(ORG_EXPORT_PAGE_SIZE, ORG_EXPORT_MAX_ROWS_PER_TABLE - rows.length);
    let chunk: any[];
    try {
      chunk = await delegate.findMany({
        where,
        take,
        orderBy: { id: "asc" },
        ...(opts.select ? { select: opts.select } : {}),
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
    } catch {
      return { rows, truncated: false };
    }
    if (!Array.isArray(chunk) || chunk.length === 0) return { rows, truncated: false };
    rows.push(...chunk);
    if (chunk.length < take) return { rows, truncated: false };
    const lastId = chunk[chunk.length - 1]?.id;
    if (!lastId) return { rows, truncated: false };
    cursorId = String(lastId);
    if (rows.length >= ORG_EXPORT_MAX_ROWS_PER_TABLE) {
      // Probe one row past the ceiling so `truncated` is a fact,
      // not a guess from hitting the cap exactly.
      let truncated = false;
      try {
        const probe = await delegate.findMany({
          where,
          take: 1,
          orderBy: { id: "asc" },
          ...(opts.select ? { select: opts.select } : {}),
          cursor: { id: cursorId },
          skip: 1,
        });
        truncated = Array.isArray(probe) && probe.length > 0;
      } catch { truncated = false; }
      return { rows, truncated };
    }
  }
  return { rows, truncated: false };
}

/** OrderItems hang off orders (no organizationId of their own). */
async function grabOrderItems(p: any, orders: any[]): Promise<PageResult> {
  const all: any[] = [];
  let truncated = false;
  const orderIds = (orders ?? []).map((o) => o?.id).filter(Boolean);
  for (let i = 0; i < orderIds.length; i += ORG_EXPORT_PAGE_SIZE) {
    if (all.length >= ORG_EXPORT_MAX_ROWS_PER_TABLE) { truncated = true; break; }
    const group = orderIds.slice(i, i + ORG_EXPORT_PAGE_SIZE);
    const page = await grabPaged(p, "orderItem", { orderId: { in: group } });
    all.push(...page.rows);
    if (page.truncated) truncated = true;
    if (all.length > ORG_EXPORT_MAX_ROWS_PER_TABLE) {
      all.splice(ORG_EXPORT_MAX_ROWS_PER_TABLE);
      truncated = true;
    }
  }
  return { rows: all, truncated };
}

const MEDIA_ASSET_SELECT = {
  id: true, kind: true, name: true, contentType: true, sizeBytes: true,
  storageKey: true, origin: true, createdAt: true,
} as const;

export async function buildOrgDataBundle(
  prisma: any,
  organizationId: string,
  opts: { exportedBy: string },
): Promise<OrgDataBundleResult> {
  const p = prisma as any;
  const org = await p.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new NotFoundException("Organization not found");
  const where = { organizationId };

  const [profilePage, membershipsPage, productsPage, ordersPage, customersPage, leadsPage,
    conversationsPage, plansPage, integrationsPage, paymentsPage, ticketsPage, mediaPage] = await Promise.all([
    // businessProfile is a singleton per org (unique organizationId).
    (async (): Promise<PageResult> => {
      try {
        const profile = await p.businessProfile?.findUnique({ where: { organizationId } });
        return { rows: profile ? [profile] : [], truncated: false };
      } catch { return { rows: [], truncated: false }; }
    })(),
    grabPaged(p, "membership", where),
    grabPaged(p, "product", where),
    grabPaged(p, "order", where),
    grabPaged(p, "customer", where),
    grabPaged(p, "lead", where),
    grabPaged(p, "channelConversation", where),
    grabPaged(p, "campaignPlan", where),
    grabPaged(p, "integration", where),
    grabPaged(p, "saasPayment", where),
    grabPaged(p, "supportTicket", where),
    grabPaged(p, "mediaAsset", where, { select: { ...MEDIA_ASSET_SELECT } }),
  ]);
  const profile = profilePage.rows[0] ?? null;
  const memberships = membershipsPage.rows;
  const orders = ordersPage.rows;

  const subscription = await (async () => {
    try {
      return await p.subscription?.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" } }) ?? null;
    } catch { return null; }
  })();

  const orderItemsPage = await grabOrderItems(p, orders);

  // Member user summaries, resolved in id chunks (same select and
  // same { ...membership, user } shape as the historical builder).
  const memberUsers: any[] = [];
  const memberIds = memberships.map((m: any) => m.userId).filter(Boolean);
  for (let i = 0; i < memberIds.length; i += ORG_EXPORT_PAGE_SIZE) {
    try {
      const users = await p.user.findMany({
        where: { id: { in: memberIds.slice(i, i + ORG_EXPORT_PAGE_SIZE) } },
        select: { id: true, email: true, name: true, status: true },
      });
      if (Array.isArray(users)) memberUsers.push(...users);
    } catch { /* historical behaviour: missing users resolve to null below */ }
  }

  const exportedAt = new Date().toISOString();
  const bundle = {
    exportedAt,
    exportedBy: opts.exportedBy,
    organization: { ...org, creditMinor: BigInt(org.creditMinor ?? 0).toString() },
    businessProfile: profile,
    members: memberships.map((m: any) => ({ ...m, user: (memberUsers as any[]).find((u) => u.id === m.userId) ?? null })),
    products: productsPage.rows,
    orders,
    customers: customersPage.rows,
    leads: leadsPage.rows,
    conversations: conversationsPage.rows,
    campaignPlans: plansPage.rows,
    integrations: integrationsPage.rows.map((i: any) => ({ id: i.id, provider: i.provider, status: i.status, externalAccountId: i.externalAccountId, lastSyncAt: i.lastSyncAt, createdAt: i.createdAt })),
    subscription,
    payments: paymentsPage.rows.map((pay: any) => ({ ...pay, amountMinor: BigInt(pay.amountMinor ?? 0).toString(), refundedMinor: BigInt(pay.refundedMinor ?? 0).toString() })),
    supportTickets: ticketsPage.rows,
  };
  const legacyBundle = jsonSafe(bundle);

  const orderItems = jsonSafe(orderItemsPage.rows);
  const mediaAssets = jsonSafe(mediaPage.rows.map((a: any) => ({
    id: a.id, kind: a.kind, name: a.name, contentType: a.contentType, sizeBytes: a.sizeBytes,
    storageKey: a.storageKey, origin: a.origin, createdAt: a.createdAt,
  })));

  const tables: Record<string, OrgExportTableStat> = {
    organization: { rows: 1, truncated: false },
    businessProfile: { rows: profile ? 1 : 0, truncated: false },
    members: { rows: memberships.length, truncated: membershipsPage.truncated },
    products: { rows: productsPage.rows.length, truncated: productsPage.truncated },
    orders: { rows: orders.length, truncated: ordersPage.truncated },
    customers: { rows: customersPage.rows.length, truncated: customersPage.truncated },
    leads: { rows: leadsPage.rows.length, truncated: leadsPage.truncated },
    conversations: { rows: conversationsPage.rows.length, truncated: conversationsPage.truncated },
    campaignPlans: { rows: plansPage.rows.length, truncated: plansPage.truncated },
    integrations: { rows: integrationsPage.rows.length, truncated: integrationsPage.truncated },
    subscription: { rows: subscription ? 1 : 0, truncated: false },
    payments: { rows: paymentsPage.rows.length, truncated: paymentsPage.truncated },
    supportTickets: { rows: ticketsPage.rows.length, truncated: ticketsPage.truncated },
    orderItems: { rows: orderItems.length, truncated: orderItemsPage.truncated },
    mediaAssets: { rows: mediaAssets.length, truncated: mediaPage.truncated },
  };
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.rows]));
  const manifest = { exportedAt, exportedBy: opts.exportedBy, tables };
  const data = { ...legacyBundle, orderItems, mediaAssets };
  return { legacyBundle, manifest, counts, orderItems, mediaAssets, data };
}
