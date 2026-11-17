import { describe, expect, it } from "vitest";
import { checkSvgLabels } from "../src/check.js";
import { fixSvgLabels } from "../src/fix.js";

const map = (body: string, size = 'width="400" height="200"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${size}><g font-family="DejaVu Sans" font-size="12">${body}</g></svg>`;
const crossed = (svg: string) =>
  checkSvgLabels(svg)
    .labels.filter((l) => !l.skipped && l.line === "core" && !l.masked)
    .map((l) => l.name);
const xy = (svg: string, id: string): [number, number] => {
  const tag = new RegExp(`<text id="${id}"[^>]*>`).exec(svg)![0];
  return [Number(/\sx="([^"]+)"/.exec(tag)![1]), Number(/\sy="([^"]+)"/.exec(tag)![1])];
};

describe("fixSvgLabels", () => {
  it("moves only the names with a line through them, and only their x and y", () => {
    const svg = map(`<path d="M0 100 H400" stroke="#000"/>
<text id="a" x="200" y="104" text-anchor="middle">Crossed</text>
<text id="b" x="50" y="40">Fine</text>`);
    const res = fixSvgLabels(svg);
    expect(res.moves.map((m) => m.name)).toEqual(["Crossed"]);
    expect(crossed(res.svg)).toEqual([]);
    const [x, y] = xy(res.svg, "a");
    expect(res.svg).toBe(svg.replace('x="200" y="104"', `x="${x}" y="${y}"`));
    expect(Math.hypot(x - 200, y - 104)).toBeGreaterThan(0);
  });

  it("leaves a name with a halo where it is", () => {
    const svg = map(`<path d="M0 100 H400" stroke="#000"/><text x="200" y="104" stroke="#fff" stroke-width="3">Haloed</text>`);
    expect(fixSvgLabels(svg).moves).toEqual([]);
  });

  it("moves a copy drawn under a name together with it", () => {
    const svg = map(`<path d="M0 100 H400" stroke="#000"/>
<text id="u" x="200" y="104">Twice</text><text id="o" x="200" y="104">Twice</text>`);
    const res = fixSvgLabels(svg);
    expect(res.moves).toHaveLength(1);
    expect(xy(res.svg, "u")).toEqual(xy(res.svg, "o"));
    expect(xy(res.svg, "o")).not.toEqual([200, 104]);
  });

  it("moves the language versions in a <switch> together", () => {
    const svg = map(`<path d="M0 100 H400" stroke="#000"/>
<switch><text id="de" systemLanguage="de" x="200" y="104">Kreuz</text><text id="en" x="200" y="104">Cross</text></switch>`);
    const res = fixSvgLabels(svg);
    const [dx, dy] = [res.moves[0]!.dx, res.moves[0]!.dy];
    expect(res.moves[0]!.texts).toEqual([0, 1]);
    expect(xy(res.svg, "de")).toEqual(xy(res.svg, "en"));
    expect(xy(res.svg, "en")).toEqual([+(200 + dx).toFixed(2), +(104 + dy).toFixed(2)]);
  });

  it("keeps a name inside the area it is in", () => {
    // West is crossed and has no free place inside the left shape within reach; the right shape is free.
    const hatch = Array.from({ length: 21 }, (_, i) => `<path d="M0 ${40 + i * 6} H196" stroke="#000"/>`).join("");
    const svg = map(`<rect width="200" height="200" fill="#ccc"/><rect x="200" width="200" height="200" fill="#eee"/>${hatch}
<text id="w" x="150" y="104" text-anchor="middle">West</text>`);
    const res = fixSvgLabels(svg);
    for (const m of res.moves) expect(150 + m.dx).toBeLessThan(200);
  });

  // A town's point as maps draw it: a circle, or a path (Inkscape's circles), a <use> of a symbol, a square, a triangle.
  const POINTS: [string, (x: number, y: number) => string][] = [
    ["a circle", (x, y) => `<circle cx="${x}" cy="${y}" r="2"/>`],
    ["a path with arcs", (x, y) => `<path d="M${x - 2} ${y} a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0z"/>`],
    ["a path with curves", (x, y) => `<path d="M${x - 2} ${y} c0 -2.7 4 -2.7 4 0 c0 2.7 -4 2.7 -4 0z"/>`],
    ["a <use> of a symbol", (x, y) => `<use href="#dot" x="${x}" y="${y}"/>`],
    ["a square", (x, y) => `<rect x="${x - 2}" y="${y - 2}" width="4" height="4"/>`],
    ["a triangle", (x, y) => `<polygon points="${x - 2},${y + 2} ${x + 2},${y + 2} ${x},${y - 2}"/>`],
  ];
  const DEFS = `<defs><circle id="dot" r="2"/></defs>`;

  it.each(POINTS)("keeps a town's name next to its own point, and off it (point drawn as %s)", (_, point) => {
    const svg = map(`${DEFS}${point(100, 100)}${point(140, 84)}
<path d="M110 100 H400" stroke="#000"/>
<text id="t" x="105" y="104">Dotton</text>`);
    const res = fixSvgLabels(svg);
    expect(res.moves).toHaveLength(1);
    const [x, y] = xy(res.svg, "t");
    expect(y).toBeGreaterThan(104); // above, it would be nearer the other point
    expect(x).toBeGreaterThanOrEqual(102); // not over its own point
    expect(Math.hypot(x - 100, y - 104)).toBeLessThan(30);
  });

  it.each(POINTS)("does not put a name over its own point (point drawn as %s)", (_, point) => {
    // Lines above, through and below the name leave only the way left, across the town's point.
    const lines = [88, 100, 112].map((y) => `<path d="M104 ${y} H400" stroke="#000"/>`).join("");
    const svg = map(`${DEFS}${point(100, 100)}${lines}<text id="t" x="105" y="104">Ab</text>`);
    const res = fixSvgLabels(svg);
    const [[l, t], , [r, b]] = res.before.labels[0]!.boxes[0]!.corners;
    expect(res.moves).toHaveLength(1);
    const { dx, dy } = res.moves[0]!;
    const gap = Math.hypot(Math.max(l! + dx - 100, 0, 100 - r! - dx), Math.max(t! + dy - 100, 0, 100 - b! - dy));
    expect(gap).toBeGreaterThan(2);
  });

  it("takes a coastline or a road next to a name for a line, not for its point", () => {
    // A small island 60 px long and a short thick road segment beside the name: neither holds it.
    const svg = map(`<path d="M60 112 h60 v6 h-60z" fill="#ccc" stroke="#000" stroke-width="0.2"/>
<rect x="150" y="96" width="30" height="4"/>
<path d="M0 100 H400" stroke="#000"/>
<text id="t" x="105" y="104">Isle</text>`);
    expect(fixSvgLabels(svg).moves).toHaveLength(1);
  });

  it("moves a name at most half a letter height further from its point", () => {
    // The town's point is below and left of the name; lines through and below the name leave free places
    // only above it, where the gap to the point would grow by more than half a letter height.
    const lines = [100, 110, 116, 122].map((y) => `<path d="M104 ${y} H400" stroke="#000"/>`).join("");
    const svg = map(`<circle cx="100" cy="110" r="2"/>${lines}<text id="t" x="105" y="104">Dotton</text>`);
    const res = fixSvgLabels(svg);
    const box = res.before.labels[0]!.boxes[0]!.corners;
    const h = box[3][1] - box[0][1];
    const gapAt = (dx: number, dy: number) =>
      Math.hypot(Math.max(box[0][0] + dx - 100, 0, 100 - box[1][0] - dx), Math.max(box[0][1] + dy - 110, 0, 110 - box[3][1] - dy)) - 2;
    for (const m of res.moves) expect(gapAt(m.dx, m.dy) - gapAt(0, 0)).toBeLessThanOrEqual(h / 2 + 1e-9);
    expect(res.moves.length + res.stuck.length).toBe(1);
  });

  it("measures distances at the size MediaWiki gives the map", () => {
    const small = map(`<path d="M0 100 H400" stroke="#000"/><text id="a" x="200" y="104">Scaled</text>`);
    const big = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 4000 2000"><g font-family="DejaVu Sans" font-size="120"><path d="M0 1000 H4000" stroke="#000" stroke-width="10"/><text id="a" x="2000" y="1040">Scaled</text></g></svg>`;
    const a = fixSvgLabels(small);
    const b = fixSvgLabels(big);
    expect(b.unitsPerPx).toBe(10);
    expect(b.moves).toHaveLength(1);
    expect(b.moves[0]!.dy / 10).toBeCloseTo(a.moves[0]!.dy, 0);
  });

  it("does not try to move a name it cannot measure (no height), and does not hang on it", () => {
    const name = `<text x="200" y="104">المكسيك</text>`;
    const [[, y]] = checkSvgLabels(map(name)).labels[0]!.boxes[0]!.corners;
    const svg = map(`<path d="M0 ${y} H400" stroke="#000"/>${name}`);
    expect(crossed(svg)).toHaveLength(1);
    const res = fixSvgLabels(svg);
    expect(res.moves).toEqual([]);
    expect(res.stuck.map((s) => s.why)).toEqual(["size"]);
  });

  it("leaves single letters alone: they are mostly the spaced-out letters of an area's name", () => {
    const svg = map(`<path d="M0 100 H400" stroke="#000"/><text x="100" y="104">H</text><text x="200" y="104">U</text>`);
    const res = fixSvgLabels(svg);
    expect(res.moves).toEqual([]);
    expect(res.stuck.map((s) => [s.name, s.why])).toEqual([["H", "letter"], ["U", "letter"]]);
  });

  it("does not settle for a place where a line still runs along the edge of the name", () => {
    // Lines 12 px apart: the middle of the letters fits between two of them, the whole name never does.
    const lines = Array.from({ length: 11 }, (_, i) => `<path d="M0 ${40 + i * 12} H400" stroke="#000"/>`).join("");
    const svg = map(`${lines}<text x="200" y="104">Ruled</text>`);
    const res = fixSvgLabels(svg);
    expect(res.moves).toEqual([]);
    expect(res.stuck.map((s) => s.why)).toEqual(["full"]);
  });

  it("reports a name with nowhere to go and leaves the file as it was", () => {
    const hatch = Array.from({ length: 34 }, (_, i) => `<path d="M0 ${i * 6} H400" stroke="#000"/>`).join("");
    const svg = map(`${hatch}<text x="200" y="104">Stuck</text>`);
    const res = fixSvgLabels(svg);
    expect(res.moves).toEqual([]);
    expect(res.stuck.map((s) => [s.name, s.why])).toEqual([["Stuck", "full"]]);
    expect(res.svg).toBe(svg);
  });
});
