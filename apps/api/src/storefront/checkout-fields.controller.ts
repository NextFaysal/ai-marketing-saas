import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength } from "class-validator";
import { CheckoutFieldsService } from "./checkout-fields.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

/**
 * AB4 (AX5b) DTOs. Shape-only validation lives here (the global
 * ValidationPipe is whitelist + forbidNonWhitelisted); the
 * semantic rules (key format/uniqueness, label length, select
 * options, key immutability) live in CheckoutFieldsService,
 * which answers with Bengali-first errors.
 */
export class CreateCheckoutFieldDto {
  @IsString() @MaxLength(40) key!: string;
  @IsString() @MaxLength(80) label!: string;
  @IsString() @MaxLength(20) type!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsString() @MaxLength(20) appliesTo?: string;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class UpdateCheckoutFieldDto {
  // Declared so the service can REFUSE a key change explicitly
  // (whitelist would otherwise strip it silently).
  @IsOptional() @IsString() @MaxLength(40) key?: string;
  @IsOptional() @IsString() @MaxLength(80) label?: string;
  @IsOptional() @IsString() @MaxLength(20) type?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsString() @MaxLength(20) appliesTo?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"] as const;

/** AB4 (AX5b) — staff CRUD for custom checkout fields. Mirrors
 * StorefrontStaffController's guard stack exactly (same
 * controller prefix, PermissionArea, guards and WRITE roles);
 * it is a separate controller only because the coordinator split
 * this batch by file. */
@PermissionArea("integrations")
@Controller("organizations/:organizationId/storefront")
@UseGuards(TenantGuard, RolesGuard)
export class CheckoutFieldsController {
  constructor(private readonly fields: CheckoutFieldsService) {}

  @Get("checkout-fields")
  list(@Param("organizationId") orgId: string) {
    return this.fields.list(orgId);
  }

  @Post("checkout-fields")
  @Roles(...WRITE_ROLES)
  create(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CreateCheckoutFieldDto,
  ) {
    return this.fields.create(orgId, user.userId, dto);
  }

  @Patch("checkout-fields/:fieldId")
  @Roles(...WRITE_ROLES)
  update(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("fieldId") fieldId: string,
    @Body() dto: UpdateCheckoutFieldDto,
  ) {
    return this.fields.update(orgId, user.userId, fieldId, dto);
  }

  @Delete("checkout-fields/:fieldId")
  @Roles(...WRITE_ROLES)
  remove(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("fieldId") fieldId: string,
  ) {
    return this.fields.remove(orgId, user.userId, fieldId);
  }
}
