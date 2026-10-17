# Business Knowledge → Organization Settings — Acceptance

**Owner decision (2026-10-15 23:07 +06):** Business Knowledge is not used regularly, so it should not be a top-level nav page — move it inside Organization Settings.

**Branch:** `settings-knowledge` (base `9f16a8a` = GitHub main `cf3efd5` tree). Web-only. No API changes, no schema/migration. Local commits only — NOT pushed.

## What moved

| Before | After |
| --- | --- |
| Standalone page `/dashboard/knowledge` (164-line client page) | New section `hub-knowledge` on `/dashboard/settings`, implemented in `apps/web/src/app/dashboard/settings/knowledge-section.tsx` (`BusinessKnowledgeSection`), added to the settings sub-nav (`HUB_NAV`, 📚 "Business Knowledge", between "AI এর আচরণ" and "ব্র্যান্ডিং") and rendered right after the BusinessHub |
| Nav item "Business Knowledge" (🧠) in `apps/web/src/lib/nav.ts` | **Removed** from `NAV_ITEMS` |
| `/dashboard/knowledge` route | Now a server-side `redirect("/dashboard/settings#hub-knowledge")` — old bookmarks/links land on the section, never 404. The settings page's existing anchor mechanism (`#hub-*` ids + `scroll-mt-24`) is the anchor mechanism; no new mechanism was needed |
| Policies list + add form | Moved verbatim into the section (same markup, classes, labels, logic) |
| FAQ / knowledge documents list + add form + file upload form | Moved verbatim into the section |
| ব্যবসার প্রোফাইল form | **Unified — see audit below** (not duplicated) |

## Settings-page overlap audit (task point 2) — what was found and done

The settings page did not merely "call" the business-profile endpoint in one small area — its `BusinessHub` component already contains a complete business-profile editor for the **same** `BusinessProfile` record:

- It GETs `/organizations/:id/business-profile` (+ `/completeness`) and PATCHes `/organizations/:id/business-profile` with the full field set.
- Its "ব্যবসার পরিচিতি" (hub-identity) section already edits **every** field the knowledge page's profile form had — industry, websiteUrl, description, goals, brandVoice — plus businessModel, uniqueSellingPoints and more (contact/delivery/payment sections edit further fields of the same record).
- The "AI যা উত্তর দিতে পারবে:" line the brief referred to is the completeness hero (`hub-brain`) fed by that same profile.

Copying the knowledge page's 5-field profile form into the new section would have put **two forms for the same fields** on one page, with stale-state overwrite risk (the BusinessHub PATCH sends its whole loaded form state). Resolution, per the brief's unification rule:

- **Exactly one business-profile form exists on the settings page** — the pre-existing BusinessHub form. The moved section therefore does not carry a second profile form.
- The knowledge section carries a one-line pointer ("ব্যবসার প্রোফাইল (…) এই পেজের ব্যবসার পরিচিতি সেকশনে সম্পাদনা হয়") linking to `#hub-identity`, so anyone arriving from the old page finds the form immediately. This line is new navigational text, documented here; no original label was changed or dropped.
- The genuinely distinct AI-instructions UI on the settings page (hub-ai: AI Instructions Desk link + AI reply language) is untouched.

## Reference updates (task point 5)

- `apps/web/src/app/dashboard/ai/page.tsx` — link `href="/dashboard/knowledge"` → `"/dashboard/settings#hub-knowledge"`; label "Knowledge পেজ" → "Business Knowledge" (the old text named a page that no longer exists).
- `apps/web/src/app/dashboard/layout.tsx` — `"/dashboard/knowledge"` removed from the "core" nav group's `hrefs` (the settings route is already in the settings group; the redirect route needs no nav grouping).
- `apps/web/src/app/dashboard/settings/page.tsx` — the BusinessHub sticky save bar's "📚 নীতিমালা ও FAQ (Knowledge)" button now points to `#hub-knowledge` (same page) instead of `/dashboard/knowledge`; its side note changed from "…Knowledge পেজে সম্পাদনা হয়…" to "…এই পেজের Business Knowledge সেকশনে সম্পাদনা হয়…" so the text stays true.
- Concept-only mentions left unchanged, per brief: Creative Studio placeholder text, API error strings ("…set the business website URL in Business Knowledge"), the workflow blueprint text in `lib/workflow-blueprints.ts`, and the inbox `knowledgeBodyFromDraft` helper/tests (unrelated feature).

## Zero-loss proof

### Endpoints — before (knowledge page) → after

