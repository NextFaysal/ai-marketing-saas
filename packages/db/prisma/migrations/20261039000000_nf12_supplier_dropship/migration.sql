-- NF12 (FB4): Supplier portal + Dropship network — the ONLY
-- cross-org design in the schema. SupplierPortalLink stores a
-- SHA-256 token hash only (NF9/OrgInviteLink discipline).
-- Supplier gains portal-editable lead-time fields; PurchaseOrder
-- gains supplier-portal stamps (confirm rides the existing
-- draft→ordered transition; "shipped" is a stamp, never a new
-- status — received stays buyer-only via the receive flow).
-- Dropship: agreement (pending|accepted|declined|revoked) gates
-- EVERYTHING — offers/listings/order links exist only on an
-- accepted agreement (service-enforced, spec-proven). The
-- commission ledger is RECORDS ONLY (OU11 payout legal gate);
-- no wallet table is touched. Money is BIGINT minor units.
-- Hand-written to match schema.prisma exactly.

ALTER TABLE "Supplier" ADD COLUMN "leadTimeDays" INTEGER;
ALTER TABLE "Supplier" ADD COLUMN "leadTimeNote" TEXT;

ALTER TABLE "PurchaseOrder" ADD COLUMN "supplierConfirmedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseOrder" ADD COLUMN "supplierShippedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseOrder" ADD COLUMN "supplierShipNote" TEXT;

CREATE TABLE "SupplierPortalLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPortalLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DropshipAgreement" (
    "id" TEXT NOT NULL,
    "supplierOrgId" TEXT NOT NULL,
    "sellerOrgId" TEXT NOT NULL,
    "invitedByOrgId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdById" TEXT,
    "respondedById" TEXT,
    "respondedAt" TIMESTAMP(3),
    "revokedByOrgId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DropshipAgreement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DropshipOffer" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "floorPriceMinor" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DropshipOffer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DropshipListing" (
    "id" TEXT NOT NULL,
    "sellerOrgId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "sourceProductId" TEXT NOT NULL,
    "sellerProductId" TEXT NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DropshipListing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DropshipOrderLink" (
    "id" TEXT NOT NULL,
    "sellerOrgId" TEXT NOT NULL,
    "supplierOrgId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "sellerOrderId" TEXT NOT NULL,
    "supplierOrderId" TEXT,
    "supplierStatus" TEXT,
    "itemsSnapshot" JSONB,
    "cancelNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DropshipOrderLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DropshipLedgerEntry" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "dropshipOrderLinkId" TEXT NOT NULL,
    "sellerOrgId" TEXT NOT NULL,
    "supplierOrgId" TEXT NOT NULL,
    "retailTotalMinor" BIGINT NOT NULL,
    "wholesaleTotalMinor" BIGINT NOT NULL,
    "marginMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DropshipLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplierPortalLink_supplierId_key" ON "SupplierPortalLink"("supplierId");
CREATE UNIQUE INDEX "SupplierPortalLink_tokenHash_key" ON "SupplierPortalLink"("tokenHash");
CREATE INDEX "SupplierPortalLink_organizationId_supplierId_idx" ON "SupplierPortalLink"("organizationId", "supplierId");

CREATE UNIQUE INDEX "DropshipAgreement_supplierOrgId_sellerOrgId_key" ON "DropshipAgreement"("supplierOrgId", "sellerOrgId");
CREATE INDEX "DropshipAgreement_sellerOrgId_status_idx" ON "DropshipAgreement"("sellerOrgId", "status");
CREATE INDEX "DropshipAgreement_supplierOrgId_status_idx" ON "DropshipAgreement"("supplierOrgId", "status");

CREATE UNIQUE INDEX "DropshipOffer_agreementId_productId_key" ON "DropshipOffer"("agreementId", "productId");
CREATE INDEX "DropshipOffer_organizationId_active_idx" ON "DropshipOffer"("organizationId", "active");

CREATE UNIQUE INDEX "DropshipListing_sellerProductId_key" ON "DropshipListing"("sellerProductId");
CREATE UNIQUE INDEX "DropshipListing_agreementId_sourceProductId_key" ON "DropshipListing"("agreementId", "sourceProductId");
CREATE INDEX "DropshipListing_sellerOrgId_active_idx" ON "DropshipListing"("sellerOrgId", "active");

CREATE UNIQUE INDEX "DropshipOrderLink_sellerOrderId_agreementId_key" ON "DropshipOrderLink"("sellerOrderId", "agreementId");
CREATE INDEX "DropshipOrderLink_sellerOrgId_createdAt_idx" ON "DropshipOrderLink"("sellerOrgId", "createdAt");
CREATE INDEX "DropshipOrderLink_supplierOrgId_createdAt_idx" ON "DropshipOrderLink"("supplierOrgId", "createdAt");

CREATE UNIQUE INDEX "DropshipLedgerEntry_dropshipOrderLinkId_key" ON "DropshipLedgerEntry"("dropshipOrderLinkId");
CREATE INDEX "DropshipLedgerEntry_sellerOrgId_createdAt_idx" ON "DropshipLedgerEntry"("sellerOrgId", "createdAt");
CREATE INDEX "DropshipLedgerEntry_supplierOrgId_createdAt_idx" ON "DropshipLedgerEntry"("supplierOrgId", "createdAt");

ALTER TABLE "SupplierPortalLink" ADD CONSTRAINT "SupplierPortalLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierPortalLink" ADD CONSTRAINT "SupplierPortalLink_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DropshipAgreement" ADD CONSTRAINT "DropshipAgreement_supplierOrgId_fkey" FOREIGN KEY ("supplierOrgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DropshipAgreement" ADD CONSTRAINT "DropshipAgreement_sellerOrgId_fkey" FOREIGN KEY ("sellerOrgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DropshipOffer" ADD CONSTRAINT "DropshipOffer_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "DropshipAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DropshipOffer" ADD CONSTRAINT "DropshipOffer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DropshipOffer" ADD CONSTRAINT "DropshipOffer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DropshipListing" ADD CONSTRAINT "DropshipListing_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "DropshipAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DropshipListing" ADD CONSTRAINT "DropshipListing_sellerOrgId_fkey" FOREIGN KEY ("sellerOrgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DropshipOrderLink" ADD CONSTRAINT "DropshipOrderLink_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "DropshipAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DropshipOrderLink" ADD CONSTRAINT "DropshipOrderLink_sellerOrgId_fkey" FOREIGN KEY ("sellerOrgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DropshipLedgerEntry" ADD CONSTRAINT "DropshipLedgerEntry_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "DropshipAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DropshipLedgerEntry" ADD CONSTRAINT "DropshipLedgerEntry_dropshipOrderLinkId_fkey" FOREIGN KEY ("dropshipOrderLinkId") REFERENCES "DropshipOrderLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DropshipLedgerEntry" ADD CONSTRAINT "DropshipLedgerEntry_sellerOrgId_fkey" FOREIGN KEY ("sellerOrgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
