"use client";

/* eslint-disable react-hooks/set-state-in-effect -- phase timing state is derived from phase transitions */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowClockwise, ArrowSquareOut, CaretDown, Check, CircleNotch, Clock, CloudArrowUp, Eye, Gear, Pause, Play, RocketLaunch, SlidersHorizontal, Sparkle, Target, Trash, Users, WarningCircle } from "@phosphor-icons/react";
import { getIdToken } from "@/lib/auth";
import Modal, { ModalCloseButton } from "@/components/ui/Modal";
import CandidatesTable from "@/components/candidates/CandidatesTable";
import RoleDetailsModal from "@/components/roles/RoleDetailsModal";
import EditCandidateDrawer from "@/components/candidates/EditCandidateDrawer";
import { createCandidate } from "@/lib/client-api";
import { parseProfileWithUsage } from "@/lib/hunt/parse-profile";
import type { TokenUsage } from "@/lib/openrouter";
import { DuplicateManager, normalizeCandidateUrl } from "@/lib/hunt/duplicate-manager";
import type {
  BrowserTab,
  BrowserTabsResult,
  CandidateProfileResult,
  ScrapedCandidate,
} from "@/lib/hunt/automation";
import type { CandidateRow, Candidate } from "@/lib/candidate-schema";
import type { RoleRow } from "@/lib/role-schema";
import type { MatchResult } from "@/lib/match-schema";

const SAVED_KEY = "hunt.savedCandidates";
type SavedCandidate = CandidateProfileResult & { savedAt: string };

// Parsed candidate profiles + match results (localStorage only — not yet written to the DB).
const PARSED_KEY = "hunt.parsedCandidates";
const MATCHES_KEY = "hunt.matches";

const SELECTED_ROLE_KEY = "hunt.selectedRoleId";

const LIMIT_CANDIDATES_KEY = "hunt.maxCandidates";
const LIMIT_PAGES_KEY = "hunt.maxPages";
const HEADLESS_KEY = "hunt.headless";
const DEFAULT_MAX_CANDIDATES = 25;
const DEFAULT_MAX_PAGES = 5;
// Slider bounds — hitting the upper bound means "unlimited" (ellipsis / ∞)
const CANDIDATES_MAX = 100;
const PAGES_MAX = 20;
const CANDIDATES_UNLIMITED = CANDIDATES_MAX;
const PAGES_UNLIMITED = PAGES_MAX;
const BACKEND_MAX_CANDIDATES = 500;
const BACKEND_MAX_PAGES = 50;

const loadParsed = (): CandidateRow[] => {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(PARSED_KEY) || "[]");
  } catch {
    return [];
  }
};

type StoredMatch = MatchResult & { roleId: string; roleTitle: string };

const loadMatches = (): Record<string, StoredMatch> => {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(MATCHES_KEY) || "{}");
  } catch {
    return {};
  }
};

/** Fill color follows the rate bands: green 76+, yellow 51-75, orange 26-50, red below. */
function rateColorClass(score: number): string {
  if (score >= 76) return "bg-emerald-500";
  if (score >= 51) return "bg-yellow-400";
  if (score >= 26) return "bg-orange-400";
  return "bg-red-500";
}

/**
 * Revamped pipeline — explicit pagination as Step 3 per user proposal:
 *  1. opening      — STEP 1: open tab (focusBrowserTab)
 *  2. scraping     — STEP 2: scrap candidates (WHOLE page — get ALL URLs for that page)
 *  3. paginating   — STEP 3: scrap pagination (new) — move to next page when Step 2 done
 *     Loop 2→3 until limit reached (if 5 pages, scrap all 5 pages before parsing)
 *  4-6. extracting — STEPS 4-6: for each gathered link: open profile → scrape raw → close tab
 *  7. parsing      — STEP 7: batch AI parse of ALL raws (only after all pages gathered)
 *  8. matching     — STEP 8: batch match to role
 */
type Phase = "idle" | "opening" | "scraping" | "paginating" | "extracting" | "parsing" | "matching" | "returning" | "done";

