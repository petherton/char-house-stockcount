"use client";

import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = createClient();

  async function signIn() {
    const redirectTo = `${window.location.origin}/auth/callback`;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          The Char House
        </div>
        <h1 className="mb-6 text-2xl font-bold text-navy">Stock Count</h1>
        <button
          onClick={signIn}
          className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-3 font-medium text-gray-700 shadow-sm hover:bg-gray-50"
        >
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path
              fill="#FFC107"
              d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.9 5.1 29.7 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.4-.4-3.5z"
            />
            <path
              fill="#FF3D00"
              d="m6.3 14.7 6.6 4.8C14.7 15.5 19 12.5 24 12.5c3.1 0 5.8 1.1 8 3l6-6C34.9 5.1 29.7 3 24 3 16.3 3 9.7 7.3 6.3 14.7z"
            />
            <path
              fill="#4CAF50"
              d="M24 45c5.6 0 10.7-1.9 14.7-5.2l-6.8-5.6C29.8 35.7 27 36.5 24 36.5c-5.3 0-9.7-3.4-11.3-8.1l-6.6 5.1C9.6 40.6 16.3 45 24 45z"
            />
            <path
              fill="#1976D2"
              d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.6l6.8 5.6C41.6 35.9 45 30.4 45 24c0-1.2-.1-2.4-.4-3.5z"
            />
          </svg>
          Sign in with Google
        </button>
        <p className="mt-6 text-xs text-gray-400">
          Access is limited to authorised Char House staff. If you can&apos;t sign
          in, call IT on 0428 646 689.
        </p>
      </div>
    </main>
  );
}
