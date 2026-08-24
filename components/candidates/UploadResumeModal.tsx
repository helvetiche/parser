"use client";

import { CheckCircle, CircleNotch, Clock, FileArrowUp, WarningCircle } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import Modal, { ModalCloseButton } from "@/components/ui/Modal";
import Dropzone, { DropzoneBusy, DropzoneIdle } from "@/components/ui/Dropzone";
import { extractCandidateFromText, parsePdfFile } from "@/lib/client-api";
import { saveCandidate } from "@/lib/candidates";
import type { Candidate } from "@/lib/candidate-schema";

type JobStatus = "queued" | "processing" | "done" | "failed";

type UploadJob = {
  name: string;
  status: JobStatus;
  error?: string;
};

type UploadResumeModalProps = {
  open: boolean;
  onClose: () => void;
  /** Model id used by the extract endpoint. */
  model: string;
  /** Surfaces skipped-file notices and failures in the parent banner. */
  onNotice: (message: string | null) => void;
  /** Current notice text, echoed inside the modal. */
  notice: string | null;
};

/**
 * Parse → extract → persist pipeline for one resume file.
 * Firestore snapshot listeners refresh the list automatically after save.
 */
async function runResumePipeline(file: File, model: string): Promise<void> {
  const text = await parsePdfFile(file);
  const candidate: Candidate = await extractCandidateFromText(text, model);
  await saveCandidate(candidate);
}

export default function UploadResumeModal({
  open,
  onClose,
  model,
  onNotice,
  notice,
}: UploadResumeModalProps) {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const cancelRef = useRef(false);

  if (!open) return null;

  const updateJob = (index: number, patch: Partial<UploadJob>) => {
    setJobs((prev) => prev.map((job, i) => (i === index ? { ...job, ...patch } : job)));
  };

  const processQueue = async (files: File[]) => {
    for (let i = 0; i < files.length; i++) {
      if (cancelRef.current) {
        setJobs((prev) =>
          prev.map((job, idx) =>
            idx >= i ? { ...job, status: "failed" as const, error: "Cancelled" } : job
          )
        );
        break;
      }

      updateJob(i, { status: "processing" });

      try {
        await runResumePipeline(files[i], model);
        updateJob(i, { status: "done" });
      } catch (err) {
        updateJob(i, {
          status: "failed",
          error: err instanceof Error ? err.message : "Failed",
        });
      }
    }
  };

  const startBulkUpload = (files: File[]) => {
    setJobs(files.map((f) => ({ name: f.name, status: "queued" as JobStatus })));
    setExtracting(true);
    cancelRef.current = false;
    setCancelRequested(false);

    void processQueue(files).finally(() => {
      // Auto-close once every file succeeded; stay open to show failures.
      window.setTimeout(() => {
        setExtracting(false);
        setJobs((queue) => {
          if (queue.length > 0 && queue.every((job) => job.status === "done")) {
            onClose();
            return [];
          }
          return queue;
        });
      }, 900);
    });
  };

  const handleFiles = (files: File[]) => {
    const pdfs = files.filter((f) => f.type === "application/pdf");
    const skipped = files.length - pdfs.length;

    if (pdfs.length === 0) {
      onNotice("Only PDF files are supported");
      return;
    }

    // Surface skipped files, then clear the notice shortly after.
    onNotice(
      skipped > 0 ? `${skipped} non-PDF file${skipped > 1 ? "s were" : " was"} skipped` : null
    );

    startBulkUpload(pdfs);
  };

  const requestCancel = () => {
    cancelRef.current = true;
    setCancelRequested(true);
  };

  return (
    <Modal labelledBy="upload-modal-title" onClose={onClose} busy={extracting}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3
            id="upload-modal-title"
            className="text-lg font-semibold tracking-tight text-gray-900"
          >
            Upload Resume
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Drop resume PDFs and AI extracts each candidate.
          </p>
        </div>
        <ModalCloseButton onClose={onClose} disabled={extracting} />
      </div>

      <Dropzone onFiles={handleFiles} busy={extracting} multiple>
        {extracting ? (
          <DropzoneBusy
            message={
              <>
                Processing{" "}
                {Math.min(jobs.filter((j) => j.status !== "queued").length + 1, jobs.length)} of{" "}
                {jobs.length}…
                <span className="mt-0.5 block text-xs font-normal text-gray-400">
                  You can keep this open to watch progress
                </span>
              </>
            }
          />
        ) : (
          <DropzoneIdle
            icon={<FileArrowUp size={24} />}
            title="Drop resume PDFs here"
            subtitle="or click to browse — bulk uploads supported"
          />
        )}
      </Dropzone>

      {/* Bulk queue */}
      {jobs.length > 0 && (
        <>
          <div className="mt-4 max-h-44 overflow-y-auto rounded-xl border border-gray-100">
            <div className="divide-y divide-gray-50">
              {jobs.map((job, idx) => (
                <div key={`${job.name}-${idx}`} className="flex items-center gap-2.5 px-3 py-2">
                  <JobIcon status={job.status} />
                  <span className="flex-1 truncate text-xs font-medium text-gray-700">
                    {job.name}
                  </span>
                  {job.status === "failed" && job.error ? (
                    <span
                      className="max-w-[45%] truncate text-[11px] text-red-500"
                      title={job.error}
                    >
                      {job.error}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-2.5 flex items-center justify-between">
            <span className="text-xs text-gray-400">
              {jobs.filter((j) => j.status !== "queued").length} / {jobs.length} processed
            </span>
            {extracting && (
              <button
                onClick={requestCancel}
                disabled={cancelRequested}
                className="rounded-lg px-2.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cancelRequested ? "Finishing current…" : "Cancel"}
              </button>
            )}
          </div>
        </>
      )}

      {notice && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs leading-relaxed font-medium text-red-600 ring-1 ring-red-100 ring-inset">
          <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
          {notice}
        </p>
      )}
    </Modal>
  );
}

function JobIcon({ status }: { status: JobStatus }) {
  switch (status) {
    case "processing":
      return <CircleNotch size={13} className="shrink-0 animate-spin text-gray-400" />;
    case "done":
      return <CheckCircle weight="fill" size={13} className="shrink-0 text-emerald-500" />;
    case "failed":
      return <WarningCircle weight="fill" size={13} className="shrink-0 text-red-400" />;
    default:
      return <Clock size={13} className="shrink-0 text-gray-300" />;
  }
}
