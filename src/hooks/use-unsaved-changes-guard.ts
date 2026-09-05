"use client";

import { useEffect } from "react";
import { useNavigationBlocker } from "@/components/navigation-blocker";

/** Wires a page/modal's own "has unsaved changes" boolean into two leave-
 * without-saving guards (issue #143): the site nav's ConfirmLink prompt
 * (via NavigationBlocker context) and a `beforeunload` prompt for hard
 * navigation (typing a URL, refreshing, closing the tab). Doesn't cover the
 * browser's back/forward buttons — see confirm-link.tsx's header comment
 * for why that's a known, unaddressed gap rather than an oversight. */
export function useUnsavedChangesGuard(dirty: boolean) {
  const { setIsBlocked } = useNavigationBlocker();

  useEffect(() => {
    setIsBlocked(dirty);
    return () => setIsBlocked(false);
  }, [dirty, setIsBlocked]);

  useEffect(() => {
    if (!dirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Chrome (and older browsers generally) only show the native prompt
      // when returnValue is also set — the string itself is ignored by
      // every modern browser, which always shows their own fixed wording.
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);
}
