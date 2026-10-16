# Admin Design Next — NB4 Acceptance (ADNX13, ADNX14, ADNX15)

- **Batch:** NB4 (বাকি page) of the ADNX package — plan
  `~/workspace/goals/ai-marketing-saas-platform-build/files/Admin-Dashboard-Design-Next-Plan-2026-10-16.md`
  §২ (principles), §৩ (responsive rules), §৭ ADNX13/ADNX14/ADNX15, §৯ NB4 row + gates
- **Worktree / branch:** `~/workspace/ai-marketing-saas-adnx`, `admin-design-next`
- **Base:** `da86c0d` (NB3 complete) · **Local commits only — NO push**
- **Scope:** `apps/admin` + this doc. No new API endpoint, no backend
  change, no migration, no behaviour/payload/label/config-key change —
  presentation and feedback only.
- **NO screenshot / browser QA is claimed anywhere in this doc**
  (that is NB5 / ADNX16). Verification here is code-level: gates +
  set-diffs below.
- **PageHead adoption after NB4: 22 of 22** — 20 pages import the
  component (NB2's 7 + NB3's 10 + this batch's security, settings,
  search); login and TOTP have no AdminShell, so they adopt the
  PageHead *pattern* (same `--a-fs-page` typography: 24px bold,
  tight tracking) in their own layouts. The distinction is recorded
  here and at each page, not blurred.

## Commits (one per item, in the mandated order)

| Item | Commit | Subject |
|---|---|---|
| ADNX13 | `d15b782` | Security + Settings |
| ADNX14 | `662768a` | Search, Login, TOTP |
| ADNX15 | `1e78bfa` | Personalization completion + cross-page contrast sweep |

## ADNX13 — Security (`d15b782`)

- **PageHead adopted** (sub-line only; the shell keeps the h1, as
  in NB2/NB3). Tabs kept (totp / sessions / access, unchanged).
- **Sessions list → DataTable v3:** the View-As sessions `<ul>`
  is now the ONE DataTable component (columns Admin / Org / Mode /
  অবস্থা / মেয়াদ / পদক্ষেপ, `data-label` on every cell, mobile
  card form). Same first-15 slice, same fields, same revoke
  button label (বাতিল করুন).
- **Dangerous actions — all through the ONE modal pattern,
  verified one by one:**
  - View-As session revoke: previously fired **with no
    confirmation at all** → now `askConfirm` (danger) first.
  - TOTP disable: previously fired directly from the code field →
    now `askConfirm` (danger) first; the code is still sent and
    server-verified exactly as before.
  - API-key revoke: `askInput` reason dialog (NB1) — verified
    unchanged; its result now also has a failure toast (before, a
    failed revoke was an unhandled rejection with no feedback).
  - Revoke-my-sessions: `reasonDialog` (NB1) — verified unchanged.
  - IP Allowlist save (lives in Settings ▸ Maintenance & Safety):
    previously fired directly → now `askConfirm` (danger) first,
    same PATCH afterwards. (Recorded under this item per the
    mandate's "allowlist changes".)
  - TOTP *reset* has no UI flow — it is the server-side
    break-glass script named in the page's own help text; nothing
    to convert, recorded here so the checklist is complete.
- **Toast adoption:** session-revoke, TOTP confirm-enrol and
  TOTP disable results, API-key create and revoke results → toast
  (both `msg` banners removed). **Kept inline, deliberately:**
  the API-key form's two validation messages (name ≥3 chars, at
  least one scope) — they are form validation, now a dedicated
  inline `formError` under the form (NB2 form pattern). The
  shown-once key value stays as the read-only input (persistent
  data, not feedback).
- **States completed:** main load's "লোড হচ্ছে…" text → skeleton
  (its ADX12 ErrorState+retry unchanged). Sessions load gains
  loading skeleton + **ErrorState with working retry** (before, a
  failed fetch silently read as "কোনো সেশন নেই"). Admin Access
  (keys + anomalies) gains a loading skeleton, a shared
  ErrorState+retry on failure, and its two empty texts now render
  only after a successful load.
- **Contrast sweep:** page-level `text-slate-500` 12 → **0**.

## ADNX13 — Settings (`d15b782`)

