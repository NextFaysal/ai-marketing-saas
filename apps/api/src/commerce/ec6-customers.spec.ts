import { encryptJson } from "../integrations/crypto";
import { normalizeWooCustomer, normalizeShopifyCustomerNode, upsertSyncedCustomer } from "../integrations/customer-sync";
import { CustomerPushService } from "./customer-push.service";
import * as wooCustomers from "../integrations/commerce/woo-customers";
import * as shopifyCustomers from "../integrations/commerce/shopify-customers";
import { CustomersService } from "../customers/customers.service";

/* ------------------------------------------------------------------ */
/* Fake prisma (matchWhere style, like ec5-order-push.spec.ts)         */
/* ------------------------------------------------------------------ */

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in (v as any)) {
        if (!(v as any).in.includes(row[k])) return false;
        continue;
      }
      if ("not" in (v as any)) {
        if (row[k] === (v as any).not) return false;
        continue;
      }
      if (!matchWhere(row, v)) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}

function makeTable(seed: any[] = []) {
  const rows: any[] = [...seed];
  let seq = rows.length;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matchWhere(r, where)) ?? null,
    findMany: async ({ where, take, skip, orderBy }: any = {}) => {
      let out = rows.filter((r) => matchWhere(r, where ?? {}));
      if (orderBy) {
        const [field, dir] = Object.entries(orderBy)[0] as any;
        out = [...out].sort((a, b) => {
          const av = a[field] instanceof Date ? a[field].getTime() : a[field];
          const bv = b[field] instanceof Date ? b[field].getTime() : b[field];
          return (av < bv ? -1 : av > bv ? 1 : 0) * (dir === "desc" ? -1 : 1);
        });
      }
      if (typeof skip === "number") out = out.slice(skip);
      if (typeof take === "number") out = out.slice(0, take);
      return out;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matchWhere(r, where));
      if (idx < 0) throw new Error("record not found");
      return rows.splice(idx, 1)[0];
    },
    deleteMany: async ({ where }: any) => {
      let n = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (matchWhere(rows[i], where)) { rows.splice(i, 1); n++; }
      return { count: n };
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)).length,
    upsert: async ({ where, create, update }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (row) { Object.assign(row, update); return row; }
      const created = { id: create.id ?? `row-${++seq}`, ...create };
      rows.push(created);
      return created;
    },
  };
}

/* ------------------------------------------------------------------ */
/* (a) Normalizers                                                     */
/* ------------------------------------------------------------------ */

