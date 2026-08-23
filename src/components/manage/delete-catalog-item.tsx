"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

/**
 * Shared delete flow for every /manage/<catalog>/[id] detail page — mirrors
 * the legacy app's person.js `delete_person` flow: check usage first
 * server-side, and if the item is still referenced somewhere, block the
 * delete and show where (with links) instead of a raw DB error; otherwise
 * confirm, then delete. Each catalog's usage shape is different (dates,
 * workout dates, movie watches with ratings...), so this component only
 * owns the modal/confirm mechanics — the caller renders `blockedContent`
 * from whatever it already fetched.
 */
export function DeleteCatalogItem({
  itemLabel,
  isBlocked,
  blockedContent,
  warningContent,
  onDelete,
  afterDeleteHref,
}: {
  itemLabel: string;
  isBlocked: boolean;
  blockedContent: ReactNode;
  warningContent?: ReactNode;
  onDelete: () => Promise<void>;
  afterDeleteHref: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
      router.push(afterDeleteHref);
    } catch {
      setError("Failed to delete");
      setDeleting(false);
    }
  }

  return (
    <>
      <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
        Delete
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={`Delete ${itemLabel}?`}>
        {isBlocked ? (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-muted-foreground">Can&rsquo;t delete — still in use:</p>
            {blockedContent}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {warningContent}
            <p className="text-sm">Are you sure? This can&rsquo;t be undone.</p>
            {error ? <span className="text-sm text-destructive">{error}</span> : null}
            <Button type="button" variant="destructive" onClick={handleConfirm} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}
