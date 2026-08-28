import { randomUUID } from "node:crypto";
import { desc, eq, and } from "drizzle-orm";
import { getDb } from "./connection";
import { runMigrations } from "./migrate";
import { candidates, roles, prompts, roleEvaluations, roleEndorsements } from "./schema";
import { candidateFromUnknown, type Candidate, type CandidateRow } from "../candidate-schema";
import { matchFromUnknown } from "../match-schema";
import {
  roleFromUnknown,
  type Endorsement,
  type EndorsementStatus,
  type RoleData,
  type RoleRow,
  type SavedEvaluation,
} from "../role-schema";
import { promptFromUnknown, type PromptData, type PromptRow } from "../prompt-schema";

// Ensure DB is ready on first import (Next.js server)
// We call lazily inside each function too, but eager here helps dev
let migrationsRan = false;
function ensureDb() {
  if (!migrationsRan) {
    try {
      runMigrations();
      migrationsRan = true;
    } catch (e) {
      // If migrations fail because DB is already initialized via direct creation, ignore
      console.error("[db] migration failed", e);
    }
  }
  return getDb();
}

export function getAdminDb() {
  // Compatibility shim for old firestore-server callers
  return ensureDb();
}

/* ---------------- Helpers ---------------- */

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToCandidate(row: typeof candidates.$inferSelect): CandidateRow {
  return {
    id: row.id,
    fullName: row.fullName,
    summary: row.summary,
    education: row.education,
    experience: parseJsonArray(row.experience),
    skills: parseJsonArray(row.skills),
    expectedSalary: row.expectedSalary,
    reasoning: row.reasoning,
    contacts: parseJson(row.contacts, []),
  };
}

function rowToRoleBase(row: typeof roles.$inferSelect): RoleData & { id: string } {
  return {
    id: row.id,
    jobTitle: row.jobTitle,
    description: row.description,
    responsibilities: parseJsonArray(row.responsibilities),
    requirements: parseJsonArray(row.requirements),
    skills: parseJsonArray(row.skills),
  };
}

function rowToPrompt(row: typeof prompts.$inferSelect): PromptRow {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
  };
}

/* ---------------- Candidates ---------------- */

export async function listCandidates(): Promise<CandidateRow[]> {
  const db = ensureDb();
  const rows = await db.select().from(candidates).orderBy(desc(candidates.createdAt));
  return rows.map(rowToCandidate);
}

export async function getCandidate(id: string): Promise<CandidateRow | null> {
  const db = ensureDb();
  const rows = await db.select().from(candidates).where(eq(candidates.id, id)).limit(1);
  if (rows.length === 0) return null;
  return rowToCandidate(rows[0]);
}

export async function addCandidate(input: unknown): Promise<CandidateRow> {
  const db = ensureDb();
  const candidate: Candidate = candidateFromUnknown(input);
  const id = randomUUID();
  const now = Date.now();
  await db.insert(candidates).values({
    id,
    fullName: candidate.fullName,
    summary: candidate.summary,
    education: candidate.education,
    experience: JSON.stringify(candidate.experience),
    skills: JSON.stringify(candidate.skills),
    expectedSalary: candidate.expectedSalary,
    reasoning: candidate.reasoning,
    contacts: JSON.stringify(candidate.contacts),
    createdAt: now,
  });
  return { ...candidate, id };
}

export async function removeCandidate(id: string): Promise<void> {
  const db = ensureDb();
  // Manual cascade to role_evaluations / role_endorsements (candidateId not FK
  // so orphan evaluations survive migration, but deleting a candidate should
  // clean its history).
  await db.delete(roleEvaluations).where(eq(roleEvaluations.candidateId, id));
  await db.delete(roleEndorsements).where(eq(roleEndorsements.candidateId, id));
  await db.delete(candidates).where(eq(candidates.id, id));
}

export async function updateCandidate(id: string, input: unknown): Promise<CandidateRow> {
  const db = ensureDb();
  const candidate: Candidate = candidateFromUnknown(input);
  const existing = await db.select().from(candidates).where(eq(candidates.id, id)).limit(1);
  if (existing.length === 0) throw new Error("Candidate not found");
  await db
    .update(candidates)
    .set({
      fullName: candidate.fullName,
      summary: candidate.summary,
      education: candidate.education,
      experience: JSON.stringify(candidate.experience),
      skills: JSON.stringify(candidate.skills),
      expectedSalary: candidate.expectedSalary,
      reasoning: candidate.reasoning,
      contacts: JSON.stringify(candidate.contacts),
    })
    .where(eq(candidates.id, id));
  return { ...candidate, id };
}

