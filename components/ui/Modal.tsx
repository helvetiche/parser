"use client";

import { X } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "@/hooks/useEscapeKey";

type ModalProps = {
  /** Accessible name source: the id of the heading inside the panel. */
  labelledBy: string;
  /** Called on backdrop click / close button / Escape. */
  onClose: () => void;
  /** While true, closing is blocked and the close button is disabled. */
  busy?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  /** Renders the panel as a flex column capped at 85vh; children supply their own scroll region. */
  scroll?: boolean;
  children: ReactNode;
};

const PANEL_SIZES = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
} as const;

export default function Modal({
  labelledBy,
  onClose,
  busy = false,
  size = "md",
  scroll = false,
  children,
}: ModalProps) {
  useEscapeKey(() => {
    if (!busy) onClose();
  }, true);

  if (typeof document === "undefined") return null;

  return createPortal(
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
        className={`relative ${PANEL_SIZES[size]} rounded-2xl border border-gray-200 bg-white shadow-2xl ${
          scroll ? "flex max-h-[85vh] flex-col overflow-hidden" : "p-6"
        }`}
      >
        {children}
      </div>
    </div>,
    document.body
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
