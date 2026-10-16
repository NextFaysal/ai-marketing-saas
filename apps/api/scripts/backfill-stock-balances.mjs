#!/usr/bin/env node
/**
 * AB3 (AX4) backfill: seed StockBalance rows for tracked stock
 * rows that have none yet — the deploy-runnable twin of the
 * backfill inside migration 20261017030000_ab3_multi_warehouse
 * (design docs/advanced-ab3-design.md §4.1 resolver + §4.3 rule,
 * the same rule the future InventoryService.backfillStockBalances
 * will implement).
 *
 * For every organization, each TRACKED row (stockQuantity NOT
 * NULL — null = untracked, always skipped) that has NO
 * StockBalance rows yet gets exactly one, at its resolved
 * default bin, with onHand = the global counter, reserved = 0:
 *   1. the ProductBinAssignment for (product, variant) in a
 *      default warehouse of the org (earliest such assignment);
 *   2. else the earliest assignment for (product, variant) in
 *      any of the org's warehouses;
 *   3. else the earliest bin of the org's chosen default
 *      warehouse (isDefault first, else earliest createdAt).
 * 'Main Warehouse' (isDefault) / 'Main Bin' (code 'MAIN') are
 * created LAZILY, only when an org actually has a row to seed
 * and no warehouse / no bin in the chosen warehouse exists.
 * Existing balances are never touched, so the script is
 * idempotent: a second run seeds nothing.
 *
 * Usage (against YOUR deployment database — this script is
 * intentionally NOT run from the build sandbox; it needs the
 * AB3 migration applied and a Prisma client generated from the
 * AB3 schema):
 *   DATABASE_URL=postgres://… node apps/api/scripts/backfill-stock-balances.mjs [--apply] [--org=<organizationId>]
 *
 * Dry-run is the default: it only reports what WOULD be seeded.
 * --apply performs the writes. Per-org counts are printed
 * either way.
 */
import { createRequire } from "node:module";

const apply = process.argv.includes("--apply");
const orgArg = process.argv.find((a) => a.startsWith("--org="));
const onlyOrgId = orgArg ? orgArg.split("=")[1] : null;

if (process.argv.includes("--help")) {
  console.log("Usage: backfill-stock-balances.mjs [--apply] [--org=<organizationId>]  (default: dry-run)");
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — point it at the deployment database (the AB3 migration must already be applied).");
  process.exit(1);
}

// Resolve @prisma/client through packages/db so the script
// works from the apps/api/scripts/ folder (same pattern as
// scripts/backfill-store-listings.ts and packages/db seeds).
const requireFromDb = createRequire(new URL("../../../packages/db/package.json", import.meta.url));
const { PrismaClient } = requireFromDb("@prisma/client");
const prisma = new PrismaClient();

const keyOf = (productId, variantId) => `${productId}::${variantId ?? ""}`;

