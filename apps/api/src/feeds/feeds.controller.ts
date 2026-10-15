import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { FeedsService } from "./feeds.service";
import { CreateFeedDto, SetFeedActiveDto, UpdateFeedDto } from "./feeds.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea, Public } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"] as const;

/** EC14 staff feed administration (same guard stack as the
 * Commerce controller). */
@PermissionArea("integrations")
@Controller("organizations/:organizationId/commerce/feeds")
@UseGuards(TenantGuard, RolesGuard)
export class FeedsStaffController {
  constructor(private readonly feeds: FeedsService) {}

  @Get()
  list(@Param("organizationId") orgId: string) {
    return this.feeds.list(orgId);
  }

  @Get(":feedId")
  getOne(@Param("organizationId") orgId: string, @Param("feedId") feedId: string) {
    return this.feeds.getOne(orgId, feedId);
  }

  @Get(":feedId/preview")
  preview(@Param("organizationId") orgId: string, @Param("feedId") feedId: string) {
    return this.feeds.preview(orgId, feedId);
  }

  @Post()
  @Roles(...WRITE_ROLES)
  create(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateFeedDto) {
    return this.feeds.create(orgId, user.userId, dto);
  }

  @Patch(":feedId")
  @Roles(...WRITE_ROLES)
  update(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("feedId") feedId: string,
    @Body() dto: UpdateFeedDto,
  ) {
    return this.feeds.update(orgId, user.userId, feedId, dto);
  }

  @Post(":feedId/active")
  @Roles(...WRITE_ROLES)
  setActive(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("feedId") feedId: string,
    @Body() dto: SetFeedActiveDto,
  ) {
    return this.feeds.setActive(orgId, user.userId, feedId, dto.active === true);
  }

  @Post(":feedId/rotate-token")
  @Roles(...WRITE_ROLES)
  rotateToken(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("feedId") feedId: string,
  ) {
    return this.feeds.rotateToken(orgId, user.userId, feedId);
  }

  @Delete(":feedId")
  @Roles(...WRITE_ROLES)
  remove(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("feedId") feedId: string,
  ) {
    return this.feeds.remove(orgId, user.userId, feedId);
  }
}

/** EC14 public feed file. The token in the URL is the credential;
 * unknown tokens, inactive feeds and wrong extensions all answer
 * the same 404. */
@Controller("feeds")
export class FeedsPublicController {
  constructor(private readonly feeds: FeedsService) {}

  @Public()
  @Get(":fileName")
  async serve(@Param("fileName") fileName: string, @Res() res: Response) {
    const dot = fileName.lastIndexOf(".");
    if (dot <= 0) throw new NotFoundException("Feed not found");
    const token = fileName.slice(0, dot);
    const ext = fileName.slice(dot + 1).toLowerCase();
    if (ext !== "xml" && ext !== "csv") throw new NotFoundException("Feed not found");
    const { contentType, body } = await this.feeds.serveByToken(token, ext);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(body);
  }
}
