export type MessageRole = "user" | "assistant";

export type Message = {
  role: MessageRole;
  content: string;
  createdAt: number;
};

export function createMessage(role: MessageRole, content: string): Message {
  return { role, content, createdAt: Date.now() };
}
