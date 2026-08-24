"use client";

import { CaretDown } from "@phosphor-icons/react";
import { MODEL_OPTIONS } from "@/lib/models";

type ModelSelectProps = {
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
};

export default function ModelSelect({
  value,
  onChange,
  disabled = false,
  ariaLabel = "Model",
  title,
}: ModelSelectProps) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={ariaLabel}
        title={title}
        className="w-full cursor-pointer appearance-none rounded-xl border border-gray-200 bg-white py-2.5 pr-10 pl-3.5 text-sm font-medium text-gray-800 shadow-sm transition-shadow hover:border-gray-300 focus:ring-2 focus:ring-gray-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {MODEL_OPTIONS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <CaretDown
        size={15}
        className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-gray-400"
      />
    </div>
  );
}