export default function HuntAutomation() {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<BrowserTabsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The specific browser tab the user wants to harvest (URL). Defaults to the
  // first detected sourcing tab until the user picks one from the dropdown.
  const [selectedTabUrl, setSelectedTabUrl] = useState<string | null>(null);

  // The selected sourcing tab (derived from the matching source) + the run.
  const [gathering, setGathering] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const resumeResolverRef = useRef<(() => void) | null>(null);
  const waitIfPaused = useCallback(async () => {
    if (pausedRef.current) {
      await new Promise<void>((resolve) => {
        resumeResolverRef.current = resolve;
      });
    }
  }, []);
  const handlePause = useCallback(() => {
    pausedRef.current = true;
    setPaused(true);
  }, []);
  const handleResume = useCallback(() => {
    pausedRef.current = false;
    setPaused(false);
    if (resumeResolverRef.current) {
      resumeResolverRef.current();
      resumeResolverRef.current = null;
    }
  }, []);
  // Reset pause when run finishes or is idle
  useEffect(() => {
    if (!gathering && paused) {
      pausedRef.current = false;
      setPaused(false);
      if (resumeResolverRef.current) {
        resumeResolverRef.current();
        resumeResolverRef.current = null;
      }
    }
  }, [gathering, paused]);

  type UsageAggregate = TokenUsage & { calls: number };
  const emptyAgg = (): UsageAggregate => ({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    calls: 0,
  });
  const addToAgg = (prev: UsageAggregate, next: TokenUsage): UsageAggregate => ({
    promptTokens: prev.promptTokens + (next.promptTokens ?? 0),
    completionTokens: prev.completionTokens + (next.completionTokens ?? 0),
    totalTokens: prev.totalTokens + (next.totalTokens ?? 0),
    calls: prev.calls + 1,
    model: next.model ?? prev.model,
    cost:
      prev.cost != null || next.cost != null
        ? (prev.cost ?? 0) + (next.cost ?? 0)
        : undefined,
  });

  // Timing per node + total automation time
  const [timings, setTimings] = useState<Partial<Record<Phase, { start: number; end?: number; durationMs?: number }>>>({});
  const [runStart, setRunStart] = useState<number | null>(null);
  const prevPhaseRef = useRef<Phase>("idle");
  // eslint-disable-next-line react-hooks/purity -- live tick for running timer
  const [nowTick, setNowTick] = useState<number>(Date.now());
  // Token usage per AI node — aggregate input/output/total + call count
  const [parseUsage, setParseUsage] = useState<UsageAggregate>(() => emptyAgg());
  const [matchUsage, setMatchUsage] = useState<UsageAggregate>(() => emptyAgg());
  // Duplicate tracking — how many profile URLs were filtered as duplicates across pages/runs
  const [duplicateStats, setDuplicateStats] = useState<{ filtered: number; unique: number }>({ filtered: 0, unique: 0 });
  const duplicateManagerRef = useRef<DuplicateManager | null>(null);
  // Live tick for running phase timer
  useEffect(() => {
    if (!gathering) return;
    const id = setInterval(() => setNowTick(Date.now()), 500);
    return () => clearInterval(id);
  }, [gathering]);

  // Keep top progress bar pinned above navigation when automation runs
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (gathering) {
      document.body.style.paddingTop = "32px";
      document.documentElement.style.setProperty("--hunt-running", "1");
    } else {
      document.body.style.paddingTop = "";
      document.documentElement.style.removeProperty("--hunt-running");
    }
    return () => {
      document.body.style.paddingTop = "";
      document.documentElement.style.removeProperty("--hunt-running");
    };
  }, [gathering]);

  const formatDuration = (ms?: number) => {
    if (ms == null || !Number.isFinite(ms)) return "—";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    const rs = (s % 60).toFixed(0);
    return `${m}m ${rs}s`;
  };

  const formatTokens = (n: number) => {
    if (!Number.isFinite(n) || n === 0) return "0";
    if (n < 1000) return `${n}`;
    if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
    if (n < 1000000) return `${Math.round(n / 1000)}k`;
    return `${(n / 1000000).toFixed(1)}M`;
  };

  // Track phase transitions -> per-node timing + reset token aggregates on new run/idle
  useEffect(() => {
    const prev = prevPhaseRef.current;
    const now = Date.now();
    if (phase === "idle") {
      setTimings({});
      setRunStart(null);
      setParseUsage(emptyAgg());
      setMatchUsage(emptyAgg());
      setDuplicateStats({ filtered: 0, unique: 0 });
      duplicateManagerRef.current = null;
      prevPhaseRef.current = phase;
      return;
    }
    // Starting a run
    if (prev === "idle" && phase !== "done") {
      setRunStart(now);
      setTimings({ [phase]: { start: now } });
      prevPhaseRef.current = phase;
      return;
    }
    // Phase changed
    if (prev !== phase) {
      setTimings((prevTimings) => {
        const next = { ...prevTimings };
        // Close previous
        if (prev !== "idle" && prev !== "done" && next[prev] && !next[prev]?.end) {
          const start = next[prev]!.start;
          next[prev] = { start, end: now, durationMs: now - start };
        }
        // Open new (if not done)
        if (phase !== "done") {
          if (!next[phase] || next[phase]?.end) {
            next[phase] = { start: now };
          }
        } else if (phase === "done") {
          // Close whatever was running and also cap total
          for (const k of Object.keys(next) as Phase[]) {
            if (next[k] && !next[k]!.end) {
              const s = next[k]!.start;
              next[k] = { start: s, end: now, durationMs: now - s };
            }
          }
        }
        return next;
      });
      prevPhaseRef.current = phase;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- emptyAgg is stable per render and intentionally not a dep
  }, [phase]);

  const totalDurationMs = useMemo(() => {
    if (!runStart) return undefined;
    if (phase === "done") {
      const ends = Object.values(timings).map((t) => t?.end ?? 0);
      const maxEnd = Math.max(...ends, 0);
      if (maxEnd) return maxEnd - (runStart || maxEnd);
    }
    if (gathering) return nowTick - (runStart || nowTick);
    if (timings["done"]?.durationMs != null) return timings["done"]?.durationMs;
    // Fallback sum
    const sum = Object.values(timings).reduce((acc, t) => acc + (t?.durationMs ?? 0), 0);
    return sum || undefined;
  }, [timings, phase, gathering, nowTick, runStart]);

  // Automation limits — control how many candidates/pages to scrape.
  // Persisted so the recruiter's preference survives reload.
  // Hitting the slider's max (100 candidates / 20 pages) is treated as unlimited (∞ / …).
  const [maxCandidates, setMaxCandidates] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_MAX_CANDIDATES;
    try {
      const v = Number(localStorage.getItem(LIMIT_CANDIDATES_KEY));
      if (Number.isFinite(v) && v >= 5 && v <= CANDIDATES_MAX) return Math.round(v);
    } catch {}
    return DEFAULT_MAX_CANDIDATES;
  });
  const [maxPages, setMaxPages] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_MAX_PAGES;
    try {
      const v = Number(localStorage.getItem(LIMIT_PAGES_KEY));
      if (Number.isFinite(v) && v >= 1 && v <= PAGES_MAX) return Math.round(v);
    } catch {}
    return DEFAULT_MAX_PAGES;
  });
  useEffect(() => {
    try {
      localStorage.setItem(LIMIT_CANDIDATES_KEY, String(maxCandidates));
    } catch {}
  }, [maxCandidates]);
  useEffect(() => {
    try {
      localStorage.setItem(LIMIT_PAGES_KEY, String(maxPages));
    } catch {}
  }, [maxPages]);

  // Headless toggle — when true automation runs in an invisible browser on the user's machine (no windows opening).
  // Cookies are synced from the visible Chrome via CDP so LinkedIn auth is preserved.
  const [headless, setHeadless] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const v = localStorage.getItem(HEADLESS_KEY);
      if (v === "true") return true;
      if (v === "false") return false;
    } catch {}
    return true; // default ON as requested — no windows popping
  });
  useEffect(() => {
    try {
      localStorage.setItem(HEADLESS_KEY, String(headless));
    } catch {}
  }, [headless]);

  // Persisted scraped candidates (localStorage) + the view-saved modal.
  const [saved, setSaved] = useState<SavedCandidate[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const [showSaved, setShowSaved] = useState(false);
  const [viewing, setViewing] = useState<CandidateProfileResult | null>(null);
  const [clearOpen, setClearOpen] = useState(false);

  // "View Match" — opens the same RoleDetailsModal used in the Job Description tab.
  const [viewMatch, setViewMatch] = useState<{
    role: RoleRow;
    candidate: CandidateRow;
    match: MatchResult;
  } | null>(null);

  // Edit hunt candidate (local parsed, not yet in DB) — right slide cabinet
  const [editingHuntCandidate, setEditingHuntCandidate] = useState<CandidateRow | null>(null);

  // Multi-select of parsed candidates + saving them to the database.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const toggleRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };
  const toggleAll = (ids: string[]) => {
    setSelectedIds((prev) =>
      ids.length > 0 && ids.every((x) => prev.includes(x))
        ? prev.filter((x) => !ids.includes(x))
        : Array.from(new Set([...prev, ...ids]))
    );
  };

  const saveToDatabase = async () => {
    if (saving) return;
    const ids = selectedIds.length ? selectedIds : parsed.map((p) => p.id);
    if (ids.length === 0) return;
    setSaving(true);
    setSaveMsg(null);
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      const row = parsed.find((p) => p.id === id);
      if (!row) continue;
      try {
        const candidate = { ...row };
        delete (candidate as { id?: string }).id;
        await createCandidate(candidate as Candidate);
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setSaving(false);
    setSaveMsg(
      fail === 0
        ? `Saved ${ok} candidate${ok === 1 ? "" : "s"} to the database.`
        : `Saved ${ok}, failed ${fail}.`
    );
    if (fail === 0) setSelectedIds([]);
  };

  const clearLocalData = () => {
    try {
      localStorage.removeItem(PARSED_KEY);
      localStorage.removeItem(SAVED_KEY);
      localStorage.removeItem(MATCHES_KEY);
      localStorage.removeItem(SELECTED_ROLE_KEY);
    } catch {
      /* ignore */
    }
    setParsed([]);
    setSaved([]);
    setMatches({});
    setRoleId(null);
    setParseUsage(emptyAgg());
    setMatchUsage(emptyAgg());
    setDuplicateStats({ filtered: 0, unique: 0 });
    duplicateManagerRef.current = null;
    setPhase("idle");
    setClearOpen(false);
  };

  // Parsed candidate profiles (AI-converted, stored in localStorage only).
  const [parsed, setParsed] = useState<CandidateRow[]>(() => loadParsed());

  const addParsed = (row: CandidateRow) => {
    setParsed((prev) => {
      // Replace if the normalized id already exists (covers trailing slash / www / query variants)
      const key = normalizeCandidateUrl(row.id);
      const without = prev.filter((p) => normalizeCandidateUrl(p.id) !== key);
      const next = [...without, row];
      try {
        localStorage.setItem(PARSED_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable — keep in-memory copy */
      }
      return next;
    });
  };

  // Selected job description (role) for the Match step, plus the role list.
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [roleId, setRoleId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const saved = localStorage.getItem(SELECTED_ROLE_KEY);
      return saved || null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (roleId) localStorage.setItem(SELECTED_ROLE_KEY, roleId);
      else localStorage.removeItem(SELECTED_ROLE_KEY);
    } catch {}
  }, [roleId]);

  const loadRoles = async () => {
    if (rolesLoading) return;
    setRolesLoading(true);
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch("/api/roles", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        const fetched = (data.roles as RoleRow[]) ?? [];
        setRoles(fetched);
        // If saved roleId no longer exists, clear it
        if (roleId && !fetched.some((r) => r.id === roleId)) {
          setRoleId(null);
        }
      }
    } catch {
      /* non-blocking */
    } finally {
      setRolesLoading(false);
    }
  };

  // Per-candidate match results (localStorage only — not written to the DB).
  const [matches, setMatches] = useState<Record<string, StoredMatch>>(() => loadMatches());

  const addMatch = (
    candidateId: string,
    roleId: string,
    roleTitle: string,
    match: MatchResult
  ) => {
    setMatches((prev) => {
      const next = { ...prev, [candidateId]: { ...match, roleId, roleTitle } };
      try {
        localStorage.setItem(MATCHES_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };

  // Match scores for the currently selected role, keyed by candidate id.
  // Drives the progress bar shown in the Candidate column of the table.
  // Persisted matches + selected role — row now shows after reload (previously roleId was lost).
  const matchScores = useMemo(() => {
    const map: Record<string, number> = {};
    for (const [candidateId, m] of Object.entries(matches)) {
      if (roleId) {
        if (m.roleId === roleId) map[candidateId] = m.score;
      } else {
        // No role selected (e.g. fresh reload before role re-hydrates) — show stored match so row not empty
        map[candidateId] = m.score;
      }
    }
    return map;
  }, [matches, roleId]);

  const addSaved = (p: CandidateProfileResult) => {
    setSaved((prev) => {
      const key = normalizeCandidateUrl(p.url);
      if (prev.some((s) => normalizeCandidateUrl(s.url) === key)) return prev;
      // Also check duplicateManager for cross-page dedupe memory
      if (duplicateManagerRef.current?.has(p.url)) return prev;
      const next: SavedCandidate[] = [...prev, { ...p, savedAt: new Date().toISOString() }];
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable — keep in-memory copy */
      }
      return next;
    });
  };

  const clearSaved = () => {
    try {
      localStorage.removeItem(SAVED_KEY);
    } catch {
      /* ignore */
    }
    setSaved([]);
  };

  const scan = async () => {
    if (scanning) return;
    setScanning(true);
    setError(null);
    setResult(null);
    setPhase("idle");
    setProgress(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("You are signed out. Please sign in again.");
      const res = await fetch("/api/hunt", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to read browser tabs");
      setResult(data as BrowserTabsResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read browser tabs");
    } finally {
      setScanning(false);
    }
  };

  // Auto-scan the browser tabs + load job descriptions as soon as the
  // Hunt Automation tab is active.
  useEffect(() => {
    void scan();
    void loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * STEP 2 — Scrape all candidate names + pagination.
   * Server-side (lib/hunt/automation.ts:scrapeCandidates) scrolls the sourcing
   * tab, collects deduplicated profile URLs (sliced to maxCandidates PER PAGE),
   * clicks "Next" pagination controls and repeats up to maxPages (multiplier).
   * total = perPage * pages. The full list is returned before any profile
   * is opened (steps 3-5).
   */
  // STEP 2 — Scrap candidates (whole page) — explicit single-page scrape
  // Gets ALL candidate URLs for the current page only (no pagination).
  const doScrapePage = async (): Promise<ScrapedCandidate[]> => {
    if (!selectedUrl) {
      setScrapeError("Select a tab first.");
      return [];
    }
    setScrapeError(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("You are signed out. Please sign in again.");
      const effectiveMaxPerPage =
        maxCandidates >= CANDIDATES_UNLIMITED ? BACKEND_MAX_CANDIDATES : maxCandidates;
      const res = await fetch("/api/hunt", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          scrapePage: selectedUrl,
          maxPerPage: effectiveMaxPerPage,
          maxCandidates: effectiveMaxPerPage,
          headless,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to scrape candidates");
      return data.candidates as ScrapedCandidate[];
    } catch (err) {
      setScrapeError(err instanceof Error ? err.message : "Failed to scrape candidates");
      return [];
    }
  };

  // Headless combined scrape: all pages in ONE invisible browser session (no windows).
  // Cookies are synced from visible Chrome via CDP, headless does goto + scroll + Next loop internally.
  const doScrapeAllHeadless = async (): Promise<ScrapedCandidate[]> => {
    if (!selectedUrl) {
      setScrapeError("Select a tab first.");
      return [];
    }
    setScrapeError(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("You are signed out. Please sign in again.");
      const effectiveMaxPages = maxPages >= PAGES_UNLIMITED ? BACKEND_MAX_PAGES : maxPages;
      const effectiveMaxPerPage =
        maxCandidates >= CANDIDATES_UNLIMITED ? BACKEND_MAX_CANDIDATES : maxCandidates;
      const res = await fetch("/api/hunt", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          scrape: selectedUrl,
          maxPages: effectiveMaxPages,
          maxCandidates: effectiveMaxPerPage,
          headless: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to scrape candidates");
      if (typeof data.duplicatesFiltered === "number" || typeof data.debug?.duplicatesFiltered === "number") {
        const filtered = data.duplicatesFiltered ?? data.debug?.duplicatesFiltered ?? 0;
        const unique = data.uniqueCount ?? data.debug?.uniqueCount ?? data.count ?? 0;
        setDuplicateStats({ filtered, unique });
      }
      return data.candidates as ScrapedCandidate[];
    } catch (err) {
      setScrapeError(err instanceof Error ? err.message : "Failed to scrape candidates (headless)");
      return [];
    }
  };

  // STEP 3 — Scrap pagination (new) — move to next page when Step 2 is done
  // In headless combined mode pagination is handled inside scrapeCandidatesHeadless, so this is no-op.
  const doNextPage = async (): Promise<boolean> => {
    if (headless) return false;
    if (!selectedUrl) return false;
    try {
      const token = await getIdToken();
      if (!token) return false;
      const res = await fetch("/api/hunt", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ nextPage: selectedUrl }),
      });
      const data = await res.json();
      if (!res.ok) return false;
      return !!data.moved;
    } catch {
      return false;
    }
  };

  /**
   * STEPS 3-5 — Open each candidate's profile → Scrape them → Close it.
   * Strict per-candidate lifecycle enforced server-side:
   *   extractCandidateProfile (automation.ts) creates a dedicated background tab,
   *   navigates, scrolls, extracts raw, then GUARANTEES close() before next
   *   candidate. This loop simply iterates the candidate list sequentially,
   *   persisting each raw profile to localStorage (SavedCandidate) so progress
   *   survives refresh and STEP 6 can batch-parse afterwards.
   */
  const gatherRaw = async (list: ScrapedCandidate[]): Promise<CandidateProfileResult[]> => {
    const out: CandidateProfileResult[] = [];
    let remaining = [...list];
    try {
      while (remaining.length > 0) {
        await waitIfPaused();
        const c = remaining[0];
        try {
          const token = await getIdToken();
          if (!token) throw new Error("You are signed out. Please sign in again.");
          const res = await fetch("/api/hunt", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ extract: c.url, headless }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error ?? "Failed to extract profile");
          const profile = data as CandidateProfileResult;
          addSaved(profile);
          out.push(profile);
        } catch {
          /* skip unreadable candidate and keep moving — guarantees close() already ran server-side */
        }
        remaining = remaining.slice(1);
        setProgress({ done: list.length - remaining.length, total: list.length });
      }
    } finally {
      /* progress cleared by caller */
    }
    return out;
  };

  /**
   * STEP 6 — Parse all scraped profiles using AI (batch, after ALL raws collected).
   * Isolated from browser automation so CDP is not held during LLM calls.
   * Each raw is sent to the AI fleet (lib/hunt/parse-profile → extractCandidateFromText)
   * with fallback minimal row on model failure; results persisted to localStorage.
   */
  const parseAll = async (profiles: CandidateProfileResult[]): Promise<CandidateRow[]> => {
    const rows: CandidateRow[] = [];
    let remaining = [...profiles];
    try {
      while (remaining.length > 0) {
        await waitIfPaused();
        const p = remaining[0];
        const { row, usage } = await parseProfileWithUsage(p.raw, p.url, p.name);
        if (usage) setParseUsage((prev) => addToAgg(prev, usage));
        addParsed(row);
        rows.push(row);
        remaining = remaining.slice(1);
        setProgress({ done: profiles.length - remaining.length, total: profiles.length });
      }
    } finally {
      /* progress cleared by caller */
    }
    return rows;
  };

  /** Score one parsed candidate against the selected job description. Returns match + token usage. */
  const matchHuntCandidate = async (
    candidate: CandidateRow,
    roleId: string
  ): Promise<{ match: MatchResult; usage?: TokenUsage } | null> => {
    try {
      const token = await getIdToken();
      if (!token) throw new Error("signed out");
      const res = await fetch("/api/hunt", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ match: { candidate, roleId } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Match failed");
      return { match: data.match as MatchResult, usage: data.usage as TokenUsage | undefined };
    } catch {
      return null;
    }
  };

  /**
   * STEP 7 — Match every parsed candidate to the chosen job description.
   * Runs batch AFTER STEP 6 completes; each candidate is scored via
   * matchCandidateToRole (strict Tech Recruiter instructions) and persisted to
   * localStorage matches. No DB write until user explicitly "Save to Database".
   */
  const matchAll = async (rows: CandidateRow[], role: RoleRow | null) => {
    if (!role) return;
    let remaining = [...rows];
    try {
      while (remaining.length > 0) {
        await waitIfPaused();
        const row = remaining[0];
        const result = await matchHuntCandidate(row, role.id);
        if (result?.match) {
          const { match, usage } = result;
          if (usage) setMatchUsage((prev) => addToAgg(prev, usage));
          addMatch(row.id, role.id, role.jobTitle, match);
          // Surface the match inside the candidate's reasoning for the table.
          const scoreLine = `Match (${role.jobTitle}): ${match.score}/100 — ${match.reasoning}`;
          const merged: CandidateRow = {
            ...row,
            reasoning: [row.reasoning, scoreLine].filter(Boolean).join("\n"),
          };
          addParsed(merged);
        }
        remaining = remaining.slice(1);
        setProgress({ done: rows.length - remaining.length, total: rows.length });
      }
    } finally {
      /* progress cleared by caller */
    }
  };

  // ── Standalone single-node runners ──
  // These let the user run a specific pipeline node on already-collected data
  // without re-running the full 8-step hunt. Useful when scraping is stuck but
  // parsed data already exists, or to re-match against a different JD.
  const [standaloneError, setStandaloneError] = useState<string | null>(null);

  // Unmatched for selected role: no stored match, or stored match is for a different role
  const unmatchedCandidates = useMemo(() => {
    if (parsed.length === 0) return [];
    return parsed.filter((p) => {
      const m = matches[p.id];
      if (!m) return true;
      if (!roleId) return false; // when no role selected, only truly un-matched count as unmatched
      return m.roleId !== roleId;
    });
  }, [parsed, matches, roleId]);

  const runMatchAllStandalone = async () => {
    if (gathering) return;
    setStandaloneError(null);
    if (parsed.length === 0) {
      setStandaloneError("No parsed candidates yet. Run parsing first or check local data.");
      return;
    }
    const role = roles.find((r) => r.id === roleId) ?? null;
    if (!role) {
      setStandaloneError("Select a job description first.");
      return;
    }
    setGathering(true);
    setPhase("matching");
    setProgress({ done: 0, total: parsed.length });
    setScrapeError(null);
    try {
      await matchAll(parsed, role);
      setPhase("done");
    } catch (err) {
      setStandaloneError(err instanceof Error ? err.message : "Match failed");
      setPhase("idle");
    } finally {
      setGathering(false);
      setProgress(null);
    }
  };

  const runMatchUnmatchedStandalone = async () => {
    if (gathering) return;
    setStandaloneError(null);
    if (parsed.length === 0) {
      setStandaloneError("No parsed candidates yet. Run parsing first or check local data.");
      return;
    }
    const role = roles.find((r) => r.id === roleId) ?? null;
    if (!role) {
      setStandaloneError("Select a job description first.");
      return;
    }
    const targets = unmatchedCandidates;
    if (targets.length === 0) {
      setStandaloneError("All candidates already matched for this role — nothing unmatched to run.");
      return;
    }
    setGathering(true);
    setPhase("matching");
    setProgress({ done: 0, total: targets.length });
    setScrapeError(null);
    try {
      await matchAll(targets, role);
      setPhase("done");
      setStandaloneError(`Matched ${targets.length} unmatched candidate${targets.length === 1 ? "" : "s"} — ${parsed.length - targets.length} already matched skipped.`);
    } catch (err) {
      setStandaloneError(err instanceof Error ? err.message : "Match failed");
      setPhase("idle");
    } finally {
      setGathering(false);
      setProgress(null);
    }
  };

  const runParseAllStandalone = async () => {
    if (gathering) return;
    setStandaloneError(null);
    if (saved.length === 0) {
      setStandaloneError("No saved (raw) profiles yet. Scrape candidates first.");
      return;
    }
    // Only parse those not yet in parsed
    const existingIds = new Set(parsed.map((p) => normalizeCandidateUrl(p.id)));
    const toParse = saved.filter((s) => !existingIds.has(normalizeCandidateUrl(s.url)));
    const targets = toParse.length > 0 ? toParse : saved;
    if (targets.length === 0) {
      setStandaloneError("All saved profiles already parsed.");
      return;
    }
    setGathering(true);
    setPhase("parsing");
    setProgress({ done: 0, total: targets.length });
    setScrapeError(null);
    try {
      const rows = await parseAll(targets);
      // Optionally auto-match after parse if a role is selected
      setPhase("done");
      setStandaloneError(`Parsed ${rows.length} profiles. ${roleId ? "Run Match All to score them." : "Select a job description then run Match All."}`);
    } catch (err) {
      setStandaloneError(err instanceof Error ? err.message : "Parse failed");
      setPhase("idle");
    } finally {
      setGathering(false);
      setProgress(null);
    }
  };

  const runScrapeOnlyStandalone = async () => {
    if (gathering || !selectedUrl) {
      if (!selectedUrl) setStandaloneError("Select a tab first.");
      return;
    }
    setStandaloneError(null);
    setScrapeError(null);
    setGathering(true);
    setPhase("scraping");
    setProgress(null);
    const manager = new DuplicateManager([
      ...parsed.map((p) => normalizeCandidateUrl(p.id)),
      ...saved.map((s) => normalizeCandidateUrl(s.url)),
    ]);
    try {
      const effectiveMaxPages = maxPages >= PAGES_UNLIMITED ? BACKEND_MAX_PAGES : maxPages;
      const effectiveMaxPerPage = maxCandidates >= CANDIDATES_UNLIMITED ? BACKEND_MAX_CANDIDATES : maxCandidates;
      let candidates: ScrapedCandidate[] = [];
      if (headless) {
        candidates = await doScrapeAllHeadless();
      } else {
        // Non-headless single scrape loop (re-use gather logic but stop before extracting)
        const all: ScrapedCandidate[] = [];
        for (let pageIdx = 0; pageIdx < effectiveMaxPages; pageIdx++) {
          await waitIfPaused();
          setPhase(pageIdx === 0 ? "scraping" : "paginating");
          if (pageIdx > 0) {
            const moved = await doNextPage();
            if (!moved) break;
          }
          const perPage = await doScrapePage();
          const { unique } = manager.filter(perPage);
          all.push(...unique);
          if (!Number.isFinite(effectiveMaxPerPage * effectiveMaxPages) || all.length >= effectiveMaxPerPage * effectiveMaxPages) break;
        }
        candidates = all;
      }
      if (candidates.length === 0) {
        setStandaloneError("Scrape returned 0 candidates. Check if the sourcing tab has results or try Visible mode.");
        setPhase("idle");
        return;
      }
      setStandaloneError(`Scraped ${candidates.length} candidates (headless=${headless}). Next: Extract profiles or run full hunt.`);
      setPhase("done");
      // Store scraped list temporarily in console for debugging — user can then run full hunt to extract
      console.log("[standalone scrape] candidates:", candidates);
    } catch (err) {
      setStandaloneError(err instanceof Error ? err.message : "Scrape failed");
      setPhase("idle");
    } finally {
      setGathering(false);
      setProgress(null);
    }
  };

  /**
   * STEP 1 — Open tab (bring sourcing tab to foreground).
   * Isolated so scraping starts on a visible, focused tab — required for
   * reliable pagination clicks and lazy-load scroll in STEP 2.
   */
  const openTab = async (url: string) => {
    if (headless) return; // headless does goto internally, no visible tab needed
    try {
      const token = await getIdToken();
      if (!token) throw new Error("You are signed out. Please sign in again.");
      const res = await fetch("/api/hunt", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ open: url, headless }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to open tab");
    } catch {
      /* non-blocking — scrape still attempts, focus is best-effort */
    }
  };

  /**
   * Post-STEP 7 — Return to the original scrap candidate page.
   * After matching, the sourcing tab is left on the last pagination page.
   * This navigates it back to the initial search/project URL so the recruiter
   * lands back on the list. Respects pages slider: if 3 pages were scraped,
   * we still return to page 1. Non-blocking — failures are ignored.
   */
  const returnToScrape = async (url: string) => {
    if (headless) return; // nothing visible to return to in headless
    try {
      const token = await getIdToken();
      if (!token) return;
      await fetch("/api/hunt", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ returnToScrape: url, headless }),
      });
    } catch {
      /* non-blocking — done state already reached */
    }
  };

  /**
   * Orchestrator for the revamped 7-step pipeline:
   *  1. open tab          → focusBrowserTab
   *  2. scrape + paginate → scrapeCandidates (deduplicated full list)
   *  3-5. open/scrape/close per candidate → gatherRaw loop (strict lifecycle)
   *  6. parse with AI     → parseAll (batch after all raws collected)
   *  7. match candidate   → matchAll (batch after parsing)
   */
  const gatherCandidates = async () => {
    if (gathering || !selectedUrl) return;
    setGathering(true);
    setScrapeError(null);
    setProgress(null);
    setParseUsage(emptyAgg());
    setMatchUsage(emptyAgg());
    setDuplicateStats({ filtered: 0, unique: 0 });
    // Seed manager with already-known candidates (cross-run dedupe: prevents re-scraping same profiles)
    const manager = new DuplicateManager([
      ...parsed.map((p) => normalizeCandidateUrl(p.id)),
      ...saved.map((s) => normalizeCandidateUrl(s.url)),
    ]);
    duplicateManagerRef.current = manager;
    let totalDuplicates = 0;
    try {
      // STEP 1 — Open tab (headless skips this — goto happens inside invisible browser)
      setPhase("opening");
      await openTab(selectedUrl);

      const effectiveMaxPages = maxPages >= PAGES_UNLIMITED ? BACKEND_MAX_PAGES : maxPages;
      const effectiveMaxPerPage =
        maxCandidates >= CANDIDATES_UNLIMITED ? BACKEND_MAX_CANDIDATES : maxCandidates;
      const isUnlimitedTotal = maxCandidates >= CANDIDATES_UNLIMITED || maxPages >= PAGES_UNLIMITED;
      const totalLimit = isUnlimitedTotal ? Infinity : effectiveMaxPerPage * effectiveMaxPages;

      let cappedList: ScrapedCandidate[] = [];

      if (headless) {
        // Headless invisible mode: all pages scraped in ONE headless session (cookie-synced via CDP).
        // No windows/tabs appear in the user's browser — runs on user's machine but invisible.
        await waitIfPaused();
        setPhase("scraping");
        setProgress({ done: 0, total: Number.isFinite(totalLimit) ? totalLimit : effectiveMaxPerPage });
        const combined = await doScrapeAllHeadless();
        if (combined.length === 0) {
          setPhase("idle");
          return;
        }
        // Cross-run dedup (already partly handled server-side, but also filter against local parsed/saved)
        const { unique, duplicateCount } = manager.filter(combined);
        totalDuplicates += duplicateCount;
        setDuplicateStats({ filtered: totalDuplicates, unique: unique.length });
        const allCandidates = unique as ScrapedCandidate[];
        if (allCandidates.length === 0) {
          setPhase("idle");
          setScrapeError("All scraped candidates were duplicates of already-saved profiles.");
          return;
        }
        cappedList = Number.isFinite(totalLimit) ? allCandidates.slice(0, totalLimit) : allCandidates.slice(0, 500);
      } else {
        // Non-headless (visible) — Explicit per-page loop per user proposal:
        // 1) get ALL candidate URLs for the whole page (Step 2)
        // 2) move to next page and do Step 1 (Step 3 — new)
        // 3) loop until limit is reached (perPage * pages)
        const allCandidates: ScrapedCandidate[] = [];
        let pagesScraped = 0;
        for (let pageIdx = 0; pageIdx < effectiveMaxPages; pageIdx++) {
          await waitIfPaused();
          // STEP 2 — Scrap candidates (whole page)
          setPhase("scraping");
          setProgress({ done: allCandidates.length, total: Number.isFinite(totalLimit) ? totalLimit : allCandidates.length + effectiveMaxPerPage });
          const perPageCandidates = await doScrapePage();
          pagesScraped++;
          // Dedup via DuplicateManager (normalized host+path, cross-page + cross-run)
          const { unique, duplicateCount } = manager.filter(perPageCandidates);
          totalDuplicates += duplicateCount;
          allCandidates.push(...unique);
          setDuplicateStats({ filtered: totalDuplicates, unique: allCandidates.length });
          // Even if page empty, still try pagination (don't abort on sparse pages)
          // Check limit reached — Step 3 loop condition
          if (Number.isFinite(totalLimit) && allCandidates.length >= totalLimit) {
            break;
          }
          if (pageIdx >= effectiveMaxPages - 1) break;
          // STEP 3 — Scrap pagination (new) — move to next page when Step 2 is done
          setPhase("paginating");
          setProgress({ done: pagesScraped, total: effectiveMaxPages });
          const moved = await doNextPage();
          if (!moved) break;
        }
        if (allCandidates.length === 0) {
          setPhase("idle");
          return;
        }
        // Final safety cap (backend hard limit 500 already, but enforce total)
        cappedList = Number.isFinite(totalLimit) ? allCandidates.slice(0, totalLimit) : allCandidates.slice(0, 500);
      }

      // STEPS 3-5 — Open each profile → scrape → close (sequential, guaranteed close)
      await waitIfPaused();
      setPhase("extracting");
      const profiles = await gatherRaw(cappedList);

      // STEP 6 — Parse all scraped profiles with AI (batch)
      await waitIfPaused();
      setPhase("parsing");
      const rows = await parseAll(profiles);

      // STEP 7 — Match candidates to selected role
      await waitIfPaused();
      setPhase("matching");
      const role = roles.find((r) => r.id === roleId) ?? null;
      await matchAll(rows, role);

      // Automation bulk (2+) → direct to DB, no confirmation drawer (per user: only automation skips confirmation for bulk)
      if (rows.length >= 2) {
        setPhase("returning");
        // Auto-save bulk to database in background (non-blocking for phase, but await to surface saveMsg)
        let ok = 0;
        let fail = 0;
        for (const row of rows) {
          try {
            const candidate = { ...row };
            delete (candidate as { id?: string }).id;
            await createCandidate(candidate as Candidate);
            ok++;
          } catch {
            fail++;
          }
        }
        setSaveMsg(fail === 0 ? `Auto-saved ${ok} candidates to database (bulk automation).` : `Auto-saved ${ok}, failed ${fail} (bulk).`);
      }

      // Post-7 — Return to scrap candidate page (based on pages slider)
      // After matching, navigate the sourcing tab back to its original search
      // URL so pagination respects the configured maxPages and the recruiter
      // isn't left on the last page.
      setPhase("returning");
      await returnToScrape(selectedUrl);

      setPhase("done");
    } finally {
      setGathering(false);
    }
  };

  // The tab we actually harvest. The user picks the exact tab (e.g. the Talent
  // "Solution" tab) from the dropdown. LinkedIn rewrites its URL constantly
  // (tracking params/hash), so we match tolerantly on host+pathname, not the
  // raw string. When nothing is explicitly chosen we prefer a LinkedIn tab over
  // JobStreet, and never silently fall back to tabs[0].
  const target = useMemo<BrowserTab | null>(() => {
    if (!result || result.tabs.length === 0) return null;

    const norm = (u: string) => {
      try {
        const x = new URL(u);
        return x.host.replace(/^www\./, "") + x.pathname.replace(/\/$/, "");
      } catch {
        return u;
      }
    };

    if (selectedTabUrl) {
      const exact = result.tabs.find((t) => t.url === selectedTabUrl);
      if (exact) return exact;
      const want = norm(selectedTabUrl);
      const near = result.tabs.find((t) => norm(t.url) === want);
      if (near) return near;
    }

    const linkedin = result.tabs.find((t) => /linkedin\.com/i.test(t.url));
    if (linkedin) return linkedin;
    return result.tabs[0] ?? null;
  }, [result, selectedTabUrl]);

  const selectedUrl = target?.url ?? null;

  // Custom dropdown open state.
  const [menuOpen, setMenuOpen] = useState(false);
  const [gearOpen, setGearOpen] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);

  return (
    <div className="w-full">
      {/* Global running bar — fixed above navigation, green, with progress */}
      {gathering &&
        typeof document !== "undefined" &&
        createPortal(
          <div className={`fixed inset-x-0 top-0 z-[100] flex flex-col shadow-md ${paused ? "opacity-95" : ""}`}>
            <div className={`flex items-center justify-between px-4 py-2 text-xs font-semibold text-white ${paused ? "bg-amber-600" : "bg-emerald-600"}`}>
              <span className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full bg-white ${paused ? "" : "animate-pulse"}`} />
                {paused ? "Paused at " : "Running Automation: "}
                {phase === "opening"
                  ? "Opening tab"
                  : phase === "scraping"
                    ? "Scraping candidates"
                    : phase === "paginating"
                      ? "Paginating"
                      : phase === "extracting"
                        ? "Extracting profiles"
                        : phase === "parsing"
                          ? "Parsing with AI"
                          : phase === "matching"
                            ? "Matching"
                            : phase === "returning"
                              ? "Returning"
                              : phase === "done"
                                ? "Done"
                                : "Running"}
                {paused ? " — click Resume to continue" : progress ? ` — ${progress.done} / ${progress.total}` : ""}
                {!paused && totalDurationMs != null ? ` · ${formatDuration(totalDurationMs)}` : ""}
              </span>
              <span className="hidden items-center gap-1.5 text-white/80 sm:flex">
                <Clock size={12} weight="fill" />
                {paused ? "Paused" : phase}
              </span>
            </div>
            <div className={`h-1.5 w-full ${paused ? "bg-amber-700/20" : "bg-emerald-700/20"}`}>
              <div
                className={`h-full transition-all duration-300 ${paused ? "bg-amber-400" : "bg-emerald-400"} ${!progress && !paused ? "animate-pulse" : ""}`}
                style={{
                  width: progress && progress.total > 0 ? `${Math.min(100, Math.max(4, (progress.done / progress.total) * 100))}%` : gathering ? "38%" : "0%",
                }}
              />
            </div>
          </div>,
          document.body
        )}
      {/* Section header */}
      <div className="mb-6">
        <div className="mb-1 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-gray-600 to-gray-900 text-white shadow-md">
            <Target size={18} weight="fill" />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-gray-900">Hunt Automation</h2>
        </div>
        <p className="text-sm text-gray-500">
          Scan the open tabs in your browser to power automated sourcing.
        </p>
      </div>

      {/* Scan control */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {/* Custom automation dropdown: source picker + Gather + View Saved */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm outline-none transition-colors hover:bg-gray-50 focus:ring-2 focus:ring-gray-900/10"
          >
            {target ? (target.title?.trim() || new URL(target.url).hostname) : "Select a tab"}
            <CaretDown size={14} className="text-gray-400" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute left-0 z-20 mt-2 w-64 overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
                <p className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Select a tab to harvest
                </p>
                {result && result.tabs.length > 0 ? (
                  result.tabs.map((t) => {
                    const isSelected = target?.url === t.url;
                    return (
                      <div
                        key={t.url}
                        className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-gray-50"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTabUrl(t.url);
                            setMenuOpen(false);
                          }}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-gray-700"
                        >
                          <span className="truncate">
                            {t.title?.trim() || new URL(t.url).hostname}
                          </span>
                          {isSelected && <Check size={15} weight="bold" />}
                        </button>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            title="Open tab"
                            onClick={() => {
                              setSelectedTabUrl(t.url);
                              void openTab(t.url);
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                          >
                            <ArrowSquareOut size={15} />
                          </button>
                          <button
                            type="button"
                            title="View saved"
                            onClick={() => {
                              setMenuOpen(false);
                              setShowSaved(true);
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                          >
                            <Eye size={15} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="px-2.5 py-2 text-sm text-gray-400">
                    No LinkedIn or JobStreet tabs open in your browser.
                  </p>
                )}
                <div className="my-1.5 h-px bg-gray-100" />
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void gatherCandidates();
                  }}
                  disabled={gathering || !target}
                  className="flex w-full items-center gap-2 rounded-lg bg-gradient-to-b from-gray-700 to-gray-900 px-2.5 py-2 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {gathering ? (
                    <>
                      <CircleNotch size={15} className="animate-spin" />
                      Gathering…
                    </>
                  ) : (
                    "Gather Candidates"
                  )}
                </button>
              </div>
            </>
          )}
        </div>
        <button
          onClick={() => void scan()}
          disabled={scanning}
          title={scanning ? "Scanning browser tabs…" : "Refresh browser tabs"}
          aria-label="Refresh browser tabs"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowClockwise size={18} weight="bold" className={scanning ? "animate-spin" : ""} />
        </button>
        {/* Gear settings — single-node runners dropdown (monochromatic) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setGearOpen((o) => !o)}
            title="Settings — single node runners"
            aria-label="Settings"
            aria-expanded={gearOpen}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          >
            <Gear size={18} weight={gearOpen ? "fill" : "regular"} />
          </button>
          {gearOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setGearOpen(false)} />
              <div className="absolute left-0 z-20 mt-2 w-72 overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
                <p className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Single Node Runners
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setGearOpen(false);
                    void runScrapeOnlyStandalone();
                  }}
                  disabled={gathering || !target}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Users size={15} className="shrink-0 text-gray-500" />
                  <span className="flex-1">Scrape Only</span>
                  {!target && <span className="text-xs text-gray-400">no tab</span>}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGearOpen(false);
                    void runParseAllStandalone();
                  }}
                  disabled={gathering || saved.length === 0}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sparkle size={15} weight="fill" className="shrink-0 text-gray-500" />
                  <span className="flex-1">Parse All Saved</span>
                  <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-gray-200 ring-inset">{saved.length}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGearOpen(false);
                    void runMatchAllStandalone();
                  }}
                  disabled={gathering || parsed.length === 0 || !roleId}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Check size={15} weight="bold" className="shrink-0 text-gray-700" />
                  <span className="flex-1">Match All Candidates</span>
                  <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-gray-200 ring-inset">{parsed.length}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGearOpen(false);
                    void runMatchUnmatchedStandalone();
                  }}
                  disabled={gathering || parsed.length === 0 || !roleId || unmatchedCandidates.length === 0}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sparkle size={15} weight="fill" className="shrink-0 text-gray-500" />
                  <span className="flex-1">Match All Unmatched</span>
                  <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-gray-200 ring-inset">{unmatchedCandidates.length}</span>
                </button>
                <div className="my-1.5 h-px bg-gray-100" />
                <button
                  type="button"
                  onClick={() => setHeadless((v) => !v)}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-gray-50"
                >
                  <span className="flex items-center gap-2 text-sm text-gray-700">
                    <span className={`relative inline-flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${headless ? "bg-gray-900" : "bg-gray-200"}`}>
                      <span className={`h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${headless ? "translate-x-3" : "translate-x-0"}`} />
                    </span>
                    Headless
                  </span>
                  <span className="text-xs font-medium text-gray-500">{headless ? "ON" : "OFF"}</span>
                </button>
              </div>
            </>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {gathering && (
            <button
              type="button"
              onClick={paused ? handleResume : handlePause}
              title={paused ? "Resume automation" : "Pause automation"}
              className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            >
              {paused ? <Play size={16} weight="fill" /> : <Pause size={16} weight="fill" />}
              {paused ? "Resume" : "Pause"}
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => setLimitOpen((o) => !o)}
              title="Limits — candidates per page & pages"
              aria-label="Limits"
              aria-expanded={limitOpen}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            >
              <SlidersHorizontal size={18} weight={limitOpen ? "fill" : "regular"} />
            </button>
            {limitOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setLimitOpen(false)} />
                <div className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
                  <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Limits</p>
                  <HuntLimits
                    maxCandidates={maxCandidates}
                    maxPages={maxPages}
                    onCandidatesChange={setMaxCandidates}
                    onPagesChange={setMaxPages}
                    disabled={gathering}
                  />
                  <div className="my-3 h-px bg-gray-100" />
                  <button
                    type="button"
                    onClick={() => {
                      setLimitOpen(false);
                      setClearOpen(true);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
                  >
                    <Trash size={15} />
                    Clear cache
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => void gatherCandidates()}
            disabled={gathering || !target}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-b from-gray-700 to-gray-900 px-5 py-2 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {gathering ? (
              <>
                <CircleNotch size={16} className={`animate-spin ${paused ? "opacity-30" : ""}`} />
                {paused ? "Paused" : "Running…"}
              </>
            ) : (
              <>
                <RocketLaunch size={16} weight="fill" />
                Run AI Hunt Automation
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs font-medium text-red-600 ring-1 ring-red-100 ring-inset">
          <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {(parsed.length > 0 || saved.length > 0 || (result && result.tabs.length > 0)) && (
        <>
          {standaloneError && (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 ring-1 ring-amber-100 ring-inset">{standaloneError}</p>
          )}
          {phase === "done" && !standaloneError && !gathering && (
            <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100 ring-inset">Node complete — check table below.</p>
          )}
          {/* Same table layout as the Candidates tab — parsed profiles from localStorage */}
          <div className="mt-4">
            <CandidatesTable
              candidates={parsed}
              loading={false}
              onDeleteRequest={() => {}}
              onEditRequest={setEditingHuntCandidate}
              selectable
              selectedIds={selectedIds}
              onToggleRow={toggleRow}
              onToggleAll={toggleAll}
              matchScores={matchScores}
              detailFooter={(c) => {
                const m = matches[c.id];
                if (!m) return null;
                const role = roles.find((r) => r.id === m.roleId) ?? null;
                return (
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold tracking-wider text-gray-500 uppercase">
                        Match Rate
                      </p>
                      <div className="mt-2 flex items-center gap-3">
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${rateColorClass(m.score)}`}
                        />
                        <div className="h-2 min-w-[160px] max-w-[320px] flex-1 overflow-hidden rounded-full bg-gray-100 ring-1 ring-gray-200/60 ring-inset">
                          <div
                            className={`h-full rounded-full transition-[width] duration-500 ease-out ${rateColorClass(m.score)}`}
                            style={{ width: `${m.score}%` }}
                          />
                        </div>
                        <span className="font-bold text-gray-900 tabular-nums">{m.score}%</span>
                      </div>
                      <p className="mt-1.5 truncate text-xs text-gray-400">
                        Matched against {m.roleTitle}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (role) setViewMatch({ role, candidate: c, match: m });
                      }}
                      disabled={!role}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ArrowSquareOut size={14} />
                      View Match
                    </button>
                  </div>
                );
              }}
              actions={
                <div className="flex shrink-0 items-center gap-2">
                  {saveMsg && (
                    <span className="text-xs font-medium text-emerald-600">{saveMsg}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => void saveToDatabase()}
                    disabled={saving || parsed.length === 0}
                    className="flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-gray-700 to-gray-900 px-3 py-2 text-xs font-medium text-white shadow-sm transition-all duration-150 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? (
                      <>
                        <CircleNotch size={14} className="animate-spin" />
                        Saving…
                      </>
                    ) : (
                      <>
                        <CloudArrowUp size={14} weight="fill" />
                        Save to Database
                      </>
                    )}
                  </button>
                </div>
              }
            />
          </div>
          {parsed.length > 0 && (
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {parsed.length} local candidate{parsed.length === 1 ? "" : "s"} · not saved to database
              </span>
              <button
                type="button"
                onClick={() => setClearOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
              >
                <Trash size={14} />
                Clear Local Data
              </button>
            </div>
          )}
        </>
      )}

      {scrapeError && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs font-medium text-red-600 ring-1 ring-red-100 ring-inset">
          <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
          {scrapeError}
        </p>
      )}

      {/* View saved candidates */}
      {showSaved && (
        <SavedCandidatesModal
          saved={saved}
          onClose={() => setShowSaved(false)}
          onView={(p) => setViewing(p)}
          onClear={clearSaved}
        />
      )}

      {/* Detail of a saved candidate */}
      {viewing && (
        <CandidateProfileModal profile={viewing} onClose={() => setViewing(null)} />
      )}

      {/* View the job description + match (same modal as the Job Description tab) */}
      {viewMatch && (
        <RoleDetailsModal
          role={viewMatch.role}
          candidates={[viewMatch.candidate]}
          match={viewMatch.match}
          initialCandidate={viewMatch.candidate}
          initialReport={viewMatch.match}
          onClose={() => setViewMatch(null)}
        />
      )}

      {/* Edit hunt candidate — right slide cabinet, updates local parsed */}
      {editingHuntCandidate && (
        <EditCandidateDrawer
          candidate={editingHuntCandidate}
          onClose={() => setEditingHuntCandidate(null)}
          onSave={async (updated) => {
            const row: CandidateRow = { ...updated, id: editingHuntCandidate.id } as CandidateRow;
            addParsed(row);
          }}
        />
      )}

      {/* Confirm clearing all local hunt data */}
      {clearOpen && (
        <ClearConfirmModal
          onClose={() => setClearOpen(false)}
          onConfirm={clearLocalData}
        />
      )}
    </div>
  );
}


