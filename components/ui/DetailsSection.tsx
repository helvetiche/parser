"use client";

import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

export default function DetailsSection({
  icon: Icon,
  title,
  children,
}: {
  icon: Icon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2.5 flex items-center gap-2">
        <Icon size={13} weight="fill" className="shrink-0 text-gray-400" />
        <h4 className="text-xs font-semibold tracking-wider text-gray-500 uppercase">{title}</h4>
      </div>
      {children}
    </section>
  );
}

export function DetailsSubLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-[13px] font-semibold tracking-wider text-gray-400 uppercase">
      {children}
    </p>
  );
}

export function EmptyValue() {
  return <span className="text-sm text-gray-300">N/A</span>;
}
