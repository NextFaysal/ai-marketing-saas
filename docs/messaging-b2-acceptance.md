# Messaging B2 Acceptance — MS3 Audience Builder v2 + MS4 Per-tenant Senders & Providers

Batch B2 of the Messaging Power package (MS1–MS10, owner approved in full
2026-10-13). Base: B1 HEAD `cf4e752`. Worktree `~/workspace/ai-marketing-saas-ms`,
branch `ms-package`. Local commits only — NOT pushed (owner-only push trigger).

## Gate (baseline → final)

| Gate | Baseline (B1) | Final (B2) |
| --- | --- | --- |
| API jest | 216 suites / 1947 tests | **218 suites / 1996 tests, all pass** |
| API tsc (`tsc --noEmit`) | clean | clean |
| Web vitest | 140/140 | 140/140 |
| Web tsc | clean | clean |
| Next build | green | green (incl. `/dashboard/messaging`) |
| Prisma validate | valid | valid |

One note on the jest gate: the FIRST full run showed a single failure in
`admin/m42.spec.ts` (a Milestone-42 reliability-panel spec, unrelated to
messaging). That spec passes standalone (6/6) and the full suite was
re-run end to end afterwards: **218/218 suites, 1996/1996 tests, all
pass**. Recorded here as a full-run flake, not hidden.

New tests: MS3 `ms3-audience-builder.spec.ts` (20 tests) + MS4
`ms4-senders.spec.ts` (29 tests) = +49 tests, +2 suites, zero regressions —
every pre-existing messaging spec (messaging, cx10 preview, sc1 RFM scale,
MS1 engine, MS2 preferences) passes UNCHANGED, as does inbox phase-f (the one
external caller of `resolveAudience`'s positional signature, which is
unchanged).

## MS3 — Audience Builder v2

- **Schema** (migration `20261013120000_ms3_saved_audiences`): new model
  `MessagingSavedAudience` + `Broadcast.audienceDefinition Json?`,
  `audienceSavedId String?`, `audienceCsv Json?`. **Deviation (name):** the
  brief named the model `SavedAudience`, but that name already exists in the
  schema — the Ads campaign builder's targeting presets
  (`apps/api/src/audiences`, in production use). Renaming the Ads model would
  have been a destructive, out-of-scope change, so the Messaging model is
  `MessagingSavedAudience` (table + Prisma client name); the API surface
  (endpoints `/messaging/audiences`, DTOs) is exactly as briefed.
- **Pure rules module** `messaging/audience-rules.ts`: strict validator
  (unknown field/op, wrong value kind, missing key, >20 conditions ⇒ 400 with
  a verbatim field-level message — never silently ignored) + pure evaluator.
  Condition vocabulary exactly per brief: common `source`, `created_days_ago`,
  `has_email`/`has_phone`, keyed `custom_field`; customers add
  `orders_count`, `total_spent_minor`, `last_order_days_ago`, `rfm_segment`,
  keyed `address_key`; leads add `stage`, `tag` (contains), `value_minor`.
  Null rule (documented + spec-pinned): a missing fact makes the condition
  FALSE — except the order aggregates themselves, which are real zeroes, so
  `orders_count eq 0` matches a customer who never ordered (including a
  customer whose orders are all cancelled).
- **Resolver**: all audience paths now flow through the ONE shared resolver
  (`resolveBroadcastRecipients` → new internal `resolveAudienceInternal`);
  preview == send discipline from CX10/B1 is preserved. Customers/leads base
  scans are cursor-chunked (`take 500`, cursor on id, id-ascending) — no
  unbounded findMany remains on any audience path (spec walks 1200 rows in
  exactly 3 chunks). Order facts come from the DATABASE via the new exported
  `computeOrderAggregates` in `rfm.ts` (the existing two-partition groupBy,
  extracted without behaviour change); `computeRfm` runs only when an
  `rfm_segment` condition is present.
- **Saved audiences**: CRUD at `organizations/:id/messaging/audiences`
  (WRITE_ROLES writes, OWNER/ADMIN delete, mirroring templates), validated by
  the same pure validator at write time, audit-logged. Deleting a saved
  audience a DRAFT still references is allowed; that draft's preview/send
  then fails honestly: "Saved audience no longer exists — it may have been
  deleted. Choose another audience." (spec-proven). Sent broadcasts are
  unaffected (MS1 snapshot).
- **CSV audiences**: pasted list (newline/comma/semicolon/tab separated,
  quotes stripped, deduped) parsed server-side in the pure module; each valid
  address is matched to an existing customer (first) or lead of the org by
  the preference-store normalization to recover name + entity id; unmatched
  addresses stay sendable as `{ type: "csv" }` recipients whose snapshot id
  is the normalized address (so the A/B split key `type:id` works unchanged);
  their `MessageDelivery` rows record `recipientId: null` (the address
  column carries the identity). The same person pasted in two phone forms
  (local + +880) resolves to ONE recipient — spec-proven, never a double
  send. Invalid entries are counted and surfaced as `invalidCount` in the
  preview — never silently dropped. Cap 5000 addresses, refused (not
  truncated) at create and at resolve. Suppression still applies to csv and
  custom audiences (address/entity based stages unchanged; spec proves a
  suppressed custom-audience member is dropped + counted).
