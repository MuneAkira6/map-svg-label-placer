import { describe, expect, it } from "vitest";
import type { Config, LabelDoc } from "../src/config.js";
import { placeLabels } from "../src/place.js";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
<path id="road" d="M0,50 L200,50" stroke="#000" stroke-width="2"/></svg>`;
const cfg: Config = { styles: { "200": { area: [10, false, false, "#000", 0] } }, place: { width: 200 } };
const doc = (): LabelDoc => ({ width: 200, height: 100, labels: [{ name: "constructor", kind: "area", x: 100, y: 50 }] });

describe("placeLabels", () => {
  it("moves a label off a line", () => {
    const { placements } = placeLabels(svg, doc(), cfg);
    expect(placements[0]!.why0).toBe("line");
    expect(placements[0]!.how).toEqual({ kind: "area" });
    expect(Math.abs(placements[0]!.y - 50)).toBeGreaterThan(5);
  });
  it("does not modify its inputs", () => {
    const input = doc();
    const before = structuredClone(input);
    placeLabels(svg, input, cfg);
    expect(input).toEqual(before);
  });
  it("does not look names up on Object.prototype", () => {
    // "constructor" is not in place.lines, so it must not be treated as a line name.
    expect(() => placeLabels(svg, doc(), cfg)).not.toThrow();
  });
  it("rejects the legacy SVG reader, which is not ported", () => {
    expect(() => placeLabels(svg, doc(), { ...cfg, place: { ...cfg.place, svg_parse: "legacy" } })).toThrow(/legacy/);
  });
});
