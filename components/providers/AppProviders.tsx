"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { ApiError, authedFetcher } from "@/lib/swr-fetcher";

/**
 * Global SWR configuration.
 * - authedFetcher attaches Firebase ID tokens by default
 * - retries are disabled (401s / 5xx from our API shouldn't be hammered)
 * - focus revalidation stays on (default) so the team workspace stays fresh
 * - 401s bounce the user back to login
 */
export default function AppProviders({ children }: { children: ReactNode }) {
  const router = useRouter();

  return (
    <SWRConfig
      value={{
        fetcher: authedFetcher,
        shouldRetryOnError: false,
        onError(err) {
          if (err instanceof ApiError && err.status === 401) {
            router.replace("/login");
          }
        },
      }}
    >
      {children}
    </SWRConfig>
  );
}
