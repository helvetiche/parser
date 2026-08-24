"use client";

import { X } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";

type ModalProps = {
  /** Accessible name source: the id of the heading inside the panel. */
  labelledBy: string;
  /** Called on backdrop click / close button / Escape. */
  onClose: () => void;
  /** While true, closing is blocked and the close button is disabled. */
  busy?: boolean;
  size?: "sm" | "md";
  children: ReactNode;
};

const PANEL_SIZES = {
  sm: "max-w-sm",
  md: "max-w-md",
} as const;

export default function Modal({
  labelledBy,
  onClose,
  busy = false,
  size = "md",
  children,
}: ModalProps) {
  useEscapeKey(() => {
    if (!busy) onClose();
  }, true);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div
        onClick={() => !busy && onClose()}
        className="absolute inset-0 bg-gray-950/40 backdrop-blur-sm"
      />
      <div
        className={`relative ${PANEL_SIZES[size]} rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl`}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalCloseButton({
  onClose,
  disabled,
}: {
  onClose: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClose}
      disabled={disabled}
      className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
      aria-label="Close dialog"
    >
      <X size={18} weight="bold" />
    </button>
  );
}
