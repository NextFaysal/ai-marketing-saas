# GB4 — Gateway Research: ShurjoPay & aamarPay (AmarPay)

Date: 2026-10-15 · Research only, no code changed.
Sources: official provider sites / developer portals / official GitHub organisations only.
Third-party blogs, tutorials and unofficial packages were excluded as evidence.
All statements below are paraphrased summaries of the cited official pages, with the
source URL after each claim.

Project rule being tested (same as SSLCommerz / bKash in this codebase): an order may
be marked paid **only** after an independent server-side query to the provider
confirms success **and** exact amount + currency match. A gateway that can be
initiated but not independently verified is a NO-BUILD.

Note on naming: the provider spelled "AmarPay" in the brief is officially
**aamarPay**. — https://aamarpay.com/

---

## 1. ShurjoPay

### 1.1 Initiation (hosted checkout)

- Current integration is REST/JSON, described by the provider as a small set of
  APIs, and its official plugins target gateway **v2.1** with three operations:
  authenticate, make a payment, verify a payment. — https://github.com/shurjopay-plugins/sp-plugin-php
- Step 1 — token: `POST /api/get_token` on the API base, sending the merchant
  username and password as JSON; the returned token is then sent in the
  Authorization (Bearer) header for later calls. — https://documenter.getpostman.com/view/6335853/U16dS8ig
- Step 2 — checkout: `POST /api/secret-pay`, sending (among others) the token,
  merchant prefix, store_id, amount, merchant order_id, currency, customer
  name/address/phone/city/postcode, client_ip, and return/cancel URLs. — https://documenter.getpostman.com/view/6335853/U16dS8ig
- The response carries a `checkout_url`; the official Node plugin instructs the
  merchant to redirect the buyer to that URL to pay. — https://github.com/shurjopay-plugins/sp-plugin-nodejs
- Credentials model: per-merchant username + password + prefix (+ store_id used
  at checkout). No computed HMAC signature is described in the official material
  reached; authentication is the token flow above. — https://documenter.getpostman.com/view/6335853/U16dS8ig
- Production base used in the provider's own usage examples is the engine host
  under `shurjopayment.com` (`/api/`), distinct from the sandbox host below. — https://github.com/shurjopay-plugins/sp-plugin-usage-examples/blob/HEAD/dotnetcore-webmvc-app-dotnet-plugin/README.md

### 1.2 Server-side verification (decisive)

- **Independent verification exists.** The official Postman documentation lists
  `POST /api/verification` taking the ShurjoPay order_id, authorised with the
  merchant token. — https://documenter.getpostman.com/view/6335853/U16dS8ig
- A second official endpoint, `POST /api/payment-status` with the same order_id,
  is listed for checking payment details/status, and the official plugins expose
  it as `paymentStatus()` alongside `verifyPayment(order_id)`. — https://documenter.getpostman.com/view/6335853/U16dS8ig and https://github.com/shurjopay-plugins/sp-plugin-nodejs
- Therefore the return/redirect to the merchant return URL must **not** be
  trusted on its own: the server can (and in this project must) call
  verification with the ShurjoPay order_id, require a success status, and compare
  the returned amount and currency against the local order before marking paid.
- Caveat found during research: the fetched Postman page shows request shapes
  but no rendered response bodies, and the fuller Google-Docs API guide linked
  from the official GitHub hub did not render as readable text in this research
  session. Exact verification-response field names/codes must therefore be
  pinned from a real sandbox call during build, before any live use. — https://github.com/shurjopay-plugins and https://docs.google.com/document/d/19J4HE0j873nBJqcN-uRBYYAa_qBA3p1XSY-jy2fwvEE/edit?usp=sharing
- No separate IPN/webhook mechanism was documented in the official pages
  reached; the documented confirmation path is the merchant-initiated
  verification / payment-status query above. — https://documenter.getpostman.com/view/6335853/U16dS8ig

### 1.3 Sandbox

- Publicly documented sandbox base: `https://sandbox.shurjopayment.com`, with a
  published sandbox username, password and transaction prefix on the provider's
  own developer page, so integration testing needs no prior onboarding. — https://shurjopay.com.bd/developers/intregration-howto
- The same page states live credentials are issued only after onboarding (see
  1.4). — https://shurjopay.com.bd/developers/intregration-howto

### 1.4 Merchant onboarding

- The provider's developer page states that after onboarding the merchant
  receives personalised live credentials (username, password, prefix) by email
  from its support team, and only then can live endpoints be used. — https://shurjopay.com.bd/developers/intregration-howto
