import type { Candidate } from "./candidate-schema";
import type { RoleData } from "./role-schema";

/**
 * Typed browser-side wrappers around the app's route handlers.
 * Each helper throws an Error carrying the server-provided message
 * so UI code can render it directly.
 */

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

  const res = await fetch("/api/parse-pdf", { method: "POST", body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(await errorFrom(res, "Failed to parse PDF"));
  return data.text as string;
}

export async function extractCandidateFromText(text: string, model: string): Promise<Candidate> {
  const res = await fetch("/api/extract-candidates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, model }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(await errorFrom(res, "Failed to extract candidate"));
  return data.candidate as Candidate;
}

export async function extractRoleFromText(text: string, model?: string): Promise<RoleData> {
  const res = await fetch("/api/extract-role", {
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
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, model }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(await errorFrom(res, "Request failed"));
  return data.result as string;
}
