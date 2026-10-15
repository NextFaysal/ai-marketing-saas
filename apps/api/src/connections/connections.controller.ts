import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { ConnectionsService } from "./connections.service";
import { GoogleConnectService } from "./google-connect.service";
import { SetupAssistantService } from "./setup-assistant.service";
import { TenantPaymentsService } from "./tenant-payments.service";
import { PaymentRefundsService } from "./payment-refunds.service";
import { SettlementsService } from "./settlements.service";
import { PaymentLinksService } from "./payment-links.service";
import { WalletService, buildStatementCsv, buildStatementPdf, statementRange } from "./wallet.service";
import { ConnectionDoctorService } from "./connection-doctor.service";
import { ConnectionMonitorService } from "./connection-monitor.service";
import { ConnectionAnalyticsService } from "./connection-analytics.service";
import { ConnectionUsageService } from "./connection-usage.service";
import { ConnectionTimelineService } from "./connection-timeline.service";
import { ProviderHealthService } from "./provider-health.service";
import { AccountMetaDto, CreatePaymentLinkDto, CreatePayoutDestinationDto, CreatePayoutRequestDto, CreateSettlementImportDto, DismissAssistantFindingDto, GoogleSelectDto, InitiateOrderPaymentDto, InitiateRefundDto, PublicInitiatePaymentDto, PutAlertPreferencesDto, PutAppConfigDto, PutLlmConfigDto, PutPaymentGatewayDto, PutPayoutScheduleDto, SetAutoHealDto, SetGatewayEnabledDto, SetMemberDeniedConnectionsDto, SetPlatformEnabledDto, SetSyncIntervalDto, SetSyncPausedDto, SnoozeTargetDto, TestInitiatePaymentDto, UpdatePayoutDestinationDto } from "./connections.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea, Public } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN"];

/**
 * CC1/CC2 — Connect Center endpoints. Same guard stack as the
 * integrations controller: tenant membership via TenantGuard,
 * role/permission checks via RolesGuard, area "integrations".
 */
@PermissionArea("integrations")
@Controller("organizations/:organizationId/connections")
@UseGuards(TenantGuard, RolesGuard)
export class ConnectionsController {
  constructor(
    private readonly connections: ConnectionsService,
    private readonly tenantPayments: TenantPaymentsService,
    private readonly refunds: PaymentRefundsService,
    private readonly settlements: SettlementsService,
    private readonly links: PaymentLinksService,
    private readonly wallet: WalletService,
    private readonly doctor: ConnectionDoctorService,
    private readonly monitor: ConnectionMonitorService,
    private readonly timeline: ConnectionTimelineService,
    private readonly providerHealth: ProviderHealthService,
    private readonly googleConnect: GoogleConnectService,
    private readonly assistant: SetupAssistantService,
    private readonly analytics: ConnectionAnalyticsService,
    private readonly usage: ConnectionUsageService,
  ) {}

  @Get("overview")
  overview(@Param("organizationId") orgId: string) {
    return this.connections.getOverview(orgId);
  }

  // CC20 — Smart Setup Assistant: findings computed from real
  // rows on every read; a dismissal is per (org, user).
  @Get("assistant")
  assistantFindings(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.assistant.getFindings(orgId, user.userId);
  }

  @Post("assistant/dismiss") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  dismissAssistantFinding(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: DismissAssistantFindingDto) {
    return this.assistant.dismiss(orgId, user.userId, dto.findingKey);
  }

  // CC20 — Google pack connect. CC28: ?appSource=own connects
  // through the tenant's OWN Google app (Connect Center →
  // নিজের অ্যাপ → Google) instead of the platform's. The pick
  // routes are literal-prefixed and declared before :kind so
  // "pick-info" is never read as a kind.
  @Get("google/pick-info")
  googlePickInfo(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("state") state?: string) {
    return this.googleConnect.getPickInfo(orgId, user.userId, state ?? "");
  }

  @Get("google/:kind/connect-url") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  googleConnectUrl(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("kind") kind: string, @Query("appSource") appSource?: string) {
    return this.googleConnect.connectUrl(orgId, user.userId, kind, appSource);
  }

  @Post("google/:kind/select") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  googleSelect(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("kind") kind: string, @Body() dto: GoogleSelectDto) {
    return this.googleConnect.select(orgId, user.userId, kind, dto.state, dto.optionId);
  }

