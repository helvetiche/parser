"use client";

import { useEffect } from "react";

/**
 * Invoke `handler` when Escape is pressed while `active` is true.
 */
export function useEscapeKey(handler: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handler();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handler, active]);
}
