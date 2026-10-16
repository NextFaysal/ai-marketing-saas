-- AB3 (AX4 Multi-Warehouse Stock):
--  * StockBalance: the per-bin stock truth. onHand is one
--    bin's share of the org-global counter — for every TRACKED
--    row, Σ onHand over all bins == Product.stockQuantity (or
--    ProductVariant.stockQuantity). reserved is a maintained
--    counter (Σ of the bin's active, unexpired reservations),
--    NOT part of the onHand invariant. Uniqueness per
--    (organizationId, productId, variantId, binId) is enforced
--    by TWO PARTIAL unique indexes below (SQL NULL semantics —
--    a plain unique index treats NULL variantIds as distinct),
--    so the Prisma schema declares NO @@unique for it.
--  * StockAllocation: the CURRENT claim state of an order's
--    deduction — which bins its already-deducted units are
--    attributed to. Settled on restore; moved (never
--    duplicated) by split/merge and staff re-allocation.
--    Bundle components carry orderItemId NULL.
--  * StockTransfer / StockTransferLine: bin-to-bin transfers.
--    In-transit quantities live ONLY on the lines (in neither
--    balance); transfers never touch the global counter.
--  * StockMovement.binId / StockReservation.binId: plain
--    nullable columns (no FK, like their sibling id columns);
--    null = pre-AB3 row / no bin attribution.
--  * Warehouse.priority + serviceDistricts: the allocation
--    ordering inputs (district match → priority ASC →
--    isDefault → createdAt; design §4.2).
--  * BACKFILL (design §4.3): one StockBalance per tracked
--    Product / ProductVariant row at its resolved default bin
--    (assignment in the default warehouse first, else the
--    earliest assignment, else the default warehouse's
--    earliest bin), creating 'Main Warehouse' / 'Main Bin'
--    lazily for orgs that have tracked stock but no
--    warehouse / no bin in the chosen default warehouse.
--    No-op on an empty DB (every INSERT selects zero rows).
-- All additive. NOT run on any real DB from the build sandbox;
-- required at deploy. The deploy-runnable twin of the backfill
-- is apps/api/scripts/backfill-stock-balances.mjs.

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN "binId" TEXT;

-- AlterTable
ALTER TABLE "StockReservation" ADD COLUMN "binId" TEXT;

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "serviceDistricts" JSONB;

-- CreateTable
CREATE TABLE "StockBalance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "binId" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAllocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "binId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromBinId" TEXT NOT NULL,
    "toBinId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdById" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferLine" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "qtySent" INTEGER NOT NULL,
    "qtyReceived" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockTransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockBalance_organizationId_productId_variantId_idx" ON "StockBalance"("organizationId", "productId", "variantId");

-- CreateIndex
CREATE INDEX "StockBalance_binId_idx" ON "StockBalance"("binId");

-- CreateIndex
CREATE INDEX "StockAllocation_orderId_idx" ON "StockAllocation"("orderId");

-- CreateIndex
CREATE INDEX "StockAllocation_organizationId_productId_idx" ON "StockAllocation"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "StockTransfer_organizationId_status_idx" ON "StockTransfer"("organizationId", "status");

-- CreateIndex
CREATE INDEX "StockTransfer_fromBinId_idx" ON "StockTransfer"("fromBinId");

-- CreateIndex
CREATE INDEX "StockTransfer_toBinId_idx" ON "StockTransfer"("toBinId");

-- CreateIndex
CREATE INDEX "StockTransferLine_transferId_idx" ON "StockTransferLine"("transferId");

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_binId_fkey" FOREIGN KEY ("binId") REFERENCES "BinLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAllocation" ADD CONSTRAINT "StockAllocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAllocation" ADD CONSTRAINT "StockAllocation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAllocation" ADD CONSTRAINT "StockAllocation_binId_fkey" FOREIGN KEY ("binId") REFERENCES "BinLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAllocation" ADD CONSTRAINT "StockAllocation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_fromBinId_fkey" FOREIGN KEY ("fromBinId") REFERENCES "BinLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_toBinId_fkey" FOREIGN KEY ("toBinId") REFERENCES "BinLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AB3 per-location uniqueness (partial unique indexes — raw
-- SQL by design; prisma migrate diff will report them as drift
-- noise, like the AB1/AB2 indexes). Together they make
-- (organizationId, productId, variantId, binId) unique with
-- correct NULL semantics: the variant form covers rows WITH a
-- variant, the product form covers product-level rows.
CREATE UNIQUE INDEX "StockBalance_org_product_variant_bin_key" ON "StockBalance" ("organizationId", "productId", "variantId", "binId") WHERE "variantId" IS NOT NULL;
CREATE UNIQUE INDEX "StockBalance_org_product_bin_key" ON "StockBalance" ("organizationId", "productId", "binId") WHERE "variantId" IS NULL;

-- ----------------------------------------------------------------
-- AB3 BACKFILL (design §4.1 resolver + §4.3 rule, in SQL).
-- "Tracked" = stockQuantity IS NOT NULL (null = untracked; the
-- row is skipped and never gains a balance row). "Chosen
-- default warehouse" per org = isDefault first, else earliest
-- createdAt (id breaks ties deterministically). gen_random_uuid()
-- is core since Postgres 13.
-- ----------------------------------------------------------------

-- Step 1: orgs with tracked stock but NO warehouse at all get
-- a 'Main Warehouse' (isDefault). Orgs without tracked stock
-- are left completely untouched.
INSERT INTO "Warehouse" ("id", "organizationId", "name", "address", "isDefault", "active", "priority", "serviceDistricts", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o."id", 'Main Warehouse', NULL, true, true, 0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o
WHERE NOT EXISTS (
        SELECT 1 FROM "Warehouse" w WHERE w."organizationId" = o."id"
    )
    AND (
        EXISTS (
            SELECT 1 FROM "Product" p
            WHERE p."organizationId" = o."id" AND p."stockQuantity" IS NOT NULL
        )
        OR EXISTS (
            SELECT 1 FROM "ProductVariant" v
            JOIN "Product" p ON p."id" = v."productId"
            WHERE p."organizationId" = o."id" AND v."stockQuantity" IS NOT NULL
        )
    );

-- Step 2: the chosen default warehouse of every org with
-- tracked stock gets a 'Main Bin' (code 'MAIN') when it has NO
-- bins at all — including a warehouse just created in Step 1.
-- (BinLocation's UNIQUE (warehouseId, code) cannot collide:
-- the warehouse has zero bins.) Rows whose bin resolves via a
-- ProductBinAssignment never use this bin; it exists so the
-- fallback in Steps 3–4 always has a bin to land on.
INSERT INTO "BinLocation" ("id", "organizationId", "warehouseId", "code", "note", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, dw."organizationId", dw."id", 'MAIN', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT ON (w."organizationId") w."id", w."organizationId"
    FROM "Warehouse" w
    WHERE EXISTS (
            SELECT 1 FROM "Product" p
            WHERE p."organizationId" = w."organizationId" AND p."stockQuantity" IS NOT NULL
        )
        OR EXISTS (
            SELECT 1 FROM "ProductVariant" v
            JOIN "Product" p ON p."id" = v."productId"
            WHERE p."organizationId" = w."organizationId" AND v."stockQuantity" IS NOT NULL
        )
    ORDER BY w."organizationId", w."isDefault" DESC, w."createdAt" ASC, w."id" ASC
) dw
WHERE NOT EXISTS (
    SELECT 1 FROM "BinLocation" b WHERE b."warehouseId" = dw."id"
);

-- Step 3: one StockBalance per tracked PRODUCT row
-- (variantId NULL), onHand = the global counter, reserved = 0,
-- at the resolved default bin:
--   (a) a ProductBinAssignment for (product, variant NULL) in
--       a default warehouse of the org — earliest such
--       assignment (the assignment names the exact bin, even
--       when its warehouse holds many bins);
--   (b) else the earliest assignment for (product, NULL) in
--       any of the org's warehouses;
--   (c) else the earliest bin of the chosen default warehouse.
INSERT INTO "StockBalance" ("id", "organizationId", "productId", "variantId", "binId", "onHand", "reserved", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p."organizationId", p."id", NULL, r."binId", p."stockQuantity", 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Product" p
CROSS JOIN LATERAL (
    SELECT COALESCE(
        (
            SELECT a."binLocationId"
            FROM "ProductBinAssignment" a
            JOIN "Warehouse" w ON w."id" = a."warehouseId" AND w."organizationId" = p."organizationId"
            WHERE a."organizationId" = p."organizationId"
                AND a."productId" = p."id"
                AND a."variantId" IS NULL
                AND w."isDefault" = true
            ORDER BY a."createdAt" ASC, a."id" ASC
            LIMIT 1
        ),
        (
            SELECT a."binLocationId"
            FROM "ProductBinAssignment" a
            WHERE a."organizationId" = p."organizationId"
                AND a."productId" = p."id"
                AND a."variantId" IS NULL
            ORDER BY a."createdAt" ASC, a."id" ASC
            LIMIT 1
        ),
        (
            SELECT b."id"
            FROM "BinLocation" b
            WHERE b."warehouseId" = (
                SELECT w2."id"
                FROM "Warehouse" w2
                WHERE w2."organizationId" = p."organizationId"
                ORDER BY w2."isDefault" DESC, w2."createdAt" ASC, w2."id" ASC
                LIMIT 1
            )
            ORDER BY b."createdAt" ASC, b."id" ASC
            LIMIT 1
        )
    ) AS "binId"
) r
WHERE p."stockQuantity" IS NOT NULL
    AND r."binId" IS NOT NULL;

-- Step 4: one StockBalance per tracked PRODUCT VARIANT row
-- (variantId set), same resolver keyed on (product, variant).
INSERT INTO "StockBalance" ("id", "organizationId", "productId", "variantId", "binId", "onHand", "reserved", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p."organizationId", v."productId", v."id", r."binId", v."stockQuantity", 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ProductVariant" v
JOIN "Product" p ON p."id" = v."productId"
CROSS JOIN LATERAL (
    SELECT COALESCE(
        (
            SELECT a."binLocationId"
            FROM "ProductBinAssignment" a
            JOIN "Warehouse" w ON w."id" = a."warehouseId" AND w."organizationId" = p."organizationId"
            WHERE a."organizationId" = p."organizationId"
                AND a."productId" = v."productId"
                AND a."variantId" = v."id"
                AND w."isDefault" = true
            ORDER BY a."createdAt" ASC, a."id" ASC
            LIMIT 1
        ),
        (
            SELECT a."binLocationId"
            FROM "ProductBinAssignment" a
            WHERE a."organizationId" = p."organizationId"
                AND a."productId" = v."productId"
                AND a."variantId" = v."id"
            ORDER BY a."createdAt" ASC, a."id" ASC
            LIMIT 1
        ),
        (
            SELECT b."id"
            FROM "BinLocation" b
            WHERE b."warehouseId" = (
                SELECT w2."id"
                FROM "Warehouse" w2
                WHERE w2."organizationId" = p."organizationId"
                ORDER BY w2."isDefault" DESC, w2."createdAt" ASC, w2."id" ASC
                LIMIT 1
            )
            ORDER BY b."createdAt" ASC, b."id" ASC
            LIMIT 1
        )
    ) AS "binId"
) r
WHERE v."stockQuantity" IS NOT NULL
    AND r."binId" IS NOT NULL;
