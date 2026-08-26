import type { Candidate, CandidateRow } from "./candidate-schema";
import type { RoleData, RoleRow } from "./role-schema";
import type { MatchResult } from "./match-schema";
import type { PromptData, PromptRow } from "./prompt-schema";
import { getIdToken } from "./auth";

/** GET payload of /api/candidates */
export type CandidatesResponse = { candidates: CandidateRow[] };

/** GET payload of /api/roles */
export type RolesResponse = { roles: RoleRow[] };

/** GET payload of /api/prompts */
export type PromptsResponse = { prompts: PromptRow[] };

/** POST payload of /api/match */
export type MatchResponse = {
  results: Array<{ roleId: string; match?: MatchResult; error?: string }>;
};

/**
 * Typed browser-side wrappers around the app's route handlers.
 * Every request carries the caller's Firebase ID token; each helper
 * throws an Error carrying the server-provided message so UI code can
 * render it directly.
 */

async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getIdToken();
  if (!token) throw new Error("You are signed out. Please sign in again.");

  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
  return res;
}

async function errorFrom(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return typeof data?.error === "string" ? data.error : fallback;
  } catch {
    return fallback;
  }
}

export async function parsePdfFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await authedFetch("/api/parse-pdf", { method: "POST", body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(await errorFrom(res, "Failed to parse PDF"));
  return data.text as string;
}

export async function extractCandidateFromText(text: string, model: string): Promise<Candidate> {
  const res = await authedFetch("/api/extract-candidates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, model }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(await errorFrom(res, "Failed to extract candidate"));
  return data.candidate as Candidate;
}

export async function extractRoleFromText(text: string, model?: string): Promise<RoleData> {
  const res = await authedFetch("/api/extract-role", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(model ? { text, model } : { text }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(await errorFrom(res, "Failed to extract role"));
  return data.role as RoleData;
}

export async function matchCandidateToRoles(
  candidateId: string,
  model?: string
): Promise<MatchResponse> {
  const res = await authedFetch("/api/match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(model ? { candidateId, model } : { candidateId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(await errorFrom(res, "Failed to match candidate to roles"));
  return data as MatchResponse;
}

export async function evaluateCandidateForRole(
  candidateId: string,
  roleId: string,
  promptId?: string
): Promise<MatchResult> {
  const res = await authedFetch("/api/match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      candidateId,
      roleId,
      ...(promptId ? { promptId } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(await errorFrom(res, "Failed to evaluate candidate"));
  const first = (data as MatchResponse).results?.[0];
  if (!first || first.error || !first.match) {
    throw new Error(first?.error ?? "Failed to evaluate candidate");
  }
  return first.match;
}

export async function listPrompts(): Promise<PromptsResponse> {
  const res = await authedFetch("/api/prompts");
  const data = await res.json();
  if (!res.ok) throw new Error(await errorFrom(res, "Failed to load prompts"));
  return data as PromptsResponse;
}

export async function sendChatMessage(
  messages: Array<{ role: string; content: string }>,
  model: string,
  context?: string
): Promise<string> {
  const res = await authedFetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(context ? { messages, model, context } : { messages, model }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(await errorFrom(res, "Request failed"));
  return data.result as string;
}

/* ---------------- Candidates mutations ---------------- */

export async function createCandidate(candidate: Candidate): Promise<CandidateRow> {
  const res = await authedFetch("/api/candidates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidate }),
  });
  if (!res.ok) throw new Error(await errorFrom(res, "Failed to save candidate"));
  const data = await res.json();
  return data.candidate as CandidateRow;
}

export async function deleteCandidate(id: string): Promise<void> {
  const res = await authedFetch(`/api/candidates/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204)
    throw new Error(await errorFrom(res, "Failed to delete candidate"));
}

/* ---------------- Roles mutations ---------------- */

export async function createRole(role: RoleData): Promise<RoleRow> {
  const res = await authedFetch("/api/roles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error(await errorFrom(res, "Failed to save role"));
  const data = await res.json();
  return data.role as RoleRow;
}

export async function deleteRole(id: string): Promise<void> {
  const res = await authedFetch(`/api/roles/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) throw new Error(await errorFrom(res, "Failed to delete role"));
}

/** Upserts a submitted candidate (endorsement) on a role. */
export async function saveEndorsement(
  roleId: string,
  endorsement: { candidateId: string; candidateName: string; status: string }
): Promise<void> {
  const res = await authedFetch(`/api/roles/${encodeURIComponent(roleId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endorsement }),
  });
  if (!res.ok) throw new Error(await errorFrom(res, "Failed to submit candidate"));
}

/** Removes a submitted candidate (endorsement) from a role. */
export async function removeEndorsement(roleId: string, candidateId: string): Promise<void> {
  const res = await authedFetch(`/api/roles/${encodeURIComponent(roleId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ removeEndorsement: candidateId }),
  });
  if (!res.ok) throw new Error(await errorFrom(res, "Failed to remove candidate"));
}

/* ---------------- Prompt mutations ---------------- */

export async function createPrompt(prompt: PromptData): Promise<PromptRow> {
  const res = await authedFetch("/api/prompts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error(await errorFrom(res, "Failed to save prompt"));
  const data = await res.json();
  return data.prompt as PromptRow;
}

export async function updatePrompt(id: string, prompt: PromptData): Promise<void> {
  const res = await authedFetch(`/api/prompts/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok && res.status !== 204)
    throw new Error(await errorFrom(res, "Failed to update prompt"));
}

export async function deletePrompt(id: string): Promise<void> {
  const res = await authedFetch(`/api/prompts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204)
    throw new Error(await errorFrom(res, "Failed to delete prompt"));
}
