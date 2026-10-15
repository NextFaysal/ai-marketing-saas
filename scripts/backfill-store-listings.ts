/**
 * Backfill: create StoreListing rows for products that were synced
 * from WooCommerce/Shopify before EC1 introduced per-store listings.
 *
 * The planner (planBackfill) is pure: a product creates a listing
 * only when its organization has EXACTLY ONE store of the matching
 * platform. Zero stores -> skip (no_store); more than one -> skip
 * (ambiguous_stores) because guessing the store would attach the
 * product to the wrong channel; products without a synced source /
 * externalId -> skip (not_synced).
 *
 * Usage (run from the repo root, against YOUR deployment database —
 * this script is intentionally NOT run from the build sandbox):
 *   DATABASE_URL=... npx tsx scripts/backfill-store-listings.ts          # dry-run
 *   DATABASE_URL=... npx tsx scripts/backfill-store-listings.ts --apply  # write
 *
 * Dry-run is the default: it only reports what WOULD be created.
 * Idempotent: --apply uses upsert with update:{} so existing
 * listings are never overwritten.
 */
import { createRequire } from "node:module";
import { planBackfill } from "../apps/api/src/integrations/commerce/backfill-plan";

async function main() {
  const apply = process.argv.includes("--apply");
  if (process.argv.includes("--help")) {
    console.log("Usage: backfill-store-listings.ts [--apply]  (default: dry-run)");
    return;
  }

  // Resolve @prisma/client through packages/db so the script works from
  // the repo-root scripts/ folder (same pattern as packages/db seeds).
  const requireFromDb = createRequire(new URL("../packages/db/package.json", import.meta.url));
  const { PrismaClient } = requireFromDb("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const stores = await prisma.store.findMany({
      select: { id: true, organizationId: true, platform: true },
    });
    const products = await prisma.product.findMany({
      select: { id: true, organizationId: true, source: true, externalId: true, name: true, priceMinor: true, stockQuantity: true, status: true },
    });

    const plan = planBackfill(stores, products);

    console.log(`Scanned ${products.length} product(s) across ${stores.length} store(s); ${plan.creates.length} listing(s) to create.`);
    console.log(`  - skip no_store: ${plan.skips.no_store}`);
    console.log(`  - skip ambiguous_stores: ${plan.skips.ambiguous_stores}`);
    console.log(`  - skip not_synced: ${plan.skips.not_synced}`);
    for (const c of plan.creates.slice(0, 10)) {
      const p = products.find((x: any) => x.id === c.productId);
      console.log(`    e.g. product=${c.productId} name=${p?.name ?? ""} store=${c.storeId} externalId=${c.externalId}`);
    }

    if (!apply) {
      console.log("DRY-RUN: nothing written. Re-run with --apply to create these listings.");
      return;
    }

    let created = 0;
    for (const c of plan.creates) {
      const product = products.find((x: any) => x.id === c.productId);
      const orgId = product?.organizationId;
      if (!orgId) continue;
      await prisma.storeListing.upsert({
        where: { storeId_productId: { storeId: c.storeId, productId: c.productId } },
        create: {
          organizationId: orgId,
          storeId: c.storeId,
          productId: c.productId,
          externalId: c.externalId,
          syncStatus: "synced",
          channelStock: product?.stockQuantity ?? null,
        },
        update: {},
      });
      created++;
    }
    console.log(`APPLIED: upserted ${created} StoreListing row(s) (existing listings untouched).`);
  } finally {
    await prisma.$disconnect();
  }
}

// Run only when executed directly (importing the planner is inert).
if (process.argv[1]?.endsWith("backfill-store-listings.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