  // CC17/CC18 (Advanced) — account labels + groups, per-member
  // account access (the deny-list matrix) and per-connection
  // sync pause + history. Literal routes, declared before the
  // :integrationId routes at the bottom.
  @Patch("targets/:source/:targetId/meta") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  setAccountMeta(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("source") source: string, @Param("targetId") targetId: string, @Body() dto: AccountMetaDto) {
    return this.connections.setAccountMeta(orgId, user.userId, source, decodeURIComponent(targetId), dto);
  }

  @Get("member-access")
  memberAccess(@Param("organizationId") orgId: string) {
    return this.connections.getMemberAccessMatrix(orgId);
  }

  @Put("member-access/:userId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  setMemberAccess(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("userId") userId: string, @Body() dto: SetMemberDeniedConnectionsDto) {
    return this.connections.setMemberDeniedConnections(orgId, user.userId, userId, dto.deniedConnectionIds ?? []);
  }

  @Patch(":integrationId/sync-paused") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  setSyncPaused(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("integrationId") id: string, @Body() dto: SetSyncPausedDto) {
    return this.connections.setSyncPaused(orgId, user.userId, id, dto.syncPaused === true);
  }

  // CC30 — per-connection SCHEDULED-sync cadence (null clears).
  // Manual sync triggers ignore the cadence by design.
  @Patch(":integrationId/sync-interval") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  setSyncInterval(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("integrationId") id: string, @Body() dto: SetSyncIntervalDto) {
    return this.connections.setSyncInterval(orgId, user.userId, id, dto.syncIntervalMinutes ?? null);
  }

  // CC21 — auto-healing opt-out for one connection (the sweep
  // keeps detecting + alerting; it just never repairs this
  // connection while opted out).
  @Patch(":integrationId/auto-heal") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  setAutoHeal(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("integrationId") id: string, @Body() dto: SetAutoHealDto) {
    return this.connections.setAutoHealEnabled(orgId, user.userId, id, dto.autoHealEnabled === true);
  }

  // CC22 — health analytics from the recorded Doctor runs.
  // OWNER/ADMIN only: org-wide reliability data is an owner
  // surface, like the alert preferences.
  @Get("health-analytics") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  healthAnalytics(@Param("organizationId") orgId: string) {
    return this.analytics.getHealthAnalytics(orgId);
  }

  // CC30 — per-account usage insights from real rows only
  // (unattributable facts stay null / land in the unattributed
  // list — never a guessed split). OWNER/ADMIN, like analytics.
  @Get("usage") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  usageInsights(@Param("organizationId") orgId: string, @Query("days") days?: string) {
    return this.usage.getUsage(orgId, days);
  }

  // CC30 — deliverability surface from STORED state only (no
  // DNS lookups, no provider calls on this read path).
  @Get("deliverability") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deliverability(@Param("organizationId") orgId: string) {
    return this.usage.getDeliverability(orgId);
  }

  @Get(":integrationId/sync-history")
  syncHistory(@Param("organizationId") orgId: string, @Param("integrationId") id: string, @Query("limit") limit?: string) {
    return this.connections.listSyncHistory(orgId, id, limit ? Number(limit) : 20);
  }

  // CC11/CC12/CC13 (Advanced) — Connection Doctor, monitoring
  // alerts and per-target timelines. The "targets/..." routes are
  // literal-prefixed and declared before the :integrationId
  // routes below; a target is (targetType, targetId) exactly as
  // the overview reports it (source + id).
  @Post("diagnose-all") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  diagnoseAll(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.doctor.diagnoseAll(orgId, user.userId);
  }

  @Post("targets/:targetType/:targetId/diagnose") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  diagnoseOne(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("targetType") targetType: string, @Param("targetId") targetId: string) {
    return this.doctor.diagnoseOne(orgId, user.userId, targetType, decodeURIComponent(targetId));
  }

  @Get("targets/:targetType/:targetId/health-checks")
  healthChecks(@Param("organizationId") orgId: string, @Param("targetType") targetType: string, @Param("targetId") targetId: string, @Query("limit") limit?: string) {
    return this.doctor.listHistory(orgId, targetType, decodeURIComponent(targetId), limit ? Number(limit) : 20);
  }

  @Get("targets/:targetType/:targetId/timeline")
  targetTimeline(@Param("organizationId") orgId: string, @Param("targetType") targetType: string, @Param("targetId") targetId: string, @Query("onlyProblems") onlyProblems?: string, @Query("limit") limit?: string, @Query("cursor") cursor?: string) {
    return this.timeline.getTimeline(orgId, targetType, decodeURIComponent(targetId), {
      onlyProblems: onlyProblems === "1" || onlyProblems === "true",
      limit: limit ? Number(limit) : 50,
      cursor,
    });
  }

