import { extractStructured } from "./ai-extract";
import { matchFromUnknown, type MatchResult } from "./match-schema";
import type { Candidate } from "./candidate-schema";
import type { RoleData } from "./role-schema";
import { DEFAULT_MODEL } from "./models";

export const MATCH_MODEL = DEFAULT_MODEL;

/**
 * The instruction part of the system message — this is what saved
 * (customizable) prompts replace. It may shape how strictly the model
 * reasons but never the output format.
 */
export const DEFAULT_MATCH_INSTRUCTIONS = `Role: Tech Recruiter
You are a Tech Recruiter responsible for evaluating the CANDIDATE against the provided job description (ROLE). Your evaluation must be strict, evidence-based, and focused on whether the candidate can transition smoothly into the role.

NON-NEGOTIABLES — read strictly and deduct points accordingly:
- Check their most recent or present job: it must involve some of the role's non-negotiable skills.
- Read their responsibilities carefully. Some candidates worked with a skill but their responsibilities do not align with the role's responsibilities — that is NOT a smooth transition; deduct for it.
- Use ONLY the provided data. Never invent facts.`;

/**
 * Fixed response contract. Appended to every evaluation regardless of
 * which saved prompt is selected so the JSON structure stays stable.
 */
const RESPONSE_CONTRACT = `Respond with a SINGLE, minified JSON object on ONE line and NOTHING else — no markdown, no code fences, no commentary. Use exactly these keys: fullName, currentJob, openToWork, score, matchedSkills, missingSkills, toolExperience, metRequirements, reasoning.
Rules: fullName = the candidate's name from the data; currentJob = their most recent or present job title, or "Unemployed" if none; openToWork = true if the data suggests they are open to work (e.g. currently employed but exploring, stated availability), otherwise false; score = integer match rate 1-100; matchedSkills = ARRAY of the role's required skills the candidate genuinely has (treat case and minor variants like React.js / React as equal); missingSkills = ARRAY of required skills the candidate lacks; toolExperience = ARRAY of {tool, years} objects estimating years of hands-on experience per relevant tool from their work history; metRequirements = ARRAY containing VERBATIM copies (exact text, no paraphrasing) of any line from the role's requirements or responsibilities that the candidate demonstrably satisfies based on their experience — empty array if none; reasoning = why the match rate is justifiable in at most 40 words. Escape all quotes and newlines inside strings.`;

function buildSystemMessage(instructions: string): string {
  return `${instructions}\n\n${RESPONSE_CONTRACT}`;
}

/**
 * Compare a candidate against a role with the model fleet and return a
 * structured fit assessment (score, skill overlap, qualification notes).
 * `instructions` swaps only the reasoning guidance; the JSON contract is
 * always appended by this module.
 */
export async function matchCandidateToRole(
  candidate: Candidate,
  role: RoleData,
  model: string = MATCH_MODEL,
  instructions: string = DEFAULT_MATCH_INSTRUCTIONS
): Promise<MatchResult> {
  const payload = JSON.stringify({ candidate, role });

  const parsed = await extractStructured(payload, buildSystemMessage(instructions), "score", model);
  return matchFromUnknown(parsed);
}
