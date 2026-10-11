# Milestone 58 Acceptance — Full Public Landing Page

- [x] **Landing is the public home at `/`.** `apps/web/src/app/page.tsx`
      previously server-redirected every visitor to `/dashboard`
      (which bounced anonymous visitors to `/login`). It is now a
      server wrapper (with landing-specific metadata) rendering the
      client landing (`landing-client.tsx`).
      **Routing choice:** anonymous visitors get the landing with
      clear লগইন / ফ্রি শুরু করুন CTAs; the pre-M58 behaviour for
      signed-in users is preserved — the landing client checks for a
      stored access token on mount and redirects token-holders to
      `/dashboard`, exactly where `/` used to send them.
- [x] **Sections, Bengali-first, real capabilities only:** hero,
      problem/solution, a 9-item feature grid (Unified Inbox, AI
      Assistant/Autopilot with strict grounding, Meta/Google/TikTok
      ad automation, AI Creative Studio, Steadfast/Pathao/RedX
      courier + live quotation + label PDFs, COD Return Risk Score,
      Workflow/Flow Builder, Analytics/Cohort/Profit, Leads/CRM/
      Customer 360 — every one shipped in M1–M57), 3-step
      how-it-works, showcase, ROI calculator, pricing, FAQ, final CTA.
- [x] **Showcase honesty.** The hero visual is a hand-built CSS frame
      in the style of the real inbox screen (conversation list, chat,
      Customer-360 rail with a risk badge), captioned on the page as
      "প্রোডাক্টের আসল ইনবক্স স্ক্রিনের ধাঁচে তৈরি একটি সরল
      উপস্থাপনা". It is not a screenshot, and the page contains NO
      fabricated screenshots, NO customer logos, NO testimonials and
      NO invented user/revenue statistics anywhere.
- [x] **Pricing from the operator-settings source — not hardcoded.**
      The pricing section fetches `GET /public/pricing`, the exact
      endpoint the `/pricing` page uses (backed by
      `AdminService.publicPricing()` over the operator's platform
      settings), and renders the tiers with the same shape and
      formatting as `/pricing`. If the operator leaves a price at 0
      it renders ৳০, exactly like `/pricing` does. The page copy says
      the prices come live from the operator settings. Verified live:
      the endpoint returned FREE ৳০ / STARTER ৳১,৫০০ / GROWTH ৳৩,০০০
      (operator defaults) and the section renders from that payload.
- [x] **ROI calculator — formula shown, estimate labelled.** Inputs:
      monthly orders, per-return total courier cost (আসা-যাওয়া),
      current return %, target return %. Formula displayed verbatim
      on the page: **মাসিক সাশ্রয় = মাসিক অর্ডার × (বর্তমান রিটার্ন %
      − লক্ষ্য রিটার্ন %) ÷ ১০০ × প্রতি রিটার্নের কুরিয়ার খরচ**.
      The output is labelled "আনুমানিক হিসাব" with the note that it is
      computed only from the visitor's own inputs and is not a
      promised saving. Pure client-side computation; nothing is sent
      anywhere.
- [x] **System-status behaviour respected.** The landing fetches
      `/public/system-status` like the register page: when signups are
      closed, every register CTA is replaced by a "সাইনআপ সাময়িক
      বন্ধ" notice (and the pricing section repeats the notice);
      maintenance mode shows the amber maintenance bar and a platform
      announcement shows the indigo announcement bar at the top. The
      register page itself is unchanged and still enforces its own
      closed-signup state.
- [x] **FAQ honesty.** Answers state plainly that live integrations
      (Meta, WooCommerce, couriers) run on the merchant's OWN
      accounts and that the platform supplies no third-party accounts
      or credentials; tenant isolation and the white-label/report
      features (M59) are described as they actually work.

## Verification
- Full monorepo build green (web rebuilt; `/` is a static route).
- Web unit tests: 20 pass (unchanged — landing adds no lib logic).
- API suite: 562 pass / 79 suites (unchanged — no API code touched).
- Live sandbox: web restarted on the new build; `GET /` → 200 with
  the Bengali hero in the served HTML; `/pricing` and `/login` still
  200; `GET /backend/public/pricing` returned the operator settings
  the section renders. Client-side interactions (calculator, FAQ
  accordions, signup-closed swap) are plain React state — verified by
  build + code path, not by a browser click-through; the signed-in
  redirect is a 3-line mount effect using the same `getToken()` the
  dashboard layout uses.

## Roadmap note
Next in Batch 5: **M59 Agency White-Label** (per-org branding on the
shell + PDFs, branded shareable client report on the M20 token
mechanism, custom-domain settings + guidance), then **M60 PWA**.
