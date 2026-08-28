/**
 * @deprecated - Firestore has been replaced by SQLite (lib/db).
 * This file is now a compatibility shim that re-exports the SQLite
 * implementation so existing `import from "@/lib/firestore-server"`
 * continues to work. New code should import from "@/lib/db" instead.
 *
 * Firebase Auth (lib/firebase-admin.ts) is still used for auth; only
 * data storage moved to SQLite.
 */
export * from "./db/index";
