import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CHECKOUT_FIELD_SURFACES, CHECKOUT_FIELD_TYPES } from "./checkout-fields";
import { badRequest, notFound } from "../i18n";

/**
 * AB4 (AX5b) — staff CRUD for merchant-defined custom checkout
 * fields (CheckoutFieldDef). Scalar-id style like the other
 * storefront services: rows are resolved org-first, foreign ids
 * read as 404, every write is audited, and all validation errors
 * are Bengali-first.
 *
 * The field KEY is immutable after creation: placed orders store
 * their answers keyed by it, so renaming a key would orphan those
 * answers (they would fall back to showing the raw key). Labels,
 * type, options, required, surface, order and active are editable
 * — with the same validations as creation.
 */

export interface CheckoutFieldInput {
  key?: string;
  label?: string;
  type?: string;
  options?: unknown;
  required?: boolean;
  appliesTo?: string;
  sortOrder?: number;
  active?: boolean;
}

const KEY_RE = /^[a-z0-9][a-z0-9_]{1,39}$/;

function validateKey(raw: unknown): string {
  const key = typeof raw === "string" ? raw : "";
  if (!KEY_RE.test(key)) {
    throw badRequest("storefront.fieldKeyInvalid");
  }
  return key;
}

function validateLabel(raw: unknown): string {
  const label = typeof raw === "string" ? raw.trim() : "";
  if (label.length < 2 || label.length > 80) {
    throw badRequest("storefront.fieldLabelLength");
  }
  return label;
}

function validateType(raw: unknown): string {
  const type = typeof raw === "string" ? raw : "";
  if (!(CHECKOUT_FIELD_TYPES as readonly string[]).includes(type)) {
    throw badRequest("storefront.fieldTypeInvalid");
  }
  return type;
}

function validateAppliesTo(raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "all";
  const appliesTo = typeof raw === "string" ? raw : "";
  if (!(CHECKOUT_FIELD_SURFACES as readonly string[]).includes(appliesTo)) {
    throw badRequest("storefront.fieldAppliesToInvalid");
  }
  return appliesTo;
}

/** select options: ≥1 non-empty trimmed unique strings, ≤30, each ≤80 chars. */
function validateOptions(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw badRequest("storefront.selectFieldNeedsOption");
  }
  if (raw.length > 30) {
    throw badRequest("storefront.selectFieldMaxOptions");
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) {
      throw badRequest("storefront.selectOptionEmpty");
    }
    const value = item.trim();
    if (value.length > 80) {
      throw badRequest("storefront.selectOptionTooLong");
    }
    if (out.includes(value)) {
      throw badRequest("storefront.selectOptionDuplicate");
    }
    out.push(value);
  }
  return out;
}

function validateBool(raw: unknown, field: string): boolean {
  if (typeof raw !== "boolean") {
    throw badRequest("storefront.fieldMustBeTrueFalse", { field: field });
  }
  return raw;
}

function validateSortOrder(raw: unknown): number {
  if (raw === undefined || raw === null) return 0;
  if (!Number.isInteger(raw)) {
    throw badRequest("storefront.sortOrderMustBeInteger");
  }
  return Number(raw);
}

