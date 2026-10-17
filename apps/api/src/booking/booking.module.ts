import { Module } from "@nestjs/common";
import { BookingController, BookingPublicController } from "./booking.controller";
import { BookingService } from "./booking.service";
import { AuditModule } from "../audit/audit.module";
import { StorefrontModule } from "../storefront/storefront.module";

/**
 * NF4 (FB2) — Service & Appointment bookings. Dependencies ride
 * EXISTING modules only: StorefrontModule exports
 * ShopAccountService, whose sendShopSms is the ONE shared
 * customer-SMS path (installments / order notifications use it
 * too) — the reminder sweep sends through it, never a parallel
 * sender. StorefrontModule does not import this module, so the
 * graph stays acyclic; AutomationModule imports this module for
 * the service_booking_reminder_sweep job.
 */
@Module({
  imports: [AuditModule, StorefrontModule],
  controllers: [BookingController, BookingPublicController],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingModule {}
