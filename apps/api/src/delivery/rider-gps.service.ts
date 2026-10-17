import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import {
  NF9_ACTIVE_ASSIGNMENT_STATUSES,
  customerRiderLocation,
  fixAgeMs,
  isStaleFix,
  mapsUrlFor,
  shareLinkIsSharing,
} from "./rider-location-visibility";

/**
 * NF9 (FB4) — Rider live GPS.
 *
 * Token discipline (followed exactly from OrgInviteLink /
 * payment links): the raw share token is `randomBytes(32)`
 * base64url, returned ONCE to staff at issue/rotation; at rest
 * only its SHA-256 hex hash is stored (RiderShareLink.tokenHash).
 * Every public resolution hashes the presented token and looks
 * the hash up — a wrong token finds no row and 404s; a revoked
 * or expired link refuses with a Bengali reason. The token is
 * bound to ONE rider row in ONE org: a ping posted with rider
 * A's token is written under rider A only — the DTO carries no
 * rider id at all, so there is nothing a caller can forge to
 * post as rider B.
 *
 * Retention (recorded choice): the rider's CURRENT fix lives in
 * RiderLocationLatest — one row per rider, upserted on every
 * accepted ping (a delayed/out-of-order ping never overwrites a
 * newer fix). History lives in RiderLocationPing, a trail
 * BOUNDED at NF9_TRAIL_CAP_PER_ASSIGNMENT = 200 rows per
 * DeliveryAssignment; on insert the oldest rows beyond the cap
 * are pruned. Nothing else about location is stored.
 *
 * Freshness: a fix older than NF9_STALE_THRESHOLD_MS (5 min,
 * re-exported from rider-location-visibility) is labelled
 * `stale: true` with its real age — it is NEVER presented as
 * live. The fleet view and tracking payloads both carry the
 * same stale flag from the same helper.
 *
 * Posting rule: a ping is accepted ONLY while (a) the share
 * link is valid and the rider's sharing switch is ON, and
 * (b) the rider has an ACTIVE (assigned | picked_up)
 * DeliveryAssignment. Stop-sharing flips the switch OFF: later
 * pings refuse and the customer payload hides the location.
 *
 * Tracking claim (honest): location moves ONLY while the
 * rider's /rider/[token] page is open in a browser on the
 * rider's phone and posts periodically. There is NO background
 * tracking, no native app, and no tracking of any kind when
 * the page is closed — the page itself says so in Bengali.
 */

export const NF9_TRAIL_CAP_PER_ASSIGNMENT = 200;
export const NF9_SHARE_LINK_TTL_MS = 30 * 24 * 3600 * 1000;
export { NF9_STALE_THRESHOLD_MS } from "./rider-location-visibility";

