# Messaging Page Design Update — Acceptance

- **Worktree:** `~/workspace/ai-marketing-saas-mxd`
- **Branch:** `messaging-design`
- **Starting HEAD:** `de24bea5` (messaging-advanced final — "MX package close-out: MX1–MX16 audit summary…")
- **Scope:** Web-only redesign of the dashboard Messaging page (`apps/web/src/app/dashboard/messaging/page.tsx`, 3,346 lines at base). NO API change, NO schema/migration. Local commits only — **no GitHub push** (owner-only trigger).
- **Design language:** the v2 tokens already in this tree (`apps/web/src/app/globals.css`): `--brand-from/--brand-to`, `.card`, `.btn-primary`, `.view-switch`, `.stat-chip`, `.stat-card` — the same primitives the Inbox v2 / design program use. No new visual system invented.

## Before-inventory (zero-loss baseline, audited at de24bea5)

The post-MX page is ONE long stacked scroll of 13 top-level blocks, all state held in the single page component (122 fetch call sites):

| # | Block (base line) | Contents |
|---|---|---|
| 1 | Header + error/notice (1330) | Title, honesty intro, error/notice banners |
| 2 | Provider status (1337) | Email SMTP + SMS gateway configured/path cards |
| 3 | Templates (1352) | Template list, search, test-send, edit, duplicate, versions/restore, create form, HTML preview |
| 4 | Email Builder + Content Library (1428) | MX7 block builder, brand kit line, content blocks, festival packs |
| 5 | Growth Tools + Preference Center (1535) | MX10 opt-in forms + QR, preference link, consent history, CSV import wizard, opt-out export |
| 6 | Audiences + Broadcasts + Composer (1651) | RFM segments, MX11 audience intelligence + AI segment draft + suppression, broadcasts list/filters/reports (cascade, A/B, holdout, revenue association, replies, deliveries + export), approvals actions, composer (6 channels: email/SMS/WhatsApp/Web Push MX12/Telegram MX13/On-site MX14, cascade MX2, A/B + auto-winner MX16, AI draft/subjects/planner/translate/subject-score/send-time MX16/MS9, preview, compose-check, recurrence, budget cap, holdout) |
| 7 | Journey Presets (2558) | MX4 preset install |
| 8 | Journeys (2598) | MX4 journey editor (steps, branch arms, triggers), enable/disable, detail |
| 9 | WhatsApp Templates (2745) | WABA ID save, Meta template sync/submit, status/rate display (MX9) |
| 10 | Sender Settings (2894) | SMTP verify-before-save, SMS gateways, sender rates, domain health |
| 11 | Consent + Messaging Settings (2980) | Frequency cap, quiet hours, settings PATCH, preferences list |
| 12 | Keyword Campaigns (3066) | MX6 keyword/poll rules CRUD, poll tally, hit classify/apply-label |
| 13 | Analytics + Governance (3196) | MX16 comparative analytics + CSV export; MX15 delivery health, seed list, approval queue, spend governance |
| 14 | Transactional Overview (3314) | Order-notification read-only overview |

### Endpoints used by the page at base (must ALL remain reachable)

