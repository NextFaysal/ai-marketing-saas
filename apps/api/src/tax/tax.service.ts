import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { UpdateTaxSettingsDto } from "./tax.dto";

/** The shape returned when an org has never saved tax settings:
 * tax OFF (defaultVatBps null), prices include VAT (schema default). */
export const TAX_SETTING_DEFAULTS = {
  defaultVatBps: null as number | null,
  pricesIncludeVat: true,
  legalName: null as string | null,
  tin: null as string | null,
  binVatNo: null as string | null,
};

@Injectable()
export class TaxService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private table(): any {
    return (this.prisma as any).taxSetting;
  }

  private serialize(row: any): any {
    if (!row) return { organizationId: undefined, ...TAX_SETTING_DEFAULTS };
    return {
      id: row.id,
      organizationId: row.organizationId,
      defaultVatBps: row.defaultVatBps ?? null,
      pricesIncludeVat: row.pricesIncludeVat !== false,
      legalName: row.legalName ?? null,
      tin: row.tin ?? null,
      binVatNo: row.binVatNo ?? null,
    };
  }

  async getSettings(orgId: string) {
    const table = this.table();
    const row = table?.findFirst
      ? await table.findFirst({ where: { organizationId: orgId } }).catch(() => null)
      : null;
    if (!row) return { organizationId: orgId, ...TAX_SETTING_DEFAULTS };
    return this.serialize(row);
  }

  async updateSettings(orgId: string, actorId: string, dto: UpdateTaxSettingsDto) {
    if (dto.defaultVatBps !== undefined && dto.defaultVatBps !== null) {
      const v = dto.defaultVatBps;
      if (!Number.isInteger(v) || v < 0 || v > 10000) {
        throw new BadRequestException("ডিফল্ট VAT হার 0–10000 basis points-এর মধ্যে হতে হবে (1500 = 15%)");
      }
    }
    const clean = (v: string | null | undefined): string | null => {
      const s = String(v ?? "").trim();
      return s ? s : null;
    };
    const data: Record<string, any> = {};
    if (dto.legalName !== undefined) data.legalName = clean(dto.legalName);
    if (dto.tin !== undefined) data.tin = clean(dto.tin);
    if (dto.binVatNo !== undefined) data.binVatNo = clean(dto.binVatNo);
    if (dto.defaultVatBps !== undefined) data.defaultVatBps = dto.defaultVatBps;
    if (dto.pricesIncludeVat !== undefined) data.pricesIncludeVat = dto.pricesIncludeVat === true;

    const table = this.table();
    const existing = await table.findFirst({ where: { organizationId: orgId } });
    const row = existing
      ? await table.update({ where: { id: existing.id }, data })
      : await table.create({ data: { organizationId: orgId, ...TAX_SETTING_DEFAULTS, ...data } });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "commerce.tax_settings_update",
      entityType: "TaxSetting",
      entityId: row.id,
      metadata: { defaultVatBps: row.defaultVatBps ?? null, pricesIncludeVat: row.pricesIncludeVat !== false },
    });
    return this.serialize(row);
  }
}
