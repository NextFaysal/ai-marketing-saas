import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";
import { MediaLibraryService } from "./media-library.service";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"];

/** RM7: step 1 of the general library upload — declare the file,
 * get a presigned PUT URL for the quarantine key (RB3 pattern). */
class PresignMediaLibraryUploadDto {
  @IsOptional() @IsString() @MaxLength(255) fileName?: string;
  @IsString() @MaxLength(100) contentType!: string;
  @IsInt() @Min(1) sizeBytes!: number;
}

/** RM7: step 2 — the bytes have landed; the service verifies them
 * (HEAD size + magic-byte sniff) and registers the library file. */
class CompleteMediaLibraryUploadDto {
  @IsString() @MaxLength(500) key!: string;
  @IsString() @MaxLength(100) contentType!: string;
  @IsInt() @Min(1) sizeBytes!: number;
}

/**
 * RM7 — unified media library API: the StoredFile registry as one
 * org-scoped list (every surface), a general presign upload, and
 * registry trash. TenantGuard scopes every route to org members;
 * writes additionally require a write role, matching the product
 * and creative upload surfaces.
 */
@Controller("organizations/:organizationId/media-library")
@UseGuards(TenantGuard)
export class MediaLibraryController {
  constructor(private readonly library: MediaLibraryService) {}

  @Get()
  list(
    @Param("organizationId") orgId: string,
    @Query() q: { surface?: string; kind?: string; q?: string; page?: string; pageSize?: string },
  ) {
    return this.library.list(orgId, {
      surface: q.surface,
      kind: q.kind,
      q: q.q,
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
    });
  }

  @Post("upload/presign") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  presignUpload(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: PresignMediaLibraryUploadDto) {
    return this.library.presignUpload(orgId, user.userId, dto);
  }

  @Post("upload/complete") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  completeUpload(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CompleteMediaLibraryUploadDto) {
    return this.library.completeUpload(orgId, user.userId, dto);
  }

  /** Registry trash only — the object itself is deleted by
   * RM11's lifecycle job, never synchronously here. */
  @Delete(":id") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  trash(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.library.trash(orgId, user.userId, id);
  }
}
