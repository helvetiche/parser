import JSON5 from "json5";
import { firstSuccess, OpenRouterError, openrouterChat, type ChatCompletion } from "./openrouter";

/** Remove reasoning-model "thinking" output that leaks into content. */
export function stripThinking(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // Unterminated <think> block (generation cut off mid-thought).
  const openIdx = out.toLowerCase().lastIndexOf("<think>");
  if (openIdx !== -1 && out.indexOf("</think>") === -1) {
    out = out.slice(0, openIdx);
  }
  return out.trim();
}

/**
 * Balanced-brace scan forward from `start`; returns the complete object
 * substring, or null if braces never balance.
 */
function balancedSlice(content: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return content.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Locate a JSON object inside arbitrary surrounding prose. Anchors on a
 * required top-level key instead of naive first/last brace matching, so
 * thinking dumps around it don't break parsing.
 */
export function extractJsonAround(content: string, anchorKey: string): string | null {
  const keyMatch = content.match(new RegExp(`"${anchorKey}"\\s*:`));
  if (!keyMatch || keyMatch.index === undefined) return null;

  const start = content.lastIndexOf("{", keyMatch.index);
  if (start === -1) return null;

  return balancedSlice(content, start);
}

export function hasAnchorKey(content: string, anchorKey: string): boolean {
  return new RegExp(`"${anchorKey}"\\s*:`).test(stripThinking(content));
}
/**
 * Parse a JSON object anchored on `anchorKey` out of raw model output.
 * Tolerates code fences, trailing commas and truncated structures. Every
 * anchor occurrence is tried, so a stray mention in prose can't poison
 * the first attempt.
 */
export function parseAnchoredObject(content: string, anchorKey: string): unknown {
  const cleaned = stripThinking(content);

  const candidates: string[] = [];
  const anchorRe = new RegExp(`"${anchorKey}"\\s*:`, "g");
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(cleaned)) !== null) {
    const start = cleaned.lastIndexOf("{", match.index);
    if (start === -1) continue;
    const slice = balancedSlice(cleaned, start);
    if (slice) candidates.push(slice);
  }

  const stripped = cleaned
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  candidates.push(stripped);
  candidates.push(cleaned.replace(/,(\s*[}\]])/g, "$1"));

  for (const source of candidates) {
    for (const candidate of [source, source.replace(/,(\s*[}\]])/g, "$1")]) {
      try {
        return JSON.parse(candidate);
      } catch {
        // try next parser
      }
      try {
        return JSON5.parse(candidate);
      } catch {
        // try repair
      }
      try {
        return JSON5.parse(repairJson(candidate));
      } catch {
        // try next candidate source
      }
    }
  }

  throw new Error(
    "Model did not return valid JSON. Preview: " + content.slice(0, 160).replace(/\s+/g, " ")
  );
}

function repairJson(input: string): string {
  let result = "";
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      result += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (inString) {
      result += ch;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch === "{" ? "}" : "]");
    } else if (ch === "}" || ch === "]") {
      if (stack[stack.length - 1] === ch) stack.pop();
    }
    result += ch;
  }

  if (inString) result += '"';
  while (stack.length) result += stack.pop();
  return result;
}

const RACE_FALLBACKS = ["nvidia/nemotron-nano-9b-v2:free"];

/**
 * Race the primary model against fallbacks and return the first response
 * whose content actually contains the expected anchor key.
 */
async function raceStructured(
  messages: Array<{ role: string; content: string }>,
  anchorKey: string,
  model: string
): Promise<string> {
  const models = [...new Set([model, ...RACE_FALLBACKS])];

  const attempt = async (m: string): Promise<string> => {
    const opts = { retries: 1, timeoutMs: 45000 };
    const maxTokens = 2048;

    const finish = (data: ChatCompletion): string => {
      const content = data.choices?.[0]?.message?.content ?? "";
      if (!hasAnchorKey(content, anchorKey)) {
        throw new OpenRouterError("Model response contained no structured JSON", 502);
      }
      console.log(`[ai-extract] succeeded via ${m}`);
      return content;
    };

    try {
      return finish(
        (await openrouterChat(
          {
            model: m,
            messages,
            max_tokens: maxTokens,
            temperature: 0.2,
            response_format: { type: "json_object" },
          },
          opts
        )) as ChatCompletion
      );
    } catch (err) {
      const isFormatIssue =
        err instanceof OpenRouterError &&
        /response_format|json_object|not.*support/i.test(err.message);
      if (!isFormatIssue) throw err;
      return finish(
        (await openrouterChat(
          { model: m, messages, max_tokens: maxTokens, temperature: 0.2 },
          opts
        )) as ChatCompletion
      );
    }
  };

  return firstSuccess(models.map((m) => attempt(m)));
}

/**
 * High-level helper: send text to the model fleet, get back a parsed JSON
 * object anchored on `anchorKey`. Throws with readable errors otherwise.
 */
export async function extractStructured(
  userContent: string,
  systemPrompt: string,
  anchorKey: string,
  model: string
): Promise<Record<string, unknown>> {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  let content: string;
  try {
    content = await raceStructured(messages, anchorKey, model);
  } catch (err) {
    throw err instanceof Error ? err : new Error("Extraction failed");
  }

  if (!content.trim()) {
    throw new Error("Model returned an empty response, please try again (providers are busy)");
  }

  const parsed = parseAnchoredObject(content, anchorKey);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Model did not return valid JSON.");
  }
  return parsed as Record<string, unknown>;
}
