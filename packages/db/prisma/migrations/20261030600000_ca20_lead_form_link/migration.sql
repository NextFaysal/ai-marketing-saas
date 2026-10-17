-- CB5 (Campaign Builder Advanced, CA20) — migration claim
-- 20261030600000 (CB5's third migration).
--
-- CA20: Lead.leadFormId — the form link per-form lead
-- quality was missing. Before this column a leadgen lead
-- recorded its Meta form_id only inside the notes TEXT
-- ("Lead Ads form <id>"), which is not a join key and is
-- never parsed back. The inbox leadgen ingest now stamps
-- the resolved LeadForm record id at creation time.
-- Nullable + additive: every existing lead keeps null
-- (= unattributed coverage in the quality report, stated
-- as such — history is never backfilled by guessing).
ALTER TABLE "Lead" ADD COLUMN "leadFormId" TEXT;
CREATE INDEX "Lead_organizationId_leadFormId_idx" ON "Lead"("organizationId", "leadFormId");
