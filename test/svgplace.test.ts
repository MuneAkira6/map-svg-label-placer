import { describe, expect, it } from "vitest";
import { placeSvgTexts } from "../src/svgplace.js";
import { readTexts } from "../src/svgtext.js";

// Names written straight onto the lines they should avoid, as in many hand-made maps.
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <rect width="100%" height="100%" fill="#f5f5f5"/>
  <path id="road" d="M20,200 C150,180 250,230 580,190" fill="none" stroke="#ff4800" stroke-width="2.5"/>
  <path id="rail" d="M20,120 L200,110 L400,135 L580,125" fill="none" stroke="#000" stroke-width="4"/>
  <circle id="town" cx="182" cy="192" r="5" fill="#fff" stroke="#000"/>
  <g id="names" font-family="Liberation Sans, Arial, sans-serif" font-size="16">
    <text id="t-town" x="190" y="198">Riverton</text>
    <text x="400" y="140" font-size="20">Northfield</text>
    <switch>
      <text systemLanguage="zh-hans" x="300" y="210" font-family="WenQuanYi Zen Hei">甲县</text>
      <text systemLanguage="zh-hant" x="300" y="210" font-family="WenQuanYi Zen Hei">甲縣</text>
      <text x="300" y="210">Jia County</text>
    </switch>
  </g>
  <g id="legend"><rect x="420" y="300" width="150" height="80" fill="#fff" stroke="#000"/>
    <text x="480" y="330" font-size="12">Road</text></g>
</svg>
`;
const cfg = { svg_text: { fixed: ["legend"], points: { "t-town": "town" } } };

const stripXY = (s: string) => s.replace(/\s(x|y)="[^"]*"/g, "");

describe("placeSvgTexts", () => {
  const res = placeSvgTexts(svg, cfg);

  it("moves every name off the lines and symbols", () => {
    expect(res.failed).toEqual([]);
    expect(res.placements.map((p) => [p.name, p.why0])).toEqual([
      ["Riverton", "point"],
      ["Northfield", "line"],
      ["Jia County", "line"],
    ]);
  });
  it("changes nothing but x and y values", () => {
    expect(res.svg).not.toBe(svg);
    expect(stripXY(res.svg)).toBe(stripXY(svg));
  });
  it("leaves the legend where it was", () => {
    expect(res.svg).toContain('<text x="480" y="330" font-size="12">Road</text>');
  });
  it("moves the language versions of one name together", () => {
    const sw = readTexts(res.svg).filter((t) => t.switchAt !== null);
    expect(new Set(sw.map((t) => `${t.x},${t.y}`)).size).toBe(1);
  });
  it("puts a point's name next to its symbol", () => {
    expect(res.placements[0]!.how.kind).toBe("point");
  });
  it("is stable: a second run finds nothing to move", () => {
    const again = placeSvgTexts(res.svg, cfg);
    expect(again.placements.map((p) => p.why0)).toEqual([null, null, null]);
    expect(again.svg).toBe(res.svg);
  });
});
