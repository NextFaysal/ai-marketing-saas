import React from "react";

/**
 * ADNX16 (NB5 screenshot QA find): until now an unknown admin URL
 * rendered Next.js's DEFAULT not-found page — a plain white screen
 * with English text, completely outside the console's dark visual
 * system (evidence: docs/qa-nb5/notfound-360.png, captured before
 * this file existed). This is the same surface the login pages use:
 * dark slate background, one centred card, Bengali copy, and one
 * action back to the Command Center. Presentation only — no route,
 * endpoint or behaviour changes (the build's /_not-found entry
 * exists with or without this file).
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="acard w-full max-w-md text-center">
        <div className="text-4xl font-bold tracking-tight">404</div>
        <div className="mt-2 font-semibold">পেজটি পাওয়া যায়নি</div>
        <p className="mt-1.5 text-sm text-slate-400">
          এই ঠিকানায় কোনো Admin পেজ নেই। ঠিকানাটি ভুল হতে পারে, অথবা পেজটি সরানো হয়েছে।
        </p>
        <a href="/" className="abtn mt-4 w-full">Command Center-এ ফিরুন</a>
      </div>
    </div>
  );
}
