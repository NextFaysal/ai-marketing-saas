import { Module } from "@nestjs/common";
import { CustomersController } from "./customers.controller";
import { CustomersService } from "./customers.service";
import { OrdersModule } from "../orders/orders.module";
import { CrmModule } from "../crm/crm.module";
import { CommerceModule } from "../commerce/commerce.module";

// CRM C4: CrmModule provides the shared CustomFieldsService gate
// (CrmModule imports nothing, so there is no cycle).
// EC6: CommerceModule provides CustomerPushService for push-to-store.
@Module({ imports: [OrdersModule, CrmModule, CommerceModule], controllers: [CustomersController], providers: [CustomersService], exports: [CustomersService] })
export class CustomersModule {}
