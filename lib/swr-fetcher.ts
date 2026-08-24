"use client";

import { getIdToken } from "./auth";

/** Fetcher error carrying the HTTP status, so handlers can react to 401s. */
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * SWR fetcher for the app's authenticated route handlers.
 * Attaches the caller's Firebase ID token to every request.
 * Set as the default fetcher in <SWRConfig>.
 */
export async function authedFetcher<T>(url: string): Promise<T> {
  const token = await getIdToken();
  if (!token) throw new ApiError(401, "You are signed out. Please sign in again.");

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiError(0, "Network error. Check your connection.");
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (typeof data?.error === "string") message = data.error;
    } catch {
      // non-JSON body — keep fallback message
    }
    throw new ApiError(res.status, message);
  }

  return res.json() as Promise<T>;
}
