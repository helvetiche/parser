"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { SignOut } from "@phosphor-icons/react";
import { observeAuth, signOut, type User } from "@/lib/auth";

/** Shows the signed-in account and a sign-out action. */
export default function LogoutButton() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => observeAuth(setUser), []);

  if (!user) return null;

  const handleSignOut = async () => {
    await signOut();
    // Drop every cached query so the next session starts clean
    // (recommended pattern from the SWR docs).
    await mutate(() => true, undefined, { revalidate: false });
    router.replace("/login");
  };

  return (
    <div className="flex items-center gap-3">
      <span
        className="max-w-[180px] truncate text-xs font-medium text-gray-500"
        title={user.email ?? ""}
      >
        {user.email}
      </span>
      <button
        onClick={() => void handleSignOut()}
        className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 shadow-sm transition-all duration-150 hover:bg-gray-50 hover:text-gray-900 active:scale-[0.98]"
        title="Sign out"
      >
        <SignOut size={15} />
        Sign out
      </button>
    </div>
  );
}
