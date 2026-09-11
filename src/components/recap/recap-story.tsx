"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { categoricalColor } from "@/lib/viz/color";
import type { RecapStoryCard } from "@/lib/recap-story";

// The story tier of the recap (issue #175, epic #130) — the one genuinely
// new UI surface in the whole epic. Everything else in the recap reuses
// `ChartPage`/`ChartCard` and the shipped `Interactive*` primitives; this is
// the Wrapped-feel sequence that sits above the report.
//
// Deliberately not built on D3. AGENTS.md's `use-d3.ts` note is about state
// that changes every frame or pointer move forcing a full SVG rebuild — the
// cleanest way to honour it here was to have no SVG at all. These cards are
// type and numbers, so the reveal is a CSS animation and the swipe is two
// numbers compared on pointer *release*. Nothing re-renders per pointermove,
// and there is no dependency array to keep clean.
//
// `prefers-reduced-motion` is honoured the same declarative way: the reveal
// is `animate-in` plus Tailwind's `motion-reduce:animate-none`, so a reader
// who asked for less motion gets the card without the movement rather than a
// JS branch that has to be kept in sync. The one place that needs the media
// query in JS is `scrollIntoView`, whose `behavior` option overrides CSS.

/** How far a swipe has to travel before it counts, in px. Below this it's a
 * tap or a scroll that happened to drift sideways. */
const SWIPE_THRESHOLD = 48;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function RecapStoryView({
  cards,
  periodLabel,
  children,
}: {
  cards: RecapStoryCard[];
  periodLabel: string;
  /** The full report, server-rendered and passed through as a slot. It stays
   * mounted whether or not it's expanded, so it's findable by the browser's
   * own search and printable — `hidden` only takes it out of the layout and
   * the accessibility tree. */
  children: React.ReactNode;
}) {
  const hasStory = cards.length > 0;
  // A period too sparse for a story (see `MIN_STORY_CARDS`) opens straight
  // into the report rather than showing a collapsed shell with nothing above
  // it to expand from.
  const [reportOpen, setReportOpen] = useState(!hasStory);
  const [index, setIndex] = useState(0);
  const reportRef = useRef<HTMLDivElement>(null);

  const openReport = useCallback(() => {
    setReportOpen(true);
    // Next frame: the report is `hidden` until this render commits, and
    // scrolling to a display:none element goes nowhere.
    requestAnimationFrame(() => {
      reportRef.current?.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
      });
    });
  }, []);

  // Reads `index` directly rather than going through a state updater: opening
  // the report is a side effect, and an updater can be invoked more than once
  // per commit (StrictMode does exactly that), which would fire it twice.
  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next < 0) {
        setIndex(0);
        return;
      }
      // Running off the end is how you finish the story — the report is what
      // comes after the last card, not a dead stop.
      if (next >= cards.length) {
        openReport();
        return;
      }
      setIndex(next);
    },
    [cards.length, index, openReport],
  );

  // Window-level rather than scoped to a focused container: a story view the
  // reader hasn't clicked into should still answer the arrow keys. Guarded
  // against stealing keys from a real input, and off entirely when there's no
  // story to navigate.
  useEffect(() => {
    if (!hasStory) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          go(1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          go(-1);
          break;
        case "Home":
          event.preventDefault();
          setIndex(0);
          break;
        case "End":
          event.preventDefault();
          setIndex(cards.length - 1);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cards.length, go, hasStory]);

  // Swipe: the start x lives in a ref and the decision happens on release, so
  // dragging across a card costs zero renders. Touch and pen only — hijacking
  // a mouse drag would break text selection on the card's own copy.
  const swipeStart = useRef<number | null>(null);
  const onPointerDown = (event: React.PointerEvent) => {
    swipeStart.current = event.pointerType === "mouse" ? null : event.clientX;
  };
  const onPointerUp = (event: React.PointerEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (start === null) return;
    const dx = event.clientX - start;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    go(dx < 0 ? 1 : -1);
  };

  const card = cards[index];

  return (
    <div className="flex flex-col gap-6">
      {hasStory && card ? (
        <section
          aria-label={`${periodLabel} recap story`}
          className="flex flex-col gap-3"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            swipeStart.current = null;
          }}
        >
          <ProgressBar count={cards.length} index={index} onJump={setIndex} />

          {/* Keyed here, at the usage site, so React remounts the subtree on
              every move — that remount is what replays the enter animation.
              A key on the component's own root element would do nothing. */}
          <StoryCard key={card.id} card={card} />

          {/* Position is announced separately from the card so a screen
              reader gets "3 of 7" on every move without the card's whole
              copy being re-read as a live update. */}
          <p aria-live="polite" className="sr-only">
            Card {index + 1} of {cards.length}: {card.kicker}. {card.value} {card.unit ?? ""}.{" "}
            {card.headline}
          </p>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <NavButton
                label="Previous card"
                onClick={() => go(-1)}
                disabled={index === 0}
                icon={<ChevronLeft aria-hidden className="size-4" />}
              />
              <NavButton
                label={index === cards.length - 1 ? "Finish and read the report" : "Next card"}
                onClick={() => go(1)}
                icon={<ChevronRight aria-hidden className="size-4" />}
              />
              <span aria-hidden className="text-xs tabular-nums text-muted-foreground">
                {index + 1} / {cards.length}
              </span>
            </div>

            {!reportOpen ? (
              <button
                type="button"
                onClick={openReport}
                className="rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Skip to the full report
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {hasStory ? (
        <button
          type="button"
          onClick={() => (reportOpen ? setReportOpen(false) : openReport())}
          aria-expanded={reportOpen}
          aria-controls="recap-full-report"
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
        >
          <ChevronDown
            aria-hidden
            className={`size-4 transition-transform motion-reduce:transition-none ${reportOpen ? "rotate-180" : ""}`}
          />
          {reportOpen ? "Hide the full report" : `See everything from ${periodLabel}`}
        </button>
      ) : null}

      {/* The `hidden` attribute alone would not hold: an author-level
          `display: flex` beats the browser's own `[hidden]` rule regardless
          of specificity, so the class has to swap too. Keeping the attribute
          as well is what takes the collapsed report out of the accessibility
          tree rather than merely off-screen. */}
      <div
        id="recap-full-report"
        ref={reportRef}
        hidden={!reportOpen}
        className={`flex-col gap-4 scroll-mt-16 ${reportOpen ? "flex" : "hidden"}`}
      >
        {children}
      </div>
    </div>
  );
}

/** One segment per card — a progress indicator that doubles as direct
 * navigation, which is the fastest way back to a card you skimmed past. */
function ProgressBar({
  count,
  index,
  onJump,
}: {
  count: number;
  index: number;
  onJump: (next: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        // The bar reads as 6px tall but the button is padded out to a real
        // touch target — a 6px tap zone on a phone is a miss most times.
        <button
          key={i}
          type="button"
          onClick={() => onJump(i)}
          aria-label={`Go to card ${i + 1} of ${count}`}
          aria-current={i === index}
          className="group flex-1 py-2"
        >
          <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <span
              className={`block h-full rounded-full transition-colors motion-reduce:transition-none ${
                i <= index ? "bg-primary" : "bg-transparent group-hover:bg-primary/30"
              }`}
            />
          </span>
        </button>
      ))}
    </div>
  );
}