  @Post("targets/:targetType/:targetId/snooze") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  snoozeTarget(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("targetType") targetType: string, @Param("targetId") targetId: string, @Body() dto: SnoozeTargetDto) {
    return this.monitor.snoozeTarget(orgId, user.userId, targetType, decodeURIComponent(targetId), dto.hours);
  }

  @Get("health-checks")
  recentHealthChecks(@Param("organizationId") orgId: string, @Query("limit") limit?: string) {
    return this.doctor.listRecentRuns(orgId, limit ? Number(limit) : 20);
  }

  @Get("alerts")
  listAlerts(@Param("organizationId") orgId: string, @Query("unread") unread?: string, @Query("limit") limit?: string) {
    return this.monitor.listAlerts(orgId, { unreadOnly: unread === "1" || unread === "true", limit: limit ? Number(limit) : 50 });
  }

  @Post("alerts/:alertId/read")
  markAlertRead(@Param("organizationId") orgId: string, @Param("alertId") alertId: string) {
    return this.monitor.markAlertRead(orgId, alertId);
  }

  @Post("alerts/read-all")
  markAllAlertsRead(@Param("organizationId") orgId: string) {
    return this.monitor.markAllAlertsRead(orgId);
  }

  @Get("alert-preferences")
  getAlertPreferences(@Param("organizationId") orgId: string) {
    return this.monitor.getPreferences(orgId);
  }

  @Put("alert-preferences") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  putAlertPreferences(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: PutAlertPreferencesDto) {
    return this.monitor.updatePreferences(orgId, user.userId, dto);
  }

  /** Manual sweep trigger (the scheduled path is the
   * connection_health_sweep job). OWNER/ADMIN — a sweep can send
   * real email and run real provider checks. */
  @Post("run-sweep") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  runSweep(@Param("organizationId") orgId: string) {
    return this.monitor.runSweep(orgId);
  }

  // CC3 — the tenant's OWN app configs (Meta / TikTok). Reads are
  // open to any tenant member who can see the area; writes are
  // OWNER/ADMIN, same as every other connections mutation.
  @Get("app-configs")
  listAppConfigs(@Param("organizationId") orgId: string) {
    return this.connections.listAppConfigs(orgId);
  }

  @Put("app-configs/:platform") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  putAppConfig(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("platform") platform: string, @Body() dto: PutAppConfigDto) {
    return this.connections.putAppConfig(orgId, user.userId, platform, dto);
  }

  @Delete("app-configs/:platform") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deleteAppConfig(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("platform") platform: string, @Query("totpCode") totpCode?: string) {
    // CC23: TOTP step-up (query param — DELETE bodies are
    // unreliable across clients; the service enforces it).
    return this.connections.deleteAppConfig(orgId, user.userId, platform, totpCode);
  }

  // CC8 — the tenant's OWN LLM key (verify-before-save; the key
  // itself is never returned). Literal routes, declared before
  // the :integrationId routes below.
  @Get("llm-config")
  getLlmConfig(@Param("organizationId") orgId: string) {
    return this.connections.getLlmConfig(orgId);
  }

  @Put("llm-config") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  putLlmConfig(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: PutLlmConfigDto) {
    return this.connections.putLlmConfig(orgId, user.userId, dto);
  }

  @Delete("llm-config") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deleteLlmConfig(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.connections.deleteLlmConfig(orgId, user.userId);
  }

  // CC9 — the tenant's OWN payment gateways (money settles
  // directly to the tenant). Literal routes, declared before the
  // :integrationId routes below. Writes are OWNER/ADMIN.
  @Get("payment-gateways")
  listPaymentGateways(@Param("organizationId") orgId: string) {
    return this.tenantPayments.listGateways(orgId);
  }

  @Put("payment-gateways/:provider") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  putPaymentGateway(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("provider") provider: string, @Body() dto: PutPaymentGatewayDto) {
    return this.tenantPayments.putGateway(orgId, user.userId, provider, dto);
  }

  @Patch("payment-gateways/:provider/enabled") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  setPaymentGatewayEnabled(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("provider") provider: string, @Body() dto: SetGatewayEnabledDto, @Query("environment") environment?: string) {
    // CC23: disabling carries the step-up (dto.totpCode); the
    // service enforces it only for the disable direction.
    return this.tenantPayments.setGatewayEnabled(orgId, user.userId, provider, dto.isEnabled, environment === "sandbox" ? "sandbox" : "live", dto.totpCode);
  }

