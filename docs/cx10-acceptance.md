# CX10 — Follow-up Timing Settings + Broadcast Fixes: Acceptance

Status: DELIVERED (local commit only, not pushed). Two halves:
per-stage follow-up default intervals for CRM Leads, and a
previous-recipient exclusion + audience preview for Broadcasts.

## Audit corrections (read first — the original brief was wrong)

1. **Follow-ups.** There is NO `ConversationFollowUp` model and
   NO preset/timing system anywhere in the repo. The real
   follow-up system is CRM Leads: `Lead.nextFollowUpAt` was set
   ONLY manually (create/update DTO, CSV import), and consumed by
   the `lead_followup_sweep` job + `crm/lead-followups.ts`. Nothing
   auto-scheduled it per stage. CX10 adds exactly that missing
   piece, on the model that already exists for org CRM settings:
   `CrmSetting` (which previously held only the C5 assignment
   strategy + round-robin cursor).
2. **Broadcasts.** There is NO Telegram broadcast, NO
   `BroadcastStatus`, and NO opt-out store anywhere in the repo.
   The real system is `messaging/messaging.service.ts`:
   `Broadcast {channel: email|sms|whatsapp, audienceType:
   customers|leads_stage|segment}` → `resolveAudience(...)` →
   per-recipient `MessageDelivery` rows. There was NO preview
   endpoint. CX10 adds the exclusion + preview to that system.
3. **Opt-out — stated plainly:** opt-out exclusion has NOTHING to
   exclude from today. No opt-out data exists in this system, so
   CX10 ships NO opt-out flag, NO `excludedOptedOut` field, and no
   dead code pretending otherwise. The exclusion that IS real —
   previous confirmed recipients — is what shipped. If an opt-out
   store is ever built, it plugs into the same shared resolver.

## Part A — Per-stage follow-up defaults

- **Schema/migration** — `CrmSetting.followUpDefaultsByStage Json?`
  (migration `20261012180000_cx10_followup_broadcast`, hand-written
  additive SQL; see Part B for its second column). Shape:
  `{ "new": 24, "contacted": 72, ... }` — Lead stage → hours.
  Null (every existing org) = no defaults.
- **Home** — the setting lives next to its sibling: API
  `GET/PATCH organizations/:id/leads/followup-setting` (PATCH is
  OWNER/ADMIN, mirroring `assignment-setting`), UI a settings card
  on the Leads page directly under the auto-assignment card.
  `CrmSetting` HAD a UI pattern (the assignment card), so the
  section went there rather than inventing a new settings page.
