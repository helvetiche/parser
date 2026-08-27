"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowSquareOut, CaretDown, Check, CircleNotch, CloudArrowUp, Eye, RocketLaunch, Target, Trash, WarningCircle } from "@phosphor-icons/react";
import { getIdToken } from "@/lib/auth";
import Modal, { ModalCloseButton } from "@/components/ui/Modal";
import CandidatesTable from "@/components/candidates/CandidatesTable";
import RoleDetailsModal from "@/components/roles/RoleDetailsModal";
import { createCandidate } from "@/lib/client-api";
import { parseProfile } from "@/lib/hunt/parse-profile";
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

const LIMIT_CANDIDATES_KEY = "hunt.maxCandidates";
const LIMIT_PAGES_KEY = "hunt.maxPages";
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
 * Revamped 7-step pipeline:
 *  1. opening    — STEP 1: open tab (focusBrowserTab / bringToFront)
 *  2. scraping   — STEP 2: scrape all candidate names + pagination (scrapeCandidates)
 *  3-5. extracting — STEPS 3-5: for each candidate: open profile → scrape raw → close tab
 *                  (extractCandidateProfile guarantees open/scrape/close per candidate)
 *  6. parsing    — STEP 6: batch AI parse of ALL raws (parseProfile) — no interleaving
 *  7. matching   — STEP 7: batch match each parsed candidate to role (matchCandidateToRole)
 */
