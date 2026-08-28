import {
  openrouterChat,
  tokenUsageFromCompletion,
  type ChatCompletion,
  type TokenUsage,
} from "./openrouter";
import { DEFAULT_MODEL } from "./models";

export type ChatWithUsageResult = {
  result: string;
  usage: TokenUsage;
  model: string;
};

export async function chat(
  messages: Array<{ role: string; content: string }>,
  model: string = DEFAULT_MODEL,
  systemContext?: string
): Promise<string> {
  const { result } = await chatWithUsage(messages, model, systemContext);
  return result;
}

export async function chatWithUsage(
  messages: Array<{ role: string; content: string }>,
  model: string = DEFAULT_MODEL,
  systemContext?: string
): Promise<ChatWithUsageResult> {
  const base =
    "You are a precise, helpful assistant. " +
    "Guidelines:\n" +
    "- Think step by step for non-trivial questions, but keep answers concise.\n" +
    "- If a question depends on current events, live data, recent facts, or anything " +
    "beyond your training knowledge, use the web_search tool to look it up rather than guessing.\n" +
    "- Prefer authoritative sources and cite the URLs you relied on when you use them.\n" +
    "- If you are uncertain or lack reliable information, say so instead of inventing details.\n" +
    "- Never create, generate, or output tables in any format (including Markdown tables). " +
    "If information would naturally be presented in a table, use a bulleted or numbered list instead.";
  const systemMessage = {
    role: "system",
    content: systemContext ? `${base}\n\n${systemContext}` : base,
  };

  const data = (await openrouterChat({
    model,
    messages: [systemMessage, ...messages],
    max_tokens: 2048,
    temperature: 0.7,
    // Native OpenRouter web search. The model decides when to call it;
    // OpenRouter runs the search and injects the results into the context.
    tools: [{ type: "web_search" }],
  })) as ChatCompletion;

  const usage = tokenUsageFromCompletion(data, model);
  return {
    result: data.choices?.[0]?.message?.content || "No response",
    usage,
    model: data.model || model,
  };
}
