import { getFirestore } from "firebase-admin/firestore";
import { getAdminApp } from "./firebase-admin";
import { candidateFromUnknown, type Candidate, type CandidateRow } from "./candidate-schema";
import { roleFromUnknown, type RoleData, type RoleRow } from "./role-schema";

/**
 * Server-side Firestore access via the Admin SDK.
 * The browser never talks to Firestore directly; these functions back
 * the /api/candidates and /api/roles route handlers. The Admin SDK
 * bypasses security rules by design — the rules deny all client access.
 */

export function getAdminDb() {
  return getFirestore(getAdminApp());
}

const CANDIDATES = "candidates";
const ROLES = "roles";

/* ---------------- Candidates ---------------- */

export async function listCandidates(): Promise<CandidateRow[]> {
  const snapshot = await getAdminDb().collection(CANDIDATES).orderBy("createdAt", "desc").get();

  return snapshot.docs.map((doc) => ({
    ...candidateFromUnknown(doc.data()),
    id: doc.id,
  }));
}

export async function addCandidate(input: unknown): Promise<CandidateRow> {
  // Normalize before persisting so stored docs always match the schema.
  const candidate: Candidate = candidateFromUnknown(input);

  const ref = await getAdminDb()
    .collection(CANDIDATES)
    .add({
      ...candidate,
      createdAt: new Date(),
    });

  return { ...candidate, id: ref.id };
}

export async function removeCandidate(id: string): Promise<void> {
  await getAdminDb().collection(CANDIDATES).doc(id).delete();
}

/* ---------------- Roles ---------------- */

export async function listRoles(): Promise<RoleRow[]> {
  const snapshot = await getAdminDb().collection(ROLES).orderBy("createdAt", "desc").get();

  return snapshot.docs.map((doc) => ({
    ...roleFromUnknown(doc.data()),
    id: doc.id,
  }));
}

export async function addRole(input: unknown): Promise<RoleRow> {
  const role: RoleData = roleFromUnknown(input);

  const ref = await getAdminDb()
    .collection(ROLES)
    .add({
      ...role,
      createdAt: new Date(),
    });

  return { ...role, id: ref.id };
}

export async function removeRole(id: string): Promise<void> {
  await getAdminDb().collection(ROLES).doc(id).delete();
}
