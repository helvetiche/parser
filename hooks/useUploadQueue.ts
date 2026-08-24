"use client";

import { useCallback, useRef, useState } from "react";

/** Each file can be attempted at most this many times. */
export const MAX_ATTEMPTS = 5;

export type JobStatus = "staged" | "processing" | "done" | "failed";

export type UploadJob = {
  id: number;
  name: string;
  status: JobStatus;
  error?: string;
  attempts: number;
};

type UseUploadQueueOptions = {
  /** Processes one file; throw to mark the job failed. */
  runJob: (file: File) => Promise<void>;
  /** Called ~900ms after every job has succeeded (auto-close hook). */
  onAllDone?: () => void;
};

/**
 * Bulk-upload queue with a staged flow:
 *
 *   stage(files) → user reviews → startAll() → sequential processing
 *                ↳ failed jobs can be retried individually or in bulk,
 *                  up to MAX_ATTEMPTS per file; cancelling returns
 *                  not-yet-started jobs to the staged state.
 *
 * Shared by the resume and role upload modals.
 */
export function useUploadQueue({ runJob, onAllDone }: UseUploadQueueOptions) {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);

  const filesRef = useRef(new Map<number, File>());
  const nextIdRef = useRef(1);
  const cancelRef = useRef(false);
  // Mirror of state for reading latest jobs inside callbacks.
  const jobsRef = useRef<UploadJob[]>([]);
  jobsRef.current = jobs;

  /** Add dropped/selected files without starting anything. */
  const stage = useCallback((files: File[]) => {
    setJobs((prev) => [
      ...prev,
      ...files.map((file) => {
        const id = nextIdRef.current++;
        filesRef.current.set(id, file);
        return { id, name: file.name, status: "staged" as const, attempts: 0 };
      }),
    ]);
  }, []);

  const runMany = useCallback(
    async (ids: number[]) => {
      if (ids.length === 0) return;

      setExtracting(true);
      cancelRef.current = false;
      setCancelRequested(false);

      for (const id of ids) {
        if (cancelRef.current) break; // remaining jobs keep their current status

        const file = filesRef.current.get(id);
        if (!file) continue;

        setJobs((prev) =>
          prev.map((job) =>
            job.id === id
              ? { ...job, status: "processing", attempts: job.attempts + 1, error: undefined }
              : job
          )
        );

        try {
          await runJob(file);
          setJobs((prev) => prev.map((job) => (job.id === id ? { ...job, status: "done" } : job)));
        } catch (err) {
          setJobs((prev) =>
            prev.map((job) =>
              job.id === id
                ? {
                    ...job,
                    status: "failed",
                    error: err instanceof Error ? err.message : "Failed",
                  }
                : job
            )
          );
        }
      }

      // Stay open to show failures / staged leftovers; auto-close on a
      // fully clean board shortly after processing settles.
      // Note: onAllDone fires from the timeout, never inside a state
      // updater — side effects in updaters trigger setState-during-render.
      window.setTimeout(() => {
        setExtracting(false);
        const current = jobsRef.current;
        if (current.length > 0 && current.every((job) => job.status === "done")) {
          onAllDone?.();
        }
      }, 900);
    },
    [runJob, onAllDone]
  );

  const startAll = useCallback(() => {
    const ids = jobsRef.current.filter((j) => j.status === "staged").map((j) => j.id);
    void runMany(ids);
  }, [runMany]);

  const retryJob = useCallback(
    (id: number) => {
      const job = jobsRef.current.find((j) => j.id === id);
      if (!job || job.status !== "failed" || job.attempts >= MAX_ATTEMPTS) return;
      void runMany([id]);
    },
    [runMany]
  );

  const retryFailed = useCallback(() => {
    const ids = jobsRef.current
      .filter((j) => j.status === "failed" && j.attempts < MAX_ATTEMPTS)
      .map((j) => j.id);
    void runMany(ids);
  }, [runMany]);

  const requestCancel = useCallback(() => {
    cancelRef.current = true;
    setCancelRequested(true);
  }, []);

  return {
    jobs,
    extracting,
    cancelRequested,
    stage,
    startAll,
    retryJob,
    retryFailed,
    requestCancel,
  };
}

export type UploadQueueController = ReturnType<typeof useUploadQueue>;