function RoleDropdown({
  roles,
  loading,
  roleId,
  onSelectRole,
}: {
  roles: RoleRow[];
  loading: boolean;
  roleId: string | null;
  onSelectRole: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = roles.find((r) => r.id === roleId) ?? null;

  const updatePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  };

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    updatePos();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onResize = () => updatePos();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm outline-none transition-colors hover:bg-gray-50 focus:ring-2 focus:ring-gray-900/10"
      >
        {loading
          ? "Loading…"
          : selected
            ? selected.jobTitle
            : "Select job description"}
        <CaretDown size={14} className="text-gray-400" />
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              style={pos ? { position: "fixed", top: pos.top, right: pos.right } : undefined}
              className="z-50 max-h-72 w-72 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg"
            >
              <p className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Job Description
              </p>
              {roles.length === 0 ? (
                <p className="px-2.5 py-2 text-sm text-gray-400">No job descriptions yet.</p>
              ) : (
                roles.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      onSelectRole(r.id);
                      setOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <span className="truncate">{r.jobTitle}</span>
                    {roleId === r.id && <Check size={15} weight="bold" />}
                  </button>
                ))
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}

/**
 * Limit sliders — placed in the SAME row as the "Search candidates" input
 * inside CandidatesTable's toolbar (via toolbarExtra). Lets the recruiter cap
 * automation cost: how many candidate profiles to scrape PER PAGE (5–100, pages
 * is the multiplier → total = perPage * pages) and how many pagination pages
 * to traverse (1–20). Values persist to localStorage and are
 * sent as maxCandidates / maxPages to /api/hunt → scrapeCandidates.
 */
