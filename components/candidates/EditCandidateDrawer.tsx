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
  FloppyDisk,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import Drawer from "@/components/ui/Drawer";
import DetailsSection from "@/components/ui/DetailsSection";
import { ModalCloseButton } from "@/components/ui/Modal";
import type { Candidate, ContactItem, ContactType } from "@/lib/candidate-schema";
import { getInitials } from "@/components/candidates/CandidatesTable";

type Props = {
  candidate: Candidate;
  onClose: () => void;
  onSave: (candidate: Candidate) => Promise<void>;
};

export default function EditCandidateDrawer({ candidate: initial, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<Candidate>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSkill, setNewSkill] = useState("");
  const [newExp, setNewExp] = useState("");
  const [skillError, setSkillError] = useState<string | null>(null);

  // Sync when opening a different candidate
  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional prop sync for edit drawer
  useEffect(() => setDraft(initial), [initial]);

  const patch = (p: Partial<Candidate>) => setDraft((d) => ({ ...d, ...p }));

  const addSkill = () => {
    const v = newSkill.trim();
    if (!v) return;
    if (draft.skills.some((s) => s.toLowerCase() === v.toLowerCase())) {
      setSkillError("Skill already added");
      return;
    }
    patch({ skills: [...draft.skills, v] });
    setNewSkill("");
    setSkillError(null);
  };
  const removeSkill = (s: string) => patch({ skills: draft.skills.filter((x) => x !== s) });
  const addExp = () => {
    const v = newExp.trim();
    if (!v) return;
    patch({ experience: [...draft.experience, v] });
    setNewExp("");
  };
  const removeExp = (idx: number) => patch({ experience: draft.experience.filter((_, i) => i !== idx) });
  const updateExp = (idx: number, val: string) => {
    const next = [...draft.experience];
    next[idx] = val;
    patch({ experience: next });
  };
  const updateContact = (idx: number, p: Partial<ContactItem>) => {
    const next = [...draft.contacts];
    next[idx] = { ...next[idx], ...p };
    patch({ contacts: next });
  };
  const removeContact = (idx: number) => patch({ contacts: draft.contacts.filter((_, i) => i !== idx) });
  const addContact = () => patch({ contacts: [...draft.contacts, { type: "other" as ContactType, value: "" }] });

  const wordCount = draft.summary.trim().split(/\s+/).filter(Boolean).length;
  const overLimit = wordCount > 50;
  const canSave = draft.fullName.trim().length > 0 && !overLimit;

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer labelledBy="edit-candidate-title" onClose={onClose} size="lg" busy={saving}>
      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gray-200 to-gray-300 text-lg font-bold text-gray-600 ring-1 ring-gray-900/5 ring-inset">
            {getInitials(draft.fullName || "NA")}
          </span>
          <div className="min-w-0">
            <h3 id="edit-candidate-title" className="truncate text-xl font-semibold tracking-tight text-gray-900">
              Edit Candidate
            </h3>
            <p className="mt-1 text-xs text-gray-500">Update fields and save changes.</p>
          </div>
        </div>
        <ModalCloseButton onClose={onClose} disabled={saving} />
      </div>
      <div className="border-t border-gray-100" />
      <div className="mx-6 mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-100 ring-inset">
        <span className="font-semibold">Edit mode.</span> Changes are saved directly to the database on confirm.
      </div>

      <div className="chat-scroll flex-1 space-y-7 overflow-y-auto px-6 py-6">
        <DetailsSection icon={Article} title="Full Name">
          <input
            value={draft.fullName}
            onChange={(e) => patch({ fullName: e.target.value })}
            placeholder="Candidate full name"
            className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-medium text-gray-900 shadow-sm outline-none placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
          />
          {draft.fullName.trim().length === 0 && (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-red-500">
              <WarningCircle size={12} weight="fill" /> Full name is required
            </p>
          )}
        </DetailsSection>

        <DetailsSection icon={Article} title="Summary">
          <textarea
            value={draft.summary}
            onChange={(e) => patch({ summary: e.target.value })}
            rows={3}
            placeholder="1–2 sentence professional summary (max 50 words)"
            className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-gray-700 shadow-sm outline-none placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
          />
          <div className="mt-1.5 flex justify-between text-xs">
            <span className={overLimit ? "font-medium text-red-500" : "text-gray-400"}>{wordCount} / 50 words</span>
            <span className="text-gray-400">Please verify</span>
          </div>
        </DetailsSection>

        <div className="grid grid-cols-1 gap-7 sm:grid-cols-2">
          <DetailsSection icon={GraduationCap} title="Education">
            <textarea
              value={draft.education}
              onChange={(e) => patch({ education: e.target.value })}
              rows={3}
              placeholder="Most relevant education"
              className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-gray-700 shadow-sm outline-none placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
            />
          </DetailsSection>
          <DetailsSection icon={Wallet} title="Expected Salary">
            <input
              value={draft.expectedSalary}
              onChange={(e) => patch({ expectedSalary: e.target.value })}
              placeholder="$120,000 or N/A"
              className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-semibold tracking-tight text-gray-900 shadow-sm outline-none placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
            />
          </DetailsSection>
        </div>

        <DetailsSection icon={Clock} title={`Experience (${draft.experience.length})`}>
          <div className="space-y-2">
            {draft.experience.map((exp, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={exp}
                  onChange={(e) => updateExp(i, e.target.value)}
                  className="flex-1 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-700 shadow-sm outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
                />
                <button onClick={() => removeExp(i)} className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-400 shadow-sm hover:bg-red-50 hover:text-red-500">
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
                    addExp();
                  }
                }}
                placeholder="Add experience — press Enter"
                className="flex-1 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 px-3.5 py-2.5 text-sm text-gray-700 outline-none focus:border-gray-400 focus:bg-white"
              />
              <button onClick={addExp} disabled={!newExp.trim()} className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-gray-900 text-white disabled:opacity-40">
                <Plus size={16} weight="bold" />
              </button>
            </div>
          </div>
        </DetailsSection>

        <DetailsSection icon={Lightning} title={`Skills (${draft.skills.length})`}>
          <div className="flex flex-wrap gap-2">
            {draft.skills.map((skill) => (
              <span key={skill} className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 pl-3 pr-1.5 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-200/80">
                {skill}
                <button onClick={() => removeSkill(skill)} className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-gray-400 ring-1 ring-gray-200 hover:bg-red-50 hover:text-red-500">
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
              placeholder="Add skill — press Enter"
              className="flex-1 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 px-3.5 py-2 text-sm outline-none focus:border-gray-400 focus:bg-white"
            />
            <button onClick={addSkill} disabled={!newSkill.trim()} className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
              Add
            </button>
          </div>
          {skillError && <p className="mt-1.5 text-xs text-red-500">{skillError}</p>}
        </DetailsSection>

        <DetailsSection icon={Phone} title={`Contacts (${draft.contacts.length})`}>
          <div className="space-y-2">
            {draft.contacts.map((c, i) => (
              <div key={i} className="flex gap-2">
                <select
                  value={c.type}
                  onChange={(e) => updateContact(i, { type: e.target.value as ContactType })}
                  className="w-[130px] shrink-0 rounded-xl border border-gray-200 bg-white px-2.5 py-2.5 text-sm font-medium text-gray-700"
                >
                  <option value="phone">Phone</option>
                  <option value="email">Email</option>
                  <option value="website">Website</option>
                  <option value="other">Other</option>
                </select>
                <input
                  value={c.value}
                  onChange={(e) => updateContact(i, { value: e.target.value })}
                  className="flex-1 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-700"
                />
                <button onClick={() => removeContact(i)} className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-400 hover:bg-red-50 hover:text-red-500">
                  <Trash size={16} />
                </button>
              </div>
            ))}
            <button onClick={addContact} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-white">
              <Plus size={14} weight="bold" /> Add contact
            </button>
          </div>
        </DetailsSection>

        <DetailsSection icon={Brain} title="AI Reasoning">
          <textarea
            value={draft.reasoning}
            onChange={(e) => patch({ reasoning: e.target.value })}
            rows={3}
            className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-gray-600"
          />
        </DetailsSection>
      </div>

      <div className="border-t border-gray-100 bg-white px-6 py-4">
        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600 ring-1 ring-red-100">{error}</p>}
        <div className="flex items-center justify-end gap-3">
          <button onClick={onClose} disabled={saving} className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-gray-700 to-gray-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:shadow-md disabled:opacity-40"
          >
            {saving ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Saving…
              </>
            ) : (
              <>
                <FloppyDisk size={16} /> Save Changes
              </>
            )}
          </button>
        </div>
        {!canSave && <p className="mt-2 text-center text-xs text-red-500">Fix required fields before saving.</p>}
      </div>
    </Drawer>
  );
}
