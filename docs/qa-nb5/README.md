# NB5 QA screenshots (ADNX16) — index

Captured 2026-10-16 in the sandbox from the production build of
this worktree (`pnpm build` + `pnpm start`, port 3001) with Chrome
Headless Shell 155.0.8059.84 (Chrome for Testing, downloaded to
/tmp as a QA-only tool — NOT an app dependency). Every image below
was opened and eyeballed by the coordinator; per-image verdicts are
in `docs/admin-design-nb5-acceptance.md`. These cover ONLY the
surfaces reachable without a live API + operator auth. All
authenticated pages redirect to `/login` when unauthenticated
(proven in-browser: final URL `/login` for `/`, `/orgs`,
`/settings`), so NO authenticated screenshot exists in this set
and none is claimed. The full authenticated pass is the
post-deploy checklist: `docs/admin-design-next-live-qa-checklist.md`.

| File | Page / state | Width | Verdict |
|---|---|---|---|
| `login-360.png` | `/login` | 360 | PASS — single card, no overflow, Bengali in Hind Siliguri, inputs + button full-width |
| `login-768.png` | `/login` | 768 | PASS — centred card (brand panel is lg-only), generous margins |
| `login-1280.png` | `/login` | 1280 | PASS — brand panel + form split; footer (ADNX17 slate-400 bump) readable |
| `totp-360.png` | `/login/totp` | 360 | PASS — tall code input (large tap target), card fits, no overflow |
| `totp-768.png` | `/login/totp` | 768 | PASS — centred card, same pattern as login |
| `totp-1280.png` | `/login/totp` | 1280 | PASS — centred card on the dark system |
| `notfound-before-default-360.png` | unknown URL, BEFORE the NB5 fix | 360 | **DEFECT (fixed)** — Next.js default white 404, off-system |
| `notfound-360.png` | unknown URL, AFTER the NB5 fix | 360 | PASS — branded dark 404 card, Bengali, back-to-home action |

Companion measurement (same browser, puppeteer-core over CDP):
`scrollWidth == innerWidth` at 360/390/768/1024/1280/1920 on
`/login` and `/login/totp` — zero page-level horizontal overflow.
The only off-canvas element at ≥1024 is the login brand panel's
decorative `pointer-events-none` glow (left −128px by design); it
creates no page scroll (scrollWidth still equals innerWidth).
