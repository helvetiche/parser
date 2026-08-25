"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  ChatCenteredDots,
  Cpu,
  FilePdf,
  PaperPlaneRight,
  Paperclip,
  Robot,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import ModelSelect from "@/components/ui/ModelSelect";
import { sendChatMessage } from "@/lib/client-api";
import { DEFAULT_MODEL } from "@/lib/models";
import { createMessage, type Message } from "./types";

type AttachedPdf = {
  name: string;
  text: string;
};

type ChatSidebarProps = {
  open: boolean;
  onClose: () => void;
  pdf: AttachedPdf | null;
  onRemovePdf: () => void;
  /** Called when the user picks a PDF via the paperclip. */
  onAttachFile: (file: File) => void;
  /** True while the parent is parsing an attached PDF. */
  uploading: boolean;
};

/**
 * Reveal `text` progressively over roughly a second, regardless of length.
 */
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

export default function ChatSidebar({
  open,
  onClose,
  pdf,
  onRemovePdf,
  onAttachFile,
  uploading,
}: ChatSidebarProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, loading]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userContent = input.trim();
    // Attach PDF content to the API payload only; keep what we display clean.
    const apiContent = pdf ? `${userContent}\n\n**PDF Content:**\n${pdf.text}` : userContent;

    setMessages((prev) => [...prev, createMessage("user", userContent)]);
    setInput("");
    setLoading(true);
    setStreamingText("");

    try {
      const apiMessages = [
        ...messages.map(({ role, content }) => ({ role, content })),
        { role: "user", content: apiContent },
      ];
      const result = await sendChatMessage(apiMessages, model);

      await typewriter(result, setStreamingText);
      setMessages((prev) => [...prev, createMessage("assistant", result)]);
      setStreamingText("");
    } catch {
      setMessages((prev) => [...prev, createMessage("assistant", "Error: failed to get response")]);
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
    <>
      {/* Backdrop */}
      {open && (
        <div onClick={onClose} className="fixed inset-0 z-40 bg-gray-950/25 backdrop-blur-[2px]" />
      )}

      <aside
        className={`fixed top-0 right-0 z-50 flex h-full w-full flex-col rounded-l-3xl border-l border-gray-200/80 bg-white shadow-2xl transition-transform duration-300 ease-out sm:w-[540px] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <header className="flex items-center gap-3 border-b border-gray-200/80 px-6 py-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gray-600 to-gray-900 text-white shadow-md">
            <Sparkle size={19} weight="fill" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold tracking-tight text-gray-900">
              Parser Chat
            </h1>
            <p className="truncate text-xs text-gray-400">Chat with your documents</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close chat"
          >
            <X size={18} weight="bold" />
          </button>
        </header>

        {/* Model selector */}
        <div className="border-b border-gray-200/80 bg-gray-50/60 px-6 py-4">
          <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold tracking-wider text-gray-500 uppercase">
            <Cpu size={13} />
            Model
          </label>
          <ModelSelect value={model} onChange={setModel} ariaLabel="Chat model" />
        </div>

        {/* PDF context chip */}
        {pdf && (
          <div className="px-6 pt-4">
            <div className="flex items-center gap-3 rounded-xl border border-gray-200/80 bg-gray-50 px-3.5 py-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-200/80 text-gray-600">
                <FilePdf size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-gray-800">{pdf.name}</div>
                <div className="text-xs text-gray-400">Loaded as conversation context</div>
              </div>
              <button
                onClick={onRemovePdf}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-200/70 hover:text-gray-700"
                aria-label="Remove PDF"
              >
                <X size={15} weight="bold" />
              </button>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="chat-scroll flex-1 space-y-5 overflow-y-auto bg-gradient-to-b from-gray-50/50 to-transparent px-6 py-6">
          {messages.length === 0 && !loading && streamingText === "" && !uploading && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 text-gray-400 ring-1 ring-gray-200/70 ring-inset">
                <ChatCenteredDots size={30} />
              </div>
              <p className="text-sm font-medium text-gray-600">Start a conversation</p>
              <p className="mt-1 max-w-[240px] text-xs leading-relaxed text-gray-400">
                Ask anything, or drop a PDF anywhere to use it as context.
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
        <div className="border-t border-gray-200/80 bg-white/80 p-4">
          <div className="flex items-end gap-1.5 rounded-2xl border border-gray-200 bg-white px-2.5 py-2 shadow-sm transition-all focus-within:border-gray-300 focus-within:ring-2 focus-within:ring-gray-200">
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) onAttachFile(file);
              }}
              className="hidden"
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              className="cursor-pointer rounded-xl p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
              aria-label="Attach a PDF"
              title="Attach a PDF"
            >
              <Paperclip size={19} />
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={uploading ? "Parsing PDF…" : "Type a message…"}
              className="max-h-36 flex-1 resize-none bg-transparent px-1 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
              rows={1}
              disabled={loading || uploading}
            />
            <button
              onClick={() => void sendMessage()}
              disabled={loading || !input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gray-700 to-gray-900 text-white shadow-sm transition-all duration-150 hover:from-gray-600 hover:to-gray-800 active:scale-95 disabled:opacity-30 disabled:hover:from-gray-700 disabled:hover:to-gray-900"
              aria-label="Send message"
            >
              <PaperPlaneRight size={16} weight="fill" />
            </button>
          </div>
          <p className="mt-2 text-center text-[12px] text-gray-400">
            Enter to send · Shift + Enter for a new line
          </p>
        </div>
      </aside>
    </>
  );
}

const formatTime = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function MessageBubble({ message, streaming }: { message: Message; streaming: boolean }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start gap-2.5"}`}>
      {!isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gray-600 to-gray-900 text-white shadow-sm">
          <Robot size={15} weight="fill" />
        </div>
      )}
      <div className="flex max-w-[78%] flex-col">
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
          <span
            className={`mt-1.5 text-[12px] font-medium text-gray-400 ${
              isUser ? "text-right" : "pl-0.5 text-left"
            }`}
          >
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
