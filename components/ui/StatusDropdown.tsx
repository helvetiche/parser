"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown, Check, CheckCircle, CalendarBlank, Briefcase, XCircle } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import type { EndorsementStatus } from "@/lib/role-schema";

const STATUS_OPTIONS: { value: EndorsementStatus; label: string; Icon: Icon }[] = [
  { value: "endorsed", label: "Endorsed", Icon: CheckCircle },
  { value: "interviewed", label: "Interviewed", Icon: CalendarBlank },
  { value: "hired", label: "Hired", Icon: Briefcase },
  { value: "rejected", label: "Rejected", Icon: XCircle },
];

const redStatus = (value: EndorsementStatus) => (value === "rejected" ? "text-rose-500" : "text-gray-400");

export default function StatusDropdown({
  value,
  onChange,
  ariaLabel,
}: {
  value: EndorsementStatus;
  onChange: (value: EndorsementStatus) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const current = STATUS_OPTIONS.find((o) => o.value === value) ?? STATUS_OPTIONS[0];

  // Position the portal menu under the trigger (viewport coordinates).
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) setCoords({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    };
    place();

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Close on scroll/resize so the floating menu never detaches from the trigger.
    const onReflow = () => setOpen(false);

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white py-2 pr-3 pl-3 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-200/80 transition-colors hover:bg-gray-50 focus:outline-none"
      >
        <current.Icon size={15} weight="fill" className={`shrink-0 ${redStatus(current.value)}`} />
        <span className="flex-1 text-left">{current.label}</span>
        <CaretDown size={14} className="shrink-0 text-gray-400" />
      </button>
      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <ul
            ref={menuRef}
            role="listbox"
            style={{ position: "fixed", top: coords.top, left: coords.left, width: coords.width }}
            className="z-[80] overflow-hidden rounded-xl border border-gray-200 bg-white py-1.5 shadow-lg"
          >
            {STATUS_OPTIONS.map((opt) => {
              const selectedOpt = opt.value === value;
              return (
                <li key={opt.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedOpt}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      selectedOpt ? "bg-gray-100 text-gray-900" : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <opt.Icon size={15} weight="fill" className={`shrink-0 ${redStatus(opt.value)}`} />
                    <span className="flex-1">{opt.label}</span>
                    {selectedOpt && <Check size={14} className="shrink-0 text-gray-500" />}
                  </button>
                </li>
              );
            })}
          </ul>,
          document.body
        )}
    </div>
  );
}
