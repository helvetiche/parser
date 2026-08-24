"use client";

import { CircleNotch, Trash } from "@phosphor-icons/react";
import Modal from "./Modal";

type ConfirmDialogProps = {
  title: string;
  /** What is being removed, rendered in bold. */
  subject: string;
  /** Tail of the body sentence after the subject. */
  consequence: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function ConfirmDialog({
  title,
  subject,
  consequence,
  confirmLabel = "Delete",
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Modal labelledBy="confirm-dialog-title" onClose={onCancel} busy={busy} size="sm">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-red-500 ring-1 ring-red-100 ring-inset">
        <Trash size={20} weight="fill" />
      </div>
      <h3
        id="confirm-dialog-title"
        className="mt-4 text-lg font-semibold tracking-tight text-gray-900"
      >
        {title}
      </h3>
      <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
        You are about to permanently remove{" "}
        <span className="font-medium text-gray-800">{subject}</span> {consequence}
      </p>
      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-xl px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-b from-red-500 to-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:from-red-400 hover:to-red-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? (
            <CircleNotch size={15} className="animate-spin" />
          ) : (
            <Trash size={15} weight="fill" />
          )}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
