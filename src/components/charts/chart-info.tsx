"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { PLACEHOLDER_METHODOLOGY } from "@/lib/viz/interaction-guides";
import { formatTrackingSpan, PLACEHOLDER_TRACKING_SPAN, type TrackingSpan } from "@/lib/viz/tracking-span";

/**
 * The standardized "about this chart" trigger + popup (#315) — every chart
 * page gets one, next to its title. Three sections: how to interact with
 * the chart (generic per-primitive copy, see
 * `src/lib/viz/interaction-guides.ts`), the methodology behind what's
 * plotted (per-field, see `src/lib/viz/methodology.ts`), and when the
 * underlying field started (and, rarely, stopped) being recorded (see
 * `src/lib/viz/tracking-span.ts`).
 *
 * Built on the existing `Modal` rather than a new dialog/popover primitive
 * — same reasoning that component already documents: small, static content,
 * not worth an unverified library API.
 */
export function ChartInfo({
  title,
  interactionGuide,
  methodology,
  trackingSpan,
}: {
  /** The chart's own title — doubles as the popup heading and the
   * `localStorage` key for the first-time-view highlight below. */
  title: string;
  interactionGuide: string;
  /** Falls back to a visible "pending" placeholder rather than omitting
   * the section — see #316, the content follow-up this ships ahead of. */
  methodology?: string;
  /** Falls back to a visible "pending" placeholder rather than omitting
   * the section, same as `methodology` above. */
  trackingSpan?: TrackingSpan;
}) {
  const [open, setOpen] = useState(false);
  // Starts "seen" so server and first client render agree (no highlight
  // flash before localStorage can be read) — the real first-time check
  // happens in the effect below, client-only by definition.
  const [seen, setSeen] = useState(true);
  const storageKey = `chart-info-seen:${title}`;

  useEffect(() => {
    // localStorage can only be read on the client, so this can't move into
    // the initial state without the server rendering "seen" and the client
    // correcting it — a hydration mismatch on every load (same tradeoff
    // `interactive-bar-race.tsx`'s own autoplay effect documents). One
    // extra render at mount is the cheaper of the two.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSeen(localStorage.getItem(storageKey) === "1");
    } catch {
      // Storage unavailable (private browsing, etc.) — treat as seen so a
      // broken read can't leave a permanently stuck highlight.
      setSeen(true);
    }
  }, [storageKey]);

  function handleOpen() {
    setOpen(true);
    setSeen(true);
    try {
      localStorage.setItem(storageKey, "1");
    } catch {
      // Best-effort only — nothing to fall back to for a disabled store.
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        aria-label={`About this chart: ${title}`}
        className="relative flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
      >
        <Info aria-hidden className="size-4" />
        {!seen ? (
          <span
            aria-hidden
            className="absolute top-0 right-0 size-2 animate-pulse rounded-full bg-primary"
          />
        ) : null}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <div className="flex flex-col gap-4 text-sm">
          <section>
            <h3 className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              Interaction guide
            </h3>
            <p className="mt-1 text-foreground/90">{interactionGuide}</p>
          </section>
          <section>
            <h3 className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              Methodology
            </h3>
            <p className="mt-1 text-foreground/90">{methodology ?? PLACEHOLDER_METHODOLOGY}</p>
          </section>
          <section>
            <h3 className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              Tracked since
            </h3>
            <p className="mt-1 text-foreground/90 whitespace-pre-line">
              {trackingSpan ? formatTrackingSpan(trackingSpan) : PLACEHOLDER_TRACKING_SPAN}
            </p>
          </section>
        </div>
      </Modal>
    </>
  );
}