  @Delete("payment-gateways/:provider") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deletePaymentGateway(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("provider") provider: string, @Query("environment") environment?: string, @Query("totpCode") totpCode?: string) {
    // CC23: TOTP step-up, enforced in the service before the
    // delete (query param — see deleteAppConfig).
    return this.tenantPayments.deleteGateway(orgId, user.userId, provider, environment === "sandbox" ? "sandbox" : "live", totpCode);
  }

  // CC19 — sandbox TEST initiation against the sandbox
  // credential set: clearly labelled test, can never mark a
  // real order paid (the service pins environment="sandbox"
  // and markVerifiedPaid refuses order/wallet effects for it).
  @Post("payment-gateways/:provider/test-initiate") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  testInitiatePayment(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("provider") provider: string, @Body() dto: TestInitiatePaymentDto) {
    return this.tenantPayments.initiateTestPayment(orgId, user.userId, provider, dto?.amountMinor);
  }

  // CC19 — gateway transaction history + the IPN evidence
  // viewer (stored payload, credential-shaped keys redacted).
  @Get("payment-transactions")
  listPaymentTransactions(@Param("organizationId") orgId: string, @Query("status") status?: string, @Query("source") source?: string, @Query("environment") environment?: string, @Query("limit") limit?: string) {
    return this.tenantPayments.listTransactions(orgId, { status, source, environment, limit: limit ? Number(limit) : undefined });
  }

  @Get("payment-transactions/:txnId/ipn")
  paymentTransactionIpn(@Param("organizationId") orgId: string, @Param("txnId") txnId: string) {
    return this.tenantPayments.getTransactionIpn(orgId, txnId);
  }

  // CC24 — gateway refunds. Initiation records intent only;
  // "refunded" exists solely after a gateway status query
  // confirms it (the refresh path, also reused by the list).
  @Post("payment-transactions/:txnId/refunds") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  initiateRefund(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("txnId") txnId: string, @Body() dto: InitiateRefundDto) {
    return this.refunds.initiateRefund(orgId, user.userId, txnId, dto);
  }

  @Get("refunds")
  listRefunds(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("transactionId") transactionId?: string, @Query("orderId") orderId?: string, @Query("limit") limit?: string) {
    return this.refunds.listRefunds(orgId, user.userId, { transactionId, orderId, limit: limit ? Number(limit) : undefined });
  }

  @Post("refunds/:refundId/refresh") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  refreshRefund(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("refundId") refundId: string) {
    return this.refunds.refreshRefund(orgId, user.userId, refundId);
  }

  // CC25 — settlement reconciliation (CSV import + verdicts).
  @Post("settlement-imports") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  importSettlement(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateSettlementImportDto) {
    return this.settlements.importSettlement(orgId, user.userId, dto);
  }

  @Get("settlement-imports")
  listSettlementImports(@Param("organizationId") orgId: string) {
    return this.settlements.listImports(orgId);
  }

  @Get("settlement-imports/:importId")
  settlementImportDetail(@Param("organizationId") orgId: string, @Param("importId") importId: string) {
    return this.settlements.getImport(orgId, importId);
  }

  @Post("payment-gateways/:provider/initiate-payment") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  initiatePayment(@Param("organizationId") orgId: string, @Param("provider") provider: string, @Body() dto: InitiateOrderPaymentDto) {
    return this.tenantPayments.initiateOrderPayment(orgId, dto.orderId, provider, {
      customerName: dto.customerName, customerPhone: dto.customerPhone, customerEmail: dto.customerEmail,
    });
  }

  // CC10 — Platform Payment + Wallet. Literal routes, declared
  // before the :integrationId routes below. The wallet surface
  // is read + payout-request only: there is deliberately NO
  // tenant endpoint that creates a ledger row or a credit.
  @Get("platform-payments")
  listPlatformPayments(@Param("organizationId") orgId: string) {
    return this.wallet.listPlatformPayments(orgId);
  }

  @Put("platform-payments/:provider/enabled") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  setPlatformEnabled(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("provider") provider: string, @Body() dto: SetPlatformEnabledDto) {
    return this.wallet.setPlatformEnabled(orgId, user.userId, provider, dto.isEnabled);
  }

