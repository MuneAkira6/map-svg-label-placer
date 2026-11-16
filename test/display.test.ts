import { describe, expect, it } from "vitest";
import { commonsFonts, withFontFaces } from "../src/display.js";

describe("commonsFonts", () => {
  it("replaces each font-family with the font Commons draws it in", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" font-family="sans-serif"><style>.a{font-family:Arial,sans-serif}</style>
<text font-family="'Times New Roman'">a</text><text style="fill:red;font-family:Helvetica;font-size:9px">b</text><text font-family="DejaVu Sans">c</text></svg>`;
    const { svg: out, faces } = commonsFonts(svg);
    expect(out).toContain(`<svg xmlns="http://www.w3.org/2000/svg" font-family="Noto Sans">`);
    expect(out).toContain(".a{font-family:Liberation Sans}");
    expect(out).toContain(`<text font-family="Liberation Serif">a</text>`);
    expect(out).toContain(`style="fill:red;font-family:Liberation Sans;font-size:9px"`);
    expect(out).toContain(`<text font-family="DejaVu Sans">c</text>`);
    expect(faces.map((f) => f.file).sort()).toEqual(
      ["DejaVuSans.woff2", "LiberationSans-Regular.ttf", "LiberationSerif-Regular.ttf", "NotoSans-Regular.woff2"].sort(),
    );
  });

  it("gives the root librsvg's default font when it has none, and adds bold and italic faces when used", () => {
    const { svg, faces } = commonsFonts(`<svg:svg xmlns:svg="http://www.w3.org/2000/svg"><svg:text font-weight="bold" font-style="italic">x</svg:text></svg:svg>`);
    expect(svg.startsWith(`<svg:svg font-family="Liberation Serif" xmlns:svg=`)).toBe(true);
    expect(faces.map((f) => f.file)).toEqual([
      "LiberationSerif-Regular.ttf", "LiberationSerif-Italic.ttf", "LiberationSerif-Bold.ttf", "LiberationSerif-BoldItalic.ttf",
    ]);
  });

  it("leaves CJK families alone", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" font-family="sans-serif"><text font-family="Noto Sans CJK SC">漢</text></svg>`;
    expect(commonsFonts(svg).svg).toContain(`font-family="Noto Sans CJK SC"`);
  });
});

describe("withFontFaces", () => {
  it("puts the @font-face rules first inside the root, with its namespace prefix", () => {
    const face = { family: "Noto Sans", weight: 400, style: "normal", file: "NotoSans-Regular.woff2" } as const;
    const out = withFontFaces(`<?xml version="1.0"?><svg:svg xmlns:svg="http://www.w3.org/2000/svg"><svg:g/></svg:svg>`, [face], (f) => `fonts/${f.file}`);
    expect(out).toBe(
      `<?xml version="1.0"?><svg:svg xmlns:svg="http://www.w3.org/2000/svg"><svg:style>@font-face{font-family:"Noto Sans";font-weight:400;font-style:normal;src:url(fonts/NotoSans-Regular.woff2)}</svg:style><svg:g/></svg:svg>`,
    );
  });
});
