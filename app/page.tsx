"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import {
  ChatCircleDots,
  ClipboardText,
  FileArrowUp,
  Sparkle,
  UploadSimple,
  Users,
  WarningCircle,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import ChatSidebar from "@/components/chat/ChatSidebar";
import CandidatesTable from "@/components/candidates/CandidatesTable";
import UploadResumeModal from "@/components/candidates/UploadResumeModal";
import AuthGate from "@/components/auth/AuthGate";
import LogoutButton from "@/components/auth/LogoutButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ModelSelect from "@/components/ui/ModelSelect";
import RoleDescription from "@/components/RoleDescription";
import { deleteCandidate, parsePdfFile, type CandidatesResponse } from "@/lib/client-api";
import type { CandidateRow } from "@/lib/candidate-schema";
import { cacheKeys } from "@/lib/cache-keys";
import { DEFAULT_MODEL } from "@/lib/models";

type TabId = "candidates" | "role";

const TABS: { id: TabId; label: string; icon: Icon }[] = [
  { id: "candidates", label: "Candidates", icon: Users },
  { id: "role", label: "Role Description", icon: ClipboardText },
];

type AttachedPdf = {
  name: string;
  text: string;
};

export default function Parser() {
  return (
    <AuthGate>
      <ParserApp />
    </AuthGate>
  );
}

function ParserApp() {
  const [activeTab, setActiveTab] = useState<TabId>("candidates");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // PDF attached as chat context
  const [pdf, setPdf] = useState<AttachedPdf | null>(null);
  const [uploading, setUploading] = useState(false);

  // Global drag-to-attach
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  // Candidates list — fetched and cached via SWR
  const {
    data,
    isLoading: listLoading,
    error: listError,
    mutate: mutateCandidates,
  } = useSWR<CandidatesResponse>(cacheKeys.candidates);
  const candidates = data?.candidates ?? [];
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [parserModel, setParserModel] = useState(DEFAULT_MODEL);
  const [pendingDelete, setPendingDelete] = useState<CandidateRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const attachPdf = async (file: File | undefined) => {
    if (!file) return;
    if (file.type !== "application/pdf") {
      setNotice("Please upload a PDF file");
      return;
    }

    setUploading(true);
    try {
      const text = await parsePdfFile(file);
      setPdf({ name: file.name, text });
    } catch {
      setNotice("Failed to process PDF");
    } finally {
      setUploading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteCandidate(pendingDelete.id);
      setPendingDelete(null);
      await mutateCandidates();
    } catch {
      setNotice("Failed to delete candidate");
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) {
      dragCounter.current++;
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    void attachPdf(e.dataTransfer.files?.[0]);
  };

  return (
    <main
      className="min-h-screen bg-gradient-to-b from-gray-100 via-gray-50 to-gray-200 text-gray-900 antialiased"
      onDragEnter={handleDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Navigation */}
      <nav className="sticky top-0 z-30 border-b border-gray-200/80 bg-white/70 backdrop-blur-xl">
        <div className="flex h-16 w-full items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-gray-600 to-gray-900 text-white shadow-md">
              <Sparkle size={18} weight="fill" />
            </div>
            <div className="leading-tight">
              <span className="block text-base font-semibold tracking-tight">Parser</span>
              <span className="block text-[13px] font-medium text-gray-400">AI resume parsing</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <LogoutButton />
            <button
              onClick={() => setSidebarOpen(true)}
              className="group flex items-center gap-2 rounded-xl bg-gradient-to-b from-gray-700 to-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:shadow-md active:scale-[0.98]"
            >
              <ChatCircleDots size={17} />
              Chat
            </button>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <div className="w-full px-5 py-10">
        {/* Tab navigation */}
        <div className="mb-8 flex w-fit items-center gap-1 rounded-xl border border-gray-200/70 bg-gray-100/70 p-1 backdrop-blur">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-150 ${
                  active ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"
                }`}
              >
                <tab.icon size={16} weight={active ? "fill" : "regular"} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === "candidates" && (
          <>
            <CandidatesHeader
              count={candidates.length}
              notice={notice ?? (listError ? "Failed to load candidates" : null)}
              parserModel={parserModel}
              onModelChange={setParserModel}
              onUpload={() => {
                setNotice(null);
                setUploadOpen(true);
              }}
            />
            <CandidatesTable
              candidates={candidates}
              loading={listLoading}
              onDeleteRequest={setPendingDelete}
            />

            <p className="mt-4 text-center text-xs text-gray-400">
              Powered by OpenRouter · Parsed data may contain inaccuracies, always verify.
            </p>
          </>
        )}

        {activeTab === "role" && <RoleDescription />}
      </div>

      {/* Drag overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/70 p-6 backdrop-blur-sm">
          <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-3xl border-2 border-dashed border-gray-400/50 px-12 py-16 text-center text-white">
            <FileArrowUp size={44} />
            <div>
              <p className="text-lg font-semibold">Drop PDF to attach</p>
              <p className="mt-1 text-sm text-gray-300">Release to parse this document</p>
            </div>
          </div>
        </div>
      )}

      {/* Chat sidebar */}
      <ChatSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        pdf={pdf}
        uploading={uploading}
        onRemovePdf={() => setPdf(null)}
        onAttachFile={(file) => void attachPdf(file)}
      />

      {/* Upload resume modal */}
      {uploadOpen && (
        <UploadResumeModal
          onClose={() => setUploadOpen(false)}
          model={parserModel}
          notice={notice}
          onNotice={setNotice}
        />
      )}

      {/* Delete confirmation */}
      {pendingDelete && (
        <ConfirmDialog
          title="Delete candidate?"
          subject={pendingDelete.fullName}
          consequence="from the pipeline. This cannot be undone."
          busy={deleteBusy}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      )}
    </main>
  );
}

function CandidatesHeader({
  count,
  notice,
  parserModel,
  onModelChange,
  onUpload,
}: {
  count: number;
  notice: string | null;
  parserModel: string;
  onModelChange: (model: string) => void;
  onUpload: () => void;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="mb-1 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-gray-600 to-gray-900 text-white shadow-md">
            <Users size={18} weight="fill" />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-gray-900">Candidates</h2>
          <span className="rounded-full bg-gray-900/5 px-2.5 py-1 text-xs font-semibold text-gray-500 ring-1 ring-gray-900/10 ring-inset">
            {count}
          </span>
        </div>
        <p className="text-sm text-gray-500">Resumes parsed with AI show up here automatically.</p>
      </div>
      <div className="flex items-center gap-3">
        {notice && (
          <span className="flex max-w-xs items-center gap-1.5 truncate rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-600 ring-1 ring-red-100 ring-inset">
            <WarningCircle size={14} weight="fill" className="shrink-0" />
            <span className="truncate">{notice}</span>
          </span>
        )}
        <div className="w-64">
          <ModelSelect
            value={parserModel}
            onChange={onModelChange}
            ariaLabel="Parser model"
            title="Model used to parse resumes"
          />
        </div>
        <button
          onClick={onUpload}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-b from-gray-700 to-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:shadow-md active:scale-[0.98]"
        >
          <UploadSimple size={17} />
          Upload Resume
        </button>
      </div>
    </div>
  );
}
