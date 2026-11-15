// Differential test: the TypeScript port against the Python reference (fixtures/*/expected.json,
// written by reference/oracle.py). Positions must agree within 1e-6 px; choices and failures exactly.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { placeOptions, type Config, type LabelDoc } from "../src/config.js";
import { placeLabels, type How, type Placement } from "../src/place.js";
import { pyRound } from "../src/py.js";
import { parseSvg } from "../src/svg.js";

const ROOT = new URL("../fixtures/", import.meta.url);
const read = (dir: string, f: string) => readFileSync(new URL(`${dir}/${f}`, ROOT), "utf8");
const cases = readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

const REASON: Record<string, string> = { 出图幅: "frame", 线: "line", 框: "box", 点: "point", 字: "label", 界外: "outside", null: "free" };
const DIR_NAMES: Record<number, string> = { 0: "右", 315: "右上", 45: "右下", 180: "左", 225: "左上", 135: "左下", 270: "上", 90: "下" };
/** The Python script's name for how a position was found. */
function pyHow(h: How): string {
  if (h.kind === "point") return `${DIR_NAMES[h.dir] ?? `${h.dir}°`}·${h.gap}`;
  return { line: "沿线", area: "附近", original: "原位" }[h.kind];
}

type Expected = {
  placements: { name: string; x: number; y: number; angle: number; hw: number; hh: number; how: string; why0: string | null; moved: number }[];
  failed: { name: string; why0: string | null; checked: number; why: Record<string, number> }[];
  warnings: string[];
  labels: Record<string, unknown>[];
  obstacles: Record<string, { count: number; sum: number; abs_sum: number }> & {
    geoms: Record<string, { rings: number; points: number; closed: number; sum: number }>;
  };
};

const close = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

describe.each(cases)("%s", (name) => {
  const cfg: Config = JSON.parse(read(name, "config.json"));
  const doc: LabelDoc = JSON.parse(read(name, String(cfg.labels)));
  const svg = read(name, String(cfg.svg));
  const exp: Expected = JSON.parse(read(name, "expected.json"));

  it("reads the same obstacles from the SVG", () => {
    const P = placeOptions(cfg);
    const o = parseSvg(svg, { areaIds: P.area_ids, rectMax: P.rect_max, textCharEm: P.text_char_em, textDescent: P.text_descent });
    const lists = {
      segs: o.segs.map((s) => [s.x1, s.y1, s.x2, s.y2, s.hw]),
      rects: o.rects,
      oboxes: o.oboxes,
      circles: o.circles,
    };
    for (const [k, list] of Object.entries(lists)) {
      const flat = list.flat();
      const want = exp.obstacles[k]!;
      expect(list.length, k).toBe(want.count);
      expect(close(flat.reduce((a, b) => a + b, 0), want.sum, 1e-9 * Math.max(1, want.abs_sum)), `${k} sum`).toBe(true);
    }
    const geoms = Object.fromEntries(
      [...o.geoms].map(([id, g]) => [
        id,
        {
          rings: g.length,
          points: g.reduce((a, r) => a + r.pts.length, 0),
          closed: g.filter((r) => r.closed).length,
          sum: g.flatMap((r) => r.pts.flat()).reduce((a, b) => a + b, 0),
        },
      ]),
    );
    expect(Object.keys(geoms).sort()).toEqual(Object.keys(exp.obstacles.geoms).sort());
    for (const [id, want] of Object.entries(exp.obstacles.geoms)) {
      const got = geoms[id]!;
      expect({ ...got, sum: 0 }, id).toEqual({ ...want, sum: 0 });
      expect(close(got.sum, want.sum, 1e-9 * Math.max(1, Math.abs(want.sum))), `${id} sum`).toBe(true);
    }
    expect(o.warnings.length).toBe(exp.warnings.length);
  });

  const result = placeLabels(svg, doc, cfg, { decimals: null });

  it("chooses the same position for every label", () => {
    const got = result.placements.map((p: Placement) => ({
      name: p.name,
      how: pyHow(p.how),
      why0: p.why0,
      moved: pyRound(p.moved),
    }));
    const want = exp.placements.map((p) => ({ name: p.name, how: p.how, why0: p.why0 === null ? null : REASON[p.why0], moved: p.moved }));
    expect(got).toEqual(want);
    result.placements.forEach((p, i) => {
      const w = exp.placements[i]!;
      expect([p.x, p.y, p.angle, p.hw, p.hh].every((v, k) => close(v, [w.x, w.y, w.angle, w.hw, w.hh][k]!)), p.name).toBe(true);
    });
  });

  it("reports the same labels as impossible to place", () => {
    const got = result.failed.map((p) => ({ name: p.name, why0: p.why0, checked: p.failure!.checked, why: p.failure!.why }));
    const want = exp.failed.map((f) => ({
      name: f.name,
      why0: f.why0 === null ? null : REASON[f.why0],
      checked: f.checked,
      why: Object.fromEntries(Object.entries(f.why).map(([k, v]) => [REASON[k], v])),
    }));
    expect(got).toEqual(want);
  });

  it("writes the same label file", () => {
    expect(result.doc.labels.length).toBe(exp.labels.length);
    result.doc.labels.forEach((lb, i) => {
      const w = exp.labels[i]!;
      expect(Object.keys(lb)).toEqual(Object.keys(w));
      for (const [k, v] of Object.entries(lb)) {
        if (typeof v === "number") expect(close(v, w[k] as number), `${lb.name}.${k}`).toBe(true);
        else expect(v).toEqual(w[k]);
      }
    });
  });
});
