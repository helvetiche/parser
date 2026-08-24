import { openrouterChat, type ChatCompletion } from "./openrouter";
import { DEFAULT_MODEL } from "./models";

export async function chat(
  messages: Array<{ role: string; content: string }>,
  model: string = DEFAULT_MODEL
) {
  const systemMessage = {
    role: "system",
    content:
      "You are a helpful assistant. Never create, generate, or output tables in any format (including Markdown tables). If information would naturally be presented in a table, use a bulleted or numbered list instead.",
  };

  const data = (await openrouterChat({
    model,
    messages: [systemMessage, ...messages],
    max_tokens: 1024,
    temperature: 0.7,
  })) as ChatCompletion;

  return data.choices?.[0]?.message?.content || "No response";
}
