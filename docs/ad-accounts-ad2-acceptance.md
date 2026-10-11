# AD2 — Disconnect & Reconnect Lifecycle — Acceptance

**প্যাকেজ:** Advertising Accounts (plan: `docs/ad-accounts-package-plan.md`) · **তারিখ:** ২০২৬-১০-১১
**স্কোপ যা বাস্তবায়িত:** Ad Account-স্তরের disconnect endpoint (shared-token-safe), তিনটি connect flow-তে reconnect hygiene (পুরনো integration supersede), web-এ consequence-সহ disconnect বোতাম।

## Disconnect

`POST organizations/:id/ad-accounts/:accountId/disconnect` — একই guard stack (TenantGuard + RolesGuard + `@PermissionArea("ads")`), `@Roles("OWNER", "ADMIN")`।

- Account load হয় বিদ্যমান `getAccount` দিয়ে — অন্য org-এর account = 404 (আগের discipline)।
- `integrationId` না থাকলে (CSV/manual account) → **400** বাংলা message-সহ: বিচ্ছিন্ন করার মতো কোনো API সংযোগ নেই।
- **একক account** (ওই integration-এ এই org-এর আর কোনো account নেই): credential rows মুছে যায় + integration `DISCONNECTED` — `IntegrationsService.disconnect`-এর semantics হুবহু। Integration row ইতিমধ্যে missing থাকলেও detach পরিষ্কারভাবে হয় (update failure swallow করে — dangling integrationId আটকে রাখে না)।
- **Shared** (Meta: এক token, একাধিক account): integration ও তার credential-এ **হাতই দেওয়া হয় না** — শুধু এই account detach হয়, বাকিরা আগের মতো চলে (spec-এ অন্য account-এর sync সত্যিই চলতে দেখা হয়েছে)।
- দুই ক্ষেত্রেই: এই account-এর `integrationId = null`, `status = "DISCONNECTED"`। **Account row, campaigns, সমস্ত metrics থেকে যায়** — কোনো ডেটা মুছে না (spec-এ fake table ধরে assert)।
- Audit: `ad_account.disconnect` (entityType `AdAccount`, metadata `{ shared, integrationId }`)।
- Response: updated account + `connection: null, health: "disconnected"` (AD1-এর shape) — ফলে web-এ sync বোতাম নিজে থেকে অদৃশ্য হয় এবং AD1-এর "পুনরায় কানেক্ট করুন" বোতাম নিজে থেকে আসে।

## Reconnect hygiene (supersede)

তিনটি connect flow-তেই (Meta/Google/TikTok), accounts নতুন integration-এ upsert/repoint **হওয়ার পরে** `supersedePreviousIntegrations` চলে:

- Identity: Meta = provider `meta` + token user id; Google = `google_ads` + customer id; TikTok = `tiktok` + advertiser id।
- একই org+provider+identity-র আগের `CONNECTED` integration-গুলোর প্রতিটির জন্য: **এখনো কোনো AdAccount তাকে reference করছে কিনা আগে দেখা হয় — শুধু ZERO হলেই** credential delete + `DISCONNECTED` + audit `integration.superseded` (metadata `{ byIntegrationId, provider }`)।
- **Meta partial-rediscovery নিয়ম:** এবার re-discover হয়নি এমন account (যেমন `adAccountExternalIds` দিয়ে deselect করা) পুরনো integration-এই থেকে যায় — silently repoint হয় না; ফলে সেই integration supersede-ও হয় না, credential অক্ষত থাকে। কোনো মুহূর্তে কোনো account credential-ছাড়া থাকে না, আর CONNECTED duplicate জমে না।
- Disconnect করা account আবার connect হলে **একই AdAccount row-ই** revive হয় (unique-key upsert) — তিনটি connect-এর update clause-এ এখন `status: "ACTIVE"` আছে (spec-এ একই id + row count দিয়ে প্রমাণিত)। ভিন্ন identity-র integration কখনো supersede হয় না (spec)।

## Web (Ad Accounts পেজ)

- `integrationId`-ওয়ালা card-এ danger-outline **"সংযোগ বিচ্ছিন্ন করুন"** বোতাম; `window.confirm`-এ পরিণতি বাংলায়: ডেটা (Campaign/Metrics) থেকে যাবে, Sync ও Publish বন্ধ হয়ে যাবে। একই integrationId-তে একাধিক account থাকলে অতিরিক্ত লাইন: শুধু এই Accountটিই বিচ্ছিন্ন হবে — একই Token-এর অন্য Account আগের মতোই চলবে।
- সফল হলে notice + তালিকা reload।

## Evidence

- **Spec (নতুন `apps/api/src/ads/ad2-disconnect-reconnect.spec.ts`, 9 test):** sole disconnect-এর পূর্ণ পরিণতি; shared disconnect + অন্য account-এর sync অক্ষত; csv/manual → 400; foreign-org → 404; disconnect-পরবর্তী sync → সৎ "not connected to Meta via API" BadRequest (500 নয়); Meta reconnect supersede (ঠিক একটি CONNECTED + audit); Meta partial rediscovery; ভিন্ন-identity isolation; Google reconnect supersede (GoogleAdsClient prototype stub — AD1-এর ধাঁচ)।
- **Gates:** ads suites **34/34 (6 suites)**; **full API 1067/1067 (144 suites)**; `pnpm -r build` green। Coordinator নিজে diff পড়ে ও ads suite পুনরায় চালিয়ে যাচাই করেছে।
- **Live HTTP:** AD1-এর মতোই এই session-এ sandbox Postgres বন্ধ থাকায় চালানো যায়নি — service spec-ই প্রমাণের সিলিং (AD1 acceptance-এ বিস্তারিত)। কোনো migration লাগেনি — সব ক্ষেত্র বিদ্যমান schema-তেই ছিল।

## যা এই item-এ নেই (পরের batch-গুলোতে)

Platform account_status/timezone সংরক্ষণ = **AD3** · spend watchdog = **AD4** · Meta account picker UI (connect এখনো সব আবিষ্কৃত account নেয়; picker AD5) · bulk sync/labels = **AD6**।