function StoryCard({ card }: { card: RecapStoryCard }) {
  // Fixed slot per domain, never cycled — see `DOMAIN_COLOR_INDEX` in
  // recap-story.ts for why the index is the domain's and not the card's
  // position in the sequence.
  const accent = categoricalColor(card.colorIndex);

  return (
    // `motion-reduce:animate-none` is the whole of the reduced-motion story:
    // same card, same layout, no movement.
    <div
      className="animate-in fade-in slide-in-from-bottom-4 duration-500 motion-reduce:animate-none flex min-h-[20rem] flex-col justify-center gap-4 overflow-hidden rounded-xl border border-border p-6 md:min-h-[24rem] md:p-10"
      style={{
        // A wash of the domain's own colour rather than a flat fill, so the
        // card reads as themed without putting text on a saturated ground.
        backgroundImage: `linear-gradient(160deg, ${accent}1f, transparent 65%)`,
      }}
    >
      <p
        className="text-xs font-medium uppercase tracking-widest"
        style={{ color: accent }}
      >
        {card.kicker}
      </p>

      <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="font-heading text-4xl font-medium tracking-tight break-words md:text-6xl">
          {card.value}
        </span>
        {card.unit ? (
          <span className="text-base text-muted-foreground md:text-lg">{card.unit}</span>
        ) : null}
      </p>

      <div className="flex flex-col gap-1">
        <p className="text-sm text-foreground/90 md:text-base">{card.headline}</p>
        {card.detail ? (
          <p className="text-sm text-muted-foreground">{card.detail}</p>
        ) : null}
      </div>

      {card.items.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {card.items.map((item, i) => (
            <li
              // Positional: two life events can legitimately share a title.
              key={`${card.id}-${i}`}
              className="rounded-full border border-border/70 px-2.5 py-1 text-xs text-foreground/80"
            >
              {item}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function NavButton({
  label,
  onClick,
  icon,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex size-9 items-center justify-center rounded-lg border border-border transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {icon}
    </button>
  );
}
