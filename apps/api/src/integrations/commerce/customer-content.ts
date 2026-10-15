/**
 * EC6 — shared helpers for customer push adapters.
 * Org-scoped loads + the identity upsert discipline shared with
 * the inbound sync (customer-sync.ts).
 */

export async function loadCustomerForPush(prisma: any, organizationId: string, customerId: string): Promise<any | null> {
  if (!customerId) return null;
  try {
    return await prisma.customer.findFirst({ where: { id: customerId, organizationId } });
  } catch {
    return null;
  }
}

export async function loadCustomerIdentity(prisma: any, storeId: string, customerId: string): Promise<any | null> {
  if (!storeId || !customerId) return null;
  try {
    const table = prisma.customerStoreIdentity;
    if (!table || typeof table.findFirst !== "function") return null;
    return await table.findFirst({ where: { storeId, customerId } });
  } catch {
    return null;
  }
}

export async function saveCustomerIdentity(
  prisma: any,
  input: { organizationId: string; customerId: string; storeId: string; externalId: string; email?: string | null; phone?: string | null },
): Promise<void> {
  const table = prisma?.customerStoreIdentity;
  if (!table || typeof table.findFirst !== "function") return;
  const { organizationId, customerId, storeId } = input;
  const externalId = String(input.externalId);
  const emailSnapshot = input.email ?? null;
  const phoneSnapshot = input.phone ?? null;
  const byExternal = await table.findFirst({ where: { storeId, externalId } });
  if (byExternal) {
    await table.update({
      where: { id: byExternal.id },
      data: { customerId, emailSnapshot, phoneSnapshot },
    });
    return;
  }
  const byCustomerStore = await table.findFirst({ where: { customerId, storeId } });
  if (byCustomerStore) {
    await table.update({
      where: { id: byCustomerStore.id },
      data: { externalId, emailSnapshot, phoneSnapshot },
    });
    return;
  }
  if (typeof table.create === "function") {
    await table.create({
      data: { organizationId, customerId, storeId, externalId, emailSnapshot, phoneSnapshot },
    });
  }
}
