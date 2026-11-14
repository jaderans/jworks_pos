import type { WheelSlice } from './wheel';

/** How long a spin takes, from the tap to the stop. */
export const SPIN_MS = 7000;

/**
 * How far along the spin is at time t (0 to 1): fast at first, then a long,
 * gentle slow-down, so the last few slices creep past the pointer, like a
 * real prize wheel.
 */
export const spinAngle = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 4);
};

/** The slice under the pointer at the top when the wheel has turned `angle` degrees clockwise. */
export function sliceUnderPointer(slices: readonly WheelSlice[], angle: number): number {
  const at = (((-angle % 360) + 360) % 360);
  const i = slices.findIndex((s) => at >= s.from && at < s.to);
  return i < 0 ? slices.length - 1 : i;
}

/**
 * Where to turn to from wherever the wheel is: the same resting place as
 * `turn` (so the drawn prize ends under the pointer), at least `minTurns`
 * whole turns further on.
 */
export function spinTarget(from: number, turn: number, minTurns = 5): number {
  const rest = ((turn % 360) + 360) % 360;
  return rest + 360 * Math.ceil((from + minTurns * 360 - rest) / 360);
}
