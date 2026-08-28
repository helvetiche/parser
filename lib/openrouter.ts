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

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model?: string;
  /** Optional OpenRouter cost in USD if provider returns it. */
  cost?: number;
};

export type ChatCompletion = {
  id?: string;
  model?: string;
  provider?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: unknown;
    completion_tokens_details?: unknown;
    cost?: number;
    /** Some providers nest cost differently */
    total_cost?: number;
  };
  choices?: Array<{
    message?: { content?: string };
    /** "length" means the output hit max_tokens and was cut off. */
    finish_reason?: string;
  }>;
};

export function tokenUsageFromCompletion(
  data: ChatCompletion,
  fallbackModel?: string
): TokenUsage {
  const u = data.usage;
  const prompt = typeof u?.prompt_tokens === "number" ? u.prompt_tokens : 0;
  const completion = typeof u?.completion_tokens === "number" ? u.completion_tokens : 0;
  const total =
    typeof u?.total_tokens === "number" ? u.total_tokens : prompt + completion;
  const model = data.model || fallbackModel;
  const cost =
    typeof u?.cost === "number"
      ? u.cost
      : typeof u?.total_cost === "number"
        ? u.total_cost
        : undefined;
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total, model, cost };
}

export function emptyUsage(model?: string): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, model };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    model: b.model || a.model,
    cost:
      a.cost != null || b.cost != null
        ? (a.cost ?? 0) + (b.cost ?? 0)
        : undefined,
  };
}

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
