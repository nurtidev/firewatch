"use client";

/* Scroll-reveal primitives for the three public landing pages ("/", "/gov",
   "/business"). IntersectionObserver + CSS transitions only — no deps.

   IMPORTANT gotcha this file works around: globals.css has
     html.fw-theme-ready, html.fw-theme-ready * { transition: background-color ..., border-color ..., color ...; }
   `fw-theme-ready` is added to <html> shortly after mount and stays forever
   (see lib/theme.tsx), so that compound selector (specificity 0,1,1) beats a
   plain utility class like `transition-opacity` (0,1,0) on every element,
   for ALL FOUR transition longhands (property/duration/timing-function/delay)
   at once — since they come from one shorthand. That would silently replace
   our transition-property with "background-color, border-color, color" and
   our opacity/transform changes would stop animating (snap instead of fade)
   once fw-theme-ready is present. Inline `style.transition` sidesteps this:
   inline styles win over any non-!important stylesheet rule regardless of
   selector specificity. Do not "clean this up" into Tailwind transition-*
   utility classes. */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const DURATION_MS = 560;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Mirrors the IntersectionObserver options below (threshold .15, bottom
 *  rootMargin -40px): is `el` already close enough to the viewport right now
 *  that it should be treated as visible from the very first paint? */
function isNearViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  return rect.top < vh - 40 && rect.bottom > 0;
}

/**
 * Shared trigger: starts `active = true` (SSR/no-JS safe — nothing is ever
 * hidden by default). On mount, synchronously (before paint, via layout
 * effect) checks whether the element is already in/near the viewport:
 *   - if yes, or reduced-motion is on → stays active forever, never hidden,
 *     never animates (no flash, no wasted transition).
 *   - if no → flips to inactive *before the browser paints*, so the "hidden"
 *     state is the very first thing painted (no flash of visible-then-hidden).
 *     An IntersectionObserver then watches it and flips back to active once,
 *     unobserving after.
 */
function useScrollReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [active, setActive] = useState(true);
  const wasHiddenRef = useRef(false);
  const reducedMotion = usePrefersReducedMotion();

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion) {
      // reducedMotion arrives async (matchMedia effect) — it can flip to true
      // AFTER the first pass already hid a below-fold element; un-hide it,
      // otherwise the observer branch bails out and it stays invisible.
      setActive(true);
      return;
    }
    if (isNearViewport(el)) return;
    wasHiddenRef.current = true;
    setActive(false);
  }, [reducedMotion]);

  useEffect(() => {
    const el = ref.current;
    if (!el || active || reducedMotion) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setActive(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, reducedMotion]);

  return { ref, active, reducedMotion, wasHidden: wasHiddenRef.current };
}

/**
 * Fade-in + rise-in wrapper. Renders visible by default (no flash before
 * hydration, degrades gracefully with no JS); only ever hidden client-side,
 * and only for elements not yet in view. Animates once. Respects
 * prefers-reduced-motion (shows immediately, no transition).
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  /** stagger delay in ms */
  delay?: number;
}) {
  const { ref, active, reducedMotion } = useScrollReveal<HTMLDivElement>();
  const hidden = !active;

  return (
    <div
      ref={ref}
      className={cn(hidden && "opacity-0 translate-y-4", className)}
      style={
        reducedMotion
          ? undefined
          : {
              transition: `opacity ${DURATION_MS}ms ${EASE}, transform ${DURATION_MS}ms ${EASE}`,
              transitionDelay: delay ? `${delay}ms` : undefined,
            }
      }
    >
      {children}
    </div>
  );
}

function formatNumber(n: number, decimals: number): string {
  return n.toLocaleString("ru-RU", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Counts up from 0 to `value` once, when scrolled into view (~1.2s,
 * ease-out cubic, requestAnimationFrame). If already in view at load, or
 * under prefers-reduced-motion, or with JS disabled, shows the final
 * formatted value immediately — never blocks on the animation.
 *
 * Only the numeric part is animated; `prefix`/`suffix` wrap it verbatim
 * (e.g. prefix="~" suffix="%", or suffix=" млрд ₸"). `decimals` controls
 * fixed-point formatting (ru-RU locale → comma decimal, thin-space
 * thousands separator).
 *
 * Width never jumps: an invisible spacer holding the final text reserves
 * the box size; the live counter is stacked on top of it via CSS grid.
 */
export function CountUp({
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  duration = 1200,
  className,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  duration?: number;
  className?: string;
}) {
  const { ref, active, reducedMotion, wasHidden } = useScrollReveal<HTMLSpanElement>();
  const [display, setDisplay] = useState(value);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    if (reducedMotion || !wasHidden || startedRef.current) {
      setDisplay(value);
      return;
    }
    startedRef.current = true;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(value * easeOutCubic(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, reducedMotion, wasHidden, value, duration]);

  const finalText = `${prefix}${formatNumber(value, decimals)}${suffix}`;
  const currentText = `${prefix}${formatNumber(display, decimals)}${suffix}`;

  return (
    <span
      ref={ref}
      className={cn("relative inline-grid tabular", className)}
      aria-label={finalText}
    >
      <span className="invisible col-start-1 row-start-1" aria-hidden="true">
        {finalText}
      </span>
      <span className="col-start-1 row-start-1" aria-hidden="true">
        {currentText}
      </span>
    </span>
  );
}