- **Web**: the broadcast form's audience select gains Custom (condition
  builder: entity toggle, all/any match, field+op+key+value rows with
  Bengali labels, add/remove up to 20), Saved (select + manager:
  create-from-current-definition, rename, delete), CSV (paste textarea).
  Preview block shows all B1 exclusion counts + `invalidCount` + the MS4
  cost line; broadcast rows label custom/saved/csv audiences (a deleted
  saved audience shows "(মুছে ফেলা হয়েছে)").

## MS4 — Per-tenant Senders & Providers

- **Schema** (migration `20261013130000_ms4_sender_config`): per-org single
  row `MessagingSenderConfig` (MessagingSetting pattern): tenant SMTP
  (host/port/user/`smtpPassEncrypted`/fromAddress/fromName/`dkimSelector`),
  tenant SMS (`smsGateway` sslwireless|bulksmsbd|alphasms,
  `smsApiKeyEncrypted`, `smsSenderId`, optional `smsApiUrl`), and the org's
  own rates (`smsCostPerPartMinor`, `whatsappCostPerMessageMinor`,
  `emailCostPerMessageMinor`, nullable = unknown). Secrets are AES-256-GCM
  sealed via platform-config `seal`/`unseal` and are NEVER returned: the only
  outward view (`senderConfigSafeView`) carries non-secret fields +
  configured booleans; a spec asserts the serialized view contains neither
  the plaintext nor the sealed secret values.
- **Tenant email**: `EmailProvider` gains `verifyTenantSmtp` (a real
  nodemailer `verify()` handshake on a FRESH transport — a failure caches
  nothing) and `sendTenant` (per-org transport cache keyed by config
  fingerprint; From uses the tenant address + name; sent only on a provider
  message id), behind the public seam `tenantTransportFactory` (specs
  substitute it; no real socket in tests). Platform `send()` is untouched —
  its other callers (organizations, admin, automation, courier, payments)
  keep identical semantics. Settings `PUT messaging/senders/email` verifies
  BEFORE persisting: failure = 400 with the SMTP server's error verbatim and
  NOTHING stored (spec-proven). Omitting the password keeps the stored one;
  `clear: true` restores the platform fallback. `POST
  messaging/senders/email/test` sends a real, clearly-labelled test email
  through the resolved path and reports `path: tenant|platform`;
  unconfigured = honest 400.
- **SMS adapters** behind the existing contract (`SmsProvider.send` =
  platform SSL Wireless, semantics unchanged; new `sendWithGateway` for
  tenant configs; resolution tenant → platform in `sendToRecipient`):
  - **sslwireless** — today's implementation verbatim (POST
    `{base}/api/v3/send-sms`, success ⇔ JSON `status: "SUCCESS"`).
  - **alphasms** — VERIFIED against the provider's public documentation at
    https://sms.net.bd/api (fetched 2026-10-13): `POST
    https://api.sms.net.bd/sendsms` JSON `{ api_key, msg, to, sender_id }`;
    success ⇔ `error: 0` with `data.request_id` as the provider message id;
    failures carry a non-zero `error` + `msg`, surfaced verbatim.
  - **bulksmsbd** — **doc-verified from public mirrors only; the provider's
    own documentation page is NOT publicly reachable** (`https://
    bulksmsbd.net/api` returned HTTP 404 when fetched 2026-10-13). Shape
    implemented from mirrored copies of the provider's API documentation
    (public mirror: github.com/codernayeem/payment-sms-courier-api-docs; the
    public django-bulksms-bd package): `POST http://bulksmsbd.net/api/smsapi`
    form `{ api_key, type: "text", number, senderid, message }`; success ⇔
    response code **202**; the response may be JSON `{ response_code,
    error_message }` or the bare numeric code as plain text (both parsed);
    documented failure codes (1001 invalid number, 1002 sender ID
    incorrect/disabled, 1007 balance insufficient, 1032 IP not whitelisted,
    …) surface with their meaning. The documented response carries NO
    message id, so `providerMessageId` is the local send reference (the
    same fallback the SSL adapter uses). **This adapter is NOT live-proven**
    — see Honest limits.
  - Each adapter is pinned by fake-fetch specs: success envelopes count as
    sent, failure envelopes throw verbatim and never count.
- **Phone normalization**: `normalizePhoneGeneric` — BD numbers behave
  EXACTLY as `normalizeBdPhone` (it runs first and wins; BD specs
  byte-identical); a leading `+` with 10–15 digits, or a bare 12–15-digit
  number not starting with 0, passes in E.164 digits form; everything else
  still refuses. Applied in the SMS send path, the WhatsApp snapshot sender,
  and the opt-out skipped-address computation. Resolver suppression keys
  (`normalizePrefAddress`) are unchanged, so MS2 behaviour is untouched.
