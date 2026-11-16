import { describe, expect, it } from "vitest";
import { placeSvgTexts, svgViewport } from "../src/svgplace.js";
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

describe("placeSvgTexts with an offset viewBox", () => {
  it("keeps names inside the frame the viewBox gives, wherever it starts", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="-850 7520 400 300">
      <path d="M-850,7670 H-450" stroke="#000" stroke-width="3"/>
      <text x="-650" y="7675" text-anchor="middle" font-size="20">Amisos</text></svg>`;
    const res = placeSvgTexts(svg);
    expect(res.failed).toEqual([]);
    expect(res.placements[0]!.why0).toBe("line");
    const t = readTexts(res.svg)[0]!;
    expect(t.x).toBeGreaterThan(-850);
    expect(t.y).toBeGreaterThan(7520);
  });
});


describe("svgViewport", () => {
  const root = (attrs: string) => svgViewport(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}></svg>`);

  it("reads the size in px and keeps the viewBox as the frame", () => {
    expect(root(`width="210mm" height="297mm" viewBox="0 0 210 297"`)).toEqual({
      frame: [0, 0, 210, 297], width: 210 * 3.7795275, height: 297 * 3.7795275, preserveAspectRatio: "xMidYMid meet",
    });
  });

  it("uses the size in px as the frame when there is no viewBox", () => {
    expect(root(`width="2in" height="1in"`).frame).toEqual([0, 0, 192, 96]);
  });

  it("fills in a missing size as MediaWiki does", () => {
    expect(root(`viewBox="0 0 2000 1000"`)).toMatchObject({ width: 512, height: 256 });
    expect(root(`height="300" viewBox="0 0 2000 1000"`)).toMatchObject({ width: 600, height: 300 });
    expect(root(`width="100%" viewBox="0 0 2000 1000"`)).toMatchObject({ width: 512, height: 256 });
  });

  it("keeps preserveAspectRatio", () => {
    expect(root(`width="100" height="100" viewBox="0 0 200 100" preserveAspectRatio="xMinYMin slice"`).preserveAspectRatio)
      .toBe("xMinYMin slice");
  });
});
