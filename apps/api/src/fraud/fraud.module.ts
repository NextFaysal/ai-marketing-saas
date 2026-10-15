import { Module } from "@nestjs/common";
import { BlockedPhoneService } from "./blocked-phone.service";

/**
 * ON4 — FraudModule imports NOTHING: PrismaService and
 * AuditService are both @Global, so the blocklist service is
 * available to Orders / Inbox / checkout modules without any
 * import cycle.
 */
@Module({
  providers: [BlockedPhoneService],
  exports: [BlockedPhoneService],
})
export class FraudModule {}
