"use client";

import { WarningCircle } from "@phosphor-icons/react";
import type { MatchResult, MatchVerdict } from "@/lib/match-schema";

const VERDICT_STYLES: Record<MatchVerdict, string> = {
  strong: "bg-emerald-50 text-emerald-700 ring-emerald-200/80",
  moderate: "bg-amber-50 text-amber-700 ring-amber-200/80",
  weak: "bg-rose-50 text-rose-600 ring-rose-200/80",
};

function tooltipFor(match: MatchResult): string {
  const lines = [`${match.verdict.toUpperCase()} MATCH — ${match.score}/100`];
  if (match.matchedSkills.length) lines.push(`Matched: ${match.matchedSkills.join(", ")}`);
  if (match.missingSkills.length) lines.push(`Missing: ${match.missingSkills.join(", ")}`);
  if (match.reasoning) lines.push("", match.reasoning);
  return lines.join("\n");
}

/**
 * Fit percentage pill rendered under a role's description once a
 * candidate is selected. Color encodes the verdict; hover reveals the
 * matched/missing skills and the model's reasoning.
 */
export default function MatchBadge({ match }: { match: MatchResult }) {
  return (
    <span
      title={tooltipFor(match)}
      className={`mt-1 inline-flex cursor-help items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${VERDICT_STYLES[match.verdict]}`}
    >
      <span className="tabular-nums">{match.score}% match</span>
    </span>
  );
}

/** Shown in place of the badge when scoring failed for one role. */
export function MatchBadgeError({ message }: { message: string }) {
  return (
    <span
      title={message}
      className="mt-1 inline-flex cursor-help items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500 ring-1 ring-gray-200/80 ring-inset"
    >
      <WarningCircle size={12} weight="fill" />
      Match unavailable
    </span>
  );
}