function HuntLimits({
  maxCandidates,
  maxPages,
  onCandidatesChange,
  onPagesChange,
  disabled,
}: {
  maxCandidates: number;
  maxPages: number;
  onCandidatesChange: (v: number) => void;
  onPagesChange: (v: number) => void;
  disabled?: boolean;
}) {
  const candidatesUnlimited = maxCandidates >= CANDIDATES_UNLIMITED;
  const pagesUnlimited = maxPages >= PAGES_UNLIMITED;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50/70 px-3 py-2">
      {/* Candidates limit — per page, pages is multiplier */}
      <div className="flex items-center gap-2.5">
        <div className="flex flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Candidates / page
          </span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={5}
              max={CANDIDATES_MAX}
              step={5}
              value={maxCandidates}
              onChange={(e) => onCandidatesChange(Number(e.target.value))}
              disabled={disabled}
              aria-label="Max candidates to scrape"
              className="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-gray-200 accent-gray-900 disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gray-900"
            />
            <span
              title={
                candidatesUnlimited
                  ? "Unlimited candidates per page"
                  : `${maxCandidates} candidates per page — total ~${maxCandidates * (maxPages >= PAGES_UNLIMITED ? 1 : maxPages)}`
              }
              className={`min-w-[28px] rounded-md bg-white px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums ring-1 ring-inset ${candidatesUnlimited ? "bg-gray-900 text-white ring-gray-900" : "text-gray-900 ring-gray-200"}`}
            >
              {candidatesUnlimited ? "∞" : maxCandidates}
            </span>
          </div>
        </div>
        <div className="h-8 w-px bg-gray-200" aria-hidden />
        {/* Pages limit — max = unlimited (ellipsis / ∞) */}
        <div className="flex flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Pages</span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={PAGES_MAX}
              step={1}
              value={maxPages}
              onChange={(e) => onPagesChange(Number(e.target.value))}
              disabled={disabled}
              aria-label="Max pages to scrape — max is unlimited"
              className="h-1.5 w-20 cursor-pointer appearance-none rounded-full bg-gray-200 accent-gray-900 disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gray-900"
            />
            <span
              title={pagesUnlimited ? "Unlimited pages (ellipsis) — scrape until no next page" : `${maxPages} pages`}
              className={`min-w-[22px] rounded-md px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums ring-1 ring-inset ${pagesUnlimited ? "bg-gray-900 text-white ring-gray-900" : "bg-white text-gray-900 ring-gray-200"}`}
            >
              {pagesUnlimited ? "…" : maxPages}
            </span>
          </div>
        </div>
      </div>
      <span className="hidden text-[11px] text-gray-400 sm:inline">
        {pagesUnlimited || candidatesUnlimited ? "unlimited" : "limits"}
      </span>
    </div>
  );
}



