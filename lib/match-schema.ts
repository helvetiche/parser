import { objectFromUnknown, toList, toText } from "./schema-utils";

export type MatchVerdict = "strong" | "moderate" | "weak";

export type ToolExperience = {
  tool: string;
  years: number;
};

export type MatchResult = {
  /** Overall fit, 0-100. */
  score: number;
  verdict: MatchVerdict;
  /** Most recent or present job title, or "Unemployed". */
  currentJob: string;
  /** Whether the candidate appears open to work. */
  openToWork: boolean;
  /** Required skills the candidate actually has. */
  matchedSkills: string[];
  /** Required skills the candidate lacks. */
  missingSkills: string[];
  /** Estimated years of hands-on experience per relevant tool. */
  toolExperience: ToolExperience[];
  /** Verbatim requirement/responsibility lines the candidate already satisfies. */
  metRequirements: string[];
  /** Justification of the score (~40 words). */
  reasoning: string;
};

const MAX_SKILL_ITEMS = 15;
const MAX_MET_REQUIREMENTS = 20;
const REASONING_MAX_WORDS = 40;

function toScore(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/** Verdict follows the same bands as the match-rate color coding. */
function toVerdict(score: number): MatchVerdict {
  if (score >= 76) return "strong";
  if (score >= 51) return "moderate";
  return "weak";
}

function limitWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ") + "…";
}

function toOpenToWork(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return /^(true|yes|open)/i.test(String(value ?? "").trim());
}

function toToolExperience(input: unknown): ToolExperience[] {
  if (!Array.isArray(input)) return [];

  const out: ToolExperience[] = [];
  for (const entry of input.slice(0, MAX_SKILL_ITEMS)) {
    const obj =
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : {};
    const tool = toText(obj.tool ?? obj.name);
    const years = Number(obj.years);
    if (!tool || !Number.isFinite(years)) continue;
    out.push({ tool, years: Math.max(0, Math.round(years * 10) / 10) });
  }
  return out;
}

/** Preserves whole lines — requirement sentences may contain commas/semicolons. */
function toStringArray(input: unknown, max: number): string[] {
  const arr = Array.isArray(input) ? input : typeof input === "string" ? input.split(/\r?\n/) : [];
  return arr
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .slice(0, max);
}

export function matchFromUnknown(input: unknown): MatchResult {
  const map = objectFromUnknown(input);
  const score = toScore(map.score);

  return {
    score,
    verdict: toVerdict(score),
    currentJob: toText(map.currentJob),
    openToWork: toOpenToWork(map.openToWork),
    matchedSkills: toList(map.matchedSkills, /[,;]/).slice(0, MAX_SKILL_ITEMS),
    missingSkills: toList(map.missingSkills, /[,;]/).slice(0, MAX_SKILL_ITEMS),
    toolExperience: toToolExperience(map.toolExperience ?? map.yearsOfExperience),
    metRequirements: toStringArray(map.metRequirements, MAX_MET_REQUIREMENTS),
    reasoning: limitWords(toText(map.reasoning), REASONING_MAX_WORDS),
  };
}
