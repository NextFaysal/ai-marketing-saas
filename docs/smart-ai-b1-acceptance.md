# Smart AI Phase 0 — Batch SA-B1 Acceptance (P1 OrgBrainService + P3 Visibility)

Date: 2026-10-17. Branch `smart-ai`, base `8ce43eb3` (org-next line).
Scope per the brief: **API-only, no web changes.** Local commits only;
nothing pushed.

Commits:
- `8908861e` — SA-B1 P3: KnowledgeDocument visibility.
- `1315c4ec` — SA-B1 P1: OrgBrainService + consumer migration.
- (this doc's commit follows)

## Step 0 — reality check in this tree (brief vs code)

Verified before building: `business-brain.ts` (tokenize / matchKnowledge /
fact-line builders), `inbox.service.ts buildFactPack` + the CX1 draft
paths, `ai/tools.service.ts knowledge()`, the knowledge module, and the
`KnowledgeDocument` model. Two places where reality differed from the
brief, followed and recorded here:

1. **There was no update endpoint or update DTO for knowledge
   documents** (only create / upload / ingest-file / delete). Without
   one, a document's visibility could never be corrected after
   creation, so P3 ships a new `PATCH /organizations/:orgId/
   knowledge-documents/:docId` (mirrors the existing `updatePolicy`
   pattern exactly: org-scoped `findFirst`, WRITE_ROLES, audit action
   `knowledge.update`) carrying `UpdateKnowledgeDocDto`. This is the
   one endpoint added by this batch.
2. **`uploadDocFile` stores extracted file content as `kind: "note"`
   chunks** (the CX9 path). The note→internal service rule therefore
   applies to uploads too: an uploaded file's content is internal by
   default and becomes customer-quotable only when the owner
   explicitly reclassifies it via the new PATCH. This is the
   confidentiality-safe reading of the brief's "same rule" and it is
   a deliberate behaviour change, called out here rather than hidden.

Also verified: draft paths (CX1 grounded replies, staff drafts) read
the profile directly by design and are untouched; `aiInstructionsDraft`
was never part of any fact pack and still is not.

## Item 1 — P3 Visibility (commit 8908861e)

- Schema: `KnowledgeDocument.visibility String @default("public")`
  with a comment fixing the closed set (`public` | `internal`).
  Migration `20261026000000_sai_visibility/migration.sql` — additive
  only: `ALTER TABLE "KnowledgeDocument" ADD COLUMN "visibility"
  TEXT NOT NULL DEFAULT 'public'`.
- DTOs: `visibility` accepted on create, update (new) and
  ingest-file, validated with `@IsEnum(["public", "internal"])` —
  any other value is a 400 from the global ValidationPipe.
- Service layer (`resolveKnowledgeVisibility`, exported for reuse):
  explicit value wins; when absent, `kind = "note"` → `"internal"`,
  everything else → `"public"`. The schema default stays `public`,
  as specified. Applied uniformly in `createDoc`, `updateDoc`,
  `uploadDocFile` and `ingestFile`.
- Responses: the public document view (`toPublicDoc`) and the upload
  result now include `visibility`.
- Specs: `knowledge/knowledge-visibility.spec.ts` — 12 tests: schema
  default, note→internal, explicit-wins both ways, upload path rule,
  PATCH reclassification, closed-set validation on the DTO classes,
  and org-scoping of the update.

## Item 2 — P1 OrgBrainService (commit 1315c4ec)

- New `apps/api/src/ai/org-brain.service.ts`:
  `getContext(organizationId, { audience, query?, matchLimit?,
  includeRecentDocs?, policyType? })` returning structured slices
  (per-area fact lines + `factsText`, public profile, policies +
  optional typed policy, audience-filtered recent documents,
  audience-filtered labelled knowledge matches, internal profile —
  internal audience only, published owner instructions, reply
  language, sources). Every read is org-scoped and defensive
  (missing table/model ⇒ empty context, never a throw — the fact
  pack's existing discipline). Knowledge matching reuses
  `matchKnowledge` unchanged; no tokenizer fork.
- Wiring: the service lives in a small shared module
  `apps/api/src/ai/org-brain.module.ts` (imports nothing beyond the
  global PrismaModule), imported by both `AiModule` and
  `InboxModule` — no module cycle, as the brief anticipated.
  Consumers also keep an `@Optional` injection with a lazy
  same-prisma fallback, so every existing positional unit-spec
  construction keeps working unchanged.
- Consumers migrated:
  - `inbox.service.ts buildFactPack` — profile fact lines, typed
    policy, org name, owner instructions/language and knowledge
    matches now come from OrgBrain with audience `"customer"`.
    Product facts, order-status (customer-own) logic, the number
    guard, escalation and unanswered capture are untouched.
  - `ai/tools.service.ts knowledge()` — delegates with audience
    `"internal"` (matchLimit 5, recent docs included) and rebuilds
    its exact previous output shape from the context.
- **The one intended behaviour change (the leak fix):** the inbox
  customer fact pack previously matched knowledge documents with NO
  visibility filter — any internal note could be quoted to a
  customer. Customer-audience contexts now match only
  `visibility = "public"` documents, and INTERNAL profile fields
  are structurally absent from the context object (they exist only
  on `internalProfile`, which is `null` for customer audience).
  Rows without a visibility value (pre-migration shape) count as
  public — their historical behaviour.

### Profile classification implemented (in `org-brain.service.ts`)

| Class | Fields | Where it enters |
|---|---|---|
| PUBLIC (both audiences) | Delivery charges/days, free-delivery threshold, minimum order; COD availability, bKash/Nagad numbers, advance %, payment note; contact phone/email; public address/city; website URL; business hours; return window | `deliveryFactLines` / `paymentFactLines` / `contactFactLines` / `hoursFactLines` |
| PUBLIC identity (both audiences) | industry, description, brandVoice, websiteUrl | `publicProfile` |
| BEHAVIOUR (both audiences, published only) | aiInstructions, aiReplyLanguage | `ownerInstructions`, `replyLanguage` |
| INTERNAL (internal audience only) | goals, monthlyBudgetMinor, budgetCurrency, targetCustomers, businessModel, **uniqueSellingPoints**, tradeLicenseNo, billingEmails | `internalProfile` |
| NEVER surfaced (either audience) | metaCapiToken (secret), metaPixelId, tikTokPixelId, aiInstructionsDraft, billingAddress, billingBin, businessAddress | — |

**uniqueSellingPoints decision: INTERNAL.** It is owner-drafted
positioning that has never been part of the customer fact pack, and
it can carry comparative claims that have not been vetted for
verbatim customer quoting. If the owner later wants it quotable, the
change is one line in the classification plus a spec update — the
default stays closed (law L3).

Policies: served to both audiences, as before (they are
customer-facing by type: shipping / payment / return).

## Item 3 — Specs

- `ai/org-brain.spec.ts` — 7 tests: serialized customer-context leak
  scan with planted sentinel strings across goals / budget /
  targetCustomers / businessModel / uniqueSellingPoints /
  tradeLicenseNo / billingEmails + an internal doc's content
  (positive controls prove the public surface is present); internal
  audience sees both doc classes, internal ones labelled; cross-org
  isolation in both directions; legacy rows without visibility stay
  public; typed-policy scoping; empty-org and missing-table safety.
- `knowledge/knowledge-visibility.spec.ts` — 12 tests (Item 1).
- Regression: the full inbox + ai + knowledge targeted run below.

## Gates (run strictly serially; results recorded as each finished)

| Gate | Result |
|---|---|
| Knowledge suites (Item 1, `jest src/knowledge --runInBand`) | **2 suites, 36/36 tests pass** |
| OrgBrain spec (Item 2) | **7/7 tests pass** |
| Targeted jest: `src/inbox src/ai src/knowledge --runInBand` | **82 suites, 800/800 tests pass**. First combined attempt died with a Node heap OOM at the default ~2 GB limit after 7 suites (all passing); rerun with the repo-standard `NODE_OPTIONS=--max-old-space-size=4096` passed in full. |
| API tsc (`tsc --noEmit -p tsconfig.json`) | **exit 0** |
| API build (`pnpm build` → `tsc -p tsconfig.build.json`) | **exit 0** |
| Fresh-PG migration run (throwaway PG16 cluster, empty DB, `prisma migrate deploy`) | **223/223 migrations applied, 0 unfinished** (base 222 + `20261026000000_sai_visibility`); `KnowledgeDocument.visibility` verified in `information_schema`: `TEXT NOT NULL DEFAULT 'public'` |

No pre-existing failures were encountered in the targeted scope, so
no base-comparison was needed.

## NOT BUILT (later batches — named, not implied)

- **pgvector + hybrid (vector/keyword) retrieval** — SA-B2. Matching
  in this batch is the existing keyword `matchKnowledge` only.
- **Answer Store (AL15 / SM3b)** — SA-B3.
- **Learning items** (product/website learning, conversation mining,
  performance learning, brand voice + customer memory) — later
  Phase 0 batches.
- **Learn Dashboard UI** and the **web visibility toggle** — this
  batch is API-only; the dashboard cannot yet display or change a
  document's visibility (the API can, via the new PATCH).
- Comment/social AI consumers of the Brain, the Reply Engine, the
  Action Engine and the Control Center — Phases 1–2, untouched here.
- Live verification of any kind (fresh-PG proof is local only; no
  migration has run on the real database; M30 still owed).
