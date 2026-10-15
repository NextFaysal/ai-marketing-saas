import { Module } from "@nestjs/common";
import { ConnectionsController, PaymentLinksPublicController, TenantPaymentsPublicController } from "./connections.controller";
import { ConnectionsService } from "./connections.service";
import { TenantPaymentsService } from "./tenant-payments.service";
import { PaymentRefundsService } from "./payment-refunds.service";
import { SettlementsService } from "./settlements.service";
import { PaymentLinksService } from "./payment-links.service";
import { WalletService } from "./wallet.service";
import { ConnectionDoctorService } from "./connection-doctor.service";
import { ConnectionMonitorService } from "./connection-monitor.service";
import { ConnectionTimelineService } from "./connection-timeline.service";
import { ProviderHealthService } from "./provider-health.service";
import { GoogleConnectService } from "./google-connect.service";
import { GoogleOAuthCallbackController } from "./google-oauth-callback.controller";
import { SetupAssistantService } from "./setup-assistant.service";
import { StepUpService } from "./step-up.service";
import { ConnectionHealingService } from "./connection-healing.service";
import { ConnectionAnalyticsService } from "./connection-analytics.service";
import { ConnectionUsageService } from "./connection-usage.service";
import { IntegrationsModule } from "../integrations/integrations.module";

/**
 * CC1/CC2 — Connect Center. PrismaService and AuditService come
 * from the global PrismaModule/AuditModule; this module only
 * aggregates existing rows and mutates Integration.isDefault /
 * disconnect state, so it imports nothing else.
 *
 * CC8/CC9 additions stay inside the same module: the per-org LLM
 * config endpoints (ConnectionsService) and the tenant's OWN
 * payment gateways (TenantPaymentsService + its public IPN /
 * callback controller).
 *
 * Advanced (CC11–CC13): the Connection Doctor (live diagnostics
 * over the existing provider clients), the monitoring sweep +
 * alerts (ConnectionMonitorService — also the body of the
 * "connection_health_sweep" job, exported for AutomationModule)
 * and the per-target timeline. IntegrationsModule is imported
 * for ShopifyService's EC2 token-refresh path, which the Doctor
 * reuses for client-credentials Shopify integrations;
 * IntegrationsModule imports only InventoryModule, so this adds
 * no cycle.
 */
@Module({
  imports: [IntegrationsModule],
  controllers: [ConnectionsController, TenantPaymentsPublicController, PaymentLinksPublicController, GoogleOAuthCallbackController],
  providers: [
    ConnectionsService, TenantPaymentsService, PaymentRefundsService, SettlementsService, PaymentLinksService, WalletService, ConnectionDoctorService, ConnectionMonitorService, ConnectionTimelineService, ProviderHealthService, GoogleConnectService, SetupAssistantService,
    // CC21–CC23 (Connect Center Next): TOTP step-up, sweep
    // auto-healing (bound to the monitor via the
    // CONNECTION_HEALING token — the healing service imports
    // webhookSummary from the monitor, so the monitor must
    // not import it back), and health analytics.
    StepUpService, ConnectionHealingService, ConnectionAnalyticsService,
    // CC30 (Connect Center Next): per-account usage insights +
    // the stored-state deliverability surface.
    ConnectionUsageService,
    { provide: "CONNECTION_HEALING", useExisting: ConnectionHealingService },
  ],
  exports: [ConnectionsService, TenantPaymentsService, PaymentRefundsService, SettlementsService, PaymentLinksService, WalletService, ConnectionDoctorService, ConnectionMonitorService, ConnectionTimelineService, ProviderHealthService, GoogleConnectService, SetupAssistantService, StepUpService, ConnectionHealingService, ConnectionAnalyticsService, ConnectionUsageService],
})
export class ConnectionsModule {}
