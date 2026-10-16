-- AB2 (AX3 Gift Cards):
--  * Product.isGiftCard + giftCardConfig: a flagged product sells
--    stored value (preset/custom face amounts in the config Json,
--    validated at save). Gift-card lines carry no stock semantics.
--  * StoreCartItem.giftCardAmountMinor / giftCardRecipient: the
--    buyer's chosen face value + optional recipient, recorded at
--    placement as a GiftCardIssuance intent.
--  * GiftCardIssuance: one intent per gift-card ORDER LINE
--    (orderItemId UNIQUE = the exactly-once recording claim).
--  * GiftCard: the bearer instrument. The full code exists ONLY
--    as codeHash (SHA-256 lookup) + codeSealed (AES-256-GCM via
--    integrations/crypto) — never plaintext. balanceCache is
--    maintained ONLY by GiftCardService in the same transaction
--    as the GiftCardLedger write. (issuedOrderItemId, unitIndex)
--    UNIQUE is the exactly-once issuance claim (quantity N on a
--    line mints unitIndex 0..N-1; NULL item ids — manual issues —
--    never collide in Postgres unique semantics).
--  * GiftCardLedger: the balance truth (issue | redeem | restore
--    | adjust | void | expire). Exactly-once for issue (per card)
--    and redeem (per card + order) is a PARTIAL unique index
--    (Prisma cannot express those) — the service checks first,
--    the index is the backstop.
--  * GiftCardSetting: redemption kill-switch (DEFAULT true) +
--    default expiry days.
-- All additive. NOT run on any real DB from the build sandbox;
-- required at deploy. The gift_card_expiry_sweep job needs
-- per-org enablement after deploy.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "isGiftCard" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "giftCardConfig" JSONB;

-- AlterTable
ALTER TABLE "StoreCartItem" ADD COLUMN "giftCardAmountMinor" BIGINT,
ADD COLUMN "giftCardRecipient" JSONB;

-- CreateTable
CREATE TABLE "GiftCardSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "redemptionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultExpiryDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftCardSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCardIssuance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "recipientName" TEXT,
    "recipientEmail" TEXT,
    "recipientPhone" TEXT,
    "recipientMessage" TEXT,
    "issuedAt" TIMESTAMP(3),
    "sentVia" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftCardIssuance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCard" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeSealed" TEXT NOT NULL,
    "codePrefix" TEXT NOT NULL DEFAULT 'QG',
    "codeLast4" TEXT NOT NULL,
    "initialAmountMinor" BIGINT NOT NULL,
    "balanceCache" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "status" TEXT NOT NULL DEFAULT 'active',
    "buyerCustomerId" TEXT,
    "recipientName" TEXT,
    "recipientEmail" TEXT,
    "recipientPhone" TEXT,
    "recipientMessage" TEXT,
    "issuedOrderId" TEXT,
    "issuedOrderItemId" TEXT,
    "unitIndex" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'purchase',
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCardLedger" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "giftCardId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "deltaMinor" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "orderId" TEXT,
    "createdById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftCardLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GiftCardSetting_organizationId_key" ON "GiftCardSetting"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCardIssuance_orderItemId_key" ON "GiftCardIssuance"("orderItemId");

-- CreateIndex
CREATE INDEX "GiftCardIssuance_organizationId_orderId_idx" ON "GiftCardIssuance"("organizationId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_issuedOrderItemId_unitIndex_key" ON "GiftCard"("issuedOrderItemId", "unitIndex");

-- CreateIndex
CREATE INDEX "GiftCard_organizationId_codeHash_idx" ON "GiftCard"("organizationId", "codeHash");

-- CreateIndex
CREATE INDEX "GiftCard_organizationId_status_idx" ON "GiftCard"("organizationId", "status");

-- CreateIndex
CREATE INDEX "GiftCard_organizationId_issuedOrderId_idx" ON "GiftCard"("organizationId", "issuedOrderId");

-- CreateIndex
CREATE INDEX "GiftCard_organizationId_codeLast4_idx" ON "GiftCard"("organizationId", "codeLast4");

-- CreateIndex
CREATE INDEX "GiftCardLedger_organizationId_giftCardId_createdAt_idx" ON "GiftCardLedger"("organizationId", "giftCardId", "createdAt");

-- CreateIndex
CREATE INDEX "GiftCardLedger_organizationId_orderId_idx" ON "GiftCardLedger"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "GiftCardLedger_organizationId_kind_createdAt_idx" ON "GiftCardLedger"("organizationId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "GiftCardSetting" ADD CONSTRAINT "GiftCardSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardIssuance" ADD CONSTRAINT "GiftCardIssuance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardLedger" ADD CONSTRAINT "GiftCardLedger_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardLedger" ADD CONSTRAINT "GiftCardLedger_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AB2 exactly-once claims (partial unique indexes — raw SQL by
-- design; prisma migrate diff will report them as drift noise,
-- like the AB1 indexes).
CREATE UNIQUE INDEX "GiftCardLedger_issue_once_per_card" ON "GiftCardLedger" ("giftCardId") WHERE "kind" = 'issue';
CREATE UNIQUE INDEX "GiftCardLedger_redeem_once_per_card_order" ON "GiftCardLedger" ("giftCardId", "orderId") WHERE "kind" = 'redeem' AND "orderId" IS NOT NULL;
