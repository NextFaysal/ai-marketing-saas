# Admin Design Next — POST-DEPLOY Live Screenshot QA Checklist (ADNX16)

- **Status: NOT EXECUTED.** Every box below is unchecked on purpose.
  This checklist runs ONLY after the ADNX release is integrated,
  pushed on the owner's explicit instruction, and deployed (Dokploy
  Redeploy), against the LIVE admin (admin.qosprey.com) with a real
  operator login. NB5's sandbox pass (see
  `admin-design-nb5-acceptance.md`) covered only the unauthenticated
  login/TOTP surfaces and a static code audit — it does NOT close
  any box here.
- **How to run:** for each page, open at each width, once with real
  data (filled) and once on an org/state with no data (empty) where
  applicable; screenshot, compare against the responsive rules in
  the plan §৩ (no page-level horizontal scroll; tables in card form
  on mobile; primary action reachable), then tick the box.
- **Widths:** 360 · 390 · 768 · 1024 · 1280 · 1920 for every page.

## Per-page matrix (22 pages × 6 widths × filled/empty)

### `/` Command Center
- [ ] 360px filled
- [ ] 390px filled
- [ ] 768px filled
- [ ] 1024px filled
- [ ] 1280px filled
- [ ] 1920px filled
- [ ] 360px empty (no counts present)
- [ ] 1280px empty (no counts present)

### `/analytics`
- [ ] 360px filled
- [ ] 390px filled
- [ ] 768px filled
- [ ] 1024px filled
- [ ] 1280px filled
- [ ] 1920px filled
- [ ] 360px empty
- [ ] 1280px empty
- [ ] Chart at 360px with 12 months shown (bars narrow — readability check, NB3 flag)

### `/orgs`
- [ ] 360px filled
- [ ] 390px filled
- [ ] 768px filled
- [ ] 1024px filled
- [ ] 1280px filled
- [ ] 1920px filled
- [ ] 360px empty (filter matches nothing)
- [ ] 1280px empty (filter matches nothing)

### `/orgs/[id]` Org Detail
- [ ] 360px filled
- [ ] 390px filled
- [ ] 768px filled
- [ ] 1024px filled
- [ ] 1280px filled
- [ ] 1920px filled
- [ ] **Toast-overlap check (NB2 flag):** trigger a toast (e.g. note add) at 360px — the toast stack (fixed at bottom 76px) must not hide the fixed mobile detail action bar; note what actually happens
- [ ] Quick-view drawer full-width behaviour at 360px

### `/users`
- [ ] 360px filled
- [ ] 390px filled
- [ ] 768px filled
- [ ] 1024px filled
- [ ] 1280px filled
- [ ] 1920px filled
- [ ] 360px empty (filter matches nothing)
- [ ] 1280px empty (filter matches nothing)

### `/users/[id]` User Detail
- [ ] 360px filled
- [ ] 390px filled
- [ ] 768px filled
- [ ] 1024px filled
- [ ] 1280px filled
- [ ] 1920px filled
- [ ] **Toast-overlap check (NB2 flag):** same as Org Detail — toast vs fixed mobile action bar at 360px

### `/billing`
- [ ] 360px filled
- [ ] 390px filled
- [ ] 768px filled
- [ ] 1024px filled
- [ ] 1280px filled
- [ ] 1920px filled
- [ ] 360px empty (a tab with no rows)
- [ ] KPI snap rail scrolls cleanly at 360px

### `/payouts`
- [ ] 360px filled
- [ ] 390px filled
- [ ] 768px filled
- [ ] 1024px filled
- [ ] 1280px filled
- [ ] 1920px filled
- [ ] 360px empty (status with no requests)

### `/tickets`
- [ ] 360px filled (list)
- [ ] 390px filled (list)
- [ ] 768px filled
- [ ] 1024px filled
- [ ] 1280px filled
- [ ] 1920px filled
- [ ] 360px empty (filter matches nothing)
- [ ] **Tickets-sheet check (NB3 flag):** conversation opens as a full-screen sheet at 360px, overlays shell topbar/quickbar as designed (z-45), back button returns to the list
- [ ] Filter chip rail scrolls horizontally at 360px without wrapping the page

### `/audit`
- [ ] 360px filled
- [ ] 390px filled
- [ ] 768px filled
- [ ] 1024px filled
- [ ] 1280px filled
- [ ] 1920px filled
- [ ] 360px empty (filter matches nothing)
- [ ] **Drawer check (NB3 flag):** detail drawer is full-width at 360px and closes with ✕ / scrim / Escape

### `/health`
- [ ] 360px filled
- [ ] 390px filled
- [ ] 768px filled
- [ ] 1024px filled
- [ ] 1280px filled
- [ ] 1920px filled
- [ ] Traffic-light summary visible in the first screen at 360px

