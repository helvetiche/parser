"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CircleNotch,
  EnvelopeSimple,
  LockSimple,
  SignIn,
  Sparkle,
  WarningCircle,
} from "@phosphor-icons/react";
import { friendlyAuthError, observeAuth, signIn } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in? Straight to the app.
  useEffect(() => {
    const unsubscribe = observeAuth((user) => {
      if (user) router.replace("/");
      else setChecking(false);
    });
    return unsubscribe;
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !email.trim() || !password) return;

    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      router.replace("/");
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: string }).code)
          : "";
      setError(friendlyAuthError(code));
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-gray-100 via-gray-50 to-gray-200 px-5">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200/80 bg-white/90 p-8 shadow-xl backdrop-blur">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-gray-600 to-gray-900 text-white shadow-md">
            <Sparkle size={22} weight="fill" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-gray-900">
              Sign in to Parser
            </h1>
            <p className="mt-1 text-sm text-gray-500">Use your team account to continue.</p>
          </div>
        </div>

        {checking ? (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <CircleNotch size={22} className="animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold tracking-wider text-gray-500 uppercase">
                Email
              </span>
              <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 shadow-sm transition-all focus-within:border-gray-300 focus-within:ring-2 focus-within:ring-gray-200">
                <EnvelopeSimple size={16} className="shrink-0 text-gray-400" />
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full bg-transparent py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
                  disabled={busy}
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold tracking-wider text-gray-500 uppercase">
                Password
              </span>
              <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 shadow-sm transition-all focus-within:border-gray-300 focus-within:ring-2 focus-within:ring-gray-200">
                <LockSimple size={16} className="shrink-0 text-gray-400" />
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-transparent py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
                  disabled={busy}
                />
              </div>
            </label>

            {error && (
              <p className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs leading-relaxed font-medium text-red-600 ring-1 ring-red-100 ring-inset">
                <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !email.trim() || !password}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-gray-700 to-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <CircleNotch size={16} className="animate-spin" />
              ) : (
                <SignIn size={16} weight="bold" />
              )}
              Sign in
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
