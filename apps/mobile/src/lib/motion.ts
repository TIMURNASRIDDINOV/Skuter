import { useEffect, useRef, useState } from 'react';
import { Easing, useReducedMotion } from 'react-native-reanimated';

/**
 * Motion vocabulary, matched to the back office so the two apps read as
 * siblings rather than unrelated products.
 *
 * Durations sit in the 150–250 ms band, entrances ease out and exits ease in,
 * exactly as `apps/admin` sets its Ant Design motion tokens. Anything longer
 * here is an *ongoing state* indicator rather than a transition — the unlock
 * ring and the skeleton pulse loop at 600–900 ms on purpose, and the band does
 * not apply to them.
 */

export const DURATION = {
  fast: 150,
  base: 200,
  slow: 250,
} as const;

/** Quick to start, gentle to settle. The admin panel's `motionEaseOut`. */
export const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
export const EASE_IN = Easing.bezier(0.64, 0, 0.78, 0);

/**
 * Durations that collapse to zero when the OS asks for reduced motion.
 *
 * Reanimated's `useReducedMotion` reads the platform setting (iOS Settings →
 * Accessibility → Motion, Android's animation scale). Returning 0 rather than
 * branching at every call site means an animation becomes an instant swap
 * without any component needing to know that happened.
 */
export function useMotion(): {
  reduced: boolean;
  duration: (ms: number) => number;
} {
  const reduced = useReducedMotion();
  return {
    reduced,
    duration: (ms: number) => (reduced ? 0 : ms),
  };
}

/**
 * Counts from the previous value to the next instead of snapping.
 *
 * The ride cost is charged per whole minute, so it does not creep — it jumps
 * by a full minute's fare once a minute. Snapping reads as a glitch on a
 * number the rider is watching; sliding over 250 ms reads as it being charged.
 * Same principle as the back office's live KPIs.
 */
export function useCountUp(value: number, ms: number = DURATION.slow): number {
  const { reduced } = useMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const origin = from.current;
    const delta = value - origin;

    if (reduced || delta === 0) {
      from.current = value;
      setShown(value);
      return;
    }

    const start = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / ms);
      const eased = 1 - (1 - t) ** 3;
      setShown(origin + delta * eased);
      if (t < 1) {
        frame.current = requestAnimationFrame(step);
      } else {
        from.current = value;
        frame.current = null;
      }
    };
    frame.current = requestAnimationFrame(step);

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      // Land on the target so an interrupted run never leaves a stale figure.
      from.current = value;
    };
  }, [value, ms, reduced]);

  return shown;
}
