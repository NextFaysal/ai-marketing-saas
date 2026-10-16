import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { IsArray, IsBoolean, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { WebhooksOutgoingService } from "./webhooks-outgoing.service";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { CurrentUser, Roles, type AuthUser } from "../common/decorators";

class CreateWebhookDto {
  @IsString() @MinLength(8) @MaxLength(2048) url!: string;
  @IsArray() @IsString({ each: true }) events!: string[];
}
class UpdateWebhookDto {
  @IsOptional() @IsString() @MinLength(8) @MaxLength(2048) url?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) events?: string[];
  @IsOptional() @IsBoolean() active?: boolean;
}

const READ_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER"] as const;
const WRITE_ROLES = ["OWNER", "ADMIN"] as const;

/**
 * GC23 — merchant webhook subscriptions (org-scoped). Writes are
 * OWNER/ADMIN only: a webhook endpoint receives order events and
 * its signing secret, so managing subscriptions is an admin act.
 * Route order matters: the literal "deliveries" segment is
 * declared BEFORE ":id" so it is never captured as a subscription
 * id.
 */
@Controller("organizations/:organizationId/webhooks")
@UseGuards(TenantGuard, RolesGuard)
export class WebhooksOutgoingController {
  constructor(private readonly webhooks: WebhooksOutgoingService) {}

  @Post()
  @Roles(...WRITE_ROLES)
  create(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: CreateWebhookDto) {
    return this.webhooks.createSubscription(id, user.userId, dto);
  }

  @Get()
  @Roles(...READ_ROLES)
  list(@Param("organizationId") id: string) {
    return this.webhooks.listSubscriptions(id);
  }

  @Get("deliveries")
  @Roles(...READ_ROLES)
  deliveries(
    @Param("organizationId") id: string,
    @Query("subscriptionId") subscriptionId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return this.webhooks.listDeliveries(id, {
      subscriptionId, status,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get("deliveries/:deliveryId")
  @Roles(...READ_ROLES)
  delivery(@Param("organizationId") id: string, @Param("deliveryId") deliveryId: string) {
    return this.webhooks.getDelivery(id, deliveryId);
  }

  @Post("deliveries/:deliveryId/resend")
  @Roles(...WRITE_ROLES)
  resend(@Param("organizationId") id: string, @Param("deliveryId") deliveryId: string) {
    return this.webhooks.resendDelivery(id, deliveryId);
  }

  @Get(":id")
  @Roles(...READ_ROLES)
  get(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.webhooks.getSubscription(orgId, id);
  }

  @Patch(":id")
  @Roles(...WRITE_ROLES)
  update(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhooks.updateSubscription(orgId, user.userId, id, dto);
  }

  @Post(":id/rotate-secret")
  @Roles(...WRITE_ROLES)
  rotate(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.webhooks.rotateSecret(orgId, user.userId, id);
  }

  @Delete(":id")
  @Roles(...WRITE_ROLES)
  remove(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.webhooks.deleteSubscription(orgId, user.userId, id);
  }
}
