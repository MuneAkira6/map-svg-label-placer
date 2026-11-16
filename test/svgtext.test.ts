import { describe, expect, it } from "vitest";
import { apply } from "../src/geometry.js";
import { parseSvg } from "../src/svg.js";
import { moveTexts, readTexts, shortNumber } from "../src/svgtext.js";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
<g id="labels" font-size="12" font-family="DejaVu Sans">
  <text id="a" x="10" y="20">Alpha &amp; co</text>
  <text id="b" x="50" y="60" transform="rotate(90 50 60)" text-anchor="middle">Beta</text>
  <text id="c" y='30'><tspan x="100 110" y="30">Ga</tspan><tspan x="100" dy="12">mma</tspan></text>
</g>
<g id="legend"><text x="150" y="90" font-weight="bold">Key</text></g>
<switch><text systemLanguage="zh-hans" x="20" y="80">简</text><text x="20" y="80">Default</text></switch>
<defs><text id="hidden" x="0" y="0">x</text></defs>
</svg>`;

describe("readTexts", () => {
  const t = readTexts(svg);
  it("reads every text with inherited font settings", () => {
    expect(t.map((x) => x.content)).toEqual(["Alpha & co", "Beta", "Gamma", "Key", "简", "Default", "x"]);
    expect(t[0]).toMatchObject({ id: "a", x: 10, y: 20, fontSize: 12, fontFamily: "DejaVu Sans", anchor: "start", ancestors: ["labels"] });
    expect(t[1]!.anchor).toBe("middle");
    expect(t[3]).toMatchObject({ fontWeight: "bold", ancestors: ["legend"] });
  });
  it("groups language versions under one <switch>", () => {
    expect(t[4]!.switchAt).not.toBeNull();
    expect(t[4]!.switchAt).toBe(t[5]!.switchAt);
    expect([t[4]!.lang, t[5]!.lang]).toEqual(["zh-hans", undefined]);
  });
  it("flags texts that are not drawn", () => {
    expect(t.map((x) => x.hidden)).toEqual([false, false, false, false, false, false, true]);
  });
  it("finds the x and y values of the text and its tspans", () => {
    expect(t[2]!.coords.map((c) => [c.axis, c.values])).toEqual([["y", [30]], ["x", [100, 110]], ["y", [30]], ["x", [100]]]);
  });
});

describe("what librsvg does not draw", () => {
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">
<path id="p" d="M0,50 L200,50"/>
<text x="10" y="20">Plain<textPath xlink:href="#p">Along</textPath></text>
<text><textPath xlink:href="#p">Only along</textPath></text>
<flowRoot><flowRegion><rect width="100" height="40"/></flowRegion><flowPara>Flowed</flowPara></flowRoot>
<foreignObject><svg><text x="0" y="0">Inside</text></svg></foreignObject>
<inkscape:box><text x="0" y="0">Ink</text></inkscape:box>
<svg:g><svg:text x="0" y="0">Prefixed</svg:text></svg:g>
</svg>`;
  const t = readTexts(doc);
  it("skips the characters of a <textPath>", () => {
    expect(t[0]!.chars.map((c) => c.ch).join("")).toBe("Plain");
    expect(t[1]!.chars).toEqual([]);
    expect(t.slice(0, 2).map((x) => x.onPath)).toEqual([true, true]);
  });
  it("draws nothing inside elements it does not know, or outside the SVG namespace", () => {
    expect(t.map((x) => [x.content, x.hidden])).toEqual([
      ["PlainAlong", false],
      ["Only along", false],
      ["Inside", true],
      ["Ink", true],
      ["Prefixed", false],
    ]);
  });
  it("takes no obstacles from a <flowRoot>, and says it is not shown", () => {
    const o = parseSvg(doc.replace("<rect ", '<rect stroke="black" '), { areaIds: [], rectMax: 1000, textCharEm: 0.6, textDescent: 2 });
    expect(o.segs).toEqual([]);
    expect(o.warnings.some((w) => w.includes("<flowRoot>"))).toBe(true);
  });
});

describe("moveTexts", () => {
  const t = readTexts(svg);
  it("changes only the moved numbers", () => {
    const out = moveTexts(svg, new Map([[t[0]!, [5, -2.5] as const]]));
    expect(out).toBe(svg.replace('<text id="a" x="10" y="20">', '<text id="a" x="15" y="17.5">'));
  });
  it("moves a rotated text along the page, not along its own axes", () => {
    const out = moveTexts(svg, new Map([[t[1]!, [10, 0] as const]]));
    const moved = readTexts(out)[1]!;
    const before = apply(t[1]!.m, t[1]!.x, t[1]!.y);
    const after = apply(moved.m, moved.x, moved.y);
    expect(after[0] - before[0]).toBeCloseTo(10, 9);
    expect(after[1] - before[1]).toBeCloseTo(0, 9);
  });
  it("shifts every value of tspan position lists and leaves dy alone", () => {
    const out = moveTexts(svg, new Map([[t[2]!, [1, 2] as const]]));
    expect(out).toContain(`<text id="c" y='32'><tspan x="101 111" y="32">Ga</tspan><tspan x="101" dy="12">mma</tspan></text>`);
  });
  it("adds x when the text has none", () => {
    const out = moveTexts(svg, new Map([[t[2]!, [0, 0] as const], [t[3]!, [1, 1] as const]]));
    expect(out).toContain('<text x="151" y="91" font-weight="bold">Key</text>');
    const noX = '<svg><text y="5">n</text></svg>';
    expect(moveTexts(noX, new Map([[readTexts(noX)[0]!, [3, 0] as const]]))).toBe('<svg><text x="3" y="5">n</text></svg>');
  });
});

describe("shortNumber", () => {
  it("drops trailing zeros and negative zero", () => {
    expect([shortNumber(12.5, 2), shortNumber(3, 2), shortNumber(-0.001, 2), shortNumber(1.005, 2)]).toEqual(["12.5", "3", "0", "1"]);
  });
});
