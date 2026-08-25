"use client";

import { DotsThree } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";

type TimelineListProps = {
  items: string[];
  /** Node marker icon; rendered filled on the first (latest) entry. */
  icon: Icon;
  maxItems?: number;
  /** Label for the overflow row, e.g. "more roles". */
  moreLabel?: string;
  /**
   * Normalized (lowercase, whitespace-collapsed) strings considered
   * satisfied; matching entries render green instead of the default style.
   */
  matchedItems?: Set<string>;
};

function normalizeItem(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Vertical timeline list matching the candidates-table experience style:
 * aligned circular nodes on a left rail, first entry highlighted,
 * overflow collapsed into a "+ n more" row.
 */
export default function TimelineList({
  items,
  icon: NodeIcon,
  maxItems = 3,
  moreLabel = "more",
  matchedItems,
}: TimelineListProps) {
  const visible = items.slice(0, maxItems);
  const hidden = items.length - visible.length;

  return (
    <ol className="ml-1.5 space-y-3.5 border-l border-gray-200 pl-5">
      {visible.map((item, idx) => {
        const matched = matchedItems?.has(normalizeItem(item)) ?? false;
        const highlight = matched || !matchedItems ? idx === 0 : false;
        return (
          <li key={idx} className="relative">
            <span
              className={`absolute top-0 -left-[27px] flex h-[22px] w-[22px] items-center justify-center rounded-full shadow-sm ring-4 ring-white ${
                matched
                  ? "bg-emerald-500 text-white"
                  : highlight
                    ? "bg-gradient-to-b from-gray-700 to-gray-900 text-white"
                    : "bg-gray-200 text-gray-500"
              }`}
            >
              <NodeIcon size={11} weight={matched || highlight ? "fill" : "regular"} />
            </span>
            <span
              className={`block pt-0.5 leading-snug ${
                matched ? "font-medium text-emerald-700" : "text-gray-600"
              }`}
            >
              {item}
            </span>
          </li>
        );
      })}
      {hidden > 0 && (
        <li className="relative">
          <span className="absolute top-0 -left-[27px] flex h-[22px] w-[22px] items-center justify-center rounded-full bg-gray-100 ring-4 ring-white">
            <DotsThree size={12} weight="bold" className="text-gray-400" />
          </span>
          <span
            className="block pt-1 text-xs leading-snug font-medium text-gray-400"
            title={items.slice(maxItems).join("\n")}
          >
            {hidden}+ {moreLabel}
          </span>
        </li>
      )}
    </ol>
  );
}
