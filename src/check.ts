// A read-only check of the names on an SVG map, as Commons draws them: which have a line through them, which
// cover each other, which run off the edge, and which text Commons does not show at all.

import { apply, cellKey, matAngle, matScale, numbersIn, pushCell, segHitsBox, type Pt } from "./geometry.js";
import { pathSubpaths } from "./path.js";
import { floorDivInt } from "./py.js";
import { alpha, num as svgNum, paints, parseSvg, walkSvg, type Seg, type SvgElement } from "./svg.js";
import { readSvgLabels } from "./svgplace.js";
import type { SvgText } from "./svgtext.js";
import { langMatches } from "./textgroups.js";
import { layoutText } from "./textlayout.js";

/** Four corners, clockwise from the top left of the text. */
export type Quad = [Pt, Pt, Pt, Pt];

/** A stroked line through the middle of the letters, or only across the edge of the text's box. */
export type LineHit = "core" | "edge";

export type CheckedBox = { corners: Quad; line: LineHit | null };

export type LabelCheck = {
  /** Index in readSvgLabels(svg).groups. */
  index: number;
  name: string;
  /** One box per drawn line of the name, in root coordinates. */
  boxes: CheckedBox[];
  /** The worst line hit over the boxes. */
  line: LineHit | null;
  /** Labels covering more than a tenth of one of this label's boxes. */
  overlaps: number[];
  /** Part of the name lies outside the frame, where it is cut off. */
  clipped: boolean;
  /** An outline in another colour (a halo), or a solid plate under the name, keeps lines from showing through. */
  masked: "halo" | "plate" | null;
  /** Set when the label is not judged, with the reason. */
  skipped?: string;
};

/** Text in the file that Commons does not draw. */
export type Unshown = { kind: "flowRoot" | "textPath"; text: string; corners: Quad | null };

export type SvgCheck = {
  /** min-x, min-y, width, height of the viewBox. */
  frame: [number, number, number, number];
  labels: LabelCheck[];
  unshown: Unshown[];
  warnings: string[];
};

export type CheckOptions = {
  /** Language the map is drawn in, which picks the version shown in a <switch> (default "en", as Commons). */
  lang?: string;
  /** Width the map is looked at, px (default 1280, the size of Commons' large preview). */
  displayWidth?: number;
  /** Lines thinner than this at that width, px, are too faint to count (default 0.3). */
  minLinePx?: number;
};

type OBox = { cx: number; cy: number; hw: number; hh: number; ang: number };

function quad(b: OBox): Quad {
  const c = Math.cos(b.ang);
  const s = Math.sin(b.ang);
  const at = (u: number, v: number): Pt => [b.cx + u * b.hw * c - v * b.hh * s, b.cy + u * b.hw * s + v * b.hh * c];
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
}

function inside(b: OBox, x: number, y: number): boolean {
  const c = Math.cos(b.ang);
  const s = Math.sin(b.ang);
  const u = (x - b.cx) * c + (y - b.cy) * s;
  const v = -(x - b.cx) * s + (y - b.cy) * c;
  return Math.abs(u) <= b.hw && Math.abs(v) <= b.hh;
}

/**
 * The name on one line: a text placed again lower down (a tspan with its own y, or with x and dy) starts a new
 * line of the name, and the lines are joined with a space. Letters placed one by one along a line stay together.
 */
function nameOf(texts: readonly SvgText[]): string {
  const lines = texts.map((t) => {
    let s = "";
    let y: number | undefined;
    t.chars.forEach((c, i) => {
      const newLine = i > 0 && ((c.y !== undefined && c.y !== y) || (c.x !== undefined && c.dy !== 0));
      if (newLine && !/\s$/.test(s)) s += " ";
      if (c.y !== undefined) y = c.y;
      s += c.ch;
    });
    return (s || t.content).replace(/\s+/g, " ").trim();
  });
  return lines.filter(Boolean).join(" ");
}

