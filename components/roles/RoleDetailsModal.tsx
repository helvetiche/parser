"use client";

import {
  ArrowClockwise,
  Article,
  Briefcase,
  CaretDown,
  Check,
  CheckCircle,
  ClipboardText,
  CircleNotch,
  Lightning,
  ListChecks,
  NotePencil,
  Sliders,
  User,
  XCircle,
} from "@phosphor-icons/react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import useSWR from "swr";
import Modal, { ModalCloseButton } from "@/components/ui/Modal";
import DetailsSection, { EmptyValue } from "@/components/ui/DetailsSection";
import TimelineList from "@/components/ui/TimelineList";
import MatchBadge from "@/components/roles/MatchBadge";
import CandidateSearch from "@/components/roles/CandidateSearch";
import PromptManagerModal from "@/components/roles/PromptManagerModal";
import { getInitials } from "@/components/candidates/CandidatesTable";
import { evaluateCandidateForRole, type PromptsResponse } from "@/lib/client-api";
import { cacheKeys } from "@/lib/cache-keys";
import type { RoleRow } from "@/lib/role-schema";
import type { CandidateRow } from "@/lib/candidate-schema";
import type { MatchResult } from "@/lib/match-schema";

function SkillPill({ children }: { children: string }) {
  return (
    <span className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-200/80 ring-inset">
      {children}
    </span>
  );
}

/* ---- Match-rate presentation helpers ---- */

/** Fill color follows the rate bands: green 76+, yellow 51-75, orange 26-50, red below. */
function rateColorClass(score: number): string {
  if (score >= 76) return "bg-emerald-500";
  if (score >= 51) return "bg-yellow-400";
  if (score >= 26) return "bg-orange-400";
  return "bg-red-500";
}

