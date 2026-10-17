# Campaign Builder Advanced — Package Summary (CA1–CA28)

The complete Campaign Builder Advanced package, approved in full by the owner on 2026-10-17 and built batch by batch (CB1–CB6) on the `campaign-advanced` branch in `~/workspace/ai-marketing-saas-ca` (base: GitHub main `5b3d403`, 216 migrations at start; **227 migrations** at package close). Per-batch evidence lives in `docs/campaign-advanced-cb{1..6}-acceptance.md`. **Everything below is code-complete at the level stated, local only — NOT pushed, NOT deployed, and no part of it is live-proven with real platform accounts.** The GitHub push gate, the Dokploy redeploy, per-org job enables and M30 live verification remain the owner's, listed at the end.

## Per-item status

### CB1 — Creative AI (`docs/campaign-advanced-cb1-acceptance.md`)
| Item | Commit | Status |
|---|---|---|
| CA1 AI image generation inside the builder | `61d73dfa` | ✅ Built — real provider path, "AI ছবি — " provenance prefix + audit + usage record |
| CA2 AI slideshow video ads from product photos | `6e5546b9` | ✅ Built — ffmpeg slideshow (1:1/4:5/9:16) from real product photos; refuses honestly without ffmpeg |
| CA3 Google RSA assembly from CN5 textOptions + TikTok spike | `42787394` | ✅ Built (Google RSA with listed limits/`notCarried`); TikTok multi-text spike verdict recorded (see NOT BUILT) |
| CA4 Per-ad copy localization bn↔en | `f98916bc` | ✅ Built — number/price-locked locale variants in textOptions |
| CA5 Creative scoring depth | `8b5a253d` | ✅ Built — width/height from real bytes/render size (migration `20261030000000`); direct video uploads stay null (documented) |

### CB2 — Audience Intelligence (`docs/campaign-advanced-cb2-acceptance.md`)
| Item | Commit | Status |
|---|---|---|
| CA6 Overlap & conflict warnings | `772f5ac4` | ✅ Built — local overlap/conflict computation; Meta overlap stays `not_computable` (no endpoint exists — spike verdict) |
| CA7 Audience performance history | `796813d7` | ✅ Built — rollups from real rows (migration `20261030100000`); campaign/ad-set rows never attributed to a creative/audience without an honest coverage count |
| CA8 Sync completion (Meta) + spikes (Google, TikTok) | `cb970038` | ✅ Built for Meta (deletion path + scheduled size/status refresh); Google Customer Match and TikTok DMP **not built** (spike verdicts, below) |
| CA9 Geo intelligence | `91059dd0` | ✅ Built — region facts from stored breakdowns riding suggestPlan |

### CB3 — Automation & Control (`docs/campaign-advanced-cb3-acceptance.md`)
| Item | Commit | Status |
|---|---|---|
| CA10 Rules SUGGEST mode + approval queue | `0fc4afb0` | ✅ Built — new rules default to suggest; pre-CA10 rules keep executing (migration default `execute`, decision documented in the acceptance doc) |
| CA11 Budget-shift apply + multi-plan allocator | `66b74359` | ✅ Built — human-applied shifts only; no automatic money movement |
| CA12 Plan-level scheduled pause/resume | `fc838884` | ✅ Built — exactly-once windows via `plan_schedule_sweep` (per-org enable still owed) |
| CA13 Naming conventions | `e50c03c4` | ✅ Built — local renames only; Meta-side names are never renamed (stated in UI/API) |
| CA14 Server-side bulk operations | `7ed5e666` | ✅ Built |
| (batch extra) TelegramClient `@Optional()` boot fix | `4c373a3b` | ✅ Built on this line — **still owed to main and every other line at integration** (the API cannot boot without it) |

### CB4 — Cross-Platform Parity (`docs/campaign-advanced-cb4-acceptance.md`)
| Item | Commit | Status |
|---|---|---|
| CA15 One-click fan-out + PMax signals | `bccf3a10` | ✅ Built — per-platform naming, CA3 RSA reuse, TikTok extras in `notCarried`; no migration needed (audit correction recorded) |
| CA16 Google/TikTok post-publish management | `c1e17756` | ✅ Built — all four operations, spike-confirmed against official docs first |
| CA17 UTM template + attribution display | `64de232f` | ✅ Built — one plan-level template (migration `20261030300000`); existing `utm_*` on a link are never overwritten |

### CB5 — Measurement (`docs/campaign-advanced-cb5-acceptance.md`)
| Item | Commit | Status |
|---|---|---|
| CA18 Pacing alerts + runway projection | `e96e8c66` | ✅ Built — named thresholds, 24h re-notify cooldown (migration `20261030400000`); runway only on lifetime-budget plans; alerts never move money; `pacing_alert_sweep` per-org enable still owed |
| CA19 Geo holdout | `920db109` | ⚠️ **Fallback built** — spike verdict NO (Meta Ad Study has no geo split; GeoLift is external): definition + observational comparison labelled "Lift নয়", delivery unchanged (migration `20261030500000`) |
| CA20 Per-form lead quality | `4d494559` | ✅ Built — source fix: `Lead.leadFormId` stamped at leadgen ingest (migration `20261030600000`); rates withheld below 10 attributed leads |
| CA21 COD return-adjusted ROAS | `6f977327` | ✅ Built — on AttributionCredit ∪ AB7 UTM stamps (Order carries no campaign id — linkage finding recorded); raw figure kept beside the adjusted one, scope labelled |
| CA22 Builder inbox + counter-drafts | `b9194d1d` | ✅ Built — from the competitors module's already-stored rows + manual entry (migration `20261030700000`); metadata-only, draft-only; automated competitor feed **not built** (below) |

