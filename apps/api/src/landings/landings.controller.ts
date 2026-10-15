import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { LandingsService } from "./landings.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import {
  CreateLandingDto,
  CreateLandingVariantDto,
  UpdateLandingDto,
  UpdateLandingVariantDto,
} from "./landings.dto";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"] as const;

/** EC13 staff landing administration. DELETE archives (see the
 *  service) — attributed orders keep their funnel history. */
@PermissionArea("integrations")
@Controller("organizations/:organizationId/landings")
@UseGuards(TenantGuard, RolesGuard)
export class LandingsStaffController {
  constructor(private readonly landings: LandingsService) {}

  @Post()
  @Roles(...WRITE_ROLES)
  create(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CreateLandingDto,
  ) {
    return this.landings.create(orgId, user.userId, dto);
  }

  @Get()
  list(@Param("organizationId") orgId: string) {
    return this.landings.list(orgId);
  }

  @Get(":id/stats")
  stats(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.landings.stats(orgId, id);
  }

  @Get(":id")
  getOne(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.landings.getOne(orgId, id);
  }

  @Patch(":id")
  @Roles(...WRITE_ROLES)
  update(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
    @Body() dto: UpdateLandingDto,
  ) {
    return this.landings.update(orgId, user.userId, id, dto);
  }

  @Delete(":id")
  @Roles(...WRITE_ROLES)
  archive(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
  ) {
    return this.landings.archive(orgId, user.userId, id);
  }

  @Post(":id/variants")
  @Roles(...WRITE_ROLES)
  createVariant(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
    @Body() dto: CreateLandingVariantDto,
  ) {
    return this.landings.createVariant(orgId, user.userId, id, dto);
  }

  @Patch(":id/variants/:variantId")
  @Roles(...WRITE_ROLES)
  updateVariant(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
    @Param("variantId") variantId: string,
    @Body() dto: UpdateLandingVariantDto,
  ) {
    return this.landings.updateVariant(orgId, user.userId, id, variantId, dto);
  }

  @Delete(":id/variants/:variantId")
  @Roles(...WRITE_ROLES)
  deleteVariant(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
    @Param("variantId") variantId: string,
  ) {
    return this.landings.deleteVariant(orgId, user.userId, id, variantId);
  }
}
