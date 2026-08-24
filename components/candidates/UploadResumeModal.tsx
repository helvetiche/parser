"use client";

import { FileArrowUp, WarningCircle } from "@phosphor-icons/react";
import { useSWRConfig } from "swr";
import Modal, { ModalCloseButton } from "@/components/ui/Modal";
import Dropzone, { DropzoneBusy, DropzoneIdle } from "@/components/ui/Dropzone";
import UploadQueuePanel from "@/components/ui/UploadQueuePanel";
import { useUploadQueue } from "@/hooks/useUploadQueue";
import { createCandidate, extractCandidateFromText, parsePdfFile } from "@/lib/client-api";
import { cacheKeys } from "@/lib/cache-keys";

type UploadResumeModalProps = {
  onClose: () => void;
  /** Model id used by the extract endpoint. */
  model: string;
  /** Surfaces skipped-file notices and failures in the parent banner. */
  onNotice: (message: string | null) => void;
  /** Current notice text, echoed inside the modal. */
  notice: string | null;
};

/**
 * Bulk resume upload with a staged flow: drop files → review →
 * Upload All (n) → sequential parse/extract/persist per file.
 */
export default function UploadResumeModal({
  onClose,
  model,
  onNotice,
  notice,
}: UploadResumeModalProps) {
  const { mutate } = useSWRConfig();

  const queue = useUploadQueue({
    runJob: async (file) => {
      const text = await parsePdfFile(file);
      const candidate = await extractCandidateFromText(text, model);
      await createCandidate(candidate);
      await mutate(cacheKeys.candidates);
    },
    onAllDone: onClose,
  });

  const handleFiles = (files: File[]) => {
    const pdfs = files.filter((f) => f.type === "application/pdf");
    const skipped = files.length - pdfs.length;

    if (pdfs.length === 0) {
      onNotice("Only PDF files are supported");
      return;
    }

    // Surface skipped files so nothing disappears silently.
    onNotice(
      skipped > 0 ? `${skipped} non-PDF file${skipped > 1 ? "s were" : " was"} skipped` : null
    );

    queue.stage(pdfs);
  };

  return (
    <Modal labelledBy="upload-modal-title" onClose={onClose} busy={queue.extracting}>
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
        <ModalCloseButton onClose={onClose} disabled={queue.extracting} />
      </div>

      <Dropzone onFiles={handleFiles} busy={queue.extracting} multiple>
        {queue.extracting ? (
          <DropzoneBusy
            message={
              <>
                Processing{" "}
                {Math.min(
                  queue.jobs.filter((j) => j.status !== "staged").length + 1,
                  queue.jobs.length
                )}{" "}
                of {queue.jobs.length}…
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

      <UploadQueuePanel queue={queue} />

      {notice && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs leading-relaxed font-medium text-red-600 ring-1 ring-red-100 ring-inset">
          <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
          {notice}
        </p>
      )}
    </Modal>
  );
}
