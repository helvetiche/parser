"use client";

import { useCallback, useRef, useState } from "react";
import { parsePdfFile, extractCandidateFromTextWithUsage, extractRoleFromTextWithUsage } from "@/lib/client-api";
import type { Candidate } from "@/lib/candidate-schema";
import type { RoleData } from "@/lib/role-schema";
import type { TokenUsage } from "@/lib/openrouter";

export type ReviewStatus = "extracting" | "review" | "saving" | "saved" | "failed" | "discarded";

export type PendingCandidate = {
  id: number;
  fileName: string;
  text: string;
  candidate: Candidate;
  model: string;
  usage?: TokenUsage;
  status: ReviewStatus;
  error?: string;
};

export type PendingRole = {
  id: number;
  fileName: string;
  text: string;
  role: RoleData;
  model: string;
  usage?: TokenUsage;
  status: ReviewStatus;
  error?: string;
};

// ── Candidate Review Queue ──
export function useCandidateReviewQueue() {
  const [items, setItems] = useState<PendingCandidate[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const nextIdRef = useRef(1);

  const stage = useCallback(
    async (files: File[], model: string) => {
      if (files.length === 0) return;
      setExtracting(true);
      const newItems: PendingCandidate[] = files.map((f) => ({
        id: nextIdRef.current++,
        fileName: f.name,
        text: "",
        candidate: {
          fullName: "",
          summary: "",
          education: "",
          experience: [],
          skills: [],
          expectedSalary: "",
          reasoning: "",
          contacts: [],
        },
        model,
        status: "extracting" as const,
      }));
      setItems((prev) => [...prev, ...newItems]);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const id = newItems[i].id;
        try {
          const text = await parsePdfFile(file);
          const { candidate, usage, model: usedModel } = await extractCandidateFromTextWithUsage(text, model);
          setItems((prev) =>
            prev.map((it) =>
              it.id === id
                ? { ...it, text, candidate, model: usedModel ?? model, usage, status: "review" as const }
                : it
            )
          );
        } catch (err) {
          setItems((prev) =>
            prev.map((it) =>
              it.id === id
                ? { ...it, status: "failed" as const, error: err instanceof Error ? err.message : "Extraction failed" }
                : it
            )
          );
        }
      }
      setExtracting(false);
    },
    []
  );

  const updateCurrent = useCallback(
    (patch: Partial<Candidate>) => {
      setItems((prev) => {
        const idx = prev.findIndex((_, i) => i === currentIdx);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], candidate: { ...next[idx].candidate, ...patch } };
        return next;
      });
    },
    [currentIdx]
  );

  const setCurrent = useCallback((idx: number) => setCurrentIdx(idx), []);

  const removeItem = useCallback(
    (id: number) => {
      setItems((prev) => {
        const filtered = prev.filter((it) => it.id !== id);
        return filtered;
      });
      setCurrentIdx((prev) => Math.max(0, prev - 1));
    },
    []
  );

  const discardCurrent = useCallback(() => {
    setItems((prev) => {
      const item = prev[currentIdx];
      if (!item) return prev;
      // mark discarded then remove
      const next = prev.filter((_, i) => i !== currentIdx);
      return next;
    });
    setCurrentIdx((prev) => Math.max(0, prev - 1));
  }, [currentIdx]);

  const confirmCurrent = useCallback(
    async (saveFn: (c: Candidate) => Promise<unknown>) => {
      const item = items[currentIdx];
      if (!item || item.status !== "review") return false;
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, status: "saving" as const } : it)));
      try {
        await saveFn(item.candidate);
        setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, status: "saved" as const } : it)));
        // auto-advance: remove saved from pending and show next
        setItems((prev) => prev.filter((it) => it.id !== item.id));
        setCurrentIdx((prev) => {
          // stay at same index (next item slides in) unless at end
          const remaining = items.length - 1; // items is stale but ok
          if (prev >= remaining) return Math.max(0, remaining - 1);
          return prev;
        });
        return true;
      } catch (err) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? { ...it, status: "failed" as const, error: err instanceof Error ? err.message : "Save failed" }
              : it
          )
        );
        return false;
      }
    },
    [items, currentIdx]
  );

  const confirmAll = useCallback(
    async (saveFn: (c: Candidate) => Promise<unknown>) => {
      for (const it of [...items]) {
        if (it.status !== "review") continue;
        const idx = items.findIndex((x) => x.id === it.id);
        setCurrentIdx(idx >= 0 ? idx : 0);
        setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, status: "saving" as const } : p)));
        try {
          await saveFn(it.candidate);
          setItems((prev) => prev.filter((p) => p.id !== it.id));
        } catch (err) {
          setItems((prev) =>
            prev.map((p) => (p.id === it.id ? { ...p, status: "failed" as const, error: err instanceof Error ? err.message : "Save failed" } : p))
          );
        }
      }
    },
    [items]
  );

  const clear = useCallback(() => {
    setItems([]);
    setCurrentIdx(0);
    setExtracting(false);
  }, []);

  const current = items[currentIdx] ?? null;
  const reviewCount = items.filter((i) => i.status === "review").length;
  const hasPending = items.length > 0;

  return {
    items,
    current,
    currentIdx,
    setCurrent,
    extracting,
    hasPending,
    reviewCount,
    stage,
    updateCurrent,
    removeItem,
    discardCurrent,
    confirmCurrent,
    confirmAll,
    clear,
  };
}

