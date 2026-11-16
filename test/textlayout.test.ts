import { describe, expect, it } from "vitest";
import { measureText } from "../src/fonts.js";
import { readTexts } from "../src/svgtext.js";
import { layoutText } from "../src/textlayout.js";

const LS = "Liberation Sans";
const w = (s: string, fontSize: number, fontFamily = LS) => measureText(s, { fontFamily, fontSize }).width;
const lay = (body: string, head = "") => {
  const t = readTexts(`<svg xmlns="http://www.w3.org/2000/svg">${head}${body}</svg>`)[0]!;
  return { t, ...layoutText(t) };
};

describe("layoutText", () => {
  it("uses the font size set on a <tspan>", () => {
    // Inkscape 0.4x writes the size on the tspan; the text's own 32px is never drawn.
    const { box } = lay(`<text x="10" y="50" font-size="32" font-family="${LS}"><tspan font-size="22">Los Angeles</tspan></text>`);
    expect(box![2] - box![0]).toBeCloseTo(w("Los Angeles", 22), 9);
  });
  it("starts where the first <tspan> says, not where the <text> says", () => {
    const { box } = lay(`<text x="-227" y="1004" font-family="${LS}"><tspan x="405" y="206" font-size="9.4">60 km</tspan></text>`);
    expect(box![0]).toBe(405);
    expect(box![3]).toBeLessThan(210);
  });
  it("lays out each line of a multi-line label and anchors it on its own", () => {
    const { box, chunks } = lay(
      `<text text-anchor="middle" font-size="20" font-family="${LS}">` +
        `<tspan x="100" y="50">Saint</tspan><tspan x="100" y="74">Petersburg</tspan></text>`,
    );
    expect(chunks).toHaveLength(2);
    expect((chunks[0]![0] + chunks[0]![2]) / 2).toBeCloseTo(100, 9);
    expect(chunks[1]![2] - chunks[1]![0]).toBeCloseTo(w("Petersburg", 20), 9);
    expect(box![1]).toBe(chunks[0]![1]);
    expect(box![3]).toBe(chunks[1]![3]);
  });
  it("applies dx and dy, in em too, without starting a new chunk", () => {
    const { chunks } = lay(`<text x="0" y="20" font-size="10" font-family="${LS}">ab<tspan dx="0.5em" dy="1em">c</tspan></text>`);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]![2]).toBeCloseTo(w("abc", 10) + 5, 9);
    expect(chunks[0]![3]).toBeCloseTo(30 + measureText("c", { fontFamily: LS, fontSize: 10 }).descent, 9);
  });
  it("collapses white space unless xml:space is preserve", () => {
    const d = lay(`<text font-family="${LS}">\n   Foo \n\t Bar  </text>`);
    expect(d.t.chars.map((c) => c.ch).join("")).toBe("Foo Bar");
    const p = lay(`<text xml:space="preserve" font-family="${LS}"> a  b</text>`);
    expect(p.t.chars.map((c) => c.ch).join("")).toBe(" a  b");
  });
  it("skips what is not drawn: <title>, display:none", () => {
    const { t } = lay(`<text>Ri<title>tooltip</title>ver<tspan style="display:none">X</tspan></text>`);
    expect(t.chars.map((c) => c.ch).join("")).toBe("River");
  });
  it("follows <style> rules on a <tspan>", () => {
    const { chunks } = lay(
      `<text x="50" y="20" font-size="10" font-family="${LS}"><tspan class="c">Town</tspan></text>`,
      `<style>.c{text-anchor:middle;font-size:20px}</style>`,
    );
    expect((chunks[0]![0] + chunks[0]![2]) / 2).toBeCloseTo(50, 9);
    expect(chunks[0]![2] - chunks[0]![0]).toBeCloseTo(w("Town", 20), 9);
  });
  it("stacks vertical text top to bottom, 1 em per ideograph", () => {
    // Measured with librsvg 2.63: x is the centre line, the column runs from y down.
    const { t, box } = lay(`<text x="100" y="40" style="font-size:30px;writing-mode:tb-rl">博多古地図</text>`);
    expect(t.vertical).toBe(true);
    expect(box).toEqual([85, 40, 115, 190]);
  });
});
