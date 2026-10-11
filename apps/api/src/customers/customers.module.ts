import { Module } from "@nestjs/common";
import { CustomersController } from "./customers.controller";
import { CustomersService } from "./customers.service";
import { OrdersModule } from "../orders/orders.module";
import { CrmModule } from "../crm/crm.module";

// CRM C4: CrmModule provides the shared CustomFieldsService gate
// (CrmModule imports nothing, so there is no cycle).
@Module({ imports: [OrdersModule, CrmModule], controllers: [CustomersController], providers: [CustomersService], exports: [CustomersService] })
export class CustomersModule {}
