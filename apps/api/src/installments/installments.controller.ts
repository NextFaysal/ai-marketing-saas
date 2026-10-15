import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { InstallmentsService } from "./installments.service";
import { CollectInstallmentDto, CreateInstallmentPlanDto } from "./installments.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;

/**
 * EC31: staff-managed installment plans. Base path is the org
 * root (like SubscriptionsController) because the surface mixes
 * order-scoped routes (plan create/read) with org-scoped ones
 * (due worklist, plan list, item collect, plan cancel).
 */
@PermissionArea("orders")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class InstallmentsController {
  constructor(private readonly installments: InstallmentsService) {}

  @Post("orders/:orderId/installment-plan") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createPlan(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("orderId") orderId: string,
    @Body() dto: CreateInstallmentPlanDto,
  ) {
    return this.installments.createPlan(orgId, user.userId, orderId, dto);
  }

  @Get("orders/:orderId/installment-plan")
  getPlanByOrder(@Param("organizationId") orgId: string, @Param("orderId") orderId: string) {
    return this.installments.getPlanByOrder(orgId, orderId);
  }

  /** Due worklist — declared BEFORE the plan list so the
   * literal "due" segment is never swallowed by a param. */
  @Get("installments/due")
  dueWorklist(@Param("organizationId") orgId: string, @Query("bucket") bucket?: string) {
    return this.installments.dueWorklist(orgId, bucket ?? "");
  }

  @Get("installments")
  listPlans(
    @Param("organizationId") orgId: string,
    @Query() q: { status?: string; page?: string; pageSize?: string },
  ) {
    return this.installments.listPlans(orgId, {
      status: q.status,
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
    });
  }

  @Post("installment-items/:itemId/collect") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  collect(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("itemId") itemId: string,
    @Body() dto: CollectInstallmentDto,
  ) {
    return this.installments.collect(orgId, user.userId, itemId, dto);
  }

  @Post("installments/:planId/cancel") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  cancelPlan(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("planId") planId: string,
  ) {
    return this.installments.cancelPlan(orgId, user.userId, planId);
  }
}
