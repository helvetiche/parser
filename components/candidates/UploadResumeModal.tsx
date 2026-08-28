"use client";

import { useState } from "react";
import { CheckCircle, CircleNotch, Clock, FileArrowUp, WarningCircle } from "@phosphor-icons/react";
import { useSWRConfig } from "swr";
import Modal, { ModalCloseButton } from "@/components/ui/Modal";
import Dropzone, { DropzoneBusy, DropzoneIdle } from "@/components/ui/Dropzone";
import ReviewCandidateDrawer from "@/components/candidates/ReviewCandidateDrawer";
import { useCandidateReviewQueue } from "@/hooks/useReviewQueue";
import { createCandidate, extractCandidateFromText, parsePdfFile } from "@/lib/client-api";
import { cacheKeys } from "@/lib/cache-keys";

type UploadResumeModalProps = {
  onClose: () => void;
  model: string;
  onNotice: (message: string | null) => void;
  notice: string | null;
};

export default function UploadResumeModal({ onClose, model, onNotice, notice }: UploadResumeModalProps) {
  const { mutate } = useSWRConfig();
  const review = useCandidateReviewQueue();
  const [saving, setSaving] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const handleFiles = (files: File[]) => {
    const pdfs = files.filter((f) => f.type === "application/pdf");
    const skipped = files.length - pdfs.length;
    if (pdfs.length === 0) {
      onNotice("Only PDF files are supported");
      return;
    }
    onNotice(skipped > 0 ? `${skipped} non-PDF file${skipped > 1 ? "s were" : " was"} skipped` : null);

    // Bulk (2+) → automated: direct to DB without review drawer (per user request: only automation/single gets confirmation form)
    if (pdfs.length >= 2) {
      void handleBulkAuto(pdfs);
      return;
    }
    void review.stage(pdfs, model);
  };

  const handleBulkAuto = async (pdfs: File[]) => {
    setBulkSaving(true);
    setBulkProgress({ done: 0, total: pdfs.length });
    setBulkError(null);
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < pdfs.length; i++) {
      try {
        const text = await parsePdfFile(pdfs[i]);
        const candidate = await extractCandidateFromText(text, model);
        await createCandidate(candidate);
        ok++;
      } catch (err) {
        fail++;
        setBulkError(err instanceof Error ? err.message : "Bulk save failed");
      }
      setBulkProgress({ done: i + 1, total: pdfs.length });
    }
    await mutate(cacheKeys.candidates);
    setBulkSaving(false);
    setBulkProgress(null);
    if (fail === 0) {
      onNotice(`Bulk uploaded ${ok} candidates directly to database.`);
      onClose();
    } else {
      onNotice(`Bulk: saved ${ok}, failed ${fail}.`);
    }
  };

  const handleSave = async () => {
    if (!review.current) return;
    setSaving(true);
    const ok = await review.confirmCurrent(async (c) => {
      await createCandidate(c);
      await mutate(cacheKeys.candidates);
    });
    setSaving(false);
    if (ok && review.items.length === 1) {
      // last item just saved and removed, close modal if nothing left pending
      // review.items still contains old length during this render, check after
      setTimeout(() => {
        if (review.items.length <= 1) onClose();
      }, 0);
    }
  };

  const handleSaveAndNext = async () => {
    if (!review.current) return;
    setSaving(true);
    await review.confirmCurrent(async (c) => {
      await createCandidate(c);
      await mutate(cacheKeys.candidates);
    });
    setSaving(false);
  };

  const handleDiscard = () => {
    review.discardCurrent();
    if (review.items.length <= 1) {
      // if discarding last, keep modal open for next upload
    }
  };

  const handleCloseModal = () => {
    if (review.hasPending) {
      // If there are unsaved reviews, clear them on close — nothing persisted yet
      review.clear();
    }
    onClose();
  };

  const handlePrev = () => {
    if (review.currentIdx > 0) review.setCurrent(review.currentIdx - 1);
  };
  const handleNext = () => {
    if (review.currentIdx < review.items.length - 1) review.setCurrent(review.currentIdx + 1);
  };

  const busy = review.extracting || saving || bulkSaving;
  const showReview = !bulkSaving && review.current && review.current.status === "review";

  return (
    <>
      <Modal labelledBy="upload-modal-title" onClose={handleCloseModal} busy={busy}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id="upload-modal-title" className="text-lg font-semibold tracking-tight text-gray-900">
              Upload Resume
            </h3>
            <p className="mt-1 text-sm text-gray-500">Drop resume PDFs — review & edit before saving to pipeline.</p>
          </div>
          <ModalCloseButton onClose={handleCloseModal} disabled={busy} />
        </div>

        <Dropzone onFiles={handleFiles} busy={review.extracting || bulkSaving} multiple>
          {bulkSaving && bulkProgress ? (
            <DropzoneBusy
              message={
                <>
                  Bulk saving {bulkProgress.done} of {bulkProgress.total} directly to database…
                  <span className="mt-0.5 block text-xs font-normal text-gray-400">2+ files → automated, no review</span>
                </>
              }
            />
          ) : review.extracting ? (
            <DropzoneBusy
              message={
                <>
                  Extracting {review.items.filter((i) => i.status !== "review" && i.status !== "saved").length} of {review.items.length}…
                  <span className="mt-0.5 block text-xs font-normal text-gray-400">Parsing with AI — review drawer will open next</span>
                </>
              }
            />
          ) : (
            <DropzoneIdle icon={<FileArrowUp size={24} />} title="Drop resume PDFs here" subtitle="or click to browse — bulk uploads supported" />
          )}
        </Dropzone>

        {review.items.length > 0 && (
          <div className="mt-4 max-h-44 overflow-y-auto rounded-xl border border-gray-100">
            <div className="divide-y divide-gray-50">
              {review.items.map((it, idx) => (
                <div key={it.id} className="flex items-center gap-2.5 px-3 py-2">
                  <StatusIcon status={it.status} />
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
                  {it.status === "saving" && <span className="text-xs text-gray-400">Saving…</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {review.hasPending && review.reviewCount > 0 && !showReview && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-800 ring-1 ring-amber-100 ring-inset">
            {review.reviewCount} parsed resume{review.reviewCount > 1 ? "s" : ""} ready to review — drawer is open on the right. Edit any field before confirming.
          </p>
        )}

        {bulkError && (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs leading-relaxed font-medium text-red-600 ring-1 ring-red-100 ring-inset">
            <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
            {bulkError}
          </p>
        )}

        {notice && (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs leading-relaxed font-medium text-red-600 ring-1 ring-red-100 ring-inset">
            <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
            {notice}
          </p>
        )}

        {review.items.some((i) => i.status === "failed") && (
          <p className="mt-3 text-xs text-gray-500">Failed items can be removed by discarding in the review drawer.</p>
        )}
      </Modal>

      {showReview && (
        <ReviewCandidateDrawer
          candidate={review.current!.candidate}
          fileName={review.current!.fileName}
          index={review.currentIdx}
          total={review.items.length}
          saving={saving}
          onChange={(patch) => review.updateCurrent(patch)}
          onSave={handleSave}
          onSaveAndNext={handleSaveAndNext}
          onDiscard={handleDiscard}
          onClose={() => {
            // Close drawer but keep modal — user may want to upload more
            review.clear();
          }}
          onPrev={handlePrev}
          onNext={handleNext}
        />
      )}
    </>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "extracting":
    case "saving":
      return <CircleNotch size={13} className="shrink-0 animate-spin text-gray-400" />;
    case "review":
      return <Clock size={13} className="shrink-0 text-amber-500" />;
    case "saved":
      return <CheckCircle size={13} weight="fill" className="shrink-0 text-emerald-500" />;
    case "failed":
      return <WarningCircle size={13} weight="fill" className="shrink-0 text-red-400" />;
    default:
      return <Clock size={13} className="shrink-0 text-gray-300" />;
  }
}
