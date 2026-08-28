"use client";

import {
  Article,
  Brain,
  Clock,
  GraduationCap,
  Lightning,
  Phone,
  Plus,
  Trash,
  Wallet,
  WarningCircle,
  X,
  Check,
  ArrowRight,
  FloppyDisk,
} from "@phosphor-icons/react";
import { useState } from "react";
import Drawer from "@/components/ui/Drawer";
import DetailsSection from "@/components/ui/DetailsSection";
import { ModalCloseButton } from "@/components/ui/Modal";
import type { Candidate, ContactItem, ContactType } from "@/lib/candidate-schema";
import { getInitials } from "@/components/candidates/CandidatesTable";

type Props = {
  candidate: Candidate;
  fileName: string;
  index: number;
  total: number;
  saving: boolean;
  onChange: (patch: Partial<Candidate>) => void;
  onSave: () => void;
  onSaveAndNext: () => void;
  onDiscard: () => void;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
};

export default function ReviewCandidateDrawer({
  candidate,
  fileName,
  index,
  total,
  saving,
  onChange,
  onSave,
  onSaveAndNext,
  onDiscard,
  onClose,
  onPrev,
  onNext,
}: Props) {
  const [newSkill, setNewSkill] = useState("");
  const [newExp, setNewExp] = useState("");
  const [skillError, setSkillError] = useState<string | null>(null);

  const addSkill = () => {
    const v = newSkill.trim();
    if (!v) return;
    if (candidate.skills.some((s) => s.toLowerCase() === v.toLowerCase())) {
      setSkillError("Skill already added");
      return;
    }
    onChange({ skills: [...candidate.skills, v] });
    setNewSkill("");
    setSkillError(null);
  };
  const removeSkill = (skill: string) => {
    onChange({ skills: candidate.skills.filter((s) => s !== skill) });
  };

  const addExperience = () => {
    const v = newExp.trim();
    if (!v) return;
    onChange({ experience: [...candidate.experience, v] });
    setNewExp("");
  };
  const removeExperience = (idx: number) => {
    onChange({ experience: candidate.experience.filter((_, i) => i !== idx) });
  };
  const updateExperience = (idx: number, val: string) => {
    const next = [...candidate.experience];
    next[idx] = val;
    onChange({ experience: next });
  };

  const updateContact = (idx: number, patch: Partial<ContactItem>) => {
    const next = [...candidate.contacts];
    next[idx] = { ...next[idx], ...patch };
    onChange({ contacts: next });
  };
  const removeContact = (idx: number) => {
    onChange({ contacts: candidate.contacts.filter((_, i) => i !== idx) });
  };
  const addContact = () => {
    onChange({ contacts: [...candidate.contacts, { type: "other" as ContactType, value: "" }] });
  };

  const wordCount = candidate.summary.trim().split(/\s+/).filter(Boolean).length;
  const overLimit = wordCount > 50;

  const canSave = candidate.fullName.trim().length > 0 && !overLimit;

  return (
    <Drawer labelledBy="review-candidate-title" onClose={onClose} size="lg" busy={saving}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gray-200 to-gray-300 text-lg font-bold text-gray-600 ring-1 ring-gray-900/5 ring-inset">
            {getInitials(candidate.fullName || "NA")}
          </span>
          <div className="min-w-0">
            <h3 id="review-candidate-title" className="truncate text-xl font-semibold tracking-tight text-gray-900">
              Review Parsed Resume
            </h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-gray-900 px-2.5 py-1 text-xs font-medium text-white">
                {index + 1} / {total}
              </span>
              <span className="max-w-[220px] truncate rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-200/70 ring-inset">
                {fileName}
              </span>
              {total > 1 && (
                <span className="flex items-center gap-1">
                  <button
                    onClick={onPrev}
                    disabled={index === 0}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                  >
                    ←
                  </button>
                  <button
                    onClick={onNext}
                    disabled={index === total - 1}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                  >
                    →
                  </button>
                </span>
              )}
            </div>
          </div>
        </div>
        <ModalCloseButton onClose={onClose} disabled={saving} />
      </div>

      <div className="border-t border-gray-100" />

      {/* Info banner */}
      <div className="mx-6 mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-100 ring-inset">
        <span className="font-semibold">Review before saving.</span> AI extraction may contain inaccuracies — edit any field below. Nothing is saved to the database until you confirm.
      </div>

      <div className="chat-scroll flex-1 space-y-7 overflow-y-auto px-6 py-6">
        {/* Full Name */}
        <DetailsSection icon={Article} title="Full Name">
          <input
            value={candidate.fullName}
            onChange={(e) => onChange({ fullName: e.target.value })}
            placeholder="Candidate full name"
            className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-medium text-gray-900 shadow-sm outline-none placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
          />
          {candidate.fullName.trim().length === 0 && (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-red-500">
              <WarningCircle size={12} weight="fill" /> Full name is required
            </p>
          )}
        </DetailsSection>

        {/* Summary */}
        <DetailsSection icon={Article} title="Summary">
          <textarea
            value={candidate.summary}
            onChange={(e) => onChange({ summary: e.target.value })}
            placeholder="1–2 sentence professional summary (max 50 words)"
            rows={3}
            className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-gray-700 shadow-sm outline-none placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
          />
          <div className="mt-1.5 flex justify-between text-xs">
            <span className={overLimit ? "font-medium text-red-500" : "text-gray-400"}>
              {wordCount} / 50 words {overLimit && "— will be truncated on save"}
            </span>
            <span className="text-gray-400">AI-generated, please verify</span>
          </div>
        </DetailsSection>

        <div className="grid grid-cols-1 gap-7 sm:grid-cols-2">
          <DetailsSection icon={GraduationCap} title="Education">
            <textarea
              value={candidate.education}
              onChange={(e) => onChange({ education: e.target.value })}
              placeholder="Most relevant education"
              rows={3}
              className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-gray-700 shadow-sm outline-none placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
            />
          </DetailsSection>
          <DetailsSection icon={Wallet} title="Expected Salary">
            <input
              value={candidate.expectedSalary}
              onChange={(e) => onChange({ expectedSalary: e.target.value })}
              placeholder="$120,000 or N/A"
              className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-semibold tracking-tight text-gray-900 shadow-sm outline-none placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
            />
          </DetailsSection>
        </div>

        {/* Experience */}
        <DetailsSection icon={Clock} title={`Experience (${candidate.experience.length})`}>
          <div className="space-y-2">
            {candidate.experience.map((exp, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={exp}
                  onChange={(e) => updateExperience(i, e.target.value)}
                  placeholder="e.g. 4 yrs — Frontend Lead at Acme Corp"
                  className="flex-1 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-700 shadow-sm outline-none placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
                />
                <button
                  onClick={() => removeExperience(i)}
                  className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-400 shadow-sm transition-colors hover:bg-red-50 hover:text-red-500 hover:border-red-200"
                >
                  <Trash size={16} />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                value={newExp}
                onChange={(e) => setNewExp(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addExperience();
                  }
                }}
                placeholder="Add experience — press Enter"
                className="flex-1 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 px-3.5 py-2.5 text-sm text-gray-700 outline-none placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:ring-2 focus:ring-gray-100"
              />
              <button
                onClick={addExperience}
                disabled={!newExp.trim()}
                className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-gray-900 text-white shadow-sm transition-colors hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus size={16} weight="bold" />
              </button>
            </div>
          </div>
        </DetailsSection>

        {/* Skills */}
        <DetailsSection icon={Lightning} title={`Skills (${candidate.skills.length})`}>
          <div className="flex flex-wrap gap-2">
            {candidate.skills.map((skill) => (
              <span
                key={skill}
                className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 pl-3 pr-1.5 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-200/80 ring-inset"
              >
                {skill}
                <button
                  onClick={() => removeSkill(skill)}
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-gray-400 ring-1 ring-gray-200 transition-colors hover:bg-red-50 hover:text-red-500"
                >
                  <X size={10} weight="bold" />
                </button>
              </span>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={newSkill}
              onChange={(e) => {
                setNewSkill(e.target.value);
                if (skillError) setSkillError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSkill();
                }
              }}
              placeholder="Add skill — press Enter (e.g. React)"
              className="flex-1 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 px-3.5 py-2 text-sm text-gray-700 outline-none placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:ring-2 focus:ring-gray-100"
            />
            <button
              onClick={addSkill}
              disabled={!newSkill.trim()}
              className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
          {skillError && <p className="mt-1.5 text-xs text-red-500">{skillError}</p>}
        </DetailsSection>

        {/* Contacts */}
        <DetailsSection icon={Phone} title={`Contacts (${candidate.contacts.length})`}>
          <div className="space-y-2">
            {candidate.contacts.map((c, i) => (
              <div key={i} className="flex gap-2">
                <select
                  value={c.type}
                  onChange={(e) => updateContact(i, { type: e.target.value as ContactType })}
                  className="w-[130px] shrink-0 rounded-xl border border-gray-200 bg-white px-2.5 py-2.5 text-sm font-medium text-gray-700 shadow-sm outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
                >
                  <option value="phone">Phone</option>
                  <option value="email">Email</option>
                  <option value="website">Website</option>
                  <option value="other">Other</option>
                </select>
                <input
                  value={c.value}
                  onChange={(e) => updateContact(i, { value: e.target.value })}
                  placeholder={c.type === "phone" ? "0900 000 0000" : c.type === "email" ? "name@email.com" : "https://..."}
                  className="flex-1 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-700 shadow-sm outline-none placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
                />
                <button
                  onClick={() => removeContact(i)}
                  className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-400 shadow-sm transition-colors hover:bg-red-50 hover:text-red-500 hover:border-red-200"
                >
                  <Trash size={16} />
                </button>
              </div>
            ))}
            <button
              onClick={addContact}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-white hover:border-gray-400 hover:text-gray-900"
            >
              <Plus size={14} weight="bold" /> Add contact
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {candidate.contacts.length === 0 && <span className="text-xs text-gray-400">No contacts — will be saved as empty</span>}
          </div>
        </DetailsSection>

        {/* Reasoning */}
        <DetailsSection icon={Brain} title="AI Reasoning">
          <textarea
            value={candidate.reasoning}
            onChange={(e) => onChange({ reasoning: e.target.value })}
            placeholder="Short rationale for matching"
            rows={3}
            className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-gray-600 shadow-sm outline-none placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
          />
        </DetailsSection>

        <p className="text-center text-xs text-gray-400">Powered by OpenRouter · Verify before saving.</p>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 bg-white px-6 py-4">
        {total > 1 && (
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">
              Editing {index + 1} of {total}
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={onPrev}
                disabled={index === 0 || saving}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-30"
              >
                Previous
              </button>
              <button
                onClick={onNext}
                disabled={index === total - 1 || saving}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-30"
              >
                Next
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={onDiscard}
            disabled={saving}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Discard
          </button>
          <div className="flex items-center gap-2">
            {total > 1 && index < total - 1 && (
              <button
                onClick={onSaveAndNext}
                disabled={!canSave || saving}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-900 bg-white px-4 py-2.5 text-sm font-medium text-gray-900 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-40"
              >
                <FloppyDisk size={16} />
                Save & Next
                <ArrowRight size={14} />
              </button>
            )}
            <button
              onClick={onSave}
              disabled={!canSave || saving}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-gray-700 to-gray-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:shadow-md active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Saving…
                </>
              ) : (
                <>
                  <Check size={16} weight="bold" />
                  Save to Pipeline
                </>
              )}
            </button>
          </div>
        </div>
        {!canSave && <p className="mt-2 text-center text-xs text-red-500">Fix required fields before saving.</p>}
      </div>
    </Drawer>
  );
}
