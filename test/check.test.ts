import { describe, expect, it } from "vitest";
import { checkSvgLabels } from "../src/check.js";

const LS = `font-family="Liberation Sans" font-size="20"`;
const doc = (body: string, vb = "0 0 400 300") =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${vb}">${body}</svg>`;
const byName = (svg: string) => Object.fromEntries(checkSvgLabels(svg).labels.map((l) => [l.name, l]));

describe("checkSvgLabels", () => {
  it("tells a line through the letters from one that only grazes the box", () => {
    const r = byName(doc(`<path d="M0,93 H400" stroke="#000"/><path d="M0,252 H400" stroke="#000"/>
      <text x="100" y="100" ${LS}>Core</text><text x="100" y="250" ${LS}>Edge</text><text x="100" y="180" ${LS}>Clear</text>`));
    expect([r.Core!.line, r.Edge!.line, r.Clear!.line]).toEqual(["core", "edge", null]);
  });
  it("notes a halo and a plate, which keep lines from showing through", () => {
    const r = byName(doc(`<rect x="0" y="0" width="400" height="300" fill="#fff"/>
      <path d="M0,93 H400" stroke="#000"/><path d="M0,193 H400" stroke="#000"/>
      <text x="20" y="100" ${LS} stroke="#fff" stroke-width="3">Halo</text>
      <rect x="196" y="80" width="70" height="28" fill="#fff"/><text x="200" y="100" ${LS}>Plate</text>
      <text x="20" y="200" ${LS}>Bare</text>`));
    expect([r.Halo!.masked, r.Plate!.masked, r.Bare!.masked]).toEqual(["halo", "plate", null]);
    // The plate is drawn after the line, so the line under it cannot be seen there.
    expect([r.Halo!.line, r.Plate!.line, r.Bare!.line]).toEqual(["core", null, "core"]);
  });
  it("takes an outlined copy under the same name as its halo", () => {
    const c = checkSvgLabels(doc(`<text x="20" y="100" ${LS} stroke="#fff" stroke-width="4">Twice</text><text x="20" y="100" ${LS}>Twice</text>`));
    expect(c.labels.map((l) => [l.skipped !== undefined, l.masked, l.overlaps])).toEqual([[true, "halo", []], [false, "halo", []]]);
  });
  it("finds names covering each other and names running off the edge", () => {
    const c = checkSvgLabels(doc(`<text x="20" y="100" ${LS}>Northtown</text><text x="70" y="105" ${LS}>Southtown</text>
      <text x="360" y="200" ${LS}>Edgeville</text><text x="20" y="250" ${LS}>Inside</text>`, "0 0 400 300"));
    expect(c.labels.map((l) => [l.name, l.overlaps, l.clipped])).toEqual([
      ["Northtown", [1], false], ["Southtown", [0], false], ["Edgeville", [], true], ["Inside", [], false],
    ]);
  });
  it("uses the viewBox as the frame", () => {
    const c = checkSvgLabels(doc(`<text x="520" y="350" ${LS}>Here</text>`, "500 300 400 300"));
    expect(c.labels[0]!.clipped).toBe(false);
  });
  it("lists text that Commons does not draw, where it would be", () => {
    const c = checkSvgLabels(doc(`<path id="river" d="M10,200 L300,240" fill="none"/>
      <flowRoot><flowRegion><rect x="10" y="10" width="100" height="50"/></flowRegion><flowPara>Flowed text</flowPara></flowRoot>
      <switch><text systemLanguage="de"><textPath xlink:href="#river">Fluss</textPath></text><text><textPath xlink:href="#river">River</textPath></text></switch>`));
    expect(c.unshown).toEqual([
      { kind: "flowRoot", text: "Flowed text", corners: [[10, 10], [110, 10], [110, 60], [10, 60]] },
      { kind: "textPath", text: "River", corners: [[10, 200], [300, 200], [300, 240], [10, 240]] },
    ]);
  });
  it("names a name of several lines with a space between them", () => {
    const names = checkSvgLabels(doc(`<text x="50" y="50" ${LS}><tspan x="50" y="50">Mission</tspan><tspan x="50" dy="22">Church</tspan></text>
      <text x="200" y="50" ${LS}>Mackinac</text><text x="200" y="72" ${LS}>Island</text>
      <text x="50" y="200" ${LS}><tspan x="50 64 78 92" y="200">WORD</tspan></text>`)).labels.map((l) => l.name);
    expect(names).toEqual(["Mission Church", "Mackinac Island", "WORD"]);
  });
  it("does not count a line painted over by a later shape, or lying on a shape of its own colour", () => {
    const r = byName(doc(`<path d="M0,93 H400" stroke="#a08070"/>
      <rect x="0" y="80" width="140" height="40" fill="#ffffd0"/>
      <rect x="150" y="80" width="80" height="40" fill="#ffffd0" fill-opacity="0.5"/>
      <rect x="240" y="80" width="80" height="40" fill="#ffffd0" clip-path="url(#c)"/>
      <rect x="0" y="150" width="400" height="60" fill="#3366cc"/><path d="M0,193 H400" stroke="#36c"/>
      <path d="M0,253 H400" stroke="#36c"/>
      <text x="20" y="100" ${LS}>Under</text><text x="160" y="100" ${LS}>Faint</text><text x="250" y="100" ${LS}>Clip</text>
      <text x="20" y="200" ${LS}>Same</text><text x="20" y="260" ${LS}>Shown</text>`));
    expect([r.Under!.line, r.Faint!.line, r.Clip!.line, r.Same!.line, r.Shown!.line]).toEqual([null, "core", "core", null, "core"]);
  });
  it("judges every line of a name on its own", () => {
    const c = checkSvgLabels(doc(`<path d="M0,123 H400" stroke="#000"/>
      <text x="100" y="100" text-anchor="middle" ${LS}>Saint</text><text x="100" y="124" text-anchor="middle" ${LS}>Petersburg</text>`));
    expect(c.labels).toHaveLength(1);
    expect(c.labels[0]!.boxes.map((b) => b.line)).toEqual([null, "core"]);
  });
});
