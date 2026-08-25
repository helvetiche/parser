"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import type { CandidateRow } from "@/lib/candidate-schema";
import { getInitials } from "@/components/candidates/CandidatesTable";

type CandidateSearchProps = {
  candidates: CandidateRow[];
  selected: CandidateRow | null;
  onSelect: (candidate: CandidateRow) => void;
  onClear: () => void;
  disabled?: boolean;
};

/**
 * Recruiter-facing combobox: type a candidate's name, pick from the
 * dropdown of stored candidates. Shows the selected candidate as a chip
 * once chosen so the roles table can display their fit scores.
 */
export default function CandidateSearch({
  candidates,
  selected,
  onSelect,
  onClear,
  disabled,
}: CandidateSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => c.fullName.toLowerCase().includes(q));
  }, [candidates, query]);

  // Close the dropdown on any click outside the combobox.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  // Drop the chip if the selected candidate no longer exists upstream.
  useEffect(() => {
    if (selected && !candidates.some((c) => c.id === selected.id)) onClear();
  }, [candidates, selected, onClear]);

  const choose = (candidate: CandidateRow) => {
    onSelect(candidate);
    setQuery("");
    setOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (filtered[activeIndex]) choose(filtered[activeIndex]);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      {selected ? (
        <div className="flex h-[46px] items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 shadow-sm">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gray-200 to-gray-300 text-xs font-bold text-gray-600 ring-1 ring-gray-900/5 ring-inset">
            {getInitials(selected.fullName)}
          </span>
          <span className="text-sm font-medium text-gray-900">{selected.fullName}</span>
          <button
            onClick={onClear}
            className="ml-auto rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
            aria-label={`Clear ${selected.fullName}`}
            title="Clear selection"
            disabled={disabled}
          >
            <X size={15} />
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <MagnifyingGlass
              size={17}
              className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-gray-400"
            />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls="candidate-search-listbox"
              aria-label="Search candidates"
              placeholder={candidates.length === 0 ? "No candidates yet" : "Search a candidate…"}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
                setActiveIndex(0);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              className="h-[46px] w-full rounded-xl border border-gray-200 bg-white pr-9 pl-10 text-sm text-gray-900 shadow-sm transition-colors outline-none placeholder:text-gray-400 focus:border-gray-400 disabled:cursor-not-allowed disabled:bg-gray-50"
            />
          </div>

          {open && (
            <ul
              id="candidate-search-listbox"
              role="listbox"
              className="absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white py-1.5 shadow-lg"
            >
              {filtered.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-gray-400">
                  No candidates match &ldquo;{query.trim()}&rdquo;
                </li>
              ) : (
                filtered.map((candidate, i) => (
                  <li key={candidate.id}>
                    <button
                      role="option"
                      aria-selected={i === activeIndex}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => choose(candidate)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        i === activeIndex ? "bg-gray-100" : ""
                      }`}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gray-200 to-gray-300 text-xs font-bold text-gray-600">
                        {getInitials(candidate.fullName)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-gray-900">
                          {candidate.fullName || "Unnamed candidate"}
                        </span>
                        {candidate.skills.length > 0 && (
                          <span className="block truncate text-xs text-gray-500">
                            {candidate.skills.slice(0, 4).join(" · ")}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