/** Share of the smaller box covered by the larger, sampled on an 11 x 5 grid. */
function share(a: OBox, b: OBox): number {
  const [small, big] = a.hw * a.hh <= b.hw * b.hh ? [a, b] : [b, a];
  const c = Math.cos(small.ang);
  const s = Math.sin(small.ang);
  let k = 0;
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 4; j++) {
      const u = -small.hw + (small.hw * i) / 5;
      const v = -small.hh + (small.hh * j) / 2;
      if (inside(big, small.cx + u * c - v * s, small.cy + u * s + v * c)) k++;
    }
  }
  return k / 55;
}

/** Is the point inside a convex quadrilateral (either winding)? */
function inQuad(q: readonly Pt[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i]!;
    const [bx, by] = q[(i + 1) % 4]!;
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

const area = (q: readonly Pt[]) =>
  Math.abs(q.reduce((s, [x, y], i) => s + x * q[(i + 1) % 4]![1] - q[(i + 1) % 4]![0] * y, 0)) / 2;

/** Stroked segments in a uniform grid; finds those that meet a rotated box, exactly (no sampling). */
class Lines {
  private readonly grid = new Map<number | string, number[]>();
  private readonly seen: Uint32Array;
  private stamp = 0;

  constructor(
    private readonly segs: readonly Seg[],
    private readonly cell: number,
  ) {
    this.seen = new Uint32Array(segs.length);
    segs.forEach((s, i) => {
      for (let gx = floorDivInt(Math.min(s.x1, s.x2) - s.hw, cell); gx <= floorDivInt(Math.max(s.x1, s.x2) + s.hw, cell); gx++) {
        for (let gy = floorDivInt(Math.min(s.y1, s.y2) - s.hw, cell); gy <= floorDivInt(Math.max(s.y1, s.y2) + s.hw, cell); gy++) {
          pushCell(this.grid, cellKey(gx, gy), i);
        }
      }
    });
  }

  /**
   * Does a line, with its stroke width, meet the box shrunk to the given share of its half width and height?
   * `shows` can rule out a line that meets the box but cannot be seen there.
   */
  hits(b: OBox, ku = 1, kv = 1, shows?: (g: Seg, b: OBox, bu: number, bv: number) => boolean): boolean {
    const c = Math.cos(b.ang);
    const s = Math.sin(b.ang);
    const ex = Math.abs(b.hw * c) + Math.abs(b.hh * s);
    const ey = Math.abs(b.hw * s) + Math.abs(b.hh * c);
    this.stamp++;
    const { cell } = this;
    for (let gx = floorDivInt(b.cx - ex, cell); gx <= floorDivInt(b.cx + ex, cell); gx++) {
      for (let gy = floorDivInt(b.cy - ey, cell); gy <= floorDivInt(b.cy + ey, cell); gy++) {
        for (const i of this.grid.get(cellKey(gx, gy)) ?? []) {
          if (this.seen[i] === this.stamp) continue;
          this.seen[i] = this.stamp;
          const g = this.segs[i]!;
          const local = (x: number, y: number) => [(x - b.cx) * c + (y - b.cy) * s, -(x - b.cx) * s + (y - b.cy) * c] as const;
          const [u1, v1] = local(g.x1, g.y1);
          const [u2, v2] = local(g.x2, g.y2);
          const bu = b.hw * ku + g.hw;
          const bv = b.hh * kv + g.hw;
          if (segHitsBox(u1, v1, u2, v2, bu, bv) && (!shows || shows(g, b, bu, bv))) return true;
        }
      }
    }
    return false;
  }
}

/** A filled shape that hides what was drawn before it: a plain colour, fully opaque, with no clip, mask or filter. */
type Fill = {
  at: number;
  rings: Pt[][];
  evenodd: boolean;
  color: string;
  box: [number, number, number, number];
  /** Edges x1, y1, x2, y2 and, per 64th of the height, the edges that reach into it: built on first use. */
  edges?: Float64Array;
  bands?: number[][];
};

const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00",
  gray: "#808080", grey: "#808080", silver: "#c0c0c0", navy: "#000080", maroon: "#800000", olive: "#808000",
};

/** One spelling per colour ("#abc", "#AABBCC", "rgb(170,187,204)"); null for gradients, patterns and other names. */
function colorKey(v: string | undefined): string | null {
  const s = (v ?? "black").trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join("")}`;
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  const m = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(s);
  if (m) return `#${m.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("")}`;
  return NAMED[s] ?? null;
}

