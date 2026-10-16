import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { IsArray, IsString, MaxLength, MinLength } from "class-validator";
import { MerchantApiService } from "./merchant-api.service";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { CurrentUser, Roles, type AuthUser } from "../common/decorators";

class CreateMerchantApiKeyDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsArray() @IsString({ each: true }) scopes!: string[];
}

const READ_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER"] as const;
const WRITE_ROLES = ["OWNER", "ADMIN"] as const;

/**
 * AB8 (AX21) — staff key management for the merchant developer
 * API, guarded exactly like the GC23 webhooks controller
 * (TenantGuard + RolesGuard; org from the tenant-guarded route
 * param). Writes are OWNER/ADMIN only: a key grants programmatic
 * access to the org's products/orders/customers, so minting or
 * revoking one is an admin act. The plaintext key is returned
 * exactly once, by the create response.
 */
@Controller("organizations/:organizationId/merchant-api-keys")
@UseGuards(TenantGuard, RolesGuard)
export class MerchantApiKeysController {
  constructor(private readonly keys: MerchantApiService) {}

  @Post()
  @Roles(...WRITE_ROLES)
  create(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateMerchantApiKeyDto) {
    return this.keys.createKey(orgId, user.userId, { name: dto.name, scopes: dto.scopes });
  }

  @Get()
  @Roles(...READ_ROLES)
  list(@Param("organizationId") orgId: string) {
    return this.keys.listKeys(orgId);
  }

  @Delete(":keyId")
  @Roles(...WRITE_ROLES)
  revoke(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("keyId") keyId: string) {
    return this.keys.revokeKey(orgId, keyId, user.userId);
  }
}
