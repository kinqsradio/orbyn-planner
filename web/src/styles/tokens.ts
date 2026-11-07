/**
 * The values of tokens.css that JavaScript needs. tokens.test.ts keeps the two files equal, so a value is changed in both or the
 * test fails.
 */

/** The motion durations, in milliseconds at the normal speed (--k is 1): `--m-fast` and the rest of tokens.css. */
export const MOTION_MS = {
  fast: 150,
  base: 200,
  slow: 300,
  page: 240,
  fastOut: 105,
  baseOut: 140,
  slowOut: 210,
  pageOut: 170,
  wait: 400,
  hover: 500,
  stag: 60,
} as const;

/** The two easings (`--m-out`, `--m-io`). */
export const EASING = {
  out: "cubic-bezier(.2, .8, .2, 1)",
  io: "cubic-bezier(.4, 0, .2, 1)",
} as const;

/** What `--k` is under `html.slow`, the designs' "Slow ×4". */
export const SLOW_FACTOR = 4;

/** `--k` now: 1, or 4 while `html` has the class `slow`. */
export function motionFactor(): number {
  return typeof document !== "undefined" && document.documentElement.classList.contains("slow") ? SLOW_FACTOR : 1;
}

/** A motion duration in milliseconds as it is now (`--k` applied). */
export function motionMs(name: keyof typeof MOTION_MS): number {
  return MOTION_MS[name] * motionFactor();
}

/** The fills of the red button (`.danger`) per theme, with white text on each: `--danger-bg`, `--danger-bg-hover`, `--danger-bg-press`. */
export const DANGER_FILL = {
  light: { bg: "#d42a2a", hover: "#b91c1c", press: "#991b1b" },
  dark: { bg: "#dc2626", hover: "#c81e1e", press: "#b91c1c" },
  dim: { bg: "#c93a33", hover: "#b8322b", press: "#a82a24" },
} as const;

/** Pixels per hour in the time grid (`--hour`), as in the designs' 52px slots. */
export const HOUR_PX = 52;

/** The widest a phone window is (the `max-width` of the phone layout's media query; CSS cannot take it from a custom property). */
export const PHONE_MAX_PX = 767;