/** The outline of a filled element in root coordinates, or null when it is not a shape. */
function fillRings(el: SvgElement): Pt[][] | null {
  const a = el.attrs;
  const n = (k: string) => svgNum(a.get(k), 0);
  let rings: Pt[][];
  if (el.local === "path") rings = pathSubpaths(a.get("d") ?? "", () => {}, { arcs: true }).map((r) => r.pts);
  else if (el.local === "polygon" || el.local === "polyline") {
    const v = numbersIn(a.get("points") ?? "");
    const pts: Pt[] = [];
    for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i]!, v[i + 1]!]);
    rings = [pts];
  } else if (el.local === "rect") {
    if (`${a.get("width")}${a.get("height")}`.includes("%")) return null;
    const [x, y, w, h] = [n("x"), n("y"), n("width"), n("height")];
    rings = [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]];
  } else if (el.local === "circle" || el.local === "ellipse") {
    const rx = el.local === "circle" ? n("r") : n("rx");
    const ry = el.local === "circle" ? n("r") : n("ry");
    const pts: Pt[] = [];
    for (let k = 0; k < 32; k++) pts.push([n("cx") + rx * Math.cos((k * Math.PI) / 16), n("cy") + ry * Math.sin((k * Math.PI) / 16)]);
    rings = [pts];
  } else return null;
  return rings.filter((r) => r.length > 2).map((r) => r.map(([x, y]) => apply(el.m, x, y)));
}

function insideFill(f: Fill, x: number, y: number): boolean {
  const [x0, y0, x1, y1] = f.box;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const h = (y1 - y0) / 64 || 1;
  if (!f.edges || !f.bands) {
    const n = f.rings.reduce((k, r) => k + r.length, 0);
    const edges = new Float64Array(n * 4);
    const bands: number[][] = Array.from({ length: 64 }, () => []);
    let e = 0;
    for (const r of f.rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xa, ya] = r[j]!;
        const [xb, yb] = r[i]!;
        edges.set([xa, ya, xb, yb], e * 4);
        const lo = Math.max(0, Math.min(63, Math.floor((Math.min(ya, yb) - y0) / h)));
        const hi = Math.max(0, Math.min(63, Math.floor((Math.max(ya, yb) - y0) / h)));
        for (let b = lo; b <= hi; b++) bands[b]!.push(e);
        e++;
      }
    }
    f.edges = edges;
    f.bands = bands;
  }
  let winding = 0;
  let odd = false;
  for (const e of f.bands[Math.max(0, Math.min(63, Math.floor((y - y0) / h)))]!) {
    const xa = f.edges[e * 4]!;
    const ya = f.edges[e * 4 + 1]!;
    const xb = f.edges[e * 4 + 2]!;
    const yb = f.edges[e * 4 + 3]!;
    if (yb > y !== ya > y && x < xa + ((y - ya) * (xb - xa)) / (yb - ya)) {
      odd = !odd;
      winding += yb > ya ? 1 : -1;
    }
  }
  return f.evenodd ? odd : winding !== 0;
}

/** The part [t0, t1] of a segment (in box coordinates) inside the box of half sizes bu, bv (Liang-Barsky). */
function clipT(u1: number, v1: number, u2: number, v2: number, bu: number, bv: number): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const du = u2 - u1;
  const dv = v2 - v1;
  for (const [p, q] of [[-du, u1 + bu], [du, bu - u1], [-dv, v1 + bv], [dv, bv - v1]] as const) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
    }
  }
  return t0 <= t1 ? [t0, t1] : null;
}

/**
 * Whether a stroked line can be seen where it crosses a box. It cannot when, at three points along the part
 * inside the box, it is painted over by a shape drawn later, or lies on a shape of its own colour.
 */
class Paint {
  // Shapes are filed in a coarse 32 x 32 grid over the frame: most are large (countries, seas, backgrounds).
  private readonly grid: number[][] = Array.from({ length: 32 * 32 }, () => []);

