import { describe, expect, it } from "vitest";
import { MAX_KEY_LEN, inOrder, isValidKey, keyBetween } from "./order";

const key = (before: string | null, after: string | null) => {
  const k = keyBetween(before, after);
  if (k === null) throw new Error("expected a key");
  return k;
};

describe("fractional order keys (ported from orbyn-planner order.rs)", () => {
  it("keys_sort_between_their_bounds", () => {
    const first = key(null, null);
    const after = key(first, null);
    const before = key(null, first);
    const middle = key(first, after);
    expect(before < first && first < middle && middle < after).toBe(true);
    for (const k of [first, after, before, middle]) expect(isValidKey(k), k).toBe(true);
  });

  it("a_thousand_inserts_in_one_spot_never_tie", () => {
    const a = key(null, null);
    let b = key(a, null);
    for (let i = 0; i < 1000; i++) {
      const k = key(a, b);
      expect(a < k && k < b, `${a} < ${k} < ${b}`).toBe(true);
      expect(isValidKey(k)).toBe(true);
      b = k;
    }
    // Each halving adds about log2(62) bits, so a key grows about one character per six inserts.
    expect(b.length, `key length ${b.length}`).toBeLessThanOrEqual(1000 / 5 + 10);
  });

  it("inserting_at_the_top_repeatedly_keeps_order", () => {
    let top = key(null, null);
    for (let i = 0; i < 500; i++) {
      const k = key(null, top);
      expect(k < top && isValidKey(k)).toBe(true);
      top = k;
    }
  });

  it("bad_or_reversed_bounds_are_refused", () => {
    expect(keyBetween("b", "a")).toBeNull();
    expect(keyBetween("a", "a")).toBeNull();
    expect(keyBetween("a0", null)).toBeNull();
    expect(keyBetween("a-", null)).toBeNull();
    expect(isValidKey("")).toBe(false);
  });

  it("the_choice_is_pinned_for_ports", () => {
    expect(keyBetween(null, null)).toBe("V");
    let k = "V";
    const appended: string[] = [];
    for (let i = 0; i < 6; i++) {
      k = key(k, null);
      appended.push(k);
    }
    expect(appended).toEqual(["k", "s", "w", "y", "z", "zV"]);
    expect(keyBetween("a", "b")).toBe("aV");
    expect(keyBetween("az", "b")).toBe("azV");
    expect(keyBetween("a", "a0V")).toBe("a0F");
    expect(keyBetween(null, "1")).toBe("0V");
  });

  it("very_long_keys_are_refused_without_deep_recursion", () => {
    const long = "z".repeat(100_000);
    expect(isValidKey(long)).toBe(false);
    expect(keyBetween(long, null)).toBeNull();
    const atLimit = "z".repeat(MAX_KEY_LEN);
    expect(isValidKey(atLimit)).toBe(true);
    expect(keyBetween(atLimit, null)).toBeNull(); // the result would exceed the cap
  });
});

describe("inOrder", () => {
  it("sorts by key, then by id", () => {
    const steps = [
      { id: "c", order: "k" },
      { id: "b", order: "V" },
      { id: "a", order: "V" },
    ];
    expect(inOrder(steps).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(steps.map((s) => s.id)).toEqual(["c", "b", "a"]);
  });
});
