#!/usr/bin/env node
// Creates a login-only account in Firebase Auth using the Admin SDK.
//
// Usage:
//   npm run create-user -- <email> <password>
//   npm run create-user -- <email> <new-password> --reset   (reset existing)
//
// Requires FIREBASE_SERVICE_ACCOUNT in .env.

import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const args = process.argv.slice(2);
const reset = args.includes("--reset");
const positional = args.filter((a) => a !== "--reset");
const [email, password] = positional;

if (!email || !password || !email.includes("@")) {
  console.error(
    "Usage: npm run create-user -- <email> <password> [--reset]"
  );
  process.exit(1);
}

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT in .env");
  process.exit(1);
}

const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({
  credential: cert({
    projectId: account.project_id,
    clientEmail: account.client_email,
    privateKey: account.private_key.replace(/\\n/g, "\n"),
  }),
});

async function main() {
  const auth = getAuth();
  try {
    const user = await auth.createUser({ email, password });
    console.log(`Created account ${user.email} (uid: ${user.uid})`);
  } catch (err) {
    if (err.code === "auth/email-already-exists") {
      if (!reset) {
        console.error(`Account ${email} already exists. Use --reset to set a new password.`);
        process.exit(1);
      }
      const existing = await auth.getUserByEmail(email);
      await auth.updateUser(existing.uid, { password });
      console.log(`Password reset for ${email}`);
    } else {
      throw err;
    }
  }
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
