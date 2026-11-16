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
