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

  it("keeps a town's name next to its own point, and off it", () => {
    const svg = map(`<circle cx="100" cy="100" r="2"/><circle cx="140" cy="84" r="2"/>
<path d="M110 100 H400" stroke="#000"/>
<text id="t" x="105" y="104">Dotton</text>`);
    const res = fixSvgLabels(svg);
    expect(res.moves).toHaveLength(1);
    const [x, y] = xy(res.svg, "t");
    expect(y).toBeGreaterThan(104); // above, it would be nearer the other point
    expect(x).toBeGreaterThanOrEqual(102); // not over its own point
    expect(Math.hypot(x - 100, y - 104)).toBeLessThan(30);
  });

  it("does not put a name over its own point", () => {
    // Lines above, through and below the name leave only the way left, across the town's point.
    const lines = [88, 100, 112].map((y) => `<path d="M104 ${y} H400" stroke="#000"/>`).join("");
    const svg = map(`<circle cx="100" cy="100" r="2"/>${lines}<text id="t" x="105" y="104">Ab</text>`);
    const res = fixSvgLabels(svg);
    const [[l, t], , [r, b]] = res.before.labels[0]!.boxes[0]!.corners;
    expect(res.moves).toHaveLength(1);
    const { dx, dy } = res.moves[0]!;
    const gap = Math.hypot(Math.max(l! + dx - 100, 0, 100 - r! - dx), Math.max(t! + dy - 100, 0, 100 - b! - dy));
    expect(gap).toBeGreaterThan(2);
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
    expect(res.stuck).toHaveLength(1);
  });

  it("reports a name with nowhere to go and leaves the file as it was", () => {
    const hatch = Array.from({ length: 34 }, (_, i) => `<path d="M0 ${i * 6} H400" stroke="#000"/>`).join("");
    const svg = map(`${hatch}<text x="200" y="104">Stuck</text>`);
    const res = fixSvgLabels(svg);
    expect(res.moves).toEqual([]);
    expect(res.stuck.map((s) => s.name)).toEqual(["Stuck"]);
    expect(res.svg).toBe(svg);
  });
});
