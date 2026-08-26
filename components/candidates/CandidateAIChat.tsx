"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ChatCenteredDots, PaperPlaneRight, Robot, Sparkle, X } from "@phosphor-icons/react";
import ModelSelect from "@/components/ui/ModelSelect";
import { sendChatMessage } from "@/lib/client-api";
import { DEFAULT_MODEL } from "@/lib/models";
import { createMessage, type Message } from "@/components/chat/types";
import type { CandidateRow } from "@/lib/candidate-schema";

/** Builds a recruiter-facing system prompt from the candidate profile. */
function buildContext(c: CandidateRow): string {
  const lines = [
    "You are assisting a recruiter with a specific candidate. Use ONLY the candidate profile below to answer; do not invent details.",
    `Name: ${c.fullName}`,
    c.summary ? `Summary: ${c.summary}` : "",
    c.education ? `Education: ${c.education}` : "",
    c.experience.length ? `Experience:\n- ${c.experience.join("\n- ")}` : "",
    c.skills.length ? `Skills: ${c.skills.join(", ")}` : "",
    c.expectedSalary ? `Expected Salary: ${c.expectedSalary}` : "",
    c.contacts.length
      ? `Contacts: ${c.contacts.map((x) => `${x.type}: ${x.value}`).join("; ")}`
      : "",
    c.reasoning ? `AI Reasoning: ${c.reasoning}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

/** Reveal `text` progressively over roughly a second, regardless of length. */
function typewriter(text: string, render: (partial: string) => void) {
  return new Promise<void>((resolve) => {
    const totalFrames = 60;
    const step = Math.max(1, Math.ceil(text.length / totalFrames));
    let index = 0;
    const timer = setInterval(() => {
      index += step;
      if (index >= text.length) {
        render(text);
        clearInterval(timer);
        resolve();
      } else {
        render(text.slice(0, index));
      }
    }, 16);
  });
}

const formatTime = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function CandidateAIChat({
  candidate,
  onClose,
}: {
  candidate: CandidateRow;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const bottomRef = useRef<HTMLDivElement>(null);
  const context = useRef(buildContext(candidate)).current;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, loading]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setMessages((prev) => [...prev, createMessage("user", text)]);
    setInput("");
    setLoading(true);
    setStreamingText("");

    try {
      const apiMessages = [
        ...messages.map(({ role, content }) => ({ role, content })),
        { role: "user", content: text },
      ];
      const result = await sendChatMessage(apiMessages, model, context);
      await typewriter(result, setStreamingText);
      setMessages((prev) => [...prev, createMessage("assistant", result)]);
      setStreamingText("");
    } catch {
      setMessages((prev) => [
        ...prev,
        createMessage("assistant", "Error: failed to get response"),
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  return (
    <div className="flex h-full flex-col bg-gray-50/40">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-gray-200/80 px-5 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gray-600 to-gray-900 text-white shadow-md">
          <Sparkle size={17} weight="fill" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold tracking-tight text-gray-900">
            Ask AI · {candidate.fullName}
          </h2>
          <p className="truncate text-xs text-gray-400">Answers use this candidate&apos;s profile</p>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-200/70 hover:text-gray-700"
          aria-label="Close AI chat"
        >
          <X size={17} weight="bold" />
        </button>
      </header>

      {/* Model selector */}
      <div className="border-b border-gray-200/80 bg-white/60 px-5 py-3">
        <ModelSelect value={model} onChange={setModel} ariaLabel="AI chat model" />
      </div>

      {/* Messages */}
      <div className="chat-scroll flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {messages.length === 0 && streamingText === "" && !loading && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-400 ring-1 ring-gray-200/70 ring-inset">
              <ChatCenteredDots size={26} />
            </div>
            <p className="text-sm font-medium text-gray-600">Ask about this candidate</p>
            <p className="mt-1 max-w-[230px] text-xs leading-relaxed text-gray-400">
              The AI answers using the candidate&apos;s parsed profile as context.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} streaming={false} />
        ))}

        {streamingText !== "" && (
          <MessageBubble
            message={{ role: "assistant", content: streamingText, createdAt: 0 }}
            streaming
          />
        )}

        {loading && streamingText === "" && <TypingIndicator />}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-gray-200/80 bg-white/80 p-3">
        <div className="flex items-end gap-1.5 rounded-2xl border border-gray-200 bg-white px-2.5 py-2 shadow-sm transition-all focus-within:border-gray-300 focus-within:ring-2 focus-within:ring-gray-200">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask something about this candidate…"
            className="max-h-36 flex-1 resize-none bg-transparent px-1 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
            rows={1}
            disabled={loading}
          />
          <button
            onClick={() => void sendMessage()}
            disabled={loading || !input.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gray-700 to-gray-900 text-white shadow-sm transition-all duration-150 hover:from-gray-600 hover:to-gray-800 active:scale-95 disabled:opacity-30"
            aria-label="Send message"
          >
            <PaperPlaneRight size={16} weight="fill" />
          </button>
        </div>
        <p className="mt-1.5 text-center text-[12px] text-gray-400">
          Enter to send · Shift + Enter for a new line
        </p>
      </div>
    </div>
  );
}

function MessageBubble({ message, streaming }: { message: Message; streaming: boolean }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start gap-2.5"}`}>
      {!isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gray-600 to-gray-900 text-white shadow-sm">
          <Robot size={15} weight="fill" />
        </div>
      )}
      <div className="flex max-w-[82%] flex-col">
        <div
          className={`px-4 py-3 text-sm leading-relaxed shadow-sm ${
            isUser
              ? "rounded-2xl rounded-tr-md bg-gradient-to-br from-gray-800 to-gray-950 text-white"
              : "markdown-content rounded-2xl rounded-tl-md border border-gray-200/80 bg-white text-gray-800"
          }`}
        >
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
        {!streaming && (
          <span className="mt-1.5 pl-0.5 text-[12px] font-medium text-gray-400">
            {formatTime(message.createdAt)}
          </span>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start gap-2.5">
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gray-600 to-gray-900 text-white shadow-sm">
        <Robot size={15} weight="fill" />
      </div>
      <div className="rounded-2xl rounded-tl-md border border-gray-200/80 bg-white px-5 py-4 shadow-sm">
        <div className="flex gap-1.5">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:0.15s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:0.3s]" />
        </div>
      </div>
    </div>
  );
}
