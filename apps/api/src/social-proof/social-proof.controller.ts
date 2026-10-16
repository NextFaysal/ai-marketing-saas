import { Body, Controller, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import { SocialProofService } from "./social-proof.service";
import { UpdateSocialProofSettingDto } from "./social-proof.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea, Public } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { RateLimit } from "../common/throttler.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"] as const;

/**
 * AB7 (AX17) — staff social-proof setting. Mirrors
 * StorefrontStaffController's guard stack exactly (same
 * PermissionArea, TenantGuard + RolesGuard, WRITE roles); the
 * prefix carries the setting's own segment so the coordinator
 * can wire this module without touching the storefront routes.
 */
@PermissionArea("integrations")
@Controller("organizations/:organizationId/social-proof")
@UseGuards(TenantGuard, RolesGuard)
export class SocialProofStaffController {
  constructor(private readonly socialProof: SocialProofService) {}

  @Get("setting")
  getSetting(@Param("organizationId") orgId: string) {
    return this.socialProof.getSetting(orgId);
  }

  @Put("setting")
  @Roles(...WRITE_ROLES)
  updateSetting(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: UpdateSocialProofSettingDto,
  ) {
    return this.socialProof.updateSetting(orgId, user.userId, dto);
  }
}

/**
 * AB7 (AX17) — public social-proof routes, in the codebase's
 * public-route pattern (@Public + the `public/shop` prefix, like
 * PublicShopController). Declared on their own controller (not
 * PublicShopController) so this batch stays in its own files;
 * the GB9 public-docs introspection covers only its four frozen
 * controllers, so these routes do not enter that inventory unless
 * the coordinator deliberately adds this controller there.
 */
@Controller("public/shop")
export class SocialProofPublicController {
  constructor(private readonly socialProof: SocialProofService) {}

  /** The anonymized recent-sales feed (real SOLD orders only). */
  @Public()
  @Get(":orgSlug/social-proof")
  feed(@Param("orgSlug") orgSlug: string) {
    return this.socialProof.getPublicFeed(orgSlug);
  }

  /** Dedicated impression counter (see SocialProofService.recordImpression). */
  @Public()
  @RateLimit(60, 60)
  @Post(":orgSlug/social-proof/impression")
  impression(@Param("orgSlug") orgSlug: string) {
    return this.socialProof.recordImpression(orgSlug);
  }
}
