-- Sales & Data S4: optional contact captured only via the explicit TP.identify hook.
ALTER TABLE "Visitor" ADD COLUMN "email" TEXT;
ALTER TABLE "Visitor" ADD COLUMN "phone" TEXT;
