# Milestone 22 Acceptance — Phase J: Trust & Completeness

Date: 2026-10-10. Commit: (this commit). Schema: 80 models (fields
only), migration 20261010220000_m22_phase_j applied. API tests 278
pass (9 new), builds pass.

## J1 Published-object status sync
- MetaPublishClient.getObjectStatus reads status/effective_status/
  issues_info. CampaignsService.syncObjectStatuses stores the
  campaign effective status on the plan (+lastStatusSyncAt), per-ad
  set effectiveStatus, and per-ad effectiveStatus + issuesInfo;
  anything Meta reports beyond ACTIVE/PAUSED is returned as a
  health issue (DISAPPROVED ads now surface with Meta's reason
  instead of the app claiming "published").
- Builder: effective-status badges at plan/ad set/ad level, issue
  panel, and a "Meta অবস্থা যাচাই" button. Scheduled via the new
  meta_status_sync job (syncAllPublishedStatuses; per-plan errors
  collected, never hidden).

## J2 Google Search completeness
- publishGoogle now REQUIRES keywords (>=1, <=100; match type
  BROAD/EXACT/PHRASE, default EXACT) — a keywordless Search
  campaign is refused before any API call because it cannot serve.
  Negative keywords (BROAD), sitelink assets (text <=25 + URL) and
  callout assets (<=25) are created and linked to the campaign;
  every step lands in the publication detail; any failure still
  ends as an honest "failed" publication with earlier steps kept.
  Web form: keyword lines "text|MATCH", negatives, sitelinks,
  callouts.

## J3 Scheduling wired end-to-end
- addAdSet accepts startTime/endTime (stored); the publish loop
  finally passes them to Meta (the client supported it since M9 —
  the middle was dead). Live schedule edit for published ad sets
  (Meta first, local after confirmation, audited) with a builder
  editor next to the budget editor; schedule shown on the ad set.

## J4 UTM governance
- tagUtm: publish appends utm_source=facebook, utm_medium=cpc,
  utm_campaign=<plan slug> to link and carousel-card URLs; owner
  UTMs are never overwritten; every tagged ad leaves a utm_tagged
  step in the publish log. Builder notes the behavior on the form.

## J5 Audience membership refresh
- refreshMembership re-gathers the record's source contacts
  (customers/leads/RFM via the same contactsFor path), uploads
  hashed pairs to the EXISTING Meta audience in batches, and
  stores lastMembershipSyncAt + lastMembershipCount (uploaded) —
  sizes still only come from Meta's approximate_count refresh.
  Errors are recorded on the record and surfaced; lookalikes and
  unbuilt records are refused. Weekly refresh via the new
  audience_refresh job; per-audience errors collected. Audiences
  page gained a "সদস্য আপডেট" button with last-refresh state.

## Live verification performed (sandbox, demo org)
- status-sync on an unpublished plan -> honest 400; live schedule
  edit on an unpublished plan -> honest 400; refresh-members on a
  missing record -> 404; meta_status_sync and audience_refresh
  jobs created through the API. Real Meta/Google execution needs
  the owner's accounts (checklist section 18).
