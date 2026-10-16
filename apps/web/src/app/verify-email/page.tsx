"use client";
import React, { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { API_URL } from "@/lib/api";

/**
 * GC21 (GB9): public landing page for the emailed verification
 * link (`${WEB_URL}/verify-email?token=...`). Posts the token to
 * POST /auth/verify-email — the API is the only place the token
 * is consumed; the page just renders the outcome in Bengali.
 */
function VerifyForm() {
  const sp = useSearchParams();
  const token = sp.get("token") ?? "";
  const [state, setState] = useState<"working" | "done" | "already" | "failed">("working");
  const [msg, setMsg] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) { setState("failed"); setMsg("লিংকে টোকেন পাওয়া যায়নি। ইমেইলের সঠিক যাচাইকরণ লিংকটি ব্যবহার করুন।"); return; }
    (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/verify-email`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.verified !== true) throw new Error(body.message ?? "লিংকটি অবৈধ বা মেয়াদোত্তীর্ণ");
        setState(body.alreadyVerified ? "already" : "done");
      } catch (err) {
        setState("failed");
        setMsg(err instanceof Error ? err.message : "যাচাই করা যায়নি");
      }
    })();
  }, [token]);

  if (state === "working") return <p className="text-center text-sm text-slate-500">যাচাই হচ্ছে…</p>;
  if (state === "done" || state === "already") return (
    <div className="space-y-3 text-center">
      <div className="text-4xl">✅</div>
      <p className="font-medium">{state === "already" ? "আপনার ইমেইল আগেই যাচাই করা হয়েছে।" : "আপনার ইমেইল সফলভাবে যাচাই হয়েছে!"}</p>
      <p className="text-sm text-slate-500">এখন ড্যাশবোর্ডে গিয়ে কাজ শুরু করতে পারবেন।</p>
      <a href="/dashboard" className="btn-primary inline-block">ড্যাশবোর্ডে যান</a>
      <a href="/login" className="block text-sm text-blue-600">লগইন করুন</a>
    </div>
  );
  return (
    <div className="space-y-3 text-center">
      <div className="text-4xl">⚠️</div>
      <p className="font-medium">যাচাই সম্পন্ন হয়নি</p>
      <p className="text-sm text-red-600">{msg}</p>
      <p className="text-sm text-slate-500">লগইন করে Settings → যাচাইকরণ অংশ থেকে নতুন লিংক পাঠাতে পারবেন।</p>
      <a href="/login" className="btn-primary inline-block">লগইন করুন</a>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <Suspense fallback={<p className="text-sm text-slate-500">লোড হচ্ছে…</p>}>
          <VerifyForm />
        </Suspense>
      </div>
    </div>
  );
}
