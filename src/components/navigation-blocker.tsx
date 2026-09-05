"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

/** Shared "does the current page have unsaved changes" flag plus the
 * confirm-before-leaving UI itself (issue #143). Read/set by
 * `ConfirmLink` (see confirm-link.tsx) and useUnsavedChangesGuard
 * (src/hooks/use-unsaved-changes-guard.ts). Lives above the app's route
 * group (src/app/(app)/layout.tsx) so any page can opt in without its own
 * provider.
 *
 * Deliberately NOT `window.confirm()` (an earlier version of this used
 * next/link's onNavigate + window.confirm, per the Next.js docs' own
 * "Blocking navigation" example) — confirmed broken on iOS Safari, which
 * silently returns `false` from confirm()/alert()/prompt() without
 * showing anything when the call isn't part of a truly synchronous,
 * same-tick user gesture. Link's onNavigate fires through React/Next's
 * transition machinery, not a raw click handler, so it doesn't reliably
 * count as that "same-tick" gesture — the result was navigation silently
 * refusing to happen with no visible prompt at all. A real React-rendered
 * Modal has no such restriction, so the Provider owns one confirm dialog
 * here and performs the actual `router.push` itself once confirmed,
 * instead of ConfirmLink trying to negotiate with next/link's own
 * navigation lifecycle. */
type NavigationBlockerContextType = {
  isBlocked: boolean;
  setIsBlocked: (isBlocked: boolean) => void;
  /** Called by ConfirmLink instead of letting the click through directly —
   * shows the confirm modal if `isBlocked`, otherwise navigates immediately. */
  requestNavigation: (href: string) => void;
};

const NavigationBlockerContext = createContext<NavigationBlockerContextType>({
  isBlocked: false,
  setIsBlocked: () => {},
  requestNavigation: () => {},
});

export function NavigationBlockerProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isBlocked, setIsBlocked] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  function requestNavigation(href: string) {
    if (isBlocked) {
      setPendingHref(href);
    } else {
      router.push(href);
    }
  }

  return (
    <NavigationBlockerContext.Provider value={{ isBlocked, setIsBlocked, requestNavigation }}>
      {children}
      <Modal open={pendingHref !== null} onClose={() => setPendingHref(null)} title="Unsaved changes">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            You have unsaved changes on this page. Leave anyway?
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setPendingHref(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                const href = pendingHref;
                setPendingHref(null);
                if (href) router.push(href);
              }}
            >
              Leave
            </Button>
          </div>
        </div>
      </Modal>
    </NavigationBlockerContext.Provider>
  );
}

export function useNavigationBlocker() {
  return useContext(NavigationBlockerContext);
}