  constructor(
    private readonly fills: readonly Fill[],
    private readonly strokeOf: ReadonlyMap<number, string | null>,
    private readonly frame: readonly [number, number, number, number],
  ) {
    fills.forEach((f, i) => {
      const [gx0, gy0] = this.cellOf(f.box[0], f.box[1]);
      const [gx1, gy1] = this.cellOf(f.box[2], f.box[3]);
      for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) this.grid[gy * 32 + gx]!.push(i);
    });
  }

  private cellOf(x: number, y: number): [number, number] {
    const [X0, Y0, W, H] = this.frame;
    const clamp = (v: number) => Math.max(0, Math.min(31, Math.floor(v * 32)));
    return [clamp((x - X0) / (W || 1)), clamp((y - Y0) / (H || 1))];
  }

  private hiddenAt(g: Seg, x: number, y: number): boolean {
    // From the last shape drawn down: the first one under the point either covers the line or lies under it.
    const [gx, gy] = this.cellOf(x, y);
    const near = this.grid[gy * 32 + gx]!;
    for (let k = near.length - 1; k >= 0; k--) {
      const f = this.fills[near[k]!]!;
      if (!insideFill(f, x, y)) continue;
      if (f.at > g.at!) return true;
      const own = this.strokeOf.get(g.at!) ?? null;
      return own !== null && f.color === own;
    }
    return false;
  }

  shows = (g: Seg, b: OBox, bu: number, bv: number): boolean => {
    if (g.at === undefined) return true;
    const c = Math.cos(b.ang);
    const s = Math.sin(b.ang);
    const u1 = (g.x1 - b.cx) * c + (g.y1 - b.cy) * s;
    const v1 = -(g.x1 - b.cx) * s + (g.y1 - b.cy) * c;
    const u2 = (g.x2 - b.cx) * c + (g.y2 - b.cy) * s;
    const v2 = -(g.x2 - b.cx) * s + (g.y2 - b.cy) * c;
    const t = clipT(u1, v1, u2, v2, bu, bv);
    if (!t) return true;
    return [0.15, 0.5, 0.85].some((k) => {
      const tt = t[0] + (t[1] - t[0]) * k;
      return !this.hiddenAt(g, g.x1 + (g.x2 - g.x1) * tt, g.y1 + (g.y2 - g.y1) * tt);
    });
  };
}