- The provider's main site describes a registration form followed by document
  submission and verification by its acquisition team, listing in summary:
  trade licence, TIN, business bank account and NID, plus its prescribed
  application / terms forms (its FAQ adds items such as photos and a
  sub-merchant agreement). — https://shurjopay.com.bd
- The same site states a separate bank account is used, with settled funds
  transferred to the merchant's business account on a weekly settlement
  schedule. — https://shurjopay.com.bd
- No fee / commission schedule was stated on the official pages reached; the
  main site says the acquisition team provides a quotation after registration. — https://shurjopay.com.bd

### 1.5 Refund

- **No documented refund API endpoint was found** in the official developer
  page, Postman documentation or official plugins reached. — https://documenter.getpostman.com/view/6335853/U16dS8ig
- The main site describes dispute/refund handling as a manual process decided
  after checking the claim's documents, not as a merchant API call. — https://shurjopay.com.bd
- Implication: build without an API refund path (manual / dashboard refund,
  honestly labelled), exactly as a missing capability — do not fabricate one.

### 1.6 Gotchas

- Versioning: target **v2 / v2.1 only** (the official plugins are v2.1); do not
  mix in any older integration shape found in legacy examples. — https://github.com/shurjopay-plugins/sp-plugin-php
- Host naming is inconsistent across official examples (sandbox host shown with
  and without `www.`, and a newer direct-integration URL on the provider domain
  returned HTTP 500 when fetched on 2026-10-15). Pin the exact sandbox and live
  bases by a real sandbox token call at build time, and allow-list the checkout
  host before redirecting. — https://documenter.getpostman.com/view/6335853/U16dS8ig
- No server-IP whitelisting requirement was documented in the official pages
  reached. — https://shurjopay.com.bd/developers/intregration-howto

---

## 2. aamarPay

### 2.1 Initiation (hosted checkout)

- `POST` JSON to the initiation endpoint — sandbox
  `https://sandbox.aamarpay.com/jsonpost.php`, live
  `https://secure.aamarpay.com/jsonpost.php`. — https://aamarpay.readme.io/reference/initiate-payment-json
- Required merchant-sent fields include, in summary: store_id, signature_key,
  unique tran_id (max 32 chars), amount, currency, description, customer
  name/email/phone, success_url, fail_url, cancel_url, and `type: "json"`. — https://aamarpay.readme.io/reference/initiate-payment-json
- Auth model: store_id + signature_key are issued by aamarPay and sent as plain
  fields in the request. Despite its name, the docs reached describe no
  computed signing algorithm — the key itself is the shared authentication
  secret, so it must be stored sealed on the tenant side, as with our other
  gateways. — https://aamarpay.readme.io/reference/initiate-payment-json
- A successful initiation returns a `payment_url` on the aamarPay host; the
  merchant redirects the buyer there to pay. — https://aamarpay.readme.io/reference/initiate-payment-json
- After payment, aamarPay POSTs transaction data to the merchant's
  success_url / fail_url (nothing is posted to cancel_url, per the provider's
  own Node README). — https://github.com/aamarpay-dev/aamarpay-nodejs/blob/HEAD/README.md

### 2.2 Server-side verification (decisive)

- **Independent verification exists — the Search Transaction API.**
  `GET /api/v1/trxcheck/request.php` on the sandbox / live host, taking
  request_id (the merchant tran_id), store_id, signature_key and
  `type=json`, returns the transaction record server-to-server. — https://aamarpay.readme.io/reference/search-transaction
- That record includes, in summary, the amount (and BDT amount), currency,
  pay_status and a status_code which the docs say to check together with the
  amount; the initiation doc likewise instructs merchants to use the Search
  Transaction API in their success endpoint. This satisfies the project's
  exact amount + currency match requirement. — https://aamarpay.readme.io/reference/search-transaction and https://aamarpay.readme.io/reference/initiate-payment-json
- IPN/webhook also exists: aamarPay documents an Instant Payment Notification
  webhook — an HTTP POST to a merchant listener URL, stated to be signed, sent
  only for successfully completed transactions; the listener URL is given to
  aamarPay's technical support during onboarding/integration. — https://aamarpay.readme.io/reference/instant-payment-notification
- Honesty rule for build: treat both the success_url POST and the IPN as
  *triggers only*; mark paid only after Search Transaction confirms success
  with exact amount + currency for that tran_id.

### 2.3 Sandbox

- Sandbox initiation endpoint above is public, and the docs use a public test
  store: store_id example `aamarpaytest` with an example signature key printed
  in the official initiation documentation itself. — https://aamarpay.readme.io/reference/initiate-payment-json
