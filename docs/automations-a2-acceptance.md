# Automations A2 — Acceptance: shipment events → workflow triggers

**তারিখ:** ২০২৬-১০-১১ · **ভিত্তি:** docs/automations-package-plan.md (A2) · **অবস্থা:** Local commit only — GitHub push হয়নি।

## যা বানানো হলো

CourierService আগে কোনো event-ই emit করত না — courier-confirmed **return** কোনো workflow দিয়ে ধরা যেত না। A2 shipment status change-কে workflow event বানিয়েছে।

### Producer — `CourierService.syncShipment` (courier.service.ts:567)

`syncShipment`-ই একমাত্র status-লেখা shipment update (S1 audit-প্রমাণিত; `syncAll` এখান দিয়েই যায়; অন্য update শুধু `lastNotifiedStatus` লেখে)। Update-এর পরে, `changed === true` হলে, S1 inventory hook-এর পাশে একই failure-isolated ধাঁচে emit:

```
event: "shipment.status_changed"
payload: { organizationId, context: {
  shipmentId, orderId, provider,
  trackingCode (?? undefined),
  shipmentStatus: <নতুন status>,
  previousStatus: <update-এর আগের status — update-এর আগেই capture করা>,
} }
```

- Emit ব্যর্থ হলেও sync কখনো ভাঙে না (try/catch + logger.warn)।
- `EventsService` REAL import; constructor-এ **সবার শেষে** `@Optional()` param — বিদ্যমান positional construction (সব courier spec) অপরিবর্তিত। EventsModule `@Global` (app.module-এ imported) বলে module wiring লাগেনি — তবু DI spec দিয়ে প্রমাণ করা হয়েছে (নিচে)।

### Consumer — WorkflowsService dispatcher

`WORKFLOW_TRIGGERS`-এ যোগ: `shipment_status_changed`, `shipment_delivered`, `shipment_returned`।

`onModuleInit`-এ একটি dispatcher subscription: `shipment.status_changed` এলে —

1. সবসময় `handleTrigger("shipment_status_changed", payload)`;
2. নতুন status-এর classification **delivered** হলে আরও `handleTrigger("shipment_delivered", payload)`;
3. classification **returned** হলে আরও `handleTrigger("shipment_returned", payload)`।

**Delivered/returned set-এর উৎস (verbatim reuse):** `apps/api/src/courier/courier-performance.ts`-এর S5 `classifyShipmentStatus` — WorkflowsService সেটাই import করে ব্যবহার করে, যাতে set দুই জায়গায় drift হতে না পারে। Normalization: trim → lowercase → spaces/hyphens → underscores; তারপর delivered = `delivered | partial_delivered | partially_delivered`, returned = `returned | return`, cancelled = `cancelled | canceled | cancel` (A2-তে ব্যবহৃত নয়), বাকি সব in_flight। Web-এর `apps/web/src/lib/courier-status.ts`-ও একই normalization ব্যবহার করে।

### Context / governance

- Context-এ `shipmentStatus` ও `previousStatus` condition field হিসেবে ব্যবহারযোগ্য (spec-এ প্রমাণিত)।
- `enrichContext` `orderId` দিয়ে `orderNumber`/`total`/`customerId` টানে (spec + DI proof-এ যাচাইকৃত)।
- W6 governance-এর entity key ইতিমধ্যে `orderId` ধরে — shipment context-এ `orderId` থাকায় per-entity cooldown ও daily cap এই trigger গুলোতেও কাজ করে; আলাদা কোড লাগেনি।

### Preset

Server gallery-তে নতুন preset: key `shipment_return_alert`, trigger `shipment_returned`, name "পার্সেল রিটার্ন হলে টিম অ্যালার্ট", steps: `notify_team` — text-এ `{{orderNumber}}` (orderId থেকে enriched) + `{{trackingCode}}`। Install-এর পর disabled থাকে (W6 discipline)।

### Web (`apps/web/src/app/dashboard/workflows/page.tsx`)

TRIGGERS-এ যোগ: `shipment_status_changed` → "পার্সেলের Status বদলালে", `shipment_delivered` → "পার্সেল ডেলিভারি হলে", `shipment_returned` → "পার্সেল রিটার্ন হলে"। Condition-field select-এ A1-এর style-এ hint: `shipmentStatus`, `previousStatus`।

## Evidence

### Spec — `apps/api/src/workflows/a2-shipment-events.spec.ts` (নতুন, 8 test)

Real CourierService + real WorkflowsService + একই real EventsService, shared in-memory tables; Steadfast HTTP `global.fetch`-এ stub (courier.spec-এর একই seam):

1. তিনটি trigger-ই registered।
2. delivered → returned sync: event ঠিক **একবার** fire; `shipment_status_changed` + `shipment_returned` completed run; `shipment_delivered` run নেই; context-এ `shipmentStatus`/`previousStatus`/`trackingCode` + enriched `orderNumber`; notification body-তে order নম্বর, tracking code, "delivered → returned"।
3. একই status-এ দ্বিতীয় sync: কোনো event নয়, কোনো নতুন run নয়।
4. in_transit → delivered: `shipment_delivered` fire; `partial_delivered`-ও delivered (S5 set)।
5. `shipmentStatus eq "cancelled"` condition status_changed trigger-এ সঠিক filter করে।
6. Tenant isolation: org-b-র workflow org-এর shipment event-এ fire হয় না।
7. Provider failure: syncShipment আগের মতোই courier error throw করে, কোনো event যায় না, status অপরিবর্তিত।
8. Events param ছাড়া পুরনো positional construction-এও sync আগের মতো কাজ করে; preset install (disabled) হয়।

বিদ্যমান courier suites (courier.spec, courier-performance, m52, m53, m59, phase-21) সব pass — positional construction ভাঙেনি। `w6-governance.spec.ts`-এর preset-count assertion 7 → 8 হালনাগাদ।

### DI proof — `apps/api/src/workflows/a2-shipment-di.spec.ts` (নতুন, 1 test)

S2-র di.spec-এর ধাঁচে `NestFactory.createApplicationContext` দিয়ে **আসল module graph** (FakePrisma @Global + real AuditModule + real EventsModule + real CourierModule + real WorkflowsModule) compile করে প্রমাণ:

- `CourierService.events` graph-এরই `EventsService` instance (undefined নয় — M65 failure mode সরাসরি assert করা);
- সেই graph-এ `syncShipment` (delivered → returned) চালালে graph-এর নিজের WorkflowsService দিয়ে **completed shipment_returned WorkflowRun** তৈরি হয় এবং team notification যায়।

### Honest limit — live check হয়নি, ইচ্ছাকৃতভাবে

Sandbox-এ আসল provider credential ছাড়া HTTP দিয়ে shipment status বদলানো যায় না — provider call stub করা HTTP পথে সম্ভব নয়। তাই A2-র প্রমাণের ceiling হলো service-level spec (real CourierService + stubbed provider HTTP seam) + পূর্ণ DI graph proof — ওপরের দুটোই দেওয়া হয়েছে। A1-এর মতো scripted-HTTP live check এখানে সৎভাবে সম্ভব নয়, তাই দাবিও করা হচ্ছে না।

### Gate

- Full API jest: **140 suites / 1028 tests, সব pass** (A1-এর 1019 + নতুন 9)।
- Web tests: **39/39 pass**। Monorepo build (`pnpm -r build`): **green** (সব package/app Done)।
