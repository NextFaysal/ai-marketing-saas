# SP2 — Composer + Drafts UI: Acceptance

**Scope:** Web only (`apps/web/**`). The SP1 API (`social/accounts`, `social/media`, `social/posts`) was built in parallel against the agreed contract; this UI codes against exactly that contract. No API files were touched, nothing was committed by this step.

## What was built

### Page — `apps/web/src/app/dashboard/social-posts/page.tsx`
Nav entry "📣 Social Posts" added in both places the dashboard nav is assembled (`src/lib/nav.ts` NAV_ITEMS + the "বিজ্ঞাপন" group in `src/app/dashboard/layout.tsx`), next to Campaigns.

- **Accounts strip:** connected accounts as cards — platform label (Facebook Page / Instagram), name, `@username` for Instagram, status badge in Bengali (সংযুক্ত / বিচ্ছিন্ন / ত্রুটি), `lastError` shown verbatim in red, and a disconnect button (connected accounts only) behind a Bengali `window.confirm`. Disconnect keeps drafts/posts (stated in the confirm text).
- **Meta connect flow:** "Meta অ্যাকাউন্ট যুক্ত করুন" opens the flow inline — token (password input) → "🔍 Page খুঁজুন" calls `POST social/accounts/meta/discover` → checkbox picker: each page shows its Instagram indented underneath (with `@username`, or the honest "Instagram যুক্ত নেই" when `instagram` is null); already-connected pages/IG accounts are pre-checked and labelled "আগে থেকেই কানেক্টেড". Editing the token clears the previous discovery so a stale picker can never be submitted. Helper text states a page selection includes its Instagram automatically. Connect with an empty selection is a client-side Bengali error and makes no API call; success clears the token, closes the flow, shows a Bengali notice and reloads the accounts.
- **Composer:** caption textarea with a live character count (informational only, no limit claimed), optional link URL, media picker (upload + library — see the media-source decision below), selected media as removable thumbnails (max 10, enforced with a Bengali error), and an account multi-select. Only `connected` accounts are selectable; disconnected/error accounts render disabled with their status (and `lastError` when present) as the reason. "Draft সংরক্ষণ করুন" issues one `POST social/posts` per selected account (the SP1 model is per-account), sequentially so a failure surfaces the server's message verbatim; if a later account fails, the list is refreshed so the user sees exactly which drafts were saved. No account selected → Bengali error, no call.
- **Edit mode:** a draft's "সম্পাদনা" loads caption/link/media/account into the composer; saving issues `PATCH social/posts/:id`. The account is locked in edit mode (a draft belongs to one account). Non-draft posts expose no edit/delete controls; if the server still refuses (409), its Bengali message is surfaced verbatim in the page error area.
- **Posts list:** filter bar (search text + status select: সব/Draft/Scheduled/Published/Failed/Cancelled + account select) running through the pure `filterSocialPosts`; result count shown ("Nটি পোস্ট দেখাচ্ছে (মোট Mটি)"). Each card: status badge with Bengali labels for **every** status in the contract — including `sent_to_creator` → "Creator-এর কাছে পাঠানো হয়েছে" and `publishing` → "পাবলিশ হচ্ছে" — account name + platform (+ `@username`), caption preview clamped to 2 lines, first-media thumbnail, created date (`bn-BD`), `error` verbatim in red, a "প্রকাশিত পোস্ট দেখুন" link when a published post carries a `platformUrl`, and Edit/Delete (draft only, delete behind a confirm). Empty states are honest and distinct: no posts at all (EmptyState pointing at the composer) vs. filter-matched-nothing (explicitly says the posts were not deleted and gives the total).
- **No schedule/publish controls exist anywhere on the page** — by design (SP5/SP6). An honest note under the composer says so: "শিডিউল ও পাবলিশের সুবিধা পরের ধাপে আসছে — আপাতত Draft সংরক্ষণ করুন।"

### Media thumbnails — inbox pattern, mirrored
The inbox renders protected media by fetching the bytes through the API proxy with the app's Bearer token and using a blob object URL (`MediaView` in the inbox page) — a plain `<img src>` would 401. `MediaThumb` in this page mirrors that exactly against `GET social/media/:id/file`, with the same loading/failed placeholders and object-URL revocation on unmount. It is used for the selected-media strip, the library grid, and post cards. Account/picker avatars use the `pictureUrl` values returned by the API directly (those are platform CDN URLs, not our protected bytes).

### Pure filter — `apps/web/src/lib/social-post-filters.ts`
`filterSocialPosts(posts, { query?, status?, accountId? })` — framework-free, typed to the contract (`SocialPost`, `SocialPostStatus` incl. `publishing`/`sent_to_creator`, `SocialMediaRef`). Query matches caption + account name + `@username`, case-insensitive substring; status and account match exactly; filters combine (AND). Modelled on AD6's `filterAdAccounts`.

## Media-source decision (from the audit) — product images DEFERRED, plainly

The composer brief listed three media sources. Two are implemented; the third is **not**, deliberately:

- ✅ **Upload new file** — file input → base64 (`FileReader`) → `POST social/media` → the returned asset is auto-attached.
- ✅ **Media library** — `GET social/media` thumbnail grid; click attaches (already-attached items are marked and disabled).
- ❌ **Product image — deferred.** Audit finding: the products API does return an `imageUrl` on each product (`GET products` → `{ total, items[] }`, `imageUrl` is a plain external URL string), but `mediaRefs` require MediaStore `assetId`s, and **there is no "import image from URL into MediaStore" endpoint anywhere in the API** (searched `apps/api/src` — none exists; the SP1 contract's only media-creation route is `POST social/media` with base64 bytes). Rather than fake the source (e.g. hot-linking the product URL, or fetching arbitrary external URLs from the browser where CORS makes it unreliable), the picker ships with upload + library only. **To un-defer:** add a server-side import endpoint (e.g. `POST social/media/import-url { url }` that fetches, magic-byte-validates via the existing MediaStore path, and returns an asset); the picker UI can then add the third tab with no other changes.

## Evidence

- **Web tests:** `npx vitest run` in `apps/web` — **6 files, 49 tests, all pass**, including the new `src/lib/social-post-filters.test.ts` (6 tests: no-filter, status, account, query across caption/account name/username, combined AND, empty input), written in the same style as `ad-account-filters.test.ts`.
- **Types:** `npx tsc --noEmit` in `apps/web` — **clean (exit 0)**.
- **Build:** `npx next build` — **green**; `/dashboard/social-posts` route emitted (7.62 kB page, 110 kB first load).

## Honest ceiling

- The SP1 API was being built in parallel; **no live click-through is claimed.** Evidence is web tests + tsc + production build against the written contract. A real connect/discover/draft round-trip awaits the merged API (and, for a real Meta token, the owner's app — M30 pattern).
- Discover/connect response shapes are consumed exactly as contracted (`{ pages: [...] }`, `{ accounts: [...] }`); any drift found at integration time will surface as the server's verbatim error message in the UI, not as a silent failure.
- Upload reads the whole file into memory as base64 (the contract's shape); very large videos will be slow — a chunked/resumable upload is out of SP2 scope.
