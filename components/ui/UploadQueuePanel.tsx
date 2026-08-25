"use client";

import {
  ArrowClockwise,
  CheckCircle,
  CircleNotch,
  Clock,
  Play,
  WarningCircle,
} from "@phosphor-icons/react";
import { MAX_ATTEMPTS, type UploadJob, type UploadQueueController } from "@/hooks/useUploadQueue";

/**
 * Staged-file list + action row: Upload All (n), retry controls for
 * failed jobs (up to MAX_ATTEMPTS each), and cancel while running.
 */
export default function UploadQueuePanel({ queue }: { queue: UploadQueueController }) {
  const { jobs, extracting, cancelRequested } = queue;
  if (jobs.length === 0) return null;

  const staged = jobs.filter((j) => j.status === "staged");
  const retryable = jobs.filter((j) => j.status === "failed" && j.attempts < MAX_ATTEMPTS);
  const processed = jobs.filter((j) => j.status === "done" || j.status === "failed").length;

  return (
    <>
      <div className="mt-4 max-h-44 overflow-y-auto rounded-xl border border-gray-100">
        <div className="divide-y divide-gray-50">
          {jobs.map((job) => (
            <Row
              key={job.id}
              job={job}
              extracting={extracting}
              onRetry={() => queue.retryJob(job.id)}
            />
          ))}
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-3">
        <span className="shrink-0 text-xs text-gray-400">
          {processed} / {jobs.length} processed
        </span>
        <div className="flex items-center gap-2">
          {staged.length > 0 && !extracting && (
            <button
              onClick={queue.startAll}
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-gray-700 to-gray-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all duration-150 hover:shadow-md active:scale-[0.98]"
            >
              <Play size={12} weight="fill" />
              Upload All ({staged.length})
            </button>
          )}
          {retryable.length > 0 && !extracting && (
            <button
              onClick={queue.retryFailed}
              className="rounded-lg px-2.5 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-200 transition-colors ring-inset hover:bg-gray-100 hover:text-gray-900"
            >
              Retry failed ({retryable.length})
            </button>
          )}
          {extracting && (
            <button
              onClick={queue.requestCancel}
              disabled={cancelRequested}
              className="rounded-lg px-2.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cancelRequested ? "Finishing current…" : "Cancel"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function Row({
  job,
  extracting,
  onRetry,
}: {
  job: UploadJob;
  extracting: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2">
      <JobIcon status={job.status} />
      <span className="flex-1 truncate text-xs font-medium text-gray-700">{job.name}</span>
      {job.status === "failed" ? (
        <>
          <span
            className="max-w-[40%] truncate text-[13px] text-red-500"
            title={`${job.error ?? "Failed"} · attempt ${job.attempts}/${MAX_ATTEMPTS}`}
          >
            {job.error ?? "Failed"} · {job.attempts}/{MAX_ATTEMPTS}
          </span>
          {job.attempts < MAX_ATTEMPTS && !extracting && (
            <button
              onClick={onRetry}
              title="Retry this file"
              className="shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <ArrowClockwise size={13} weight="bold" />
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}

function JobIcon({ status }: { status: UploadJob["status"] }) {
  switch (status) {
    case "processing":
      return <CircleNotch size={13} className="shrink-0 animate-spin text-gray-400" />;
    case "done":
      return <CheckCircle weight="fill" size={13} className="shrink-0 text-emerald-500" />;
    case "failed":
      return <WarningCircle weight="fill" size={13} className="shrink-0 text-red-400" />;
    case "staged":
      return <Clock size={13} className="shrink-0 text-gray-300" />;
  }
}
