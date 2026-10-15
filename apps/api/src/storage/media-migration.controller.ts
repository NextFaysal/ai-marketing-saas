import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { SuperAdminGuard, AdminTier } from "../common/super-admin.guard";
import { MediaMigrationService } from "./media-migration.service";

/**
 * RM10 — platform-admin endpoints for the legacy local-media
 * migration. Guarded exactly like the rest of /admin/* (live
 * super-admin row check + tier metadata); moving tenant bytes
 * between stores is a SUPER-tier operation. scan is read-only;
 * run copies (never deletes the local originals).
 */
@Controller("admin/media-migration")
@UseGuards(SuperAdminGuard)
export class MediaMigrationController {
  constructor(private readonly migration: MediaMigrationService) {}

  @Post("scan")
  @AdminTier("SUPER")
  scan() {
    return this.migration.scan();
  }

  @Post("run")
  @AdminTier("SUPER")
  run(@Body() dto: { batchSize?: number }) {
    return this.migration.run(dto ?? {});
  }
}