### `/alerts`
- [ ] 360px filled
- [ ] 390px filled
- [ ] 768px filled
- [ ] 1024px filled
- [ ] 1280px filled
- [ ] 1920px filled
- [ ] 360px empty (no active alerts)
- [ ] Severity groups collapse/expand on mobile

### `/social-ops`
- [ ] 360px filled
- [ ] 390px filled
- [ ] 768px filled
- [ ] 1024px filled
- [ ] 1280px filled
- [ ] 1920px filled
- [ ] **Mobile tab switch check (NB3 flag):** Social ↔ Ads tab switch at 360px keeps state, no layout jump

### `/system`
- [ ] 360px filled
- [ ] 390px filled
- [ ] 768px filled
- [ ] 1024px filled
- [ ] 1280px filled
- [ ] 1920px filled
- [ ] Each tab (Queues / Errors / Backup / Readiness / Logs) checked at 360px; the three unconverted raw tables scroll inside their container, never the page

### `/growth`
- [ ] 360px filled
- [ ] 390px filled
- [ ] 768px filled
- [ ] 1024px filled
- [ ] 1280px filled
- [ ] 1920px filled
- [ ] Referral per-plan 3-column numeric grid at 360px — labels wrap, inputs usable

### `/usage`
- [ ] 360px filled
- [ ] 390px filled
- [ ] 768px filled
- [ ] 1024px filled
- [ ] 1280px filled
- [ ] 1920px filled
- [ ] 360px empty
- [ ] Ranking table in card form at 360px

### `/security`
- [ ] 360px filled
- [ ] 390px filled
- [ ] 768px filled
- [ ] 1024px filled
- [ ] 1280px filled
- [ ] 1920px filled
- [ ] **Sessions card-table check (NB4 flag):** sessions DataTable reads as cards at 360px, revoke action reachable

### `/settings`
- [ ] 360px filled
- [ ] 390px filled
- [ ] 768px filled
- [ ] 1024px filled
- [ ] 1280px filled
- [ ] 1920px filled
- [ ] **Chip-rail check (NB4 flag):** section chip rail sticks above the quick bar on a small phone while scrolling a long section
- [ ] **Dirty-dot check (NB4 flag):** after editing a field, the dirty dot is visible on the active chip AND the desktop aside item
- [ ] Hash deep-link (`/settings#payment-bkash`) lands on the right block at 360px and 1280px
- [ ] beforeunload warning appears when leaving with unsaved edits

### `/admins`
- [ ] 360px filled
- [ ] 390px filled
- [ ] 768px filled
- [ ] 1024px filled
- [ ] 1280px filled
- [ ] 1920px filled

### `/search`
- [ ] 360px with results
- [ ] 390px with results
- [ ] 768px with results
- [ ] 1024px with results
- [ ] 1280px with results
- [ ] 1920px with results
- [ ] 360px no results
- [ ] **Recents wrap check (NB4 flag):** recent-search chips wrap cleanly at 360px

### `/login`
- [ ] 360px
- [ ] 390px
- [ ] 768px
- [ ] 1024px
- [ ] 1280px
- [ ] 1920px
- [ ] Wrong-password error renders inline (alert) and readable at 360px

### `/login/totp`
- [ ] 360px
- [ ] 390px
- [ ] 768px
- [ ] 1024px
- [ ] 1280px
- [ ] 1920px
- [ ] **TOTP target check (NB4 flag):** code input tap target is comfortably tall at 360px; on-screen keyboard does not hide the submit button

## The 5 mobile journeys (360px, real data, count the steps)

- [ ] **Payout approve:** Command Center → Payouts → approve a pending payout with confirm modal → success toast. Steps: ___ (target: no more than before ADNX, fewer on mobile)
- [ ] **Ticket reply:** Tickets → open → reply → sent feedback visible. Steps: ___
- [ ] **Config change:** Settings → change one config value via chip rail → save → toast; dirty dot appeared before save. Steps: ___
- [ ] **Failed-job retry:** Health → failed job → retry → toast/result. Steps: ___
- [ ] **Org search:** Ctrl+K-equivalent on mobile (search) → find an org → land on its detail. Steps: ___

## Cross-cutting visual checks

- [ ] No page-level horizontal scroll on ANY page at 360px (scroll each to the bottom)
- [ ] Quick bar never covers a page's primary action at 360px
- [ ] Command Palette is full-screen on mobile and keyboard/Escape behaviour works
- [ ] Density toggle (comfortable/compact) applies on every page
- [ ] Tickets message bubbles (pre-existing light inline backgrounds, NB3-deferred) judged with eyes on them — restyle or accept, and record the decision
- [ ] Login footer `text-slate-600` judged on the real screen (NB5 bumped it to slate-400 in code — verify it now reads clearly; see NB5 acceptance)

*End of checklist — execution is owner-gated (deploy first). Nothing
in NB5's sandbox work ticks any box above.*