/* ---------------- Roles ---------------- */

function evaluationsFromRows(rows: (typeof roleEvaluations.$inferSelect)[]): Record<string, SavedEvaluation> | undefined {
  if (rows.length === 0) return undefined;
  const out: Record<string, SavedEvaluation> = {};
  for (const r of rows) {
    // Use matchFromUnknown to normalize but preserve stored score/verdict
    const base = matchFromUnknown({
      score: r.score,
      verdict: r.verdict,
      currentJob: r.currentJob,
      openToWork: r.openToWork,
      matchedSkills: parseJsonArray(r.matchedSkills),
      missingSkills: parseJsonArray(r.missingSkills),
      toolExperience: parseJson(r.toolExperience, []),
      metRequirements: parseJsonArray(r.metRequirements),
      reasoning: r.reasoning,
    });
    // matchFromUnknown recomputes verdict from score; preserve stored verdict if needed, but recomputed is deterministic
    out[r.candidateId] = {
      ...base,
      candidateId: r.candidateId,
      candidateName: r.candidateName,
      evaluatedAt: r.evaluatedAt,
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function endorsementsFromRows(rows: (typeof roleEndorsements.$inferSelect)[]): Record<string, Endorsement> | undefined {
  if (rows.length === 0) return undefined;
  const out: Record<string, Endorsement> = {};
  for (const r of rows) {
    if (!r.addedAt) continue;
    if (r.status !== "endorsed" && r.status !== "interviewed" && r.status !== "hired" && r.status !== "rejected") continue;
    out[r.candidateId] = {
      candidateId: r.candidateId,
      candidateName: r.candidateName,
      status: r.status as EndorsementStatus,
      addedAt: r.addedAt,
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function listRoles(): Promise<RoleRow[]> {
  const db = ensureDb();
  const roleRows = await db.select().from(roles).orderBy(desc(roles.createdAt));
  const result: RoleRow[] = [];
  for (const role of roleRows) {
    const base = rowToRoleBase(role);
    const [evalRows, endorseRows] = await Promise.all([
      db.select().from(roleEvaluations).where(eq(roleEvaluations.roleId, role.id)),
      db.select().from(roleEndorsements).where(eq(roleEndorsements.roleId, role.id)),
    ]);
    const evaluations = evaluationsFromRows(evalRows);
    const endorsements = endorsementsFromRows(endorseRows);
    result.push({
      ...base,
      ...(evaluations ? { evaluations } : {}),
      ...(endorsements ? { endorsements } : {}),
    });
  }
  return result;
}

export async function saveRoleEvaluation(roleId: string, evaluation: SavedEvaluation): Promise<void> {
  const db = ensureDb();
  // Ensure role exists; if candidate doesn't exist, FK would fail - but evaluations should still allow
  // We use INSERT ... ON CONFLICT DO UPDATE. For better-sqlite3 we can use .onConflictDoUpdate
  // Drizzle's onConflictDoUpdate requires SQLite 3.24+
  await db
    .insert(roleEvaluations)
    .values({
      roleId,
      candidateId: evaluation.candidateId,
      candidateName: evaluation.candidateName,
      evaluatedAt: evaluation.evaluatedAt,
      score: evaluation.score,
      verdict: evaluation.verdict,
      currentJob: evaluation.currentJob,
      openToWork: evaluation.openToWork,
      matchedSkills: JSON.stringify(evaluation.matchedSkills),
      missingSkills: JSON.stringify(evaluation.missingSkills),
      toolExperience: JSON.stringify(evaluation.toolExperience),
      metRequirements: JSON.stringify(evaluation.metRequirements),
      reasoning: evaluation.reasoning,
    })
    .onConflictDoUpdate({
      target: [roleEvaluations.roleId, roleEvaluations.candidateId],
      set: {
        candidateName: evaluation.candidateName,
        evaluatedAt: evaluation.evaluatedAt,
        score: evaluation.score,
        verdict: evaluation.verdict,
        currentJob: evaluation.currentJob,
        openToWork: evaluation.openToWork,
        matchedSkills: JSON.stringify(evaluation.matchedSkills),
        missingSkills: JSON.stringify(evaluation.missingSkills),
        toolExperience: JSON.stringify(evaluation.toolExperience),
        metRequirements: JSON.stringify(evaluation.metRequirements),
        reasoning: evaluation.reasoning,
      },
    });
}

export async function addRole(input: unknown): Promise<RoleRow> {
  const db = ensureDb();
  const role: RoleData = roleFromUnknown(input);
  const id = randomUUID();
  const now = Date.now();
  await db.insert(roles).values({
    id,
    jobTitle: role.jobTitle,
    description: role.description,
    responsibilities: JSON.stringify(role.responsibilities),
    requirements: JSON.stringify(role.requirements),
    skills: JSON.stringify(role.skills),
    createdAt: now,
  });
  return { ...role, id };
}

export async function removeRole(id: string): Promise<void> {
  const db = ensureDb();
  await db.delete(roles).where(eq(roles.id, id));
}

export async function updateRole(id: string, input: unknown): Promise<RoleRow> {
  const db = ensureDb();
  const role: RoleData = roleFromUnknown(input);
  const existing = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (existing.length === 0) throw new Error("Role not found");
  await db
    .update(roles)
    .set({
      jobTitle: role.jobTitle,
      description: role.description,
      responsibilities: JSON.stringify(role.responsibilities),
      requirements: JSON.stringify(role.requirements),
      skills: JSON.stringify(role.skills),
    })
    .where(eq(roles.id, id));
  const [evalRows, endorseRows] = await Promise.all([
    db.select().from(roleEvaluations).where(eq(roleEvaluations.roleId, id)),
    db.select().from(roleEndorsements).where(eq(roleEndorsements.roleId, id)),
  ]);
  const evaluations = evaluationsFromRows(evalRows);
  const endorsements = endorsementsFromRows(endorseRows);
  return {
    ...role,
    id,
    ...(evaluations ? { evaluations } : {}),
    ...(endorsements ? { endorsements } : {}),
  };
}

export async function saveRoleEndorsement(roleId: string, endorsement: Endorsement): Promise<void> {
  const db = ensureDb();
  await db
    .insert(roleEndorsements)
    .values({
      roleId,
      candidateId: endorsement.candidateId,
      candidateName: endorsement.candidateName,
      status: endorsement.status,
      addedAt: endorsement.addedAt,
    })
    .onConflictDoUpdate({
      target: [roleEndorsements.roleId, roleEndorsements.candidateId],
      set: {
        candidateName: endorsement.candidateName,
        status: endorsement.status,
        addedAt: endorsement.addedAt,
      },
    });
}

export async function removeRoleEndorsement(roleId: string, candidateId: string): Promise<void> {
  const db = ensureDb();
  await db
    .delete(roleEndorsements)
    .where(and(eq(roleEndorsements.roleId, roleId), eq(roleEndorsements.candidateId, candidateId)));
}

/* ---------------- Prompts ---------------- */

function requirePromptBody(prompt: PromptData): PromptData {
  if (!prompt.prompt) throw new Error("Prompt text is required");
  return prompt;
}

export async function listPrompts(): Promise<PromptRow[]> {
  const db = ensureDb();
  const rows = await db.select().from(prompts).orderBy(desc(prompts.createdAt));
  return rows.map(rowToPrompt);
}

export async function addPrompt(input: unknown): Promise<PromptRow> {
  const db = ensureDb();
  const prompt = requirePromptBody(promptFromUnknown(input));
  const id = randomUUID();
  const now = Date.now();
  await db.insert(prompts).values({
    id,
    title: prompt.title,
    prompt: prompt.prompt,
    createdAt: now,
  });
  return { ...prompt, id };
}

export async function updatePrompt(id: string, input: unknown): Promise<void> {
  const db = ensureDb();
  const prompt = requirePromptBody(promptFromUnknown(input));
  await db.update(prompts).set({ title: prompt.title, prompt: prompt.prompt }).where(eq(prompts.id, id));
}

export async function removePrompt(id: string): Promise<void> {
  const db = ensureDb();
  await db.delete(prompts).where(eq(prompts.id, id));
}

export async function getPromptInstructions(id: string): Promise<string | null> {
  if (!id) return null;
  const db = ensureDb();
  const rows = await db.select().from(prompts).where(eq(prompts.id, id)).limit(1);
  if (rows.length === 0) return null;
  const prompt = promptFromUnknown({ title: rows[0].title, prompt: rows[0].prompt });
  return prompt.prompt || null;
}