  @Post("platform-payments/:provider/initiate-payment") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  initiatePlatformPayment(@Param("organizationId") orgId: string, @Param("provider") provider: string, @Body() dto: InitiateOrderPaymentDto) {
    return this.tenantPayments.initiatePlatformOrderPayment(orgId, dto.orderId, provider, {
      customerName: dto.customerName, customerPhone: dto.customerPhone, customerEmail: dto.customerEmail,
    });
  }

  @Get("wallet")
  getWallet(@Param("organizationId") orgId: string) {
    return this.wallet.getWallet(orgId);
  }

  // CC19 — wallet statement export from the REAL ledger
  // (opening / period entries / closing, computed by the
  // service from WalletTransaction rows only). CSV is the
  // lossless form; the PDF states on its face that full notes
  // live in the CSV (the shared PDF writer is WinAnsi-only).
  @Get("wallet/statement.csv") @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", "attachment; filename=wallet-statement.csv")
  async walletStatementCsv(@Param("organizationId") orgId: string, @Query("from") from?: string, @Query("to") to?: string) {
    const statement = await this.wallet.getStatement(orgId, statementRange(from, to));
    return buildStatementCsv(statement);
  }

  @Get("wallet/statement.pdf")
  async walletStatementPdf(@Param("organizationId") orgId: string, @Res() res: Response, @Query("from") from?: string, @Query("to") to?: string) {
    const statement = await this.wallet.getStatement(orgId, statementRange(from, to));
    const pdf = buildStatementPdf(statement);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=\"wallet-statement.pdf\"");
    return res.send(pdf);
  }

  @Get("payout-requests")
  listPayoutRequests(@Param("organizationId") orgId: string) {
    return this.wallet.listPayoutRequests(orgId);
  }

  @Post("payout-requests") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createPayoutRequest(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreatePayoutRequestDto) {
    return this.wallet.createPayoutRequest(orgId, user.userId, dto);
  }

  @Post("payout-requests/:requestId/cancel") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  cancelPayoutRequest(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("requestId") requestId: string) {
    return this.wallet.cancelPayoutRequest(orgId, user.userId, requestId);
  }

  // CC26 — saved payout destinations (list views mask account
  // identifiers beyond the last 4; the single-destination read
  // is the owner's own edit form) + the payout schedule the
  // wallet_payout_sweep job reads.
  @Get("payout-destinations")
  listPayoutDestinations(@Param("organizationId") orgId: string) {
    return this.wallet.listDestinations(orgId);
  }

  @Get("payout-destinations/:destinationId")
  getPayoutDestination(@Param("organizationId") orgId: string, @Param("destinationId") destinationId: string) {
    return this.wallet.getDestination(orgId, destinationId);
  }

  @Post("payout-destinations") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createPayoutDestination(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreatePayoutDestinationDto) {
    return this.wallet.createDestination(orgId, user.userId, dto);
  }

  @Patch("payout-destinations/:destinationId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updatePayoutDestination(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("destinationId") destinationId: string, @Body() dto: UpdatePayoutDestinationDto) {
    return this.wallet.updateDestination(orgId, user.userId, destinationId, dto);
  }

  @Post("payout-destinations/:destinationId/default") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  setDefaultPayoutDestination(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("destinationId") destinationId: string) {
    return this.wallet.updateDestination(orgId, user.userId, destinationId, { isDefault: true });
  }

  @Delete("payout-destinations/:destinationId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deletePayoutDestination(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("destinationId") destinationId: string) {
    return this.wallet.deleteDestination(orgId, user.userId, destinationId);
  }

  // CC26 — shareable payment links. The creation response is
  // the ONLY place the plaintext token (and full pay URL) ever
  // appears; list views carry status + metadata only.
  @Post("payment-links") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createPaymentLink(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreatePaymentLinkDto) {
    return this.links.createLink(orgId, user.userId, dto);
  }

  @Get("payment-links")
  listPaymentLinks(@Param("organizationId") orgId: string, @Query("orderId") orderId?: string, @Query("limit") limit?: string) {
    return this.links.listLinks(orgId, { orderId, limit: limit ? Number(limit) : undefined });
  }

  @Post("payment-links/:linkId/revoke") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  revokePaymentLink(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("linkId") linkId: string) {
    return this.links.revokeLink(orgId, user.userId, linkId);
  }

  @Get("payout-schedule")
  getPayoutSchedule(@Param("organizationId") orgId: string) {
    return this.wallet.getSchedule(orgId);
  }

  @Put("payout-schedule") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  putPayoutSchedule(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: PutPayoutScheduleDto) {
    return this.wallet.putSchedule(orgId, user.userId, dto);
  }

  // CC14/CC15 (Advanced) — provider-reported health refresh:
  // WhatsApp deep health, Meta Page asset completeness, Ad
  // Account payment-on-file. The snapshot is stored verbatim;
  // a failed fetch records the error and never overwrites the
  // last good snapshot. Declared before the :integrationId
  // routes below.
  @Post("targets/:targetType/:targetId/provider-health/refresh") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  refreshProviderHealth(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("targetType") targetType: string, @Param("targetId") targetId: string) {
    return this.providerHealth.refreshTarget(orgId, user.userId, targetType, decodeURIComponent(targetId));
  }

  // CC16 — commerce diagnostics (stored webhook record per
  // topic, Shopify scope diff, tracker freshness, latest Doctor
  // run) and webhook repair through the EXISTING EC2 registrars.
  @Get(":integrationId/commerce-diagnostics")
  commerceDiagnostics(@Param("organizationId") orgId: string, @Param("integrationId") id: string) {
    return this.providerHealth.commerceDiagnostics(orgId, id);
  }

  @Post(":integrationId/repair-webhooks") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  repairWebhooks(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("integrationId") id: string) {
    return this.providerHealth.repairWebhooks(orgId, user.userId, id);
  }

  @Patch(":integrationId/default") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  setDefault(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("integrationId") id: string) {
    return this.connections.setDefault(orgId, user.userId, id);
  }

  @Post(":integrationId/disconnect") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  disconnect(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("integrationId") id: string) {
    return this.connections.disconnect(orgId, user.userId, id);
  }
}

