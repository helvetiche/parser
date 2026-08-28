import { candidateFromUnknown } from "./candidate-schema";
import type { Candidate } from "./candidate-schema";
import { extractStructured } from "./ai-extract";
import { DEFAULT_MODEL } from "./models";
import type { TokenUsage } from "./openrouter";
import { emptyUsage } from "./openrouter";

export type ExtractedCandidate = Candidate;

export type CandidateExtractionResult = {
  candidate: Candidate;
  usage: TokenUsage;
  model: string;
};

export const PARSER_MODEL = DEFAULT_MODEL;

const REQUIRED_KEYS = [
  "fullName",
  "summary",
  "education",
  "experience",
  "skills",
  "expectedSalary",
  "reasoning",
  "contacts",
] as const;

export async function extractCandidate(
  text: string,
  model: string = PARSER_MODEL
): Promise<ExtractedCandidate> {
  const { candidate } = await extractCandidateWithUsage(text, model);
  return candidate;
}

export async function extractCandidateWithUsage(
  text: string,
  model: string = PARSER_MODEL
): Promise<CandidateExtractionResult> {
  const safeText = text.length > 16000 ? text.slice(0, 16000) + "\n…[truncated]" : text;

  const systemMessage = `You are a resume parser. Respond with a SINGLE, minified JSON object on ONE line and NOTHING else — no markdown, no code fences, no commentary, no newlines inside string values. Use exactly these keys: ${REQUIRED_KEYS.join(", ")}. Rules: fullName = candidate's full name; summary = 1-2 sentence professional summary of AT MOST 50 words (STRICT hard limit — count words before writing, never exceed 50); education = most relevant education as a short string; experience = an ARRAY of strings, one entry per role, ordered most recent first, each formatted like '4 yrs — Frontend Lead at Acme Corp'; skills = an ARRAY of individual skill strings, e.g. ["React","TypeScript","Node.js"]; expectedSalary = expected or most recent salary as a string like '$120,000' (use 'N/A' if unknown); reasoning = a short match rationale you generate; contacts = an ARRAY of objects {"type":"phone"|"email"|"website"|"other","value":"..."} — include phone number, email address, personal website or portfolio, LinkedIn and any other contact found, one entry per item. Format every phone number STRICTLY as 0900 000 0000 (4 digits, space, 3 digits, space, 4 digits), converting +63/63 prefixes. Escape all quotes and newlines inside strings. Do not invent facts not present in the resume; if a field is unknown use 'N/A' (or [] for arrays).`;

  const { data, usage, model: usedModel } = await extractStructured(
    `Resume text:\n${safeText}`,
    systemMessage,
    "fullName",
    model
  );

  return { candidate: candidateFromUnknown(data), usage, model: usedModel };
}

export function emptyCandidateUsage(model?: string): TokenUsage {
  return emptyUsage(model);
}