- **Semantics** (pure helper `followUpDefaultFor(setting, stage):
  number | null` + `followUpDateFor`, in `crm/lead-followups.ts`,
  unit-tested):
  - Lead CREATED without an explicit `nextFollowUpAt`, or STAGE
    CHANGES without an explicit `nextFollowUpAt` in the same
    update → stamped `now + hours` for the (new) stage, ONLY when
    a default exists for that stage.
  - Explicit DTO dates ALWAYS win — including an explicit `null`
    (the user's own clear beats a default).
  - No default for the stage → nothing changes: on create the
    value stays null; on stage change the EXISTING value is kept.
    This includes the terminal stages won/lost: if a default
    exists it is used like any stage; if none exists, a stage
    change does NOT clear an existing follow-up. Chosen
    deliberately — silently deleting a date the user set would be
    surprising data loss, and the follow-up board already hides
    won/lost leads, so a kept date is inert, not noisy.
  - No settings at all → behaviour EXACTLY as before CX10 (the
    read is defensive: a missing row/table reads as "no
    defaults", the same pattern LeadAssignmentService uses).
  - Ingestion paths that create Lead rows directly via Prisma
    (Meta leadgen, first-message, webchat) do NOT pass through
    `LeadsService.create` and are unchanged; the defaults apply to
    the service paths (manual create, CSV import, API updates).
- **CSV importer** — it passes each row's parsed
  `next_follow_up_at` through `this.create(...)`, so an explicit
  CSV date wins automatically (spec-proven). A dateless CSV row
  follows the ordinary create rule above (its stage's default
  applies) — that is the create semantics, not an importer
  special case.
- **Validation** (settings write path, strict twin
  `validateFollowUpDefaults`; the read path is lenient and drops
  corrupt entries to "no default"): stage keys must be valid
  `LEAD_STAGES`; hours must be integers 1..8760 (1h..1y); a null
  value for a stage means "no default for this stage". Violations
  are Bengali 400s naming the vocabulary, matching the CRM
  endpoints' honest-error style. `{}`/null clears all defaults.
  The upsert touches ONLY `followUpDefaultsByStage` — the
  assignment strategy/cursor on the same row are never clobbered
  (spec-proven).
- **Web** — one numeric input per stage with the Bengali labels
  নতুন / যোগাযোগ হয়েছে / যোগ্য / প্রস্তাব পাঠানো হয়েছে /
  জিতেছে (Won) / হারিয়েছে (Lost), helper text "খালি =
  স্বয়ংক্রিয় ফলোআপ নেই" plus the explicit-wins and
  no-silent-clear rules spelled out under the inputs.

## Part B — Broadcast exclusion + preview

- **Schema** — `Broadcast.excludePreviousRecipients Boolean
  @default(false)` in the SAME migration
  (`20261012180000_cx10_followup_broadcast`). The create DTO
  accepts it; A/B variants inherit it via the shared base objects
  for both the email/sms and WhatsApp paths (spec-proven).
- **ONE shared resolver** —
  `resolveBroadcastRecipients(orgId, {channel, audienceType,
  audienceStage, audienceSegment, excludePreviousRecipients}) →
  {recipients, audienceTotal, excludedPreviousCount}`.
  `sendBroadcast` uses it (A/B split, kill-switch, caps and the
  status flow are untouched, applied AFTER resolution exactly as
  before) and the preview endpoint uses it — so the preview IS
  the send set, spec-proven by running the same fixture through
  both paths and comparing recipient sets. Note: with the flag
  on, `totalRecipients` now means the FINAL post-exclusion count
  (it stores `recipients.length`, as it always did).
- **Exclusion rule** — drop a recipient whose
  `(recipientType, recipientId)` has a `MessageDelivery` with
  `organizationId = org`, `broadcastId != null`,
  `status = "sent"`: a previous CONFIRMED send.
  - Failed deliveries do NOT exclude — the person never got it.
  - **Channel decision:** ANY earlier broadcast of this org
    counts, regardless of channel. Rationale: the person already
    heard from this org; the channel is a delivery detail, not a
    separate relationship. Flagged here as a deliberate choice.
  - Workflow sends (`broadcastId` null) never exclude — this is a
    broadcast-to-broadcast rule.
  - Other orgs' deliveries never exclude (org-scoped query).
- **Preview endpoint** — `POST
  organizations/:organizationId/messaging/broadcasts/preview`,
  WRITE_ROLES (OWNER/ADMIN/MARKETING_MANAGER, same as create),
  body `{channel, audienceType, audienceStage?, audienceSegment?,
  excludePreviousRecipients?}` → `{audienceTotal,
  excludedPreviousCount, total, sample}`. `sample` = first 20 of
  the FINAL set as `{type, name, address}` with the address
  MASKED (email → first char + `***@` + domain; phone → first 3 +
  `***` + last 2, e.g. `017***78`). Never a full address, never a
  recipient id — the spec asserts both by scanning the serialized
  payload against every fixture address/id.
- **Web** (messaging page create form) — an "আগের Broadcast-এর
  প্রাপকদের বাদ দিন" checkbox (default UNCHECKED), a "👁️ প্রাপক
  প্রিভিউ" button that previews the CURRENT form values before
  any broadcast exists, showing মোট দর্শক / বাদ পড়েছে (আগের
  প্রাপক) / চূড়ান্ত প্রাপক + the masked sample list. Saved
  broadcasts with the flag show "আগের প্রাপক বাদ দেওয়া" in the
  list. The send flow itself is unchanged for the user.

## Verification

- New specs: `crm/cx10-followup-defaults.spec.ts` (20 tests) +
  `messaging/cx10-broadcast-preview.spec.ts` (9 tests) —
  **29/29 pass**: helper matrix (no setting / stage present /
  absent / terminal stages / corrupt values), create stamped vs
  explicit-wins vs no-default, stage-change matrix (incl.
  explicit-null clear and no-silent-clear on lost), invalid
  settings rejected, non-clobbering upsert, tenant isolation,
  CSV explicit-date proof; resolver exclusion math (sent
  excludes, failed doesn't, other org doesn't, other channel
  does, workflow sends don't), flag-off = zero exclusion,
  preview==send set identity, sample cap 20 + masking shapes +
  no-full-address/no-id payload scan, counts arithmetic, A/B
  split sums to the final set.
- Targeted suites: crm + messaging **119/119 (12 suites)**,
  automation **70/70 (11 suites)** — all green.
- API `tsc --noEmit`: zero errors in CX10 files; the only error
  anywhere is the pre-existing parallel-track AG1
  `webchat.service.ts` TS2304 (`parseCourierCard`) — by path
  only, untouched.
- Web: vitest **96/96**; `tsc --noEmit` errors ONLY in the
  parallel track's `automations/page.tsx` (its deleted lib
  files) — messaging/leads pages type-clean.

## Ceilings (stated plainly)

- The migration is WRITTEN, NOT APPLIED — the sandbox has no
  Postgres. It applies with the other pending CX migrations at
  deploy time.
- Exclusion history is only as old as the `MessageDelivery`
  table: broadcasts sent before deliveries were recorded are not
  visible to the rule. The resolver reads at most the latest
  10,000 confirmed broadcast deliveries per send/preview
  (audience caps are 1,000/send, so this is headroom, not a
  practical limit today).
- No live send or live tenant data was exercised; proof is the
  fake-prisma/provider spec harness, the same ceiling as the
  rest of the CX batches.
