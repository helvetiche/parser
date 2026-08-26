"use client";

import { useMemo, useState } from "react";
import {
  Briefcase,
  Clock,
  EnvelopeSimple,
  Globe,
  GraduationCap,
  Lightning,
  Link as LinkIcon,
  Phone,
  Trash,
  Tray,
  User,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import type { Candidate, CandidateRow, ContactType } from "@/lib/candidate-schema";
import Skeleton from "@/components/ui/Skeleton";
import TimelineList from "@/components/ui/TimelineList";
import TableSearch from "@/components/ui/TableSearch";
import CandidateDetailsModal from "@/components/candidates/CandidateDetailsModal";

export const CONTACT_ICONS: Record<ContactType, Icon> = {
  phone: Phone,
  email: EnvelopeSimple,
  website: Globe,
  other: LinkIcon,
};

type ColumnKey = Exclude<keyof Candidate, "contacts">;

export const CANDIDATE_COLUMNS: {
  key: ColumnKey;
  label: string;
  icon: Icon;
}[] = [
  { key: "fullName", label: "Candidate", icon: User },
  { key: "education", label: "Education", icon: GraduationCap },
  { key: "experience", label: "Experience", icon: Briefcase },
  { key: "skills", label: "Skills", icon: Lightning },
];

export function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const MAX_SKILLS = 5;

/** Fill color follows the rate bands: green 76+, yellow 51-75, orange 26-50, red below. */
function matchColorClass(score: number): string {
  if (score >= 76) return "bg-emerald-500";
  if (score >= 51) return "bg-yellow-400";
  if (score >= 26) return "bg-orange-400";
  return "bg-red-500";
}

function columnWidthClass(key: ColumnKey): string {
  void key;
  return "";
}

function SkillsCell({ skills }: { skills: string[] }) {
  if (skills.length === 0) return <span className="text-xs text-gray-300">N/A</span>;
  return (
    <div className="flex flex-wrap items-center justify-start gap-1.5">
      {skills.slice(0, MAX_SKILLS).map((skill) => (
        <span
          key={skill}
          className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 ring-1 ring-gray-200/80 transition-colors ring-inset hover:bg-gray-200/70"
        >
          {skill}
        </span>
      ))}
      {skills.length > MAX_SKILLS && (
        <span
          className="rounded-full bg-gradient-to-b from-gray-700 to-gray-900 px-2.5 py-1 text-xs font-semibold text-white shadow-sm"
          title={skills.slice(MAX_SKILLS).join(", ")}
        >
          {skills.length - MAX_SKILLS}+ Skills
        </span>
      )}
    </div>
  );
}

function ExperienceCell({ experience }: { experience: string[] }) {
  if (experience.length === 0) return <span className="text-xs text-gray-300">N/A</span>;

  return <TimelineList items={experience} icon={Clock} moreLabel="more roles" />;
}

function NameCell({
  candidate,
  onDelete,
  matchScore,
}: {
  candidate: CandidateRow;
  onDelete: (candidate: CandidateRow) => void;
  matchScore?: number;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gray-200 to-gray-300 text-sm font-bold text-gray-600 ring-1 ring-gray-900/5 ring-inset">
          {getInitials(candidate.fullName)}
        </span>
        <span className="text-base font-semibold text-gray-900">{candidate.fullName}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(candidate);
          }}
          className="ml-auto rounded-lg p-1.5 text-gray-300 opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 focus:opacity-100"
          aria-label={`Delete ${candidate.fullName}`}
          title="Delete candidate"
        >
          <Trash size={15} />
        </button>
      </div>
      {typeof matchScore === "number" && (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 ring-1 ring-gray-200/60 ring-inset">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ease-out ${matchColorClass(matchScore)}`}
              style={{ width: `${matchScore}%` }}
            />
          </div>
          <span className="text-[11px] font-bold text-gray-500 tabular-nums">{matchScore}%</span>
        </div>
      )}
      {candidate.summary && (
        <p className="text-xs leading-relaxed text-gray-500">{candidate.summary}</p>
      )}
      {(candidate.contacts ?? []).length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
          {(candidate.contacts ?? []).map((contact) => {
            const ContactIcon = CONTACT_ICONS[contact.type] ?? LinkIcon;
            return (
              <span
                key={`${contact.type}-${contact.value}`}
                className="flex items-center gap-1 text-xs font-bold text-gray-500"
              >
                <ContactIcon size={12} className="shrink-0 text-gray-400" />
                {contact.value}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

type CandidatesTableProps = {
  candidates: CandidateRow[];
  loading: boolean;
  onDeleteRequest: (candidate: CandidateRow) => void;
  /** Optional actions rendered on the right side of the search toolbar. */
  actions?: React.ReactNode;
  /** Enables row multi-selection (used by Hunt Automation). */
  selectable?: boolean;
  selectedIds?: string[];
  onToggleRow?: (id: string) => void;
  /** Per-candidate match score (0-100) against the selected role; renders a bar in the Candidate column. */
  matchScores?: Record<string, number>;
  onToggleAll?: (visibleIds: string[]) => void;
  /** Optional footer rendered at the bottom of a candidate's detail modal. */
  detailFooter?: (candidate: CandidateRow) => React.ReactNode;
};

export default function CandidatesTable({
  candidates,
  loading,
  onDeleteRequest,
  actions,
  selectable = false,
  selectedIds = [],
  onToggleRow,
  onToggleAll,
  matchScores,
  detailFooter,
}: CandidatesTableProps) {
  const [selected, setSelected] = useState<CandidateRow | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) =>
      [c.fullName, c.summary, c.education, ...c.skills, ...c.experience]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [candidates, query]);

  const colCount = CANDIDATE_COLUMNS.length + (selectable ? 1 : 0);
  const visibleIds = filtered.map((c) => c.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const someSelected = visibleIds.some((id) => selectedIds.includes(id));

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white/80 shadow-sm backdrop-blur">
      {/* Search toolbar */}
      <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex-1">
          <TableSearch value={query} onChange={setQuery} placeholder="Search candidates…" />
        </div>
        {actions}
      </div>
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-gray-800 bg-gradient-to-b from-gray-700 to-gray-900">
            {selectable && (
              <th className="w-10 px-4 py-3.5">
                <input
                  type="checkbox"
                  aria-label="Select all candidates"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allSelected && someSelected;
                  }}
                  onChange={() => onToggleAll?.(visibleIds)}
                  className="h-4 w-4 cursor-pointer accent-white"
                />
              </th>
            )}
            {CANDIDATE_COLUMNS.map((col, ci) => (
              <th
                key={col.key}
                className={`w-[25%] px-4 py-3.5 text-[13px] font-semibold tracking-wider text-white uppercase ${
                  ci > 0 || selectable ? "border-l border-gray-500/40" : ""
                }`}
              >
                <span className="flex items-center gap-2">
                  <col.icon size={14} weight="fill" className="shrink-0 text-white" />
                  {col.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {loading ? (
            <CandidateSkeletonRows selectable={selectable} />
          ) : filtered.length === 0 ? (
            <tr>
              <td colSpan={colCount}>
                <EmptyState query={query.trim()} />
              </td>
            </tr>
          ) : (
            filtered.map((c, i) => (
              <tr
                key={c.id ?? i}
                onClick={() => setSelected(c)}
                className="group fade-row cursor-pointer"
              >
                {selectable && (
                  <td
                    className="w-10 px-4 py-3.5 align-top"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${c.fullName}`}
                      checked={selectedIds.includes(c.id)}
                      onChange={() => onToggleRow?.(c.id)}
                      className="h-4 w-4 cursor-pointer accent-gray-900"
                    />
                  </td>
                )}
                {CANDIDATE_COLUMNS.map((col, ci) => (
                  <td
                    key={col.key}
                    className={`${columnWidthClass(col.key)} px-4 py-3.5 text-justify align-top ${
                      ci > 0 || selectable ? "border-l border-gray-100" : ""
                    }`}
                  >
                    {renderCell(col.key, c, onDeleteRequest, matchScores)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {selected && (
        <CandidateDetailsModal
          candidate={selected}
          onClose={() => setSelected(null)}
          footer={detailFooter?.(selected)}
        />
      )}
    </div>
  );
}

function renderCell(
  key: ColumnKey,
  candidate: CandidateRow,
  onDelete: (candidate: CandidateRow) => void,
  matchScores?: Record<string, number>
) {
  if (key === "fullName")
    return (
      <NameCell
        candidate={candidate}
        onDelete={onDelete}
        matchScore={matchScores?.[candidate.id]}
      />
    );
  if (key === "skills") return <SkillsCell skills={candidate.skills} />;
  if (key === "experience") return <ExperienceCell experience={candidate.experience} />;
  return <span className="leading-relaxed text-gray-600">{candidate[key]}</span>;
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-400 ring-1 ring-gray-200/70 ring-inset">
        <Tray size={26} />
      </div>
      <div>
        <p className="text-sm font-medium text-gray-600">
          {query ? "No matches" : "No candidates yet"}
        </p>
        <p className="mt-1 text-xs text-gray-400">
          {query
            ? `Nothing found for \u201C${query}\u201D.`
            : "Upload a resume PDF to extract candidate details automatically."}
        </p>
      </div>
    </div>
  );
}

const SKELETON_ROWS = 4;

function CandidateSkeletonRows({ selectable = false }: { selectable?: boolean }) {
  return (
    <>
      {Array.from({ length: SKELETON_ROWS }, (_, row) => (
        <tr key={row}>
          {selectable && <td className="w-10 px-4 py-3.5 align-top" />}
          {CANDIDATE_COLUMNS.map((col, ci) => (
            <td
              key={col.key}
              className={`${columnWidthClass(col.key)} px-4 py-3.5 align-top ${
                ci > 0 ? "border-l border-gray-100" : ""
              }`}
            >
              <SkeletonCell colKey={col.key} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function SkeletonCell({ colKey }: { colKey: ColumnKey }) {
  switch (colKey) {
    case "fullName":
      return (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-3 w-full max-w-[280px]" />
          <div className="flex gap-3">
            <Skeleton className="h-3 w-24 rounded-full" />
            <Skeleton className="h-3 w-36 rounded-full" />
          </div>
        </div>
      );
    case "skills":
      return (
    <div className="flex flex-wrap items-center justify-between gap-1.5">
          <Skeleton className="h-[22px] w-14 rounded-full" />
          <Skeleton className="h-[22px] w-20 rounded-full" />
          <Skeleton className="h-[22px] w-16 rounded-full" />
        </div>
      );
    case "experience":
      return (
        <ol className="ml-1.5 space-y-3.5 border-l border-gray-200 pl-5">
          <li className="relative">
            <Skeleton className="absolute top-0 -left-[27px] h-[22px] w-[22px] rounded-full" />
            <Skeleton className="h-3.5 w-[85%]" />
          </li>
          <li className="relative">
            <Skeleton className="absolute top-0 -left-[27px] h-[22px] w-[22px] rounded-full" />
            <Skeleton className="h-3.5 w-[70%]" />
          </li>
          <li className="relative">
            <Skeleton className="absolute top-0 -left-[27px] h-[22px] w-[22px] rounded-full bg-gray-200" />
            <Skeleton className="h-3.5 w-[78%]" />
          </li>
        </ol>
      );
    default:
      return (
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-[90%]" />
          <Skeleton className="h-3.5 w-[65%]" />
        </div>
      );
  }
}