673 lines at the plan's base audit; the page's config keys,
endpoints, payloads and save behaviour are **untouched** — what
changed is navigation, form presentation, feedback and dirty
tracking.

- **PageHead adopted.**
- **Mobile sub-nav = sticky chip rail:** below `lg`, a sticky
  (`top-0 z-20`, slate-950/90 blur — the Security tab-bar pattern)
  horizontal chip rail sits at the top of the page; every one of
  the 7 sections is one tap away. The desktop aside is unchanged
  except it is now `lg:`-only (it previously stacked above the
  content on mobile, pushing every form down) and gained the
  dirty dot below. Hash deep-links (`#payment-bkash` etc.) are
  untouched.
- **Feedback → toast, all of it:** the page-wide `msg` banner is
  gone. The three child sections keep calling their `setMsg`
  prop, which is now a dispatcher (`notify`): a caller's existing
  ✅/❌/⚠ prefix selects the toast kind and is stripped from the
  text (the NB3 convention); unprefixed = success, and the few
  failure paths that passed a bare error message were prefixed
  ❌ at the call site (config `patch`, flags save, maintenance
  `patch`, allowlist save). The main page's own `save()` calls
  `toast` directly with the correct kind.
- **Dirty indicator + unsaved warning — BUILT**, without touching
  any save behaviour:
  - *General section (controlled):* a per-save-group snapshot
    (support contact / monthly prices / yearly prices / plan
    limits / AI org list) is taken at load; a successful save
    refreshes only its own group. The instant-save toggles
    (maintenance, signup, broadcasts) are never dirty — they
    persist in their own onChange, as before.
  - *Config blocks (uncontrolled, DOM-read at save time — as
    before):* dirty is derived from the DOM the same way — a
    per-block baseline of field values captured when the config
    loads, a delegated `input`/`change` listener re-derives the
    edited block's flag, and a successful save/clear re-baselines
    only its own block. Test buttons never clear dirty;
    test-recipient inputs (`…-test-to`) are not config values and
    are excluded from tracking.
  - *Announcements:* a draft is any field away from its empty
    default. *Flags card:* cells compared to the applied
    snapshot. *Maintenance & Safety:* window group and allowlist
    entries compared to their load snapshots (two separate
    saves, one section).
  - The indicator is an amber dot on the section's chip (mobile)
    and aside item (desktop). The warning is the browser's
    `beforeunload` prompt whenever anything is dirty: shell
    navigation is plain `<a href>` (full-document loads), so it
    covers refresh, close and nav clicks alike. **Section
    switching needs no warning and gets none** — unselected
    sections are hidden, never unmounted, so in-page edits
    survive switching; recorded here as the reasoning, not an
    omission.
- **States completed:** page load text → skeleton; config load
  text → skeleton (its ErrorState+retry unchanged); the Flags
  card — which used to return `null` forever on a failed load —
  gains a skeleton in flight and an ErrorState with working
  retry. Announcement toggle/delete stay silent on success, as
  at base (the reload is the feedback; NB3 recorded the same
  decision class).
- **Contrast sweep:** page-level `text-slate-500` 31 → **0**.
  One copy line was corrected to stay truthful: the aside note
  now says Save/Test results arrive by toast (it previously
  pointed at the page-top banner that no longer exists).

### Settings block-by-block form-pattern table

Form pattern = status badge (as the API already reports) +
visible label + help text + field-level error where a
client-side check exists + Test button where one already exists
+ save feedback by toast. **Field-level error verdict, honest:**
only the Announcement form has client-side validation at base
(and it silently no-oped); every other block's validation is
server-side (several saves are verified by the provider during
the save itself), and those errors return through the same call
and now surface as error toasts. Inventing client-side rules
would risk rejecting values the server accepts — a behaviour
change — so none were invented (see deferred list).