describe("EC6 normalizers", () => {
  it("normalizeWooCustomer: id string, email trimmed/lowercased, phone from billing, address = billing when non-empty", () => {
    const out = normalizeWooCustomer({
      id: 42,
      first_name: "Ayesha",
      last_name: "Rahman",
      email: "  AYESHA@Example.COM ",
      phone: "should-not-use",
      billing: { first_name: "Ayesha", phone: "01710000002", address_1: "House 1", city: "Khulna", email: "ayesha@example.com" },
    });
    expect(out.externalId).toBe("42");
    expect(out.firstName).toBe("Ayesha");
    expect(out.lastName).toBe("Rahman");
    expect(out.email).toBe("ayesha@example.com");
    expect(out.phone).toBe("01710000002");
    expect(out.address).toMatchObject({ address_1: "House 1", city: "Khulna" });
  });

  it("normalizeWooCustomer: phone falls back to raw.phone, empty billing yields no address", () => {
    const out = normalizeWooCustomer({
      id: 7,
      first_name: "Babul",
      last_name: null,
      email: null,
      phone: "01810000003",
      billing: { phone: undefined, address_1: "", city: "" },
    });
    expect(out.externalId).toBe("7");
    expect(out.phone).toBe("01810000003");
    expect(out.email).toBeNull();
    expect(out.address).toBeUndefined();
  });

  it("normalizeShopifyCustomerNode: gid tail, fields, defaultAddress mapped to address_1/city/zip/phone", () => {
    const out = normalizeShopifyCustomerNode({
      id: "gid://shopify/Customer/456",
      firstName: "Tanvir",
      lastName: "Hossain",
      email: " TANVIR@Example.com",
      phone: "+8801710000004",
      defaultAddress: { address1: "Road 9", address2: "", city: "Dhaka", zip: "1205", country: "Bangladesh", phone: "01710000004" },
    });
    expect(out.externalId).toBe("456");
    expect(out.firstName).toBe("Tanvir");
    expect(out.email).toBe("tanvir@example.com");
    expect(out.phone).toBe("+8801710000004");
    expect(out.address).toMatchObject({ address_1: "Road 9", city: "Dhaka", zip: "1205", phone: "01710000004" });
  });

  it("normalizeShopifyCustomerNode: plain numeric id and missing address", () => {
    const out = normalizeShopifyCustomerNode({ id: 789, firstName: "Nila", email: null, phone: null });
    expect(out.externalId).toBe("789");
    expect(out.address).toBeUndefined();
    expect(out.email).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* (b) upsertSyncedCustomer                                            */
/* ------------------------------------------------------------------ */

describe("EC6 upsertSyncedCustomer", () => {
  function fake() {
    return { customer: makeTable(), customerStoreIdentity: makeTable() } as any;
  }

  it("creates a new customer + identity", async () => {
    const prisma = fake();
    const res = await upsertSyncedCustomer(prisma, {
      organizationId: "org-1", storeId: "st1", source: "woocommerce",
      customer: { externalId: "101", firstName: "Rina", lastName: "Begum", email: "rina@example.com", phone: "01711000001", address: { address_1: "Road 1" } },
    });
    expect(res).toBe("created");
    expect(prisma.customer.rows).toHaveLength(1);
    expect(prisma.customer.rows[0]).toMatchObject({ externalId: "101", email: "rina@example.com", source: "woocommerce" });
    expect(prisma.customerStoreIdentity.rows).toHaveLength(1);
    expect(prisma.customerStoreIdentity.rows[0]).toMatchObject({ storeId: "st1", externalId: "101", emailSnapshot: "rina@example.com", phoneSnapshot: "01711000001" });
    expect(prisma.customerStoreIdentity.rows[0].customerId).toBe(prisma.customer.rows[0].id);
  });

  it("second sync with same externalId updates via identity without duplicating", async () => {
    const prisma = fake();
    await upsertSyncedCustomer(prisma, {
      organizationId: "org-1", storeId: "st1", source: "woocommerce",
      customer: { externalId: "101", firstName: "Rina", lastName: "Begum", email: "rina@example.com", phone: "01711000001" },
    });
    const res = await upsertSyncedCustomer(prisma, {
      organizationId: "org-1", storeId: "st1", source: "woocommerce",
      customer: { externalId: "101", firstName: "Rina Updated", lastName: "Begum", email: "rina2@example.com", phone: "01711000001" },
    });
    expect(res).toBe("updated");
    expect(prisma.customer.rows).toHaveLength(1);
    expect(prisma.customer.rows[0].firstName).toBe("Rina Updated");
    expect(prisma.customer.rows[0].email).toBe("rina2@example.com");
    expect(prisma.customerStoreIdentity.rows).toHaveLength(1);
    expect(prisma.customerStoreIdentity.rows[0].emailSnapshot).toBe("rina2@example.com");
  });

  it("email match on a pre-existing manual customer creates identity without duplicating", async () => {
    const prisma = fake();
    prisma.customer.rows.push({
      id: "manual-1", organizationId: "org-1", source: "lead", externalId: null,
      firstName: "Manual", lastName: null, email: "dup@example.com", phone: null, address: null, mergedIntoId: null, createdAt: new Date(),
    });
    const res = await upsertSyncedCustomer(prisma, {
      organizationId: "org-1", storeId: "st1", source: "woocommerce",
      customer: { externalId: "555", firstName: "Remote", lastName: null, email: "dup@example.com", phone: "01799999999" },
    });
    expect(res).toBe("updated");
    expect(prisma.customer.rows).toHaveLength(1);
    expect(prisma.customer.rows[0].id).toBe("manual-1");
    // Backfilled identity fields on the matched customer.
    expect(prisma.customer.rows[0].externalId).toBe("555");
    expect(prisma.customer.rows[0].source).toBe("woocommerce");
    expect(prisma.customerStoreIdentity.rows).toHaveLength(1);
    expect(prisma.customerStoreIdentity.rows[0]).toMatchObject({ customerId: "manual-1", storeId: "st1", externalId: "555" });
  });
});

/* ------------------------------------------------------------------ */
/* (c) CustomerPushService                                             */
/* ------------------------------------------------------------------ */

describe("EC6 CustomerPushService", () => {
  function setup(syncMode: string) {
    const prisma: any = {
      customer: makeTable([{ id: "c1", organizationId: "org-1", firstName: "Rina", email: "rina@example.com", mergedIntoId: null, createdAt: new Date() }]),
      store: makeTable([{ id: "st1", organizationId: "org-1", name: "Shop", url: "https://shop.example.com", syncMode, createdAt: new Date() }]),
      customerStoreIdentity: makeTable(),
    };
    const enqueued: any[] = [];
    const outbox: any = { enqueue: async (input: any) => { enqueued.push(input); return { id: "ob-1", ...input }; } };
    const audits: any[] = [];
    const audit: any = { log: async (e: any) => { audits.push(e); } };
    const svc = new CustomerPushService(prisma, outbox, audit);
    return { prisma, svc, enqueued, audits };
  }

  it("mirror store refusal (Bengali)", async () => {
    const { svc, enqueued } = setup("mirror");
    await expect(svc.pushToStore("org-1", "u1", "c1", "st1")).rejects.toThrow("এই স্টোরটি mirror মোডে আছে");
    expect(enqueued).toHaveLength(0);
  });

  it("co-manage enqueues push_customer and audits", async () => {
    const { svc, enqueued, audits } = setup("co-manage");
    const res = await svc.pushToStore("org-1", "u1", "c1", "st1");
    expect(res).toMatchObject({ enqueued: 1, outboxId: "ob-1", storeId: "st1", mode: "co-manage", existingIdentity: false });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ entityType: "customer", entityId: "c1", operation: "push_customer", payload: { customerId: "c1", storeId: "st1" } });
    expect(enqueued[0].idempotencyKey).toContain("push_customer:c1:st1:");
    expect(audits.some((a: any) => a.action === "customer.push_to_store" && a.metadata?.storeId === "st1")).toBe(true);
  });

  it("merged customer is refused", async () => {
    const { prisma, svc } = setup("co-manage");
    prisma.customer.rows[0].mergedIntoId = "other";
    await expect(svc.pushToStore("org-1", "u1", "c1", "st1")).rejects.toThrow("মার্জ করা কাস্টমার");
  });

  it("foreign customer / store are 404s", async () => {
    const { svc } = setup("co-manage");
    await expect(svc.pushToStore("org-2", "u1", "c1", "st1")).rejects.toThrow("not found");
    await expect(svc.pushToStore("org-1", "u1", "c1", "nope")).rejects.toThrow("not found");
  });
});

/* ------------------------------------------------------------------ */
/* (d) Woo pushCustomer                                                */
/* ------------------------------------------------------------------ */

function stubWooCustomers(opts: { readBackEmail?: string } = {}) {
  const calls: { method: string; path: string; body: any }[] = [];
  const remote = new Map<string, any>();
  const respond = (data: any) => ({ ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(data), json: async () => data });
  const fn = async (url: string, init: any = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const path = new URL(url).pathname.replace(/^.*\/wp-json\/wc\/v3/, "");
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    if (method === "POST" && path === "/customers") {
      const created = { id: 999, email: body.email, first_name: body.first_name, last_name: body.last_name };
      remote.set("999", created);
      return respond(created);
    }
    const m = path.match(/^\/customers\/(\d+)$/);
    if (m && method === "PUT") {
      const updated = { id: Number(m[1]), email: body.email, first_name: body.first_name };
      remote.set(m[1], updated);
      return respond(updated);
    }
    if (m && method === "GET") {
      const found = remote.get(m[1]);
      if (!found) throw new Error(`stub woo: customer ${m[1]} not found`);
      if (opts.readBackEmail !== undefined) return respond({ ...found, email: opts.readBackEmail });
      return respond(found);
    }
    throw new Error(`stub woo: unhandled ${method} ${path}`);
  };
  return { fn, calls, remote };
}

const WOO_STORE = { id: "st-woo", organizationId: "org-1", platform: "WOOCOMMERCE", url: "https://shop.example.com", syncMode: "co-manage" };
const WOO_INTEGRATION = { id: "int-woo", credential: { encryptedData: encryptJson({ consumerKey: "ck", consumerSecret: "cs" }) } };

function seedCustomerPrisma() {
  const prisma: any = {
    customer: makeTable([{
      id: "c1", organizationId: "org-1", firstName: "Rina", lastName: "Begum",
      email: "rina@example.com", phone: "01711000001", address: { address_1: "Road 1", city: "Khulna" },
      source: "manual", externalId: null, mergedIntoId: null, createdAt: new Date(),
    }]),
    customerStoreIdentity: makeTable(),
  };
  return prisma;
}

describe("EC6 Woo pushCustomer", () => {
  it("POST create + GET read-back + identity saved", async () => {
    const prisma = seedCustomerPrisma();
    const stub = stubWooCustomers();
    const res = await wooCustomers.pushCustomer({ prisma, organizationId: "org-1", store: WOO_STORE, integration: WOO_INTEGRATION, payload: { customerId: "c1" }, fetchFn: stub.fn as any });
    expect(res.ok).toBe(true);
    expect(res.responseSummary).toMatchObject({ platform: "woocommerce", externalId: "999" });
    expect(stub.calls.some((c) => c.method === "POST" && c.path === "/customers")).toBe(true);
    expect(stub.calls.some((c) => c.method === "GET" && c.path === "/customers/999")).toBe(true);
    const postBody = stub.calls.find((c) => c.method === "POST")!.body;
    expect(postBody.billing.address_1).toBe("Road 1");
    expect(prisma.customerStoreIdentity.rows).toHaveLength(1);
    expect(prisma.customerStoreIdentity.rows[0]).toMatchObject({ customerId: "c1", storeId: "st-woo", externalId: "999" });
  });

  it("PUT update when identity exists", async () => {
    const prisma = seedCustomerPrisma();
    prisma.customerStoreIdentity.rows.push({ id: "idn-1", organizationId: "org-1", customerId: "c1", storeId: "st-woo", externalId: "555", emailSnapshot: "old@example.com", phoneSnapshot: null, createdAt: new Date() });
    const stub = stubWooCustomers();
    // Pre-seed remote so GET can find it after PUT (PUT itself seeds the stub map).
    const res = await wooCustomers.pushCustomer({ prisma, organizationId: "org-1", store: WOO_STORE, integration: WOO_INTEGRATION, payload: { customerId: "c1" }, fetchFn: stub.fn as any });
    expect(res.ok).toBe(true);
    expect(res.responseSummary.externalId).toBe("555");
    expect(stub.calls.some((c) => c.method === "PUT" && c.path === "/customers/555")).toBe(true);
    expect(stub.calls.some((c) => c.method === "POST")).toBe(false);
    expect(prisma.customerStoreIdentity.rows).toHaveLength(1);
  });

  it("read-back email mismatch is a verbatim failure and saves no new identity", async () => {
    const prisma = seedCustomerPrisma();
    const stub = stubWooCustomers({ readBackEmail: "other@example.com" });
    const res = await wooCustomers.pushCustomer({ prisma, organizationId: "org-1", store: WOO_STORE, integration: WOO_INTEGRATION, payload: { customerId: "c1" }, fetchFn: stub.fn as any });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("readback_mismatch: email expected rina@example.com got other@example.com");
    expect(prisma.customerStoreIdentity.rows).toHaveLength(0);
  });

  it("missing credentials and missing customer are honest errors", async () => {
    const prisma = seedCustomerPrisma();
    const stub = stubWooCustomers();
    const noCred = await wooCustomers.pushCustomer({ prisma, organizationId: "org-1", store: WOO_STORE, integration: { id: "x" }, payload: { customerId: "c1" }, fetchFn: stub.fn as any });
    expect(noCred).toMatchObject({ ok: false, error: "woo_credentials_missing" });
    const noCust = await wooCustomers.pushCustomer({ prisma, organizationId: "org-1", store: WOO_STORE, integration: WOO_INTEGRATION, payload: {}, fetchFn: stub.fn as any });
    expect(noCust).toMatchObject({ ok: false, error: "customer_not_found" });
  });
});

/* ------------------------------------------------------------------ */
/* (e) Shopify pushCustomer                                            */
/* ------------------------------------------------------------------ */

function stubShopifyCustomers(opts: { readBackEmail?: string } = {}) {
  const calls: { query: string; variables: any }[] = [];
  let lastEmail: string | null = null;
  const respond = (data: any) => ({ ok: true, status: 200, text: async () => JSON.stringify({ data }), json: async () => ({ data }) });
  const fn = async (_url: string, init: any = {}) => {
    const parsed = JSON.parse(init.body);
    const query: string = parsed.query;
    const variables = parsed.variables ?? {};
    calls.push({ query, variables });
    if (query.includes("customerCreate")) {
      lastEmail = variables.input.email;
      return respond({ customerCreate: { customer: { id: "gid://shopify/Customer/789", email: variables.input.email }, userErrors: [] } });
    }
    if (query.includes("customerUpdate")) {
      lastEmail = variables.input.email;
      return respond({ customerUpdate: { customer: { id: variables.input.id, email: variables.input.email }, userErrors: [] } });
    }
    if (query.includes("ecCustomerRead")) {
      return respond({ customer: { id: variables.id, email: opts.readBackEmail !== undefined ? opts.readBackEmail : lastEmail } });
    }
    throw new Error(`stub shopify: unhandled query ${query.slice(0, 60)}`);
  };
  return { fn, calls };
}

const SHOPIFY_STORE = { id: "st-shop", organizationId: "org-1", platform: "SHOPIFY", url: "https://example.myshopify.com", syncMode: "co-manage" };
const SHOPIFY_INTEGRATION = { id: "int-shop", credential: { encryptedData: encryptJson({ accessToken: "tok-123", apiSecret: "secret" }) } };

describe("EC6 Shopify pushCustomer", () => {
  it("customerCreate + read-back + identity saved with numeric tail", async () => {
    const prisma = seedCustomerPrisma();
    const stub = stubShopifyCustomers();
    const res = await shopifyCustomers.pushCustomer({ prisma, organizationId: "org-1", store: SHOPIFY_STORE, integration: SHOPIFY_INTEGRATION, payload: { customerId: "c1" }, fetchFn: stub.fn as any });
    expect(res.ok).toBe(true);
    expect(res.responseSummary).toMatchObject({ platform: "shopify", externalId: "789" });
    expect(stub.calls.some((c) => c.query.includes("customerCreate"))).toBe(true);
    expect(stub.calls.some((c) => c.query.includes("ecCustomerRead"))).toBe(true);
    expect(prisma.customerStoreIdentity.rows).toHaveLength(1);
    expect(prisma.customerStoreIdentity.rows[0]).toMatchObject({ customerId: "c1", storeId: "st-shop", externalId: "789" });
  });

  it("customerUpdate when identity exists (gid input)", async () => {
    const prisma = seedCustomerPrisma();
    prisma.customerStoreIdentity.rows.push({ id: "idn-1", organizationId: "org-1", customerId: "c1", storeId: "st-shop", externalId: "321", emailSnapshot: null, phoneSnapshot: null, createdAt: new Date() });
    const stub = stubShopifyCustomers();
    const res = await shopifyCustomers.pushCustomer({ prisma, organizationId: "org-1", store: SHOPIFY_STORE, integration: SHOPIFY_INTEGRATION, payload: { customerId: "c1" }, fetchFn: stub.fn as any });
    expect(res.ok).toBe(true);
    expect(res.responseSummary.externalId).toBe("321");
    const updateCall = stub.calls.find((c) => c.query.includes("customerUpdate"));
    expect(updateCall).toBeTruthy();
    expect(updateCall!.variables.input.id).toBe("gid://shopify/Customer/321");
    expect(stub.calls.some((c) => c.query.includes("customerCreate"))).toBe(false);
  });

  it("read-back email mismatch is a verbatim failure", async () => {
    const prisma = seedCustomerPrisma();
    const stub = stubShopifyCustomers({ readBackEmail: "nope@example.com" });
    const res = await shopifyCustomers.pushCustomer({ prisma, organizationId: "org-1", store: SHOPIFY_STORE, integration: SHOPIFY_INTEGRATION, payload: { customerId: "c1" }, fetchFn: stub.fn as any });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("readback_mismatch: email expected rina@example.com got nope@example.com");
  });
});

/* ------------------------------------------------------------------ */
/* (f) CustomersService merge carries identities                       */
/* ------------------------------------------------------------------ */

describe("EC6 CustomersService merge carries identities", () => {
  function setup() {
    const prisma: any = {
      customer: makeTable([
        { id: "c-src", organizationId: "org-1", firstName: "Source", lastName: null, email: "src@example.com", phone: null, source: "woocommerce", externalId: "src-ext", mergedIntoId: null, customFields: null, createdAt: new Date() },
        { id: "c-tgt", organizationId: "org-1", firstName: "Target", lastName: null, email: "tgt@example.com", phone: "01700000000", source: "manual", externalId: null, mergedIntoId: null, customFields: null, createdAt: new Date() },
      ]),
      order: makeTable(),
      channelConversation: makeTable(),
      customerStoreIdentity: makeTable([
        { id: "idn-1", organizationId: "org-1", customerId: "c-src", storeId: "s1", externalId: "111", emailSnapshot: "src@example.com", phoneSnapshot: null, createdAt: new Date() },
        { id: "idn-2", organizationId: "org-1", customerId: "c-src", storeId: "s2", externalId: "222", emailSnapshot: "src@example.com", phoneSnapshot: null, createdAt: new Date() },
        { id: "idn-3", organizationId: "org-1", customerId: "c-tgt", storeId: "s2", externalId: "999", emailSnapshot: "tgt@example.com", phoneSnapshot: null, createdAt: new Date() },
      ]),
      store: makeTable([
        { id: "s1", organizationId: "org-1", name: "Woo Shop", createdAt: new Date() },
        { id: "s2", organizationId: "org-1", name: "Shopify Shop", createdAt: new Date() },
      ]),
      lead: makeTable(),
      courierShipment: makeTable(),
    };
    const audits: any[] = [];
    const audit: any = { log: async (e: any) => { audits.push(e); } };
    const svc = new CustomersService(prisma, audit, undefined, undefined);
    return { prisma, svc, audits };
  }

  it("moves source identity to target, keeps target's on same-store conflict, counts in audit", async () => {
    const { prisma, svc, audits } = setup();
    const out: any = await svc.merge("org-1", "actor-1", { sourceId: "c-src", targetId: "c-tgt" });

    const rows = prisma.customerStoreIdentity.rows;
    expect(rows).toHaveLength(2);
    // Moved: s1 identity now belongs to target.
    expect(rows.find((r: any) => r.storeId === "s1")).toMatchObject({ customerId: "c-tgt", externalId: "111" });
    // Conflict: target's s2 identity kept, source's removed.
    expect(rows.find((r: any) => r.storeId === "s2")).toMatchObject({ customerId: "c-tgt", externalId: "999" });
    expect(rows.some((r: any) => r.customerId === "c-src")).toBe(false);

    const mergedAudit = audits.find((a: any) => a.action === "customer.merged");
    expect(mergedAudit).toBeTruthy();
    expect(mergedAudit.metadata).toMatchObject({ identitiesMoved: 1, identityConflicts: 1 });

    // Returned detail carries the survivor's identities with store names.
    expect(out.storeIdentities).toHaveLength(2);
    expect(out.storeIdentities.map((r: any) => r.storeName).sort()).toEqual(["Shopify Shop", "Woo Shop"]);
  });
});
