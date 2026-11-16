import { describe, expect, it } from "vitest";
import { pathSubpaths } from "../src/path.js";

const read = (d: string) => {
  const warnings: string[] = [];
  const subs = pathSubpaths(d, (w) => warnings.push(w));
  return { pts: subs.map((s) => s.pts), warnings };
};

describe("pathSubpaths on bad data", () => {
  it("keeps the segments before a character that is not path data", () => {
    // "a" replaced by "to" somewhere along the way (seen on Commons): librsvg draws up to there.
    const r = read("M 10 90 L 50 50 to 1 1 0 0 0 90 10");
    expect(r.pts).toEqual([[[10, 90], [50, 50]]]);
    expect(r.warnings).toHaveLength(1);
  });
  it("drops a segment that is cut short", () => {
    expect(read("M0 0 L 10 0 L 20").pts).toEqual([[[0, 0], [10, 0]]]);
    expect(read("M0 0 L 10 0 C 1 2 3 4 Z").pts).toEqual([[[0, 0], [10, 0]]]);
  });
  it("reads nothing when the data does not start with a moveto", () => {
    expect(read("L 10 10 20 20").pts).toEqual([]);
    expect(read('path("M 0 0 L 9 9")').pts).toEqual([]);
  });
  it("is silent on good data", () => {
    expect(read("M0,0 10,0, 10,10z m 5 5 h 1").warnings).toEqual([]);
  });
});

describe("pathSubpaths with arcs followed", () => {
  const near = (p: readonly number[], q: readonly number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!) < 1e-9;

  it("keeps the straight line to the end point by default, as the Python version", () => {
    expect(pathSubpaths("M0,0 A50,50 0 0 1 100,0", () => {})[0]!.pts).toEqual([[0, 0], [100, 0]]);
  });

  it("follows a half circle, on the side the sweep flag gives", () => {
    const up = pathSubpaths("M0,0 A50,50 0 0 1 100,0", () => {}, { arcs: true })[0]!.pts;
    const down = pathSubpaths("M0,0 a50,50 0 0 0 100,0", () => {}, { arcs: true })[0]!.pts;
    expect(up.every(([x, y]) => Math.abs(Math.hypot(x - 50, y) - 50) < 1e-9)).toBe(true);
    expect(up.some(([, y]) => y < -49)).toBe(true); // y points down, so sweep 1 goes over the top
    expect(down.some(([, y]) => y > 49)).toBe(true);
    expect(near(up[up.length - 1]!, [100, 0])).toBe(true);
  });

  it("scales radii that are too small, and takes the large arc when asked", () => {
    const small = pathSubpaths("M0,0 A10,10 0 0 1 100,0", () => {}, { arcs: true })[0]!.pts;
    expect(small.every(([x, y]) => Math.abs(Math.hypot(x - 50, y) - 50) < 1e-9)).toBe(true);
    const large = pathSubpaths("M0,0 A100,100 0 1 1 100,0", () => {}, { arcs: true })[0]!.pts;
    expect(Math.min(...large.map(([, y]) => y))).toBeLessThan(-100);
  });
});