@Injectable()
export class CheckoutFieldsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  private async auditSafe(entry: {
    organizationId: string;
    userId: string;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  }) {
    // Failure-isolated: an audit problem never fails the mutation.
    await this.audit?.log(entry as any)?.catch(() => undefined);
  }

  private serializeField(f: any) {
    return {
      id: f.id,
      key: f.key,
      label: f.label,
      type: f.type,
      options: Array.isArray(f.options) ? f.options.map((o: any) => String(o)) : [],
      required: f.required === true,
      appliesTo: f.appliesTo ?? "all",
      sortOrder: f.sortOrder ?? 0,
      active: f.active !== false,
      createdById: f.createdById ?? null,
    };
  }

  async list(orgId: string) {
    const rows: any[] =
      (await this.t("checkoutFieldDef")
        .findMany({
          where: { organizationId: orgId },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        })
        .catch(() => [])) ?? [];
    // Re-sort in memory so the order does not depend on the store
    // honouring the compound orderBy.
    const sorted = [...rows].sort(
      (a, b) =>
        Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) ||
        new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime(),
    );
    return { fields: sorted.map((f) => this.serializeField(f)) };
  }

  async create(orgId: string, actorId: string, dto: CheckoutFieldInput) {
    const key = validateKey(dto?.key);
    const label = validateLabel(dto?.label);
    const type = validateType(dto?.type);
    const appliesTo = validateAppliesTo(dto?.appliesTo);
    const options = type === "select" ? validateOptions(dto?.options) : null;
    const required = dto?.required === undefined ? false : validateBool(dto.required, "required");
    const sortOrder = validateSortOrder(dto?.sortOrder);

    const existing = await this.t("checkoutFieldDef")
      .findFirst({ where: { organizationId: orgId, key } })
      .catch(() => null);
    if (existing) {
      throw badRequest("storefront.fieldKeyExists");
    }

    const field = await this.t("checkoutFieldDef").create({
      data: {
        organizationId: orgId,
        key,
        label,
        type,
        options,
        required,
        appliesTo,
        sortOrder,
        active: true,
        createdById: actorId || null,
      },
    });
    await this.auditSafe({
      organizationId: orgId,
      userId: actorId,
      action: "checkout_field.created",
      entityType: "CheckoutFieldDef",
      entityId: field.id,
      metadata: { key: field.key, type: field.type, appliesTo: field.appliesTo },
    });
    return { field: this.serializeField(field) };
  }

  private async requireField(orgId: string, fieldId: string): Promise<any> {
    const field = await this.t("checkoutFieldDef").findFirst({
      where: { id: fieldId, organizationId: orgId },
    });
    if (!field) throw notFound("storefront.checkoutFieldNotFound");
    return field;
  }

  async update(orgId: string, actorId: string, fieldId: string, dto: CheckoutFieldInput) {
    const field = await this.requireField(orgId, fieldId);
    // KEY IS IMMUTABLE — a key change would orphan the answers
    // already stored on placed orders under the old key.
    if (dto?.key !== undefined && dto.key !== field.key) {
      throw badRequest("storefront.fieldKeyImmutable");
    }
    const data: Record<string, any> = {};
    if (dto?.label !== undefined) data.label = validateLabel(dto.label);
    if (dto?.type !== undefined) data.type = validateType(dto.type);
    if (dto?.appliesTo !== undefined) data.appliesTo = validateAppliesTo(dto.appliesTo);
    if (dto?.required !== undefined) data.required = validateBool(dto.required, "required");
    if (dto?.sortOrder !== undefined) data.sortOrder = validateSortOrder(dto.sortOrder);
    if (dto?.active !== undefined) data.active = validateBool(dto.active, "active");
    // Options follow the EFFECTIVE type: a select must always end
    // up with a valid option list (the dto's when given, else the
    // stored one re-validated); a non-select stores null.
    const effectiveType: string = data.type !== undefined ? data.type : field.type;
    if (dto?.type !== undefined || dto?.options !== undefined) {
      data.options =
        effectiveType === "select"
          ? validateOptions(dto?.options !== undefined ? dto.options : field.options)
          : null;
    }
    const saved = await this.t("checkoutFieldDef").update({ where: { id: field.id }, data });
    await this.auditSafe({
      organizationId: orgId,
      userId: actorId,
      action: "checkout_field.updated",
      entityType: "CheckoutFieldDef",
      entityId: field.id,
      metadata: { key: field.key, fields: Object.keys(data) },
    });
    return { field: this.serializeField(saved) };
  }

  async remove(orgId: string, actorId: string, fieldId: string) {
    const field = await this.requireField(orgId, fieldId);
    // Hard delete: placed orders keep their stored answers — at
    // read time a missing def's label falls back to the key.
    await this.t("checkoutFieldDef").delete({ where: { id: field.id } });
    await this.auditSafe({
      organizationId: orgId,
      userId: actorId,
      action: "checkout_field.deleted",
      entityType: "CheckoutFieldDef",
      entityId: field.id,
      metadata: { key: field.key },
    });
    return { deleted: true, fieldId: field.id };
  }
}
