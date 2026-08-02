import { useEffect, useRef, useState } from 'react';

/**
 * Functional motion only. Every animation here exists to help the eye track a
 * state change on a screen that updates itself: a number that moved, a row
 * that changed underneath you.
 *
 * Durations stay in the 150–250 ms band and easing is ease-out, matching the
 * AntD motion tokens set in App.tsx. Nothing here blocks interaction, and
 * everything collapses to an instant swap under `prefers-reduced-motion`.
 */

const COUNT_UP_MS = 250;

/** ease-out — fast start, gentle settle. */
function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Counts from the previous value to the next one instead of snapping, so a
 * KPI that ticks while you are looking elsewhere still registers peripherally.
 */
export function useCountUp(value: number): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (prefersReducedMotion()) {
      from.current = value;
      setShown(value);
      return;
    }

    const start = performance.now();
    const origin = from.current;
    const delta = value - origin;
    if (delta === 0) return;

    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS);
      const next = origin + delta * easeOut(t);
      setShown(next);
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
  }, [value]);

  return shown;
}

export function AnimatedNumber({
  value,
  precision = 0,
}: {
  value: number;
  precision?: number;
}): React.ReactElement {
  const shown = useCountUp(value);
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      {shown.toLocaleString('ru-RU', {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      })}
    </span>
  );
}

/**
 * Returns a class name that briefly tints a row when `token` changes, so a
 * live update in a long table catches the eye instead of silently replacing
 * a value you were reading.
 */
export function useFlashOnChange(token: string | number): string {
  const previous = useRef(token);
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    if (previous.current === token) return;
    previous.current = token;
    if (prefersReducedMotion()) return;

    setFlashing(true);
    const timer = setTimeout(() => {
      setFlashing(false);
    }, FLASH_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [token]);

  return flashing ? 'scoot-flash' : '';
}

/** Long enough to notice out of the corner of an eye, short enough to ignore. */
const FLASH_MS = 700;

/**
 * Injected once rather than shipped as a stylesheet import, so the motion
 * rules live next to the hooks that depend on them.
 */
export function MotionStyles(): React.ReactElement {
  return (
    <style>{`
      @keyframes scoot-flash-fade {
        from { background-color: rgba(22, 119, 255, 0.16); }
        to   { background-color: transparent; }
      }
      .scoot-flash > td {
        animation: scoot-flash-fade ${String(FLASH_MS)}ms ease-out;
      }
      .scoot-enter {
        animation: scoot-enter-fade 200ms cubic-bezier(0.22, 1, 0.36, 1) both;
      }
      @keyframes scoot-enter-fade {
        from { opacity: 0; transform: translateY(4px); }
        to   { opacity: 1; transform: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .scoot-flash > td, .scoot-enter { animation: none; }
      }
    `}</style>
  );
}
