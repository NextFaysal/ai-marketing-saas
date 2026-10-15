import { Body, Controller, Delete, Get, Headers, NotFoundException, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { SocialService, type MediaFileStream } from "./social.service";
import { SocialOAuthService } from "./social-oauth.service";
import { SocialAiService } from "./social-ai.service";
import { SocialImageService } from "./social-image.service";
import { SocialPublishService } from "./social-publish.service";
import { SocialRasterService } from "./social-raster.service";
import { SocialImportService } from "./social-import.service";
import { SocialInsightsService } from "./social-insights.service";
import {
  CreateHashtagSetDto, CreateSocialPostDto, CreateTemplateImageDto, GenerateAiImageDto, GenerateSocialCopyDto, ImportSocialMediaDto, MetaSocialConnectDto, MetaSocialDiscoverDto,
  RejectSocialPostDto, ScheduleSocialPostDto, SelectYouTubeChannelDto, UpdateHashtagSetDto, UpdateSocialPostDto, UpdateSocialSettingsDto, UploadSocialMediaDto,
} from "./social.dto";
import { CurrentUser, AuthUser, Public, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"];

/**
 * PP2 — serve one media file as a byte stream (200, or 206 with
 * Content-Range when the caller asked for a single range). The
 * bytes are piped straight from storage; nothing is buffered.
 */
function sendMediaStream(res: Response, file: MediaFileStream) {
  res.status(file.partial ? 206 : 200);
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Length", String(file.end - file.start + 1));
  if (file.partial) res.setHeader("Content-Range", `bytes ${file.start}-${file.end}/${file.totalSize}`);
  file.stream.on("error", () => res.destroy());
  file.stream.pipe(res);
}

@PermissionArea("social")
@Controller("organizations/:organizationId/social")
@UseGuards(TenantGuard, RolesGuard)
export class SocialController {
  constructor(
    private readonly social: SocialService,
    private readonly socialAi: SocialAiService,
    private readonly socialImage: SocialImageService,
    private readonly publish: SocialPublishService,
    private readonly insights: SocialInsightsService,
    private readonly oauth: SocialOAuthService,
    private readonly raster: SocialRasterService,
    private readonly importer: SocialImportService,
  ) {}

  // Picker step 1: verify + list Pages. Stores nothing.
  @Post("accounts/meta/discover") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  discoverMeta(@Param("organizationId") orgId: string, @Body() dto: MetaSocialDiscoverDto) {
    return this.social.discoverMetaPages(orgId, dto);
  }

  @Post("accounts/meta/connect") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  connectMeta(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: MetaSocialConnectDto) {
    return this.social.connectMetaPages(orgId, user.userId, dto);
  }

  // SP8: TikTok OAuth connect — step 1 returns the authorize URL
  // (the browser goes to TikTok; the callback lands on the public
  // SocialOAuthCallbackController). Not operator-configured → an
  // honest Bengali 400 from the service, never a broken URL.
  // CC4: ?appSource=own connects through the tenant's OWN TikTok
  // app (Connect Center → নিজের অ্যাপ) instead of the platform's.
  @Get("accounts/tiktok/connect-url") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  tiktokConnectUrl(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("appSource") appSource?: string) {
    return this.oauth.tiktokConnectUrl(orgId, user.userId, appSource);
  }

  // SP9: YouTube OAuth connect — same shape. With MORE THAN ONE
  // channel the callback parks the authorization in a pick state;
  // these two endpoints show the choices and finish the connect.
  @Get("accounts/youtube/connect-url") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  youtubeConnectUrl(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.oauth.youtubeConnectUrl(orgId, user.userId);
  }

  @Get("accounts/youtube/pick-info")
  youtubePickInfo(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("state") state: string) {
    return this.oauth.getYouTubePickInfo(orgId, user.userId, state ?? "");
  }

  @Post("accounts/youtube/select-channel") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  youtubeSelectChannel(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: SelectYouTubeChannelDto) {
    return this.oauth.selectYouTubeChannel(orgId, user.userId, dto);
  }

  // SP8/SP9: what the UI may honestly claim about the OAuth
  // platforms (configured? TikTok audited?) — booleans only.
  @Get("platform-modes")
  platformModes() { return this.oauth.getPlatformModes(); }

  @Get("accounts")
  listAccounts(@Param("organizationId") orgId: string) { return this.social.listAccounts(orgId); }

  @Post("accounts/:id/disconnect") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  disconnectAccount(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.social.disconnectAccount(orgId, user.userId, id);
  }

  // SP4 image routes are declared BEFORE the media/:id routes so
  // "ai-image" / "template-image" / "image-status" are never
  // captured as an asset id. PP3's "media/import" follows the
  // same discipline (declared here, before the media/:id routes).
  @Post("media/ai-image") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  generateAiImage(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: GenerateAiImageDto) {
    return this.socialImage.generateAiImage(orgId, user.userId, dto);
  }

  // PP3: import a product's image (its external imageUrl) into
  // the Media Library — guarded server-side fetch, deduped by
  // source URL per org. Response = the serialized asset, exactly
  // like the other media endpoints.
  @Post("media/import") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  importMedia(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: ImportSocialMediaDto) {
    return this.importer.importForProduct(orgId, user.userId, dto.productId);
  }

  @Post("media/template-image") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createTemplateImage(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateTemplateImageDto) {
    return this.socialImage.createTemplateImage(orgId, user.userId, dto);
  }

  @Get("media/image-status")
  imageStatus() { return this.socialImage.imageStatus(); }

  @Post("media") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  uploadMedia(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: UploadSocialMediaDto) {
    return this.social.uploadMedia(orgId, user.userId, dto);
  }

  // PP2: streamed raw-body file upload — the composer's picker
  // posts the File itself (Content-Type = the file's type), so a
  // 256 MB video never becomes a base64 JSON payload or a memory
  // buffer. Declared before the media/:id routes like the other
  // literal media segments.
  @Post("media/upload-file") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  uploadMediaFile(
    @Req() req: Request,
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Query("fileName") fileName?: string,
  ) {
    return this.social.uploadMediaStream(orgId, user.userId, {
      stream: req,
      declaredContentType: req.headers["content-type"],
      fileName: fileName || undefined,
    });
  }

  @Get("media/limits")
  mediaLimits() { return this.social.mediaLimits(); }

  @Get("media")
  listMedia(@Param("organizationId") orgId: string) { return this.social.listMedia(orgId); }

  @Get("media/:id/file")
  async mediaFile(
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
    @Headers("range") range: string | undefined,
    @Res() res: Response,
  ) {
    // PP2: streamed + range-capable (large videos). The service
    // throws the same 404s as before when asset/bytes are missing.
    const file = await this.social.getMediaFileStream(orgId, id, range);
    sendMediaStream(res, file);
  }

  @Post("media/:id/public-link") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createPublicLink(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.social.createPublicLink(orgId, user.userId, id);
  }

  @Delete("media/:id/public-link") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  removePublicLink(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.social.removePublicLink(orgId, user.userId, id);
  }

  // PP1: build (or reuse) the PNG version of an SVG asset so it
  // can be picked for Meta/Instagram publishing directly from the
  // library, without waiting for the publish path to convert it.
  @Post("media/:id/rasterize") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  rasterizeMedia(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.raster.rasterizeAsset(orgId, user.userId, id);
  }

  @Post("posts/ai-copy") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  generateCopy(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: GenerateSocialCopyDto) {
    return this.socialAi.generateCopy(orgId, user.userId, dto);
  }

  @Get("hashtag-sets")
  listHashtagSets(@Param("organizationId") orgId: string) { return this.social.listHashtagSets(orgId); }

  @Post("hashtag-sets") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createHashtagSet(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateHashtagSetDto) {
    return this.social.createHashtagSet(orgId, user.userId, dto);
  }

  @Patch("hashtag-sets/:id") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateHashtagSet(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Body() dto: UpdateHashtagSetDto) {
    return this.social.updateHashtagSet(orgId, user.userId, id, dto);
  }

  @Delete("hashtag-sets/:id") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deleteHashtagSet(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.social.deleteHashtagSet(orgId, user.userId, id);
  }

  // SP7: org social settings + insights summary. Declared before
  // the posts/:id routes; "settings" / "insights" are literal
  // first segments so they never collide with "posts/:id".
  @Get("settings")
  getSettings(@Param("organizationId") orgId: string) { return this.social.getSocialSettings(orgId); }

  @Patch("settings") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  updateSettings(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: UpdateSocialSettingsDto) {
    return this.social.updateSocialSettings(orgId, user.userId, dto);
  }

  @Get("insights/summary")
  insightsSummary(@Param("organizationId") orgId: string) { return this.insights.getInsightsSummary(orgId); }

  // SP7: bulk insights refresh — declared BEFORE "posts/:id/..."
  // so the literal "refresh-insights" segment is never read as an
  // id-shaped route by a future bare posts/:id POST route.
  @Post("posts/refresh-insights") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  refreshAllInsights(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.insights.refreshAllInsights(orgId, user.userId);
  }

  @Post("posts") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createPost(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateSocialPostDto) {
    return this.social.createPost(orgId, user.userId, dto);
  }

  @Get("posts")
  listPosts(@Param("organizationId") orgId: string, @Query("status") status?: string, @Query("accountId") accountId?: string) {
    return this.social.listPosts(orgId, { status, accountId });
  }

  @Get("posts/:id")
  getPost(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.social.getPost(orgId, id);
  }

  @Patch("posts/:id") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updatePost(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Body() dto: UpdateSocialPostDto) {
    return this.social.updatePost(orgId, user.userId, id, dto);
  }

  @Delete("posts/:id") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deletePost(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.social.deletePost(orgId, user.userId, id);
  }

  // SP5: scheduling + manual publish. The publish worker (the
  // social_publish_due automation job) drives scheduled posts;
  // publish-now runs the same single publish path immediately.
  @Post("posts/:id/schedule") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  schedulePost(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Body() dto: ScheduleSocialPostDto) {
    return this.social.schedulePost(orgId, user.userId, id, dto);
  }

  @Post("posts/:id/cancel-schedule") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  cancelSchedule(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.social.cancelSchedule(orgId, user.userId, id);
  }

  @Post("posts/:id/publish-now") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  publishNow(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.publish.publishNow(orgId, user.userId, id);
  }

  // SP7: insights refresh for one published post + the approval
  // flow. Approve/reject are WRITE_ROLES at the door; the service
  // additionally enforces approver = OWNER/ADMIN (403 otherwise),
  // because the M72 `social` area lets MARKETING_MANAGER write.
  @Post("posts/:id/refresh-insights") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  refreshPostInsights(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.insights.refreshPostInsights(orgId, user.userId, id);
  }

  @Post("posts/:id/submit-approval") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  submitApproval(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.social.submitForApproval(orgId, user.userId, id);
  }

  @Post("posts/:id/approve") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  approvePost(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.social.approvePost(orgId, user.userId, id);
  }

  @Post("posts/:id/reject") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  rejectPost(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Body() dto: RejectSocialPostDto) {
    return this.social.rejectPost(orgId, user.userId, id, dto);
  }
}

/**
 * Public, unauthenticated media bytes by unguessable token — the
 * route Instagram publishing needs (it fetches media from a public
 * URL). A token exists ONLY when the tenant explicitly created a
 * public link for that asset; tenant media is private by default.
 * Nothing about the asset or its org is exposed beyond the bytes.
 */
@Controller("public/media")
export class PublicMediaController {
  constructor(private readonly social: SocialService) {}

  @Public()
  @Get(":token")
  async media(@Param("token") token: string, @Headers("range") range: string | undefined, @Res() res: Response) {
    // PP2: platforms (Meta/TikTok) pull media from this route —
    // including 256 MB videos — so it streams with Range support
    // instead of buffering the whole object into memory.
    const file = await this.social.resolvePublicMediaStream(token, range);
    if (!file) throw new NotFoundException("Media not found");
    sendMediaStream(res, file);
  }
}

/**
 * SP8/SP9: PUBLIC OAuth callbacks for the operator-app platforms.
 * No auth guard can apply (the browser arrives from TikTok /
 * Google) — security lives in the signed-out state row instead:
 * unguessable, org+user+platform-bound, 10-minute, single-use.
 * Every outcome is a 302 back to the web app's Social Posts page
 * with social_connected / social_error — never a 500, never a
 * stack. The service methods never throw by contract; the
 * try/catch here is belt-and-braces for the redirect itself.
 */
@Controller("social/oauth")
export class SocialOAuthCallbackController {
  constructor(private readonly oauth: SocialOAuthService) {}

  @Public()
  @Get("tiktok/callback")
  async tiktokCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Query("error_description") errorDescription: string | undefined,
    @Res() res: Response,
  ) {
    const url = await this.oauth.handleTikTokCallback({ code, state, error, errorDescription });
    return res.redirect(302, url);
  }

  @Public()
  @Get("youtube/callback")
  async youtubeCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Res() res: Response,
  ) {
    const url = await this.oauth.handleYouTubeCallback({ code, state, error });
    return res.redirect(302, url);
  }
}
