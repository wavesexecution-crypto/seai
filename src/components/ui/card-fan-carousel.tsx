"use client";

import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import gsap from "gsap";

export interface CardItem {
  imgUrl: string;
  alt?: string;
  linkUrl?: string;
  /** Minimal index label (e.g. "Gym"). Rendered instead of the image when `icon` is given. */
  title?: string;
  /** Minimal monochrome mark rendered above the title. */
  icon?: ReactNode;
}

interface SocialCardsProps {
  cards: CardItem[];
  /** Demo-return mount: place cards in their final positions instantly. */
  instant?: boolean;
  /** Restored active-card index (clamped); defaults to the middle card. */
  initialCenter?: number;
}

const MAX_VISIBLE = 7;
const HALF = 3;
/** Visible window size: five symmetric slots around the centered active card. */
const WINDOW = 5;

/**
 * Slot offsets.
 *
 * The x values MUST be evenly spaced. They used to run -30,-22,-11,0,11,22,30,
 * i.e. 8rem between the outer pairs but 11rem between the inner ones. Against a
 * 16rem card the 8rem gap is a 50% overlap, which buries the outermost cards'
 * centre — and the centre is exactly where `.fan-name` sits. The result was a
 * blank white rectangle at each edge of the fan, on every viewport. A uniform
 * 11rem step gives a uniform ~31% overlap, so no card's label is ever covered.
 */
const FAN_POSITIONS = [
  { rot: -21, scale: 0.7756, x: -33, y: 7.3, zIndex: 1 },
  { rot: -14, scale: 0.8498, x: -22, y: 4.0, zIndex: 2 },
  { rot: -7,  scale: 0.9346, x: -11, y: 1.3, zIndex: 3 },
  { rot: 0,   scale: 1.0,    x: 0,   y: 0.0, zIndex: 10 },
  { rot: 7,   scale: 0.9346, x: 11,  y: 1.3, zIndex: 3 },
  { rot: 14,  scale: 0.8498, x: 22,  y: 4.0, zIndex: 2 },
  { rot: 21,  scale: 0.7756, x: 33,  y: 7.3, zIndex: 1 },
];

/**
 * Five-slot symmetric window (the middle five reference positions, ±20rem).
 * Used whenever more than five cards are passed so the fan always spans
 * symmetrically around the centered active card — an even card count can
 * never center with all cards visible at once.
 */
const FAN5 = FAN_POSITIONS.slice(1, 6);

/** Gap between adjacent slot centres at multiplier 1 (11rem). */
const REFERENCE_GAP_PX = 11 * 16;
/**
 * Widest the fan is allowed to grow to (`.fan-layout` is max-w-80rem). Past this
 * the cards must not keep spreading, or they leave the viewport on wide screens.
 */
const MAX_FAN_WIDTH_PX = 80 * 16;
/** Current viewport width, readable from module scope by baseCardWidth(). */
const viewportRef = { current: 1440 };
/**
 * A rotated card's rendered box is wider than its layout width (measured at
 * ~1.094x for the fan's 7–21° range). The fit calculation has to use the
 * rendered width or the edge cards overhang the viewport by a few pixels.
 */
const ROTATED_CARD_RATIO = 1.094;

/** Symmetric three-slot window, used on narrow screens. */
const FAN3 = FAN_POSITIONS.slice(2, 5);
/** Cards shown at once on a phone, where seven cannot be legible. */
const WINDOW_NARROW = 3;
const NARROW_BREAKPOINT = 640;

/**
 * The largest scale (0..1] at which the fan still fits the space it is given.
 *
 * `available` is the frame's content box (stage width minus its border and
 * padding), so the cards are guaranteed to sit inside the frame with breathing
 * room and can never touch or cross the border.
 *
 * The fan's total width is (slots-1) gaps + one card, and both the gaps and the
 * card scale together, so the scale is simply available / required. Scaling both
 * together is what keeps the overlap ratio constant: shrinking only the gaps
 * squeezes the centres together while the cards stay full size, and the outer
 * cards end up completely buried.
 */
/**
 * Width the cards may occupy. The fan is capped at the width of its container
 * (`.fan-layout` is max-w-80rem); below that it uses the full viewport.
 */
function stageInnerWidth(_container: HTMLElement | null) {
  return Math.min(viewportRef.current, MAX_FAN_WIDTH_PX);
}

function getResponsiveMultiplier(available: number, windowSize: number) {
  const required = (windowSize - 1) * REFERENCE_GAP_PX + baseCardWidth() * ROTATED_CARD_RATIO;
  return Math.max(0.1, Math.min(1, available / required));
}

