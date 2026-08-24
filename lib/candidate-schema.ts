import { objectFromUnknown, toList, toText } from "./schema-utils";

export type ContactType = "phone" | "email" | "website" | "other";

export type ContactItem = {
  type: ContactType;
  value: string;
};

export type Candidate = {
  fullName: string;
  summary: string;
  education: string;
  experience: string[];
  skills: string[];
  expectedSalary: string;
  reasoning: string;
  contacts: ContactItem[];
};

export type CandidateRow = Candidate & { id: string };
/**
 * Strictly formats a phone number as 0900 000 0000.
 * Handles +63 / 63 / 9XX prefixes and strips all non-digits first.
 */
export function formatPhoneNumber(raw: string): string {
  let digits = raw.replace(/\D/g, "");

  // Drop country code 63 / +63
  if (digits.startsWith("63") && digits.length >= 12) {
    digits = digits.slice(2);
  }

  // Use the last 10 digits for long numbers (removes stray prefixes)
  if (digits.length > 11) {
    digits = digits.slice(-10);
  }

  // Local format must start with 0 and be 11 digits (09XXXXXXXXX)
  if (digits.length === 10 && !digits.startsWith("0")) {
    digits = "0" + digits;
  }
  if (digits.length > 11) {
    digits = digits.slice(-11);
  }

  if (!/^\d+$/.test(digits)) return raw.trim();

  const groups = digits.match(/^(\d{4})(\d{3})(\d{4})$/);
  if (groups) return `${groups[1]} ${groups[2]} ${groups[3]}`;

  return digits; // fallback: digits only, still machine-consistent
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URLISH_RE = /^(https?:\/\/|www\.)|^[^\s@]+\.[a-z]{2,}([/?#].*)?$/i;
const PLACEHOLDER_RE = /^\s*(n\/?a|na|none|null|undefined|tbd|[.?]*[-–—•][.?]*\s*)+$/i;
const LABEL_PREFIX_RE =
  /^\s*(phone|mobile|tel(?:ephone)?|email|e-mail|website|web|portfolio|linkedin|github|address)\s*[:\-]\s*/i;

function inferContactType(value: string): ContactType {
  if (EMAIL_RE.test(value)) return "email";
  if (/^[\d\s+()-]+$/.test(value)) return "phone";
  if (URLISH_RE.test(value)) return "website";
  return "other";
}

function cleanContactValue(raw: string): string {
  let value = raw.replace(/\s+/g, " ").trim();
  // Models sometimes prefix values with their own label
  value = value.replace(LABEL_PREFIX_RE, "").trim();
  return value;
}

function normalizeContacts(input: unknown): ContactItem[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const out: ContactItem[] = [];

  for (const entry of input) {
    let type = "other";
    let value = "";

    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const obj = entry as Record<string, unknown>;
      type = toText(obj.type).toLowerCase();
      value = toText(obj.value);
    } else {
      value = toText(entry);
    }

    value = cleanContactValue(value);

    // Drop empties and placeholder junk so no dead links render
    if (!value || value === "N/A" || PLACEHOLDER_RE.test(value)) continue;

    // Trust the value over the label when they disagree
    const inferred = inferContactType(value);

    if (inferred === "phone" || (type === "phone" && /^[\d\s+()-]+$/.test(value))) {
      value = formatPhoneNumber(value);
    }

    const finalType: ContactType =
      inferred !== "other"
        ? inferred
        : ["phone", "email", "website", "other"].includes(type)
          ? (type as ContactType)
          : "other";

    const dedupeKey = `${finalType}:${value.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    out.push({ type: finalType, value });
  }

  return out;
}

export function candidateFromUnknown(input: unknown): Candidate {
  const map = objectFromUnknown(input);

  return {
    fullName: toText(map.fullName),
    summary: toText(map.summary),
    education: toText(map.education),
    experience: toList(map.experience, /\r?\n|;/),
    skills: toList(map.skills, /[,;]|\r?\n/),
    expectedSalary: toText(map.expectedSalary),
    reasoning: toText(map.reasoning),
    contacts: normalizeContacts(map.contacts),
  };
}