| Endpoint | Before | After |
|---|---|---|
| `/organizations/${orgId}/messaging/${kind === broadcast ? broadcasts : templates}/${id}/test-send` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/ai/draft` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/ai/planner` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/ai/segment-draft` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/ai/segment-suggestion` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/ai/send-time` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/ai/send-time-recipient?recipientKey=${encodeURIComponent(recipientTimeKey.trim())}` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/ai/subject-score` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/ai/subjects` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/ai/translate` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/analytics${qs.toString() ? ` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/approvals` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/audiences` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/blocks/preview` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/brand-kit` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/broadcasts` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/broadcasts/${b.id}` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/broadcasts/${b.id}/${action}` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/broadcasts/${b.id}/${archived ? archive : unarchive}` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/broadcasts/${b.id}/ab-auto-winner` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/broadcasts/${b.id}/clone` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/broadcasts/${b.id}/report` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/broadcasts/${broadcastId}/deliveries?${params.toString()}` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/broadcasts/preview` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/broadcasts?${params.toString()}` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/compose-check` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/composer/discounts` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/composer/products` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/consent-events` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/content-blocks` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/content-blocks/${cb.id}` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/csv-import/${csvWiz.preview!.importId}/commit` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/csv-import/preview` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/engagement` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/health?days=30` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/journey-presets` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/journey-presets/${p.key}/install` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/journeys` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/journeys/${j.id}` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/journeys/${journeyDraft.id}` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/journeys/meta` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/keyword-hits` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/keyword-hits/${h.id}/apply-label` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/keyword-hits/${h.id}/classify` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/keyword-rules` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/keyword-rules/${kwEditId}` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/keyword-rules/${r.id}` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/keyword-rules/${ruleId}/tally` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/optin-forms` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/optin-forms/${f.id}` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/optin-forms/${f.id}/qr` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/preferences` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/preferences/import` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/preferences/link` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/provider-status` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/rfm` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/seed-recipients` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/senders` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/senders/email` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/senders/rates` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/senders/sms` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/settings` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/suppression-suggestions` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/suppression-suggestions/apply` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/template-packs` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/template-packs/${pack.key}/install` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/templates` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/templates/${builder.templateId}` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/templates/${t.id}` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/templates/${t.id}/versions` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/templates/${t.id}/versions/${version}/restore` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/transactional-overview` | ✓ | ✓ |
| `/organizations/${orgId}/messaging/variables` | ✓ | ✓ |
| `/organizations/${o}/messaging/audiences` | ✓ | ✓ |
| `/organizations/${o}/messaging/audiences/${bcForm.audienceSavedId}` | ✓ | ✓ |
| `/organizations/${o}/messaging/broadcasts/${b.id}/approve` | ✓ | ✓ |
| `/organizations/${o}/messaging/broadcasts/${b.id}/deliveries` | ✓ | ✓ |
| `/organizations/${o}/messaging/broadcasts/${b.id}/reject` | ✓ | ✓ |
| `/organizations/${o}/messaging/broadcasts/${b.id}/send` | ✓ | ✓ |
| `/organizations/${o}/messaging/broadcasts/${b.id}/submit-approval` | ✓ | ✓ |
| `/organizations/${o}/messaging/broadcasts/${seedTestBroadcastId}/test-send-seed` | ✓ | ✓ |
| `/organizations/${o}/messaging/compose-check-v2` | ✓ | ✓ |
| `/organizations/${o}/messaging/health?days=${healthDays}` | ✓ | ✓ |
| `/organizations/${o}/messaging/preferences/${p.id}` | ✓ | ✓ |
| `/organizations/${o}/messaging/seed-recipients` | ✓ | ✓ |
| `/organizations/${o}/messaging/seed-recipients/${sd.id}` | ✓ | ✓ |
| `/organizations/${o}/messaging/senders/email` | ✓ | ✓ |
| `/organizations/${o}/messaging/senders/email/domain-health` | ✓ | ✓ |
| `/organizations/${o}/messaging/senders/email/test` | ✓ | ✓ |
| `/organizations/${o}/messaging/senders/sms` | ✓ | ✓ |
| `/organizations/${orgId}/inbox/integrations` | ✓ | ✓ |
| `/organizations/${orgId}/inbox/whatsapp-templates` (+ `/submit`) | ✓ | ✓ |
| `/organizations/${orgId}/inbox/whatsapp-waba` | ✓ | ✓ |
| `/organizations/${o}/inbox/whatsapp-templates/sync` | ✓ | ✓ |

(After column is filled/verified at close-out by re-running the same extraction on the final tree and diffing — zero removals allowed.)

## Redesign (per section)

Commits: `29ecaa8c` audit skeleton · `b617b5f9` tabbed workspace + hero · `2e61c374` messaging v2 styles.

1. **Tabbed workspace (zero-loss restructure).** The 12 content blocks of the stacked page are wrapped WHOLE (no JSX inside any block was rewritten) under 7 tabs, using the existing `.view-switch` / `.view-switch-btn-active` primitives:
   - 📣 **ক্যাম্পেইন ও অডিয়েন্স** — the audiences+broadcasts+composer block (RFM, MX11 intelligence/AI segment draft/suppression, broadcasts list + filters + reports + approvals, the full 6-channel composer with cascade/A-B/AI panels).
   - 🧩 **Templates ও Builder** — Templates block + MX7 Email Builder/Content Library block.
   - 🧭 **Journeys** — Journey Presets + Journeys editor blocks.
   - 💬 **WhatsApp ও Keywords** — WhatsApp Templates (Meta) block + MX6 Keyword Campaigns block.
   - 🌱 **Growth ও Consent** — MX10 Growth/Preference Center block (opt-in forms, QR, consent history, CSV wizard).
   - 📊 **Analytics ও Health** — MX16 comparative analytics + MX15 governance/health block + Transactional overview block.
   - ⚙️ **প্রেরক সেটিংস** — Sender Settings block + Consent/Messaging Settings block.
   All state remains in the single page component (controlled inputs everywhere), so switching tabs unmounts a block's DOM but loses NO form/draft state. Provider-status cards stay visible above the tabs on every tab.
2. **Hero header.** Brand-gradient hero (`--brand-from → --brand-to`, white-label safe) replacing the plain title, with the original honesty intro kept verbatim, a "+ নতুন Broadcast" CTA that jumps to the campaigns tab, and a KPI chip row fed ONLY from already-loaded real state: templates count, broadcasts loaded count (labelled "লোড"), pending-approvals count, keyword-rule count, journey count. No invented numbers.
3. **Sticky responsive tab bar.** Sticks to the top while scrolling; on mobile the tabs scroll horizontally (scrollbar hidden) instead of wrapping/crushing; on ≥sm each tab flexes evenly. `role="tablist"`/`aria-selected` included.
4. **Section polish (CSS-only).** `.msg-section` cards get the v2 section-title treatment (17px, tight tracking) and a hover shadow lift using the existing `--shadow-card-v2` token; scroll-margin set for anchor safety.
5. **globals.css additions** are additive and namespaced (`.msg-hero`, `.msg-kpi`, `.msg-hero-cta`, `.msg-tabbar`, `.msg-tabs`, `.msg-section`) — no existing class changed, so no other page is affected.

### Zero-loss proof
- Endpoint extraction (same grep) run on base and on the final tree: **identical sets** (90 messaging patterns + 5 inbox patterns) — diff empty, recorded at both the restructure commit and close-out.
- `git diff` removed-lines audit: the only removed lines are the old plain header (replaced by the hero, intro text kept) and the 12 section root `<div>` openers (re-added identically plus the `msg-section` class).
- No handler, state, or API call was edited — the transformation only wrapped blocks and replaced the header.

## Gates (run SERIALLY, in this order)

| Gate | Result |
|---|---|
| web `tsc --noEmit` | ✅ exit 0, **0 errors** (fresh-worktree note: `@repo/contracts` + `@repo/ui` dist had to be built first — `pnpm --filter @repo/contracts --filter @repo/ui build` — the first tsc run's TS2307 errors were that missing-dist artefact only, none in messaging code) |
| web vitest (`pnpm test`) | ✅ **83 test files, 706/706 tests passed** — exactly the MX package's recorded web baseline (706) |
| web `next build` | ✅ Compiled successfully; `/dashboard/messaging` 64.8 kB (168 kB First Load JS) |

No gate failure needed a base-comparison run: all three gates passed on the redesigned tree.

## NOT BUILT

- **No screenshot/visual QA** — by design; the checklist below runs post-deploy only. Nothing here is screenshot-verified.
- **No split of the 900-line campaigns block** into separate RFM/intelligence vs broadcasts/composer tabs: those sub-blocks are nested inside one card in the base JSX, and splitting them would have meant rewriting JSX inside blocks — rejected to keep the zero-loss proof airtight. They share the "ক্যাম্পেইন ও অডিয়েন্স" tab.
- **No per-section component extraction** (the page remains one component file, +89/−15 lines net): extraction was unnecessary for the design goal and would have raised loss risk.
- **No dark-mode-specific messaging overrides** — the page inherits the existing token layer exactly as before; no new dark styling was added or claimed.
- **No API/schema/migration work** — none was needed; nothing on the API side was touched.
- **No live verification** — no tab/flow was exercised against a live backend in this task; that is part of the post-deploy checklist and the standing M30 backlog.

## Screenshot-QA checklist (post-deploy only — NOT run here)

- [ ] Desktop ≥1280px: every tab renders, hero + KPI strip correct, no horizontal scroll
- [ ] Tablet ~768px: tab bar scrolls horizontally, cards stack, composer grid collapses
- [ ] Mobile ~375px: tab bar usable, tables scroll inside cards, sticky tab bar does not cover content
- [ ] Each tab: create/edit/test-send flows clickable end-to-end against live API
- [ ] Dark/brand: org white-label brand colours flow through hero + active tab (brand vars)
- [ ] Bengali text renders in Hind Siliguri, no clipped buttons in any tab
