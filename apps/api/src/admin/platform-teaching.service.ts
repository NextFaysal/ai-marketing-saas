import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { TEACHING_KINDS, TEACHING_LANGUAGES } from "./platform-teaching.dto";

/**
 * SA-B22 (Smart AI Phase 6, T1): the Admin Training Console's
 * teaching store — SUPER admins write platform-wide guidance
 * (style / policy / how-to) that every org's Brain receives at
 * the LOWEST precedence (plan D8: admin global teaching ranks
 * below org instructions on facts — the org's own truth wins).
 *
 * What teaching is NOT: a source of facts about any shop. The
 * enforcement is structural, in OrgBrainService: enabled items
 * are rendered into `OrgBrainContext.platformGuidance` — the
 * guidance channel, assembled after every org section under a
 * yield label — and never into facts / factsText / knowledge
 * matches, so a number written here (say a platform-wide
 * "৫০% ছাড়" line) can never ground a customer answer: the
 * number guard and the Answer Store draw their allowed numbers
 * from the fact channels only. This service is plain CRUD +
 * audit; the channel wall lives in the Brain read, and the
 * SA-B22 specs pin both halves.
 *
 * Admin conventions (AdminService precedent): every mutation is
 * audit-logged as `admin.ai_teaching_*` with the actor id and
 * ip, and updatedById / createdById are stamped from the live
 * admin row the SuperAdminGuard resolved — never from the body.
 */
@Injectable()
export class PlatformTeachingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private db(): any {
    return this.prisma as any;
  }

  private shape(row: any) {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      language: row.language,
      kind: row.kind,
      enabled: Boolean(row.enabled),
      sortOrder: Number(row.sortOrder ?? 0),
      createdById: row.createdById ?? null,
      updatedById: row.updatedById ?? null,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    };
  }

  /** Console list: every row (enabled and disabled), in the
   * order the Brain will render them (sortOrder, then age). */
  async list() {
    const rows = await this.db().platformTeaching.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return { items: rows.map((r: any) => this.shape(r)), total: rows.length };
  }

  async create(actor: any, dto: any, ip?: string) {
    const data = this.validateCreate(dto);
    const row = await this.db().platformTeaching.create({
      data: { ...data, createdById: actor?.id ?? null, updatedById: actor?.id ?? null },
    });
    await this.audit.log({
      userId: actor?.id,
      action: "admin.ai_teaching_create",
      entityType: "PlatformTeaching",
      entityId: row.id,
      metadata: { title: row.title, kind: row.kind, language: row.language, enabled: row.enabled },
      ipAddress: ip,
    });
    return this.shape(row);
  }

  async update(actor: any, id: string, dto: any, ip?: string) {
    const patch = this.validateUpdate(dto);
    if (!Object.keys(patch).length) throw new BadRequestException("Nothing to update");
    const existing = await this.db().platformTeaching.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Teaching item not found");
    const row = await this.db().platformTeaching.update({
      where: { id },
      data: { ...patch, updatedById: actor?.id ?? null },
    });
    await this.audit.log({
      userId: actor?.id,
      action: "admin.ai_teaching_update",
      entityType: "PlatformTeaching",
      entityId: row.id,
      metadata: { fields: Object.keys(patch) },
      ipAddress: ip,
    });
    return this.shape(row);
  }

  /** Enable/disable is the console's kill lever for a teaching
   * item: a disabled row is absent from every Brain context
   * (the Brain read filters on enabled — spec-pinned). */
  async setEnabled(actor: any, id: string, enabled: boolean, ip?: string) {
    if (typeof enabled !== "boolean") throw new BadRequestException("enabled must be a boolean");
    const existing = await this.db().platformTeaching.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Teaching item not found");
    const row = await this.db().platformTeaching.update({
      where: { id },
      data: { enabled, updatedById: actor?.id ?? null },
    });
    await this.audit.log({
      userId: actor?.id,
      action: enabled ? "admin.ai_teaching_enable" : "admin.ai_teaching_disable",
      entityType: "PlatformTeaching",
      entityId: row.id,
      ipAddress: ip,
    });
    return this.shape(row);
  }

  async remove(actor: any, id: string, ip?: string) {
    const existing = await this.db().platformTeaching.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Teaching item not found");
    await this.db().platformTeaching.delete({ where: { id } });
    await this.audit.log({
      userId: actor?.id,
      action: "admin.ai_teaching_delete",
      entityType: "PlatformTeaching",
      entityId: id,
      metadata: { title: existing.title },
      ipAddress: ip,
    });
    return { deleted: true, id };
  }

  // The controller's DTOs validate by decorator; these guards
  // keep the same closed vocabularies when the service is
  // reached without them (specs, future callers).
  private validateCreate(dto: any) {
    const title = String(dto?.title ?? "").trim();
    const content = String(dto?.content ?? "").trim();
    if (!title) throw new BadRequestException("title is required");
    if (!content) throw new BadRequestException("content is required");
    if (title.length > 200) throw new BadRequestException("title is too long (max 200)");
    if (content.length > 4000) throw new BadRequestException("content is too long (max 4000)");
    const language = dto?.language ?? "bn";
    if (!(TEACHING_LANGUAGES as readonly string[]).includes(language)) {
      throw new BadRequestException(`language must be one of ${TEACHING_LANGUAGES.join(", ")}`);
    }
    const kind = dto?.kind ?? "guidance";
    if (!(TEACHING_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException(`kind must be one of ${TEACHING_KINDS.join(", ")}`);
    }
    return {
      title,
      content,
      language,
      kind,
      enabled: dto?.enabled === undefined ? true : Boolean(dto.enabled),
      sortOrder: Number.isInteger(dto?.sortOrder) ? dto.sortOrder : 0,
    };
  }

  private validateUpdate(dto: any) {
    const patch: Record<string, unknown> = {};
    if (dto?.title !== undefined) {
      const title = String(dto.title ?? "").trim();
      if (!title) throw new BadRequestException("title cannot be empty");
      if (title.length > 200) throw new BadRequestException("title is too long (max 200)");
      patch.title = title;
    }
    if (dto?.content !== undefined) {
      const content = String(dto.content ?? "").trim();
      if (!content) throw new BadRequestException("content cannot be empty");
      if (content.length > 4000) throw new BadRequestException("content is too long (max 4000)");
      patch.content = content;
    }
    if (dto?.language !== undefined) {
      if (!(TEACHING_LANGUAGES as readonly string[]).includes(dto.language)) {
        throw new BadRequestException(`language must be one of ${TEACHING_LANGUAGES.join(", ")}`);
      }
      patch.language = dto.language;
    }
    if (dto?.kind !== undefined) {
      if (!(TEACHING_KINDS as readonly string[]).includes(dto.kind)) {
        throw new BadRequestException(`kind must be one of ${TEACHING_KINDS.join(", ")}`);
      }
      patch.kind = dto.kind;
    }
    if (dto?.sortOrder !== undefined) {
      if (!Number.isInteger(dto.sortOrder)) throw new BadRequestException("sortOrder must be an integer");
      patch.sortOrder = dto.sortOrder;
    }
    return patch;
  }
}
