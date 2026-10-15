import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { OrderChaseService } from "./order-chase.service";
import { TenantGuard } from "../common/tenant.guard";

/** CX7 — tenant "To Chase" list (org-scoped; the orders page
 * reads from here). Chase records only — see listChases. */
@Controller("organizations/:organizationId/order-chases")
@UseGuards(TenantGuard)
export class OrderChaseController {
  constructor(private readonly chase: OrderChaseService) {}

  @Get()
  list(@Param("organizationId") orgId: string) {
    return this.chase.listChases(orgId);
  }
}
