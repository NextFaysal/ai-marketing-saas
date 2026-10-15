import { Module } from "@nestjs/common";
import { StorageService } from "./storage.service";
import { StorageRegistryService } from "./storage-registry.service";
import { PublicMediaService } from "./public-media.service";
import { MediaLibraryService } from "./media-library.service";
import { MediaLibraryController } from "./media-library.controller";
import { MediaMigrationService } from "./media-migration.service";
import { MediaMigrationController } from "./media-migration.controller";
import { MediaLifecycleService } from "./media-lifecycle.service";

/**
 * RM2/RM3 — the R2 media program's storage layer: two-bucket
 * StorageService (multipart, presigned PUT/GET, copy, batch delete,
 * list, health probe) and the StoredFile registry. Surfaces consume
 * the services from RM4 onward; RB5/RM7 adds the first controller
 * here — the unified media library over the registry. RB6/RM10
 * adds the platform-admin media-migration endpoints. The admin
 * overview card is RM12. PrismaService is global (PrismaModule).
 */
@Module({
  controllers: [MediaLibraryController, MediaMigrationController],
  providers: [StorageService, StorageRegistryService, PublicMediaService, MediaLibraryService, MediaMigrationService, MediaLifecycleService],
  exports: [StorageService, StorageRegistryService, PublicMediaService, MediaMigrationService, MediaLifecycleService],
})
export class StorageModule {}
