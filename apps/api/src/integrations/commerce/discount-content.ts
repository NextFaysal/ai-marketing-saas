/**
 * EC7 — shared DB bookkeeping for StoreDiscount / StoreDiscountSync
 * (the discount sibling of catalog-content's listing helpers).
 */

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function loadDiscount(prisma: any, organizationId: string, discountId: string): Promise<any | null> {
  if (!prisma || !discountId) return null;
  try {
    const table = prisma.storeDiscount;
    if (!table || typeof table.findFirst !== "function") return null;
    return (await table.findFirst({ where: { id: discountId, organizationId } })) ?? null;
  } catch {
    return null;
  }
}

export async function loadDiscountSync(prisma: any, discountId: string, storeId: string): Promise<any | null> {
  if (!prisma || !discountId || !storeId) return null;
  try {
    const table = prisma.storeDiscountSync;
    if (!table || typeof table.findFirst !== "function") return null;
    return (await table.findFirst({ where: { discountId, storeId } })) ?? null;
  } catch {
    return null;
  }
}

export async function markDiscountSync(
  prisma: any,
  input: {
    organizationId: string;
    discountId: string;
    storeId: string;
    externalId?: string | null;
    syncStatus: string;
    lastError?: string | null;
  },
): Promise<any | null> {
  if (!prisma) return null;
  try {
    const table = prisma.storeDiscountSync;
    if (!table) return null;
    const existing = typeof table.findFirst === "function"
      ? await table.findFirst({ where: { discountId: input.discountId, storeId: input.storeId } })
      : null;
    const data: Record<string, any> = {
      syncStatus: input.syncStatus,
      lastError: input.lastError ?? null,
    };
    if (input.externalId !== undefined) data.externalId = input.externalId;
    if (existing) {
      if (typeof table.update === "function") {
        return await table.update({ where: { id: existing.id }, data });
      }
      Object.assign(existing, data);
      return existing;
    }
    if (typeof table.create === "function") {
      return await table.create({
        data: {
          organizationId: input.organizationId,
          discountId: input.discountId,
          storeId: input.storeId,
          externalId: input.externalId ?? null,
          ...data,
        },
      });
    }
    return null;
  } catch {
    /* best-effort bookkeeping; callers still return the verbatim error */
    return null;
  }
}
