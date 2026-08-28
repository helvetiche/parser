import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import {
  getCandidate,
  getPromptInstructions,
  listRoles,
  saveRoleEvaluation,
} from "@/lib/firestore-server";
import {
  DEFAULT_MATCH_INSTRUCTIONS,
  matchCandidateToRoleWithUsage,
} from "@/lib/match-role";
import type { MatchResult } from "@/lib/match-schema";
import type { TokenUsage } from "@/lib/openrouter";

/** How many role-matching LLM calls run at once; free tiers rate-limit hard. */
const MAX_CONCURRENCY = 4;

export type RoleMatch = {
  roleId: string;
  match?: MatchResult;
  error?: string;
  usage?: TokenUsage;
  model?: string;
};

/**
 * Score one stored candidate against every stored role and return the
 * per-role fit assessments. Failures are reported per role so one flaky
 * free-tier provider doesn't sink the whole batch.
 */
export async function POST(req: NextRequest) {
  const [, denied] = await requireUser(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const candidateId = typeof body?.candidateId === "string" ? body.candidateId : "";
    const roleId = typeof body?.roleId === "string" ? body.roleId : "";
    const promptId = typeof body?.promptId === "string" ? body.promptId : "";
    const model = typeof body?.model === "string" && body.model ? body.model : undefined;

    if (!candidateId) {
      return NextResponse.json({ error: "candidateId is required" }, { status: 400 });
    }

    // A saved prompt replaces only the instruction part of the system
    // message; the JSON contract is always fixed server-side.
    const customInstructions = promptId ? await getPromptInstructions(promptId) : null;

    const [candidate, allRoles] = await Promise.all([getCandidate(candidateId), listRoles()]);

    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    const roles = roleId ? allRoles.filter((role) => role.id === roleId) : allRoles;
    if (roleId && roles.length === 0) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    const results = await mapWithConcurrency(
      roles,
      MAX_CONCURRENCY,
      async (role): Promise<RoleMatch> => {
        try {
          const { match, usage, model: usedModel } = await matchCandidateToRoleWithUsage(
            candidate,
            role,
            model,
            customInstructions ?? DEFAULT_MATCH_INSTRUCTIONS
          );
          try {
            await saveRoleEvaluation(role.id, {
              ...match,
              candidateId,
              candidateName: candidate.fullName,
              evaluatedAt: new Date().toISOString(),
            });
          } catch {
            // Persisting is best-effort; never sink the match response.
          }
          return { roleId: role.id, match, usage, model: usedModel };
        } catch (error) {
          return {
            roleId: role.id,
            error: error instanceof Error ? error.message : "Match failed",
          };
        }
      }
    );

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to match candidate" },
      { status: 500 }
    );
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });

  await Promise.all(runners);
  return results;
}