| Block | Section | Status badge | Label + help | Test button | Save feedback | Field-level error |
|---|---|---|---|---|---|---|
| প্ল্যাটফর্ম অবস্থা (support/toggles) | general | — (toggle state is the status) | ✓ labels + placeholders | — none exists | toast | none exists (no validation) |
| Plan দাম (মাসিক) | general | — | ✓ tier rows + help | — | toast | none exists |
| Plan দাম (বার্ষিক) | general | — | ✓ tier rows + help | — | toast | none exists |
| Plan Limits | general | ✓ Setting/Default per tier | ✓ + help | — | toast | none exists |
| Kill Switch | general | — (toggle state) | ✓ labels | — | toast | none exists |
| Maintenance Window | general | ✓ এখন সক্রিয় badge when live | ✓ labels + help | — | toast | start/end-required was a banner message at base → now an error **toast** (one combined check, kept as one message) |
| Admin IP Allowlist | general | — | ✓ label + warning help | — | toast (+ new `askConfirm`, above) | none exists |
| AI / LLM (`config-llm`) | ai | ✓ source badge (admin/env/সেট নেই) | ✓ labels + help | ✓ আসল Test | toast | none — server-verified save, error → toast |
| AI Image (`config-image`) | ai | ✓ source badge | ✓ labels + help | ✓ আসল Test | toast | none — same |
| Meta App (`config-meta`) | apps | ✓ source badge | ✓ labels + help | ✓ যাচাই করুন | toast | none — same |
| TikTok App (`config-tiktok`) | apps | ✓ source badge | ✓ labels + help | ✓ যাচাই করুন | toast | none — same |
| Google App (`config-google`) | apps | ✓ source badge | ✓ labels + help | ✓ যাচাই করুন | toast | none — same |
| LinkedIn App (`config-linkedin`) | apps | ✓ source badge | ✓ labels + help | ✓ যাচাই করুন | toast | none — same |
| Email SMTP (`config-smtp`) | messaging | ✓ source badge | ✓ labels | ✓ Test Email | toast | none — same |
| SMS (`config-sms`) | messaging | ✓ source badge | ✓ labels + note | ✓ Test SMS | toast | none — same |
| SSLCommerz (`config-sslcommerz`) | payment | ✓ source badge | ✓ labels + help | ✓ যাচাই করুন | toast | none — same |
| bKash (`config-bkash`) | payment | ✓ source badge | ✓ labels + help | ✓ যাচাই করুন | toast | none — same |
| Wallet (`config-wallet`) | payment | ✓ source badge | ✓ labels + help | — **none exists at base; none invented** | toast | none — same |
| Announcement | announce | ✓ সক্রিয়/নিষ্ক্রিয় per item | ✓ labels (audience/dates) + help | — | toast | **✓ NEW** — শিরোনাম/বার্তা field errors (was a silent no-op) |
| Plan Feature Defaults | flags | — (tri-state cells are the status) | ✓ feature rows + help | — | toast | none exists |

## ADNX14 — Search, Login, TOTP (`662768a`)

**Search:**
- **PageHead adopted.** Loading text → skeleton; the ADX12
  states (short-query EmptyState / no-results EmptyState /
  ErrorState+retry) were verified present and are unchanged.
- **Results:** single-column grouped on mobile (the grid is
  `grid-cols-1` until the kept `lg:grid-cols-3`); each result row
  now follows the Command Palette's row pattern — medium label
  line + small sub line, `px-3 py-2.5`, group cards with row
  spacing. No result field was added or dropped.
- **Recent searches on the page (and therefore on mobile):**
  chips under the PageHead read the palette's OWN store
  (`LS_KEYS.recentSearches` via the shared `lsGetArray`/`lsSet`
  helpers — no second store), and a search run from this page is
  remembered with the palette's own dedupe + cap-5 rule.
- Contrast sweep: `text-slate-500` 3 → **0**.

**Login:**
- Already on the console's own primitives (`acard` surface,
  `ainput`, `abtn`, the global font stack) — verified, not
  rebuilt. What changed: the heading follows the **PageHead
  pattern** (24px / bold / tight — it was 20px), the error is
  now `role="alert"` (it was already a clear inline message; no
  shake or gimmick exists or was added), contrast sweep
  `text-slate-500` 2 → **0**. Auth flow, payload and redirects
  untouched.

