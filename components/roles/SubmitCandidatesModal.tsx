"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import {
  Briefcase,
  CalendarBlank,
  CheckCircle,
  Clock,
  FileArrowUp,
  Flag,
  Link as LinkIcon,
  Trash,
  UserPlus,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { ModalCloseButton } from "@/components/ui/Modal";
import Drawer from "@/components/ui/Drawer";
import TimelineList from "@/components/ui/TimelineList";
import StatusDropdown from "@/components/ui/StatusDropdown";
import CandidateDetailsModal from "@/components/candidates/CandidateDetailsModal";
import CandidateSearch from "@/components/roles/CandidateSearch";
import { CONTACT_ICONS, getInitials } from "@/components/candidates/CandidatesTable";
import {
  createCandidate,
  extractCandidateFromText,
  parsePdfFile,
  removeEndorsement,
  saveEndorsement,
} from "@/lib/client-api";
import { cacheKeys } from "@/lib/cache-keys";
import { DEFAULT_MODEL } from "@/lib/models";
import type { CandidateRow } from "@/lib/candidate-schema";
import type { Endorsement, EndorsementStatus } from "@/lib/role-schema";

/**
 * Horizontal 3-step funnel under the status dropdown. Each stage is an
 * icon color-coded to its own state; reached stages are filled. When the
 * status is "rejected" the final node becomes "Rejected" and every node
 * glows red.
 */
const STEP_ICONS = {
  Endorsed: CheckCircle,
  Interviewed: CalendarBlank,
  Hired: Briefcase,
  Rejected: XCircle,
} as const;

type StepLabel = keyof typeof STEP_ICONS;

const STEP_COLOR = {
  Endorsed: {
    filled: "bg-blue-500",
    ring: "ring-blue-100",
    shadow: "shadow-[0_0_10px_rgba(59,130,246,0.6)]",
  },
  Interviewed: {
    filled: "bg-amber-500",
    ring: "ring-amber-100",
    shadow: "shadow-[0_0_10px_rgba(245,158,11,0.6)]",
  },
  Hired: {
    filled: "bg-emerald-500",
    ring: "ring-emerald-100",
    shadow: "shadow-[0_0_10px_rgba(16,185,129,0.6)]",
  },
  Rejected: {
    filled: "bg-red-500",
    ring: "ring-red-100",
    shadow: "shadow-[0_0_10px_rgba(239,68,68,0.85)]",
  },
} as const;

