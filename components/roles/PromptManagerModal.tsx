"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  CircleNotch,
  NotePencil,
  PencilSimple,
  Plus,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import Modal, { ModalCloseButton } from "@/components/ui/Modal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { createPrompt, deletePrompt, updatePrompt, type PromptsResponse } from "@/lib/client-api";
import { cacheKeys } from "@/lib/cache-keys";
import { PROMPT_BODY_MAX, PROMPT_TITLE_MAX, type PromptRow } from "@/lib/prompt-schema";

type Draft = {
  id: string | null;
  title: string;
  prompt: string;
};

const EMPTY_DRAFT: Draft = { id: null, title: "", prompt: "" };

const INPUT_CLASS =
  "w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-sm transition-colors outline-none placeholder:text-gray-400 focus:border-gray-400 disabled:cursor-not-allowed disabled:bg-gray-50";

export default function PromptManagerModal({ onClose }: { onClose: () => void }) {
  const { data, isLoading, mutate } = useSWR<PromptsResponse>(cacheKeys.prompts);
  const prompts = useMemo(() => data?.prompts ?? [], [data]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PromptRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const startCreate = () => {
    setError(null);
    setDraft({ ...EMPTY_DRAFT });
  };

  const startEdit = (prompt: PromptRow) => {
    setError(null);
    setDraft({ id: prompt.id, title: prompt.title, prompt: prompt.prompt });
  };

  const handleSave = async () => {
    if (!draft || busy) return;
    if (!draft.prompt.trim()) {
      setError("Prompt text is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        title: draft.title.trim() || "Untitled prompt",
        prompt: draft.prompt.trim(),
      };
      if (draft.id) await updatePrompt(draft.id, payload);
      else await createPrompt(payload);
      setDraft(null);
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save prompt");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deletePrompt(pendingDelete.id);
      setPendingDelete(null);
      await mutate();
    } catch {
      setError("Failed to delete prompt");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <Modal labelledBy="prompt-manager-title" onClose={onClose} size="lg" scroll>
      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-5">
        <div>
          <h3
            id="prompt-manager-title"
            className="text-lg font-semibold tracking-tight text-gray-900"
          >
            Evaluation Prompts
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Saved instruction sets for candidate evaluation. The JSON response format stays fixed.
          </p>
        </div>
        <ModalCloseButton onClose={onClose} />
      </div>

      <div className="border-t border-gray-100" />

      <div className="chat-scroll flex-1 space-y-5 overflow-y-auto px-6 py-6">
        {!draft && (
          <button
            onClick={startCreate}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-b from-gray-700 to-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:shadow-md active:scale-[0.98]"
          >
            <Plus size={16} weight="bold" />
            New prompt
          </button>
        )}

        {draft && (
          <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm ring-1 ring-gray-100 ring-inset">
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold tracking-wider text-gray-500 uppercase">
                Title
              </label>
              <input
                type="text"
                value={draft.title}
                maxLength={PROMPT_TITLE_MAX}
                onChange={(e) => setDraft((d) => (d ? { ...d, title: e.target.value } : d))}
                placeholder="e.g. Strict Frontend Recruiter"
                disabled={busy}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold tracking-wider text-gray-500 uppercase">
                Prompt
              </label>
              <textarea
                value={draft.prompt}
                rows={8}
                maxLength={PROMPT_BODY_MAX}
                onChange={(e) => setDraft((d) => (d ? { ...d, prompt: e.target.value } : d))}
                placeholder={
                  "Role: Tech Recruiter\nYou are a Tech Recruiter responsible for evaluating candidates…"
                }
                disabled={busy}
                className={`${INPUT_CLASS} resize-y leading-relaxed`}
              />
              <p className="mt-1.5 text-xs text-gray-400">
                Instructions only — persona, rules, non-negotiables. Output keys and structure are
                managed by the app.
              </p>
            </div>
            {error && (
              <p className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600 ring-1 ring-red-100 ring-inset">
                <WarningCircle size={13} weight="fill" />
                {error}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setDraft(null)}
                disabled={busy}
                className="rounded-xl px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={busy}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-b from-gray-700 to-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy && <CircleNotch size={15} className="animate-spin" />}
                {draft.id ? "Save changes" : "Save prompt"}
              </button>
            </div>
          </div>
        )}

        {/* Saved prompts */}
        <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white/80 shadow-sm backdrop-blur">
          {isLoading ? (
            <p className="px-4 py-8 text-center text-sm text-gray-400">Loading prompts…</p>
          ) : prompts.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-gray-400">
              No saved prompts yet — the default Tech Recruiter instructions are used.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {prompts.map((prompt) => (
                <li key={prompt.id} className="group fade-row flex items-start gap-3 px-4 py-3.5">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 ring-1 ring-gray-200/80 ring-inset">
                    <NotePencil size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">{prompt.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-gray-500">
                      {prompt.prompt}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      onClick={() => startEdit(prompt)}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      aria-label={`Edit ${prompt.title}`}
                      title="Edit prompt"
                    >
                      <PencilSimple size={14} />
                    </button>
                    <button
                      onClick={() => setPendingDelete(prompt)}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                      aria-label={`Delete ${prompt.title}`}
                      title="Delete prompt"
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete prompt?"
          subject={pendingDelete.title}
          consequence="from the system. Evaluations already saved on roles are kept."
          busy={deleteBusy}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      )}
    </Modal>
  );
}