function CandidateProfileModal({
  profile,
  onClose,
}: {
  profile: CandidateProfileResult;
  onClose: () => void;
}) {
  return (
    <Modal labelledBy="candidate-profile-modal-title" onClose={onClose} size="lg" scroll>
      <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
        <div className="min-w-0">
          <h3
            id="candidate-profile-modal-title"
            className="truncate text-lg font-semibold tracking-tight text-gray-900"
          >
            {profile.name || "Candidate Profile"}
          </h3>
          <p className="mt-0.5 truncate text-xs text-gray-400">{profile.url}</p>
        </div>
        <ModalCloseButton onClose={onClose} />
      </div>
      <div className="overflow-y-auto px-5 py-4">
        <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700">
          {profile.raw || "No profile content could be extracted."}
        </pre>
      </div>
    </Modal>
  );
}

function ClearConfirmModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal labelledBy="clear-confirm-title" onClose={onClose} size="sm">
      <div className="flex items-start gap-3 border-b border-gray-100 px-5 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-500 ring-1 ring-red-100 ring-inset">
          <Trash size={18} />
        </div>
        <div className="min-w-0">
          <h3
            id="clear-confirm-title"
            className="text-base font-semibold tracking-tight text-gray-900"
          >
            Clear local candidate data?
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            This removes all parsed candidates, raw profiles, and match results stored
            locally in your browser. Nothing in the database is affected.
          </p>
        </div>
        <ModalCloseButton onClose={onClose} />
      </div>
      <div className="flex justify-end gap-2 px-5 py-4">
        <button
          onClick={onClose}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700"
        >
          Clear Local Data
        </button>
      </div>
    </Modal>
  );
}