function formatYears(years: number): string {
  const rounded = Math.round(years * 10) / 10;
  const value = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${value} ${rounded === 1 ? "yr" : "yrs"}`;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Tolerant membership check: normalized equality or containment in either direction. */
function listContains(list: string[], value: string): boolean {
  const needle = normalizeText(value);
  return list.some((entry) => {
    const hay = normalizeText(entry);
    return hay === needle || hay.includes(needle) || needle.includes(hay);
  });
}

type SkillStatus = "match" | "miss" | "neutral";

/* ---- Recruiter report (strictly two columns) ---- */

function ReportRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr>
      <th
        scope="row"
        className="w-44 bg-gray-50/60 px-4 py-3 text-left align-top text-xs font-semibold tracking-wider text-gray-500 uppercase"
      >
        {label}
      </th>
      <td className="px-4 py-3 text-sm text-gray-700">{children}</td>
    </tr>
  );
}

export default function RoleDetailsModal({
  role,
  match,
  candidates,
  onClose,
}: {
  role: RoleRow;
  match?: MatchResult;
  candidates: CandidateRow[];
  onClose: () => void;
}) {
  /* ---- In-modal candidate evaluation ---- */
  const [lookup, setLookup] = useState<CandidateRow | null>(null);
  const [report, setReport] = useState<MatchResult | null>(null);
  const [stale, setStale] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const evalSeq = useRef(0);

  /* ---- Saved evaluation prompts ---- */
  const { data: promptsData } = useSWR<PromptsResponse>(cacheKeys.prompts);
  const prompts = useMemo(() => promptsData?.prompts ?? [], [promptsData]);
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const [promptManagerOpen, setPromptManagerOpen] = useState(false);

  // Falls back to the default prompt whenever the selection disappears
  // (e.g. deleted in the manager); derived during render, no effect needed.
  const promptId =
    selectedPromptId && prompts.some((p) => p.id === selectedPromptId) ? selectedPromptId : "";

  const runEvaluation = (candidate: CandidateRow) => {
    const seq = ++evalSeq.current;
    setReport(null);
    setStale(false);
    setEvalError(null);
    setEvaluating(true);
    evaluateCandidateForRole(candidate.id, role.id, promptId || undefined)
      .then((result) => {
        if (seq === evalSeq.current) setReport(result);
      })
      .catch((err) => {
        if (seq === evalSeq.current) {
          setEvalError(err instanceof Error ? err.message : "Failed to evaluate candidate");
        }
      })
      .finally(() => {
        if (seq === evalSeq.current) setEvaluating(false);
      });
  };

  const handleLookupSelect = (candidate: CandidateRow) => {
    evalSeq.current++;
    setLookup(candidate);
    setEvalError(null);
    setEvaluating(false);

    // Show the persisted evaluation instantly when one exists for this pair.
    const saved = role.evaluations?.[candidate.id];
    if (saved) {
      setReport(saved);
      setStale(true);
      return;
    }
    setReport(null);
    setStale(false);
    runEvaluation(candidate);
  };

  const handleReEvaluate = () => {
    if (lookup) runEvaluation(lookup);
  };

  const handleLookupClear = () => {
    evalSeq.current++;
    setLookup(null);
    setReport(null);
    setStale(false);
    setEvalError(null);
    setEvaluating(false);
  };

  /* Normalized sets driving the green highlights on the role sections below. */
  const metRequirementSet = useMemo(
    () => new Set((report?.metRequirements ?? []).map(normalizeText)),
    [report]
  );

  const skillStatus = (skill: string): SkillStatus => {
    if (!report) return "neutral";
    if (listContains(report.matchedSkills, skill)) return "match";
    if (listContains(report.missingSkills, skill)) return "miss";
    return "neutral";
  };

  return (
    <Modal labelledBy="role-details-title" onClose={onClose} size="lg" scroll>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gray-700 to-gray-900 text-white shadow-sm">
            <Briefcase size={24} weight="fill" />
          </span>
          <div className="min-w-0">
            <h3
              id="role-details-title"
              className="truncate text-xl font-semibold tracking-tight text-gray-900"
            >
              {role.jobTitle}
            </h3>
            {match && (
              <div className="mt-2">
                <MatchBadge match={match} />
              </div>
            )}
          </div>
        </div>
        <ModalCloseButton onClose={onClose} />
      </div>

      <div className="border-t border-gray-100" />

      {/* Scrollable body */}
      <div className="chat-scroll flex-1 space-y-7 overflow-y-auto px-6 py-6">
        <DetailsSection icon={User} title="Evaluate a Candidate">
          <div className="space-y-4">
            {/* Saved prompt selector */}
            <div className="max-w-md">
              <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold tracking-wider text-gray-500 uppercase">
                <NotePencil size={13} />
                Evaluation prompt
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <select
                    value={promptId}
                    onChange={(e) => setSelectedPromptId(e.target.value)}
                    disabled={evaluating}
                    aria-label="Evaluation prompt"
                    className="w-full cursor-pointer appearance-none rounded-xl border border-gray-200 bg-white py-2 pr-10 pl-3.5 text-sm font-medium text-gray-800 shadow-sm transition-shadow hover:border-gray-300 focus:ring-2 focus:ring-gray-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">Default · Tech Recruiter</option>
                    {prompts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                  <CaretDown
                    size={15}
                    className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-gray-400"
                  />
                </div>
                <button
                  onClick={() => setPromptManagerOpen(true)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900"
                  title="Manage saved prompts"
                >
                  <Sliders size={14} weight="bold" />
                  Manage
                </button>
              </div>
            </div>

            <div className="max-w-md">
              <CandidateSearch
                candidates={candidates}
                selected={lookup}
                onSelect={handleLookupSelect}
                onClear={handleLookupClear}
                disabled={evaluating}
              />
            </div>

            {evaluating && (
              <p className="flex items-center gap-2 text-sm text-gray-500">
                <CircleNotch size={15} className="animate-spin" />
                Evaluating {lookup?.fullName} against {role.jobTitle}…
              </p>
            )}

            {evalError && (
              <p className="rounded-xl bg-red-50 px-3 py-2.5 text-xs font-medium text-red-600 ring-1 ring-red-100 ring-inset">
                {evalError}
              </p>
            )}

            {lookup && !evaluating && (
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="text-xs text-gray-400">
                  {stale
                    ? `Saved evaluation${
                        role.evaluations?.[lookup.id]
                          ? ` from ${new Date(role.evaluations[lookup.id].evaluatedAt).toLocaleString()}`
                          : ""
                      }.`
                    : "Evaluated just now."}
                </p>
                <button
                  onClick={handleReEvaluate}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900"
                >
                  <ArrowClockwise size={13} weight="bold" />
                  Re-evaluate
                </button>
              </div>
            )}

            {report && (
              <div className="overflow-hidden rounded-xl border border-gray-200 shadow-sm">
                <table className="w-full border-collapse text-left">
                  <tbody className="divide-y divide-gray-100">
                    <ReportRow label="Name">
                      <span className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gray-200 to-gray-300 text-xs font-bold text-gray-600 ring-1 ring-gray-900/5 ring-inset">
                          {getInitials(lookup?.fullName ?? "")}
                        </span>
                        <span className="font-semibold text-gray-900">
                          {lookup?.fullName || "Unnamed candidate"}
                        </span>
                      </span>
                    </ReportRow>

                    <ReportRow label="Open to Work">
                      <span className="flex items-center gap-1.5 font-medium text-gray-900">
                        {report.openToWork ? (
                          <>
                            <CheckCircle size={15} weight="fill" className="text-emerald-500" />
                            Open to Work
                          </>
                        ) : (
                          <>
                            <XCircle size={15} weight="fill" className="text-rose-500" />
                            Not Open to Work
                          </>
                        )}
                      </span>
                    </ReportRow>

                    <ReportRow label="Match Rate">
                      <div className="space-y-2.5">
                        <div className="flex w-full items-center gap-3">
                          <span
                            className={`h-2.5 w-2.5 shrink-0 rounded-full ${rateColorClass(report.score)}`}
                          />
                          <div className="h-2 max-w-[260px] min-w-[140px] flex-1 overflow-hidden rounded-full bg-gray-100 ring-1 ring-gray-200/60 ring-inset">
                            <div
                              className={`h-full rounded-full transition-[width] duration-500 ease-out ${rateColorClass(report.score)}`}
                              style={{ width: `${report.score}%` }}
                            />
                          </div>
                          <span className="font-bold text-gray-900 tabular-nums">
                            {report.score}%
                          </span>
                        </div>
                        <p className="text-xs leading-relaxed text-gray-500">{report.reasoning}</p>
                      </div>
                    </ReportRow>

                    <ReportRow label="Years of Experience">
                      {report.toolExperience.length > 0 ? (
                        <ul className="max-w-xs space-y-1.5">
                          {report.toolExperience.map((te) => (
                            <li key={te.tool} className="flex items-baseline justify-between gap-4">
                              <span className="font-medium text-gray-900">{te.tool}</span>
                              <span className="shrink-0 text-gray-500 tabular-nums">
                                {formatYears(te.years)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <EmptyValue />
                      )}
                    </ReportRow>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </DetailsSection>

        <DetailsSection icon={Article} title="Description">
          {role.description ? (
            <p className="text-lg leading-relaxed text-gray-600">{role.description}</p>
          ) : (
            <EmptyValue />
          )}
        </DetailsSection>

        <DetailsSection icon={ListChecks} title="Responsibilities">
          {role.responsibilities.length > 0 ? (
            <TimelineList
              items={role.responsibilities}
              icon={Briefcase}
              maxItems={role.responsibilities.length}
              moreLabel="more"
              matchedItems={report ? metRequirementSet : undefined}
            />
          ) : (
            <EmptyValue />
          )}
        </DetailsSection>

        <DetailsSection icon={ClipboardText} title="Requirements">
          {role.requirements.length > 0 ? (
            <TimelineList
              items={role.requirements}
              icon={Check}
              maxItems={role.requirements.length}
              moreLabel="more"
              matchedItems={report ? metRequirementSet : undefined}
            />
          ) : (
            <EmptyValue />
          )}
        </DetailsSection>

        <DetailsSection icon={Lightning} title="Skills Required">
          {role.skills.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {role.skills.map((skill) => {
                const status = skillStatus(skill);
                if (status === "neutral") return <SkillPill key={skill}>{skill}</SkillPill>;
                return (
                  <span
                    key={skill}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${
                      status === "match"
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200/80"
                        : "bg-rose-50 text-rose-600 ring-rose-200/80"
                    }`}
                  >
                    {status === "match" ? (
                      <CheckCircle size={14} weight="fill" className="shrink-0" />
                    ) : (
                      <XCircle size={14} weight="fill" className="shrink-0" />
                    )}
                    {skill}
                  </span>
                );
              })}
            </div>
          ) : (
            <EmptyValue />
          )}
        </DetailsSection>
      </div>

      {promptManagerOpen && <PromptManagerModal onClose={() => setPromptManagerOpen(false)} />}
    </Modal>
  );
}
