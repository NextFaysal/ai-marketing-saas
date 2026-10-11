# Milestone 54 Acceptance — Visual Flow Builder (React Flow canvas over Workflow Engine v2)

- [x] **Engine untouched.** No changes under apps/api at all: the step/definition
      format, validation, run/resume semantics and CRUD endpoints are exactly as
      before (full API suite unchanged: 539 tests / 77 suites, same as the
      M53 baseline). The canvas is a pure presentation/editor layer in apps/web.
- [x] **Dependency (the one new package of this batch):** `@xyflow/react` (v12)
      added to apps/web only. Chosen over the legacy `reactflow` package
      because the workspace runs Next 15 + React 19, which @xyflow/react
      supports; reactflow v11 targets the React 17/18 era.
- [x] **Lossless bidirectional mapping** (`apps/web/src/lib/workflow-graph.ts`,
      framework-free pure functions):
      - definition → graph: trigger node + one node per step + a synthetic
        "stop" node on each condition's NO arm + an End node. Every step
        object is deep-cloned into its node VERBATIM.
      - graph → definition: walks the main chain (next/yes edges) from the
        trigger; synthetic stop/end nodes are never written back.
      - Unknown step types render as LOCKED nodes holding their raw JSON;
        unknown extra fields on known steps (e.g. templateParams, future
        engine fields) round-trip untouched.
      - A graph that is not a single connected path (orphan fragment, cycle,
        broken link) is REJECTED with a Bengali structural error — steps are
        never silently dropped to make a save succeed.
- [x] **Round-trip proof (unit tests, `workflow-graph.test.ts`, 20 tests):**
      identity for fixtures covering every engine step type, a workflow-level
      conditions array, multiple/trailing conditions, unknown step types with
      nested payloads, unknown extra fields, and all three built-in presets;
      NO-arm absence from saved output; rewired-chain ordering (reconnect =
      reorder); cycle/disconnect rejection; insert/remove structural edits;
      and the shared draft logic (unedited panel draft → step unchanged,
      single-field edit changes only that field, text→WhatsApp-template
      switch mirrors the form).
- [x] **One field logic, not two.** The form editor's per-step JSX was
      extracted into `components/step-fields.tsx` and its payload builder
      into `buildPayloadStep`/`parseConditionValue` in the lib; BOTH the
      form and the canvas side panel use them. One deliberate alignment:
      workflow-level condition values in the form now parse "true"/"false"
      to booleans exactly like step condition values always did (previously
      the form's workflow-level path kept them as strings — a latent
      inconsistency; engine untouched, payload semantics now uniform).
- [x] **Canvas features:** palette chips for every engine step type
      (click-to-add after the selected step / at the end, or HTML5
      drag-and-drop onto the canvas at the drop position); edges rendered
      distinctly (next = slate, condition YES = green "হ্যাঁ", condition NO =
      red dashed "না" to a stop node carrying the engine's stop-on-false
      meaning); reconnect rules that keep a single path (one main edge out,
      one in, no cycles — violations explain themselves in Bengali instead of
      corrupting the flow); chain edges deletable via keyboard (nodes are
      deleted from the side panel, which rebuilds derived stop nodes
      correctly); up/down reorder buttons; Tidy (auto-layout) button;
      node click opens the side panel with the shared StepFields.
- [x] **Positions are client-side only.** The engine would ignore unknown
      fields inside a step at runtime, but writing UI coordinates into
      stored steps would contaminate every saved definition, so positions
      live in localStorage (`wfc-pos:<scope>`), keyed by workflow scope +
      POSITIONAL node id (steps have no ids in the data model — after a
      mid-chain insert/delete, slots keep their positions and a step may
      sit in a shifted slot; Tidy re-layouts). Documented honestly in the
      lib header and here.
- [x] **Entry point + existing flows preserved:** ফর্ম/ক্যানভাস toggle on
      the workflows page; the form editor is fully functional (same fields,
      now shared components); the three preset buttons work in BOTH views
      (in canvas view they load the preset definition into the canvas);
      every workflow row gained a "ক্যানভাসে খুলুন" button.
- [x] **Save = existing endpoints + existing validation.** The canvas POSTs
      to the same create endpoint as the form (the API's update endpoint
      accepts only name/enabled — steps are immutable after creation, so a
      canvas save of an opened workflow creates a NEW workflow; the canvas
      says so in an amber banner, the original is untouched). Server
      validation errors surface verbatim in the canvas error banner.
- [x] **Live sandbox verification:** web restarted on the new build;
      workflows page serves HTTP 200 and its built chunk contains the new
      canvas strings; API — canvas-shaped preset payload (wait → condition →
      send_inbox_message) created and listed back verbatim; invalid wait
      step rejected with the server's exact message
      ("wait steps need minutes between 1 and 43200 (30 days)", 400);
      a DB-seeded workflow containing an unknown step type came back via
      GET byte-identical (the locked-node read path).
- [x] Builds: full monorepo `pnpm -r build` green (workflows route now
      66.5 kB / 169 kB first load — React Flow). Web unit tests: 20/20 pass.
      TypeScript (`tsc --noEmit`) clean.

## Honest limits
- No pixel QA / no real-browser click-through of the canvas (build + chunk
  markers + API/page-serves checks only, as for prior web milestones).
- The canvas edits a workflow DRAFT. Because the API has no steps-update
  endpoint, editing an existing workflow's steps means saving a new
  workflow and disabling/deleting the old one — the UI states this plainly
  rather than pretending to edit in place.
- Positions keyed by positional slot ids (see above); a heavily reordered
  flow may need one Tidy click.
