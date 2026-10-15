import { Module } from "@nestjs/common";
import { ConnectionsController, TenantPaymentsPublicController } from "./connections.controller";
import { ConnectionsService } from "./connections.service";
import { TenantPaymentsService } from "./tenant-payments.service";
import { WalletService } from "./wallet.service";

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
 */
@Module({
  controllers: [ConnectionsController, TenantPaymentsPublicController],
  providers: [ConnectionsService, TenantPaymentsService, WalletService],
  exports: [ConnectionsService, TenantPaymentsService, WalletService],
})
export class ConnectionsModule {}
