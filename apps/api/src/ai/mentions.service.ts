import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface MentionItem {
  type: "order" | "customer" | "product" | "campaign";
  id: string;
  label: string;
  sub: string;
}

const PER_TYPE = 4;

/**
 * G6 @-mention search: one org-scoped endpoint behind the composer
 * pickers. Returns only the minimal identity facts a picker row
 * needs (label + one sub-line) — the full record facts are loaded
 * server-side at send time by ChatService.buildEntityContext, so
 * nothing sensitive rides through search results.
 */
@Injectable()
export class MentionsService {
  constructor(private readonly prisma: PrismaService) {}

  private p(): any { return this.prisma as any; }

  async search(organizationId: string, qRaw: string, typeRaw?: string): Promise<MentionItem[]> {
    const q = String(qRaw ?? "").trim().slice(0, 60);
    if (q.length < 1) return [];
    const contains = { contains: q, mode: "insensitive" as const };
    const p = this.p();
    const want = (t: string) => !typeRaw || typeRaw === t;
    const out: MentionItem[] = [];

    if (want("order")) {
      const rows = await p.order.findMany({
        where: { organizationId, isPractice: false, OR: [{ externalNumber: contains }, { externalId: contains }] },
        orderBy: { createdAt: "desc" },
        take: PER_TYPE,
      });
      for (const o of rows) out.push({ type: "order", id: o.id, label: `অর্ডার #${o.externalNumber ?? o.externalId}`, sub: `${o.status} · ${o.currency} ${(Number(o.totalMinor ?? 0) / 100).toFixed(2)}` });
    }
    if (want("customer")) {
      const rows = await p.customer.findMany({
        where: { organizationId, mergedIntoId: null, OR: [{ firstName: contains }, { lastName: contains }, { phone: contains }, { email: contains }] },
        orderBy: { createdAt: "desc" },
        take: PER_TYPE,
      });
      for (const c of rows) {
        const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || "(নাম নেই)";
        out.push({ type: "customer", id: c.id, label: name, sub: c.phone ?? c.email ?? "কাস্টমার" });
      }
    }
    if (want("product")) {
      const rows = await p.product.findMany({
        where: { organizationId, OR: [{ name: contains }, { sku: contains }] },
        orderBy: { updatedAt: "desc" },
        take: PER_TYPE,
      });
      for (const pr of rows) out.push({ type: "product", id: pr.id, label: pr.name, sub: pr.sku ? `SKU ${pr.sku}` : "পণ্য" });
    }
    if (want("campaign")) {
      const rows = await p.campaignPlan.findMany({
        where: { organizationId, name: contains },
        orderBy: { updatedAt: "desc" },
        take: PER_TYPE,
      });
      for (const cp of rows) out.push({ type: "campaign", id: cp.id, label: cp.name, sub: `ক্যাম্পেইন · ${cp.status}` });
    }
    return out;
  }
}
