const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const HEADERS = {
  Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
  "Content-Type": "application/json",
  "HTTP-Referer": "http://localhost:3000",
};

export class OpenRouterError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
  }
}

export type ChatCompletion = {
  choices?: Array<{ message?: { content?: string } }>;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ErrorInfo = {
  error?: { message?: string; metadata?: { raw?: string } };
};

function extractMessage(info: ErrorInfo | null, status: number): string {
  const raw = info?.error?.metadata?.raw;
  const message = info?.error?.message;
  const detail = raw || message;
  return detail ? `${detail} (OpenRouter ${status})` : `OpenRouter request failed (${status})`;
}

export type OpenRouterOptions = {
  /** Extra attempts after the first one fails with a retryable error. */
  retries?: number;
  /** Per-request wall-clock cap so hung providers fail fast. */
  timeoutMs?: number;
};

/**
 * Resolve with the first promise that fulfills; only reject once every
 * promise has rejected. Used to race multiple models in parallel.
 */
export function firstSuccess<T>(tasks: Promise<T>[]): Promise<T> {
  return new Promise((resolve, reject) => {
    let pending = tasks.length;
    let lastError: unknown;

    if (pending === 0) {
      reject(new Error("No providers to try"));
      return;
    }

    tasks.forEach((task) => {
      task.then(resolve, (err) => {
        lastError = err;
        pending--;
        if (pending === 0) {
          reject(lastError ?? new Error("All providers failed"));
        }
      });
    });
  });
}

/**
 * POST a chat-completions payload to OpenRouter.
 * Retries with exponential backoff on 429/408/5xx before throwing
 * an OpenRouterError carrying the real upstream message.
 */
export async function openrouterChat(
  body: Record<string, unknown>,
  { retries = 1, timeoutMs = 60000 }: OpenRouterOptions = {}
): Promise<unknown> {
  let lastError: OpenRouterError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await sleep(750 * Math.pow(2, attempt - 1));
    }

    let res: Response;
    let info: ErrorInfo | null = null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      lastError = new OpenRouterError(
        aborted
          ? `Request timed out after ${timeoutMs / 1000}s`
          : err instanceof Error
            ? err.message
            : "Network error",
        504
      );
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      const json = (await res.json()) as ChatCompletion;
      const content = json?.choices?.[0]?.message?.content;
      // Some providers return HTTP 200 with an empty body under load;
      // treat that as a retryable failure instead of passing garbage on.
      if (typeof content === "string" && content.trim().length > 0) {
        return json;
      }
      lastError = new OpenRouterError("Model returned an empty response (OpenRouter 502)", 502);
      continue;
    }

    info = await res.json().catch(() => null);
    lastError = new OpenRouterError(extractMessage(info, res.status), res.status);

    const retryable = res.status === 429 || res.status === 408 || res.status >= 500;
    if (!retryable) break;
  }

  throw lastError ?? new OpenRouterError("OpenRouter request failed", 0);
}
