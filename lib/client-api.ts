import type { Candidate, CandidateRow } from "./candidate-schema";
import type { RoleData, RoleRow } from "./role-schema";
import { getIdToken } from "./auth";

/** GET payload of /api/candidates */
export type CandidatesResponse = { candidates: CandidateRow[] };

/** GET payload of /api/roles */
export type RolesResponse = { roles: RoleRow[] };

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

export async function sendChatMessage(
  messages: Array<{ role: string; content: string }>,
  model: string
): Promise<string> {
  const res = await authedFetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, model }),
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
