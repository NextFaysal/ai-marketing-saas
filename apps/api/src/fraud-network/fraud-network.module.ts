import { Module } from "@nestjs/common";
import { FraudNetworkController } from "./fraud-network.controller";
import { FraudNetworkService } from "./fraud-network.service";
import { AuditModule } from "../audit/audit.module";

/**
 * NF13 (FB5) — Platform Fraud Network. A leaf module in the
 * FraudModule spirit: the service depends only on the global
 * PrismaService + AuditService, so OrdersModule (Fraud Shield
 * sibling signal) and AutomationModule (fraud_network_sweep)
 * can import it without any cycle — neither is imported back.
 */
@Module({
  imports: [AuditModule],
  controllers: [FraudNetworkController],
  providers: [FraudNetworkService],
  exports: [FraudNetworkService],
})
export class FraudNetworkModule {}
