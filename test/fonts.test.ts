import { describe, expect, it } from "vitest";
import { measureText, resolveFont } from "../src/fonts.js";

// Ink widths measured on Commons' current PNG of File:SVG_Text_Font_Test.svg (font-size 20, 1050 -> 1280 px),
// 2026-11-15; see 转职/作品集调研/raw/标签避让/SVG字体_实测_*.txt in the author's notes.
const SAMPLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz@0123456789?!";
const SIZE = (20 * 1280) / 1050;
const COMMONS: [string, number][] = [
  ["", 886],
  ["serif", 958],
  ["DejaVu Serif", 1044],
  ["sans-serif", 926],
  ["DejaVu Sans", 994],
  ["fantasy", 926],
  ["Arial", 932],
  ["Times New Roman", 886],
];

describe("measureText", () => {
  it.each(COMMONS)("font-family %j is within 1%% of the Commons rendering", (family, ink) => {
    const { width } = measureText(SAMPLE, { fontFamily: family, fontSize: SIZE });
    expect(Math.abs(width - ink) / ink).toBeLessThan(0.01);
  });
  it("falls back to WenQuanYi Zen Hei for Chinese, 1 em per character", () => {
    const m = measureText("泗阳县", { fontFamily: "Liberation Sans, sans-serif", fontSize: 12 });
    expect(m.width).toBeCloseTo(36, 9);
    expect(m.fonts).toEqual(["WenQuanYi Zen Hei"]);
  });
  it("adds letter spacing per character", () => {
    const a = measureText("ab", { fontFamily: "sans-serif", fontSize: 10 });
    const b = measureText("ab", { fontFamily: "sans-serif", fontSize: 10, letterSpacing: 2 });
    expect(b.width - a.width).toBeCloseTo(4, 9);
  });
});

describe("resolveFont", () => {
  it("follows the font-family list to the first font Commons has", () => {
    expect(resolveFont("'Unknown Font', Arial, sans-serif").name).toBe("Liberation Sans");
    expect(resolveFont("Verdana").name).toBe("Noto Sans");
    expect(resolveFont("Noto Sans CJK SC, sans-serif").primary).toBe("cjk");
  });
});
