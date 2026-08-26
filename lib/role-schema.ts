import { objectFromUnknown, toList, toText } from "./schema-utils";
import type { MatchResult } from "./match-schema";

export type RoleData = {
  jobTitle: string;
  description: string;
  responsibilities: string[];
  requirements: string[];
  skills: string[];
};

/** A persisted candidate-vs-role evaluation stored on the role document. */
export type SavedEvaluation = MatchResult & {
  candidateId: string;
  candidateName: string;
  evaluatedAt: string;
};

/** Lifecycle of a candidate submitted/endorsed for a role. */
export type EndorsementStatus = "endorsed" | "interviewed" | "hired" | "rejected";

/** A candidate submitted for a role, tracked through the hiring funnel. */
export type Endorsement = {
  candidateId: string;
  candidateName: string;
  status: EndorsementStatus;
  addedAt: string;
};

export type RoleRow = RoleData & {
  id: string;
  /** Stored evaluations keyed by candidate id. */
  evaluations?: Record<string, SavedEvaluation>;
  /** Submitted candidates keyed by candidate id. */
  endorsements?: Record<string, Endorsement>;
};

export function roleFromUnknown(input: unknown): RoleData {
  const map = objectFromUnknown(input);

  return {
    jobTitle: toText(map.jobTitle),
    description: toText(map.description),
    responsibilities: toList(map.responsibilities, /\r?\n|;/),
    requirements: toList(map.requirements, /\r?\n|;/),
    skills: toList(map.skills, /[,;]|\r?\n/),
  };
}
