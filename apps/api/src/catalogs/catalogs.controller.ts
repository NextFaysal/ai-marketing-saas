import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { IsString, MaxLength } from "class-validator";
import { CatalogsService } from "./catalogs.service";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

class CreateCatalogDto {
  @IsString() @MaxLength(200) name!: string;
  @IsString() businessId!: string;
}
class RegisterCatalogDto {
  @IsString() @MaxLength(200) name!: string;
  @IsString() externalCatalogId!: string;
}

@Controller("organizations/:organizationId/catalogs")
@UseGuards(TenantGuard)
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
}