/** Untransformed card width per breakpoint — mirrors the media queries in
 *  fan-carousel.css. Read from a ref, not the DOM, because the DOM value is
 *  already multiplied by the scale we are about to compute. */
function baseCardWidth() {
  if (viewportRef.current < 480) return 10 * 16;
  if (viewportRef.current < 640) return 10.5 * 16;
  if (viewportRef.current < 768) return 11.5 * 16;
  if (viewportRef.current < 1024) return 13 * 16;
  return 16 * 16;
}

/**
 * Returns a multiplier (0..1] that scales y-offsets and entry animation
 * distances when the viewport is too short for the ideal layout height.
 */
function getHeightMultiplier(width: number) {
  // Ideal layout heights (in px at 16px root) matching the CSS breakpoints
  let idealPx: number;
  if (width < 480) idealPx = 22 * 16;       // 352px
  else if (width < 640) idealPx = 26 * 16;  // 416px
  else if (width < 768) idealPx = 28 * 16;  // 448px
  else if (width < 1024) idealPx = 34 * 16; // 544px
  else idealPx = 38 * 16;                    // 608px

  const available = window.innerHeight * 0.7; // 70vh budget
  if (available >= idealPx) return 1;
  return available / idealPx;
}

function getSlotConfig(totalCards: number, slot: number) {
  if (totalCards >= MAX_VISIBLE) return FAN_POSITIONS[slot];
  const center = totalCards >> 1;
  const distance = totalCards > 1 ? (slot - center) / center : 0;
  const absDistance = Math.abs(distance);
  // Scale the horizontal spread to the actual card count so fewer cards sit
  // closer together (7 cards keep the reference ±30rem exactly). The active
  // card stays pinned at x=0 with full scale, matching the reference fan.
  const spread = totalCards > 1 ? (totalCards - 1) / (MAX_VISIBLE - 1) : 0;
  return {
    rot: distance * 21,
    scale: 1.0 - 0.2244 * absDistance * absDistance,
    x: distance * 30 * spread,
    y: absDistance * absDistance * 7.3,
    zIndex: 10 - Math.abs(slot - center),
  };
}

const ARROW_CLASSES =
  "relative flex items-center justify-center rounded-full border-[1.5px] border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 backdrop-blur-[16px] text-black/40 dark:text-white/55 cursor-pointer shrink-0 z-30 outline-none shadow-[0_4px_20px_rgba(0,0,0,0.1)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:border-black/25 dark:hover:border-white/25 hover:text-black/70 dark:hover:text-white/80 active:opacity-70 transition-colors duration-300 before:content-[''] before:absolute before:inset-[3px] before:rounded-full before:border before:border-black/[0.04] dark:before:border-white/[0.04] before:pointer-events-none";

