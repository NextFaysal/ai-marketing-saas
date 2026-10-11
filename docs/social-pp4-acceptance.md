# PP4 — Instagram Carousel — Acceptance

**Status:** delivered (local commit; see repo log). Batch 2 of the Social Posts Completion Package (docs/social-posts-completion-plan.md). With PP2 this closes the package (PP1–PP4).

## The problem
SP6 shipped Instagram as single-media only: a post with 2+ media failed permanently with "একাধিক ছবির Carousel এই সংস্করণে নেই". Multi-photo posts — the normal shape for product showcases — could never reach Instagram.

## What shipped (`MetaSocialPublisher.publishToInstagram`)
- **1 item:** the exact SP6 path, unchanged (container → poll → publish → best-effort permalink). The poll loop was extracted verbatim into a shared `awaitContainerFinished` helper — behaviour identical, and SP6's regression specs pass untouched (one exception below).
- **2–10 items → carousel:**
  1. one container per item with `is_carousel_item=true` — images via `image_url`, videos via `video_url` + `media_type=REELS` (the same per-item rules as singles; item containers carry NO caption, per Instagram's API);
  2. each item container polled to `FINISHED` with the same bounded discipline as singles (maxPolls × pollIntervalMs);
  3. the CAROUSEL container: `media_type=CAROUSEL`, `children=<comma-joined item ids>`, and the post's caption (the caption lives here, not on items);
  4. the carousel container polled, then `media_publish`, then the best-effort permalink — exactly like singles.
  Items are created/polled strictly in order; media_publish only ever runs on the finished carousel container, so a mid-flow failure can never partially publish.
- **Rules enforced (Instagram's documented ones):** 2–10 items per carousel (10 inclusive — spec-proven at both bounds); each item validated by the same raster/kind rules as singles upstream — SVG items are converted to PNG by PP1's step in SocialPublishService BEFORE the publisher sees them, exactly as for single posts.

## Error classification (SP6's, mirrored deliberately — not reinvented)
- **>10 items → PermanentPublishError** (Bengali), decided pre-flight: attempts untouched, ZERO platform calls (spec-asserted).
- **Container-creation refusals** (Graph errors at `/media` POST) propagate VERBATIM as plain errors → the normal SP5 retry path.
- **Container processing ERROR/EXPIRED** likewise surfaces Meta's verbatim status text as a plain error → retry path (a processing error can be transient). Spec-proven: a child ERROR with attempts=2 ends failed with attempts=3 (retry classification), the verbatim text on the post, and media_publish never called.
- Zero media keeps SP6's permanent refusal.

## UI copy audit
The SP6-era single-only wording lived in exactly one place — the publisher's permanent-error string — and is replaced. The web composer/detail was audited: no copy implied Instagram is single-only (the composer's `MAX_MEDIA` was already 10, matching the carousel bound), so PP4 needed no web change.

## Spec change note
`social-sp6.spec.ts`'s "two media → failed permanently" case asserted the pre-PP4 contract and was replaced with a smoke assertion of the new behaviour (two media publish as a carousel; children ids join correctly), with the reason noted in the file header — the PP1 precedent. The full sequence coverage lives in the new spec.

## Evidence (boundary — stated plainly)
- New specs `apps/api/src/social/social-pp4.spec.ts` (7 tests) at the stubbed-fetch Graph boundary: two-image full call sequence + ordering + children/caption placement; mixed image+video (REELS item); an IN_PROGRESS item polled until FINISHED; child ERROR → verbatim + retry classification + no partial publish; creation refusal verbatim; 11 items refused pre-flight with zero fetch calls; exactly 10 items publish.
- Full API suite: 171 suites / 1413 tests, ALL PASS. Web: 72/72. Monorepo build: green, 7/7 packages.
- NOT proven (sandbox ceiling, same as the whole package): no live Instagram publish — no real Meta app/IG account exists here. The specs prove request shapes and state handling at the client boundary, never a real post.
- No migration. Nothing pushed to GitHub.
