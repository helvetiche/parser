import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";

/**
 * Firebase Admin SDK — server-side only. All data access goes through
 * here; the browser client SDK is used for authentication exclusively.
 *
 * Credentials: prefer FIREBASE_SERVICE_ACCOUNT (the full service-account
 * JSON on one line). The individual FIREBASE_ADMIN_* vars work too.
 */

let cachedApp: App | null = null;

function serviceAccountFromEnv(): {
  projectId: string;
  clientEmail: string;
  privateKey: string;
} | null {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (rawJson) {
    try {
      const json = JSON.parse(rawJson) as Record<string, string>;
      if (json.project_id && json.client_email && json.private_key) {
        return {
          projectId: json.project_id,
          clientEmail: json.client_email,
          privateKey: json.private_key.replace(/\\n/g, "\n"),
        };
      }
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT is set but not valid JSON.");
    }
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }

  return null;
}

export function getAdminApp(): App {
  if (cachedApp) return cachedApp;

  const account = serviceAccountFromEnv();
  if (!account) {
    throw new Error(
      "Server auth is not configured. Set FIREBASE_SERVICE_ACCOUNT (service-account JSON) in the environment."
    );
  }

  const existing = getApps().find((a) => a.name === "admin");
  cachedApp =
    existing ??
    initializeApp(
      {
        credential: cert({
          projectId: account.projectId,
          clientEmail: account.clientEmail,
          privateKey: account.privateKey,
        }),
      },
      "admin"
    );

  return cachedApp;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}
