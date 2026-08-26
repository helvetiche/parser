"use client";

import { Article, Brain, Clock, GraduationCap, Lightning, Wallet } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import Modal, { ModalCloseButton } from "@/components/ui/Modal";
import DetailsSection, { EmptyValue } from "@/components/ui/DetailsSection";
import TimelineList from "@/components/ui/TimelineList";
import { CONTACT_ICONS, getInitials } from "@/components/candidates/CandidatesTable";
import type { CandidateRow } from "@/lib/candidate-schema";

function TextValue({ children }: { children: ReactNode }) {
  return <p className="text-lg leading-relaxed text-gray-600">{children}</p>;
}

export default function CandidateDetailsModal({
  candidate,
  onClose,
  footer,
}: {
  candidate: CandidateRow;
  onClose: () => void;
  footer?: ReactNode;
}) {
  return (
    <Modal labelledBy="candidate-details-title" onClose={onClose} size="lg" scroll>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gray-200 to-gray-300 text-lg font-bold text-gray-600 ring-1 ring-gray-900/5 ring-inset">
            {getInitials(candidate.fullName)}
          </span>
          <div className="min-w-0">
            <h3
              id="candidate-details-title"
              className="truncate text-xl font-semibold tracking-tight text-gray-900"
            >
              {candidate.fullName}
            </h3>
            {candidate.contacts.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {candidate.contacts.map((contact) => {
                  const ContactIcon = CONTACT_ICONS[contact.type];
                  return (
                    <span
                      key={`${contact.type}-${contact.value}`}
                      className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-600 ring-1 ring-gray-200/70 ring-inset"
                    >
                      <ContactIcon size={13} className="shrink-0 text-gray-400" />
                      {contact.value}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <ModalCloseButton onClose={onClose} />
      </div>

      <div className="border-t border-gray-100" />

      {/* Scrollable body */}
      <div className="chat-scroll flex-1 space-y-7 overflow-y-auto px-6 py-6">
        <DetailsSection icon={Article} title="Summary">
          {candidate.summary ? <TextValue>{candidate.summary}</TextValue> : <EmptyValue />}
        </DetailsSection>

        <div className="grid grid-cols-1 gap-7 sm:grid-cols-2">
          <DetailsSection icon={GraduationCap} title="Education">
            {candidate.education ? <TextValue>{candidate.education}</TextValue> : <EmptyValue />}
          </DetailsSection>
          <DetailsSection icon={Wallet} title="Expected Salary">
            {candidate.expectedSalary ? (
              <p className="text-base font-semibold tracking-tight text-gray-900 tabular-nums">
                {candidate.expectedSalary}
              </p>
            ) : (
              <EmptyValue />
            )}
          </DetailsSection>
        </div>

        <DetailsSection icon={Clock} title="Experience">
          {candidate.experience.length > 0 ? (
            <TimelineList
              items={candidate.experience}
              icon={Clock}
              maxItems={candidate.experience.length}
              moreLabel="more roles"
            />
          ) : (
            <EmptyValue />
          )}
        </DetailsSection>

        <DetailsSection icon={Lightning} title="Skills">
          {candidate.skills.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {candidate.skills.map((skill) => (
                <span
                  key={skill}
                  className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-200/80 ring-inset"
                >
                  {skill}
                </span>
              ))}
            </div>
          ) : (
            <EmptyValue />
          )}
        </DetailsSection>

        <DetailsSection icon={Brain} title="AI Reasoning">
          {candidate.reasoning ? (
            <div className="rounded-xl bg-gray-50 px-4 py-4 ring-1 ring-gray-100 ring-inset">
              <p className="text-sm leading-relaxed text-gray-600">{candidate.reasoning}</p>
            </div>
          ) : (
            <EmptyValue />
          )}
        </DetailsSection>
      </div>

      {footer && <div className="border-t border-gray-100 px-6 py-5">{footer}</div>}
    </Modal>
  );
}
