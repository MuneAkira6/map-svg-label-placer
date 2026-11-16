import { describe, expect, it } from "vitest";
import { placeSvgTexts } from "../src/svgplace.js";
import { readTexts, type SvgText } from "../src/svgtext.js";
import { groupTexts, langMatches } from "../src/textgroups.js";
import { layoutText, type Box } from "../src/textlayout.js";

const LS = `font-family="Liberation Sans" font-size="20"`;
const units = (body: string, lang?: string) => {
  const texts = readTexts(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">${body}</svg>`).filter((t) => !t.hidden);
  const boxOf = new Map<SvgText, Box>(texts.map((t) => [t, layoutText(t).box!]));
  return groupTexts(texts, boxOf, lang);
};
const names = (r: ReturnType<typeof units>) => r.units.map((u) => u.texts.map((t) => t.content));

describe("language versions", () => {
  // As in many multilingual maps on Commons: one layer of texts per language inside a <switch>.
  const layers = `<switch>
    <g systemLanguage="ca"><text id="sea-ca" x="10" y="50" ${LS}>Oceà Atlàntic</text><text id="isle-ca" x="300" y="50" ${LS}>Illa de Sable</text></g>
    <g systemLanguage="en"><text id="sea-en" x="10" y="50" ${LS}>Atlantic Ocean</text><text id="isle-en" x="300" y="50" ${LS}>Sable Island</text></g>
    <g><text id="sea" x="10" y="50" ${LS}>Atlantic</text><text id="isle" x="300" y="50" ${LS}>Sable</text></g>
  </switch>`;
  it("matches the versions in language layers by id and puts the drawn one first", () => {
    expect(names(units(layers))).toEqual([
      ["Atlantic Ocean", "Oceà Atlàntic", "Atlantic"],
      ["Sable Island", "Illa de Sable", "Sable"],
    ]);
  });
  it("draws the first child that matches the render language", () => {
    expect(names(units(layers, "de")).map((n) => n[0])).toEqual(["Atlantic", "Sable"]);
    expect(names(units(layers, "ca")).map((n) => n[0])).toEqual(["Oceà Atlàntic", "Illa de Sable"]);
    expect([langMatches("en-GB,fr", "en"), langMatches("eng", "en"), langMatches(undefined, "en")]).toEqual([true, false, true]);
  });
  it("matches by position when the texts have no ids", () => {
    const r = units(`<switch><g systemLanguage="de"><text x="0" y="20">A-de</text><text x="0" y="90">B-de</text></g>
      <g><text x="0" y="20">A</text><text x="0" y="90">B</text></g></switch>`);
    expect(names(r)).toEqual([["A", "A-de"], ["B", "B-de"]]);
  });
});

describe("names of several lines and words of single letters", () => {
  it("joins the lines of one name written as separate texts", () => {
    const r = units(`<text x="100" y="100" text-anchor="middle" ${LS}>Saint</text>
      <text x="100" y="124" text-anchor="middle" ${LS}>Petersburg</text>
      <text x="100" y="300" text-anchor="middle" ${LS}>Novgorod</text>`);
    expect(names(r)).toEqual([["Saint", "Petersburg"], ["Novgorod"]]);
  });
  it("keeps apart texts that only happen to line up", () => {
    // Same left edge, but two line heights apart (a list), or side by side.
    const r = units(`<text x="10" y="100" ${LS}>Road</text><text x="10" y="148" ${LS}>Railway</text>
      <text x="300" y="100" ${LS}>Lake</text><text x="360" y="100" ${LS}>Town</text>`);
    expect(r.units).toHaveLength(4);
  });
  it("keeps a word set letter by letter in place", () => {
    const word = [..."RHINE"].map((ch, i) => `<text x="${100 + i * 15}" y="${200 + i * 4}" ${LS}>${ch}</text>`).join("");
    const r = units(`${word}<text x="600" y="500" ${LS}>A</text>`);
    expect(r.units.map((u) => u.reason ?? null)).toEqual([...Array(5).fill("one letter of a word set letter by letter"), null]);
  });
  it("does not take numbered places for the letters of a word", () => {
    // Prefecture numbers on a map of Japan: short, close, but each one behind or below the one before.
    const r = units(`<text x="200" y="100" ${LS}>8</text><text x="170" y="80" ${LS}>9</text>
      <text x="130" y="95" ${LS}>10</text><text x="155" y="120" ${LS}>11</text>`);
    expect(r.units.map((u) => u.reason ?? null)).toEqual([null, null, null, null]);
  });
  it("lists the drawn texts of each label", () => {
    const r = units(`<switch><text systemLanguage="de" x="10" y="50" ${LS}>Nord</text><text x="10" y="50" ${LS}>North</text></switch>
      <switch><text systemLanguage="de" x="10" y="74" ${LS}>see</text><text x="10" y="74" ${LS}>sea</text></switch>`);
    expect(r.units.map((u) => u.drawn.map((t) => t.content))).toEqual([["North", "sea"]]);
  });
});

describe("placeSvgTexts with grouped texts", () => {
  it("moves the lines of a name by the same amount", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
      <path d="M0,110 H400" stroke="#000" stroke-width="3"/>
      <text x="200" y="100" text-anchor="middle" ${LS}>Saint</text><text x="200" y="124" text-anchor="middle" ${LS}>Petersburg</text></svg>`;
    const res = placeSvgTexts(svg);
    expect(res.groups).toHaveLength(1);
    const [a, b] = readTexts(res.svg);
    expect(res.failed).toEqual([]);
    expect(a!.y).not.toBe(100);
    expect(a!.x - 200).toBeCloseTo(b!.x - 200, 9);
    expect(a!.y - 100).toBeCloseTo(b!.y - 124, 9);
  });
});
