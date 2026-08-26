"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "@/hooks/useEscapeKey";

type DrawerProps = {
  /** Accessible name source: the id of the heading inside the panel. */
  labelledBy: string;
  /** Called on backdrop click / close button / Escape. */
  onClose: () => void;
  /** While true, closing is blocked and the close button is disabled. */
  busy?: boolean;
  /** Panel width on desktop. Defaults to 50% of the screen. */
  size?: "md" | "lg" | "xl" | "full";
  /** Renders the panel as a flex column; children supply their own scroll region. */
  children: ReactNode;
};

const WIDTHS = {
  md: "md:w-[42%]",
  lg: "md:w-1/2",
  xl: "md:w-4/5",
  full: "w-full",
} as const;

export default function Drawer({
  labelledBy,
  onClose,
  busy = false,
  size = "lg",
  children,
}: DrawerProps) {
  const [show, setShow] = useState(false);
  useEscapeKey(() => {
    if (!busy) onClose();
  }, true);

  // Slide in from the right on mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div
        onClick={() => !busy && onClose()}
        className={`absolute inset-0 bg-gray-950/40 backdrop-blur-sm transition-opacity duration-300 ease-out ${
          show ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        className={`absolute top-0 right-0 flex h-full w-full ${WIDTHS[size]} flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${
          show ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
