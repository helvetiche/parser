import { extractCandidateFromTextWithUsage } from "@/lib/client-api";
import { DEFAULT_MODEL } from "@/lib/models";
import type { CandidateRow } from "@/lib/candidate-schema";
import type { TokenUsage } from "@/lib/openrouter";
import { emptyUsage } from "@/lib/openrouter";

export type ParseProfileResult = {
  row: CandidateRow;
  usage: TokenUsage;
  model?: string;
};

/**
 * Converts a scraped candidate profile (raw page text) into a structured
 * CandidateRow using the SAME AI resume parser / prompt as the app's
 * resume flow (lib/extract-candidate). Nothing here touches the database —
 * the parsed row is returned to the caller, which persists it to localStorage.
 */
export async function parseProfile(
  raw: string,
  url: string,
  fallbackName = ""
): Promise<CandidateRow> {
  const { row } = await parseProfileWithUsage(raw, url, fallbackName);
  return row;
}

export async function parseProfileWithUsage(
  raw: string,
  url: string,
  fallbackName = ""
): Promise<ParseProfileResult> {
  try {
    const { candidate, usage, model } = await extractCandidateFromTextWithUsage(
      raw,
      DEFAULT_MODEL
    );
    return { row: { ...candidate, id: url }, usage: usage ?? emptyUsage(model), model };
  } catch {
    // If the model is unavailable, still surface a minimal row so the
    // candidate is visible in the table instead of being silently dropped.
    return {
      row: {
        fullName: fallbackName || "Unnamed candidate",
        summary: "",
        education: "N/A",
        experience: [],
        skills: [],
        expectedSalary: "N/A",
        reasoning: "",
        contacts: [],
        id: url,
      },
      usage: emptyUsage(),
    };
  }
}