**TOTP:**
- Same visual-system alignment: gradient brand mark (matching
  Login's), **PageHead-pattern heading**, error as `role="alert"`.
- The code field is **one input, as it has always been** (the
  implementation was checked first, per the item) — no
  auto-advance was built because there are no cells to advance
  between. Mobile sizing only: taller tap target (`!py-3.5`),
  `inputMode="numeric"` kept, `autoComplete="one-time-code"`
  added. Digits-only filtering, the 6-char rule, payload and
  challenge flow are byte-for-byte the base behaviour.
- Contrast sweep: `text-slate-500` 1 → **0**.

## ADNX15 — Personalization completion (`1e78bfa`)

### (a) SavedViews audit — every list page

| Page | Filter state at base | Verdict |
|---|---|---|
| orgs, users, audit, tickets | — | Already had SavedViewsBar (ADX14) — verified, unchanged |
| **payouts** | status select (server-side filter) | **ADDED** — `SavedViewsBar page="payouts"` over `{status}`, in a bordered bar inside the queue card |
| **usage — AI by Feature section** | day window (7/30/90) + org text filter | **ADDED** — `SavedViewsBar page="usage-ai"` over `{days, filter}` above the section's table |
| usage — main ranking | sort only, **no filter state** | SKIPPED — a saved view of a sort order is not a filter view; recorded, not forced |
| billing | tab state only (subs/payments/coupons/dunning sections) | SKIPPED — the tabs are page sections, not a list's filter combination; there is no filter state to save |
| alerts | none (severity groups are data-derived, not filters) | SKIPPED — no filter state exists |
| admins | none (no search/filter/sort on the roster) | SKIPPED — no filter state exists |
| social-ops | section switch only (mobile Social/Ads tabs); boards are unfiltered | SKIPPED — no filter state exists |

### (b) Last-used filter persistence

Built once in `ui.tsx` (`loadLastFilters` / `storeLastFilters` /
`useLastFilters`, key `admin_last_filters_<page>`, the saved-
views guarded-storage pattern: blocked/corrupt storage degrades
silently to the page defaults). Restore runs once on mount
through the SAME apply function the page's SavedViewsBar uses;
every later filter change is stored. Wired on: **orgs**
(q/status/plan), **users** (q/status/admin), **audit** (all 7
fields), **tickets** (status filter), **payouts** (status),
**usage-ai** (days/filter). No other list page has filter state
(the audit table in (a) is the same audit). No page's filter
semantics changed — this is the page's own state, persisted.

### (c) Shared-component contrast sweep — the NB2/NB3 deferred pass, closed

`text-slate-500` → `text-slate-400` in **all** of
`apps/admin/src/components` (NB1-measured: slate-500 is 4.24:1 /
3.75:1, below WCAG AA; slate-400 is 7.87:1 / 6.96:1):
`ui.tsx` 4 → 0 (DetailDrawer sub-line, SavedViewsBar label +
view-delete ✕, ConfirmModal "(ঐচ্ছিক)" marker), `AdminShell.tsx`
5 → 0, `CommandPalette.tsx` 5 → 0. **Verified by grep:
`text-slate-500` in `apps/admin/src/components` = 0 — and, with
this batch's page sweeps, in all of `apps/admin/src` = 0.**

### (d) Density + favorites — verified unchanged

Read, not rebuilt: the density toggle (`AdminShell.tsx`
`DensityToggle`, comfortable/compact, mirrored to
`<html data-admin-density>` and persisted under
`LS_KEYS.density`) and favorites/recents (pin toggle in
`NavContent`, persisted under `LS_KEYS.favorites` /
`LS_KEYS.recent`, all storage access guarded) work exactly as
ADX14/NB1 left them. This batch's only edits inside those files
are the (c) colour-class changes — the git diff for
`AdminShell.tsx`/`CommandPalette.tsx` is class-strings only,
which the reviewer can confirm hunk by hunk.

## Gates (run SERIALLY, one heavy gate at a time, recorded as they finished)

| Gate | Result |
|---|---|
| Admin `tsc --noEmit` | **0 errors** — interim runs after ADNX13 and after ADNX14, plus a final run after ADNX15; all 0 |
| Admin `next build` | **Green** — compiled successfully, static generation 23/23; route table lists the same **22 routes** as base (21 static + `/orgs/[id]`, `/users/[id]` dynamic; `_not-found` excluded, as at base) |
| Browser-dialog grep gate (`window.prompt/alert/confirm` + bare calls, `apps/admin/src`) | **0 matches** |
| API path set-diff — NB3's consistent scan (every `"/admin/…"` or `` `/admin/…` `` string literal in `apps/admin/src`, unique-sorted) | **Identical — 116 = 116**, zero added, zero removed (checked after every item) |
| Route set-diff (`page.tsx` files, base `da86c0d` vs final) | **Identical — 22** |
| Nav href set-diff (`nav.tsx`) | **Identical** — `nav.tsx` is untouched by this batch (0-line diff) |
| PageHead adoption | **22/22** — 20 component imports (grep-verified) + login/TOTP pattern headings (see the header note) |
| Contrast | `text-slate-500` in `apps/admin/src` = **0** (security 12→0, settings 31→0, search 3→0, login 2→0, totp 1→0, components 14→0; NB2/NB3 pages were already 0) |
| Button-label scan | No visible button label removed. Additions/changes only: Settings gained the mobile chip rail (the 7 existing section labels), dirty dots (no text), the allowlist `askConfirm` (its button label unchanged), Security's two new confirm dialogs (button labels unchanged); the removed-text fragments in the diff are loading texts replaced by skeletons, empty texts re-rendered as EmptyState/DataTable cells with identical wording, contrast-only class changes, and the one corrected aside note (see ADNX13 Settings). Key labels spot-verified present in the final tree (বাতিল করুন, সেভ করুন, Allowlist সেভ করুন, TOTP বন্ধ করুন, প্রকাশ করুন, Window সেভ করুন, Admin লগইন, প্রবেশ করুন, …) |
| Payload/behaviour scan | No `apiFetch` path, method or body changed in any hunk; changes touch only feedback calls (`setMsg` → `toast`/`notify`), confirm wrappers around the same calls, state rendering, layout classes, and the new localStorage filter persistence (the pages' own existing filter state) |
| Working tree | Clean at batch end (build artifact `tsconfig.tsbuildinfo` restored, not committed) |

Files changed vs base: 14 (502 insertions, 150 deletions) —
the 5 NB4 page files, the 6 ADNX15 list-page files,
`components/ui.tsx` (last-filters helpers + sweep),
`components/AdminShell.tsx` and `components/CommandPalette.tsx`
(sweep only). No other file touched.

## NOT BUILT / DEFERRED (explicit)

1. **Screenshot / browser QA — NOT done** (NB5 / ADNX16).
   Nothing here claims visual QA. Specific things NB5 should
   check: the Settings chip rail sticking correctly above the
   quick bar on a small phone; the dirty dot's visibility on an
   active chip/aside item; the Security sessions card-table at
   360px; the TOTP input's taller tap target; search recents
   chips wrapping.
2. **Field-level errors for the config/general Settings blocks —
   NOT BUILT.** No client-side validation exists on those blocks
   at base (validation is server-side; several saves are
   provider-verified during the save). Their errors surface as
   error toasts through the same call. Inventing client rules
   (formats, ranges) would risk rejecting values the server
   accepts — a behaviour change outside this batch's mandate.
   The one form with a real client check (Announcement) got
   true field-level errors.
3. **Unsaved-changes click interception inside the app — NOT
   BUILT as a separate mechanism.** The warning is
   `beforeunload`, which covers every exit from the page because
   shell navigation is full-document (`<a href>`). There is no
   client-side router transition in the shell to intercept; if
   the shell ever moves to `<Link>`, this needs a router-level
   guard — noted for that day.
4. **Settings section-switch warning — deliberately NOT built:**
   unselected sections are hidden, never unmounted, so switching
   cannot lose edits (see ADNX13). A warning there would be
   friction without a risk behind it.
5. **SavedViews for billing / alerts / admins / social-ops and
   for usage's main ranking — NOT built**, per the audit table:
   those pages have no filter state to save. If a filter is ever
   added to one of them, the wiring pattern is the payouts one.
6. **Login brand-panel footer `text-slate-600` — left as-is.**
   The mandated sweep is the NB1-measured `text-slate-500`
   class; slate-600 occurrences (here and in the SavedViewsBar
   hint) predate ADNX and were left by NB2/NB3 on the same
   reasoning. Flagged so NB5's visual pass can judge it with
   eyes on it rather than by grep.
7. **Security's Admins list (TOTP tab) and API-key list kept
   their `<ul>` form.** Only the sessions list was mandated to
   DataTable; the other two are short rosters inside cards, not
   tables. Candidate for a later polish pass if the owner wants
   every list on the component.
