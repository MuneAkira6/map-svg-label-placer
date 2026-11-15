import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { degrees, dist, floorDiv, hypot, pyLen, pyRound, radians, truthy } from "../src/py.js";

type Vectors = {
  round: [number, number | null, number][];
  floordiv: [number, number, number][];
  hypot: [number, number, number][];
  dist: [[number, number], [number, number], number][];
  angles: [number, number, number][];
};
const v: Vectors = JSON.parse(readFileSync(new URL("./py_vectors.json", import.meta.url), "utf8"));

// Bit-for-bit against values printed by CPython 3.11 (reference/py_vectors.py).
describe("matches CPython bit for bit", () => {
  it("round(x) and round(x, n)", () => {
    const bad = v.round.filter(([x, n, want]) => !Object.is(pyRound(x, n ?? undefined), want));
    expect(bad).toEqual([]);
  });
  it("float floor division", () => {
    const bad = v.floordiv.filter(([a, b, want]) => !Object.is(floorDiv(a, b), want));
    expect(bad).toEqual([]);
  });
  it("math.hypot", () => {
    const bad = v.hypot.filter(([x, y, want]) => hypot(x, y) !== want);
    expect(bad).toEqual([]);
  });
  it("math.dist", () => {
    const bad = v.dist.filter(([p, q, want]) => dist(p, q) !== want);
    expect(bad).toEqual([]);
  });
  it("math.radians and math.degrees", () => {
    const bad = v.angles.filter(([d, r, back]) => radians(d) !== r || degrees(r) !== back);
    expect(bad).toEqual([]);
  });
});

describe("Python semantics that differ from JavaScript", () => {
  it("rounds exact ties to even", () => {
    expect(pyRound(2.5)).toBe(2);
    expect(pyRound(3.5)).toBe(4);
    expect(pyRound(0.125, 2)).toBe(0.12);
    expect(pyRound(2.675, 2)).toBe(2.67); // 2.675 is really 2.67499999...
  });
  it("floor-divides like Python, not Math.floor(a / b)", () => {
    expect(floorDiv(1, 0.1)).toBe(9);
    expect(Math.floor(1 / 0.1)).toBe(10);
  });
  it("counts code points", () => {
    expect(pyLen("𠀀村")).toBe(2);
    expect("𠀀村".length).toBe(3);
  });
  it("treats empty arrays and objects as false", () => {
    expect([[], {}, "", 0, null].map(truthy)).toEqual([false, false, false, false, false]);
    expect([[0], { a: 1 }, "x", 1].map(truthy)).toEqual([true, true, true, true]);
  });
});

describe("Python string formatting", () => {
  const fmt: [number, string, string, string, string][] = (v as unknown as { format: [number, string, string, string, string][] }).format;
  it('format(x, "g"), ".2f", ".0f" and repr', async () => {
    const { formatG, formatF, floatRepr } = await import("../src/py.js");
    const bad = fmt.filter(([x, g, f2, f0, r]) => formatG(x) !== g || formatF(x, 2) !== f2 || formatF(x, 0) !== f0 || floatRepr(x) !== r);
    expect(bad).toEqual([]);
  });
});