### CB6 — Platform Depth (`docs/campaign-advanced-cb6-acceptance.md`)
| Item | Commit | Status |
|---|---|---|
| CA23 Advantage+ truth + app promotion | `5466cac5` | ✅ Built — spike-confirmed contract: campaign bid + no placement targeting + Advantage audience, state only from Meta's `advantage_state_info` read-back (migration `20261030800000`); `OUTCOME_APP_PROMOTION` + `APP_INSTALLS` + app id/store URL shipped in the same item |
| CA24 Live platform pre-flight checks | `d96b2e7e` | ✅ Built — live account_status/disable_reason, Page fetchability, Pixel `last_fired_time`; unperformable checks are `not_checked` with the reason, never ok |
| CA25 Asset picker intelligence | `e20b2177` | ✅ Built — ad-level-metrics-only attribution, stated rating bars (≥1,000 impressions, ≥৳100 spend), badge/sort in the picker; duplicate-upload warning from the persisted sha256 (no migration needed) |
| CA26 Blueprints as data | `b6ec6eb6` | ✅ Built — constants → `CampaignBlueprint` rows seeded byte-identically (migration `20261030900000`, spec-guarded), admin CRUD, org clones, DB-backed instantiation with a regression spec against the old const outputs |
| CA27 Winner traits + ad versioning + catalog carousel | `a52bf5e9` | ✅ Built — minimum-sample-gated trait facts into suggestPlan/generateCopy; per-ad before-image versions with diff + append-only restore (migration `20261031000000`); carousel assembly from real Product rows with manual cards preserved |
| CA28 Landing pages from the builder | `e78363bf` | ✅ Built on the existing EC13 machinery (no new page type — verify finding); confirm-gated apply of a published landing's URL into an ad (no migration needed) |

## Full NOT BUILT list (whole package)

- **TikTok ACO multi-text** (CA3/CA15) — standard `/ad/create/` is single-text; multi-text exists only via a separate ACO product whose contract could not be confirmed. Extra variants are reported in `notCarried`, never silently dropped.
- **Meta audience overlap endpoint** (CA6) — no Graph API endpoint exists; overlap stays `not_computable` with the verdict as the reason. Ads Manager's UI tool remains the only source.
- **Google Customer Match sync** (CA8) — not built: read-only client and a retiring API path (spike documented).
- **TikTok DMP audience sync** (CA8) — not built: DMP is a new file-upload integration surface, out of the read-only client's scope (spike documented).
- **CA19 geo-split experiment** — impossible via the Ad Study contract (cells have no region field; all splits are user-level; GeoLift is an external tool). Only the definition + observational fallback shipped; no study is created and delivery never changes automatically.
- **CA22 automated competitor feed** — not built; the inbox works from the competitors module's already-stored rows plus manual entry. Owner-sequenced after Smart AI C1–C2.
- **CreativeAsset origin column** (CB1) — not added; AI provenance is the name prefix + audit + usage records by documented decision.
- **Google PMax textOptions assembly** (CA3 scope) — PMax asset groups still draw from the legacy-field pools under the CN17 contract; CA3's assembly covers the Search RSA path the item specified.
- **CA23 `existing_customer_budget_percentage`** — not available on new Advantage+ campaigns per Meta's documentation; nothing sends it.
- **CA27 text-overlay trait** — excluded: CA5 vision stores no per-asset result, so the trait would be a guess; the payload says so.

## Owner-gated remainder

1. **Push** — the whole `campaign-advanced` branch is local. Push only on the owner's explicit in-the-moment instruction, after the standing pre-push check (ls-remote + fetch first, merge the owner's own commits, never force-push). A union integration against the then-current main is expected to also carry the TelegramClient `@Optional()` boot fix (`4c373a3b`) and to re-check the NF/CA migration-timestamp neighbourhoods (different folder names, same timestamps).
2. **Dokploy Redeploy** — manual, after any push; it will run the package's 11 new migrations (CA5, CA7, CA17, CA18, CA19, CA20, CA22, CA23, CA26, CA27 + CB3's CA10 migration) on the real database. Production **ffmpeg** must exist on the API host for CA2 video generation (the service refuses honestly where absent).
3. **Per-org job enables** — `pacing_alert_sweep` (CA18), `plan_schedule_sweep` (CA12), and automation rule modes (CA10: existing rules keep `execute`; each org decides when new rules may leave `suggest`).
4. **M30 live verification** — entirely open for this package: real Meta app/account proof for CA23's Advantage+ read-back and app promotion, CA24's live checks against a real account/page/pixel, CA8's deletion path, CA16's Google/TikTok operations, and every other platform seam — all currently proven only against stubbed seams and documentation, as each batch's acceptance doc states.
