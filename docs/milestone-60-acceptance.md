# Milestone 60 Acceptance — PWA Mobile Experience

## Delivered
- [x] **Installable manifest** (`apps/web/src/app/manifest.ts`,
      served by Next at `/manifest.webmanifest`): name
      "AI Marketing OS — Qosprey", short_name "Marketing OS",
      `start_url: /dashboard`, `scope: /`, `display: standalone`,
      `lang: bn`, theme `#4f46e5` / background `#f5f6fa` matching
      the app. Root layout also emits the manifest link, theme-color
      viewport and apple-touch-icon metadata.
- [x] **Real icons, honestly sourced.** The repo has NO source logo
      artwork, so the icons were generated programmatically —
      `apps/web/scripts/generate-pwa-icons.mjs` (dependency-free:
      node:zlib PNG encoder + geometric drawing of the product's
      gradient rounded-square "Q" mark, ring + tail). Outputs:
      `icon-192.png`, `icon-512.png` (purpose any),
      `icon-maskable-512.png` (full-bleed, mark at 62% in the safe
      zone), `apple-touch-icon.png` (180×180). All are genuine PNGs
      (magic bytes verified) and re-generatable from the committed
      script.
- [x] **Hand-rolled service worker** (`apps/web/public/sw.js`) —
      **dependency decision: no new package.** next-pwa on Next 15
      was judged a compatibility risk not worth taking for a worker
      this small; the hand-rolled worker is ~100 lines and fully
      auditable. Caching rules (also documented at the top of the
      file):
      1. Only GET requests are intercepted.
      2. **API traffic is never cached or intercepted** — everything
         under `/backend` (the same-origin API proxy) and `/api`
         passes straight through, including auth and the inbox
         realtime stream.
      3. Immutable build assets (`/_next/static/*`) and `/icons/*`
         are cache-first (content-hashed URLs).
      4. Navigations are network-first; offline they fall back to
         the cached copy of that page, then to `/offline`.
      5. Auth pages (`/login`, `/register`, `/reset-password`,
         `/view-as`, `/accept-invite`) are never stored in the page
         cache.
      6. Other same-origin statics are stale-while-revalidate.
      Old cache versions are deleted on activate; `VERSION` bumps
      invalidate everything.
- [x] **Offline fallback page** (`/offline`, fully static, zero
      data fetching): Bengali copy that says plainly live data
      (inbox/orders) is NOT shown offline rather than presenting
      stale data as current, with retry/dashboard links. Precached
      by the worker at install.
- [x] **Install-prompt UX without nagging** (`components/pwa.tsx`):
      `SwRegister` (root layout) registers the worker in production
      builds only and stashes `beforeinstallprompt`;
      `InstallButton` (dashboard topbar) renders ONLY when the
      browser has actually offered installation, disappears in
      standalone mode, and a single dismissal — via the ✕ or a
      dismissed browser prompt — is remembered in localStorage and
      never shown again.
- [x] **Inbox-first mobile bottom navigation** (dashboard layout,
      `lg:hidden`): 💬 ইনবক্স · 📦 অর্ডার · 🤖 AI সহকারী · ☰ আরও
      (আরও opens the existing full drawer — no second nav system).
      Fixed, thumb-reachable, safe-area-inset aware, active-state
      aware; a matching spacer under `<main>` keeps it from covering
      content. Desktop layout untouched.
- [x] **Inbox mobile check:** the inbox page already implements a
      deliberate small-screen pattern (conversation list ↔ chat swap
      via `mobileChat`, a mobile-only back button, mobile quick
      actions incl. tap-to-call, wrapping chips, `max-w-[80%]`
      bubbles) — inspected across the file; no genuine breakage
      found, so per the milestone's rule no redesign was done.

## Verification
- Live (sandbox, web restarted on the new build):
  `GET /manifest.webmanifest` → 200 `application/manifest+json`
  with the fields above; `GET /sw.js` → 200 JavaScript with the
  documented rules; `GET /offline` → 200 with the Bengali offline
  copy; all four icons → 200 `image/png`; served HTML head carries
  `rel="manifest"`, `theme-color`, and the apple-touch-icon; the
  service-worker registration + install-prompt code is present in
  the built layout chunks.
- Web unit tests: 20 pass (unchanged). Full monorepo build green.
- API suite: 586 pass / 83 suites — M60 changes no API code; the
  count rose from the M59 run's 580/82 because the parallel
  hardening track's M61 (rate limiting) landed on HEAD in between.
- **Honest limit:** true install behaviour (the browser's install
  banner, standalone launch, offline navigation on a real device)
  cannot be exercised from this sandbox — no real-device/browser
  pass was run and no Lighthouse or audit scores are claimed.
  What is proven is that every artifact the platform requires is
  served correctly and the registration code ships in the build.

## Roadmap note
M60 completes Batch 5 (M58 → M59 → M60) and with it the whole
owner-approved **Next-Level program M50–M60**. Remaining known
follow-ups outside this program: Bengali font embedding for the
M53 PDFs, logo image embedding in PDFs, custom-domain routing
(hosting-panel side), and a real-device PWA pass.
