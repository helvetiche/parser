"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowSquareOut, CaretDown, Check, CircleNotch, CloudArrowUp, Eye, RocketLaunch, Target, Trash, WarningCircle } from "@phosphor-icons/react";
import { getIdToken } from "@/lib/auth";
import Modal, { ModalCloseButton } from "@/components/ui/Modal";
import CandidatesTable from "@/components/candidates/CandidatesTable";
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

const loadParsed = (): CandidateRow[] => {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(PARSED_KEY) || "[]");
  } catch {
    return [];
  }
};

const SOURCES = [
  { id: "linkedin", label: "LinkedIn Recruiter" },
  { id: "jobstreet", label: "JobStreet" },
  { id: "any", label: "Any Sourcing Tab" },
] as const;

const sourceMatches = (url: string, source: string) => {
  const u = url.toLowerCase();
  if (source === "linkedin") return u.includes("linkedin");
  if (source === "jobstreet") return u.includes("jobstreet");
  return true;
};

type Phase = "idle" | "opening" | "gathering" | "parsing" | "matching" | "done";

export default function HuntAutomation() {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<BrowserTabsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string>("linkedin");

  // The selected sourcing tab (derived from the matching source) + the run.
  const [gathering, setGathering] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);

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
  const addMatch = (
    candidateId: string,
    roleId: string,
    roleTitle: string,
    match: MatchResult
  ) => {
    try {
      const prev = JSON.parse(localStorage.getItem(MATCHES_KEY) || "{}") as Record<
        string,
        MatchResult & { roleId: string; roleTitle: string }
      >;
      const next = { ...prev, [candidateId]: { ...match, roleId, roleTitle } };
      localStorage.setItem(MATCHES_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };

  // Auto-scan the browser tabs + load job descriptions as soon as the
  // Hunt Automation tab is active.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    void scan();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  /** Scrape candidate names + links from the selected tab. */
  const doScrape = async (): Promise<ScrapedCandidate[]> => {
    if (!selectedUrl) {
      setScrapeError("Select a tab first.");
      return [];
    }
    setScrapeError(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("You are signed out. Please sign in again.");
      const res = await fetch("/api/hunt", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ scrape: selectedUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to scrape candidates");
      return data.candidates as ScrapedCandidate[];
    } catch (err) {
      setScrapeError(err instanceof Error ? err.message : "Failed to scrape candidates");
      return [];
    }
  };

  /** Step 3: open each profile and collect the raw details (no parse yet). */
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
          /* skip unreadable candidate and keep moving */
        }
        remaining = remaining.slice(1);
        setProgress({ done: list.length - remaining.length, total: list.length });
      }
    } finally {
      /* progress cleared by caller */
    }
    return out;
  };

  /** Step 4: convert each scraped profile into a structured candidate via AI. */
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

  /** Step 5: match every parsed candidate to the chosen job description. */
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

  /** Focus/open the given browser tab (via CDP, does not open a new one). */
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
      /* non-blocking — the dropdown stays usable */
    }
  };

  /** The one button: step 2 (open) → step 3 (gather) → step 4 (parse). */
  const gatherCandidates = async () => {
    if (gathering || !selectedUrl) return;
    setGathering(true);
    setScrapeError(null);
    setProgress(null);
    try {
      setPhase("opening");
      const list = await doScrape();
      if (list.length === 0) {
        setPhase("idle");
        return;
      }
      setPhase("gathering");
      const profiles = await gatherRaw(list);
      setPhase("parsing");
      const rows = await parseAll(profiles);
      setPhase("matching");
      const role = roles.find((r) => r.id === roleId) ?? null;
      await matchAll(rows, role);
      setPhase("done");
    } finally {
      setGathering(false);
    }
  };

  // Filter the scanned tabs to the chosen automation source.
  const visibleResult = useMemo<BrowserTabsResult | null>(() => {
    if (!result) return null;
    return { ...result, tabs: result.tabs.filter((t) => sourceMatches(t.url, source)) };
  }, [result, source]);

  // Auto-pick the first matching tab as the gather target (no manual table).
  const target = visibleResult?.tabs[0] ?? null;
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
            {SOURCES.find((s) => s.id === source)?.label ?? "Select automation"}
            <CaretDown size={14} className="text-gray-400" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute left-0 z-20 mt-2 w-64 overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
                <p className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Automation
                </p>
                {SOURCES.map((s) => {
                  const tabForSource = result
                    ? result.tabs.find((t) => sourceMatches(t.url, s.id)) ?? null
                    : null;
                  return (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-gray-50"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSource(s.id);
                          setMenuOpen(false);
                        }}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-gray-700"
                      >
                        <span className="truncate">{s.label}</span>
                        {source === s.id && <Check size={15} weight="bold" />}
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          title="Open tab"
                          disabled={!tabForSource}
                          onClick={() => {
                            if (tabForSource) void openTab(tabForSource.url);
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-30"
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
                })}
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

      {visibleResult && (
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

const STEP_LABELS = ["Select Tab", "Open Candidate", "Gather Info", "Parse", "Match"];

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
  const stepStatus = (idx: number): "done" | "active" | "upcoming" => {
    if (idx === 1) return target ? "done" : "active";
    if (idx === 2) {
      if (!target) return "upcoming";
      if (phase === "opening") return "active";
      if (phase === "gathering" || phase === "parsing" || phase === "done") return "done";
      return "active";
    }
    if (idx === 3) {
      if (phase === "gathering") return "active";
      if (phase === "parsing" || phase === "done") return "done";
      return "upcoming";
    }
    if (idx === 4) {
      if (phase === "parsing") return "active";
      if (phase === "matching" || phase === "done") return "done";
      return "upcoming";
    }
    if (idx === 5) {
      if (phase === "matching") return "active";
      if (phase === "done") return "done";
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

      {/* Progress detail */}
      {gathering && progress && (
        <p className="border-t border-gray-100 px-4 py-2.5 text-xs text-gray-500">
          {phase === "opening"
            ? "Opening candidate profiles…"
            : phase === "gathering"
              ? "Gathering information…"
              : phase === "parsing"
                ? "Parsing profiles…"
                : "Matching candidates to job description…"}{" "}
          · {progress.done} / {progress.total}
        </p>
      )}
      {phase === "done" && progress === null && (
        <p className="border-t border-gray-100 px-4 py-2.5 text-xs font-medium text-emerald-600">
          Done — all candidates gathered and saved.
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
