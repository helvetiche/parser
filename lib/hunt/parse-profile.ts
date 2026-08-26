import { extractCandidateFromText } from "@/lib/client-api";
import { DEFAULT_MODEL } from "@/lib/models";
import type { CandidateRow } from "@/lib/candidate-schema";

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
  try {
    const candidate = await extractCandidateFromText(raw, DEFAULT_MODEL);
    return { ...candidate, id: url };
  } catch {
    // If the model is unavailable, still surface a minimal row so the
    // candidate is visible in the table instead of being silently dropped.
    return {
      fullName: fallbackName || "Unnamed candidate",
      summary: "",
      education: "N/A",
      experience: [],
      skills: [],
      expectedSalary: "N/A",
      reasoning: "",
      contacts: [],
      id: url,
    };
  }
}