function StatusStepper({ status }: { status: EndorsementStatus }) {
  const rejected = status === "rejected";
  const labels: StepLabel[] = rejected
    ? ["Endorsed", "Interviewed", "Rejected"]
    : ["Endorsed", "Interviewed", "Hired"];
  const activeCount = rejected ? 3 : { endorsed: 1, interviewed: 2, hired: 3 }[status];
  // Every reached node adopts the current status's color profile.
  const currentColor = STEP_COLOR[rejected ? "Rejected" : labels[activeCount - 1]];

  return (
    <ol className="mt-3">
      <div className="flex items-center">
        {labels.map((label, i) => {
          const idx = i + 1;
          const active = idx <= activeCount;
          const Icon = STEP_ICONS[label];
          const nodeClass = rejected
            ? "bg-red-500 text-white shadow-[0_0_10px_rgba(239,68,68,0.85)] ring-4 ring-red-100"
            : active
              ? `${currentColor.filled} text-white ${currentColor.shadow} ring-4 ${currentColor.ring}`
              : "bg-white text-gray-300 ring-1 ring-gray-200";
          const connectorClass = rejected
            ? "bg-red-300"
            : idx < activeCount
              ? currentColor.filled
              : "bg-gray-200";
          return (
            <Fragment key={label}>
              <span
                className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-300 ease-out ${nodeClass}`}
              >
                <Icon size={16} weight="fill" />
                <span
                  className={`absolute top-9 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium ${
                    rejected ? "text-red-600" : active ? "text-gray-700" : "text-gray-400"
                  }`}
                >
                  {label}
                </span>
              </span>
              {i < labels.length - 1 && (
                <span className="relative z-0 mx-1 h-0.5 flex-1 overflow-hidden rounded-full bg-gray-200">
                  <span
                    className={`absolute inset-y-0 left-0 w-full origin-left rounded-full transition-transform duration-500 ease-out ${connectorClass} ${
                      idx < activeCount ? "scale-x-100" : "scale-x-0"
                    }`}
                  />
                </span>
              )}
            </Fragment>
          );
        })}
      </div>
    </ol>
  );
}

export default function SubmitCandidatesModal({
  roleId,
  roleTitle,
  candidates,
  initialEndorsements,
  onClose,
}: {
  roleId: string;
  roleTitle: string;
  candidates: CandidateRow[];
  initialEndorsements?: Record<string, Endorsement>;
  onClose: () => void;
}) {
  const { mutate } = useSWRConfig();
  const [list, setList] = useState<Endorsement[]>(() =>
    Object.values(initialEndorsements ?? {}).sort((a, b) =>
      b.addedAt.localeCompare(a.addedAt)
    )
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<CandidateRow | null>(null);

  const byId = useMemo(
    () => Object.fromEntries(candidates.map((c) => [c.id, c])),
    [candidates]
  );
  const pool = useMemo(
    () => candidates.filter((c) => !list.some((e) => e.candidateId === c.id)),
    [candidates, list]
  );

  const addEndorsement = async (
    candidate: { id: string; fullName: string },
    status: EndorsementStatus = "endorsed"
  ) => {
    const entry: Endorsement = {
      candidateId: candidate.id,
      candidateName: candidate.fullName,
      status,
      addedAt: new Date().toISOString(),
    };
    setList((l) =>
      l.some((e) => e.candidateId === entry.candidateId) ? l : [entry, ...l]
    );
    try {
      await saveEndorsement(roleId, entry);
      await mutate(cacheKeys.roles);
    } catch (err) {
      setList((l) => l.filter((e) => e.candidateId !== entry.candidateId));
      setError(err instanceof Error ? err.message : "Failed to submit candidate");
    }
  };

  const updateStatus = async (candidateId: string, status: EndorsementStatus) => {
    const current = list.find((e) => e.candidateId === candidateId);
    if (!current) return;
    setList((l) =>
      l.map((e) => (e.candidateId === candidateId ? { ...e, status } : e))
    );
    try {
      await saveEndorsement(roleId, { ...current, status });
      await mutate(cacheKeys.roles);
    } catch (err) {
      setList((l) =>
        l.map((e) => (e.candidateId === candidateId ? { ...e, status: current.status } : e))
      );
      setError(err instanceof Error ? err.message : "Failed to update status");
    }
  };

  const remove = async (candidateId: string) => {
    const prev = list;
    setList((l) => l.filter((e) => e.candidateId !== candidateId));
    try {
      await removeEndorsement(roleId, candidateId);
      await mutate(cacheKeys.roles);
    } catch (err) {
      setList(prev);
      setError(err instanceof Error ? err.message : "Failed to remove candidate");
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const text = await parsePdfFile(file);
      const candidate = await extractCandidateFromText(text, DEFAULT_MODEL);
      const saved = await createCandidate(candidate);
      await mutate(cacheKeys.candidates);
      await addEndorsement(saved, "endorsed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload resume");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Drawer labelledBy="submit-candidates-title" onClose={onClose} size="full">
      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gray-700 to-gray-900 text-white shadow-sm">
            <UserPlus size={22} weight="fill" />
          </span>
          <div className="min-w-0">
            <h3
              id="submit-candidates-title"
              className="text-lg font-semibold tracking-tight text-gray-900"
            >
              Submit Candidates
            </h3>
            <p className="mt-0.5 truncate text-sm text-gray-500">{roleTitle}</p>
          </div>
        </div>
        <ModalCloseButton onClose={onClose} />
      </div>

      <div className="border-t border-gray-100" />

      <div className="chat-scroll flex-1 space-y-6 overflow-y-auto px-6 py-6">
        {/* Add controls */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px] flex-1">
            <label className="mb-1.5 block text-[13px] font-semibold tracking-wider text-gray-500 uppercase">
              Add from existing pool
            </label>
            <CandidateSearch
              candidates={pool}
              selected={null}
              onSelect={(c) => void addEndorsement(c, "endorsed")}
              onClear={() => {}}
              disabled={uploading}
            />
          </div>
          <div>
            <span className="mb-1.5 block text-[13px] font-semibold tracking-wider text-gray-500 uppercase opacity-0">
              Upload
            </span>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileArrowUp size={17} />
              {uploading ? "Uploading…" : "Upload Resume"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleUpload(file);
              }}
            />
          </div>
        </div>

        {error && (
          <p className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs font-medium text-red-600 ring-1 ring-red-100 ring-inset">
            <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        {/* Endorsement table */}
        <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white/80 shadow-sm">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gradient-to-b from-gray-700 to-gray-900">
                <th className="w-[40%] px-4 py-3 text-[13px] font-semibold tracking-wider text-white uppercase">
                  <span className="flex items-center gap-2">
                    <UserPlus size={14} weight="fill" className="text-white" />
                    Candidate
                  </span>
                </th>
                <th className="w-[30%] border-l border-gray-500/40 px-4 py-3 text-[13px] font-semibold tracking-wider text-white uppercase">
                  <span className="flex items-center gap-2">
                    <Clock size={14} weight="fill" className="text-white" />
                    Experience
                  </span>
                </th>
                <th className="w-[30%] border-l border-gray-500/40 px-4 py-3 text-[13px] font-semibold tracking-wider text-white uppercase">
                  <span className="flex items-center gap-2">
                    <Flag size={14} weight="fill" className="text-white" />
                    Status
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.length === 0 ? (
                <tr>
                  <td colSpan={3}>
                    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
                      <p className="text-sm font-medium text-gray-600">No candidates submitted</p>
                      <p className="text-xs text-gray-400">
                        Add from the pool above or upload a resume to endorse a candidate.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                list.map((e) => {
                  const candidate = byId[e.candidateId];
                  const experience = candidate?.experience ?? [];
                  return (
                    <tr
                      key={e.candidateId}
                      onClick={() => candidate && setSelected(candidate)}
                      className={`align-top ${candidate ? "cursor-pointer hover:bg-gray-50" : ""}`}
                    >
                      <td className="px-4 py-3.5">
                        <div className="flex flex-col gap-2.5">
                          <div className="flex items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gray-200 to-gray-300 text-xs font-bold text-gray-600 ring-1 ring-gray-900/5 ring-inset">
                              {getInitials(e.candidateName)}
                            </span>
                            <span className="truncate text-sm font-semibold text-gray-900">
                              {e.candidateName}
                            </span>
                              <button
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  void remove(e.candidateId);
                                }}
                                className="ml-auto rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500"
                                aria-label={`Remove ${e.candidateName}`}
                                title="Remove"
                              >
                              <Trash size={15} />
                            </button>
                          </div>
                          {candidate?.summary ? (
                            <p className="text-xs leading-relaxed text-gray-500">
                              {candidate.summary}
                            </p>
                          ) : null}
                          {(candidate?.contacts ?? []).length > 0 && (
                            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
                              {candidate.contacts.map((contact) => {
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
                      </td>
                      <td className="border-l border-gray-100 px-4 py-3.5 align-top">
                        {experience.length > 0 ? (
                          <TimelineList items={experience} icon={Clock} moreLabel="more" />
                        ) : (
                          <span className="text-xs text-gray-300">N/A</span>
                        )}
                      </td>
                      <td
                        className="border-l border-gray-100 px-4 py-3.5 align-top"
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        <StatusDropdown
                          value={e.status}
                          onChange={(s) => void updateStatus(e.candidateId, s)}
                          ariaLabel={`Status for ${e.candidateName}`}
                        />
                        <StatusStepper status={e.status} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <CandidateDetailsModal candidate={selected} onClose={() => setSelected(null)} />
      )}
    </Drawer>
  );
}
