import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ProductsService } from "./products.service";
import { CreateProductDto, UpdateProductDto, CreateVariantDto, UpdateVariantDto, SetCostDto, PublicCheckoutOrderDto, BulkEditDto, PushBatchDto, CreateCategoryDto, UpdateCategoryDto, CreateTagDto, AddProductImageDto, ReorderProductImagesDto, AddBundleItemDto, PresignProductImageDto, CompleteProductImageDto, PresignDigitalFileDto, CompleteDigitalFileDto, SetProductImageAutoMirrorDto } from "./products.dto";
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

  /** Sales & Data S6: product-wise sales report. Declared BEFORE
   * :productId so "sales-report" is not captured as a product id. */
  @Get("sales-report")
  salesReport(@Param("organizationId") orgId: string, @Query("days") days?: string) {
    return this.products.salesReport(orgId, days);
  }

  // ---- EC3 static segments — all declared BEFORE :productId ----

  @Post("bulk-edit/preview") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  bulkEditPreview(@Param("organizationId") orgId: string, @Body() dto: BulkEditDto) {
    return this.products.bulkEditPreview(orgId, dto);
  }

  @Post("bulk-edit/apply") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  bulkEditApply(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: BulkEditDto) {
    return this.products.bulkEditApply(orgId, user.userId, dto);
  }

  /** CP5: batch push to stores (per-item results, never all-or-nothing). */
  @Post("push-batch") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  pushBatch(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: PushBatchDto) {
    return this.products.pushBatch(orgId, user.userId, dto.productIds);
  }

  /** RM4: copy external product-image URLs into the org's own R2
   * bucket (per-item results in the response, never all-or-
   * nothing). Static segment — declared BEFORE :productId, and
   * restricted to OWNER/ADMIN (it rewrites catalog data org-wide). */
  @Post("images/mirror-external") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  mirrorExternalImages(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.products.mirrorExternalProductImages(orgId, user.userId);
  }

  /** RB6b (plan D3): auto-mirror opt-out — the scheduled
   * product_image_mirror_sweep reads this; the manual endpoint
   * above ignores it. Default (no stored row) is ON. Static
   * segments, declared BEFORE :productId like mirror-external. */
  @Get("images/mirror-setting") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  getMirrorSetting(@Param("organizationId") orgId: string) {
    return this.products.getProductImageAutoMirror(orgId);
  }

  @Patch("images/mirror-setting") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  setMirrorSetting(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: SetProductImageAutoMirrorDto) {
    return this.products.setProductImageAutoMirror(orgId, user.userId, dto.productImageAutoMirror);
  }

  @Get("categories")
  listCategories(@Param("organizationId") orgId: string) {
    return this.products.listCategories(orgId);
  }

  @Post("categories") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createCategory(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateCategoryDto) {
    return this.products.createCategory(orgId, user.userId, dto);
  }

  @Patch("categories/:categoryId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateCategory(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("categoryId") categoryId: string, @Body() dto: UpdateCategoryDto) {
    return this.products.updateCategory(orgId, user.userId, categoryId, dto);
  }

  @Get("tags")
  listTags(@Param("organizationId") orgId: string) {
    return this.products.listTags(orgId);
  }

  @Post("tags") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createTag(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateTagDto) {
    return this.products.createTag(orgId, user.userId, dto);
  }

  @Get("by-slug/:slug")
  getBySlug(@Param("organizationId") orgId: string, @Param("slug") slug: string) {
    return this.products.getBySlug(orgId, slug);
  }

  @Get(":productId")
  getOne(@Param("organizationId") orgId: string, @Param("productId") id: string) { return this.products.getOne(orgId, id); }

  @Post(":productId/duplicate") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  duplicate(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("productId") id: string) {
    return this.products.duplicate(orgId, user.userId, id);
  }

  @Get(":productId/channels")
  getChannels(@Param("organizationId") orgId: string, @Param("productId") id: string) {
    return this.products.getChannels(orgId, id);
  }

  @Get(":productId/images")
  listImages(@Param("organizationId") orgId: string, @Param("productId") id: string) {
    return this.products.listImages(orgId, id);
  }

  @Post(":productId/images") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  addImage(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("productId") id: string, @Body() dto: AddProductImageDto) {
    return this.products.addImage(orgId, user.userId, id, dto);
  }

  /** RM4: direct-to-R2 upload, step 1 — validate the declared
   * file and hand back a presigned PUT URL for the quarantine key. */
  @Post(":productId/images/presign") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  presignImage(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("productId") id: string, @Body() dto: PresignProductImageDto) {
    return this.products.presignProductImage(orgId, user.userId, id, dto);
  }

  /** RM4: direct-to-R2 upload, step 2 — verify the landed bytes
   * (HEAD size + magic-byte sniff) and turn them into a gallery
   * image, or refuse and remove them. */
  @Post(":productId/images/complete") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  completeImage(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("productId") id: string, @Body() dto: CompleteProductImageDto) {
    return this.products.completeProductImage(orgId, user.userId, id, dto);
  }

  /** RB6/RM9: digital product file upload, step 1 — validate the
   * declared file (size cap + executable-extension blocklist) and
   * hand back a presigned PUT URL for a PRIVATE quarantine key. */
  @Post(":productId/digital-file/presign") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  presignDigitalFile(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("productId") id: string, @Body() dto: PresignDigitalFileDto) {
    return this.products.presignDigitalFile(orgId, user.userId, id, dto);
  }

  /** RB6/RM9: step 2 — HEAD-verify the landed bytes and make the
   * object the product's hosted digital file (private bucket). */
  @Post(":productId/digital-file/complete") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  completeDigitalFile(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("productId") id: string, @Body() dto: CompleteDigitalFileDto) {
    return this.products.completeDigitalFile(orgId, user.userId, id, dto);
  }

  @Patch(":productId/images/reorder") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  reorderImages(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("productId") id: string, @Body() dto: ReorderProductImagesDto) {
    return this.products.reorderImages(orgId, user.userId, id, dto.imageIds);
  }

  @Delete(":productId/images/:imageId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deleteImage(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("productId") id: string, @Param("imageId") imageId: string) {
    return this.products.deleteImage(orgId, user.userId, id, imageId);
  }

  @Get(":productId/bundle")
  listBundleItems(@Param("organizationId") orgId: string, @Param("productId") id: string) {
    return this.products.listBundleItems(orgId, id);
  }

  @Post(":productId/bundle") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  addBundleItem(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("productId") id: string, @Body() dto: AddBundleItemDto) {
    return this.products.addBundleItem(orgId, user.userId, id, dto);
  }

  @Delete(":productId/bundle/:itemId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deleteBundleItem(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("productId") id: string, @Param("itemId") itemId: string) {
    return this.products.deleteBundleItem(orgId, user.userId, id, itemId);
  }

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

  @Patch(":productId/variants/:variantId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateVariant(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("productId") id: string, @Param("variantId") variantId: string, @Body() dto: UpdateVariantDto) {
    return this.products.updateVariant(orgId, user.userId, id, variantId, dto);
  }

  @Delete(":productId/variants/:variantId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  deleteVariant(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("productId") id: string, @Param("variantId") variantId: string) {
    return this.products.deleteVariant(orgId, user.userId, id, variantId);
  }

  @Post(":productId/costs") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  setCost(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("productId") id: string, @Body() dto: SetCostDto) {
    return this.products.setCost(orgId, user.userId, id, dto);
  }
}
