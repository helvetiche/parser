import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAdminAuth } from "./firebase-admin";

export type VerifiedUser = {
  uid: string;
  email?: string;
};

function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  return scheme.toLowerCase() === "bearer" && token ? token : null;
}

/**
 * Verify the request's Bearer ID token against Firebase Auth.
 * Returns the verified user, or null when missing/invalid/expired.
 */
export async function verifyRequestUser(req: NextRequest): Promise<VerifiedUser | null> {
  const token = bearerToken(req);
  if (!token) return null;

  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    if (!decoded.uid) return null;
    return { uid: decoded.uid, email: decoded.email };
  } catch {
    return null;
  }
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { error: "Authentication required. Please sign in again." },
    { status: 401 }
  );
}

/**
 * Route-handler guard: returns the verified user or a ready-to-return
 * 401 response. Usage inside POST():
 *
 *   const [user, denied] = await requireUser(req);
 *   if (denied) return denied;
 */
export async function requireUser(
  req: NextRequest
): Promise<[VerifiedUser, null] | [null, NextResponse]> {
  const user = await verifyRequestUser(req);
  return user ? [user, null] : [null, unauthorizedResponse()];
}
