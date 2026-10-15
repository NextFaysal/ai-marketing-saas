# AN16 — Nagad Platform Feasibility Spike (research only, no code)

Admin Next AB4 · Researched 2026-10-15 · Question from
`Admin-Next-Plan-2026-10-15.md` §AB4 (AN16).

## The question

Can the **platform** offer Nagad API checkout the way CC10 offers
SSLCommerz + bKash — i.e. the platform's own merchant account
collects payments on behalf of tenants and the verified proceeds
credit each tenant's Wallet? (This is NOT the CC9 question —
a tenant connecting their *own* gateway is a different model.)

## Verdict: NO-BUILD (as a platform / CC10 item)

**No documented aggregator, sub-merchant, marketplace or
split-settlement model for Nagad exists in any source reviewed.**
Every documented Nagad integration is bound to a *single*
merchant: that merchant's own Merchant ID, that merchant's own
self-generated RSA key pair (public key uploaded to Nagad's
portal), and settlement to that merchant's own account. A
platform merchant collecting on behalf of tenants is therefore
not an integration Nagad documents — building CC10-Nagad would
mean inventing a collection model (and holding tenant funds
through an undocumented arrangement), which this project does
not do. Nagad stays exactly as CC9 left it: a tenant-side
"configured" gateway with no API checkout wired anywhere.

A *separate, future* item is conceivable on the CC9 side —
wiring the documented single-merchant checkout for tenants who
bring their **own** Nagad merchant account (keys + Merchant ID
per tenant). That path is documented (see §1). It is not part
of this verdict, not part of AN16's platform question, and
would need its own approval.

## Evidence

### 1. A documented merchant (hosted/API) checkout exists — per-merchant

- The official integration document, *Nagad Online Payment API
  Integration Guide* (v3.3 copies circulate; authored by Kona
  Software Lab Limited, Nagad's technology provider), describes
  onboarding as: register as a merchant through the Portal →
  obtain a Merchant ID → generate a merchant RSA key pair,
  upload the public key, download Nagad PG's RSA public key.
  Credentials are issued **to every merchant** individually —
  the Merchant ID "is a unique identifier provided to every
  merchant" and is part of that merchant's own credentials.
  Source (copy of the official guide):
  https://www.scribd.com/document/684746071/Nagad-Online-Payment-API-Integration-Guide-v3-3
- The flow in the same guide: initialize → customer enters
  account number → OTP → PIN on Nagad's side → redirect to the
  merchant callback URL with a transaction id → **the merchant
  server verifies the transaction with the Nagad platform**
  before processing the order.
- Third-party developer guides summarising the same public API
  give the concrete endpoints (labelled third-party, not
  sighted on an official public page — see "Access limits"):
  `POST /check-out/initialize/{merchantId}/{orderId}`,
  `POST /check-out/complete/{merchantId}/{orderId}` (verify),
  base `https://api.nagad.com.bd/remote-payment-gateway-1.0/api/dfs`
  (sandbox `https://sandboxapi.nagad.com.bd/…`).
  Sources:
  https://github.com/humayunshariarhimu/nagad-api and
  http://www.freelearning365.com/2026/07/nagad-payment-gateway-integration-complete-guide.html
  — note every endpoint is keyed by the single `{merchantId}`.
- Merchant onboarding requires the merchant's own business
  documentation (trade license, TIN, bank account) and IP
  whitelisting for production (third-party guide summary of
  the registration process, same source as above). Settlement
  is to that merchant's own account — there is no documented
  notion of funds landing anywhere else.

### 2. Aggregator / platform / sub-merchant model — not documented

- Searches of Nagad's public web presence and the developer
  ecosystem (2026-10-15) for an aggregator/PSP/sub-merchant/
  marketplace/split-settlement offering returned **nothing**:
  no sub-merchant onboarding API, no "on behalf of" collection,
  no per-tenant split or commission mechanics, no platform
  merchant tier. A targeted `site:nagad.com.bd` search for
  aggregator/marketplace/platform terms found no pages at all.
- The contrast is instructive: SSLCommerz *is* itself an
  aggregator with a documented platform usage in this codebase,
  and bKash's merchant API is documented publicly at
  developer.bka.sh. For Nagad, the only documented relationship
  is one merchant ↔ Nagad.
- Conclusion stated exactly: **the official documentation
  reviewed is silent on any platform model** — and because
  merchant credentials, keys and settlement are all
  single-merchant by construction, the silence is structural,
  not an oversight this spike can paper over.

### 3. Callback / verification ("IPN") mechanism

- No separate server-to-server IPN/webhook endpoint is
  documented. The documented pattern is: browser **callback
  redirect** to the merchant's callback URL + **mandatory
  server-side verification** — the merchant calls the
  complete/verify API with the `paymentReferenceId` and only
  trusts that result (the third-party guides state this
  explicitly: "Do not trust this redirect alone").
- Response authenticity is cryptographic: payloads carry RSA
  signatures — the merchant verifies with Nagad PG's public
  key using **SHA1withRSA**, and sensitive data is RSA-
  encrypted in both directions (merchant signs/encrypts with
  its own keys; Nagad encrypts responses with the merchant's
  uploaded public key). (Official guide, §"Signature
  Verification", source in §1.)

### 4. Refund API

- A refund endpoint appears in the third-party summaries of
  the same API: `POST /check-out/refund/{merchantId}` (sources
  in §1). The official-guide excerpts reviewed for this spike
  did not include a refund chapter, so this is recorded as
  **third-party-attested, not sighted in the official guide**
  — and it is, again, keyed by the single merchantId.

## Access limits (honesty)

- Nagad's developer portal (developer.nagad.com.bd) could not
  be fetched from this sandbox on 2026-10-15 (fetch failed
  without an HTTP status). Nagad appears to distribute its
  full documentation to *registered merchants during
  onboarding* (independent archives of the onboarding e-mails
  and guide copies exist, e.g.
  https://github.com/codernayeem/payment-sms-courier-api-docs/blob/HEAD/payment-gateways/nagad/README.md),
  not as a publicly browsable developer site like bKash's.
- Accordingly: claims about the merchant checkout rest on the
  official guide itself (via a hosted copy); endpoint strings
  and onboarding-detail claims rest on labelled third-party
  summaries that agree with each other and with the guide's
  model. No claim in this doc rests on a blog presented as
  official fact.
- What would change the verdict: Nagad publishing (or issuing
  to the operator, as a registered merchant) documentation of
  an aggregator/sub-merchant collection model. Until then the
  NO-BUILD stands, in the same way Rocket's did (manual number
  only, no API gateway) in CC9/CC10.

## Sources (accessed 2026-10-15)

Official / official-guide copies:
- Nagad Online Payment API Integration Guide v3.3 (Kona
  Software Lab) — https://www.scribd.com/document/684746071/Nagad-Online-Payment-API-Integration-Guide-v3-3

Third-party (labelled, used only where marked above):
- https://github.com/humayunshariarhimu/nagad-api
- http://www.freelearning365.com/2026/07/nagad-payment-gateway-integration-complete-guide.html
- https://github.com/codernayeem/payment-sms-courier-api-docs/blob/HEAD/payment-gateways/nagad/README.md
