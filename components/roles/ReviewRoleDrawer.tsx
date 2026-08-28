"use client";

import {
  Article,
  Briefcase,
  Check,
  ClipboardText,
  Lightning,
  ListChecks,
  Plus,
  Trash,
  WarningCircle,
  X,
  ArrowRight,
  FloppyDisk,
} from "@phosphor-icons/react";
import { useState } from "react";
import Drawer from "@/components/ui/Drawer";
import DetailsSection from "@/components/ui/DetailsSection";
import { ModalCloseButton } from "@/components/ui/Modal";
import type { RoleData } from "@/lib/role-schema";

type Props = {
  role: RoleData;
  fileName: string;
  index: number;
  total: number;
  saving: boolean;
  onChange: (patch: Partial<RoleData>) => void;
  onSave: () => void;
  onSaveAndNext: () => void;
  onDiscard: () => void;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
};

function ListEditor({
  items,
  listKey,
  inputVal,
  setInputVal,
  placeholder,
  onUpdate,
  onRemove,
  onAdd,
}: {
  items: string[];
  listKey: "responsibilities" | "requirements" | "skills";
  inputVal: string;
  setInputVal: (v: string) => void;
  placeholder: string;
  onUpdate: (key: "responsibilities" | "requirements" | "skills", idx: number, val: string) => void;
  onRemove: (key: "responsibilities" | "requirements" | "skills", idx: number) => void;
  onAdd: (key: "responsibilities" | "requirements" | "skills", val: string, setVal: (v: string) => void) => void;
}) {
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex gap-2">
          <input
            value={it}
            onChange={(e) => onUpdate(listKey, i, e.target.value)}
            placeholder={placeholder}
            className="flex-1 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-700 shadow-sm outline-none placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
          />
          <button
            onClick={() => onRemove(listKey, i)}
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-400 shadow-sm transition-colors hover:bg-red-50 hover:text-red-500 hover:border-red-200"
          >
            <Trash size={16} />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd(listKey, inputVal, setInputVal);
            }
          }}
          placeholder={`Add ${listKey.slice(0, -1)} — press Enter`}
          className="flex-1 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 px-3.5 py-2.5 text-sm text-gray-700 outline-none placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:ring-2 focus:ring-gray-100"
        />
        <button
          onClick={() => onAdd(listKey, inputVal, setInputVal)}
          disabled={!inputVal.trim()}
          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-gray-900 text-white shadow-sm transition-colors hover:bg-black disabled:opacity-40"
        >
          <Plus size={16} weight="bold" />
        </button>
      </div>
    </div>
  );
}

export default function ReviewRoleDrawer({
  role,
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
  const updateList = (key: "responsibilities" | "requirements" | "skills", idx: number, val: string) => {
    const next = [...role[key]];
    next[idx] = val;
    onChange({ [key]: next } as Partial<RoleData>);
  };
  const removeFromList = (key: "responsibilities" | "requirements" | "skills", idx: number) => {
    const next = role[key].filter((_, i) => i !== idx);
    onChange({ [key]: next } as Partial<RoleData>);
  };
  const addToList = (key: "responsibilities" | "requirements" | "skills", val: string, setVal: (v: string) => void) => {
    const v = val.trim();
    if (!v) return;
    if (role[key].some((s) => s.toLowerCase() === v.toLowerCase())) return;
    onChange({ [key]: [...role[key], v] } as Partial<RoleData>);
    setVal("");
  };

  const [newResp, setNewResp] = useState("");
  const [newReq, setNewReq] = useState("");
  const [newSkill, setNewSkill] = useState("");

  const canSave = role.jobTitle.trim().length > 0;

  return (
    <Drawer labelledBy="review-role-title" onClose={onClose} size="lg" busy={saving}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gray-700 to-gray-900 text-white shadow-sm">
            <Briefcase size={24} weight="fill" />
          </span>
          <div className="min-w-0">
            <h3 id="review-role-title" className="truncate text-xl font-semibold tracking-tight text-gray-900">
              Review Parsed JD
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
                  <button onClick={onPrev} disabled={index === 0} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30">
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

      <div className="mx-6 mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-100 ring-inset">
        <span className="font-semibold">Review before saving.</span> Structure is AI-generated — edit titles, responsibilities, requirements or skills below before it enters the pipeline.
      </div>

      <div className="chat-scroll flex-1 space-y-7 overflow-y-auto px-6 py-6">
        {/* Job Title */}
        <DetailsSection icon={Briefcase} title="Job Title">
          <input
            value={role.jobTitle}
            onChange={(e) => onChange({ jobTitle: e.target.value })}
            placeholder="e.g. Senior Frontend Engineer"
            className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-gray-900 shadow-sm outline-none placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
          />
          {role.jobTitle.trim().length === 0 && (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-red-500">
              <WarningCircle size={12} weight="fill" /> Job title is required
            </p>
          )}
        </DetailsSection>

        {/* Description */}
        <DetailsSection icon={Article} title="Description">
          <textarea
            value={role.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="2–3 sentence overview of the role and company"
            rows={3}
            className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-gray-700 shadow-sm outline-none placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
          />
        </DetailsSection>

        {/* Responsibilities */}
        <DetailsSection icon={ListChecks} title={`Responsibilities (${role.responsibilities.length})`}>
          <ListEditor
            items={role.responsibilities}
            listKey="responsibilities"
            inputVal={newResp}
            setInputVal={setNewResp}
            placeholder="e.g. Own the component library"
            onUpdate={updateList}
            onRemove={removeFromList}
            onAdd={addToList}
          />
        </DetailsSection>

        {/* Requirements */}
        <DetailsSection icon={ClipboardText} title={`Requirements (${role.requirements.length})`}>
          <ListEditor
            items={role.requirements}
            listKey="requirements"
            inputVal={newReq}
            setInputVal={setNewReq}
            placeholder="e.g. 5+ years React experience"
            onUpdate={updateList}
            onRemove={removeFromList}
            onAdd={addToList}
          />
        </DetailsSection>

        {/* Skills */}
        <DetailsSection icon={Lightning} title={`Skills Required (${role.skills.length})`}>
          <ListEditor
            items={role.skills}
            listKey="skills"
            inputVal={newSkill}
            setInputVal={setNewSkill}
            placeholder="e.g. TypeScript"
            onUpdate={updateList}
            onRemove={removeFromList}
            onAdd={addToList}
          />
          {role.skills.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {role.skills.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 ring-1 ring-gray-200/80 ring-inset"
                >
                  {s}
                  <button onClick={() => removeFromList("skills", role.skills.indexOf(s))} className="ml-1 text-gray-400 hover:text-red-500">
                    <X size={10} weight="bold" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </DetailsSection>

        <p className="text-center text-xs text-gray-400">Powered by OpenRouter · Verify before saving.</p>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 bg-white px-6 py-4">
        {total > 1 && (
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">Editing {index + 1} of {total}</span>
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
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-gray-700 to-gray-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:shadow-md active:scale-[0.98] disabled:opacity-40"
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
        {!canSave && <p className="mt-2 text-center text-xs text-red-500">Job title is required before saving.</p>}
      </div>
    </Drawer>
  );
}