| Endpoint | Before | After |
| --- | --- | --- |
| `GET /organizations/:id/policies` | knowledge page `load()` | `knowledge-section.tsx` `load()` ✓ |
| `POST /organizations/:id/policies` | knowledge page `addPolicy()` | `knowledge-section.tsx` `addPolicy()` ✓ |
| `GET /organizations/:id/knowledge-documents` | knowledge page `load()` | `knowledge-section.tsx` `load()` ✓ |
| `POST /organizations/:id/knowledge-documents` | knowledge page `addDoc()` | `knowledge-section.tsx` `addDoc()` ✓ |
| `POST /organizations/:id/knowledge-documents/upload` (raw `fetch` + Bearer token) | knowledge page `uploadDocFile()` | `knowledge-section.tsx` `uploadDocFile()` ✓ |
| `GET /organizations/:id/business-profile` | knowledge page `load()` | Settings page already calls it (BusinessHub `load()`, pre-existing) ✓ |
| `PATCH /organizations/:id/business-profile` | knowledge page `saveProfile()` | Settings page already calls it (BusinessHub `save()`, pre-existing) ✓ |

No endpoint lost; no endpoint added.

### Labels / notices — preserved verbatim

- Section intro: "AI শুধু এখানে থাকা যাচাইকৃত তথ্যই ব্যবহার করবে। এখানে না থাকা দাম, স্টক বা পলিসি AI বানিয়ে বলতে পারবে না, এটাই নিয়ম।" ✓ (now the section hint)
- "পলিসি (শিপিং, রিফান্ড ইত্যাদি)", "এখনো কোনো পলিসি নেই।", placeholders "শিরোনাম" / "বিস্তারিত", button "পলিসি যোগ করুন", policy types shipping/delivery/refund/return/cancellation/payment/custom ✓
- "FAQ ও জ্ঞান ডকুমেন্ট", "এখনো কোনো ডকুমেন্ট নেই।", placeholders "প্রশ্ন / শিরোনাম" / "উত্তর / বিস্তারিত", button "FAQ যোগ করুন", source badges "📄 {file}" / "✍️ হাতে লেখা" ✓
- Upload: "ফাইল থেকে যোগ করুন (PDF, DOCX, TXT, MD — সর্বোচ্চ ১০MB)", accept `.pdf,.txt,.md,.docx`, "আপলোড হচ্ছে…" / "ফাইল আপলোড করুন", notices "ফাইল থেকে {n}টি ডকুমেন্ট তৈরি হয়েছে", "আপলোড ব্যর্থ হয়েছে ({status})", "আপলোড ব্যর্থ হয়েছে" ✓
- Errors: "কোনো Organization নির্বাচিত নেই।", "Failed to load" ✓
- Profile field labels: the five knowledge-page fields remain editable on the settings page under the BusinessHub's own pre-existing labels (ইন্ডাস্ট্রি, ওয়েবসাইট, ব্যবসার লক্ষ্য, ব্র্যান্ডের সুর (Brand Voice), and description as "ব্যবসা সম্পর্কে (AI এর ভাষায়)") — same record, same endpoint; the knowledge page's shorter label variants ("বিবরণ", "লক্ষ্য", "ব্র্যান্ড ভয়েস") were superseded by the settings page's existing labels in the unification, as documented in the audit above.

### Behaviour notes

- The section loads policies + documents on mount, independently of the BusinessHub (same as the old page's own load). Upload success still shows the `documentsCreated` count notice and reloads the lists. Add-policy / add-FAQ still reset their forms and reload.
- Presentation follows the settings pattern (`<section id="hub-knowledge" className="card scroll-mt-24 …">` + icon head); the two sub-blocks keep their original inner markup.

## Gates (worktree `ai-marketing-saas-set`)

Setup: `pnpm install` (pnpm 9.15.0 via npm exec; store shared). Note: `tsc` initially failed with 38 `Cannot find module '@repo/contracts'` errors — that package's `dist/` is a build artifact missing in a fresh worktree; after `pnpm --filter @repo/contracts build` all errors cleared. This is a pre-existing fresh-worktree setup step, unrelated to this change (no error touched any changed file).

- **Web tsc** (`tsc --noEmit` in apps/web): **0 errors** ✓
- **Web vitest** (`vitest run`): **55 test files passed, 446 tests passed** ✓
- **Next build** (`next build` in apps/web): **Compiled successfully** ✓ — route table shows `/dashboard/knowledge` at 142 B (the redirect) and `/dashboard/settings` at 11.5 kB.

## Honest limits

- **No screenshot QA** and no live browser verification were done — the move is code-verified only (types, unit tests, production build). The redirect-with-fragment and in-page anchor scroll should be eyeballed once after deploy.
- Nothing was pushed to GitHub; deploy/Redeploy remain the owner's steps, as always.
- Nothing in the API, AI grounding, or completeness computation changed — AI reads the same `BusinessProfile` / policies / documents as before.
