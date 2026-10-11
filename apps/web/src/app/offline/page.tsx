export const metadata = { title: "অফলাইন — AI Marketing OS" };

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
      <h1 className="mt-4 text-2xl font-bold text-slate-900">আপনি এখন অফলাইনে আছেন</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">
        ইন্টারনেট সংযোগ ফিরে এলেই সবকিছু আবার লাইভ হবে। ইনবক্সের মেসেজ ও অর্ডারের মতো লাইভ ডেটা
        অফলাইনে দেখানো হয় না — পুরনো ডেটা দেখিয়ে বিভ্রান্ত করা হবে না।
      </p>
      <a href="/dashboard/inbox" className="btn-primary mt-6">আবার চেষ্টা করুন</a>
      <a href="/dashboard" className="mt-3 text-sm font-medium text-indigo-600 hover:underline">ড্যাশবোর্ডে যান</a>
    </main>
  );
}
