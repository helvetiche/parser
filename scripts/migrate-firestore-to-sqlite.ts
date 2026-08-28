#!/usr/bin/env tsx
/**
 * One-off migration: Firestore -> SQLite
 * Reads all documents from Firestore collections (candidates, roles, prompts)
 * and inserts them into the local SQLite DB (data/app.db) via Drizzle.
 *
 * Usage:
 *   npm run db:migrate:firestore
 *   # or
 *   npx tsx scripts/migrate-firestore-to-sqlite.ts
 *   npx tsx scripts/migrate-firestore-to-sqlite.ts --dry-run
 *
 * Requires FIREBASE_SERVICE_ACCOUNT in .env (or other firebase-admin env).
 * SQLite DB will be created/migrated automatically if missing.
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAdminApp } from "../lib/firebase-admin";
import { getDb, getDbPath } from "../lib/db/connection";
import { runMigrations } from "../lib/db/migrate";
import { candidates, roles, prompts, roleEvaluations, roleEndorsements } from "../lib/db/schema";
import { candidateFromUnknown } from "../lib/candidate-schema";
import { roleFromUnknown } from "../lib/role-schema";
import { promptFromUnknown } from "../lib/prompt-schema";
import { matchFromUnknown } from "../lib/match-schema";

const DRY_RUN = process.argv.includes("--dry-run");

function toMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === "object" && "toDate" in (value as Record<string, unknown>)) {
    try {
      const d = (value as { toDate: () => Date }).toDate();
      return d.getTime();
    } catch {}
  }
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Date.parse(value);
    if (!Number.isNaN(n)) return n;
  }
  return Date.now();
}

function toIso(value: unknown): string {
  if (typeof value === "string" && value) return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value && typeof value === "object" && "toDate" in (value as Record<string, unknown>)) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {}
  }
  return new Date().toISOString();
}

async function main() {
  console.log(`[migrate] SQLite path: ${getDbPath()}`);
  if (DRY_RUN) console.log("[migrate] DRY RUN - no writes");

  // Ensure SQLite schema exists before touching Firestore
  if (!DRY_RUN) {
    runMigrations();
  }
  const db = getDb();

  let firestore: ReturnType<typeof getFirestore>;
  try {
    firestore = getFirestore(getAdminApp());
  } catch (e) {
    console.error("[migrate] Failed to init Firebase Admin. Check FIREBASE_SERVICE_ACCOUNT.");
    throw e;
  }

  // ---- Candidates ----
  console.log("[migrate] Fetching candidates from Firestore...");
  const candSnap = await firestore.collection("candidates").get();
  console.log(`[migrate] Found ${candSnap.size} candidates`);
  let candInserted = 0;
  for (const doc of candSnap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const id = doc.id;
    const candidate = candidateFromUnknown(data);
    const createdAt = toMillis(data.createdAt);

    if (DRY_RUN) {
      console.log(`  - candidate ${id}: ${candidate.fullName}`);
      continue;
    }

    await db
      .insert(candidates)
      .values({
        id,
        fullName: candidate.fullName,
        summary: candidate.summary,
        education: candidate.education,
        experience: JSON.stringify(candidate.experience),
        skills: JSON.stringify(candidate.skills),
        expectedSalary: candidate.expectedSalary,
        reasoning: candidate.reasoning,
        contacts: JSON.stringify(candidate.contacts),
        createdAt,
      })
      .onConflictDoUpdate({
        target: candidates.id,
        set: {
          fullName: candidate.fullName,
          summary: candidate.summary,
          education: candidate.education,
          experience: JSON.stringify(candidate.experience),
          skills: JSON.stringify(candidate.skills),
          expectedSalary: candidate.expectedSalary,
          reasoning: candidate.reasoning,
          contacts: JSON.stringify(candidate.contacts),
          // keep original createdAt if already exists; but update to keep deterministic
          createdAt,
        },
      });
    candInserted++;
  }
  console.log(`[migrate] Candidates upserted: ${candInserted}`);

  // ---- Roles ----
  console.log("[migrate] Fetching roles from Firestore...");
  const roleSnap = await firestore.collection("roles").get();
  console.log(`[migrate] Found ${roleSnap.size} roles`);
  let roleInserted = 0;
  let evalInserted = 0;
  let endorseInserted = 0;

  for (const doc of roleSnap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const id = doc.id;
    const role = roleFromUnknown(data);
    const createdAt = toMillis(data.createdAt);

    if (!DRY_RUN) {
      await db
        .insert(roles)
        .values({
          id,
          jobTitle: role.jobTitle,
          description: role.description,
          responsibilities: JSON.stringify(role.responsibilities),
          requirements: JSON.stringify(role.requirements),
          skills: JSON.stringify(role.skills),
          createdAt,
        })
        .onConflictDoUpdate({
          target: roles.id,
          set: {
            jobTitle: role.jobTitle,
            description: role.description,
            responsibilities: JSON.stringify(role.responsibilities),
            requirements: JSON.stringify(role.requirements),
            skills: JSON.stringify(role.skills),
            createdAt,
          },
        });
    } else {
      console.log(`  - role ${id}: ${role.jobTitle}`);
    }
    roleInserted++;

    // evaluations map
    const evaluations = data.evaluations as Record<string, unknown> | undefined;
    if (evaluations && typeof evaluations === "object" && !Array.isArray(evaluations)) {
      for (const [candidateId, entry] of Object.entries(evaluations)) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const obj = entry as Record<string, unknown>;
        const evaluatedAt = typeof obj.evaluatedAt === "string" ? obj.evaluatedAt : toIso(obj.evaluatedAt);
        if (!evaluatedAt) continue;
        const match = matchFromUnknown(obj);
        const candidateName = typeof obj.candidateName === "string" ? obj.candidateName : candidateId;
        if (DRY_RUN) {
          console.log(`    eval ${candidateId} -> ${match.score}`);
          continue;
        }
        // Ensure candidate exists for FK? If missing, create stub? For now skip FK check: try insert, if fails due to FK, log and continue
        try {
          await db
            .insert(roleEvaluations)
            .values({
              roleId: id,
              candidateId,
              candidateName,
              evaluatedAt,
              score: match.score,
              verdict: match.verdict,
              currentJob: match.currentJob,
              openToWork: match.openToWork,
              matchedSkills: JSON.stringify(match.matchedSkills),
              missingSkills: JSON.stringify(match.missingSkills),
              toolExperience: JSON.stringify(match.toolExperience),
              metRequirements: JSON.stringify(match.metRequirements),
              reasoning: match.reasoning,
            })
            .onConflictDoUpdate({
              target: [roleEvaluations.roleId, roleEvaluations.candidateId],
              set: {
                candidateName,
                evaluatedAt,
                score: match.score,
                verdict: match.verdict,
                currentJob: match.currentJob,
                openToWork: match.openToWork,
                matchedSkills: JSON.stringify(match.matchedSkills),
                missingSkills: JSON.stringify(match.missingSkills),
                toolExperience: JSON.stringify(match.toolExperience),
                metRequirements: JSON.stringify(match.metRequirements),
                reasoning: match.reasoning,
              },
            });
          evalInserted++;
        } catch (err) {
          console.warn(`    [warn] eval insert failed for role ${id} candidate ${candidateId}:`, (err as Error).message);
        }
      }
    }

    // endorsements map
    const endorsements = data.endorsements as Record<string, unknown> | undefined;
    if (endorsements && typeof endorsements === "object" && !Array.isArray(endorsements)) {
      for (const [candidateId, entry] of Object.entries(endorsements)) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const obj = entry as Record<string, unknown>;
        const addedAt = typeof obj.addedAt === "string" ? obj.addedAt : toIso(obj.addedAt);
        if (!addedAt) continue;
        const status = obj.status as string;
        if (!["endorsed", "interviewed", "hired", "rejected"].includes(status)) continue;
        const candidateName = typeof obj.candidateName === "string" ? obj.candidateName : candidateId;
        if (DRY_RUN) {
          console.log(`    endorse ${candidateId} -> ${status}`);
          continue;
        }
        try {
          await db
            .insert(roleEndorsements)
            .values({
              roleId: id,
              candidateId,
              candidateName,
              status,
              addedAt,
            })
            .onConflictDoUpdate({
              target: [roleEndorsements.roleId, roleEndorsements.candidateId],
              set: {
                candidateName,
                status,
                addedAt,
              },
            });
          endorseInserted++;
        } catch (err) {
          console.warn(`    [warn] endorsement insert failed for role ${id} candidate ${candidateId}:`, (err as Error).message);
        }
      }
    }
  }
  console.log(`[migrate] Roles upserted: ${roleInserted}, evaluations: ${evalInserted}, endorsements: ${endorseInserted}`);

  // ---- Prompts ----
  console.log("[migrate] Fetching prompts from Firestore...");
  const promptSnap = await firestore.collection("prompts").get();
  console.log(`[migrate] Found ${promptSnap.size} prompts`);
  let promptInserted = 0;
  for (const doc of promptSnap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const id = doc.id;
    const prompt = promptFromUnknown(data);
    if (!prompt.prompt) {
      console.warn(`  [warn] prompt ${id} has empty body, skipping`);
      continue;
    }
    const createdAt = toMillis(data.createdAt);
    if (DRY_RUN) {
      console.log(`  - prompt ${id}: ${prompt.title}`);
      continue;
    }
    await db
      .insert(prompts)
      .values({
        id,
        title: prompt.title,
        prompt: prompt.prompt,
        createdAt,
      })
      .onConflictDoUpdate({
        target: prompts.id,
        set: {
          title: prompt.title,
          prompt: prompt.prompt,
          createdAt,
        },
      });
    promptInserted++;
  }
  console.log(`[migrate] Prompts upserted: ${promptInserted}`);

  // Summary
  if (!DRY_RUN) {
    const candCount = await db.select().from(candidates);
    const roleCount = await db.select().from(roles);
    const promptCount = await db.select().from(prompts);
    const evalCount = await db.select().from(roleEvaluations);
    const endorseCount = await db.select().from(roleEndorsements);
    console.log("\n[migrate] SQLite summary:");
    console.log(`  candidates: ${candCount.length}`);
    console.log(`  roles: ${roleCount.length}`);
    console.log(`  prompts: ${promptCount.length}`);
    console.log(`  role_evaluations: ${evalCount.length}`);
    console.log(`  role_endorsements: ${endorseCount.length}`);
    console.log("\n[migrate] Done. Firestore data is now in SQLite. Verify in app, then you can decommission Firestore data.");
  } else {
    console.log("\n[migrate] Dry run complete. No data written.");
  }
}

main().catch((err) => {
  console.error("[migrate] FAILED:", err);
  process.exit(1);
});
