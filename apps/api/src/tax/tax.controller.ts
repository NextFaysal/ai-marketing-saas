import { Body, Controller, Get, Header, Param, Put, Query, UseGuards } from "@nestjs/common";
import { TaxService } from "./tax.service";
import { InvoicesService } from "./invoices.service";
import { AccountingService } from "./accounting.service";
import { UpdateTaxSettingsDto } from "./tax.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

/** EC23: tax settings + accounting exports (commerce prefix). */
@PermissionArea("integrations")
@Controller("organizations/:organizationId/commerce")
@UseGuards(TenantGuard, RolesGuard)
export class TaxController {
  constructor(
    private readonly tax: TaxService,
    private readonly accounting: AccountingService,
  ) {}

  @Get("tax-settings")
  getSettings(@Param("organizationId") orgId: string) {
    return this.tax.getSettings(orgId);
  }

  @Put("tax-settings")
  @Roles("OWNER", "ADMIN")
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: UpdateTaxSettingsDto,
  ) {
    return this.tax.updateSettings(orgId, user.userId, dto);
  }

  @Get("reports/accounting-export")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", "attachment; filename=accounting-export.csv")
  accountingExport(
    @Param("organizationId") orgId: string,
    @Query("type") type?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.accounting.exportCsv(orgId, type ?? "", from, to);
  }
}

/** EC23: the fiscal invoice for one order (orders prefix, like the
 * existing GET order endpoint it mirrors). */
@PermissionArea("orders")
@Controller("organizations/:organizationId/orders")
@UseGuards(TenantGuard, RolesGuard)
export class InvoiceController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get(":orderId/invoice")
  getInvoice(@Param("organizationId") orgId: string, @Param("orderId") orderId: string) {
    return this.invoices.getInvoice(orgId, orderId);
  }
}
