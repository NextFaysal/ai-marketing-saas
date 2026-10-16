import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";
import { CatalogsService } from "./catalogs.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

/** AB5 (AX10): the staff-entered Page / Instagram link fields,
 * accepted at create/register and patchable afterwards. */
class CatalogLinkFields {
  @IsOptional() @IsString() @MaxLength(200) pageId?: string | null;
  @IsOptional() @IsString() @MaxLength(200) pageName?: string | null;
  @IsOptional() @IsString() @MaxLength(200) instagramId?: string | null;
  @IsOptional() @IsString() @MaxLength(200) instagramName?: string | null;
}
class CreateCatalogDto extends CatalogLinkFields {
  @IsString() @MaxLength(200) name!: string;
  @IsString() businessId!: string;
}
class RegisterCatalogDto extends CatalogLinkFields {
  @IsString() @MaxLength(200) name!: string;
  @IsString() externalCatalogId!: string;
}
class UpdateCatalogDto extends CatalogLinkFields {
  @IsOptional() @IsBoolean() autoSync?: boolean;
}

@PermissionArea("ads")
@Controller("organizations/:organizationId/catalogs")
@UseGuards(TenantGuard, RolesGuard)
export class CatalogsController {
  constructor(private readonly catalogs: CatalogsService) {}

  @Get()
  list(@Param("organizationId") orgId: string) { return this.catalogs.list(orgId); }

  @Post() @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  create(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateCatalogDto) {
    return this.catalogs.create(orgId, user.userId, dto);
  }

  @Post("register") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  register(@Param("organizationId") orgId: string, @Body() dto: RegisterCatalogDto) {
    return this.catalogs.register(orgId, dto);
  }

  @Get(":catalogId/product-sets")
  listSets(@Param("organizationId") orgId: string, @Param("catalogId") catalogId: string) {
    return this.catalogs.listProductSets(orgId, catalogId);
  }
  @Post(":catalogId/product-sets") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  createSet(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("catalogId") catalogId: string, @Body() body: { name: string; category?: string; maxPriceMajor?: string; inStockOnly?: boolean }) {
    return this.catalogs.createProductSet(orgId, user.userId, catalogId, body ?? ({} as any));
  }
  @Post(":catalogId/product-sets/:setId/publish") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  publishSet(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("catalogId") catalogId: string, @Param("setId") setId: string) {
    return this.catalogs.publishProductSet(orgId, user.userId, catalogId, setId);
  }
  @Delete(":catalogId/product-sets/:setId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  deleteSet(@Param("organizationId") orgId: string, @Param("catalogId") catalogId: string, @Param("setId") setId: string) {
    return this.catalogs.deleteProductSet(orgId, catalogId, setId);
  }
  @Post(":catalogId/push-products") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  push(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("catalogId") id: string) {
    return this.catalogs.pushProducts(orgId, user.userId, id);
  }

  /** AB5 (AX10): partial catalog settings — autoSync opt-in +
   * the Page / Instagram link fields (null clears a field). */
  @Patch(":catalogId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  update(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("catalogId") catalogId: string, @Body() dto: UpdateCatalogDto) {
    return this.catalogs.updateCatalog(orgId, user.userId, catalogId, dto ?? ({} as any));
  }

  /** AB5 (AX10): catalog-level auto-sync status (queue counts +
   * the catalog's last-sync stamp). */
  @Get(":catalogId/sync-status")
  syncStatus(@Param("organizationId") orgId: string, @Param("catalogId") catalogId: string) {
    return this.catalogs.syncStatus(orgId, catalogId);
  }

  /** AB5 (AX10): one product's auto-sync state in this catalog,
   * read from the sync-record queue only. */
  @Get(":catalogId/products/:productId/sync-state")
  productSyncState(@Param("organizationId") orgId: string, @Param("catalogId") catalogId: string, @Param("productId") productId: string) {
    return this.catalogs.productSyncState(orgId, catalogId, productId);
  }
}
