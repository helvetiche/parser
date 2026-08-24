"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  Article,
  Briefcase,
  CircleNotch,
  ClipboardText,
  Cpu,
  DotsThree,
  FileArrowUp,
  Lightning,
  ListChecks,
  Trash,
  Tray,
  UploadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import Modal, { ModalCloseButton } from "@/components/ui/Modal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dropzone, { DropzoneBusy, DropzoneIdle } from "@/components/ui/Dropzone";
import UploadQueuePanel from "@/components/ui/UploadQueuePanel";
import Skeleton from "@/components/ui/Skeleton";
import { useUploadQueue } from "@/hooks/useUploadQueue";
import type { RoleData, RoleRow } from "@/lib/role-schema";
import {
  createRole,
  deleteRole,
  extractRoleFromText,
  parsePdfFile,
  type RolesResponse,
} from "@/lib/client-api";
import { cacheKeys } from "@/lib/cache-keys";
import { DEFAULT_MODEL } from "@/lib/models";
import ModelSelect from "@/components/ui/ModelSelect";

type ColumnType = "text" | "list" | "skills" | "description";

const COLUMNS: {
  key: keyof RoleRow;
  label: string;
  type: ColumnType;
  icon: Icon;
}[] = [
  { key: "jobTitle", label: "Job", type: "text", icon: Briefcase },
  { key: "description", label: "Description", type: "description", icon: Article },
  { key: "responsibilities", label: "Responsibilities", type: "list", icon: ListChecks },
  { key: "requirements", label: "Requirements", type: "list", icon: ClipboardText },
  { key: "skills", label: "Skills Required", type: "skills", icon: Lightning },
];

const MAX_LIST_ITEMS = 3;
const MAX_SKILL_PILLS = 4;

