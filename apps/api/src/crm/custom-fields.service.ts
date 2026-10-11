import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * CRM C4: custom field definitions + value validation.
 *
 * Definitions live in CustomFieldDef (one row per org+entity+key);
 * values live ONLY in the Lead.customFields / Customer.customFields
 * JSON columns, keyed by def.key. This service is the single
 * validation gate used by lead create/update, the new customer
 * PATCH, both merges (gap-fill helper) and both CSV exports
 * (column source) — so the rules below are the only rules.
 */
export const CUSTOM_FIELD_ENTITIES = ["lead", "customer"] as const;
export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "select"] as const;
export const CUSTOM_FIELD_TEXT_MAX = 500;

export type CustomFieldValues = Record<string, unknown>;

/** Slug for a field key: lowercase, non-alphanumerics -> "_". */
export function slugifyFieldKey(input: string): string {
  return String(input ?? "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/_{2,}/g, "_");
}
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,59}$/;

function isRealDateString(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Validate ONE value against its def. Returns the value to store:
 * text -> trimmed string; number -> a finite number (numeric
 * strings accepted); date -> the "YYYY-MM-DD" string itself;
 * select -> the string, which must be one of the def's options.
 * Throws BadRequestException naming the field LABEL.
 */
export function validateCustomFieldValue(def: { label: string; type: string; options?: unknown }, raw: unknown): unknown {
  const label = def.label;
  if (def.type === "text") {
    if (typeof raw !== "string") throw new BadRequestException(`Custom field "${label}" must be text`);
    const v = raw.trim();
    if (v.length > CUSTOM_FIELD_TEXT_MAX) throw new BadRequestException(`Custom field "${label}" is too long (max ${CUSTOM_FIELD_TEXT_MAX} characters)`);
    return v;
  }
  if (def.type === "number") {
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : NaN;
    if (!Number.isFinite(n)) throw new BadRequestException(`Custom field "${label}" must be a number`);
    return n;
  }
  if (def.type === "date") {
    if (typeof raw !== "string" || !isRealDateString(raw.trim())) {
      throw new BadRequestException(`Custom field "${label}" must be a date in YYYY-MM-DD format`);
    }
    return raw.trim();
  }
  if (def.type === "select") {
    const options = Array.isArray(def.options) ? def.options.map(String) : [];
    if (typeof raw !== "string" || !options.includes(raw)) {
      throw new BadRequestException(`Custom field "${label}" must be one of: ${options.join(", ")}`);
    }
    return raw;
  }
  throw new BadRequestException(`Custom field "${label}" has an unknown type "${def.type}"`);
}

/** Render a stored value for CSV export / display. */
export function renderCustomFieldValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

@Injectable()
export class CustomFieldsService {
  constructor(private readonly prisma: PrismaService) {}

  private assertEntity(entity: string) {
    if (!(CUSTOM_FIELD_ENTITIES as readonly string[]).includes(entity)) {
      throw new BadRequestException(`Invalid entity: "${entity}" (use lead, customer)`);
    }
  }

  /** All defs for the org (optionally one entity), archived ones
   * included and flagged — the management UI needs them; value
   * validation and exports use activeDefs(). */
  async listDefs(organizationId: string, entity?: string) {
    if (entity) this.assertEntity(entity);
    const defs = await (this.prisma as any).customFieldDef.findMany({
      where: { organizationId, ...(entity ? { entity } : {}) },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 200,
    }).catch(() => []);
    return (defs as any[]).map((d) => this.toPublic(d));
  }

  /** Non-archived defs for one entity, in display order. */
  async activeDefs(organizationId: string, entity: string) {
    const all = await this.listDefs(organizationId, entity);
    return all.filter((d: any) => !d.archivedAt);
  }

  private toPublic(d: any) {
    return {
      id: d.id, entity: d.entity, key: d.key, label: d.label, type: d.type,
      options: Array.isArray(d.options) ? d.options.map(String) : null,
      required: Boolean(d.required), sortOrder: d.sortOrder ?? 0,
      archivedAt: d.archivedAt ?? null, createdAt: d.createdAt, updatedAt: d.updatedAt,
    };
  }

  private normalizeOptions(type: string, options?: string[] | null): string[] | null {
    if (type !== "select") return null;
    const cleaned = [...new Set((options ?? []).map((o) => String(o).trim()).filter(Boolean))];
    if (!cleaned.length) throw new BadRequestException("A select field needs at least one option");
    if (cleaned.some((o) => o.length > 100)) throw new BadRequestException("Select options are limited to 100 characters each");
    return cleaned;
  }

  async createDef(organizationId: string, dto: {
    entity: string; key?: string; label: string; type: string;
    options?: string[] | null; required?: boolean; sortOrder?: number;
  }) {
    this.assertEntity(dto.entity);
    if (!(CUSTOM_FIELD_TYPES as readonly string[]).includes(dto.type)) {
      throw new BadRequestException(`Invalid field type: "${dto.type}" (use ${CUSTOM_FIELD_TYPES.join(", ")})`);
    }
    const label = String(dto.label ?? "").trim();
    if (!label) throw new BadRequestException("Field label is required");
    const key = slugifyFieldKey(dto.key ?? label);
    if (!KEY_PATTERN.test(key)) {
      throw new BadRequestException(`Invalid field key: "${dto.key ?? label}" — a key must start with a letter and use only a-z, 0-9 and _ (it is derived from the label when not supplied)`);
    }
    const dupe = await (this.prisma as any).customFieldDef.findFirst({
      where: { organizationId, entity: dto.entity, key },
    }).catch(() => null);
    if (dupe) throw new BadRequestException(`A "${dto.entity}" field with key "${key}" already exists${dupe.archivedAt ? " (archived)" : ""} — keys stay reserved so stored values keep their meaning`);
    const def = await (this.prisma as any).customFieldDef.create({
      data: {
        organizationId, entity: dto.entity, key, label, type: dto.type,
        options: this.normalizeOptions(dto.type, dto.options),
        required: Boolean(dto.required), sortOrder: Number.isInteger(dto.sortOrder) ? dto.sortOrder! : 0,
      },
    });
    return this.toPublic(def);
  }

  async updateDef(organizationId: string, defId: string, dto: {
    key?: string; label?: string; type?: string; options?: string[] | null;
    required?: boolean; sortOrder?: number; archived?: boolean;
  }) {
    const def = await (this.prisma as any).customFieldDef.findFirst({ where: { id: defId, organizationId } });
    if (!def) throw new NotFoundException("Custom field not found in this organization");
    // The key keys stored values in every row's JSON — immutable.
    if (dto.key !== undefined && dto.key !== def.key) {
      throw new BadRequestException(`Field key "${def.key}" cannot be changed — stored values reference it. Archive this field and create a new one instead.`);
    }
    const data: Record<string, unknown> = {};
    if (dto.label !== undefined) {
      const label = String(dto.label).trim();
      if (!label) throw new BadRequestException("Field label cannot be empty");
      data.label = label;
    }
    const nextType = dto.type ?? def.type;
    if (dto.type !== undefined && !(CUSTOM_FIELD_TYPES as readonly string[]).includes(dto.type)) {
      throw new BadRequestException(`Invalid field type: "${dto.type}" (use ${CUSTOM_FIELD_TYPES.join(", ")})`);
    }
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.options !== undefined || dto.type !== undefined) {
      data.options = this.normalizeOptions(nextType, dto.options !== undefined ? dto.options : def.options);
    }
    if (dto.required !== undefined) data.required = Boolean(dto.required);
    if (dto.sortOrder !== undefined) {
      if (!Number.isInteger(dto.sortOrder)) throw new BadRequestException("sortOrder must be an integer");
      data.sortOrder = dto.sortOrder;
    }
    if (dto.archived !== undefined) data.archivedAt = dto.archived ? new Date() : null;
    const updated = await (this.prisma as any).customFieldDef.update({ where: { id: defId }, data });
    return this.toPublic(updated);
  }

  async archiveDef(organizationId: string, defId: string) {
    return this.updateDef(organizationId, defId, { archived: true });
  }

  /**
   * The validation gate for value writes. `values` is a PARTIAL
   * object: keys present are validated and returned sanitized; a
   * null / empty-string value is a CLEAR marker, returned as null
   * (mergeValues then removes the key). Unknown keys — including
   * keys of ARCHIVED defs — are a 400.
   *
   * forCreate: every non-archived `required` def of the entity
   * must end up with a non-empty value (from `values`, falling
   * back to `existing`); otherwise a 400 naming the label.
   * Updates never enforce required (partial writes stay possible,
   * and rows created before a def existed are unaffected).
   */
  async validateAndSanitize(
    organizationId: string,
    entity: string,
    values: CustomFieldValues | null | undefined,
    opts: { forCreate?: boolean; existing?: CustomFieldValues | null } = {},
  ): Promise<CustomFieldValues> {
    this.assertEntity(entity);
    if (values != null && (typeof values !== "object" || Array.isArray(values))) {
      throw new BadRequestException("customFields must be an object keyed by field key");
    }
    const defs = await this.activeDefs(organizationId, entity);
    const byKey = new Map(defs.map((d: any) => [d.key, d]));
    const sanitized: CustomFieldValues = {};
    for (const [key, raw] of Object.entries(values ?? {})) {
      const def: any = byKey.get(key);
      if (!def) throw new BadRequestException(`Unknown custom field: "${key}" for ${entity}`);
      if (raw === null || (typeof raw === "string" && raw.trim() === "")) { sanitized[key] = null; continue; }
      sanitized[key] = validateCustomFieldValue(def, raw);
    }
    if (opts.forCreate) {
      for (const def of defs as any[]) {
        if (!def.required) continue;
        const v = sanitized[def.key] !== undefined ? sanitized[def.key] : opts.existing?.[def.key];
        if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) {
          throw new BadRequestException(`Custom field "${def.label}" is required`);
        }
      }
    }
    return sanitized;
  }

  /** Apply a sanitized partial object onto stored values: present
   * keys overwrite, null clears (key removed), absent keys stay. */
  mergeValues(existing: CustomFieldValues | null | undefined, sanitized: CustomFieldValues): CustomFieldValues {
    const out: CustomFieldValues = { ...(existing ?? {}) };
    for (const [k, v] of Object.entries(sanitized)) {
      if (v === null) delete out[k]; else out[k] = v;
    }
    return out;
  }

  /** Merge gap-fill (lead merge + customer merge): the survivor
   * keeps its own values; keys it lacks (or holds as null) are
   * filled from the source — the same rule as the scalar fields. */
  fillGaps(target: CustomFieldValues | null | undefined, source: CustomFieldValues | null | undefined): CustomFieldValues {
    const out: CustomFieldValues = { ...(target ?? {}) };
    for (const [k, v] of Object.entries(source ?? {})) {
      if (v !== null && v !== undefined && (out[k] === null || out[k] === undefined)) out[k] = v;
    }
    return out;
  }
}
