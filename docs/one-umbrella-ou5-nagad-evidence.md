# OU5 — Nagad checkout: verify-first evidence record (2026-10-16)

## Verdict: NOT BUILT (checkout) — honest refusal kept

Nagad API checkout was **not** wired. The contract could not be
evidenced from an official primary source, and the standing rule
is: no integration is written from unverified secondary sources.

## What was fetched / searched (official sources only would count)

- `browser_search`: "Nagad merchant checkout API official
  developer documentation nagad.com.bd" — results were a LinkedIn
  blog post, a blog (freelearning365.com) and community GitHub
  repositories. No nagad.com.bd documentation page.
- `browser_search`: `site:nagad.com.bd developer API merchant
  integration` — **no results found**.
- `browser_search`: `"developer.nagad.com.bd" payment gateway
  checkout initialize` — again only the same blogs and community
  GitHub repos; the portal itself is referenced by third parties
  but carries no fetchable public documentation in the results.
- `browser_open` on the developer portal
  (https://developer.nagad.com.bd) — fetch failed: the URL was
  not resolvable/fetchable by the reader. Not retried.

## What secondary sources claim (NOT evidence, not used)

Blogs/community repos describe a redirect flow —
initialize → customer approval → callback → server-side
complete/verify, with Merchant ID + public/private keys — but no
officially published source in hand states the exact:

- initiation endpoint + request envelope on an official domain;
- sensitive-data encryption and signature construction
  (algorithm, field order, key format) needed to sign requests
  and verify callbacks;
- server-side verification call contract and its success values;
- IP-whitelisting / sandbox provisioning terms.

Without those, any implementation would be a guess at a
money-moving signature scheme — exactly what verify-first
forbids. The existing stored credential shape
(`TenantNagadCreds { merchantId, privateKey }`) also lacks the
Nagad gateway public key that third-party write-ups mention,
which further confirms the contract is not evidenced in-repo.

## What shipped instead

- The honest refusal stays in `TenantPaymentsService`
  (own-path, platform-path and sandbox-test initiation all
  refuse), now with the reason stated in the merchant-facing
  message.
- The Connect Center Nagad card
  (`apps/web/src/components/connect/payment-gateway-panel.tsx`)
  explains why there is no API checkout, what the saved config
  is for, and the working alternatives: manual Nagad number
  (Settings → payment note) for taking payment, and the Refund
  Center (OU5 item 2) for tracking merchant-panel refunds.
- Nagad refunds are handled by the manual Refund Center — no
  refund API is claimed either.

## Live-verification checklist (owner / merchant onboarding)

- [ ] Obtain Nagad merchant account + the OFFICIAL API
      integration document from Nagad (merchant onboarding /
      developer portal access), including sandbox credentials
      (Merchant ID, merchant private key, Nagad public key).
- [ ] Evidence from that document: initiation endpoint +
      envelope, encryption/signature construction, callback
      parameters, and the server-side verification call with
      its exact success status/amount fields.
- [ ] Whitelist the production server IP with Nagad if the
      document requires it; record the callback URL Nagad
      registers.
- [ ] Only then: wire initiation (never marks paid) +
      server-side verified completion (marks `verified_paid`
      exactly once, bad signature/verification rejected) behind
      the existing per-org gateway config with
      verify-before-save, with specs, in a follow-up item.
- [ ] Run one sandbox payment end-to-end and one real low-value
      live payment; confirm the order is paid only after the
      verified completion, never on initiation/return.
