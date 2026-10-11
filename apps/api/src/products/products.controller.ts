import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ProductsService } from "./products.service";
import { CreateProductDto, UpdateProductDto, CreateVariantDto, SetCostDto, PublicCheckoutOrderDto } from "./products.dto";
import { CurrentUser, AuthUser, Roles, Public } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"];

@Controller("public/checkout")
export class PublicCheckoutController {
  constructor(private readonly products: ProductsService) {}

  @Public()
  @Get(":slug")
  getPublicProduct(@Param("slug") slug: string) {
    return this.products.getPublicProductBySlug(slug);
  }

  @Public()
  @Post(":slug/order")
  placePublicOrder(@Param("slug") slug: string, @Body() dto: PublicCheckoutOrderDto) {
    return this.products.placePublicOrder(slug, dto);
  }
}

@Controller("organizations/:organizationId/products")
@UseGuards(TenantGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post() @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  create(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateProductDto) {
    return this.products.create(orgId, user.userId, dto);
  }

  @Get()
  list(@Param("organizationId") orgId: string, @Query() q: { search?: string; category?: string; status?: string; page?: string; pageSize?: string }) {
    return this.products.list(orgId, { search: q.search, category: q.category, status: q.status, page: q.page ? Number(q.page) : undefined, pageSize: q.pageSize ? Number(q.pageSize) : undefined });
  }

  @Get("by-slug/:slug")
  getBySlug(@Param("organizationId") orgId: string, @Param("slug") slug: string) {
    return this.products.getBySlug(orgId, slug);
  }

  @Get(":productId")
  getOne(@Param("organizationId") orgId: string, @Param("productId") id: string) { return this.products.getOne(orgId, id); }

  @Patch(":productId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  update(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("productId") id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(orgId, user.userId, id, dto);
  }

  @Delete(":productId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  archive(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("productId") id: string) {
    return this.products.archive(orgId, user.userId, id);
  }

  @Post(":productId/variants") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createVariant(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("productId") id: string, @Body() dto: CreateVariantDto) {
    return this.products.createVariant(orgId, user.userId, id, dto);
  }

  @Post(":productId/costs") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  setCost(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("productId") id: string, @Body() dto: SetCostDto) {
    return this.products.setCost(orgId, user.userId, id, dto);
  }
}