function SavedCandidatesModal({
  saved,
  onClose,
  onView,
  onClear,
}: {
  saved: SavedCandidate[];
  onClose: () => void;
  onView: (profile: CandidateProfileResult) => void;
  onClear: () => void;
}) {
  return (
    <Modal labelledBy="saved-candidates-title" onClose={onClose} size="md" scroll>
      <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
        <div>
          <h3
            id="saved-candidates-title"
            className="text-lg font-semibold tracking-tight text-gray-900"
          >
            Saved Candidates
          </h3>
          <p className="mt-0.5 text-xs text-gray-400">{saved.length} scraped</p>
        </div>
        <div className="flex items-center gap-2">
          {saved.length > 0 && (
            <button
              onClick={onClear}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
            >
              <Trash size={14} />
              Clear
            </button>
          )}
          <ModalCloseButton onClose={onClose} />
        </div>
      </div>
      <div className="overflow-y-auto px-5 py-4">
        {saved.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">
            No candidates saved yet. Run automation to collect profiles here.
          </p>
        ) : (
          <ul className="space-y-1">
            {saved.map((s) => (
              <li key={s.url}>
                <button
                  type="button"
                  onClick={() => onView(s)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-gray-50"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
                    {s.name || "Unnamed candidate"}
                  </span>
                  <span className="shrink-0 text-[11px] text-gray-400">
                    {new Date(s.savedAt).toLocaleTimeString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
