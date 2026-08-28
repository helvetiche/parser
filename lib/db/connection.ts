import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

let _sqlite: Database.Database | null = null;
let _db: BetterSQLite3Database<typeof schema> | null = null;

function resolveDbPath(): string {
  // Allow explicit override
  if (process.env.DATABASE_PATH) {
    const p = process.env.DATABASE_PATH;
    // Support file: prefix (prisma style) and plain path
    if (p.startsWith("file:")) return p.replace(/^file:/, "");
    return p;
  }
  // Fallback to legacy DATABASE_URL if it looks like file:
  const legacy = process.env.DATABASE_URL;
  if (legacy?.startsWith("file:")) {
    return legacy.replace(/^file:/, "");
  }

  // For Electron, set DATABASE_PATH to app.getPath('userData') + '/app.db'
  // in the Electron main process before starting Next.js. We intentionally
  // avoid a direct `require('electron')` here so Next.js build doesn't
  // warn about missing electron module during `next build` on laptop.
  // Example (Electron main):
  //   process.env.DATABASE_PATH = path.join(app.getPath('userData'), 'app.db');

  // Default for Next.js dev / laptop
  return path.join(process.cwd(), "data", "app.db");
}

export function getDbPath(): string {
  return resolveDbPath();
}

export function getSqlite(): Database.Database {
  if (_sqlite) return _sqlite;

  const dbPath = resolveDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _sqlite = new Database(dbPath);
  // Performance + integrity pragmas
  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma("foreign_keys = ON");
  _sqlite.pragma("busy_timeout = 5000");
  _sqlite.pragma("synchronous = NORMAL");

  return _sqlite;
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (_db) return _db;
  const sqlite = getSqlite();
  _db = drizzle(sqlite, { schema });
  return _db;
}

// For tests / scripts that need to close
export function closeDb(): void {
  if (_sqlite) {
    try {
      _sqlite.close();
    } catch {}
    _sqlite = null;
    _db = null;
  }
}
