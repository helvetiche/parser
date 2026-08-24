"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleNotch, Sparkle } from "@phosphor-icons/react";
import { observeAuth, type User } from "@/lib/auth";

/**
 * Client-side gate for protected pages: shows a loading state until the
 * auth state resolves, redirects to /login when signed out.
 * (API routes and Firestore rules enforce security server-side.)
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    const unsubscribe = observeAuth((current) => {
      setUser(current);
      setResolved(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (resolved && !user) router.replace("/login");
  }, [resolved, user, router]);

  if (!resolved || !user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 text-gray-400">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-gray-600 to-gray-900 text-white shadow-md">
          <Sparkle size={22} weight="fill" />
        </div>
        <CircleNotch size={20} className="animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
