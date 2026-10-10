import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { graphGet, graphPost, metaTokenForAccount } from "../common/meta-graph";
import { FLAG_DISABLED_MESSAGE, orgFlagEnabled } from "../common/feature-flags";

@Injectable()
export class CreativesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async listAssets(organizationId: string, adAccountId?: string) {
    return (this.prisma as any).creativeAsset.findMany({
      where: { organizationId, ...(adAccountId ? { adAccountId } : {}) },
      orderBy: { createdAt: "desc" }, take: 200,
    });
  }

  /** Upload media to Meta by URL. Images return a hash (ready at
   * once); videos are ingested asynchronously (processing). A failed
   * upload is recorded as a failed asset with Meta's own error —
   * never presented as uploaded. */
  async upload(organizationId: string, actorId: string, adAccountId: string, dto: { kind: string; name: string; sourceUrl: string }) {
    // Milestone 40: platform feature flag (creative_library).
    if (!(await orgFlagEnabled(this.prisma as any, organizationId, "creative_library"))) {
      throw new ForbiddenException(FLAG_DISABLED_MESSAGE("Creative Library"));
    }
    if (!["image", "video"].includes(dto.kind)) throw new BadRequestException("kind must be image or video");
    if (!/^https:\/\//i.test(dto.sourceUrl)) throw new BadRequestException("sourceUrl must be an https URL Meta can fetch");
    const { account, token } = await metaTokenForAccount(this.prisma, organizationId, adAccountId).catch((e) => {
      throw new BadRequestException(e instanceof Error ? e.message : "Meta account resolution failed");
    });
    const asset = await (this.prisma as any).creativeAsset.create({
      data: { organizationId, adAccountId, kind: dto.kind, name: dto.name, sourceUrl: dto.sourceUrl, status: "pending", createdById: actorId },
    });
    try {
      if (dto.kind === "image") {
        const res = await graphPost(token, `/${account.externalId}/adimages`, { urls: JSON.stringify([dto.sourceUrl]) });
        const entry = res?.images ? Object.values(res.images)[0] as any : null;
        if (!entry?.hash) throw new Error("Meta returned no image hash; upload is NOT confirmed");
        await (this.prisma as any).creativeAsset.update({ where: { id: asset.id }, data: { status: "ready", externalHash: entry.hash } });
      } else {
        const res = await graphPost(token, `/${account.externalId}/advideos`, { file_url: dto.sourceUrl, title: dto.name });
        if (!res?.id) throw new Error("Meta returned no video id; upload is NOT confirmed");
        await (this.prisma as any).creativeAsset.update({ where: { id: asset.id }, data: { status: "processing", externalVideoId: String(res.id) } });
      }
    } catch (e) {
      await (this.prisma as any).creativeAsset.update({
        where: { id: asset.id },
        data: { status: "failed", error: e instanceof Error ? e.message : "Upload failed" },
      });
    }
    await this.audit.log({ organizationId, userId: actorId, action: "creative.upload", entityType: "CreativeAsset", entityId: asset.id, metadata: { kind: dto.kind } });
    return (this.prisma as any).creativeAsset.findUnique({ where: { id: asset.id } });
  }

  async refreshVideo(organizationId: string, assetId: string) {
    const asset = await (this.prisma as any).creativeAsset.findFirst({ where: { id: assetId, organizationId } });
    if (!asset) throw new NotFoundException("Asset not found");
    if (asset.kind !== "video" || !asset.externalVideoId) throw new BadRequestException("Only uploaded videos can be refreshed");
    const { token } = await metaTokenForAccount(this.prisma, organizationId, asset.adAccountId);
    const res = await graphGet(token, `/${asset.externalVideoId}`, { fields: "status" });
    const vs = res?.status?.video_status as string | undefined;
    const status = vs === "ready" ? "ready" : vs === "error" ? "failed" : "processing";
    await (this.prisma as any).creativeAsset.update({
      where: { id: asset.id },
      data: { status, ...(status === "failed" ? { error: "Meta reported a video processing error" } : { error: null }) },
    });
    return (this.prisma as any).creativeAsset.findUnique({ where: { id: asset.id } });
  }

  async remove(organizationId: string, assetId: string) {
    const asset = await (this.prisma as any).creativeAsset.findFirst({ where: { id: assetId, organizationId } });
    if (!asset) throw new NotFoundException("Asset not found");
    await (this.prisma as any).creativeAsset.delete({ where: { id: asset.id } });
    return { deleted: true };
  }
}