type Phase = "idle" | "opening" | "scraping" | "extracting" | "parsing" | "matching" | "returning" | "done";

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
    } catch {
      /* ignore */
    }
    setParsed([]);
    setSaved([]);
    setMatches({});
    setPhase("idle");
    setClearOpen(false);
  };

  // Parsed candidate profiles (AI-converted, stored in localStorage only).
  const [parsed, setParsed] = useState<CandidateRow[]>(() => loadParsed());

  const addParsed = (row: CandidateRow) => {
    setParsed((prev) => {
      // Replace if the id already exists (e.g. when a later step enriches it).
      const without = prev.filter((p) => p.id !== row.id);
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
  const [roleId, setRoleId] = useState<string | null>(null);

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
      if (res.ok) setRoles((data.roles as RoleRow[]) ?? []);
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
  const matchScores = useMemo(() => {
    if (!roleId) return {};
    const map: Record<string, number> = {};
    for (const [candidateId, m] of Object.entries(matches)) {
      if (m.roleId === roleId) map[candidateId] = m.score;
    }
    return map;
  }, [matches, roleId]);

  const addSaved = (p: CandidateProfileResult) => {
    setSaved((prev) => {
      if (prev.some((s) => s.url === p.url)) return prev;
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
  const doScrape = async (): Promise<ScrapedCandidate[]> => {
    if (!selectedUrl) {
      setScrapeError("Select a tab first.");
      return [];
    }
    setScrapeError(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("You are signed out. Please sign in again.");
      // Slider at max → unlimited: map to backend hard caps (effectively no limit)
      const effectiveMaxPages = maxPages >= PAGES_UNLIMITED ? BACKEND_MAX_PAGES : maxPages;
      const effectiveMaxCandidates =
        maxCandidates >= CANDIDATES_UNLIMITED ? BACKEND_MAX_CANDIDATES : maxCandidates;
      const res = await fetch("/api/hunt", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          scrape: selectedUrl,
          maxPages: effectiveMaxPages,
          maxCandidates: effectiveMaxCandidates,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to scrape candidates");
      // Optional debug: pagesScraped / hasMorePages are available on data.debug
      return data.candidates as ScrapedCandidate[];
    } catch (err) {
      setScrapeError(err instanceof Error ? err.message : "Failed to scrape candidates");
      return [];
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
        const c = remaining[0];
        try {
          const token = await getIdToken();
          if (!token) throw new Error("You are signed out. Please sign in again.");
          const res = await fetch("/api/hunt", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ extract: c.url }),
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
        const p = remaining[0];
        const row = await parseProfile(p.raw, p.url, p.name);
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

  /** Score one parsed candidate against the selected job description. */
  const matchHuntCandidate = async (
    candidate: CandidateRow,
    roleId: string
  ): Promise<MatchResult | null> => {
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
      return data.match as MatchResult;
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
        const row = remaining[0];
        const match = await matchHuntCandidate(row, role.id);
        if (match) {
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

  /**
   * STEP 1 — Open tab (bring sourcing tab to foreground).
   * Isolated so scraping starts on a visible, focused tab — required for
   * reliable pagination clicks and lazy-load scroll in STEP 2.
   */
  const openTab = async (url: string) => {
    try {
      const token = await getIdToken();
      if (!token) throw new Error("You are signed out. Please sign in again.");
      const res = await fetch("/api/hunt", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ open: url }),
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
    try {
      const token = await getIdToken();
      if (!token) return;
      await fetch("/api/hunt", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ returnToScrape: url }),
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
    try {
      // STEP 1 — Open tab
      setPhase("opening");
      await openTab(selectedUrl);

      // STEP 2 — Scrape all candidate names + pagination (capped by sliders)
      setPhase("scraping");
      const list = await doScrape();
      if (list.length === 0) {
        setPhase("idle");
        return;
      }
      // Slider guard — candidate slider is PER PAGE, pages is multiplier
      // total = perPage * pages. Backend already slices per-page, but enforce
      // total cap deterministically for safety.
      // Unlimited per-page (∞) or unlimited pages (∞) → no total slicing.
      const totalCap =
        maxCandidates >= CANDIDATES_UNLIMITED || maxPages >= PAGES_UNLIMITED
          ? Infinity
          : maxCandidates * maxPages;
      const cappedList = Number.isFinite(totalCap) ? list.slice(0, totalCap) : list;

      // STEPS 3-5 — Open each profile → scrape → close (sequential, guaranteed close)
      setPhase("extracting");
      const profiles = await gatherRaw(cappedList);

      // STEP 6 — Parse all scraped profiles with AI (batch)
      setPhase("parsing");
      const rows = await parseAll(profiles);

      // STEP 7 — Match candidates to selected role
      setPhase("matching");
      const role = roles.find((r) => r.id === roleId) ?? null;
      await matchAll(rows, role);

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

  return (
    <div className="w-full">
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
          className="flex items-center gap-2 rounded-xl bg-gradient-to-b from-gray-700 to-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {scanning ? (
            <>
              <CircleNotch size={17} className="animate-spin" />
              Scanning…
            </>
          ) : (
            <>
              <Target size={17} />
              Scan Browser Tabs
            </>
          )}
        </button>
      </div>

      {error && (
        <p className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs font-medium text-red-600 ring-1 ring-red-100 ring-inset">
          <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {result && result.tabs.length > 0 && (
        <>
          {/* Stepper on top of the candidate table */}
          <SourcingPanel
            target={target}
            phase={phase}
            gathering={gathering}
            progress={progress}
            onStart={() => void gatherCandidates()}
            roles={roles}
            rolesLoading={rolesLoading}
            roleId={roleId}
            onSelectRole={setRoleId}
          />
          {/* Same table layout as the Candidates tab — parsed profiles from localStorage */}
          <div className="mt-4">
            <CandidatesTable
              candidates={parsed}
              loading={false}
              onDeleteRequest={() => {}}
              selectable
              selectedIds={selectedIds}
              onToggleRow={toggleRow}
              onToggleAll={toggleAll}
              matchScores={matchScores}
              toolbarExtra={
                <HuntLimits
                  maxCandidates={maxCandidates}
                  maxPages={maxPages}
                  onCandidatesChange={setMaxCandidates}
                  onPagesChange={setMaxPages}
                  disabled={gathering}
                />
              }
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
                  <button
                    type="button"
                    onClick={() => setClearOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
                  >
                    <Trash size={14} />
                    Clear Local Data
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

// Revamped 7-step labels matching the strategized pipeline:
// 1 Open Tab → 2 Scrape Candidates (paginated) → 3 Open Profile → 4 Scrape Profile → 5 Close Tab → 6 Parse AI → 7 Match
const STEP_LABELS = ["Open Tab", "Scrape Candidates", "Open Profile", "Scrape Profile", "Close Tab", "Parse AI", "Match"];

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

function SourcingPanel({
  target,
  phase,
  gathering,
  progress,
  onStart,
  roles,
  rolesLoading,
  roleId,
  onSelectRole,
}: {
  target: BrowserTab | null;
  phase: Phase;
  gathering: boolean;
  progress: { done: number; total: number } | null;
  onStart: () => void;
  roles: RoleRow[];
  rolesLoading: boolean;
  roleId: string | null;
  onSelectRole: (id: string) => void;
}) {
  // 7-step stepper status mapping:
  // 1 Open Tab (focus) — done once target exists; active while phase===opening
  // 2 Scrape Candidates — active while phase===scraping
  // 3-5 Open/Scrape/Close Profile — together represent the extracting loop;
  //     all three light up when phase===extracting, then mark done for later phases
  // 6 Parse AI, 7 Match — standard sequential
  const stepStatus = (idx: number): "done" | "active" | "upcoming" => {
    if (idx === 1) {
      if (!target) return "active";
      if (phase === "opening") return "active";
      return "done";
    }
    if (idx === 2) {
      if (!target) return "upcoming";
      if (phase === "opening") return "upcoming";
      if (phase === "scraping") return "active";
      if (
        phase === "extracting" ||
        phase === "parsing" ||
        phase === "matching" ||
        phase === "returning" ||
        phase === "done"
      )
        return "done";
      return "upcoming";
    }
    // Steps 3-5 are the per-candidate open→scrape→close atomic loop (extracting)
    if (idx === 3 || idx === 4 || idx === 5) {
      if (phase === "scraping" || phase === "opening" || phase === "idle") return "upcoming";
      if (phase === "extracting") return "active";
      if (phase === "parsing" || phase === "matching" || phase === "returning" || phase === "done") return "done";
      return "upcoming";
    }
    if (idx === 6) {
      if (phase === "parsing") return "active";
      if (phase === "matching" || phase === "returning" || phase === "done") return "done";
      return "upcoming";
    }
    if (idx === 7) {
      if (phase === "matching") return "active";
      if (phase === "returning" || phase === "done") return "done";
      return "upcoming";
    }
    return "upcoming";
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white/80 shadow-sm backdrop-blur">
      {/* Stepper on top, with job-description picker + Start action on the right */}
      <div className="flex flex-col gap-4 border-b border-gray-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <Stepper statusFor={stepStatus} running={gathering} />
        <div className="flex shrink-0 items-center gap-3">
          {/* Custom job-description dropdown (left of Start) */}
          <RoleDropdown
            roles={roles}
            loading={rolesLoading}
            roleId={roleId}
            onSelectRole={onSelectRole}
          />
          <button
            type="button"
            onClick={onStart}
            disabled={gathering || !target}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-b from-gray-700 to-gray-900 px-5 py-2 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {gathering ? (
              <>
                <CircleNotch size={17} className="animate-spin" />
                Running…
              </>
            ) : (
              <>
                <RocketLaunch size={17} weight="fill" />
                Start Hunt Automation
              </>
            )}
          </button>
        </div>
      </div>

      {/* Progress detail — maps directly to the 7 user-requested steps */}
      {gathering && progress && (
        <p className="border-t border-gray-100 px-4 py-2.5 text-xs text-gray-500">
          {phase === "opening"
            ? "Step 1 — Opening sourcing tab…"
            : phase === "scraping"
              ? "Step 2 — Scraping candidate names & pagination…"
              : phase === "extracting"
                ? "Steps 3-5 — Opening profile → Scraping → Closing (sequential)…"
                : phase === "parsing"
                  ? "Step 6 — Parsing profiles with AI (batch)…"
                  : phase === "returning"
                    ? "Returning to scrap candidate page…"
                    : "Step 7 — Matching candidates to job description…"}{" "}
          · {progress.done} / {progress.total}
        </p>
      )}
      {/* When scraping has a total but extraction hasn't started, show scrape count without progress bar */}
      {gathering && !progress && phase === "scraping" && (
        <p className="border-t border-gray-100 px-4 py-2.5 text-xs text-gray-500">
          Step 2 — Scraping candidate names & pagination…
        </p>
      )}
      {gathering && phase === "returning" && !progress && (
        <p className="border-t border-gray-100 px-4 py-2.5 text-xs text-gray-500">
          Returning to scrap candidate page…
        </p>
      )}
      {phase === "done" && (
        <p className="border-t border-gray-100 px-4 py-2.5 text-xs font-medium text-emerald-600">
          Done — steps 1-7 complete: tab opened, candidates scraped (with pagination), each profile opened → scraped → closed, AI-parsed, and matched.
        </p>
      )}
    </div>
  );
}

function Stepper({
  statusFor,
  running,
}: {
  statusFor: (idx: number) => "done" | "active" | "upcoming";
  running: boolean;
}) {
  return (
    <ol className="flex items-center gap-2">
      {STEP_LABELS.map((label, i) => {
        const idx = i + 1;
        const status = statusFor(idx);
        const connectorDone = statusFor(idx) === "done";
        return (
          <li key={label} className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-inset transition-colors ${
                  status === "done"
                    ? "bg-gradient-to-b from-gray-700 to-gray-900 text-white ring-transparent"
                    : status === "active"
                      ? "bg-gray-900/10 text-gray-900 ring-gray-900/20"
                      : "bg-gray-50 text-gray-400 ring-gray-200"
                }`}
              >
                {status === "done" ? (
                  "✓"
                ) : status === "active" && running ? (
                  <CircleNotch size={14} className="animate-spin" />
                ) : (
                  idx
                )}
              </span>
              <span
                className={`text-xs font-medium ${
                  status === "upcoming" ? "text-gray-400" : "text-gray-900"
                }`}
              >
                {label}
              </span>
            </div>
            {idx < STEP_LABELS.length && (
              <span
                className={`h-px w-6 sm:w-10 ${connectorDone ? "bg-gray-900" : "bg-gray-200"}`}
              />
            )}
          </li>
        );
      })}
    </ol>
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