/**
 * CC9 — public gateway endpoints for TENANT gateways. The IPN is
 * the ONLY SSLCommerz activation path; the browser return just
 * redirects with an informational flag. The bKash callback
 * activates only after the server-to-server execute/query
 * confirmation inside the service. No tenant guard — the trust
 * comes from the gateway verification chain, exactly like the
 * platform payments public controllers (M36/M39).
 */
@Controller("public/tenant-payments")
export class TenantPaymentsPublicController {
  constructor(private readonly tenantPayments: TenantPaymentsService) {}

  @Public() @Post("initiate/:orgSlug")
  initiate(@Param("orgSlug") orgSlug: string, @Body() dto: PublicInitiatePaymentDto) {
    return this.tenantPayments.initiatePublicPayment(orgSlug, dto.orderId, dto.orderNumber, dto.provider, dto.source);
  }

  // CC19 — the buyer surface asks which online-payment options
  // really exist for this shop (enabled own LIVE gateway, or
  // tenant-enabled + platform-offered platform payment) before
  // showing a "Pay online" button. No secrets, no ids.
  @Public() @Get(":orgSlug/payment-options")
  paymentOptions(@Param("orgSlug") orgSlug: string) {
    return this.tenantPayments.publicPaymentOptions(orgSlug);
  }

  @Public() @Post("sslcommerz/ipn")
  sslIpn(@Body() body: Record<string, any>) {
    return this.tenantPayments.handleSslIpn(body ?? {});
  }

  @Public() @Post("sslcommerz/return")
  async sslReturnPost(@Body() body: Record<string, any>, @Res() res: Response) {
    return res.redirect(302, await this.tenantPayments.sslReturnRedirect(body ?? {}));
  }

  @Public() @Get("sslcommerz/return")
  async sslReturnGet(@Req() req: Request, @Res() res: Response) {
    return res.redirect(302, await this.tenantPayments.sslReturnRedirect((req.query ?? {}) as Record<string, any>));
  }

  @Public() @Get("bkash/callback")
  async bkashCallback(@Req() req: Request, @Res() res: Response) {
    const url = await this.tenantPayments.handleBkashCallback((req.query ?? {}) as Record<string, any>);
    return res.redirect(302, url);
  }
}

/**
 * CC26 — public payment-link endpoints. The token in the URL
 * is the only credential (its hash is what the row stores);
 * the read exposes shop name + order number + amount due and
 * NOTHING internal, and initiation rides the exact same
 * public initiation + verified-IPN chain as every other
 * payment in this module.
 */
@Controller("public/payment-links")
export class PaymentLinksPublicController {
  constructor(private readonly links: PaymentLinksService) {}

  @Public() @Get(":token")
  getLink(@Param("token") token: string) {
    return this.links.getPublicLink(token);
  }

  @Public() @Post(":token/initiate")
  initiateLink(@Param("token") token: string) {
    return this.links.initiatePublicLink(token);
  }
}
