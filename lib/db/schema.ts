import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

// Candidates - parsed resumes
export const candidates = sqliteTable(
  "candidates",
  {
    id: text("id").primaryKey(),
    fullName: text("full_name").notNull(),
    summary: text("summary").notNull().default("N/A"),
    education: text("education").notNull().default("N/A"),
    // JSON arrays stored as TEXT
    experience: text("experience").notNull().default("[]"),
    skills: text("skills").notNull().default("[]"),
    expectedSalary: text("expected_salary").notNull().default("N/A"),
    reasoning: text("reasoning").notNull().default("N/A"),
    contacts: text("contacts").notNull().default("[]"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("candidates_created_at_idx").on(table.createdAt)]
);

// Roles - job descriptions
export const roles = sqliteTable(
  "roles",
  {
    id: text("id").primaryKey(),
    jobTitle: text("job_title").notNull(),
    description: text("description").notNull().default("N/A"),
    responsibilities: text("responsibilities").notNull().default("[]"),
    requirements: text("requirements").notNull().default("[]"),
    skills: text("skills").notNull().default("[]"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("roles_created_at_idx").on(table.createdAt)]
);

// Prompts - saved instruction templates
export const prompts = sqliteTable(
  "prompts",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    prompt: text("prompt").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("prompts_created_at_idx").on(table.createdAt)]
);

// Role evaluations - candidate vs role match results (extracted from Firestore's evaluations map)
// candidateId is TEXT without FK to allow orphan evaluations (mirrors Firestore's
// embedded map which persisted even if candidate doc was deleted). roleId cascades.
export const roleEvaluations = sqliteTable(
  "role_evaluations",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    candidateId: text("candidate_id").notNull(),
    candidateName: text("candidate_name").notNull(),
    evaluatedAt: text("evaluated_at").notNull(),
    score: integer("score").notNull(),
    verdict: text("verdict").notNull(),
    currentJob: text("current_job").notNull().default("N/A"),
    openToWork: integer("open_to_work", { mode: "boolean" }).notNull().default(false),
    matchedSkills: text("matched_skills").notNull().default("[]"),
    missingSkills: text("missing_skills").notNull().default("[]"),
    toolExperience: text("tool_experience").notNull().default("[]"),
    metRequirements: text("met_requirements").notNull().default("[]"),
    reasoning: text("reasoning").notNull().default("N/A"),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.candidateId] }),
    index("role_evaluations_role_idx").on(table.roleId),
    index("role_evaluations_candidate_idx").on(table.candidateId),
  ]
);

// Role endorsements - submitted candidates funnel (extracted from Firestore's endorsements map)
// Same rationale: candidateId not FK so history survives candidate deletion.
export const roleEndorsements = sqliteTable(
  "role_endorsements",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    candidateId: text("candidate_id").notNull(),
    candidateName: text("candidate_name").notNull(),
    status: text("status").notNull(), // endorsed | interviewed | hired | rejected
    addedAt: text("added_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.candidateId] }),
    index("role_endorsements_role_idx").on(table.roleId),
    index("role_endorsements_candidate_idx").on(table.candidateId),
  ]
);

export type CandidateRowRaw = typeof candidates.$inferSelect;
export type RoleRowRaw = typeof roles.$inferSelect;
export type PromptRowRaw = typeof prompts.$inferSelect;
export type RoleEvaluationRow = typeof roleEvaluations.$inferSelect;
export type RoleEndorsementRow = typeof roleEndorsements.$inferSelect;