export default function RoleDescription() {
  const {
    data,
    isLoading: listLoading,
    error: listError,
    mutate: mutateRoles,
  } = useSWR<RolesResponse>(cacheKeys.roles);
  const roles = data?.roles ?? [];
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [parserModel, setParserModel] = useState(DEFAULT_MODEL);
  const [pendingDelete, setPendingDelete] = useState<RoleRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const queue = useUploadQueue({
    // Parse → extract → persist pipeline for one job-description PDF.
    runJob: async (file) => {
      const text = await parsePdfFile(file);
      const role: RoleData = await extractRoleFromText(text, parserModel);
      await createRole(role);
      await mutateRoles();
    },
    onAllDone: () => setUploadOpen(false),
  });
  const uploading = queue.extracting;

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

    queue.stage(pdfs);
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

      {/* Table card */}
      <RolesTable roles={roles} loading={listLoading} onDeleteRequest={setPendingDelete} />

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

      {/* Upload modal */}
      {uploadOpen && (
        <Modal
          labelledBy="upload-role-modal-title"
          onClose={() => setUploadOpen(false)}
          busy={uploading}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3
                id="upload-role-modal-title"
                className="text-lg font-semibold tracking-tight text-gray-900"
              >
                Upload Job Description
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                Drop job description PDFs and AI structures each role.
              </p>
            </div>
            <ModalCloseButton onClose={() => setUploadOpen(false)} disabled={uploading} />
          </div>

          <Dropzone onFiles={handleFiles} busy={uploading} multiple>
            {uploading ? (
              <DropzoneBusy
                message={
                  <>
                    Processing{" "}
                    {Math.min(
                      queue.jobs.filter((j) => j.status !== "staged").length + 1,
                      queue.jobs.length
                    )}{" "}
                    of {queue.jobs.length}…
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

          <UploadQueuePanel queue={queue} />

          {/* Parser model picker — locked while a batch is running */}
          <div className="mt-4">
            <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
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
    </div>
  );
}

function RolesTable({
  roles,
  loading,
  onDeleteRequest,
}: {
  roles: RoleRow[];
  loading: boolean;
  onDeleteRequest: (role: RoleRow) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white/80 shadow-sm backdrop-blur">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-gray-800 bg-gradient-to-b from-gray-700 to-gray-900">
            {COLUMNS.map((col, ci) => (
              <th
                key={col.key}
                className={`px-4 py-3.5 text-[11px] font-semibold tracking-wider text-white uppercase ${
                  col.key === "jobTitle" ? "min-w-[220px]" : ""
                } ${col.key === "description" ? "max-w-[340px] min-w-[260px]" : ""} ${
                  ci > 0 ? "border-l border-gray-500/40" : ""
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
            <RoleSkeletonRows />
          ) : roles.length === 0 ? (
            <tr>
              <td colSpan={COLUMNS.length}>
                <EmptyState />
              </td>
            </tr>
          ) : (
            roles.map((role, i) => (
              <tr key={role.id ?? i} className="group fade-row">
                {COLUMNS.map((col, ci) => (
                  <td
                    key={col.key}
                    className={`${ci === 0 ? "min-w-[220px]" : ""} px-4 py-3.5 text-justify align-top ${
                      ci > 0 ? "border-l border-gray-100" : ""
                    }`}
                  >
                    <Cell column={col} role={role} onDeleteRequest={onDeleteRequest} />
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
}: {
  column: (typeof COLUMNS)[number];
  role: RoleRow;
  onDeleteRequest: (role: RoleRow) => void;
}) {
  switch (column.type) {
    case "text":
      return (
        <div className="flex items-center gap-3">
          <span className="font-semibold text-gray-900">{role.jobTitle}</span>
          <button
            onClick={() => onDeleteRequest(role)}
            className="ml-auto rounded-lg p-1.5 text-gray-300 opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 focus:opacity-100"
            aria-label={`Delete ${role.jobTitle}`}
            title="Delete role"
          >
            <Trash size={15} />
          </button>
        </div>
      );
    case "description":
      return (
        <span className="block max-w-[340px] leading-relaxed text-gray-600">
          {role.description}
        </span>
      );
    case "skills":
      return <SkillsCell skills={role.skills} />;
    case "list":
      return <ListCell items={role[column.key] as string[]} />;
  }
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

function ListCell({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-xs text-gray-300">N/A</span>;

  return (
    <ol className="ml-1 space-y-2 border-l border-gray-200 pl-3.5">
      {items.slice(0, MAX_LIST_ITEMS).map((item, idx) => (
        <li key={idx} className="relative">
          <span
            className={`absolute top-[5px] -left-[21px] h-1.5 w-1.5 rounded-full ring-[3px] ring-white ${
              idx === 0 ? "bg-gray-700" : "bg-gray-300"
            }`}
          />
          <span className="block leading-snug text-gray-600">{item}</span>
        </li>
      ))}
      {items.length > MAX_LIST_ITEMS && (
        <li
          className="pt-0.5 text-xs leading-snug font-medium text-gray-400"
          title={items.slice(MAX_LIST_ITEMS).join("\n")}
        >
          <DotsThree size={13} weight="bold" className="mb-0.5 inline align-middle text-gray-400" />{" "}
          {items.length - MAX_LIST_ITEMS}+ more
        </li>
      )}
    </ol>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-400 ring-1 ring-gray-200/70 ring-inset">
        <Tray size={26} />
      </div>
      <div>
        <p className="text-sm font-medium text-gray-600">No roles yet</p>
        <p className="mt-1 text-xs text-gray-400">
          Upload a job description PDF and AI will structure it for you.
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
    case "text":
      return <Skeleton className="h-4 w-36" />;
    case "skills":
      return (
        <div className="flex flex-wrap gap-1.5">
          <Skeleton className="h-[22px] w-14 rounded-full" />
          <Skeleton className="h-[22px] w-20 rounded-full" />
          <Skeleton className="h-[22px] w-16 rounded-full" />
        </div>
      );
    default:
      return (
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-full max-w-[300px]" />
          <Skeleton className="h-3.5 w-[80%] max-w-[260px]" />
          <Skeleton className="h-3.5 w-[55%] max-w-[180px]" />
        </div>
      );
  }
}
