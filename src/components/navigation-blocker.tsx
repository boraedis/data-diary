"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/** Shared "does the current page have unsaved changes" flag, read by
 * `ConfirmLink` (see confirm-link.tsx) to decide whether to confirm before
 * navigating away. Lives above the app's route group (see
 * src/app/(app)/layout.tsx) so any page can opt in via
 * useUnsavedChangesGuard (src/hooks/use-unsaved-changes-guard.ts) without
 * every page needing its own provider. Pattern matches the Next.js docs'
 * own "Blocking navigation" guide for next/link's onNavigate. */
type NavigationBlockerContextType = {
  isBlocked: boolean;
  setIsBlocked: (isBlocked: boolean) => void;
};

const NavigationBlockerContext = createContext<NavigationBlockerContextType>({
  isBlocked: false,
  setIsBlocked: () => {},
});

export function NavigationBlockerProvider({ children }: { children: ReactNode }) {
  const [isBlocked, setIsBlocked] = useState(false);
  return (
    <NavigationBlockerContext.Provider value={{ isBlocked, setIsBlocked }}>
      {children}
    </NavigationBlockerContext.Provider>
  );
}

export function useNavigationBlocker() {
  return useContext(NavigationBlockerContext);
}
