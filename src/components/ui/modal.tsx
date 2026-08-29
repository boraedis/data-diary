"use client";

import { type ReactNode } from "react";

/** Minimal modal shell shared by every "+ New" catalog-entry flow (people,
 * places, exercises, exercise locations, entertainment). Deliberately a
 * plain overlay + card rather than a Base UI dialog primitive — same
 * reasoning as Select/Textarea: small, static content, not worth the risk
 * of an unverified component API in a build I can't run locally. */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl shadow-black/30"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-lg font-medium">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-xl leading-none text-muted-foreground hover:text-foreground"
          >
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
