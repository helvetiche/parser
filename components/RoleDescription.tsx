"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  Briefcase,
  Check,
  CircleNotch,
  ClipboardText,
  Cpu,
  FileArrowUp,
  Lightning,
  ListChecks,
  NotePencil,
  Star,
  Trash,
  Tray,
  UploadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import Modal, { ModalCloseButton } from "@/components/ui/Modal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dropzone, { DropzoneBusy, DropzoneIdle } from "@/components/ui/Dropzone";
import Skeleton from "@/components/ui/Skeleton";
import TimelineList from "@/components/ui/TimelineList";
import TableSearch from "@/components/ui/TableSearch";
import CandidateSearch from "@/components/roles/CandidateSearch";
import MatchBadge, { MatchBadgeError } from "@/components/roles/MatchBadge";
import RoleDetailsModal from "@/components/roles/RoleDetailsModal";
import SubmitCandidatesModal from "@/components/roles/SubmitCandidatesModal";
import { getInitials } from "@/components/candidates/CandidatesTable";
import { useRoleReviewQueue } from "@/hooks/useReviewQueue";
import ReviewRoleDrawer from "@/components/roles/ReviewRoleDrawer";
import EditRoleDrawer from "@/components/roles/EditRoleDrawer";
import type { RoleRow, SavedEvaluation } from "@/lib/role-schema";
import type { MatchResult } from "@/lib/match-schema";
import type { CandidateRow } from "@/lib/candidate-schema";
import {
  createRole,
  deleteRole,
  extractRoleFromText,
  matchCandidateToRoles,
  parsePdfFile,
  updateRole,
  type CandidatesResponse,
  type RolesResponse,
} from "@/lib/client-api";
import { cacheKeys } from "@/lib/cache-keys";
import { DEFAULT_MODEL } from "@/lib/models";
import ModelSelect from "@/components/ui/ModelSelect";

type ColumnKey = "job" | "responsibilities" | "requirements" | "skills";
type ColumnType = "job" | "list" | "skills";

const COLUMNS: {
  key: ColumnKey;
  label: string;
  type: ColumnType;
  icon: Icon;
}[] = [
  { key: "job", label: "Job", type: "job", icon: Briefcase },
  { key: "responsibilities", label: "Responsibilities", type: "list", icon: ListChecks },
  { key: "requirements", label: "Requirements", type: "list", icon: ClipboardText },
  { key: "skills", label: "Skills Required", type: "skills", icon: Lightning },
];

function columnWidthClass(key: ColumnKey): string {
  switch (key) {
    case "job":
      return "w-[30%] min-w-[360px]";
    case "skills":
      return "w-[22%] min-w-[260px] max-w-[340px]";
    default:
      return "";
  }
}

const MAX_SKILL_PILLS = 4;

