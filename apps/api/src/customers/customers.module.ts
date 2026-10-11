import { Module } from "@nestjs/common";
import { CustomersController } from "./customers.controller";
import { CustomersService } from "./customers.service";
import { OrdersModule } from "../orders/orders.module";

@Module({ imports: [OrdersModule], controllers: [CustomersController], providers: [CustomersService], exports: [CustomersService] })
export class CustomersModule {}
