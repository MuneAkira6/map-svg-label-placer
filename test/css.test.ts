import { describe, expect, it } from "vitest";
import { expandFont, fontSizePx } from "../src/css.js";
import { parseSvg, walkSvg } from "../src/svg.js";

const opts = { areaIds: [], rectMax: 50, textCharEm: 0.6, textDescent: 2 };
const byId = (svg: string) => new Map([...walkSvg(svg)].flatMap((e) => (e.attrs.has("id") ? [[e.attrs.get("id")!, e]] : [])));

describe("<style> rules", () => {
  // Shapes of rules seen in Commons maps (Illustrator .st0 classes, CorelDRAW @font-face, SVG Translate .city).
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
<style type="text/css"><![CDATA[
  @font-face { font-family:"Corbel";src:url("#FontID0") format(svg) }
  @keyframes blink { 50% { opacity: 0 } }
  .road, .rail { fill:none; stroke:#4D4D4D; stroke-width:2 }
  /* a comment */
  text { font-family: Arial }
  .city { font-size:22px; text-anchor:middle }
  text.city { font-size:30px }
  #capital { font-weight:bold }
  .big { font-size: 40px !important }
  g text { fill: red }
]]></style>
<path id="r" class="road" d="M0 50 H100"/>
<text id="a" class="city" x="10" y="10">A</text>
<text id="capital" class="city" x="10" y="30" style="font-size:12px">B</text>
<text id="c" class="city big" x="10" y="60" style="font-size:12px">C</text>
</svg>`;
  const el = byId(svg);

  it("styles lines drawn with a class", () => {
    const o = parseSvg(svg, opts);
    expect(o.segs).toEqual([{ x1: 0, y1: 50, x2: 100, y2: 50, hw: 1 }]);
  });
  it("applies rules by specificity, then style, then !important", () => {
    expect(el.get("a")!.fontSize).toBe(30);
    expect(el.get("a")!.inh.get("text-anchor")).toBe("middle");
    expect(el.get("a")!.inh.get("font-family")).toBe("Arial");
    expect(el.get("capital")!.fontSize).toBe(12);
    expect(el.get("capital")!.inh.get("font-weight")).toBe("bold");
    expect(el.get("c")!.fontSize).toBe(40);
  });
  it("skips at-rules and warns about selectors it cannot match", () => {
    expect(el.get("a")!.inh.get("fill")).toBeUndefined();
    expect(parseSvg(svg, opts).warnings.some((w) => w.includes("g text"))).toBe(true);
  });
  it("reads a <style> without CDATA, with escaped quotes", () => {
    const s = `<svg><style>.t{font-family:&quot;Liberation Sans&quot;}</style><text id="t" class="t">x</text></svg>`;
    expect(byId(s).get("t")!.inh.get("font-family")).toBe('"Liberation Sans"');
  });
});

describe("style values", () => {
  it("ignores d in CSS, as librsvg does", () => {
    const s = `<svg><path d="M0 0 L10 0" style="stroke:#000;d:path('M0 5 L10 5')"/></svg>`;
    expect(parseSvg(s, opts).segs.map((g) => g.y1)).toEqual([0]);
  });
  it("expands the font shorthand", () => {
    expect(expandFont("italic bold 12px/1.2 Arial, sans-serif")).toEqual([
      ["font-style", "italic"], ["font-weight", "bold"], ["font-size", "12px"], ["font-family", "Arial, sans-serif"],
    ]);
    expect(expandFont("Arial")).toBeNull();
    const s = `<svg><text id="t" style="font:bold 9pt Arial">x</text></svg>`;
    expect(byId(s).get("t")!.fontSize).toBe(12);
  });
  it("resolves font-size units against the parent", () => {
    expect([fontSizePx("12pt", 16), fontSizePx("150%", 10), fontSizePx("2em", 9), fontSizePx("medium", 9), fontSizePx("x", 9)]).toEqual([16, 15, 18, 16, 9]);
    const s = `<svg><g id="g" font-size="20"><text id="t" font-size="50%">x</text></g></svg>`;
    expect(byId(s).get("t")!.fontSize).toBe(10);
  });
});
