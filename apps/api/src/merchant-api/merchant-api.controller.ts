import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { MerchantApiKeyGuard, requireScope } from "./merchant-api.guard";
import { ProductsService } from "../products/products.service";
import { OrdersService } from "../orders/orders.service";
import { CustomersService } from "../customers/customers.service";
import { CreateProductDto, UpdateProductDto } from "../products/products.dto";

function toInt(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

/**
 * AB8 (AX21) — the versioned merchant developer API.
 *
 * Authenticated ONLY by a merchant API key (MerchantApiKeyGuard);
 * the organization ALWAYS comes from req.merchantApi.orgId (the
 * key), never from a route/query parameter. Every handler checks
 * its scope before delegating to the ordinary staff services, so
 * tenant scoping, plan gates and audits inside those services
 * apply unchanged — the key opens no side door around any of it.
 */
@Controller("v1/merchant")
@UseGuards(MerchantApiKeyGuard)
export class MerchantApiController {
  constructor(
    private readonly products: ProductsService,
    private readonly orders: OrdersService,
    private readonly customers: CustomersService,
  ) {}

  // ---------- products ----------

  @Get("products")
  listProducts(@Req() req: any, @Query() q: any = {}) {
    requireScope(req, "products:read");
    return this.products.list(req.merchantApi.orgId, {
      page: toInt(q.page),
      pageSize: toInt(q.pageSize),
      search: q.search,
      status: q.status,
    });
  }

  @Get("products/:id")
  getProduct(@Req() req: any, @Param("id") id: string) {
    requireScope(req, "products:read");
    return this.products.getOne(req.merchantApi.orgId, id);
  }

  @Post("products")
  createProduct(@Req() req: any, @Body() dto: CreateProductDto) {
    requireScope(req, "products:write");
    return this.products.create(req.merchantApi.orgId, req.merchantApi.createdById, dto);
  }

  @Patch("products/:id")
  updateProduct(@Req() req: any, @Param("id") id: string, @Body() dto: UpdateProductDto) {
    requireScope(req, "products:write");
    return this.products.update(req.merchantApi.orgId, req.merchantApi.createdById, id, dto);
  }

  // ---------- orders ----------

  @Get("orders")
  listOrders(@Req() req: any, @Query() q: any = {}) {
    requireScope(req, "orders:read");
    return this.orders.list(req.merchantApi.orgId, {
      status: q.status,
      dateFrom: q.from,
      dateTo: q.to,
      page: toInt(q.page),
      pageSize: toInt(q.pageSize),
    });
  }

  @Get("orders/:id")
  getOrder(@Req() req: any, @Param("id") id: string) {
    requireScope(req, "orders:read");
    return this.orders.getOne(req.merchantApi.orgId, id);
  }

  // ---------- customers ----------

  @Get("customers")
  async listCustomers(@Req() req: any, @Query() q: any = {}) {
    requireScope(req, "customers:read");
    // CustomersService.list returns the org's (windowed) rows as a
    // plain array; we slice the requested page over those items
    // and report the total honestly for that window. No parallel
    // customer query is written here.
    const result: any = await this.customers.list(req.merchantApi.orgId, q.search);
    const all: any[] = Array.isArray(result) ? result : (result?.items ?? []);
    const page = Math.max(1, toInt(q.page) ?? 1);
    const pageSize = Math.min(100, Math.max(1, toInt(q.pageSize) ?? 20));
    return {
      total: all.length,
      page,
      pageSize,
      items: all.slice((page - 1) * pageSize, page * pageSize),
    };
  }

  @Get("customers/:id")
  getCustomer(@Req() req: any, @Param("id") id: string) {
    requireScope(req, "customers:read");
    return this.customers.detail(req.merchantApi.orgId, id);
  }
}
