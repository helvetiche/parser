import { extractStructured } from "./ai-extract";
import { roleFromUnknown } from "./role-schema";
import type { RoleData } from "./role-schema";
import { DEFAULT_MODEL } from "./models";

export const ROLE_MODEL = DEFAULT_MODEL;

export async function extractRole(text: string, model: string = ROLE_MODEL): Promise<RoleData> {
  const safeText = text.length > 16000 ? text.slice(0, 16000) + "\n…[truncated]" : text;

  const systemMessage =
    'You are a job-description parser. Respond with a SINGLE, minified JSON object on ONE line and NOTHING else — no markdown, no code fences, no commentary, no newlines inside string values. Use exactly these keys: jobTitle, description, responsibilities, requirements, skills. Rules: jobTitle = the official role title as a short string; description = a 2-3 sentence overview of the role and company; responsibilities = an ARRAY of strings, one entry per responsibility, each a single concise sentence; requirements = an ARRAY of strings, one entry per requirement or qualification (experience years, education, certifications); skills = an ARRAY of individual skill strings, e.g. ["React","Playwright","SQL"]. Escape all quotes and newlines inside strings. Do not invent facts not present in the document; if a field is unknown use \'N/A\' (or [] for arrays).';

  const parsed = await extractStructured(
    `Job description text:\n${safeText}`,
    systemMessage,
    "jobTitle",
    model
  );

  return roleFromUnknown(parsed);
}
