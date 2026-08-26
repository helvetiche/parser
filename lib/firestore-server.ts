import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getAdminApp } from "./firebase-admin";
import { candidateFromUnknown, type Candidate, type CandidateRow } from "./candidate-schema";
import { matchFromUnknown } from "./match-schema";
import {
  roleFromUnknown,
  type Endorsement,
  type EndorsementStatus,
  type RoleData,
  type RoleRow,
  type SavedEvaluation,
} from "./role-schema";
import { promptFromUnknown, type PromptData, type PromptRow } from "./prompt-schema";

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
const PROMPTS = "prompts";

/* ---------------- Candidates ---------------- */

export async function listCandidates(): Promise<CandidateRow[]> {
  const snapshot = await getAdminDb().collection(CANDIDATES).orderBy("createdAt", "desc").get();

  return snapshot.docs.map((doc) => ({
    ...candidateFromUnknown(doc.data()),
    id: doc.id,
  }));
}

export async function getCandidate(id: string): Promise<CandidateRow | null> {
  const doc = await getAdminDb().collection(CANDIDATES).doc(id).get();
  if (!doc.exists) return null;
  return { ...candidateFromUnknown(doc.data()), id: doc.id };
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

/** Rebuilds the evaluations map from raw document data, skipping junk entries. */
function evaluationsFromData(data: Record<string, unknown> | undefined) {
  const raw = data?.evaluations;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const out: Record<string, SavedEvaluation> = {};
  for (const [candidateId, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const obj = entry as Record<string, unknown>;
    const evaluatedAt = typeof obj.evaluatedAt === "string" ? obj.evaluatedAt : "";
    if (!evaluatedAt) continue;
    out[candidateId] = {
      ...matchFromUnknown(obj),
      candidateId,
      candidateName: typeof obj.candidateName === "string" ? obj.candidateName : "",
      evaluatedAt,
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function listRoles(): Promise<RoleRow[]> {
  const snapshot = await getAdminDb().collection(ROLES).orderBy("createdAt", "desc").get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    const evaluations = evaluationsFromData(data);
    const endorsements = endorsementsFromData(data);
    return {
      ...roleFromUnknown(data),
      ...(evaluations ? { evaluations } : {}),
      ...(endorsements ? { endorsements } : {}),
      id: doc.id,
    };
  });
}

/** Rebuilds the endorsements map from raw document data, skipping junk entries. */
function endorsementsFromData(data: Record<string, unknown> | undefined) {
  const raw = data?.endorsements;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const out: Record<string, Endorsement> = {};
  for (const [candidateId, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const obj = entry as Record<string, unknown>;
    const addedAt = typeof obj.addedAt === "string" ? obj.addedAt : "";
    if (!addedAt) continue;
    const status = obj.status;
    if (
      status !== "endorsed" &&
      status !== "interviewed" &&
      status !== "hired" &&
      status !== "rejected"
    )
      continue;
    out[candidateId] = {
      candidateId,
      candidateName: typeof obj.candidateName === "string" ? obj.candidateName : "",
      status: status as EndorsementStatus,
      addedAt,
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Persists one candidate evaluation on the role document under
 * `evaluations.<candidateId>` so the dotted path merges instead of
 * clobbering other candidates' stored evaluations.
 */
export async function saveRoleEvaluation(
  roleId: string,
  evaluation: SavedEvaluation
): Promise<void> {
  await getAdminDb()
    .collection(ROLES)
    .doc(roleId)
    .update({ [`evaluations.${evaluation.candidateId}`]: evaluation });
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

/**
 * Upserts one submitted candidate on the role document under
 * `endorsements.<candidateId>` so the dotted path merges instead of
 * clobbering other candidates' endorsements.
 */
export async function saveRoleEndorsement(
  roleId: string,
  endorsement: Endorsement
): Promise<void> {
  await getAdminDb()
    .collection(ROLES)
    .doc(roleId)
    .update({ [`endorsements.${endorsement.candidateId}`]: endorsement });
}

export async function removeRoleEndorsement(
  roleId: string,
  candidateId: string
): Promise<void> {
  await getAdminDb()
    .collection(ROLES)
    .doc(roleId)
    .update({ [`endorsements.${candidateId}`]: FieldValue.delete() });
}

/* ---------------- Prompts ---------------- */

function requirePromptBody(prompt: PromptData): PromptData {
  if (!prompt.prompt) throw new Error("Prompt text is required");
  return prompt;
}

export async function listPrompts(): Promise<PromptRow[]> {
  const snapshot = await getAdminDb().collection(PROMPTS).orderBy("createdAt", "desc").get();

  return snapshot.docs.map((doc) => ({
    ...promptFromUnknown(doc.data()),
    id: doc.id,
  }));
}

export async function addPrompt(input: unknown): Promise<PromptRow> {
  const prompt = requirePromptBody(promptFromUnknown(input));

  const ref = await getAdminDb()
    .collection(PROMPTS)
    .add({
      ...prompt,
      createdAt: new Date(),
    });

  return { ...prompt, id: ref.id };
}

export async function updatePrompt(id: string, input: unknown): Promise<void> {
  const prompt = requirePromptBody(promptFromUnknown(input));
  await getAdminDb()
    .collection(PROMPTS)
    .doc(id)
    .update({ ...prompt });
}

export async function removePrompt(id: string): Promise<void> {
  await getAdminDb().collection(PROMPTS).doc(id).delete();
}

/** Loads a saved prompt's instruction text; null when missing so callers fall back to the default. */
export async function getPromptInstructions(id: string): Promise<string | null> {
  if (!id) return null;
  const doc = await getAdminDb().collection(PROMPTS).doc(id).get();
  if (!doc.exists) return null;
  const prompt = promptFromUnknown(doc.data());
  return prompt.prompt || null;
}
