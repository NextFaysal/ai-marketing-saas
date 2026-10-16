import { Module } from "@nestjs/common";
import { MerchantApiService } from "./merchant-api.service";
import { MerchantApiKeyGuard } from "./merchant-api.guard";
import { MerchantApiController } from "./merchant-api.controller";
import { MerchantApiKeysController } from "./merchant-api-keys.controller";
import { ProductsModule } from "../products/products.module";
import { OrdersModule } from "../orders/orders.module";
import { CustomersModule } from "../customers/customers.module";

/**
 * AB8 (AX21) — Merchant Developer API.
 *
 * Imports the three staff modules for their exported services
 * (ProductsModule exports ProductsService, OrdersModule exports
 * OrdersService, CustomersModule exports CustomersService — all
 * verified in-tree; no export edits were needed). PrismaModule
 * and AuditModule are global. Nothing imports this module back,
 * so the graph stays acyclic. Wiring into AppModule is the
 * coordinator's step.
 */
@Module({
  imports: [ProductsModule, OrdersModule, CustomersModule],
  controllers: [MerchantApiController, MerchantApiKeysController],
  providers: [MerchantApiService, MerchantApiKeyGuard],
  exports: [MerchantApiService, MerchantApiKeyGuard],
})
export class MerchantApiModule {}