const STROKE_IN_TSPAN = /<tspan\b[^>]*(?:\sstroke\s*=\s*["'](?!none)[^"']+["']|stroke\s*:\s*(?!none)[#a-z])/i;

export function checkSvgLabels(svg: string, opts: CheckOptions = {}): SvgCheck {
  const lang = opts.lang ?? "en";
  const L = readSvgLabels(svg, { lang });
  const [X0, Y0, W, H] = L.frame;
  const obst = parseSvg(svg, { areaIds: [], rectMax: 0, textCharEm: 0.6, textDescent: 2, skipTextAt: new Set(L.texts.map((t) => t.start)), arcs: true });
  const warnings = [...L.warnings, ...obst.warnings];

  // Halo: the text, or one of its tspans, has a stroke of another colour than its fill.
  // Plate: a filled rect, drawn before the text and not much larger than it.
  const haloAt = new Set<number>();
  const plates: { at: number; q: Pt[]; area: number }[] = [];
  const flowRoots: { start: number; end: number; text: string; corners: Quad | null }[] = [];
  const fills: Fill[] = [];
  const strokeOf = new Map<number, string | null>();
  for (const el of walkSvg(svg)) {
    if (!el.hidden && !el.nonrender && el.local !== "text") {
      if (paints(el.inh, "stroke")) strokeOf.set(el.start, colorKey(el.inh.get("stroke")));
      const color = paints(el.inh, "fill") && alpha(el.inh.get("fill-opacity")) >= 1 && el.opacity >= 1 && !el.masked ? colorKey(el.inh.get("fill")) : null;
      const rings = color ? fillRings(el) : null;
      if (color && rings && rings.length) {
        const box: Fill["box"] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const r of rings) {
          for (const [x, y] of r) {
            if (x < box[0]) box[0] = x;
            if (y < box[1]) box[1] = y;
            if (x > box[2]) box[2] = x;
            if (y > box[3]) box[3] = y;
          }
        }
        fills.push({ at: el.start, rings, evenodd: (el.inh.get("fill-rule") ?? "").trim() === "evenodd", color, box });
      }
    }
    if (el.local === "text") {
      const stroke = paints(el.inh, "stroke") && (el.inh.get("stroke") ?? "").trim().toLowerCase() !== (el.inh.get("fill") ?? "black").trim().toLowerCase();
      if (stroke || STROKE_IN_TSPAN.test(svg.slice(el.tagEnd, el.textEnd))) haloAt.add(el.start);
    } else if (el.local === "flowRoot" && el.unknown && !el.hidden) {
      const close = /<\/(?:[\w.-]+:)?flowRoot\s*>/.exec(svg.slice(el.tagEnd));
      const end = close ? el.tagEnd + close.index : el.tagEnd;
      const text = svg.slice(el.tagEnd, end).replace(/<flowRegion\b[\s\S]*?<\/(?:[\w.-]+:)?flowRegion\s*>/g, "").replace(/<[^>]*>/g, " ");
      flowRoots.push({ start: el.start, end, text: text.replace(/\s+/g, " ").trim(), corners: null });
    } else if (el.local === "rect") {
      const fr = flowRoots.find((f) => f.start < el.start && el.start < f.end);
      const a = el.attrs;
      const num = (k: string) => Number.parseFloat(a.get(k) ?? "0") || 0;
      const [x, y, w, h] = [num("x"), num("y"), num("width"), num("height")];
      const q = [apply(el.m, x, y), apply(el.m, x + w, y), apply(el.m, x + w, y + h), apply(el.m, x, y + h)] as Quad;
      if (fr && fr.corners === null) fr.corners = q;
      else if (!el.hidden && !el.nonrender && paints(el.inh, "fill") && !`${a.get("width")}${a.get("height")}`.includes("%")) {
        plates.push({ at: el.start, q, area: area(q) });
      }
    }
  }

  // One box per drawn line of each label.
  const fontPx = (t: SvgText) => (t.chars.reduce((m, c) => Math.max(m, c.style.fontSize), 0) || t.fontSize) * matScale(t.m);
  const boxesOf = L.groups.map((g) =>
    g.drawn.flatMap((t) => {
      const sc = matScale(t.m);
      const ang = matAngle(t.m);
      return layoutText(t).chunks.map(([l, tp, r, b]) => {
        const [cx, cy] = apply(t.m, (l + r) / 2, (tp + b) / 2);
        return { cx, cy, hw: ((r - l) / 2) * sc, hh: ((b - tp) / 2) * sc, ang, fs: fontPx(t), text: t };
      });
    }),
  );
  const fsList = boxesOf.flat().map((b) => b.fs).filter((v) => v > 0).sort((p, q) => p - q);
  const fsMed = fsList[Math.floor(fsList.length / 2)] ?? 10;
  // Cells of about two letters, but no more than 1000 across the frame (a frame-wide line would fill millions).
  const minWidth = ((opts.minLinePx ?? 0.3) * W) / (opts.displayWidth ?? 1280);
  const segs = fsList.length ? obst.segs.filter((g) => 2 * g.hw >= minWidth) : [];
  const cell = Math.max(fsMed * 2, Math.max(W, H) / 1000, 1e-6);
  const lines = new Lines(segs, cell);
  const shows = new Paint(fills, strokeOf, L.frame).shows;

  const labels: LabelCheck[] = L.groups.map((g, index) => {
    const rep = g.drawn[0] ?? g.texts[0]!;
    const res: LabelCheck = { index, name: nameOf(g.drawn.length ? g.drawn : [rep]), boxes: [], line: null, overlaps: [], clipped: false, masked: null };
    if (g.reason) res.skipped = g.reason;
    let halo = false;
    let plated = boxesOf[index]!.length > 0;
    for (const b of boxesOf[index]!) {
      const corners = quad(b);
      let line: LineHit | null = null;
      // The core: the middle half of the box's height (about the x-height) over 90% of its width.
      if (!g.reason && lines.hits(b, 1, 1, shows)) line = lines.hits(b, 0.9, 0.5, shows) ? "core" : "edge";
      if (line === "core" || (line === "edge" && res.line === null)) res.line = line;
      res.boxes.push({ corners, line });
      const out = 0.6 * b.hh;
      if (corners.some(([x, y]) => x < X0 - out || x > X0 + W + out || y < Y0 - out || y > Y0 + H + out)) res.clipped = true;
      if (haloAt.has(b.text.start)) halo = true;
      const boxArea = 4 * b.hw * b.hh;
      if (!plates.some((p) => p.at < b.text.start && p.area <= 6 * boxArea && corners.every(([x, y]) => inQuad(p.q, x, y)))) plated = false;
    }
    res.masked = halo ? "halo" : plated ? "plate" : null;
    return res;
  });

  // The same name twice at the same place: an outline drawn under a copy without one, or a plain duplicate.
  const flat = labels.flatMap((lb) => (lb.skipped ? [] : boxesOf[lb.index]!.map((b) => ({ lb, b }))));
  const key = (lb: LabelCheck, b: OBox & { fs: number }) => `${lb.name}@${Math.round(b.cx / Math.max(b.fs, 1e-9))},${Math.round(b.cy / Math.max(b.fs, 1e-9))}`;
  const firstAt = new Map<string, LabelCheck>();
  for (const { lb, b } of flat) {
    if (lb.boxes.length !== 1) continue;
    const k = key(lb, b);
    const first = firstAt.get(k);
    if (!first) {
      firstAt.set(k, lb);
      continue;
    }
    const [under, over] = [first, lb];
    if (under.masked === "halo" || over.masked === "halo") over.masked = "halo";
    under.skipped = "drawn again on top (as the outline under a name, say)";
    firstAt.set(k, over);
  }

  // Names covering each other, swept along x.
  const live = flat.filter(({ lb }) => !lb.skipped).map((e) => ({ ...e, r: Math.hypot(e.b.hw, e.b.hh) }));
  live.sort((p, q) => p.b.cx - p.r - (q.b.cx - q.r));
  for (let i = 0; i < live.length; i++) {
    const A = live[i]!;
    for (let j = i + 1; j < live.length; j++) {
      const B = live[j]!;
      if (B.b.cx - B.r > A.b.cx + A.r) break;
      if (A.lb === B.lb || Math.abs(A.b.cy - B.b.cy) > A.r + B.r) continue;
      if (share(A.b, B.b) > 0.1) {
        if (!A.lb.overlaps.includes(B.lb.index)) A.lb.overlaps.push(B.lb.index);
        if (!B.lb.overlaps.includes(A.lb.index)) B.lb.overlaps.push(A.lb.index);
      }
    }
  }
  for (const lb of labels) lb.overlaps.sort((p, q) => p - q);

  // Text Commons does not show: flowed text, and text along a path (only the version drawn in a <switch>).
  const unshown: Unshown[] = flowRoots.map((f) => ({ kind: "flowRoot", text: f.text, corners: f.corners }));
  const drawnAlt = new Map<number, number>();
  for (const t of L.texts) {
    if (t.switchAt === null || t.hidden || !langMatches(t.lang, lang)) continue;
    const at = t.altAt ?? t.start;
    if (!drawnAlt.has(t.switchAt) || at < drawnAlt.get(t.switchAt)!) drawnAlt.set(t.switchAt, at);
  }
  for (const t of L.texts) {
    if (t.hidden || !t.onPath || t.chars.length > 0) continue;
    if (t.switchAt !== null && drawnAlt.get(t.switchAt) !== (t.altAt ?? t.start)) continue;
    const href = /<textPath\b[^>]*?\s(?:[\w.-]+:)?href\s*=\s*["']#([^"']+)["']/.exec(svg.slice(t.tagEnd, t.textEnd))?.[1];
    const rings = href === undefined ? undefined : obst.geoms.get(href);
    let corners: Quad | null = null;
    if (rings?.length) {
      const pts = rings.flatMap((r) => r.pts);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const [l, tp, r, b] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      corners = [[l, tp], [r, tp], [r, b], [l, b]];
    }
    unshown.push({ kind: "textPath", text: t.content, corners });
  }
  return { frame: L.frame, labels, unshown, warnings };
}
