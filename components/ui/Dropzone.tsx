"use client";

import { useRef, useState } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import type { DragEvent, ReactNode } from "react";

type DropzoneProps = {
  /** Called with dropped files; never invoked while busy. */
  onFiles: (files: File[]) => void;
  /** While true the zone ignores interaction and shows caller-provided content. */
  busy?: boolean;
  accept?: string;
  multiple?: boolean;
  children: ReactNode;
};

export default function Dropzone({
  onFiles,
  busy = false,
  accept = "application/pdf",
  multiple = false,
  children,
}: DropzoneProps) {
  const [dropActive, setDropActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    if (!busy) inputRef.current?.click();
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropActive(false);
    if (busy) return;
    onFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openPicker}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !busy) {
          e.preventDefault();
          openPicker();
        }
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDropActive(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDropActive(false);
      }}
      onDrop={handleDrop}
      className={`mt-5 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors focus:ring-2 focus:ring-gray-300 focus:outline-none ${
        dropActive
          ? "border-gray-800 bg-gray-100"
          : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
      }`}
    >
      {children}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length > 0 && !busy) onFiles(files);
        }}
        className="hidden"
      />
    </div>
  );
}

export function DropzoneIdle({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <>
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-400 ring-1 ring-gray-200/70 ring-inset">
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-gray-700">{title}</p>
        <p className="mt-0.5 text-xs text-gray-400">{subtitle}</p>
      </div>
    </>
  );
}

export function DropzoneBusy({ message }: { message: ReactNode }) {
  return (
    <>
      <CircleNotch size={34} className="animate-spin text-gray-400" />
      <p className="text-sm font-medium text-gray-600">{message}</p>
    </>
  );
}