// ── Role Review Queue ──
export function useRoleReviewQueue() {
  const [items, setItems] = useState<PendingRole[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const nextIdRef = useRef(1);

  const stage = useCallback(
    async (files: File[], model: string) => {
      if (files.length === 0) return;
      setExtracting(true);
      const newItems: PendingRole[] = files.map((f) => ({
        id: nextIdRef.current++,
        fileName: f.name,
        text: "",
        role: {
          jobTitle: "",
          description: "",
          responsibilities: [],
          requirements: [],
          skills: [],
        },
        model,
        status: "extracting" as const,
      }));
      setItems((prev) => [...prev, ...newItems]);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const id = newItems[i].id;
        try {
          const text = await parsePdfFile(file);
          const { role, usage, model: usedModel } = await extractRoleFromTextWithUsage(text, model);
          setItems((prev) =>
            prev.map((it) =>
              it.id === id
                ? { ...it, text, role, model: usedModel ?? model, usage, status: "review" as const }
                : it
            )
          );
        } catch (err) {
          setItems((prev) =>
            prev.map((it) =>
              it.id === id
                ? { ...it, status: "failed" as const, error: err instanceof Error ? err.message : "Extraction failed" }
                : it
            )
          );
        }
      }
      setExtracting(false);
    },
    []
  );

  const updateCurrent = useCallback(
    (patch: Partial<RoleData>) => {
      setItems((prev) => {
        if (!prev[currentIdx]) return prev;
        const next = [...prev];
        next[currentIdx] = { ...next[currentIdx], role: { ...next[currentIdx].role, ...patch } };
        return next;
      });
    },
    [currentIdx]
  );

  const setCurrent = useCallback((idx: number) => setCurrentIdx(idx), []);

  const discardCurrent = useCallback(() => {
    setItems((prev) => prev.filter((_, i) => i !== currentIdx));
    setCurrentIdx((prev) => Math.max(0, prev - 1));
  }, [currentIdx]);

  const confirmCurrent = useCallback(
    async (saveFn: (r: RoleData) => Promise<unknown>) => {
      const item = items[currentIdx];
      if (!item || item.status !== "review") return false;
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, status: "saving" as const } : it)));
      try {
        await saveFn(item.role);
        setItems((prev) => prev.filter((it) => it.id !== item.id));
        setCurrentIdx((prev) => {
          const remaining = items.length - 1;
          if (prev >= remaining) return Math.max(0, remaining - 1);
          return prev;
        });
        return true;
      } catch (err) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? { ...it, status: "failed" as const, error: err instanceof Error ? err.message : "Save failed" }
              : it
          )
        );
        return false;
      }
    },
    [items, currentIdx]
  );

  const clear = useCallback(() => {
    setItems([]);
    setCurrentIdx(0);
    setExtracting(false);
  }, []);

  const current = items[currentIdx] ?? null;
  const hasPending = items.length > 0;
  const reviewCount = items.filter((i) => i.status === "review").length;

  return {
    items,
    current,
    currentIdx,
    setCurrent,
    extracting,
    hasPending,
    reviewCount,
    stage,
    updateCurrent,
    discardCurrent,
    confirmCurrent,
    clear,
  };
}
