import { BadRequestException, Body, Controller, Delete, Get, Headers, NotFoundException, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { SocialService, type MediaFileStream } from "./social.service";
import { SocialOAuthService } from "./social-oauth.service";
import { SocialAiService } from "./social-ai.service";
import { SocialImageService } from "./social-image.service";
import { SocialPublishService } from "./social-publish.service";
import { SocialRasterService } from "./social-raster.service";
import { SocialImportService } from "./social-import.service";
import { SocialInsightsService } from "./social-insights.service";
import { SocialQueueService } from "./social-queue.service";
import { SocialMediaLibraryService } from "./social-media-library.service";
import { SocialCommerceDraftService } from "./social-commerce-draft.service";
import { SocialLinkService } from "./social-link.service";
import { SocialHealthService } from "./social-health.service";
import { SocialShareService } from "./social-share.service";
import { SocialStockService } from "./social-stock.service";
import { SocialCoachService } from "./social-coach.service";
import {
  BulkMediaDto, BulkSocialPostsDto, ConnectTelegramDto, CoverMediaDto, CreateCaptionTestDto, CreateHashtagSetDto, CreateMediaFolderDto, CreateSocialPostDto, CreateSocialPostGroupDto, CreateSocialPostingSlotDto, CreateTemplateImageDto, DeriveSocialPostDto, EditMediaAssetDto, GenerateAiImageDto, GenerateCarouselOutlineDto, GenerateContentPlanDto, GenerateSocialCopyDto, GenerateSocialScriptDto, GenerateSocialVariantsDto, ImportSocialMediaDto, MaterializeContentPlanDto, MetaSocialConnectDto, MetaSocialDiscoverDto, TranslateSocialTextDto,
  AssignSocialPostDto, BrandOverlayMediaDto, CreateShareLinkDto, CreateSocialPostNoteDto, ImportStockMediaDto, RejectSocialPostDto, SaveStockKeyDto, ScheduleSocialPostDto, SelectGoogleBusinessLocationDto, SelectLinkedInOrganizationDto, SelectYouTubeChannelDto, SubmitClientReviewDto, UpdateAutoDraftSettingsDto, UpdateEvergreenDto, UpdateHashtagSetDto, UpdateMediaAssetDto, UpdateMediaFolderDto, UpdateSocialPostDto, UpdateSocialPostingSlotDto, UpdateSocialSettingsDto, UploadSocialMediaDto,
} from "./social.dto";
import { buildMonthlyReportCsv, buildMonthlyReportPdf } from "./social-insights.service";
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
    private readonly queue: SocialQueueService,
    private readonly library: SocialMediaLibraryService,
    private readonly commerceDrafts: SocialCommerceDraftService,
    private readonly links: SocialLinkService,
    private readonly health: SocialHealthService,
    // SN2: client-approval share links. LAST param (the module
    // provides it; no existing construction order changes).
    private readonly shares: SocialShareService,
    // SN5: stock media (Pexels). Appended after shares for the
    // same reason — existing positional constructions stay put.
    private readonly stock: SocialStockService,
    // SN9: the performance coach (latest digest + live preview).
    private readonly coach: SocialCoachService,
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
  // CC28: ?appSource=own connects through the tenant's OWN Google
  // app (YouTube rides the Google OAuth client).
  @Get("accounts/youtube/connect-url") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  youtubeConnectUrl(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("appSource") appSource?: string) {
    return this.oauth.youtubeConnectUrl(orgId, user.userId, appSource);
  }

  @Get("accounts/youtube/pick-info")
  youtubePickInfo(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("state") state: string) {
    return this.oauth.getYouTubePickInfo(orgId, user.userId, state ?? "");
  }

  @Post("accounts/youtube/select-channel") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  youtubeSelectChannel(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: SelectYouTubeChannelDto) {
    return this.oauth.selectYouTubeChannel(orgId, user.userId, dto);
  }

  // CC20: LinkedIn Page OAuth connect. CC28: ?appSource=own
  // connects through the tenant's OWN LinkedIn app (Connect
  // Center → নিজের অ্যাপ → LinkedIn). With MORE THAN ONE admin'd
  // Page the callback parks the authorization in a pick state;
  // these endpoints show the choices and finish the connect.
  @Get("accounts/linkedin/connect-url") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  linkedinConnectUrl(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("appSource") appSource?: string) {
    return this.oauth.linkedinConnectUrl(orgId, user.userId, appSource);
  }

  @Get("accounts/linkedin/pick-info")
  linkedinPickInfo(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("state") state: string) {
    return this.oauth.getLinkedInPickInfo(orgId, user.userId, state ?? "");
  }

  @Post("accounts/linkedin/select-organization") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  linkedinSelectOrganization(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: SelectLinkedInOrganizationDto) {
    return this.oauth.selectLinkedInOrganization(orgId, user.userId, dto);
  }

  // SN6: Telegram channel connect — NOT OAuth: the tenant pastes
  // their own BotFather bot token + channel; the service verifies
  // bot → channel → admin BEFORE saving anything, and a failed
  // verification returns Telegram's verbatim message in a 400.
  @Post("accounts/telegram/connect") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  telegramConnect(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: ConnectTelegramDto) {
    return this.oauth.connectTelegramChannel(orgId, user.userId, dto);
  }

  // SN7: Threads OAuth connect — same shape as TikTok/YouTube.
  // ?appSource=own connects through the tenant's OWN Threads app
  // (Connect Center → নিজের অ্যাপ → Threads). One authorization
  // yields one Threads profile, so there is no picker.
  @Get("accounts/threads/connect-url") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  threadsConnectUrl(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("appSource") appSource?: string) {
    return this.oauth.threadsConnectUrl(orgId, user.userId, appSource);
  }

  // OU9: Google Business Profile OAuth connect — the YouTube
  // flow's shape on the same Google app (plus ?appSource=own
  // for the tenant's OWN Google app, CC28). With MORE THAN ONE
  // location the callback parks the authorization in a pick
  // state; these two endpoints show the locations and finish
  // the connect. Publishing additionally requires Google's
  // API-access approval for the platform project — that gate
  // lives in platform-modes + the publish path, not here.
  @Get("accounts/google-business-profile/connect-url") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  googleBusinessConnectUrl(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("appSource") appSource?: string) {
    return this.oauth.googleBusinessConnectUrl(orgId, user.userId, appSource);
  }

  @Get("accounts/google-business-profile/pick-info")
  googleBusinessPickInfo(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("state") state: string) {
    return this.oauth.getGoogleBusinessPickInfo(orgId, user.userId, state ?? "");
  }

  @Post("accounts/google-business-profile/select-location") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  googleBusinessSelectLocation(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: SelectGoogleBusinessLocationDto) {
    return this.oauth.selectGoogleBusinessLocation(orgId, user.userId, dto);
  }

  // SP8/SP9: what the UI may honestly claim about the OAuth
  // platforms (configured? TikTok audited?) — booleans only.
  @Get("platform-modes")
  platformModes() { return this.oauth.getPlatformModes(); }

  // SU10: account health list — the literal "health" segment is
  // declared with (and before) the bare accounts routes.
  @Get("accounts/health")
  listAccountHealth(@Param("organizationId") orgId: string) { return this.health.listAccountHealth(orgId); }

  @Get("accounts")
  listAccounts(@Param("organizationId") orgId: string) { return this.social.listAccounts(orgId); }

  @Post("accounts/:id/disconnect") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  disconnectAccount(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.social.disconnectAccount(orgId, user.userId, id);
  }

  // SU10: on-demand health check for ONE account (same
  // OWNER/ADMIN gate as disconnect).
  @Post("accounts/:id/check-health") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  checkAccountHealth(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.health.checkAccountHealth(orgId, user.userId, id);
  }

  // SN1: the account channel's YouTube playlists (composer
  // picker). A non-YouTube account gets the service's honest
  // Bengali 400.
  @Get("accounts/:id/youtube/playlists")
  listYouTubePlaylists(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.publish.listYouTubePlaylists(orgId, id);
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

  // SN5: stock media (Pexels, the org's OWN key) — the literal
  // "stock" segments are declared with the other literal media
  // segments, BEFORE every media/:id route. The key status shape
  // carries configured + last-4 only; the key itself is never in
  // any response.
  @Get("media/stock/config")
  stockConfig(@Param("organizationId") orgId: string) { return this.stock.getStockStatus(orgId); }

  @Put("media/stock/config") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  saveStockConfig(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: SaveStockKeyDto) {
    return this.stock.saveStockKey(orgId, user.userId, dto);
  }

  @Delete("media/stock/config") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  deleteStockConfig(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.stock.deleteStockKey(orgId, user.userId);
  }

  @Get("media/stock/search")
  stockSearch(
    @Param("organizationId") orgId: string,
    @Query("q") q?: string,
    @Query("kind") kind?: string,
    @Query("page") page?: string,
  ) { return this.stock.searchStock(orgId, { q, kind, page: page === undefined ? undefined : Number(page) }); }

  @Post("media/stock/import") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  stockImport(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: ImportStockMediaDto) {
    return this.stock.importStock(orgId, user.userId, dto);
  }

  // SU3: media library — the literal "folders" / "bulk" segments
  // are declared BEFORE every media/:id route below so they are
  // never captured as an asset id.
  @Get("media/folders")
  listMediaFolders(@Param("organizationId") orgId: string) { return this.library.listFolders(orgId); }

  @Post("media/folders") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createMediaFolder(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateMediaFolderDto) {
    return this.library.createFolder(orgId, user.userId, dto);
  }

  @Patch("media/folders/:id") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateMediaFolder(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Body() dto: UpdateMediaFolderDto) {
    return this.library.updateFolder(orgId, user.userId, id, dto);
  }

  @Delete("media/folders/:id") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deleteMediaFolder(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.library.deleteFolder(orgId, user.userId, id);
  }

  @Post("media/bulk") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  bulkMedia(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: BulkMediaDto) {
    return this.library.bulkMedia(orgId, user.userId, dto);
  }

  // SU3: GET media now goes through the library service (folder /
  // tag / name filters); SocialService.listMedia stays for its
  // other callers.
  @Get("media")
  listMedia(
    @Param("organizationId") orgId: string,
    @Query("folderId") folderId?: string,
    @Query("tag") tag?: string,
    @Query("q") q?: string,
  ) { return this.library.listMedia(orgId, { folderId, tag, q }); }

  @Patch("media/:id") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateMedia(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Body() dto: UpdateMediaAssetDto) {
    return this.library.updateMedia(orgId, user.userId, id, dto);
  }

  @Get("media/:id/usage")
  mediaUsage(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.library.getUsage(orgId, id);
  }

  // SU3: aspect-ratio edit — a NEW derived asset; the source is
  // never modified.
  @Post("media/:id/edit") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  editMedia(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Body() dto: EditMediaAssetDto) {
    return this.library.editAsset(orgId, user.userId, id, dto);
  }

  // SU3: video cover frame — derived image asset (honest 400
  // when the host has no ffmpeg).
  @Post("media/:id/cover") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  coverMedia(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Body() dto: CoverMediaDto) {
    return this.library.coverFromVideo(orgId, user.userId, id, dto.atSeconds);
  }

  // SN5: brand overlay — derived image asset with the org's
  // logo + brand bar (image assets only; the source untouched).
  @Post("media/:id/brand-overlay") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  brandOverlayMedia(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Body() dto: BrandOverlayMediaDto) {
    return this.library.brandOverlay(orgId, user.userId, id, dto);
  }

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

  // SU4: monthly AI content plan + Reel/Short script (both
  // literal segments under posts, beside ai-copy).
  @Post("posts/ai-content-plan") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  generateContentPlan(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: GenerateContentPlanDto) {
    return this.socialAi.generateContentPlan(orgId, user.userId, dto);
  }

  @Post("posts/ai-script") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  generateScript(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: GenerateSocialScriptDto) {
    return this.socialAi.generateScript(orgId, user.userId, dto);
  }

  // SN4: AI platform variants / translation / carousel outline —
  // all literal segments under posts (beside ai-script), all
  // RETURN ONLY from the service (nothing is saved).
  @Post("posts/ai-variants") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  generateVariants(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: GenerateSocialVariantsDto) {
    return this.socialAi.generateVariants(orgId, user.userId, dto);
  }

  @Post("posts/ai-translate") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  translateText(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: TranslateSocialTextDto) {
    return this.socialAi.translateText(orgId, user.userId, dto);
  }

  @Post("posts/ai-carousel-outline") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  generateCarouselOutline(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: GenerateCarouselOutlineDto) {
    return this.socialAi.generateCarouselOutline(orgId, user.userId, dto);
  }

  // SU4: saved content plans — "content-plans" is its own first
  // segment, so it never collides with posts/:id.
  @Get("content-plans")
  listContentPlans(@Param("organizationId") orgId: string) { return this.socialAi.listContentPlans(orgId); }

  @Get("content-plans/:id")
  getContentPlan(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.socialAi.getContentPlan(orgId, id);
  }

  @Post("content-plans/:id/materialize") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  materializeContentPlan(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Body() dto: MaterializeContentPlanDto) {
    return this.socialAi.materializePlan(orgId, user.userId, id, dto);
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

  // SU5: commerce auto-draft settings — "auto-draft-settings"
  // is a literal first segment like "settings", so it never
  // collides with posts/:id. No config row reads as all-off
  // defaults (the service does not write on read).
  @Get("auto-draft-settings")
  getAutoDraftSettings(@Param("organizationId") orgId: string) { return this.commerceDrafts.getSettings(orgId); }

  @Patch("auto-draft-settings") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  updateAutoDraftSettings(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: UpdateAutoDraftSettingsDto) {
    return this.commerceDrafts.updateSettings(orgId, user.userId, dto);
  }

  @Get("insights/summary")
  insightsSummary(@Param("organizationId") orgId: string) { return this.insights.getInsightsSummary(orgId); }

  // SN10: caption-test pairs for the Analytics comparison.
  @Get("insights/caption-tests")
  insightsCaptionTests(@Param("organizationId") orgId: string) { return this.insights.listCaptionTests(orgId); }

  // SU4: hashtag performance from the org's own published posts.
  @Get("insights/hashtags")
  insightsHashtags(@Param("organizationId") orgId: string) { return this.insights.hashtagPerformance(orgId); }

  // SN9: the performance coach — latest weekly digest + a live
  // compute preview (the preview never calls the LLM).
  @Get("insights/coach")
  insightsCoach(@Param("organizationId") orgId: string) { return this.coach.getCoach(orgId); }

  // SU7: analytics v2 — daily time series, per-account
  // comparison, content-type analysis, follower history.
  @Get("insights/timeseries")
  insightsTimeseries(@Param("organizationId") orgId: string, @Query("days") days?: string) {
    return this.insights.timeseries(orgId, days === undefined ? undefined : Number(days));
  }

  @Get("insights/content-types")
  insightsContentTypes(@Param("organizationId") orgId: string) { return this.insights.contentTypes(orgId); }

  @Get("insights/accounts")
  insightsAccounts(@Param("organizationId") orgId: string) { return this.insights.accountsComparison(orgId); }

  @Get("insights/followers")
  insightsFollowers(@Param("organizationId") orgId: string) { return this.insights.followers(orgId); }

  // SU7: monthly report exports (@Res pattern, reports
  // controller convention). Declared here with the other literal
  // "insights/..." segments. A malformed month is the service's
  // Bengali 400.
  @Get("insights/report.csv")
  async insightsReportCsv(@Param("organizationId") orgId: string, @Query("month") month: string | undefined, @Res() res: Response) {
    const report = await this.insights.monthlyReport(orgId, month);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="social-report-${report.month}.csv"`);
    res.send(buildMonthlyReportCsv(report.rows, report.month));
  }

  @Get("insights/report.pdf")
  async insightsReportPdf(@Param("organizationId") orgId: string, @Query("month") month: string | undefined, @Res() res: Response) {
    const report = await this.insights.monthlyReport(orgId, month);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="social-report-${report.month}.pdf"`);
    res.send(buildMonthlyReportPdf(report.rows, report.month));
  }

  // SP7: bulk insights refresh — declared BEFORE "posts/:id/..."
  // so the literal "refresh-insights" segment is never read as an
  // id-shaped route by a future bare posts/:id POST route.
  @Post("posts/refresh-insights") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  refreshAllInsights(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.insights.refreshAllInsights(orgId, user.userId);
  }

  // SU1: post groups — "groups" is its own first segment and
  // "posts/group" a literal under posts, so neither collides
  // with posts/:id.
  @Post("posts/group") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createPostGroup(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateSocialPostGroupDto) {
    return this.social.createPostGroup(orgId, user.userId, dto);
  }

  @Get("groups")
  listGroups(@Param("organizationId") orgId: string) { return this.social.listGroups(orgId); }

  @Get("groups/:id")
  getGroup(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.social.getGroup(orgId, id);
  }

  // SU2: posting slots — literal "posting-slots" segment.
  @Get("posting-slots")
  listSlots(@Param("organizationId") orgId: string) { return this.queue.listSlots(orgId); }

  @Post("posting-slots") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createSlot(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateSocialPostingSlotDto) {
    return this.queue.createSlot(orgId, user.userId, dto);
  }

  @Patch("posting-slots/:id") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateSlot(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Body() dto: UpdateSocialPostingSlotDto) {
    return this.queue.updateSlot(orgId, user.userId, id, dto);
  }

  @Delete("posting-slots/:id") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deleteSlot(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.queue.deleteSlot(orgId, user.userId, id);
  }

  @Post("posts") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createPost(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateSocialPostDto) {
    return this.social.createPost(orgId, user.userId, dto);
  }

  @Get("posts")
  listPosts(
    @Param("organizationId") orgId: string,
    @Query("status") status?: string,
    @Query("accountId") accountId?: string,
    @Query("assignedUserId") assignedUserId?: string,
    @Query("q") q?: string,
    // SU11: cursor pagination is opt-in — the service receives
    // cursor/limit keys ONLY when a param was actually given
    // ("" = first page), so every existing caller keeps the
    // exact legacy bare-array response.
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.social.listPosts(orgId, {
      status, accountId, assignedUserId, q,
      ...(cursor !== undefined || limit !== undefined
        ? { cursor: cursor === "" || cursor === undefined ? null : cursor, limit: limit === undefined ? undefined : Number(limit) }
        : {}),
    });
  }

  // SU11: bulk actions — the literal "bulk" segment MUST stay
  // before posts/:id, or it would be captured as an id.
  @Post("posts/bulk") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  bulkPosts(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: BulkSocialPostsDto) {
    return this.social.bulkPosts(orgId, user.userId, dto);
  }

  // SU11: CSV bulk draft import — raw text body (the file's text
  // IS the payload, whatever the content-type), read off the
  // request stream like media/upload-file does. Also before
  // posts/:id for the same literal-segment reason.
  @Post("posts/import-csv") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  async importPostsCsv(@Req() req: Request, @CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req as AsyncIterable<Buffer | Uint8Array>) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > 5_000_000) {
        (req as unknown as { destroy?: () => void }).destroy?.();
        throw new BadRequestException("CSV ফাইলটি অনেক বড় — সর্বোচ্চ ৫ MB-এর মধ্যে রাখুন।");
      }
      chunks.push(buf);
    }
    return this.social.importPostsCsv(orgId, user.userId, Buffer.concat(chunks).toString("utf8"));
  }

  // SU10: failure center — the literal "failures" segment MUST
  // stay before posts/:id, or it would be captured as an id.
  @Get("posts/failures")
  listPostFailures(@Param("organizationId") orgId: string) { return this.health.listPostFailures(orgId); }

  @Get("posts/:id")
  getPost(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.social.getPost(orgId, id);
  }

  // SU6: per-post tracked-link stats (clicks + associated
  // orders/revenue, labelled association — never attribution).
  @Get("posts/:id/link-stats")
  linkStats(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.links.getLinkStats(orgId, id);
  }

  // SU9: collaboration — internal notes (team-only, never sent
  // to a platform), version history + restore, the merged
  // activity timeline, and assignment.
  @Get("posts/:id/notes")
  listPostNotes(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.social.listPostNotes(orgId, id);
  }

  @Post("posts/:id/notes") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createPostNote(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Body() dto: CreateSocialPostNoteDto) {
    return this.social.createPostNote(orgId, user.userId, id, dto);
  }

  @Delete("posts/:id/notes/:noteId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deletePostNote(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Param("noteId") noteId: string) {
    return this.social.deletePostNote(orgId, user.userId, id, noteId);
  }

  @Get("posts/:id/versions")
  listPostVersions(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.social.listPostVersions(orgId, id);
  }

  @Post("posts/:id/versions/:versionId/restore") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  restorePostVersion(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Param("versionId") versionId: string) {
    return this.social.restorePostVersion(orgId, user.userId, id, versionId);
  }

  @Get("posts/:id/timeline")
  postTimeline(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.social.getPostTimeline(orgId, id);
  }

  @Post("posts/:id/assign") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  assignPost(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Body() dto: AssignSocialPostDto) {
    return this.social.assignPost(orgId, user.userId, id, dto?.assignedUserId ?? null);
  }

  // SN2: client-approval share links — one link per post or per
  // group ("post-groups" is its own first segment, like
  // "groups", so it never collides with posts/:id). The create
  // response is the ONLY time the full token is returned (inside
  // `url`); the list returns masked tokens + derived status.
  @Post("posts/:id/share-link") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createPostShareLink(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Body() dto: CreateShareLinkDto) {
    return this.shares.createShareLink(orgId, user.userId, { postId: id }, dto);
  }

  @Post("post-groups/:id/share-link") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createGroupShareLink(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Body() dto: CreateShareLinkDto) {
    return this.shares.createShareLink(orgId, user.userId, { groupId: id }, dto);
  }

  @Get("posts/:id/share-links")
  listPostShareLinks(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.shares.listShareLinksForPost(orgId, id);
  }

  @Delete("share-links/:id") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  revokeShareLink(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.shares.revokeShareLink(orgId, user.userId, id);
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

  // SU10: explicit human retry of a failed post — the health
  // service resets an exhausted attempt budget (audited), then
  // delegates to the same publishNow path above.
  @Post("posts/:id/retry") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  retryPost(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.health.retryPost(orgId, user.userId, id);
  }

  // SU1: clone any post into a fresh draft.
  @Post("posts/:id/clone") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  clonePost(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.social.clonePost(orgId, user.userId, id);
  }

  // SN10: caption test — pair this draft with a fresh clone draft
  // under one captionTestId (drafts only; see the service).
  @Post("posts/:id/caption-test") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createCaptionTest(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Body() dto: CreateCaptionTestDto) {
    return this.social.createCaptionTest(orgId, user.userId, id, dto);
  }

  // SU8: cross-post derive — fresh drafts for the target
  // accounts; incompatible targets come back as warnings.
  @Post("posts/:id/derive") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  derivePost(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Body() dto: DeriveSocialPostDto) {
    return this.social.derivePost(orgId, user.userId, id, dto.accountIds);
  }

  // SU2: queue actions.
  @Post("posts/:id/add-to-queue") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  addToQueue(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.queue.addToQueue(orgId, user.userId, id);
  }

  @Post("posts/:id/schedule-best-time") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  scheduleBestTime(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.queue.scheduleBestTime(orgId, user.userId, id);
  }

  @Post("posts/:id/evergreen") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  setEvergreen(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Body() dto: UpdateEvergreenDto) {
    return this.queue.setEvergreen(orgId, user.userId, id, dto);
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
 * SU6 — PUBLIC tracked social link redirect. The token is the
 * credential (unguessable, minted only for a scheduled/published
 * post's link). Every hit 302s to the post's linkUrl with UTM
 * applied; human clicks are recorded, bot / link-preview fetches
 * are redirected WITHOUT a click row. An unknown token, or a post
 * whose linkUrl is gone, is an honest 404.
 */
@Controller("public/social")
export class PublicSocialLinkController {
  constructor(
    private readonly links: SocialLinkService,
    // SN2: client-approval share preview + review.
    private readonly shares: SocialShareService,
  ) {}

  @Public()
  @Get("r/:token")
  async redirect(
    @Param("token") token: string,
    @Headers("user-agent") userAgent: string | undefined,
    @Res() res: Response,
  ) {
    const result = await this.links.recordClick(token, userAgent ?? null);
    if (!result || !result.url) throw new NotFoundException("Link not found");
    return res.redirect(302, result.url);
  }

  // SN2 — PUBLIC client-approval share preview + review. No auth
  // can apply (the client has no account) — the unguessable
  // token IS the credential, exactly like the tracked-link
  // redirect above. Unknown token → 404; revoked/expired → 410
  // (the service's honest Gone messages). The GET payload is a
  // strict whitelist built in SocialShareService.
  @Public()
  @Get("share/:token")
  publicShare(@Param("token") token: string) {
    return this.shares.getPublicShare(token);
  }

  @Public()
  @Post("share/:token/review")
  publicShareReview(@Param("token") token: string, @Body() dto: SubmitClientReviewDto) {
    return this.shares.submitPublicReview(token, dto);
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

  // CC20: LinkedIn callbacks land on the CONNECT CENTER (where
  // the connect started), with linkedin_connected / linkedin_error
  // / linkedin_pick params.
  @Public()
  @Get("linkedin/callback")
  async linkedinCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Res() res: Response,
  ) {
    const url = await this.oauth.handleLinkedInCallback({ code, state, error });
    return res.redirect(302, url);
  }

  // SN7: Threads callbacks land back on the SOCIAL POSTS page
  // (where the connect started), with social_connected=threads
  // or a social_error explanation.
  @Public()
  @Get("threads/callback")
  async threadsCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Res() res: Response,
  ) {
    const url = await this.oauth.handleThreadsCallback({ code, state, error });
    return res.redirect(302, url);
  }

  // OU9: GBP callbacks land back on the SOCIAL POSTS page with
  // social_connected=google_business_profile, a gbp_pick state
  // (multi-location), or a social_error explanation — Google's
  // own refusal text included when the API-access gate blocks
  // the location list.
  @Public()
  @Get("google-business-profile/callback")
  async googleBusinessCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Res() res: Response,
  ) {
    const url = await this.oauth.handleGoogleBusinessCallback({ code, state, error });
    return res.redirect(302, url);
  }
}
