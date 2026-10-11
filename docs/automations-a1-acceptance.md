# Automations A1 — Acceptance: order_status_changed + order_refunded workflow triggers

**তারিখ:** ২০২৬-১০-১১ · **ভিত্তি:** docs/automations-package-plan.md (A1) · **অবস্থা:** Local commit only — GitHub push হয়নি।

## যা বানানো হলো

S2-র OrdersService ইতিমধ্যে দুটো event emit করত (`order.status_changed`, `order.refunded`) কিন্তু কোনো workflow trigger-এ map ছিল না — event দুটো শূন্যে যেত। A1 সেগুলোকে পূর্ণ workflow trigger বানিয়েছে।

### Trigger definitions (verbatim, `apps/api/src/workflows/workflows.service.ts`)

`WORKFLOW_TRIGGERS`-এ যোগ:

```
"order_status_changed", "order_refunded"
```

`EVENT_TO_TRIGGER`-এ যোগ:

```
"order.status_changed": "order_status_changed",
"order.refunded": "order_refunded",
```

### Context definitions

Producer-এর raw emit shape **অপরিবর্তিত** (OrdersService-এ কোনো বদল নেই):

- `order.status_changed` emit context: `{ orderId, from, to }` (orders.service.ts:227)
- `order.refunded` emit context: `{ orderId, amountMinor (string), cumulativeRefundedMinor (string) }` (orders.service.ts:230)

`WorkflowsService.handleTrigger` normalization (শুধু এই দুই trigger-এর জন্য; raw field গুলো context-এ থেকেই যায়):

| Trigger | Derived field | সূত্র |
|---|---|---|
| order_status_changed | `fromStatus` | `context.from` |
| order_status_changed | `toStatus` | `context.to` |
| order_refunded | `refundAmount` | `Number(amountMinor) / 100` (টাকা, number — `gte` condition ও `{{refundAmount}}` template কাজ করে) |
| order_refunded | `cumulativeRefunded` | `Number(cumulativeRefundedMinor) / 100` (টাকা, number) |

`enrichContext` আগের মতোই চলে: দুই emit-এই `orderId` থাকায় `orderNumber`, `total`, `customerId`, `currency`, `status`, `source` order row থেকে ভরে (live-তে যাচাইকৃত)। Governance-এর entity key ইতিমধ্যে `orderId` ধরে (workflows.service.ts governanceSkip) — নতুন trigger দুটোতেও cooldown/daily cap প্রযোজ্য, আলাদা কাজ লাগেনি।

### Preset

Server gallery-তে (`WORKFLOW_PRESETS`) নতুন preset:

- key: `refund_team_alert`, trigger: `order_refunded`
- name: "Refund হলে টিম অ্যালার্ট" — "কোনো অর্ডারে refund হলেই টিমকে পরিমাণসহ জানায়।"
- steps: `notify_team` — title "Refund হয়েছে", text-এ `{{orderNumber}}`, `{{refundAmount}}`, `{{cumulativeRefunded}}`।
- Install: বিদ্যমান `POST presets/:key/install` পথে, disabled অবস্থায় তৈরি হয় (W6 discipline)।

### Web (`apps/web/src/app/dashboard/workflows/page.tsx`)

- TRIGGERS: `order_status_changed` → "Order এর Status বদলালে", `order_refunded` → "Order Refund হলে"।
- Condition-field select-এ একই style-এ hint option যোগ: `fromStatus` (আগের Status), `toStatus` (নতুন Status), `refundAmount` (টাকায়), `cumulativeRefunded` (টাকায়) — প্রতিটিতে কোন trigger-এ প্রযোজ্য তা লেখা। (Page-এর form presets শুধু 3 classics — সেখানে যোগ করা হয়নি; server gallery-ই W6 surface।)

## Evidence

### Spec — `apps/api/src/workflows/a1-order-events.spec.ts` (নতুন, 6 test)

Real `EventsService` bus + real `WorkflowsService` (onModuleInit subscription সহ), in-memory prisma:

1. দুই trigger-ই `WORKFLOW_TRIGGERS`-এ registered।
2. `order.status_changed` emit → workflow run completed; context-এ `fromStatus`/`toStatus` + raw `from`/`to` + enriched `orderNumber`; notify_team notification-এ rendered text।
3. Condition `toStatus eq "cancelled"`: `processing`-এ গেলে কোনো completed run নয় (skipped run record হয়), `cancelled`-এ গেলে completed।
4. `order.refunded`: `amountMinor "15000"` → `refundAmount 150` (raw string থাকে); `gte 200` condition 150-তে filter করে, 250-তে pass; notification body-তে "250 টাকা refund (মোট 400)"।
5. Tenant isolation: org-b-র workflow org-a-র event-এ কখনো fire হয় না।
6. Preset `refund_team_alert` install হয় disabled; enable করার পর refund event-এ team alert যায় (99 টাকা)।

`w6-governance.spec.ts`-এর preset-count assertion 6 → 7 হালনাগাদ (নতুন preset-এর কারণে)।

### Live — built API (spare port 4101) + real Postgres, scripted HTTP 20/20 PASS

- Workflow তৈরি (দুই trigger-ই API দিয়ে), preset gallery-তে `refund_team_alert` আছে ও install disabled হয়।
- Manual order → PATCH status `on-hold`: completed run নেই, skipped run আছে। PATCH `cancelled`: completed run; run context = `{from: "on-hold", to: "cancelled", fromStatus: "on-hold", toStatus: "cancelled", orderNumber: <externalRef>}`।
- PATCH refund 150 টাকা (`gte 200` condition): completed run নেই, skipped run-এর context-এ `refundAmount: 150`, `amountMinor: "15000"`। PATCH refund +250: completed run, `refundAmount: 250`, `cumulativeRefunded: 400`।
- লক্ষণীয়: manual order `processing` status দিয়ে তৈরি হয়; `processing → processing` PATCH S2-র documented same→same no-op — কোনো event/run হয় না (সঠিক আচরণ)।

### Gate

- Full API jest: **138 suites / 1019 tests, সব pass** (আগের 1013 + নতুন 6)।
- Web tests: **39/39 pass**। Monorepo build (`pnpm -r build`): **green**।

## সীমা

- Refund/status workflow live প্রমাণ sandbox-এর নিজের org/order দিয়ে — আসল tenant-এর production data দিয়ে নয়।
- `fromStatus`/`toStatus` শুধু workflow context-এ normalize হয়; producer emit shape বদলায়নি, তাই অন্য ভবিষ্যৎ consumer raw `from`/`to`-ই পাবে।
