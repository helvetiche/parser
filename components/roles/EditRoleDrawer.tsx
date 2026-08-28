"use client";

import { Article, Briefcase, ClipboardText, Lightning, ListChecks, Plus, Trash, WarningCircle, X, FloppyDisk } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import Drawer from "@/components/ui/Drawer";
import DetailsSection from "@/components/ui/DetailsSection";
import { ModalCloseButton } from "@/components/ui/Modal";
import type { RoleData } from "@/lib/role-schema";

type Props = {
  role: RoleData;
  onClose: () => void;
  onSave: (role: RoleData) => Promise<void>;
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
            className="flex-1 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-700 shadow-sm outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
          />
          <button onClick={() => onRemove(listKey, i)} className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-400 hover:bg-red-50 hover:text-red-500">
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
          className="flex-1 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 px-3.5 py-2.5 text-sm outline-none focus:border-gray-400 focus:bg-white"
        />
        <button onClick={() => onAdd(listKey, inputVal, setInputVal)} disabled={!inputVal.trim()} className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-gray-900 text-white disabled:opacity-40">
          <Plus size={16} weight="bold" />
        </button>
      </div>
    </div>
  );
}

export default function EditRoleDrawer({ role: initial, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<RoleData>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newResp, setNewResp] = useState("");
  const [newReq, setNewReq] = useState("");
  const [newSkill, setNewSkill] = useState("");

  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional prop sync for edit drawer
  useEffect(() => setDraft(initial), [initial]);
  const patch = (p: Partial<RoleData>) => setDraft((d) => ({ ...d, ...p }));
  const updateList = (key: "responsibilities" | "requirements" | "skills", idx: number, val: string) => {
    const next = [...draft[key]];
    next[idx] = val;
    patch({ [key]: next } as Partial<RoleData>);
  };
  const removeFromList = (key: "responsibilities" | "requirements" | "skills", idx: number) => {
    const next = draft[key].filter((_, i) => i !== idx);
    patch({ [key]: next } as Partial<RoleData>);
  };
  const addToList = (key: "responsibilities" | "requirements" | "skills", val: string, setVal: (v: string) => void) => {
    const v = val.trim();
    if (!v) return;
    if (draft[key].some((s) => s.toLowerCase() === v.toLowerCase())) return;
    patch({ [key]: [...draft[key], v] } as Partial<RoleData>);
    setVal("");
  };

  const canSave = draft.jobTitle.trim().length > 0;
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
    <Drawer labelledBy="edit-role-title" onClose={onClose} size="lg" busy={saving}>
      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gray-700 to-gray-900 text-white">
            <Briefcase size={24} weight="fill" />
          </span>
          <div className="min-w-0">
            <h3 id="edit-role-title" className="truncate text-xl font-semibold tracking-tight text-gray-900">Edit Job Description</h3>
            <p className="mt-1 text-xs text-gray-500">Update fields and save changes.</p>
          </div>
        </div>
        <ModalCloseButton onClose={onClose} disabled={saving} />
      </div>
      <div className="border-t border-gray-100" />
      <div className="mx-6 mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-100 ring-inset">
        <span className="font-semibold">Edit mode.</span> Changes are saved directly to the database.
      </div>

      <div className="chat-scroll flex-1 space-y-7 overflow-y-auto px-6 py-6">
        <DetailsSection icon={Briefcase} title="Job Title">
          <input
            value={draft.jobTitle}
            onChange={(e) => patch({ jobTitle: e.target.value })}
            placeholder="e.g. Senior Frontend Engineer"
            className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-gray-900 shadow-sm outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
          />
          {draft.jobTitle.trim().length === 0 && (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-red-500">
              <WarningCircle size={12} weight="fill" /> Job title is required
            </p>
          )}
        </DetailsSection>

        <DetailsSection icon={Article} title="Description">
          <textarea
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
            rows={3}
            placeholder="2–3 sentence overview"
            className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-gray-700 shadow-sm outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
          />
        </DetailsSection>

        <DetailsSection icon={ListChecks} title={`Responsibilities (${draft.responsibilities.length})`}>
          <ListEditor items={draft.responsibilities} listKey="responsibilities" inputVal={newResp} setInputVal={setNewResp} placeholder="e.g. Own the component library" onUpdate={updateList} onRemove={removeFromList} onAdd={addToList} />
        </DetailsSection>

        <DetailsSection icon={ClipboardText} title={`Requirements (${draft.requirements.length})`}>
          <ListEditor items={draft.requirements} listKey="requirements" inputVal={newReq} setInputVal={setNewReq} placeholder="e.g. 5+ years React" onUpdate={updateList} onRemove={removeFromList} onAdd={addToList} />
        </DetailsSection>

        <DetailsSection icon={Lightning} title={`Skills Required (${draft.skills.length})`}>
          <ListEditor items={draft.skills} listKey="skills" inputVal={newSkill} setInputVal={setNewSkill} placeholder="e.g. TypeScript" onUpdate={updateList} onRemove={removeFromList} onAdd={addToList} />
          {draft.skills.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {draft.skills.map((s) => (
                <span key={s} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 ring-1 ring-gray-200/80">
                  {s}
                  <button onClick={() => removeFromList("skills", draft.skills.indexOf(s))} className="ml-1 text-gray-400 hover:text-red-500">
                    <X size={10} weight="bold" />
                  </button>
                </span>
              ))}
            </div>
          )}
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
        {!canSave && <p className="mt-2 text-center text-xs text-red-500">Job title is required.</p>}
      </div>
    </Drawer>
  );
}
