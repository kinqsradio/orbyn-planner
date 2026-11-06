/**
 * Fractional order keys: strings that sort between any two others, so a step inserted anywhere
 * gets a key between its neighbours and no other step changes.
 *
 * A key is a base-62 fraction: the digits `0-9`, `A-Z`, `a-z` (in ASCII order) after an implied
 * "0.", with no trailing `0`, so every value has exactly one key and keys compare correctly as
 * plain strings. Keys are at most MAX_KEY_LEN characters.
 *
 * A TypeScript port of orbyn-engine's `orbyn-planner` order.rs; keep the two in step. The exact
 * choice, which a port must copy so concurrent inserts tie the same way on every platform. Walk the
 * digits of the lower bound `lo` (missing digits read as 0) and the upper bound `hi` (missing
 * digits read as 0; no upper bound reads every digit as 62):
 * - while the digits are equal, copy the digit;
 * - at the first difference, if the gap is more than 1, write `lo + floor((hi - lo) / 2)` and stop;
 * - if the digits are adjacent, copy `lo`'s digit and continue with the rest of `lo` against no
 *   upper bound.
 *
 * So no bounds give `V`, and appending gives `k`, `s`, `w`, `y`, `z`, `zV`, …. Keys grow by about
 * one character per six inserts in the same spot, and per six appends at the end. Steps sort by
 * key, then by id.
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = 62;

/** The longest key accepted or produced. About 6,000 inserts in one spot fit. */
export const MAX_KEY_LEN = 1024;

const value = (c: string): number => DIGITS.indexOf(c);

/** True for a non-empty key of base-62 digits that does not end in `0`. */
export function isValidKey(key: string): boolean {
  if (key.length === 0 || key.length > MAX_KEY_LEN || key.endsWith("0")) return false;
  for (const c of key) if (value(c) < 0) return false;
  return true;
}

/**
 * A key that sorts after `before` and before `after` (null for the ends of the list). Returns null
 * when the bounds are invalid or not in order, or when the result would be longer than MAX_KEY_LEN.
 */
export function keyBetween(before: string | null, after: string | null): string | null {
  if (before !== null && !isValidKey(before)) return null;
  if (after !== null && !isValidKey(after)) return null;
  if (before !== null && after !== null && before >= after) return null;
  const lo = before === null ? [] : [...before].map(value);
  const hi = after === null ? null : [...after].map(value);
  const digits = midpoint(lo, hi);
  if (digits.length > MAX_KEY_LEN) return null;
  return digits.map((d) => DIGITS[d]).join("");
}

/** Digits strictly between the fractions `lo` and `hi` (null meaning 1). Iterative, so a long key cannot overflow the stack. */
function midpoint(lo: number[], hiStart: number[] | null): number[] {
  const out: number[] = [];
  let hi = hiStart;
  for (let i = 0; ; i++) {
    const l = lo[i] ?? 0;
    const h = hi === null ? BASE : (hi[i] ?? 0);
    if (l === h) {
      out.push(l);
    } else if (h - l > 1) {
      out.push(l + Math.floor((h - l) / 2));
      return out;
    } else {
      // Adjacent digits: keep `l` and go one place deeper, below 1.
      out.push(l);
      hi = null;
    }
  }
}

/** Steps in display order: by key, then by id. */
export function inOrder<T extends { id: string; order: string }>(steps: readonly T[]): T[] {
  return [...steps].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