export default function SocialCards({ cards, instant = false, initialCenter }: SocialCardsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isAnimating = useRef(false);
  const hasEntered = useRef(false);
  const directionRef = useRef<"left" | "right" | null>(null);
  const prevVisible = useRef<Set<number>>(new Set());
  /** Viewport width the current layout was built for — used to tell a resize
   *  (relayout instantly) from a card change (animate). */
  const prevViewport = useRef<number | null>(null);
  // Swipe (touch) + drag (mouse) support: a horizontal swipe/drag past the
  // threshold shifts the fan; the flag suppresses the follow-up link click.
  const dragStartX = useRef<number | null>(null);
  const dragged = useRef(false);
  const SWIPE_THRESHOLD = 40;

  // Tracked in state (not read inline) so the layout effect re-runs on resize —
  // otherwise the fan keeps transforms computed for the old viewport.
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth
  );
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const totalCards = cards.length;
  // The window is viewport-dependent: a phone cannot show seven cards at a
  // legible size, and squeezing them to fit just produces blank slivers at the
  // edges. Three large, fully-readable cards beat seven unreadable ones, and the
  // arrows/dots/swipe page through the rest.
  const paged = totalCards > WINDOW;
  const windowSize = !paged
    ? totalCards
    : viewportWidth < NARROW_BREAKPOINT
      ? Math.min(WINDOW_NARROW, totalCards)
      : totalCards >= MAX_VISIBLE
        ? MAX_VISIBLE
        : WINDOW;
  const windowCenter = windowSize >> 1;
  const slotTable =
    windowSize >= MAX_VISIBLE ? FAN_POSITIONS : windowSize <= 3 ? FAN3 : FAN5;
  const showControls = totalCards > 1;
  const [centerIndex, setCenterIndex] = useState(() => {
    if (typeof initialCenter === "number" && Number.isInteger(initialCenter)) {
      return Math.max(0, Math.min(totalCards - 1, initialCenter));
    }
    return paged ? HALF : totalCards >> 1;
  });

  // Persist the active card so a demo return can restore the fan state.
  // Same-tab sessionStorage only; read solely in return mode. Tiny write.
  useEffect(() => {
    try { sessionStorage.setItem("seai:center", String(centerIndex)); } catch { /* ignore */ }
  }, [centerIndex]);

  const getVisibleMap = useCallback((center: number) => {
    const map = new Map<number, number>();
    if (!paged) {
      const n = totalCards;
      cards.forEach((_, i) => map.set(i, (((i - center + windowCenter) % n) + n) % n));
      return map;
    }
    for (let slot = 0; slot < windowSize; slot++) {
      map.set(((center + slot - windowCenter) % totalCards + totalCards) % totalCards, slot);
    }
    return map;
  }, [totalCards, paged, windowSize, windowCenter, cards]);

  const cycle = useCallback((direction: "left" | "right") => {
    if (isAnimating.current || totalCards < 2) return;
    isAnimating.current = true;
    directionRef.current = direction;
    setCenterIndex(prev => {
      const next = direction === "right" ? prev + 1 : prev - 1;
      if (paged) return ((next % totalCards) + totalCards) % totalCards;
      return Math.max(0, Math.min(totalCards - 1, next));
    });
  }, [totalCards, paged]);

  const goTo = useCallback((index: number) => {
    if (isAnimating.current || index === centerIndex) return;
    directionRef.current = index > centerIndex ? "right" : "left";
    isAnimating.current = true;
    setCenterIndex(index);
  }, [centerIndex]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !totalCards) return;

    const cardElements = Array.from(container.querySelectorAll<HTMLElement>(".fan-card"));
    if (!cardElements.length) return;

    const visibleMap = getVisibleMap(centerIndex);
    const previouslyVisible = prevVisible.current;
    const direction = directionRef.current;
    const isFirstMount = !hasEntered.current;
    const vw = window.innerWidth;
    viewportRef.current = vw;
    // Layout-only change: the viewport resized but the selected card did not.
    // Tweening here would drag every card from its old geometry to the new one,
    // and those intermediate positions park large card rectangles outside both
    // sides of the new viewport for the length of the tween (measured: four
    // cards hanging ~370px past the left edge when narrowing 1440 -> 390).
    // A resize must relayout instantly, not animate.
    const layoutOnly =
      !isFirstMount && prevViewport.current !== null && prevViewport.current !== vw;
    prevViewport.current = vw;
    const multiplier = getResponsiveMultiplier(stageInnerWidth(container), windowSize);
    // The card scales with the spread. Without this the gaps shrink while the
    // cards stay full size, and the overlap swallows the outer cards.
    container.style.setProperty("--fan-scale", String(multiplier));
    const hMult = getHeightMultiplier(window.innerWidth);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const entryDuration = reduced ? 0.01 : 1.2;
    const moveDuration = reduced ? 0.01 : 0.5;
    const slotCount = paged ? windowSize : totalCards;
    const config = (slot: number) => (paged ? slotTable[slot] : getSlotConfig(slotCount, slot));

    if (isFirstMount) isAnimating.current = true;

    let completedCount = 0;
    const visibleCount = visibleMap.size;
    const onCardDone = () => {
      if (++completedCount >= visibleCount) {
        isAnimating.current = false;
        if (isFirstMount) hasEntered.current = true;
      }
    };

    // Mark the centered card so CSS can reveal its "explore" caption.
    cardElements.forEach((el, i) => {
      if (i === centerIndex) el.setAttribute("data-active", "true");
      else el.removeAttribute("data-active");
    });

    cardElements.forEach((card, cardIndex) => {
      const slot = visibleMap.get(cardIndex);
      const wasVisible = previouslyVisible.has(cardIndex);

      if (slot !== undefined) {
        const { x, y, rot, scale, zIndex } = config(slot);
        const target = {
          x: `${x * multiplier}rem`,
          y: `${y * hMult}rem`,
          rotation: rot,
          scale,
          opacity: 1,
          zIndex,
        };

        if (layoutOnly) {
          // snap, and kill anything still in flight from the previous layout
          gsap.killTweensOf(card);
          gsap.set(card, target);
          onCardDone();
        } else if (isFirstMount) {
          if (instant) {
            gsap.set(card, target);
            onCardDone();
          } else {
            gsap.set(card, { x: 0, y: `${12 * hMult}rem`, rotation: 0, scale: 0.5, opacity: 0 });
            gsap.to(card, { ...target, duration: entryDuration, ease: "elastic.out(1.05,.78)", delay: reduced ? 0 : 0.2 + slot * 0.06, onComplete: onCardDone });
          }
        } else if (!wasVisible) {
          const enterX = direction === "right" ? 40 : -40;
          gsap.set(card, { x: `${enterX}rem`, y: `${y * hMult}rem`, rotation: direction === "right" ? 30 : -30, scale: 0.5, opacity: 0 });
          gsap.to(card, { ...target, duration: 0.6, ease: "power2.out", onComplete: onCardDone });
        } else {
          gsap.to(card, { ...target, duration: moveDuration, ease: "power2.out", onComplete: onCardDone });
        }
      } else if (layoutOnly) {
        // dropped out of the window by the resize — hide it where it stands
        // rather than flying it out past the new viewport edge
        gsap.killTweensOf(card);
        gsap.set(card, { opacity: 0, scale: 0.3, x: 0, y: 0, zIndex: 0 });
        onCardDone();
      } else if (wasVisible) {
        const exitX = direction === "right" ? -40 : 40;
        gsap.to(card, { x: `${exitX}rem`, opacity: 0, scale: 0.5, rotation: direction === "right" ? -30 : 30, duration: 0.4, ease: "power2.in", zIndex: 0 });
      } else if (isFirstMount) {
        gsap.set(card, { opacity: 0, scale: 0.3, x: 0, y: 0, zIndex: 0 });
      }
    });

    prevVisible.current = new Set(visibleMap.keys());

    // Hover interactions
    const visibleEntries: { el: HTMLElement; slot: number }[] = [];
    cardElements.forEach((el, i) => {
      const slot = visibleMap.get(i);
      if (slot !== undefined) visibleEntries.push({ el, slot });
    });
    visibleEntries.sort((a, b) => a.slot - b.slot);

    let activeSlot: number | null = null;
    let leaveTimer: ReturnType<typeof setTimeout> | null = null;
    const centerSlot = visibleEntries.length >> 1;

    const updateHoverLayout = (hoveredSlot: number | null) => {
      const mult = getResponsiveMultiplier(stageInnerWidth(container), windowSize);
      const hM = getHeightMultiplier(window.innerWidth);

      visibleEntries.forEach(({ el, slot }) => {
        const base = config(slot);
        let targetX = base.x * mult;
        let targetY = base.y * hM;
        let targetRot = base.rot;
        let targetScale = base.scale;
        let delay = 0;

        if (hoveredSlot !== null) {
          const distance = Math.abs(slot - hoveredSlot);
          delay = distance * 0.02;

          if (slot === hoveredSlot) {
            targetY -= 1.5 * hM;
            targetScale *= 1.05;
          } else {
            const normalized = centerSlot > 0 ? (slot - centerSlot) / centerSlot : 0;
            const pushStrength = 8 * (1 - Math.abs(normalized)) * (1 + 0.2 * Math.max(0, 3 - distance));

            if (slot < hoveredSlot) {
              targetX -= pushStrength * mult;
              targetRot -= 3 / (distance + 1);
            } else {
              targetX += pushStrength * mult;
              targetRot += 3 / (distance + 1);
            }

            if (slot === visibleEntries.length - 1 && hoveredSlot < centerSlot) targetY -= 1 * hM;
            if (slot === 0 && hoveredSlot > centerSlot) targetY -= 1 * hM;
          }
        } else {
          delay = Math.abs(slot - centerSlot) * 0.02;
        }

        gsap.to(el, {
          x: `${targetX}rem`, y: `${targetY}rem`, rotation: targetRot, scale: targetScale,
          duration: 0.5, delay, ease: "elastic.out(1,.75)", overwrite: "auto",
        });
        gsap.set(el, { zIndex: base.zIndex });
      });
    };

    const enterHandlers = visibleEntries.map(({ el, slot }) => {
      const handler = () => {
        if (isAnimating.current) return;
        if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
        if (activeSlot !== slot) { activeSlot = slot; updateHoverLayout(slot); }
      };
      el.addEventListener("mouseenter", handler);
      return { el, handler };
    });

    const onMouseLeave = () => {
      if (isAnimating.current) return;
      if (leaveTimer) clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => { activeSlot = null; updateHoverLayout(null); }, 50);
    };
    container.addEventListener("mouseleave", onMouseLeave);

    const onResize = () => { if (!isAnimating.current) updateHoverLayout(activeSlot); };
    window.addEventListener("resize", onResize);

    return () => {
      enterHandlers.forEach(({ el, handler }) => el.removeEventListener("mouseenter", handler));
      container.removeEventListener("mouseleave", onMouseLeave);
      window.removeEventListener("resize", onResize);
      if (leaveTimer) clearTimeout(leaveTimer);
    };
    // viewportWidth is a dependency: the layout reads window.innerWidth, so
    // without it a resize leaves the cards on transforms computed for the old
    // width and the edge cards hang outside the new viewport.
  }, [centerIndex, totalCards, getVisibleMap, paged, windowSize, slotTable, viewportWidth]);

  if (!totalCards) return null;

  const chevron = (direction: "left" | "right") => (
    <svg className="relative z-[2] w-4 h-4 md:w-5 md:h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points={direction === "left" ? "15 18 9 12 15 6" : "9 18 15 12 9 6"} />
    </svg>
  );

  return (
    <section className="flex flex-col items-center w-full py-4 lg:py-8 px-4 md:px-8 relative z-20 overflow-x-clip">
      <div className="flex items-center justify-center w-full max-w-[90rem]">
        <div
          ref={containerRef}
          className="fan-layout flex relative justify-center items-center w-full max-w-[80rem]"
          onTouchStart={(e) => { dragStartX.current = e.touches[0].clientX; dragged.current = false; }}
          onTouchMove={(e) => {
            if (dragStartX.current === null) return;
            if (Math.abs(e.touches[0].clientX - dragStartX.current) > 10) dragged.current = true;
          }}
          onTouchEnd={(e) => {
            if (dragStartX.current === null) return;
            const dx = e.changedTouches[0].clientX - dragStartX.current;
            dragStartX.current = null;
            if (Math.abs(dx) < SWIPE_THRESHOLD) { dragged.current = false; return; }
            cycle(dx < 0 ? "right" : "left");
          }}
          onMouseDown={(e) => { dragStartX.current = e.clientX; dragged.current = false; }}
          onMouseMove={(e) => {
            if (dragStartX.current === null) return;
            if (Math.abs(e.clientX - dragStartX.current) > 10) dragged.current = true;
          }}
          onMouseUp={(e) => {
            if (dragStartX.current === null) return;
            const dx = e.clientX - dragStartX.current;
            dragStartX.current = null;
            if (Math.abs(dx) < SWIPE_THRESHOLD) { dragged.current = false; return; }
            cycle(dx < 0 ? "right" : "left");
          }}
          onMouseLeave={() => { dragStartX.current = null; }}
          onDragStart={(e) => { e.preventDefault(); }}
          onClickCapture={(e) => {
            if (dragged.current) {
              e.preventDefault();
              e.stopPropagation();
              dragged.current = false;
            }
          }}
        >
          {cards.map((card, index) => {
            const face = (
              <div className="fan-face">
                {card.icon ? (
                  <span className="fan-mark">{card.icon}</span>
                ) : (
                  <span className="fan-photo">
                    <img src={card.imgUrl} loading="lazy" alt="" className="absolute inset-0 w-full h-full object-cover z-10" />
                  </span>
                )}
                <span className="fan-name">{card.title || card.alt || `Card ${index}`}</span>
                <span className="fan-explore" aria-hidden="true">Explore <span className="fan-arr">→</span></span>
              </div>
            );
            const label = card.title || card.alt || `Card ${index}`;
            return card.linkUrl ? (
              <a key={index} href={card.linkUrl} target={card.linkUrl.startsWith("http") ? "_blank" : "_self"} rel="noopener noreferrer" aria-label={`${label} — open demo website`} className="fan-card block cursor-pointer">{face}</a>
            ) : (
              <div key={index} className="fan-card">{face}</div>
            );
          })}
        </div>
      </div>

      {showControls && (
        <div className="flex items-center justify-center gap-4 mt-4 md:mt-6 z-30">
          <button className={`fan-arrow ${ARROW_CLASSES} w-10 h-10 md:w-12 md:h-12`} onClick={() => cycle("left")} aria-label="Previous example">
            {chevron("left")}
          </button>
          <div className="flex items-center gap-2">
            {cards.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Show example ${i + 1}`}
                aria-current={i === centerIndex}
                className={`fan-dot w-2 h-2 rounded-full transition-all duration-300 ${i === centerIndex ? "bg-black/70 dark:bg-white/80 scale-[1.3]" : "bg-black/15 dark:bg-white/15"}`}
              />
            ))}
          </div>
          <button className={`fan-arrow ${ARROW_CLASSES} w-10 h-10 md:w-12 md:h-12`} onClick={() => cycle("right")} aria-label="Next example">
            {chevron("right")}
          </button>
        </div>
      )}
    </section>
  );
}