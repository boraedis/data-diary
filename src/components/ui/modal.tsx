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
        className="w-full max-w-sm rounded-lg border border-border bg-background p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground"
          >
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
