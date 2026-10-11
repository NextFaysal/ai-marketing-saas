# Admin Advanced AA3 — Verify for the Five Blind-Save Config Blocks: Acceptance

**Status:** Delivered (local commit; not pushed). Plan: `docs/admin-advanced-plan.md` (audit ref C3).

## What shipped

Five new SUPER-only endpoints mirroring the existing test-llm/test-image/test-email/test-sms pattern, each performing the cheapest **real** authentication-shaped call against the provider with the **effective** config (admin → env), saving nothing:

`POST /admin/platform-config/test-meta | test-sslcommerz | test-bkash | test-tiktok | test-google`

Unlike the older four (which throw), these **return** `{ ok, latencyMs, detail, … }`: a missing config is an honest `ok:false` result ("configure করা নেই…"), never a 500, and a rejection carries the provider's own words in `detail`. The Settings page gains a "🧪 যাচাই করুন" button on each of the five cards, rendering the detail + latency.

## Per-block probe classification — what each check does and does not prove

| Block | Probe | Classification |
|---|---|---|
| **Meta** | `GET graph.facebook.com/{version}/oauth/access_token?grant_type=client_credentials` with the configured App ID/Secret. Meta mints an **app access token** only for a valid app credential pair. | **True credential proof** → also runs as **verify-before-save** (failure: save refused, verbatim Meta error, `platform_config_verify_failed` audited — the SP4 image precedent). Success returns `metaVerification` on the save response. |
| **bKash** | `POST {bkashBase}/token/grant` — the exact tokenized-checkout grant the payments code performs (username/password headers, app_key/app_secret body). Success requires an `id_token`; the token is **discarded**, never stored or returned. | **True credential proof** → also **verify-before-save** (same refusal + audit discipline). Success returns `bkashVerification` on the save response. |
| **SSLCommerz** | Session init (`POST /gwprocess/v4/api.php`) with a minimal throwaway payload (`tran_id` prefixed `ADMIN-VERIFY-`, 10 BDT). A `SUCCESS` + GatewayPageURL response proves the gateway accepted the store credentials; a `failed_reason` matching store/password/credential is reported as a credential rejection, verbatim; any other failure is reported **inconclusive** in those words. | **Gateway-acceptance proof, test button only.** Deliberately **not** verify-before-save: init creates an inert (unpaid, self-expiring, non-billable) session record on the gateway — an operator pressing "যাচাই করুন" consents to that; silently creating one on every save would be a hidden side effect. There is no merchant-info/credential endpoint in SSLCommerz's public API that avoids a session-shaped call (the validation API requires a `val_id` from a real transaction), which is why init is the probe. |
| **TikTok** | `POST open.tiktokapis.com/v2/oauth/token/` with a deliberately-invalid authorization code. Rests on TikTok's documented OAuth error semantics: `invalid_client` = the client credentials themselves were rejected (verbatim description returned); any other structured error (`invalid_grant`/`invalid_request`) is only returned **after** the client authenticated, i.e. the bogus code — not the credentials — was refused. | **Client-auth proof, partial.** Proves Client Key/Secret are accepted by TikTok. Does **not** prove redirect-URI registration, scope approval, or the app audit — the detail text says exactly this ("প্রমাণের সীমা…"). Test button only. |
| **Google** | `POST oauth2.googleapis.com/token` with a deliberately-invalid `refresh_token`. Rests on Google's documented distinction: `invalid_client` = client authentication failed (bad ID or secret); `invalid_grant` is returned only after the client authenticated, for a bad grant. | **Client-auth proof, partial.** Proves the Client ID/Secret pair is recognized by Google. Does **not** prove redirect-URI registration or that the YouTube Data API is enabled — the detail text says exactly this. Test button only. |

Verify-before-save scope decision, restated: only where the probe is (a) a true credential proof and (b) free of side effects — Meta and bKash. That is the same bar the SP4 image verify set.

## Evidence

- New spec `apps/api/src/admin/aa3-config-verify.spec.ts` — 12 tests, all passing, with `fetch` stubbed at the provider boundary and fixtures modelling each provider's documented response shapes: unconfigured honesty (fetch never called); Meta save-verify success + verbatim failure + save refusal with no row written and the audit entry asserted; bKash grant success (asserting the credentials really are transmitted to bKash while a canary password and the granted token never appear in any response), grant-refusal save refusal, env-sourced config verifying with an empty settings store (test calls persist nothing); SSLCommerz success/rejection/inconclusive three-way classification + throwaway `tran_id` labelling asserted on the wire; TikTok and Google `invalid_client` vs code/token-error distinction; all five routes carry `@AdminTier("SUPER")`.
- Harness note: `phase-m33.spec.ts`'s meta-sealing test predates verify-before-save; it gained a one-line fetch stub answering the app-token probe (an app-token success) — its assertions are unchanged, the same harness-adaptation pattern earlier packages used when a real behaviour landed under older fakes.
- **Ceiling, stated plainly:** the sandbox has **no real provider credentials and no Postgres** — no probe in this batch ever received a real provider response. Everything above is proven against fixtures at the client boundary + the full suite + builds. The TikTok/Google invalid_client distinction and SSLCommerz `failed_reason` wording follow the providers' documented behaviour; the first live click on each "যাচাই করুন" button (by the owner, with real credentials in the Admin Panel) is the true end-to-end proof, and each button's detail text is written to be honest about what it established either way.

## Not in AA3

- Ad Library token (Meta) is not separately probed — the app-token mint covers the App ID/Secret pair, which is the credential the platform app's other calls depend on.
- No probe results are cached or stored; every test click is a fresh provider call.