async function backfillOrg(organizationId) {
  const [products, variants, existing] = await Promise.all([
    prisma.product.findMany({
      where: { organizationId, stockQuantity: { not: null } },
      select: { id: true, stockQuantity: true },
    }),
    prisma.productVariant.findMany({
      where: { stockQuantity: { not: null }, product: { organizationId } },
      select: { id: true, productId: true, stockQuantity: true },
    }),
    prisma.stockBalance.findMany({
      where: { organizationId },
      select: { productId: true, variantId: true },
    }),
  ]);

  const counts = {
    tracked: products.length + variants.length,
    seededProducts: 0,
    seededVariants: 0,
    skipped: 0,
    createdWarehouse: false,
    createdBin: false,
  };
  if (counts.tracked === 0) return counts;

  const seededKeys = new Set(existing.map((b) => keyOf(b.productId, b.variantId)));
  const productWork = products.filter((p) => !seededKeys.has(keyOf(p.id, null)));
  const variantWork = variants.filter((v) => !seededKeys.has(keyOf(v.productId, v.id)));
  counts.skipped = counts.tracked - productWork.length - variantWork.length;
  if (productWork.length === 0 && variantWork.length === 0) return counts;

  // Resolver state, loaded once per org (all lists in the SQL
  // backfill's deterministic order: createdAt ASC, id ASC).
  const warehouses = await prisma.warehouse.findMany({
    where: { organizationId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const bins = await prisma.binLocation.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const assignments = await prisma.productBinAssignment.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const defaultWarehouseIds = new Set(warehouses.filter((w) => w.isDefault).map((w) => w.id));
  // Chosen default warehouse: isDefault first, else earliest.
  let chosen = warehouses[0] ?? null;

  // Lazily create the Main Warehouse / Main Bin the resolver
  // falls back to (design §4.1 step 3). In dry-run the rows are
  // only staged in memory so resolution proceeds identically.
  async function ensureFallbackBin() {
    if (!chosen) {
      const warehouseData = { organizationId, name: "Main Warehouse", isDefault: true };
      chosen = apply
        ? await prisma.warehouse.create({ data: warehouseData })
        : { id: "__dry_run_warehouse__", ...warehouseData, createdAt: new Date(0) };
      warehouses.push(chosen);
      defaultWarehouseIds.add(chosen.id);
      counts.createdWarehouse = true;
    }
    let bin = bins.find((b) => b.warehouseId === chosen.id);
    if (!bin) {
      const binData = { organizationId, warehouseId: chosen.id, code: "MAIN" };
      bin = apply
        ? await prisma.binLocation.create({ data: binData })
        : { id: "__dry_run_bin__", ...binData, createdAt: new Date(0) };
      bins.push(bin);
      counts.createdBin = true;
    }
    return bin.id;
  }

  async function resolveBinId(productId, variantId) {
    const inDefault = assignments.find(
      (a) => a.productId === productId && (a.variantId ?? null) === variantId && defaultWarehouseIds.has(a.warehouseId),
    );
    if (inDefault) return inDefault.binLocationId;
    const anywhere = assignments.find(
      (a) => a.productId === productId && (a.variantId ?? null) === variantId,
    );
    if (anywhere) return anywhere.binLocationId;
    if (chosen) {
      const bin = bins.find((b) => b.warehouseId === chosen.id);
      if (bin) return bin.id;
    }
    return ensureFallbackBin();
  }

  for (const p of productWork) {
    const binId = await resolveBinId(p.id, null);
    if (apply) {
      await prisma.stockBalance.create({
        data: { organizationId, productId: p.id, variantId: null, binId, onHand: p.stockQuantity, reserved: 0 },
      });
    }
    seededKeys.add(keyOf(p.id, null));
    counts.seededProducts++;
  }
  for (const v of variantWork) {
    const binId = await resolveBinId(v.productId, v.id);
    if (apply) {
      await prisma.stockBalance.create({
        data: { organizationId, productId: v.productId, variantId: v.id, binId, onHand: v.stockQuantity, reserved: 0 },
      });
    }
    seededKeys.add(keyOf(v.productId, v.id));
    counts.seededVariants++;
  }
  return counts;
}

async function main() {
  const orgs = await prisma.organization.findMany({
    where: onlyOrgId ? { id: onlyOrgId } : undefined,
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const totals = { seededProducts: 0, seededVariants: 0, skipped: 0, orgsWithTracked: 0 };
  for (const org of orgs) {
    const c = await backfillOrg(org.id);
    totals.seededProducts += c.seededProducts;
    totals.seededVariants += c.seededVariants;
    totals.skipped += c.skipped;
    if (c.tracked === 0) continue;
    totals.orgsWithTracked++;
    console.log(
      `org ${org.id}: tracked=${c.tracked} seeded=${c.seededProducts} product + ${c.seededVariants} variant, ` +
        `skipped(already seeded)=${c.skipped}` +
        (c.createdWarehouse ? ", created Main Warehouse" : "") +
        (c.createdBin ? ", created Main Bin" : ""),
    );
  }
  console.log(
    `Scanned ${orgs.length} org(s), ${totals.orgsWithTracked} with tracked stock: ` +
      `${totals.seededProducts + totals.seededVariants} balance(s) to seed, ${totals.skipped} row(s) already seeded.`,
  );
  if (!apply) {
    console.log("DRY-RUN: nothing written. Re-run with --apply to seed these balances.");
    return;
  }
  console.log(`APPLIED: seeded ${totals.seededProducts} product + ${totals.seededVariants} variant StockBalance row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
