import { Module } from "@nestjs/common";
import { VideoStudioService } from "./video-studio.service";
import { VideoStudioController } from "./video-studio.controller";
import { FfmpegTemplateVideoProvider, VIDEO_GENERATION_PROVIDER } from "./ffmpeg-video.provider";
import { SocialModule } from "../social/social.module";
import { SocialImportService } from "../social/social-import.service";

/**
 * NF2 (FB1) — Short Video Commerce Studio. The renderer
 * resolves product-image bytes through SocialImportService
 * (the ONE guarded product-image import / fetch path) and
 * publishing goes through SocialService.createPost from
 * SocialModule. Nothing in SocialModule imports this module,
 * so the graph stays acyclic; AutomationModule imports this
 * module for the video_render_sweep dispatch (the
 * OrgBrain/KnowledgeIndexing leaf pattern).
 */
@Module({
  imports: [SocialModule],
  controllers: [VideoStudioController],
  providers: [
    VideoStudioService,
    // SocialModule does not export SocialImportService; it is a
    // stateless Prisma/Audit service, so this module provides
    // its own instance (the same class, the same guarded path).
    SocialImportService,
    FfmpegTemplateVideoProvider,
    { provide: VIDEO_GENERATION_PROVIDER, useExisting: FfmpegTemplateVideoProvider },
  ],
  exports: [VideoStudioService],
})
export class VideoStudioModule {}