- **providerStatus(orgId)** is now per-org: `email { path:
  tenant|platform|none, tenantConfigured, platformConfigured }`, `sms {
  gateway, path, provider label }`. Web status cards use the per-org
  wording ("আপনার নিজের SMTP/Gateway দিয়ে পাঠানো হবে" vs platform).
- **Domain health** `GET messaging/senders/email/domain-health`: SPF from
  the tenant From domain (else the platform From's): TXT containing
  `v=spf1` ⇒ `found` (+record); none ⇒ `missing`; DNS failure ⇒ **`unknown`
  with the resolver's error — never "missing"**. DKIM is checked only when
  the org set `dkimSelector` (`<selector>._domainkey.<domain>` for
  `v=DKIM1`/`p=`); without one, `dkim: "not_checked"` with the honest
  reason. DNS goes through the service's injectable `txtResolver` seam
  (node:dns/promises by default; specs substitute it). No DNS call happens
  on any send path.
- **Cost estimate** (preview): pure `messaging/sms-segments.ts` — GSM-7
  (basic charset 1 unit, extension chars 2 units; 160 single / 153 per
  part) vs Unicode (any non-GSM char, e.g. Bangla; 70 single / 67 per part),
  boundary-spec-pinned. The estimate is computed ONLY from the org's own
  entered rates: SMS = final recipients × parts × `smsCostPerPartMinor`;
  WhatsApp/email = recipients × per-message rate. No rate ⇒
  `costEstimate: null` and the UI says the rate is not set — a price is
  never invented. The basis string and the UI both label it an estimate.
  Rate inputs in the UI are টাকা, converted ×100 to minor units.
- **Web**: new "✉️ প্রেরক (Sender) সেটিংস" card — tenant SMTP form (verify
  result via the save flow, test-send button + reported path, clear),
  SMS gateway form (key shown only as configured/not), domain-health
  button + results, rate inputs; plus the preview cost line.

## Decisions locked

1. MS3 model named `MessagingSavedAudience`, not the brief's `SavedAudience`
   — the name was already taken by the Ads targeting presets (see MS3 above).
2. A/B split and snapshot needed NO changes for csv: the csv snapshot entry
   id IS the normalized address, so `type:id` == `type:address`; deliveries
   for csv recipients record `recipientId: null` in the one central place
   (`recordDelivery`).
3. Previous-recipient and frequency-cap stages key on entity ids, so they
   naturally do not apply to unmatched csv recipients; suppression (address
   based) DOES apply to them, and matched csv recipients get every stage.
4. Tenant SMTP verification failure persists nothing (not even the
   non-secret fields) — a half-saved config that later sends would be worse
   than none; the platform fallback keeps working meanwhile.
5. SMS gateways have no documented verify/balance endpoint we rely on, so
   there is no fake "verify" for them: the settings response says plainly
   that the first real send is the proof, and a gateway rejection surfaces
   verbatim on that send.
6. DKIM without a selector is `not_checked`, not guessed: selectors are
   provider-specific and cannot be enumerated honestly.
7. Cost estimates exist only where the org typed a rate; SMS parts need the
   form's current body (preview DTO gains optional `body`, used for nothing
   else).
8. CSV parsing: `imports/csv.ts` is a papaparse file-import parser (headers,
   row objects) — a poor fit for a pasted headerless address list, so the
   pure `parseAddressList` in audience-rules.ts handles the paste (the brief
   allows the plain pasted list); the imports parser is untouched.

## Honest limits

- **Neither B2 migration has been run on any real database** (hand-written
  additive SQL, as throughout the package). Deploy must run
  `20261013120000_ms3_saved_audiences` and `20261013130000_ms4_sender_config`
  + `prisma generate`. Until then the API degrades defensively: sender-config
  reads treat a missing table as "no tenant config" (platform fallback),
  exactly like B1's pre-migration behaviour.
- **No live provider proof (M30 still owed)**: no real tenant SMTP handshake,
  no real BulkSMS BD / AlphaSMS send, and no real DNS lookup were performed
  from this sandbox. All three are proven only against fake transports /
  fake fetch / fake resolver in specs.
- **BulkSMS BD is doc-verified from public mirrors only** — the provider's
  own documentation page was unreachable (HTTP 404) at build time; the
  adapter follows the mirrored documented shape and is marked accordingly
  in code. Its first live send (M30) is the real proof.
- **`address_key` (e.g. district) coverage depends on the stored address
  shape**: Customer.address is a free-form Json written by store sync /
  imports; there is no standardized district field anywhere in the system.
  A condition on a key a customer doesn't carry is simply FALSE for them.
- **The cost figure is an estimate**, computed from the org's own typed
  rates and the GSM-7/UCS-2 part rules; the gateway's/Meta's actual charge
  may differ (stated in the estimate's basis text and in the UI).
- Saved-audience definitions are read at resolve time: editing one changes
  future previews/sends of drafts that reference it (by design, and stated
  on the model). A sent broadcast is never affected (snapshot).
