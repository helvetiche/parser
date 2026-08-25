"use client";

import { MagnifyingGlass, X } from "@phosphor-icons/react";

type TableSearchProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
};

/** Minimal search box used in table toolbars. */
export default function TableSearch({ value, onChange, placeholder }: TableSearchProps) {
  return (
    <div className="relative max-w-xs flex-1">
      <MagnifyingGlass
        size={15}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gray-400"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-full rounded-lg border border-gray-200 bg-white pr-8 pl-9 text-sm text-gray-900 shadow-sm transition-colors outline-none placeholder:text-gray-400 focus:border-gray-400"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          aria-label="Clear search"
        >
          <X size={13} weight="bold" />
        </button>
      )}
    </div>
  );
}
