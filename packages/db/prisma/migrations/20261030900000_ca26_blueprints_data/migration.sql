-- Campaign Builder Advanced CA26 (CB6): blueprint
-- definitions move from code constants to data.
-- Platform rows (organizationId NULL) are seeded below
-- with the EXACT definitions the constants carried —
-- generated from the code seed source (BLUEPRINTS in
-- campaigns.service.ts); a spec re-derives the JSON and
-- asserts it appears verbatim in this file, so the two
-- can never silently drift. Instantiation reads these
-- rows; the constants remain only as the seed source.
CREATE TABLE "CampaignBlueprint" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "advantagePlus" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL,
    "adSet" JSONB NOT NULL,
    "ad" JSONB NOT NULL,
    "organizationId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "category" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignBlueprint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CampaignBlueprint_key_idx" ON "CampaignBlueprint"("key");
CREATE INDEX "CampaignBlueprint_organizationId_idx" ON "CampaignBlueprint"("organizationId");

INSERT INTO "CampaignBlueprint" ("id", "key", "name", "objective", "advantagePlus", "description", "adSet", "ad", "organizationId", "version", "category", "tags", "createdAt", "updatedAt") SELECT gen_random_uuid(), 'advantage_plus_sales', 'Advantage+ Sales (Meta AI)', 'OUTCOME_SALES', true, 'Meta এর Advantage+ Sales: বাজেট ক্যাম্পেইন পর্যায়ে, Audience সম্প্রসারণে Meta এর AI। বিস্তৃত টার্গেটিং রাখুন — সংকীর্ণ Interest Advantage+ এর বিরুদ্ধে যায়। বাজেটটি শুরুর মান, নিজে ঠিক করে নিন।', '{"name":"BD Broad (Advantage+)","dailyBudget":"500","optimizationGoal":"OFFSITE_CONVERSIONS","countries":["BD"],"ageMin":18,"ageMax":65}'::jsonb, '{"name":"Advantage+ Ad","primaryText":"সারা দেশে হোম ডেলিভারি। অর্ডার করতে লিংকে ক্লিক করুন।","headline":"এখনই অর্ডার করুন","linkUrl":"https://example.com/product","callToAction":"SHOP_NOW"}'::jsonb, NULL, 1, NULL, ARRAY[]::TEXT[], now(), now() WHERE NOT EXISTS (SELECT 1 FROM "CampaignBlueprint" WHERE "key" = 'advantage_plus_sales' AND "organizationId" IS NULL);
INSERT INTO "CampaignBlueprint" ("id", "key", "name", "objective", "advantagePlus", "description", "adSet", "ad", "organizationId", "version", "category", "tags", "createdAt", "updatedAt") SELECT gen_random_uuid(), 'cod_sales', 'COD Sales (বাংলাদেশ)', 'OUTCOME_SALES', false, 'ক্যাশ অন ডেলিভারি বিক্রির জন্য ওয়েবসাইট কনভার্সন ক্যাম্পেইন। বাজেটটি শুরুর মান, নিজে ঠিক করে নিন।', '{"name":"BD Broad 18-65","dailyBudget":"500","optimizationGoal":"OFFSITE_CONVERSIONS","countries":["BD"],"ageMin":18,"ageMax":65}'::jsonb, '{"name":"Sales Ad","primaryText":"সারা দেশে ক্যাশ অন ডেলিভারি। অর্ডার করতে লিংকে ক্লিক করুন।","headline":"এখনই অর্ডার করুন","linkUrl":"https://example.com/product","callToAction":"SHOP_NOW"}'::jsonb, NULL, 1, NULL, ARRAY[]::TEXT[], now(), now() WHERE NOT EXISTS (SELECT 1 FROM "CampaignBlueprint" WHERE "key" = 'cod_sales' AND "organizationId" IS NULL);
INSERT INTO "CampaignBlueprint" ("id", "key", "name", "objective", "advantagePlus", "description", "adSet", "ad", "organizationId", "version", "category", "tags", "createdAt", "updatedAt") SELECT gen_random_uuid(), 'ctwa', 'Click to WhatsApp (Link Ad)', 'OUTCOME_ENGAGEMENT', false, 'এটি একটি সাধারণ Link Ad (wa.me লিংক) — আসল Click-to-WhatsApp Destination নয়। আসল CTWA পেতে Ad Set-এ WhatsApp Destination বাছাই করুন (CN13): সেখানে নম্বরটি Organization-এর Connected WhatsApp থেকে আসে এবং Publish Meta-তে destination_type=WHATSAPP পাঠায়। এই Blueprint-এর কথোপকথনও ইনবক্সে আসে, সেখান থেকে অর্ডার করা যায়।', '{"name":"BD WhatsApp","dailyBudget":"300","optimizationGoal":"LINK_CLICKS","countries":["BD"],"ageMin":18,"ageMax":55}'::jsonb, '{"name":"Chat Ad","primaryText":"যেকোনো প্রশ্নে WhatsApp এ মেসেজ করুন, আমরা সাথে সাথে উত্তর দেব।","headline":"WhatsApp এ অর্ডার করুন","linkUrl":"https://wa.me/8801700000000","callToAction":"SEND_WHATSAPP_MESSAGE"}'::jsonb, NULL, 1, NULL, ARRAY[]::TEXT[], now(), now() WHERE NOT EXISTS (SELECT 1 FROM "CampaignBlueprint" WHERE "key" = 'ctwa' AND "organizationId" IS NULL);
INSERT INTO "CampaignBlueprint" ("id", "key", "name", "objective", "advantagePlus", "description", "adSet", "ad", "organizationId", "version", "category", "tags", "createdAt", "updatedAt") SELECT gen_random_uuid(), 'catalog_sales', 'Catalog Sales (Advantage ধাঁচের)', 'OUTCOME_SALES', false, 'ক্যাটালগের পণ্য দিয়ে বিক্রির ক্যাম্পেইন কাঠামো। CN3 থেকে Ad Set-এ Catalog + Product Set বাছাই করলেই Publish আসল product_set_id পাঠায় (Set টি আগে Catalogs পেজ থেকে Meta-তে Publish করা থাকতে হবে)। বাজেট শুরুর মান।', '{"name":"BD Catalog Broad","dailyBudget":"500","optimizationGoal":"OFFSITE_CONVERSIONS","countries":["BD"],"ageMin":18,"ageMax":65}'::jsonb, '{"name":"Catalog Ad","primaryText":"আমাদের কালেকশন দেখুন — সারা দেশে ক্যাশ অন ডেলিভারি।","headline":"কালেকশন দেখুন","linkUrl":"https://example.com","callToAction":"SHOP_NOW"}'::jsonb, NULL, 1, NULL, ARRAY[]::TEXT[], now(), now() WHERE NOT EXISTS (SELECT 1 FROM "CampaignBlueprint" WHERE "key" = 'catalog_sales' AND "organizationId" IS NULL);
INSERT INTO "CampaignBlueprint" ("id", "key", "name", "objective", "advantagePlus", "description", "adSet", "ad", "organizationId", "version", "category", "tags", "createdAt", "updatedAt") SELECT gen_random_uuid(), 'lead_form', 'Lead Form', 'OUTCOME_LEADS', false, 'Facebook লিড ফর্মের জন্য ক্যাম্পেইন কাঠামো। CN4 থেকে Form Builder-এই বানিয়ে Ad Set-এ যুক্ত করুন — Publish-এর সময় ফর্মটি Meta-তে তৈরি হয়, আর লিড এলে Form-এর Field Mapping অনুযায়ী CRM Lead-এ বসে।', '{"name":"BD Leads","dailyBudget":"300","optimizationGoal":"LEAD_GENERATION","countries":["BD"],"ageMin":20,"ageMax":60}'::jsonb, '{"name":"Lead Ad","primaryText":"আগ্রহী হলে ফর্মটি পূরণ করুন, আমাদের টিম যোগাযোগ করবে।","headline":"ফর্মটি পূরণ করুন","linkUrl":"https://example.com","callToAction":"SIGN_UP"}'::jsonb, NULL, 1, NULL, ARRAY[]::TEXT[], now(), now() WHERE NOT EXISTS (SELECT 1 FROM "CampaignBlueprint" WHERE "key" = 'lead_form' AND "organizationId" IS NULL);
