# Campaign Builder Frontier — Program Summary (CN13–CN18, 2026-10-15)

**THE CAMPAIGN BUILDER FRONTIER PACKAGE IS CODE-COMPLETE
in the sandbox (spec/fixture-proven). NOTHING in it is
live-proven against a real Meta / Google / TikTok
account.**

Owner approved the whole Frontier package (CN13–CN18) in
full 2026-10-15 08:50 +06 ("পুরো Frontier (CN13–CN18)
অনুমোদন — NB6 থেকে শুরু করো"), on top of the code-complete
CN1–CN12 program (`docs/campaign-builder-next-summary.md`).
Plan:
`~/workspace/goals/ai-marketing-saas-platform-build/files/Campaign-Builder-Frontier-Plan-2026-10-15.md`.
Built in worktree `~/workspace/ai-marketing-saas-cn`,
branch `campaign-next`, continuing from the CN close
`330ce80`. **Local commits only — NOTHING pushed**
(owner's push rule). Every Frontier item was spike-first:
the documented API path had to be confirmed before
building, and anything unconfirmable shipped as an honest
blocked/export state — the rule that produced a real
correction in every batch (below).

**Standing warning, restated:** the Frontier builds on
CN1–CN12 mappings that are themselves not yet live-proven
(CN12's 27-item checklist is entirely unchecked). The
owner chose this order knowingly; the rework risk if a
live session contradicts a mapping sits in the readiness
layers, which is where each correction below landed.

## Item-by-item audit

| Item | Scope | Status | Batch / acceptance |
|---|---|---|---|
| CN13 | Real Click-to-WhatsApp ads: destination bound to a CONNECTED WhatsApp Integration (number read back from Meta at save — null when Meta won't return digits, never invented), CTWA creative + `page_welcome_message`, readiness by connection state, conversation reporting in the builder matched by `ctwaSourceId` and labelled conversations-STARTED (first-message referral), not messages. **Spike correction:** Meta's CTWA guide gives `destination_type` = `"WHATSAPP"`, NOT the plan draft's `ON_WHATSAPP`; `OFFSITE_CONVERSIONS` deliberately excluded (no pixel field on the WA promoted object — sales are measured via the CN14 loop) | ✅ code-complete | NB6 · `campaign-builder-nb6-acceptance.md` |
| CN14 | Conversion feedback loops: (a) Meta offline conversions on the DATASET Conversions API (the legacy Offline Conversions API is **DISCONTINUED** — event-set creation ended May 2024, API ended May 2025 → NO-BUILD on that path), `system_generated` Purchase with a deterministic `purchase-{orderKey}` `event_id` shared with ConversionsService + CAPI-log dedup (already-delivered = recorded skip, zero double-send); (b) order-lifecycle auto-triggers (placed / cod_confirmed / delivered) on the platform's domain-event bus, per-org setting the only gate, failure isolation PROVEN through the real `OrdersService.updateOrder` (the order completes while the upload throws; the failure lands in the log); (c) lead-quality feedback CONFIRMED via the Conversion Leads payload (stage as event name, numeric lead_id, crm custom_data), setting-gated, never blocks CRM | ✅ code-complete | NB6 · nb6 acceptance |
| CN15 | Meta Experiments (Ad Studies): **spike CONFIRMED** from Meta's Ad Study guide + Graph API v25.0 `Business/ad_studies` + Meta's catalogue-of-api-solutions — the real study path is built, the local split-run fallback was NOT needed. Study creation on the BUSINESS node (`POST /{business_id}/ad_studies`, `type=SPLIT_TEST`); business id resolved from the account (no business = honest refusal, no row, Meta's message verbatim); cells require already-published campaigns, so both variants publish PAUSED through the normal spine first; read-back stores/returns Meta's payload VERBATIM — winner/confidence are Meta's, the platform never computes significance (spec pins that no `winnerPlanId` exists in our payload) | ✅ code-complete | NB7 · `campaign-builder-nb7-acceptance.md` |
| CN16 | Full-funnel plans + recurring series: the wizard composes ONE plan (shared CN2 budget/cap) with three LABELLED layers (prospecting / retargeting / retention) riding the existing create paths + AudiencesService — missing source data produces an INCOMPLETE ad set with a readiness error, never a dropped or fabricated layer; layers are ordinary ad sets afterwards. Series: weekly / monthly / explicit date list with anchor-based date math (Jan 31 → Feb 28 → Mar 31 clamp rule, spec-pinned); a CB5-discipline sweep creates exactly ONE pending DRAFT instance inside the lead window (full-field clone) and generation HOLDS, visibly, while a prior draft sits unapproved; a series never publishes — every instance walks the full approval flow | ✅ code-complete | NB7 · nb7 acceptance |
| CN17 | Native platform depth: Google Performance Max as a plan target (`CrossPlatformDraft.kind = "pmax"`, fields = exactly the existing `publishGooglePmax` contract; keywords / video / audience signals listed as not-carried, never dropped; per-type budget = the plan's effective daily figure) + TikTok objective choice in the plan/draft path ONLY (`objectiveType` stored; **spike:** the current API enum is `WEB_CONVERSIONS`, pixel + event required on the ad group with CONVERT/OCPM; a pixel on TRAFFIC is refused because TikTok rejects it; LEAD_GENERATION is stored but refused with the Instant Form reason — no form-binding path exists in this flow). The direct publishing page's behaviour is byte-identical (spec-pinned) | ✅ code-complete (with the stated LEAD_GENERATION limitation) | NB8 · `campaign-builder-nb8-acceptance.md` |
| CN18 | Insights & sharing: (1) Budget simulator — deterministic, the org's OWN last-90-day metrics by objective (median + nearest-rank quartile ranges, method + sample labelled verbatim); spec-pinned floors (≥3 campaigns, ≥21 campaign-days) below which it REFUSES, and mixed currencies refuse — no industry benchmarks, no LLM numbers. (2) Competitor-response draft — an ordinary DRAFT for the org's own product, copy from the grounded own-product path; the competitor contributes ONLY an angle note from OUR insight titles; a leak spec proves the competitor's creative text/notes/links appear nowhere in the plan/ads/comments. (3) Campaign report shares on the EXISTING ReportShare lifecycle (kind `campaign` + validated planId) with an allowlisted public payload (CB5 totals + CN7 breakdowns + CN2 pacing, windowed) and the association-not-attribution note verbatim — no comments/mentions/approval internals in the shape | ✅ code-complete | NB8 · nb8 acceptance |

## Spike verdicts — the recap

Frontier's spike-first discipline changed the build four
times; all four changes are the honest outcome, recorded
here so no future session "fixes" them back:

1. **CN13:** `destination_type` is `"WHATSAPP"` (Meta
   CTWA guide), not `ON_WHATSAPP`.
2. **CN14:** the legacy Offline Conversions API is
   discontinued — the loop is built on the dataset
   Conversions API instead. Lead quality is confirmed
   (Conversion Leads payload), so no export-only
   fallback was needed.
3. **CN15:** Meta Ad Studies ARE creatable by this app
   class (guide + v25.0 reference) — the real path is
   built; the split-run fallback was not.
4. **CN17:** TikTok's website-conversions objective is
   `WEB_CONVERSIONS` in the current API (not the plan's
   Ads-Manager name), and LEAD_GENERATION cannot be
   completed by this flow (Instant Form binding) — it
   ships as a stored, explicitly refused choice.

## Per-batch gates (as recorded at each batch's completion)

- **NB6** (CN13+CN14) — API 338/338 suites 3376/3376, web
  260/260, tsc 0/0, build 7/7, fresh-PG 161/161 (214
  tables); migration `20261013910000_cn13_cn14_frontier`.
- **NB7** (CN15+CN16) — API 340/340 suites 3395/3395, web
  260/260, tsc 0/0, build 7/7, fresh-PG 162/162 (216
  tables); migration
  `20261013920000_cn15_cn16_experiments_series`. Specs
  caught two real bugs (series status/nextIndex relying
  on DB defaults; a Date string round-trip truncating
  milliseconds) — both fixed in-batch.
- **NB8** (CN17+CN18) — API 343/343 suites 3418/3418, web
  260/260, tsc 0/0, build 7/7, fresh-PG 163/163 (216
  tables); migration `20261013930000_cn17_cn18_depth_sharing`.
  Baseline movement matched the new specs exactly at
  every batch (+2/+25, +2/+19, +3/+23).

Full sequence at the Frontier close: **163 migrations,
fresh-Postgres clean** (160 at the CN1–CN12 close + the
three Frontier migrations, all in the claimed
`20261013900000+` range).

## Exclusions honoured (unchanged owner rules)

- No auto-publish / auto-activate / auto budget movement
  anywhere: experiments link published campaigns, series
  create drafts, drafts create PAUSED, shares and the
  simulator move nothing.
- No wallet-funded ad spend / managed accounts (still an
  owner-decision item, not reopened).
- No competitor creative copying — structurally excluded
  in CN18 and spec-proven.
- No industry benchmark data — the simulator refuses
  without the org's own data.

## Honest limits & what remains

- **NOTHING in CN13–CN18 is live-proven.** The Frontier
  surfaces join CN12's live-verification scope: CN12's
  checklist sessions should now also cover the CTWA
  create + digit read-back, the dataset CAPI acceptance
  (incl. dedup against a real browser event), the
  lead-quality event acceptance, an `ad_studies` create
  with this app's token class (and whether the read-back
  carries winner/confidence), the funnel/series flows on
  real audiences, the PMax asset chain with real assets,
  and a TikTok WEB_CONVERSIONS create. All of it is
  owner-gated: integration with the other tracks (union
  fresh-Postgres gate — including the ON10/CN 800000-prefix
  pair, keep both folders) → the owner's explicit push
  instruction → Dokploy Redeploy → the Frontier migrations
  on the real DB → live sessions with the owner's real
  accounts (M30 campaign track).
- None of the three Frontier migrations has run on any
  real database — fresh-Postgres proof only.
- No screenshot QA of any Frontier surface (nothing is
  deployed) — tsc/test-proven only. The Design+UX package
  (DX1–DX4, approved 2026-10-15) sequences its DX2/DX3
  visual work after this batch, on these surfaces.
