import fs from "node:fs";
import path from "node:path";
import { getSqlite } from "./connection";

/**
 * Minimal migration runner for better-sqlite3.
 * Reads SQL files from drizzle/ and applies them once.
 * Drizzle-kit also manages migrations via `drizzle-kit migrate`,
 * but this function ensures the DB is initialized even without CLI
 * (useful for Next.js server startup and Electron).
 */
export function runMigrations(): void {
  const sqlite = getSqlite();

  // If core tables already exist, assume migrations were applied via drizzle-kit.
  // This handles the case where __drizzle_migrations is managed by drizzle-kit
  // (which uses content hashes, not filenames) and prevents double-application.
  const hasCandidates = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='candidates'")
    .get();
  const hasRoles = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='roles'")
    .get();
  if (hasCandidates && hasRoles) return;

  // Create migrations tracking table if missing (for fallback direct creation)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
  `);

  const migrationsDir = path.join(process.cwd(), "drizzle");
  if (!fs.existsSync(migrationsDir)) {
    // Fallback: create tables directly from schema if no drizzle folder yet
    createTablesDirectly(sqlite);
    return;
  }

  // Try official drizzle migrator first (reads _journal.json correctly)
  try {
    // Dynamically import to avoid hard dependency in edge runtime
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { migrate } = require("drizzle-orm/better-sqlite3/migrator");
    const { getDb } = require("./connection");
    const db = getDb();
    migrate(db, { migrationsFolder: migrationsDir });
    return;
  } catch {
    // Fallback to manual file-based apply if migrator not available
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const hash = file; // use filename as hash (fallback)
    const exists = sqlite.prepare("SELECT 1 FROM __drizzle_migrations WHERE hash = ?").get(hash);
    if (exists) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    const txn = sqlite.transaction(() => {
      for (const stmt of statements) {
        sqlite.exec(stmt);
      }
      sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(hash, Date.now());
    });
    txn();
  }
}

function createTablesDirectly(sqlite: import("better-sqlite3").Database): void {
  // Check if main tables exist; if so, skip
  const hasCandidates = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='candidates'")
    .get();
  if (hasCandidates) return;

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "candidates" (
      "id" text PRIMARY KEY NOT NULL,
      "full_name" text NOT NULL,
      "summary" text NOT NULL DEFAULT 'N/A',
      "education" text NOT NULL DEFAULT 'N/A',
      "experience" text NOT NULL DEFAULT '[]',
      "skills" text NOT NULL DEFAULT '[]',
      "expected_salary" text NOT NULL DEFAULT 'N/A',
      "reasoning" text NOT NULL DEFAULT 'N/A',
      "contacts" text NOT NULL DEFAULT '[]',
      "created_at" integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "candidates_created_at_idx" ON "candidates" ("created_at");

    CREATE TABLE IF NOT EXISTS "roles" (
      "id" text PRIMARY KEY NOT NULL,
      "job_title" text NOT NULL,
      "description" text NOT NULL DEFAULT 'N/A',
      "responsibilities" text NOT NULL DEFAULT '[]',
      "requirements" text NOT NULL DEFAULT '[]',
      "skills" text NOT NULL DEFAULT '[]',
      "created_at" integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "roles_created_at_idx" ON "roles" ("created_at");

    CREATE TABLE IF NOT EXISTS "prompts" (
      "id" text PRIMARY KEY NOT NULL,
      "title" text NOT NULL,
      "prompt" text NOT NULL,
      "created_at" integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "prompts_created_at_idx" ON "prompts" ("created_at");

    CREATE TABLE IF NOT EXISTS "role_evaluations" (
      "role_id" text NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
      "candidate_id" text NOT NULL REFERENCES "candidates"("id") ON DELETE CASCADE,
      "candidate_name" text NOT NULL,
      "evaluated_at" text NOT NULL,
      "score" integer NOT NULL,
      "verdict" text NOT NULL,
      "current_job" text NOT NULL DEFAULT 'N/A',
      "open_to_work" integer NOT NULL DEFAULT 0,
      "matched_skills" text NOT NULL DEFAULT '[]',
      "missing_skills" text NOT NULL DEFAULT '[]',
      "tool_experience" text NOT NULL DEFAULT '[]',
      "met_requirements" text NOT NULL DEFAULT '[]',
      "reasoning" text NOT NULL DEFAULT 'N/A',
      PRIMARY KEY("role_id", "candidate_id")
    );
    CREATE INDEX IF NOT EXISTS "role_evaluations_role_idx" ON "role_evaluations" ("role_id");
    CREATE INDEX IF NOT EXISTS "role_evaluations_candidate_idx" ON "role_evaluations" ("candidate_id");

    CREATE TABLE IF NOT EXISTS "role_endorsements" (
      "role_id" text NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
      "candidate_id" text NOT NULL REFERENCES "candidates"("id") ON DELETE CASCADE,
      "candidate_name" text NOT NULL,
      "status" text NOT NULL,
      "added_at" text NOT NULL,
      PRIMARY KEY("role_id", "candidate_id")
    );
    CREATE INDEX IF NOT EXISTS "role_endorsements_role_idx" ON "role_endorsements" ("role_id");
    CREATE INDEX IF NOT EXISTS "role_endorsements_candidate_idx" ON "role_endorsements" ("candidate_id");
  `);
}

// Auto-run once on import in Next.js server context
// We don't auto-run here to avoid side effects in edge runtime;
// callers should invoke runMigrations() explicitly at server startup.
