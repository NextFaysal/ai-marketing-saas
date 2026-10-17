-- NF14 (FB5): Branded customer app — app-only offers.
-- StoreDiscount.appOnly is a DISPLAY rule only: when true, the
-- public storefront surfaces the offer only inside the shop's
-- installed app (standalone display mode). Discount evaluation
-- never reads the flag — a shared code still redeems normally.
-- Hand-written to match schema.prisma exactly.

ALTER TABLE "StoreDiscount" ADD COLUMN "appOnly" BOOLEAN NOT NULL DEFAULT false;
