import { pubT } from "@/lib/i18n/public";

const t = pubT();
export const metadata = { title: "অফলাইন — AI Marketing OS" }; // metadata (not rendered UI) — classified exception, stays bn

/**
 * Milestone 60: offline fallback. Precached by the service worker;
 * deliberately static (no data fetching) so it renders with zero
 * network. Shown only when a navigation fails offline and no cached
 * copy of that page exists.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="text-5xl">📡</div>
      <h1 className="mt-4 text-2xl font-bold text-slate-900">{t.offline.title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">{t.offline.text}</p>
      <a href="/dashboard/inbox" className="btn-primary mt-6">{t.offline.retry}</a>
      <a href="/dashboard" className="mt-3 text-sm font-medium text-indigo-600 hover:underline">{t.offline.goDashboard}</a>

    </main>
  );
}
