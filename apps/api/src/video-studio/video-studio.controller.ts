import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { VideoStudioService } from "./video-studio.service";
import { CreateVideoProjectDto, PublishVideoProjectDto } from "./video-studio.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;

/**
 * NF2 (FB1) — Short Video Studio staff surface.
 * @PermissionArea("social"): the studio's output IS a social
 * post (publishing goes through SocialService.createPost), so
 * the social area governs the whole surface — the products /
 * orders areas would mis-gate a publishing tool. Follows the
 * LiveCommerceController conventions: organizations/
 * :organizationId base, TenantGuard + RolesGuard, writes
 * restricted to OWNER/ADMIN/MARKETING_MANAGER/SUPPORT_AGENT.
 *
 * Create returns the queued project immediately and triggers a
 * render attempt fire-and-forget (the knowledge-indexing
 * trigger pattern); failures land on the project row itself
 * (status=failed + errorLabel) and the video_render_sweep job
 * reconciles anything the trigger missed.
 */
@PermissionArea("social")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class VideoStudioController {
  constructor(private readonly video: VideoStudioService) {}

  @Post("video-projects") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  async createProject(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CreateVideoProjectDto,
  ) {
    const created = await this.video.createProject(orgId, user.userId, dto);
    void this.video.renderProject(orgId, created.id).catch(() => undefined);
    return created;
  }

  @Get("video-projects")
  listProjects(@Param("organizationId") orgId: string) {
    return this.video.listProjects(orgId);
  }

  @Get("video-projects/:id")
  getProject(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.video.getProject(orgId, id);
  }

  @Post("video-projects/:id/render") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  renderProject(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.video.renderProject(orgId, id);
  }

  @Post("video-projects/:id/publish") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  publishProject(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
    @Body() dto: PublishVideoProjectDto,
  ) {
    return this.video.publishProject(orgId, user.userId, id, dto);
  }
}