export default function RoleDescription() {
  const {
    data,
    isLoading: listLoading,
    error: listError,
    mutate: mutateRoles,
  } = useSWR<RolesResponse>(cacheKeys.roles);
  const roles = useMemo(() => data?.roles ?? [], [data]);
  const { data: candidatesData } = useSWR<CandidatesResponse>(cacheKeys.candidates);
  const candidates = useMemo(() => candidatesData?.candidates ?? [], [candidatesData]);

  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [parserModel, setParserModel] = useState(DEFAULT_MODEL);
  const [pendingDelete, setPendingDelete] = useState<RoleRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleRow | null>(null);
  const [detailsRoleId, setDetailsRoleId] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);

  // Derive the open role live from the SWR list so endorsement changes
  // (mutated in the modal) reflect immediately without stale snapshots.
  const detailsRole = useMemo(
    () => roles.find((r) => r.id === detailsRoleId) ?? null,
    [roles, detailsRoleId]
  );

  /* ---- Candidate ↔ role matching ---- */
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateRow | null>(null);
  const [matches, setMatches] = useState<Record<string, MatchResult>>({});
  const [matchErrors, setMatchErrors] = useState<Record<string, string>>({});
  const [matching, setMatching] = useState(false);

  // Best-fit roles first once a candidate is scored; unscored/failed sink.
  const sortedRoles = useMemo(() => {
    if (Object.keys(matches).length === 0) return roles;
    return [...roles].sort((a, b) => (matches[b.id]?.score ?? -1) - (matches[a.id]?.score ?? -1));
  }, [roles, matches]);

  const runMatch = async (candidateId: string) => {
    setMatching(true);
    setError(null);
    try {
      const { results } = await matchCandidateToRoles(candidateId);
      const nextMatches: Record<string, MatchResult> = {};
      const nextErrors: Record<string, string> = {};
      for (const result of results) {
        if (result.match) nextMatches[result.roleId] = result.match;
        else nextErrors[result.roleId] = result.error ?? "Match failed";
      }
      setMatches(nextMatches);
      setMatchErrors(nextErrors);
    } catch (err) {
      setMatches({});
      setMatchErrors({});
      setError(err instanceof Error ? err.message : "Failed to match candidate");
    } finally {
      setMatching(false);
    }
  };

  const handleSelectCandidate = (candidate: CandidateRow) => {
    setSelectedCandidate(candidate);
    void runMatch(candidate.id);
  };

  const handleClearCandidate = () => {
    setSelectedCandidate(null);
    setMatches({});
    setMatchErrors({});
  };

  const review = useRoleReviewQueue();
  const [savingRole, setSavingRole] = useState(false);
  const [bulkRoleSaving, setBulkRoleSaving] = useState(false);
  const [bulkRoleProgress, setBulkRoleProgress] = useState<{ done: number; total: number } | null>(null);
  const uploading = review.extracting || savingRole || bulkRoleSaving;

  const handleFiles = (files: File[]) => {
    const pdfs = files.filter((f) => f.type === "application/pdf");
    const skipped = files.length - pdfs.length;

    if (pdfs.length === 0) {
      setError("Only PDF files are supported");
      return;
    }

    setError(
      skipped > 0 ? `${skipped} non-PDF file${skipped > 1 ? "s were" : " was"} skipped` : null
    );

    if (pdfs.length >= 2) {
      void handleBulkRoleAuto(pdfs);
      return;
    }
    void review.stage(pdfs, parserModel);
  };

  const handleBulkRoleAuto = async (pdfs: File[]) => {
    setBulkRoleSaving(true);
    setBulkRoleProgress({ done: 0, total: pdfs.length });
    let fail = 0;
    for (let i = 0; i < pdfs.length; i++) {
      try {
        const text = await parsePdfFile(pdfs[i]);
        const role = await extractRoleFromText(text, parserModel);
        await createRole(role);
      } catch (err) {
        fail++;
        setError(err instanceof Error ? err.message : "Bulk save failed");
      }
      setBulkRoleProgress({ done: i + 1, total: pdfs.length });
    }
    await mutateRoles();
    setBulkRoleSaving(false);
    setBulkRoleProgress(null);
    if (fail === 0) setUploadOpen(false);
  };

  const handleSaveRole = async () => {
    if (!review.current) return;
    setSavingRole(true);
    const ok = await review.confirmCurrent(async (r) => {
      await createRole(r);
      await mutateRoles();
    });
    setSavingRole(false);
    if (ok && review.items.length === 1) {
      setTimeout(() => setUploadOpen(false), 0);
    }
  };
  const handleSaveRoleAndNext = async () => {
    if (!review.current) return;
    setSavingRole(true);
    await review.confirmCurrent(async (r) => {
      await createRole(r);
      await mutateRoles();
    });
    setSavingRole(false);
  };
  const handleDiscardRole = () => {
    review.discardCurrent();
  };
  const handleCloseReview = () => {
    review.clear();
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteRole(pendingDelete.id);
      setPendingDelete(null);
      await mutateRoles();
    } catch {
      setError("Failed to delete role");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="w-full">
      {/* Section header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-gray-600 to-gray-900 text-white shadow-md">
              <ClipboardText size={18} weight="fill" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-gray-900">
              Role Descriptions
            </h2>
            <span className="rounded-full bg-gray-900/5 px-2.5 py-1 text-xs font-semibold text-gray-500 ring-1 ring-gray-900/10 ring-inset">
              {roles.length}
            </span>
          </div>
          <p className="text-sm text-gray-500">
            Job descriptions parsed with AI show up here automatically.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {uploading && (
            <span className="flex items-center gap-2 text-sm text-gray-500">
              <CircleNotch size={16} className="animate-spin" />
              Parsing &amp; extracting…
            </span>
          )}
          <button
            onClick={() => {
              setError(null);
              setUploadOpen(true);
            }}
            disabled={uploading}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-b from-gray-700 to-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <UploadSimple size={17} />
            Upload JD
          </button>
        </div>
      </div>

      {/* Candidate matcher */}
      <div className="mb-6">
        <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold tracking-wider text-gray-500 uppercase">
          <Lightning size={13} weight="fill" />
          Match a candidate
        </label>
        <div className="max-w-md">
          <CandidateSearch
            candidates={candidates}
            selected={selectedCandidate}
            onSelect={handleSelectCandidate}
            onClear={handleClearCandidate}
            disabled={matching}
          />
        </div>
        {matching && selectedCandidate && (
          <p className="mt-2 flex items-center gap-2 text-xs text-gray-500">
            <CircleNotch size={13} className="animate-spin" />
            Scoring {roles.length} role{roles.length === 1 ? "" : "s"} against{" "}
            {selectedCandidate.fullName}…
          </p>
        )}
      </div>

      {/* Table card */}
      <RolesTable
        roles={sortedRoles}
        loading={listLoading}
        onDeleteRequest={setPendingDelete}
        onEditRequest={setEditingRole}
        onSelectRequest={(r) => setDetailsRoleId(r.id)}
        candidates={candidates}
        activeCandidate={selectedCandidate}
        matches={matches}
        matchErrors={matchErrors}
      />

      {detailsRole && (
        <RoleDetailsModal
          role={detailsRole}
          match={matches[detailsRole.id]}
          candidates={candidates}
          onClose={() => setDetailsRoleId(null)}
          onSubmitCandidates={() => setSubmitOpen(true)}
        />
      )}

      {detailsRole && submitOpen && (
        <SubmitCandidatesModal
          roleId={detailsRole.id}
          roleTitle={detailsRole.jobTitle}
          candidates={candidates}
          initialEndorsements={detailsRole.endorsements}
          onClose={() => setSubmitOpen(false)}
        />
      )}

      {(() => {
        const banner = error ?? (listError ? "Failed to load roles" : null);
        if (!banner || uploadOpen) return null;
        return (
          <p className="mt-4 flex items-start justify-center gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs font-medium text-red-600 ring-1 ring-red-100 ring-inset">
            <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
            {banner}
          </p>
        );
      })()}

      {/* Upload modal — now with review drawer before save */}
      {uploadOpen && (
        <>
          <Modal
            labelledBy="upload-role-modal-title"
            onClose={() => {
              if (review.hasPending) review.clear();
              setUploadOpen(false);
            }}
            busy={uploading}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="upload-role-modal-title" className="text-lg font-semibold tracking-tight text-gray-900">
                  Upload Job Description
                </h3>
                <p className="mt-1 text-sm text-gray-500">Drop JD PDFs — review & edit before saving.</p>
              </div>
              <ModalCloseButton
                onClose={() => {
                  if (review.hasPending) review.clear();
                  setUploadOpen(false);
                }}
                disabled={uploading}
              />
            </div>

            <Dropzone onFiles={handleFiles} busy={review.extracting || bulkRoleSaving} multiple>
              {bulkRoleSaving && bulkRoleProgress ? (
                <DropzoneBusy
                  message={
                    <>
                      Bulk saving {bulkRoleProgress.done} of {bulkRoleProgress.total} directly to database…
                      <span className="mt-0.5 block text-xs font-normal text-gray-400">2+ files → automated, no review</span>
                    </>
                  }
                />
              ) : review.extracting ? (
                <DropzoneBusy
                  message={
                    <>
                      Extracting {review.items.filter((i) => i.status !== "review").length} of {review.items.length}…
                      <span className="mt-0.5 block text-xs font-normal text-gray-400">Review drawer will open next</span>
                    </>
                  }
                />
              ) : (
                <DropzoneIdle
                  icon={<FileArrowUp size={24} />}
                  title="Drop job description PDFs here"
                  subtitle="or click to browse — bulk uploads supported"
                />
              )}
            </Dropzone>

            {review.items.length > 0 && (
              <div className="mt-4 max-h-44 overflow-y-auto rounded-xl border border-gray-100">
                <div className="divide-y divide-gray-50">
                  {review.items.map((it, idx) => (
                    <div key={it.id} className="flex items-center gap-2.5 px-3 py-2">
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${it.status === "review" ? "bg-amber-100 text-amber-700" : it.status === "failed" ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-400"}`}
                      >
                        {idx + 1}
                      </span>
                      <span className="flex-1 truncate text-xs font-medium text-gray-700">{it.fileName}</span>
                      {it.status === "review" && (
                        <button
                          onClick={() => review.setCurrent(idx)}
                          className={`rounded-lg px-2 py-1 text-xs font-medium ring-1 ring-inset ${idx === review.currentIdx ? "bg-gray-900 text-white ring-gray-900" : "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50"}`}
                        >
                          {idx === review.currentIdx ? "Editing" : "Review"}
                        </button>
                      )}
                      {it.status === "failed" && (
                        <span className="max-w-[40%] truncate text-xs text-red-500" title={it.error}>
                          {it.error ?? "Failed"}
                        </span>
                      )}
                      {it.status === "extracting" && <span className="text-xs text-gray-400">Extracting…</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Parser model picker — locked while a batch is running */}
            <div className="mt-4">
              <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold tracking-wider text-gray-500 uppercase">
                <Cpu size={13} />
                Parser model
              </label>
              <ModelSelect
                value={parserModel}
                onChange={setParserModel}
                disabled={uploading}
                ariaLabel="Job description parser model"
                title="Model used to parse job descriptions"
              />
            </div>

            {error && (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs leading-relaxed font-medium text-red-600 ring-1 ring-red-100 ring-inset">
                <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}
          </Modal>

          {review.current && review.current.status === "review" && (
            <ReviewRoleDrawer
              role={review.current.role}
              fileName={review.current.fileName}
              index={review.currentIdx}
              total={review.items.length}
              saving={savingRole}
              onChange={(patch) => review.updateCurrent(patch)}
              onSave={handleSaveRole}
              onSaveAndNext={handleSaveRoleAndNext}
              onDiscard={handleDiscardRole}
              onClose={handleCloseReview}
              onPrev={() => review.setCurrent(Math.max(0, review.currentIdx - 1))}
              onNext={() => review.setCurrent(Math.min(review.items.length - 1, review.currentIdx + 1))}
            />
          )}
        </>
      )}

      {/* Delete confirmation */}
      {pendingDelete && (
        <ConfirmDialog
          title="Delete role?"
          subject={pendingDelete.jobTitle}
          consequence="from the system. This cannot be undone."
          busy={deleteBusy}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      )}

      {/* Edit role drawer — right slide cabinet */}
      {editingRole && (
        <EditRoleDrawer
          role={editingRole}
          onClose={() => setEditingRole(null)}
          onSave={async (updated) => {
            await updateRole(editingRole.id, updated);
            await mutateRoles();
          }}
        />
      )}
    </div>
  );
}

function RolesTable({
  roles,
  loading,
  onDeleteRequest,
  onEditRequest,
  onSelectRequest,
  candidates,
  activeCandidate,
  matches,
  matchErrors,
}: {
  roles: RoleRow[];
  loading: boolean;
  onDeleteRequest: (role: RoleRow) => void;
  onEditRequest?: (role: RoleRow) => void;
  onSelectRequest: (role: RoleRow) => void;
  candidates: CandidateRow[];
  activeCandidate: CandidateRow | null;
  matches: Record<string, MatchResult>;
  matchErrors: Record<string, string>;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter((r) =>
      [r.jobTitle, r.description, ...r.skills, ...r.responsibilities, ...r.requirements]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [roles, query]);

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white/80 shadow-sm backdrop-blur">
      {/* Search toolbar */}
      <div className="border-b border-gray-100 px-4 py-3">
        <TableSearch value={query} onChange={setQuery} placeholder="Search roles…" />
      </div>
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-gray-800 bg-gradient-to-b from-gray-700 to-gray-900">
            {COLUMNS.map((col, ci) => (
              <th
                key={col.key}
                className={`px-4 py-3.5 text-[13px] font-semibold tracking-wider text-white uppercase ${columnWidthClass(
                  col.key
                )} ${ci > 0 ? "border-l border-gray-500/40" : ""}`}
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
            <RoleSkeletonRows />
          ) : filtered.length === 0 ? (
            <tr>
              <td colSpan={COLUMNS.length}>
                <EmptyState query={query.trim()} />
              </td>
            </tr>
          ) : (
            filtered.map((role, i) => (
              <tr
                key={role.id ?? i}
                onClick={() => onSelectRequest(role)}
                className="group fade-row cursor-pointer"
              >
                {COLUMNS.map((col, ci) => (
                  <td
                    key={col.key}
                    className={`${columnWidthClass(col.key)} px-4 py-3.5 text-justify align-top ${
                      ci > 0 ? "border-l border-gray-100" : ""
                    }`}
                  >
                    <Cell
                      column={col}
                      role={role}
                      onDeleteRequest={onDeleteRequest}
                      onEditRequest={onEditRequest}
                      candidates={candidates}
                      activeCandidate={activeCandidate}
                      match={matches[role.id]}
                      matchError={matchErrors[role.id]}
                    />
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  column,
  role,
  onDeleteRequest,
  onEditRequest,
  candidates,
  activeCandidate,
  match,
  matchError,
}: {
  column: (typeof COLUMNS)[number];
  role: RoleRow;
  onDeleteRequest: (role: RoleRow) => void;
  onEditRequest?: (role: RoleRow) => void;
  candidates: CandidateRow[];
  activeCandidate: CandidateRow | null;
  match?: MatchResult;
  matchError?: string;
}) {
  switch (column.type) {
    case "job":
      return (
        <JobCell
          role={role}
          onDeleteRequest={onDeleteRequest}
          onEditRequest={onEditRequest}
          candidates={candidates}
          activeCandidate={activeCandidate}
          match={match}
          matchError={matchError}
        />
      );
    case "skills":
      return <SkillsCell skills={role.skills} />;
    case "list": {
      const key = column.key as "responsibilities" | "requirements";
      return <ListCell items={role[key]} icon={key === "requirements" ? Check : Briefcase} />;
    }
  }
}

/** Most recent persisted evaluation on a role document, if any. */
function latestStoredEvaluation(
  evaluations: Record<string, SavedEvaluation> | undefined
): { id: string; name: string; score: number } | null {
  if (!evaluations) return null;
  let latest: SavedEvaluation | null = null;
  for (const entry of Object.values(evaluations)) {
    if (!latest || entry.evaluatedAt > latest.evaluatedAt) latest = entry;
  }
  return latest
    ? { id: latest.candidateId, name: latest.candidateName, score: latest.score }
    : null;
}

/** Badge fill follows the rate bands: green 76+, yellow 51-75, orange 26-50, red below. */
function scoreBadgeClass(score: number): string {
  if (score >= 76) return "bg-gradient-to-b from-emerald-500 to-emerald-600";
  if (score >= 51) return "bg-gradient-to-b from-yellow-400 to-yellow-500";
  if (score >= 26) return "bg-gradient-to-b from-orange-400 to-orange-500";
  return "bg-gradient-to-b from-red-500 to-red-600";
}

/** Avatar ring matches the same rate bands as the badge fill. */
function scoreRingClass(score: number): string {
  if (score >= 76) return "ring-emerald-400";
  if (score >= 51) return "ring-yellow-400";
  if (score >= 26) return "ring-orange-400";
  return "ring-red-400";
}

const MAX_POTENTIAL = 2;

/**
 * Skills-only heuristic: candidates never evaluated against this role
 * whose own skills overlap the role's required skills. Matching tolerates
 * case and minor variants (React.js / React).
 */
function findPotentialCandidates(
  role: RoleRow,
  candidates: CandidateRow[],
  excludeIds: Set<string>,
  max = MAX_POTENTIAL
): CandidateRow[] {
  const required = role.skills.map((s) => s.toLowerCase().trim()).filter(Boolean);
  if (required.length === 0) return [];

  return candidates
    .filter((c) => c.id && !excludeIds.has(c.id))
    .map((c) => {
      const owned = c.skills.map((s) => s.toLowerCase().trim());
      const hits = required.filter((req) =>
        owned.some((skill) => skill === req || skill.includes(req) || req.includes(skill))
      ).length;
      return { candidate: c, hits };
    })
    .filter(({ hits }) => hits > 0)
    .sort((a, b) => b.hits - a.hits || a.candidate.fullName.localeCompare(b.candidate.fullName))
    .slice(0, max)
    .map(({ candidate }) => candidate);
}

function currentRoleOf(candidate: CandidateRow | null | undefined): string {
  return candidate?.experience?.[0]?.trim() ?? "";
}

function PotentialProfile({ name }: { name: string }) {
  return (
    <span className="relative inline-flex shrink-0">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-gray-100 to-gray-200 text-xs font-bold text-gray-500 shadow-sm ring-2 ring-gray-300">
        {getInitials(name)}
      </span>
      <span
        className="absolute -right-1.5 -bottom-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-gradient-to-b from-gray-400 to-gray-500 shadow-sm ring-2 ring-white"
        title="Potential match"
      >
        <Star size={10} weight="fill" className="text-white" />
      </span>
    </span>
  );
}

function CandidateProfile({ name, score }: { name: string; score?: number }) {
  return (
    <span className="relative inline-flex shrink-0">
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-gray-200 to-gray-300 text-xs font-bold text-gray-600 shadow-sm ring-2 ${
          typeof score === "number" ? scoreRingClass(score) : "ring-white"
        }`}
      >
        {getInitials(name)}
      </span>
      {typeof score === "number" && (
        <span
          className={`absolute -right-1.5 -bottom-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[12px] font-bold text-white tabular-nums shadow-sm ring-2 ring-white ${scoreBadgeClass(score)}`}
          title={`${score}% match`}
        >
          {score}
        </span>
      )}
    </span>
  );
}

/** Title + description stacked in one cell, mirroring the candidates table. */
function JobCell({
  role,
  onDeleteRequest,
  onEditRequest,
  candidates,
  activeCandidate,
  match,
  matchError,
}: {
  role: RoleRow;
  onDeleteRequest: (role: RoleRow) => void;
  onEditRequest?: (role: RoleRow) => void;
  candidates: CandidateRow[];
  activeCandidate: CandidateRow | null;
  match?: MatchResult;
  matchError?: string;
}) {
  // Live matcher result wins; otherwise fall back to the most recent
  // evaluation persisted on the role document.
  const liveEval =
    match && activeCandidate
      ? { id: activeCandidate.id, name: activeCandidate.fullName, score: match.score }
      : null;
  const evaluated = liveEval ?? latestStoredEvaluation(role.evaluations);

  const evalCandidateId = evaluated?.id ?? null;
  const evalCandidate =
    evalCandidateId === activeCandidate?.id
      ? activeCandidate
      : (candidates.find((c) => c.id === evalCandidateId) ?? null);

  // Candidates not yet parsed against this role whose resume mentions
  // required skills — surfaced as gray "potential" matches with a star.
  const excludeIds = new Set(Object.keys(role.evaluations ?? {}));
  if (evaluated) excludeIds.add(evaluated.id);
  if (activeCandidate) excludeIds.add(activeCandidate.id);
  const potentials = findPotentialCandidates(role, candidates, excludeIds);

  return (
    <div className="flex h-full flex-col gap-2 text-left">
      <div className="flex items-center gap-3">
        <span className="min-w-0 truncate text-base font-semibold text-gray-900">
          {role.jobTitle}
        </span>
        <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
          {onEditRequest && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEditRequest(role);
              }}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              aria-label={`Edit ${role.jobTitle}`}
              title="Edit role"
            >
              <NotePencil size={15} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteRequest(role);
            }}
            className="rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500"
            aria-label={`Delete ${role.jobTitle}`}
            title="Delete role"
          >
            <Trash size={15} />
          </button>
        </span>
      </div>
      {role.description && (
        <p className="text-base leading-relaxed text-gray-500">{role.description}</p>
      )}
      {(match || matchError) && (
        <div className="flex items-center gap-2">
          {match ? (
            <MatchBadge match={match} />
          ) : (
            <MatchBadgeError message={matchError ?? "Match failed"} />
          )}
        </div>
      )}
      {(evaluated || potentials.length > 0) && (
        <div className="mt-auto space-y-2 pt-2">
          {evaluated && (
            <div
              className="flex items-center gap-2.5"
              title={`${evaluated.name} · ${evaluated.score}% match`}
            >
              <CandidateProfile name={evaluated.name} score={evaluated.score} />
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-gray-900">{evaluated.name}</p>
                {currentRoleOf(evalCandidate) && (
                  <p className="truncate text-[13px] text-gray-500">
                    {currentRoleOf(evalCandidate)}
                  </p>
                )}
              </div>
            </div>
          )}
          {potentials.map((candidate) => {
            const topSkills = candidate.skills.slice(0, 3).join(" · ");
            return (
              <div
                key={candidate.id}
                className="flex items-center gap-2.5"
                title={`${candidate.fullName} · potential match`}
              >
                <PotentialProfile name={candidate.fullName} />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-gray-600">{candidate.fullName}</p>
                  {topSkills && <p className="truncate text-[13px] text-gray-400">{topSkills}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SkillsCell({ skills }: { skills: string[] }) {
  if (skills.length === 0) return <span className="text-xs text-gray-300">N/A</span>;

  return (
    <div className="flex flex-wrap gap-1.5">
      {skills.slice(0, MAX_SKILL_PILLS).map((skill) => (
        <span
          key={skill}
          className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 ring-1 ring-gray-200/80 transition-colors ring-inset hover:bg-gray-200/70"
        >
          {skill}
        </span>
      ))}
      {skills.length > MAX_SKILL_PILLS && (
        <span
          className="rounded-full bg-gradient-to-b from-gray-700 to-gray-900 px-2.5 py-1 text-xs font-semibold text-white shadow-sm"
          title={skills.slice(MAX_SKILL_PILLS).join(", ")}
        >
          {skills.length - MAX_SKILL_PILLS}+ Skills
        </span>
      )}
    </div>
  );
}

function ListCell({ items, icon }: { items: string[]; icon: Icon }) {
  if (items.length === 0) return <span className="text-xs text-gray-300">N/A</span>;

  return <TimelineList items={items} icon={icon} moreLabel="more" />;
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-400 ring-1 ring-gray-200/70 ring-inset">
        <Tray size={26} />
      </div>
      <div>
        <p className="text-sm font-medium text-gray-600">{query ? "No matches" : "No roles yet"}</p>
        <p className="mt-1 text-xs text-gray-400">
          {query
            ? `Nothing found for \u201C${query}\u201D.`
            : "Upload a job description PDF and AI will structure it for you."}
        </p>
      </div>
    </div>
  );
}

const SKELETON_ROWS = 3;

function RoleSkeletonRows() {
  return (
    <>
      {Array.from({ length: SKELETON_ROWS }, (_, row) => (
        <tr key={row}>
          {COLUMNS.map((col, ci) => (
            <td
              key={col.key}
              className={`${ci === 0 ? "min-w-[220px]" : ""} px-4 py-3.5 align-top ${
                ci > 0 ? "border-l border-gray-100" : ""
              }`}
            >
              <RoleSkeletonCell type={col.type} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function RoleSkeletonCell({ type }: { type: ColumnType }) {
  switch (type) {
    case "job":
      return (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-full max-w-[300px]" />
          <Skeleton className="h-3 w-[80%] max-w-[240px]" />
        </div>
      );
    case "skills":
      return (
        <div className="flex flex-wrap gap-1.5">
          <Skeleton className="h-[22px] w-14 rounded-full" />
          <Skeleton className="h-[22px] w-20 rounded-full" />
        </div>
      );
    default:
      return (
        <ol className="ml-1.5 space-y-3.5 border-l border-gray-200 pl-5">
          {[0, 1].map((i) => (
            <li key={i} className="relative">
              <Skeleton
                className={`absolute top-0 -left-[27px] h-[22px] w-[22px] rounded-full ${
                  i === 0 ? "" : "bg-gray-200"
                }`}
              />
              <Skeleton className={`h-3.5 ${i === 0 ? "w-[85%]" : "w-[65%]"}`} />
            </li>
          ))}
        </ol>
      );
  }
}