- The provider's official Node README gives the same test store credentials for
  testing and says live credentials are assigned by aamarPay for production. — https://github.com/aamarpay-dev/aamarpay-nodejs/blob/HEAD/README.md
- That README also notes sandbox payment-method coverage is narrower than live
  (it names bKash as the sandbox-available method). — https://github.com/aamarpay-dev/aamarpay-nodejs/blob/HEAD/README.md

### 2.4 Merchant onboarding

- Live credentials are not self-serve: the official docs direct merchants to
  contact aamarPay support to obtain live store_id / signature_key, and the
  developer page lists dedicated onboarding/KAM phone and support /
  integration email contacts. — https://aamarpay.readme.io/reference/initiate-payment-json and https://aamarpay.com/index.php/docs
- The IPN listener URL is likewise registered manually with technical support
  during onboarding/integration (see 2.2). — https://aamarpay.readme.io/reference/instant-payment-notification
- The main site promises quick onboarding with minimal documents while
  maintaining compliance, but **no specific document list (trade licence, bank
  account, NID, etc.) and no fee schedule were found on the official public
  pages reached** — those specifics must be obtained from aamarPay during the
  tenant's own onboarding and must not be assumed. — https://aamarpay.com/

### 2.5 Refund

- **No documented refund API endpoint was found** in the official Readme
  documentation set searched (initiation, search-transaction and IPN pages
  contain no refund operation). — https://aamarpay.readme.io/reference/search-transaction
- Implication: same as ShurjoPay — no API refund in v1 of the build; any refund
  is a manual/dashboard process and must be labelled as such.

### 2.6 Gotchas

- Endpoint generations are mixed in the docs: initiation is a top-level
  `jsonpost.php` while transaction search lives under `/api/v1/trxcheck/…` —
  do not assume a uniform `/api/v1` base. — https://aamarpay.readme.io/reference/search-transaction
- signature_key is transmitted as a request field (including as a query
  parameter on the search call in the official examples): never log request
  URLs, and keep the key sealed server-side only. — https://aamarpay.readme.io/reference/search-transaction
- No server-IP whitelisting requirement was documented in the official pages
  reached. — https://aamarpay.readme.io/reference/initiate-payment-json

---

## 3. Verdicts

### ShurjoPay — **BUILD**
Documented token-authenticated initiation (`get_token` → `secret-pay` →
`checkout_url`) **and** a documented independent server-side verification
endpoint (`POST /api/verification`, plus `/api/payment-status`) callable with
the merchant token and the ShurjoPay order_id, with a public sandbox for
pinning the exact response fields before live use. No documented refund API —
refund stays manual, labelled honestly.

### aamarPay — **BUILD**
Documented initiation (`jsonpost.php` with store_id + signature_key →
`payment_url`) **and** a documented independent server-side verification API
(Search Transaction, `/api/v1/trxcheck/request.php`) returning amount,
currency and status, explicitly recommended by the provider for the success
endpoint, plus a documented signed IPN webhook as a trigger. No documented
refund API — refund stays manual, labelled honestly.

Both verdicts are conditional on the project's standing gates: sandbox proof
of the verification response (fields, success code, amount/currency) before
any live claim, sealed tenant credentials, and paid-marking only on the
verified query — never on a browser redirect alone.

---

## 4. Build-time sandbox pinning addendum (GC11, 2026-10-15)

One real sandbox round per provider was attempted from the build sandbox,
using only the providers' publicly published test credentials (values
redacted here — no secret is recorded in this document):

- **aamarPay — REACHED.** A Search Transaction call
  (`GET https://sandbox.aamarpay.com/api/v1/trxcheck/request.php`, test store,
  a deliberately nonexistent `request_id`) returned HTTP 200 with a JSON body
  whose field names are pinned as: `request_id` (echoes the queried tran id),
  `store_id`, and `status` — for an unknown transaction the real status value
  was `"Invalid-Data"`, and the error shape carries **no** `pay_status`,
  `amount` or `currency` fields. Client parsing therefore treats a record
  without a successful `pay_status` as unconfirmed and reads
  amount/currency defensively.
- **ShurjoPay — NOT REACHED.** `POST https://sandbox.shurjopayment.com/api/get_token`
  with the published sandbox credentials timed out on read from this sandbox
  shell, so no real response shape could be pinned. The client is built to
  the documented shapes (token field on the token response; verification
  record with `sp_code` / `amount` / `currency`, array-or-object tolerated)
  and parsed defensively; a live/sandbox token + verification proof remains
  owed before any live claim (M30).
