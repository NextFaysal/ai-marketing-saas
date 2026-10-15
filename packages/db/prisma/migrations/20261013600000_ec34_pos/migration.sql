-- EC34 (POS Quick-Sale): index only. POS sales are ordinary
-- Order rows with source "pos" — no POS-specific tables or
-- columns are needed (payment rides the EC19 PaymentVerification
-- record; stock rides the S1 placement hooks). This index backs
-- the POS page's "today's sales" strip (org + source + day).
-- NOT run on any real DB from the build sandbox; required at deploy.

-- CreateIndex
CREATE INDEX "Order_organizationId_source_createdAt_idx" ON "Order"("organizationId", "source", "createdAt");