export function hashRiderShareToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function newRiderShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function riderShareLinkFor(token: string): string {
  const base = (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/rider/${token}`;
}

@Injectable()
export class RiderGpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  // ---------------- Staff: share-link management ----------------

  private async riderOr404(organizationId: string, riderId: string) {
    const rider = await this.t("rider").findFirst({ where: { id: riderId, organizationId } });
    if (!rider) throw new NotFoundException("রাইডার পাওয়া যায়নি");
    return rider;
  }

  /** Issue a fresh link, or ROTATE the existing one (the old
   * token dies immediately — the hash is overwritten). The raw
   * token leaves the server exactly once, in this response. */
  async issueShareLink(organizationId: string, actorId: string, riderId: string) {
    const rider = await this.riderOr404(organizationId, riderId);
    if (!rider.active) {
      throw new BadRequestException("এই রাইডার সক্রিয় নন — আগে রাইডার সক্রিয় করুন");
    }
    const raw = newRiderShareToken();
    const expiresAt = new Date(Date.now() + NF9_SHARE_LINK_TTL_MS);
    const table = this.t("riderShareLink");
    const existing = await table.findFirst({ where: { organizationId, riderId: rider.id } });
    let link: any;
    if (existing) {
      link = await table.update({
        where: { id: existing.id },
        data: { tokenHash: hashRiderShareToken(raw), sharingEnabled: true, revokedAt: null, expiresAt },
      });
    } else {
      link = await table.create({
        data: {
          organizationId, riderId: rider.id,
          tokenHash: hashRiderShareToken(raw), sharingEnabled: true, expiresAt,
        },
      });
    }
    await this.audit.log({
      organizationId, userId: actorId,
      action: existing ? "rider.share_link_rotated" : "rider.share_link_issued",
      entityType: "Rider", entityId: rider.id,
      metadata: { riderId: rider.id, rotated: Boolean(existing) },
    });
    return {
      riderId: rider.id,
      token: raw,
      link: riderShareLinkFor(raw),
      sharingEnabled: true,
      expiresAt: link.expiresAt,
    };
  }

  /** Staff kill switch: stamps revokedAt + sharing OFF. The
   * rider cannot resurrect a revoked link from the share page;
   * only a staff issue/rotation creates a working token again. */
  async revokeShareLink(organizationId: string, actorId: string, riderId: string) {
    const rider = await this.riderOr404(organizationId, riderId);
    const table = this.t("riderShareLink");
    const link = await table.findFirst({ where: { organizationId, riderId: rider.id } });
    if (!link) throw new NotFoundException("এই রাইডারের কোনো শেয়ার লিংক নেই");
    const updated = await table.update({
      where: { id: link.id },
      data: { revokedAt: new Date(), sharingEnabled: false },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "rider.share_link_revoked",
      entityType: "Rider", entityId: rider.id, metadata: { riderId: rider.id },
    });
    return { ok: true, riderId: rider.id, sharingEnabled: false, revokedAt: updated.revokedAt };
  }

  /** Staff-visible share state for one rider — NEVER the token
   * or its hash. */
  async shareState(organizationId: string, riderId: string) {
    const rider = await this.riderOr404(organizationId, riderId);
    const link = await this.t("riderShareLink")
      .findFirst({ where: { organizationId, riderId: rider.id } })
      .catch(() => null);
    return { riderId: rider.id, ...this.shareStateOf(link) };
  }

  private shareStateOf(link: any) {
    if (!link) {
      return { hasLink: false, sharingEnabled: false, sharing: false, revoked: false, expiresAt: null as Date | null };
    }
    return {
      hasLink: true,
      sharingEnabled: Boolean(link.sharingEnabled) && !link.revokedAt,
      sharing: shareLinkIsSharing(link),
      revoked: Boolean(link.revokedAt),
      expiresAt: link.expiresAt ?? null,
    };
  }

  // ---------------- Public: token resolution ----------------

  /** Resolve a presented raw token to its link + rider. Wrong
   * token → 404; revoked → 403; expired → 403. Org isolation is
   * structural: the link row carries its org and every later
   * read is scoped to that org + that rider. */
  async resolveShareToken(rawToken: string) {
    const clean = String(rawToken ?? "").trim();
    if (clean.length < 10) throw new NotFoundException("এই রাইডার লিংকটি পাওয়া যায়নি");
    const link = await this.t("riderShareLink").findFirst({
      where: { tokenHash: hashRiderShareToken(clean) },
    });
    if (!link) throw new NotFoundException("এই রাইডার লিংকটি পাওয়া যায়নি");
    if (link.revokedAt) {
      throw new ForbiddenException("এই লোকেশন শেয়ার লিংকটি বাতিল করা হয়েছে — দোকান থেকে নতুন লিংক নিন");
    }
    if (link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now()) {
      throw new ForbiddenException("এই লোকেশন শেয়ার লিংকের মেয়াদ শেষ — দোকান থেকে নতুন লিংক নিন");
    }
    const rider = await this.t("rider").findFirst({
      where: { id: link.riderId, organizationId: link.organizationId },
    });
    if (!rider) throw new NotFoundException("রাইডার পাওয়া যায়নি");
    return { link, rider };
  }

  private async activeAssignmentFor(organizationId: string, riderId: string) {
    const rows = await this.t("deliveryAssignment").findMany({
      where: {
        organizationId, riderId,
        status: { in: [...NF9_ACTIVE_ASSIGNMENT_STATUSES] },
      },
      orderBy: { assignedAt: "desc" },
    }).catch(() => []);
    return (rows as any[])[0] ?? null;
  }

  /** What the rider's own share page shows: who they are, the
   * shop, the sharing switch state, the active assignment (if
   * any) and their last accepted fix for THAT assignment. */
  async publicResolve(rawToken: string) {
    const { link, rider } = await this.resolveShareToken(rawToken);
    const org = await this.t("organization")
      .findFirst({ where: { id: link.organizationId } })
      .catch(() => null);
    const assignment = await this.activeAssignmentFor(link.organizationId, rider.id);
    let orderNumber: string | null = null;
    let orderStatus: string | null = null;
    if (assignment) {
      const order = await this.t("order")
        .findFirst({ where: { id: assignment.orderId, organizationId: link.organizationId } })
        .catch(() => null);
      orderNumber = order?.externalNumber ?? null;
      orderStatus = order?.status ?? null;
    }
    let latestLocation: any = null;
    if (assignment) {
      const latest = await this.t("riderLocationLatest")
        .findFirst({ where: { organizationId: link.organizationId, riderId: rider.id } })
        .catch(() => null);
      if (latest && latest.deliveryAssignmentId === assignment.id) {
        latestLocation = this.fixView(latest);
      }
    }
    return {
      rider: { id: rider.id, name: rider.name },
      business: org?.brandName ?? org?.name ?? "দোকান",
      sharingEnabled: Boolean(link.sharingEnabled),
      shareExpiresAt: link.expiresAt,
      hasActiveAssignment: Boolean(assignment),
      assignment: assignment
        ? {
            id: assignment.id, status: assignment.status,
            orderId: assignment.orderId, orderNumber, orderStatus,
          }
        : null,
      latestLocation,
    };
  }

  private fixView(latest: any) {
    const recordedAt = latest.recordedAt instanceof Date ? latest.recordedAt : new Date(latest.recordedAt);
    return {
      lat: Number(latest.lat),
      lng: Number(latest.lng),
      accuracy: latest.accuracy != null ? Number(latest.accuracy) : null,
      recordedAt: recordedAt.toISOString(),
      ageMs: fixAgeMs(recordedAt),
      stale: isStaleFix(recordedAt),
      mapsUrl: mapsUrlFor(Number(latest.lat), Number(latest.lng)),
    };
  }

  // ---------------- Public: ping + sharing switch ----------------

  async postPing(
    rawToken: string,
    dto: { lat?: unknown; lng?: unknown; accuracy?: unknown; recordedAt?: unknown },
  ) {
    const { link, rider } = await this.resolveShareToken(rawToken);
    if (!link.sharingEnabled) {
      throw new ForbiddenException("লোকেশন শেয়ারিং বন্ধ আছে — আগে এই পেজ থেকে শেয়ারিং চালু করুন");
    }
    if (!rider.active) {
      throw new ForbiddenException("এই রাইডার সক্রিয় নন — লোকেশন পাঠানো যাচ্ছে না");
    }
    const lat = Number(dto?.lat);
    const lng = Number(dto?.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new BadRequestException("lat সঠিক নয় (-90 থেকে 90 এর মধ্যে হতে হবে)");
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new BadRequestException("lng সঠিক নয় (-180 থেকে 180 এর মধ্যে হতে হবে)");
    }
    let accuracy: number | null = null;
    if (dto?.accuracy != null && dto?.accuracy !== "") {
      accuracy = Number(dto.accuracy);
      if (!Number.isFinite(accuracy) || accuracy < 0) {
        throw new BadRequestException("accuracy সঠিক নয়");
      }
    }
    let recordedAt = new Date();
    if (dto?.recordedAt != null && dto?.recordedAt !== "") {
      const parsed = new Date(dto.recordedAt as any);
      if (Number.isNaN(parsed.getTime())) throw new BadRequestException("recordedAt সঠিক নয়");
      // Device clocks skew: a fix stamped more than 60s in the
      // future is clamped to server time rather than trusted.
      recordedAt = parsed.getTime() > Date.now() + 60_000 ? new Date() : parsed;
    }

    const assignment = await this.activeAssignmentFor(link.organizationId, rider.id);
    if (!assignment) {
      throw new BadRequestException("এখন কোনো সক্রিয় ডেলিভারি অ্যাসাইনমেন্ট নেই — লোকেশন পাঠানো যাচ্ছে না");
    }

    const ping = await this.t("riderLocationPing").create({
      data: {
        organizationId: link.organizationId, riderId: rider.id,
        deliveryAssignmentId: assignment.id, lat, lng, accuracy, recordedAt,
      },
    });

    // Latest-fix upsert: one row per rider; an out-of-order
    // (older) ping joins the trail but never moves the latest
    // fix backwards.
    const latestTable = this.t("riderLocationLatest");
    const existingLatest = await latestTable
      .findFirst({ where: { organizationId: link.organizationId, riderId: rider.id } })
      .catch(() => null);
    if (!existingLatest) {
      await latestTable.create({
        data: {
          organizationId: link.organizationId, riderId: rider.id,
          deliveryAssignmentId: assignment.id, lat, lng, accuracy, recordedAt,
        },
      });
    } else if (recordedAt.getTime() >= new Date(existingLatest.recordedAt).getTime()) {
      await latestTable.update({
        where: { id: existingLatest.id },
        data: { deliveryAssignmentId: assignment.id, lat, lng, accuracy, recordedAt },
      });
    }

    await this.pruneTrail(link.organizationId, assignment.id);
    return {
      ok: true, pingId: ping.id, assignmentId: assignment.id,
      recordedAt: recordedAt.toISOString(), sharingEnabled: true,
    };
  }

  /** Bounded trail: keep the newest NF9_TRAIL_CAP_PER_ASSIGNMENT
   * pings per assignment; older rows are deleted on insert. */
  private async pruneTrail(organizationId: string, deliveryAssignmentId: string) {
    try {
      const table = this.t("riderLocationPing");
      const rows: any[] = await table.findMany({
        where: { organizationId, deliveryAssignmentId },
        orderBy: { recordedAt: "desc" },
      });
      if (!rows || rows.length <= NF9_TRAIL_CAP_PER_ASSIGNMENT) return;
      const excess = rows.slice(NF9_TRAIL_CAP_PER_ASSIGNMENT);
      for (const row of excess) {
        if (typeof table.deleteMany === "function") {
          await table.deleteMany({ where: { id: row.id } });
        } else if (typeof table.delete === "function") {
          await table.delete({ where: { id: row.id } });
        }
      }
    } catch { /* pruning is retention housekeeping — never fails a ping */ }
  }

  /** The rider's own switch, from the share page. Works only on
   * a live (non-revoked, non-expired) link — resolution above
   * refuses those before we get here. */
  async setSharing(rawToken: string, enabled: boolean) {
    const { link } = await this.resolveShareToken(rawToken);
    const updated = await this.t("riderShareLink").update({
      where: { id: link.id }, data: { sharingEnabled: Boolean(enabled) },
    });
    return { ok: true, sharingEnabled: Boolean(updated.sharingEnabled) };
  }

  // ---------------- Staff: fleet view ----------------

  /**
   * Fleet view: one entry per ACTIVE assignment (assigned |
   * picked_up) with the rider, the order ref, the sharing state
   * and the last-known fix FOR THAT ASSIGNMENT (stale-labelled
   * past 5 minutes, never dressed up as live). `riders` lists
   * every rider with their share state so staff can issue /
   * rotate / revoke links from the same page.
   */
  async fleet(organizationId: string) {
    const assignments: any[] = await this.t("deliveryAssignment").findMany({
      where: {
        organizationId,
        status: { in: [...NF9_ACTIVE_ASSIGNMENT_STATUSES] },
      },
      orderBy: { assignedAt: "desc" },
      take: 200,
    }).catch(() => []);
    const riders: any[] = await this.t("rider").findMany({
      where: { organizationId }, orderBy: { createdAt: "asc" },
    }).catch(() => []);
    const riderById = new Map<string, any>(riders.map((r: any) => [r.id, r]));

    const entries: any[] = [];
    for (const a of assignments as any[]) {
      const rider = riderById.get(a.riderId) ?? null;
      const order = await this.t("order")
        .findFirst({ where: { id: a.orderId, organizationId } })
        .catch(() => null);
      const link = await this.t("riderShareLink")
        .findFirst({ where: { organizationId, riderId: a.riderId } })
        .catch(() => null);
      const latest = await this.t("riderLocationLatest")
        .findFirst({ where: { organizationId, riderId: a.riderId } })
        .catch(() => null);
      entries.push({
        assignmentId: a.id,
        assignmentStatus: a.status,
        assignedAt: a.assignedAt,
        riderId: a.riderId,
        riderName: rider?.name ?? null,
        riderPhone: rider?.phone ?? null,
        orderId: a.orderId,
        orderNumber: order?.externalNumber ?? null,
        orderStatus: order?.status ?? null,
        sharing: this.shareStateOf(link),
        location: latest && latest.deliveryAssignmentId === a.id ? this.fixView(latest) : null,
      });
    }

    const riderViews: any[] = [];
    for (const r of riders as any[]) {
      const link = await this.t("riderShareLink")
        .findFirst({ where: { organizationId, riderId: r.id } })
        .catch(() => null);
      riderViews.push({
        id: r.id, name: r.name, phone: r.phone, active: r.active,
        sharing: this.shareStateOf(link),
      });
    }
    return { entries, riders: riderViews };
  }

  // ---------------- Customer visibility (shared rule) ----------------

  /** Delegates to the ONE shared rule in
   * rider-location-visibility (also used inline by the CX6 and
   * EC18 payload builders). */
  async customerVisibleLocation(
    organizationId: string,
    orderId: string,
    gates: { orderStatus?: unknown; shipmentStatus?: unknown },
  ) {
    return customerRiderLocation(this.prisma as any, organizationId, orderId, gates);
  }
}
