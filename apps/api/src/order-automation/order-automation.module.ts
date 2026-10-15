import { Module } from "@nestjs/common";
import { OrderAutomationController } from "./order-automation.controller";
import { OrderAutomationService } from "./order-automation.service";
import { OrdersModule } from "../orders/orders.module";
import { OrderNotificationsModule } from "../order-notifications/order-notifications.module";

/**
 * ON8 — Orders Automation Studio (dedicated order-automation
 * engine; see the engine verdict in order-automation.ts).
 * Imports: OrdersModule (OrdersService tag/assign + the ON4
 * FraudShieldService hold path — reused, never forked) and
 * OrderNotificationsModule (the ON5 notify machinery for the
 * notify_customer action's "automation_rule" event).
 * Cycle check: neither OrdersModule nor
 * OrderNotificationsModule imports this module;
 * AutomationModule imports THIS module one-way for the
 * order_automation_sweep job. EventsService + AuditService
 * are @Global.
 */
@Module({
  imports: [OrdersModule, OrderNotificationsModule],
  controllers: [OrderAutomationController],
  providers: [OrderAutomationService],
  exports: [OrderAutomationService],
})
export class OrderAutomationModule {}
