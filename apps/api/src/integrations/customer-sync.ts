/**
 * EC6 — inbound customer sync normalizers + upsert.
 *
 * Matching discipline for a synced customer (in order):
 *  (1) CustomerStoreIdentity [storeId, externalId] → its customerId
 *  (2) customer with organizationId + source + externalId
 *  (3) customer with organizationId + email (when email present)
 *  (4) customer with organizationId + phone (when phone present)
 *  otherwise a new Customer row is created.
 *
 * On a match only non-null incoming values that differ are written;
 * a matched customer that lacks externalId gets externalId/source
 * backfilled. The identity row is always upserted afterwards so the
 * multi-store truth stays current.
 */

export interface SyncedCustomerInput {
  externalId: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: any;
}

function cleanEmail(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  return s ? s : null;
}

function cleanString(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function hasNonEmptyValue(obj: any): boolean {
  if (!obj || typeof obj !== "object") return false;
  return Object.values(obj).some((v) => {
    if (v === null || v === undefined) return false;
    if (typeof v === "string") return v.trim() !== "";
    return true;
  });
}

export function normalizeWooCustomer(raw: any): SyncedCustomerInput {
  const billing = raw?.billing ?? undefined;
  const phoneRaw = raw?.billing?.phone ?? raw?.phone ?? null;
  const address = billing && hasNonEmptyValue(billing) ? billing : undefined;
  return {
    externalId: String(raw?.id),
    firstName: cleanString(raw?.first_name),
    lastName: cleanString(raw?.last_name),
    email: cleanEmail(raw?.email),
    phone: phoneRaw ? String(phoneRaw) : null,
    address,
  };
}

export function normalizeShopifyCustomerNode(node: any): SyncedCustomerInput {
  const rawId = node?.id != null ? String(node.id) : "";
  const externalId = rawId.includes("/") ? (rawId.split("/").pop() ?? rawId) : rawId;
  let address: any = undefined;
  const da = node?.defaultAddress;
  if (da && typeof da === "object") {
    const addr: Record<string, any> = {};
    const address1 = da.address1 ?? da.address_1;
    if (address1) addr.address_1 = address1;
    if (da.address2) addr.address_2 = da.address2;
    if (da.city) addr.city = da.city;
    const zip = da.zip ?? da.postcode;
    if (zip) addr.zip = zip;
    if (da.country) addr.country = da.country;
    if (da.province) addr.province = da.province;
    if (da.phone) addr.phone = da.phone;
    // Keep any other raw-ish keys that are present and non-empty.
    for (const [k, v] of Object.entries(da)) {
      if (v === null || v === undefined || v === "") continue;
      if (k === "address1" || k === "address2" || k === "zip" || k === "postcode") continue;
      if (!(k in addr)) addr[k] = v;
    }
    if (Object.keys(addr).length > 0) address = addr;
  }
  return {
    externalId,
    firstName: cleanString(node?.firstName),
    lastName: cleanString(node?.lastName),
    email: cleanEmail(node?.email),
    phone: node?.phone ? String(node.phone) : null,
    address,
  };
}

export async function upsertSyncedCustomer(
  prisma: any,
  input: { organizationId: string; storeId: string; source: string; customer: SyncedCustomerInput },
): Promise<"created" | "updated"> {
  const { organizationId, storeId, source } = input;
  const incoming = input.customer;
  const externalId = String(incoming.externalId);
  const email = incoming.email ?? null;
  const phone = incoming.phone ?? null;

  const customerTable = prisma.customer;
  const identityTable = prisma.customerStoreIdentity;

  let matched: any = null;

  // (1) CustomerStoreIdentity [storeId, externalId] → its customerId
  if (identityTable && typeof identityTable.findFirst === "function") {
    try {
      const identity = await identityTable.findFirst({ where: { storeId, externalId } });
      if (identity?.customerId) {
        matched = await customerTable.findFirst({ where: { id: identity.customerId, organizationId } });
      }
    } catch {
      matched = null;
    }
  }
  // (2) customer with organizationId + source + externalId
  if (!matched) {
    matched = await customerTable.findFirst({ where: { organizationId, source, externalId } });
  }
  // (3) customer with organizationId + email (when email present)
  if (!matched && email) {
    matched = await customerTable.findFirst({ where: { organizationId, email } });
  }
  // (4) customer with organizationId + phone (when phone present)
  if (!matched && phone) {
    matched = await customerTable.findFirst({ where: { organizationId, phone } });
  }

  let customerId: string;
  let created = false;

  if (!matched) {
    const row = await customerTable.create({
      data: {
        organizationId,
        source,
        externalId,
        firstName: incoming.firstName ?? null,
        lastName: incoming.lastName ?? null,
        email,
        phone,
        address: incoming.address ?? undefined,
      },
    });
    customerId = row.id;
    created = true;
  } else {
    customerId = matched.id;
    const data: Record<string, any> = {};
    if (incoming.firstName != null && incoming.firstName !== matched.firstName) data.firstName = incoming.firstName;
    if (incoming.lastName != null && incoming.lastName !== matched.lastName) data.lastName = incoming.lastName;
    if (email != null && email !== matched.email) data.email = email;
    if (phone != null && phone !== matched.phone) data.phone = phone;
    if (incoming.address !== undefined && incoming.address !== null) {
      const same = (() => {
        try { return JSON.stringify(incoming.address) === JSON.stringify(matched.address ?? null); } catch { return false; }
      })();
      if (!same) data.address = incoming.address;
    }
    // Backfill externalId/source when the matched customer lacks externalId.
    if (!matched.externalId) {
      data.externalId = externalId;
      data.source = source;
    }
    if (Object.keys(data).length > 0) {
      await customerTable.update({ where: { id: matched.id }, data });
    }
  }

  // Always upsert the identity row afterwards.
  if (identityTable && typeof identityTable.findFirst === "function") {
    const emailSnapshot = email ?? null;
    const phoneSnapshot = phone ?? null;
    const byExternal = await identityTable.findFirst({ where: { storeId, externalId } });
    if (byExternal) {
      await identityTable.update({
        where: { id: byExternal.id },
        data: { customerId, emailSnapshot, phoneSnapshot },
      });
    } else {
      const byCustomerStore = await identityTable.findFirst({ where: { customerId, storeId } });
      if (byCustomerStore) {
        await identityTable.update({
          where: { id: byCustomerStore.id },
          data: { externalId, emailSnapshot, phoneSnapshot },
        });
      } else if (typeof identityTable.create === "function") {
        await identityTable.create({
          data: { organizationId, customerId, storeId, externalId, emailSnapshot, phoneSnapshot },
        });
      }
    }
  }

  return created ? "created" : "updated";
}
