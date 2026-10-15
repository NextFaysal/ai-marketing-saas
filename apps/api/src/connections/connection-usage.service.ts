import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ConnectionsService } from "./connections.service";

/**
 * CC30 (Connect Center Next) — per-account usage insights +
 * the deliverability surface. Everything is computed from REAL
 * rows; where the schema cannot attribute a fact to a specific
 * account, the answer is null with an explicit attribution —
 * never a guessed split.
 *
 * Usage (GET connections/usage?days=7|30|90, default 30),
 * grouped per account using the overview's own target identity:
 * - messaging integrations: ChannelMessage rows on
 *   ChannelConversations BOUND to the integration
 *   (conversation.integrationId), split by direction. Legacy
 *   conversations with integrationId NULL on the same channel
 *   cannot be attributed to any one account: they are reported
 *   ONCE in the org-level `unattributed` list — and an
 *   integration with NO bound conversations while unbound ones
 *   exist on its channel reports null counts with
 *   attribution "unavailable" (its share of the unbound pool is
 *   unknowable). Practice conversations are synthetic and are
 *   excluded everywhere.
 * - social accounts: SocialPost rows with status "published"
 *   and publishedAt inside the window.
 * - store integrations (woocommerce/shopify): Order rows whose
 *   storeId is the integration's store and whose source matches
 *   the provider — the schema's actual order linkage (Order has
 *   no integrationId). Attribution is therefore "store": when
 *   two integrations of one provider share a store, both report
 *   the store's count, because no row-level split exists. An
 *   integration with no store reports null / "unavailable".
 * - courier integrations: CourierShipment rows carrying the
 *   CC29 integrationId. Legacy rows with integrationId NULL are
 *   the unattributed bucket, grouped by provider — never
 *   silently assigned to an account.
 * - payment gateways: TenantPaymentTransaction rows with
 *   status "verified_paid" (the ONLY state that means money
 *   moved) and environment "live" — CC19 sandbox test rows are
 *   excluded from volume, labelled by construction. Own
 *   gateways group by gatewayId; platform enablements group by
 *   (source "platform", provider).
 * - cost: ONLY from the org's own entered rates on
 *   MessagingSenderConfig (whatsappCostPerMessageMinor /
 *   emailCostPerMessageMinor) × the attributed sent count,
 *   labelled an estimate from the org's rate. No rate ⇒ cost
 *   null. SMS has a per-PART rate and no per-integration SMS
 *   message stream exists in the inbox schema, so no SMS cost
 *   is ever estimated here.
 * Accounts outside these groups (ads, AI, senders, analytics,
 * store rows — the store's orders already ride its integration)
 * are not part of the usage report.
 *
 * Deliverability (GET connections/deliverability) reads STORED
 * state only — it never runs a DNS lookup or a provider call:
 * - email: MS4's domain health is computed LIVE by
 *   MessagingService.getDomainHealth (DNS TXT at read time) and
 *   NOTHING is persisted. So this surface reports what IS
 *   stored — the tenant sender config's From domain + whether a
 *   DKIM selector is set — with spf/dkim status "not_recorded"
 *   (selector absent ⇒ dkim "not_checked", MS4's own word).
 *   For the same reason SPF/DKIM is NOT wired into the CC12
 *   monitoring state machine: that machine derives per-target
 *   states from stored account fields, and a DNS-derived state
 *   with no stored check record behind it would flap on DNS
 *   failures and alert on guesses. A persisted domain-health
 *   check (a Doctor-kind record) is the clean way to add it
 *   later; CC30 surfaces without alerting, deliberately.
 * - meta business verification: read from the CC15
 *   providerHealth snapshots stored on meta_page / ad-account
 *   rows (snapshot.business, fetched verbatim by the refresh —
 *   see ProviderHealthService). A row whose snapshot carries no
 *   business reports verificationStatus null (unknown); a row
 *   never refreshed has no entry here at all.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MESSAGE_SCAN_CAP = 50_000;

export interface UsageAccountEntry {
  targetType: string;
  targetId: string;
  category: string;
  provider: string;
  displayName: string;
  metrics: Record<string, number | string | null> | null;
  attribution: "integration" | "account" | "store" | "gateway" | "platform" | "unavailable";
  estimatedCostMinor: string | null;
  costRateMinor: number | null;
}

@Injectable()
export class ConnectionUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: ConnectionsService,
  ) {}

  private async safeFindMany(table: string, args: any): Promise<any[]> {
    const rows = await (this.prisma as any)[table].findMany(args).catch(() => []);
    return Array.isArray(rows) ? rows : [];
  }

  async getUsage(organizationId: string, daysRaw?: number | string, now = new Date()) {
    const days = [7, 30, 90].includes(Number(daysRaw)) ? Number(daysRaw) : 30;
    const since = new Date(now.getTime() - days * DAY_MS);
    const overview = await this.connections.getOverview(organizationId);
    const accounts: any[] = (overview?.categories ?? []).flatMap((c: any) => c.accounts ?? []);
    const senderConfig = await (this.prisma as any).messagingSenderConfig.findUnique({
      where: { organizationId },
    }).catch(() => null);
    const integrations = await this.safeFindMany("integration", { where: { organizationId } });
    const integrationById = new Map<string, any>(integrations.map((i: any) => [i.id, i]));

    const entries: UsageAccountEntry[] = [];
    const unattributed: any[] = [];

    // ---- messaging (per channel, computed once per channel) ----
    const messagingAccounts = accounts.filter((a) => a.source === "integration" && a.category === "messaging");
    const channels = [...new Set(messagingAccounts.map((a) => String(a.provider)))];
    const unboundByChannel = new Map<string, { convIds: string[]; received: number; sent: number }>();
    for (const channel of channels) {
      const unbound = await this.safeFindMany("channelConversation", {
        where: { organizationId, channel, integrationId: null },
        select: { id: true, isPractice: true },
      });
      const convIds = unbound.filter((c: any) => c.isPractice !== true).map((c: any) => c.id);
      let received = 0, sent = 0;
      if (convIds.length) {
        const msgs = await this.safeFindMany("channelMessage", {
          where: { conversationId: { in: convIds }, createdAt: { gte: since } },
          select: { direction: true }, take: MESSAGE_SCAN_CAP,
        });
        for (const m of msgs) { if (m.direction === "in") received++; else if (m.direction === "out") sent++; }
      }
      unboundByChannel.set(channel, { convIds, received, sent });
      if (convIds.length && (received + sent) > 0) {
        unattributed.push({ kind: "messaging", channel, messagesReceived: received, messagesSent: sent });
      }
    }

    for (const account of messagingAccounts) {
      const provider = String(account.provider);
      const convs = await this.safeFindMany("channelConversation", {
        where: { organizationId, integrationId: account.id },
        select: { id: true },
      });
      const unbound = unboundByChannel.get(provider);
      if (convs.length === 0 && unbound && unbound.convIds.length > 0) {
        entries.push({
          targetType: account.source, targetId: account.id, category: account.category, provider,
          displayName: account.displayName,
          metrics: { messagesReceived: null, messagesSent: null },
          attribution: "unavailable", estimatedCostMinor: null, costRateMinor: null,
        });
        continue;
      }
      let received = 0, sent = 0;
      if (convs.length) {
        const msgs = await this.safeFindMany("channelMessage", {
          where: { conversationId: { in: convs.map((c: any) => c.id) }, createdAt: { gte: since } },
          select: { direction: true }, take: MESSAGE_SCAN_CAP,
        });
        for (const m of msgs) { if (m.direction === "in") received++; else if (m.direction === "out") sent++; }
      }
      const rate = provider === "whatsapp" ? senderConfig?.whatsappCostPerMessageMinor
        : provider === "email" ? senderConfig?.emailCostPerMessageMinor
        : null;
      entries.push({
        targetType: account.source, targetId: account.id, category: account.category, provider,
        displayName: account.displayName,
        metrics: { messagesReceived: received, messagesSent: sent },
        attribution: "integration",
        estimatedCostMinor: typeof rate === "number" ? String(sent * rate) : null,
        costRateMinor: typeof rate === "number" ? rate : null,
      });
    }

    // ---- social accounts: published posts ----
    for (const account of accounts.filter((a) => a.source === "social_account")) {
      const posts = await this.safeFindMany("socialPost", {
        where: { organizationId, socialAccountId: account.id, status: "published", publishedAt: { gte: since } },
        select: { id: true },
      });
      entries.push({
        targetType: account.source, targetId: account.id, category: account.category, provider: String(account.provider),
        displayName: account.displayName,
        metrics: { postsPublished: posts.length },
        attribution: "account", estimatedCostMinor: null, costRateMinor: null,
      });
    }

    // ---- stores: orders via the store linkage ----
    for (const account of accounts.filter((a) => a.source === "integration" && a.category === "commerce" && ["woocommerce", "shopify"].includes(String(a.provider)))) {
      const integration = integrationById.get(account.id);
      if (!integration?.storeId) {
        entries.push({
          targetType: account.source, targetId: account.id, category: account.category, provider: String(account.provider),
          displayName: account.displayName,
          metrics: { ordersInWindow: null },
          attribution: "unavailable", estimatedCostMinor: null, costRateMinor: null,
        });
        continue;
      }
      const orders = await this.safeFindMany("order", {
        where: { organizationId, storeId: integration.storeId, source: String(account.provider), createdAt: { gte: since } },
        select: { id: true },
      });
      entries.push({
        targetType: account.source, targetId: account.id, category: account.category, provider: String(account.provider),
        displayName: account.displayName,
        metrics: { ordersInWindow: orders.length },
        attribution: "store", estimatedCostMinor: null, costRateMinor: null,
      });
    }

    // ---- couriers: shipments booked under the account ----
    const courierAccounts = accounts.filter((a) => a.source === "integration" && a.category === "courier");
    for (const account of courierAccounts) {
      const shipments = await this.safeFindMany("courierShipment", {
        where: { organizationId, integrationId: account.id, createdAt: { gte: since } },
        select: { id: true },
      });
      entries.push({
        targetType: account.source, targetId: account.id, category: account.category, provider: String(account.provider),
        displayName: account.displayName,
        metrics: { shipmentsBooked: shipments.length },
        attribution: "integration", estimatedCostMinor: null, costRateMinor: null,
      });
    }
    if (courierAccounts.length) {
      const legacy = await this.safeFindMany("courierShipment", {
        where: { organizationId, integrationId: null, createdAt: { gte: since } },
        select: { id: true, provider: true },
      });
      const byProvider = new Map<string, number>();
      for (const s of legacy) byProvider.set(String(s.provider), (byProvider.get(String(s.provider)) ?? 0) + 1);
      for (const [provider, count] of byProvider) {
        unattributed.push({ kind: "courier", provider, shipmentsBooked: count });
      }
    }

    // ---- payment gateways: verified money only ----
    const verifiedVolume = async (where: Record<string, unknown>) => {
      const txns = await this.safeFindMany("tenantPaymentTransaction", {
        where: { organizationId, status: "verified_paid", environment: "live", createdAt: { gte: since }, ...where },
        select: { amountMinor: true, currency: true },
      });
      let volume = 0n;
      const currencies = new Set<string>();
      for (const t of txns) {
        try { volume += BigInt(t.amountMinor ?? 0); } catch { /* a malformed row contributes nothing rather than a guess */ }
        if (t.currency) currencies.add(String(t.currency));
      }
      return {
        verifiedPayments: txns.length,
        verifiedVolumeMinor: volume.toString(),
        currency: currencies.size === 1 ? [...currencies][0] : null,
      };
    };
    for (const account of accounts.filter((a) => a.source === "tenant_payment_gateway")) {
      entries.push({
        targetType: account.source, targetId: account.id, category: account.category, provider: String(account.provider),
        displayName: account.displayName,
        metrics: await verifiedVolume({ gatewayId: account.id }),
        attribution: "gateway", estimatedCostMinor: null, costRateMinor: null,
      });
    }
    for (const account of accounts.filter((a) => a.source === "platform_payment_enablement")) {
      entries.push({
        targetType: account.source, targetId: account.id, category: account.category, provider: String(account.provider),
        displayName: account.displayName,
        metrics: await verifiedVolume({ source: "platform", provider: String(account.provider) }),
        attribution: "platform", estimatedCostMinor: null, costRateMinor: null,
      });
    }

    return { days, since, accounts: entries, unattributed };
  }

  async getDeliverability(organizationId: string) {
    const senderConfig = await (this.prisma as any).messagingSenderConfig.findUnique({
      where: { organizationId },
    }).catch(() => null);
    const fromAddress = senderConfig?.fromAddress ? String(senderConfig.fromAddress) : null;
    const domain = fromAddress?.includes("@") ? fromAddress.split("@").pop()!.toLowerCase() : null;
    const selectorSet = Boolean(senderConfig?.dkimSelector);
    const email = {
      configured: Boolean(domain),
      domain,
      source: domain ? "tenant" : "none",
      dkimSelectorSet: selectorSet,
      // MS4 records NOTHING about SPF/DKIM (live DNS at read
      // time) — the statuses below are the honest stored-state
      // answer, not a check result.
      spf: { status: "not_recorded" },
      dkim: { status: selectorSet ? "not_recorded" : "not_checked" },
      note: "SPF/DKIM এখানে সংরক্ষিত কোনো ফলাফল নেই — MS4 domain health প্রতিবার Messaging পেজে live DNS দিয়ে হিসাব করে, কিছু সংরক্ষণ করে না। তাই এই প্যানেল শুধু সংরক্ষিত কনফিগ (From domain, DKIM selector আছে কিনা) দেখায়; live ফলাফলের জন্য Messaging → Domain health দেখুন।",
    };

    const metaBusiness: any[] = [];
    const collect = (rows: any[], targetType: string, nameOf: (r: any) => string) => {
      for (const row of rows) {
        const snap = row?.providerHealth;
        if (!snap || !["meta_page", "ad_account"].includes(String(snap.kind))) continue;
        metaBusiness.push({
          targetType, targetId: row.id, displayName: nameOf(row),
          businessId: snap.business?.id ?? null,
          verificationStatus: snap.business?.verificationStatus ?? null,
          providerHealthAt: row.providerHealthAt ?? null,
        });
      }
    };
    collect(
      await this.safeFindMany("socialAccount", { where: { organizationId, platform: "meta_page" } }),
      "social_account", (r) => r.label || r.name || r.id,
    );
    collect(
      await this.safeFindMany("integration", { where: { organizationId, provider: { in: ["messenger", "meta_social"] } } }),
      "integration", (r) => r.label || r.id,
    );
    collect(
      await this.safeFindMany("adAccount", { where: { organizationId, platform: "meta" } }),
      "ad_account", (r) => r.label || r.name || r.id,
    );

    return { email, metaBusiness };
  }
}
