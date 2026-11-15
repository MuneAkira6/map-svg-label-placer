// Greedy label placement: labels go in priority order; each one tries its candidate positions from cheapest
// to dearest and takes the first whose box covers no line, box, symbol or earlier label.
// Ported from main() in reference/python/map_place_labels.py.

import { halfSize, placeOptions } from "./config.js";
import type { Config, Label, LabelDoc, PlaceConfig } from "./config.js";
import { Polygon, cellKey, pushCell, segDist, type Pt, type Ring } from "./geometry.js";
import { degrees, dist, floorDivInt, hypot, pyRound, pyStr, radians, truthy } from "./py.js";
import { parseSvg, type Obstacles } from "./svg.js";

/** Why a box position is not free. */
export type Reason = "frame" | "line" | "box" | "point" | "label" | "outside";

/** How the chosen position was found. */
export type How =
  | { kind: "point"; dir: number; gap: number }
  | { kind: "line" }
  | { kind: "area" }
  | { kind: "original" };

export type Placement = {
  /** Index in doc.labels */
  index: number;
  name: string;
  /** Centre of the label box, SVG px (not rounded). */
  x: number;
  y: number;
  /** Radians, clockwise. */
  angle: number;
  hw: number;
  hh: number;
  how: How;
  /** Why the label's original position was not free (null: it was free). */
  why0: Reason | null;
  /** Distance moved from the original centre. */
  moved: number;
  /** Set when no candidate was free and the label stays at its original position. */
  failure?: { checked: number; why: Partial<Record<Reason | "free", number>> };
};

export type PlaceResult = {
  /** A copy of the label file with x, y (and angle) replaced; "anchor" is dropped from placed labels. */
  doc: LabelDoc;
  /** In placement order (priority order), skipped and fixed labels excluded. */
  placements: Placement[];
  failed: Placement[];
  warnings: string[];
  width: number;
};

export type PlaceOptions = {
  /** Display width whose style table sizes the boxes (default: config place.width). */
  width?: number;
  /** Decimals of x, y and angle written to `doc` (default 1, as the Python script; null keeps full precision). */
  decimals?: number | null;
};

type Box = { cx: number; cy: number; hw: number; hh: number; ang: number };

/** All obstacles, with stroked segments in a uniform grid. */
export class World {
  readonly placed: Box[] = [];
  private readonly segs: Float64Array;
  private readonly grid = new Map<number | string, number[]>();

  constructor(
    private readonly obst: Obstacles,
    private readonly W: number,
    private readonly H: number,
    private readonly P: PlaceConfig,
  ) {
    const n = obst.segs.length;
    this.segs = new Float64Array(n * 5);
    const M = P.margin;
    const cell = P.cell;
    obst.segs.forEach((s, i) => {
      this.segs.set([s.x1, s.y1, s.x2, s.y2, s.hw], i * 5);
      const r = s.hw + M;
      const gx0 = floorDivInt(Math.min(s.x1, s.x2) - r, cell);
      const gx1 = floorDivInt(Math.max(s.x1, s.x2) + r, cell);
      const gy0 = floorDivInt(Math.min(s.y1, s.y2) - r, cell);
      const gy1 = floorDivInt(Math.max(s.y1, s.y2) + r, cell);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) pushCell(this.grid, cellKey(gx, gy), i);
      }
    });
  }

  /** What covers the point (px, py), if anything. */
  hit(px: number, py: number): Reason | null {
    const { P } = this;
    const M = P.margin;
    const pad = P.frame_pad;
    if (!(pad <= px && px <= this.W - pad && pad <= py && py <= this.H - pad)) return "frame";
    const list = this.grid.get(cellKey(floorDivInt(px, P.cell), floorDivInt(py, P.cell)));
    if (list) {
      const s = this.segs;
      for (const i of list) {
        const o = i * 5;
        if (segDist(px, py, s[o]!, s[o + 1]!, s[o + 2]!, s[o + 3]!) < s[o + 4]! + M) return "line";
      }
    }
    for (const [x0, y0, x1, y1] of this.obst.rects) {
      if (x0 - M <= px && px <= x1 + M && y0 - M <= py && py <= y1 + M) return "box";
    }
    for (const [cx, cy, hw, hh, ang] of this.obst.oboxes) {
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const u = (px - cx) * c + (py - cy) * s;
      const v = -(px - cx) * s + (py - cy) * c;
      if (Math.abs(u) <= hw + M && Math.abs(v) <= hh + M) return "box";
    }
    for (const [cx, cy, r] of this.obst.circles) {
      if (hypot(px - cx, py - cy) < r + M) return "point";
    }
    const G = P.gap_label;
    for (const { cx, cy, hw, hh, ang } of this.placed) {
      const c = Math.cos(-ang);
      const s = Math.sin(-ang);
      const u = (px - cx) * c - (py - cy) * s;
      const v = (px - cx) * s + (py - cy) * c;
      if (Math.abs(u) <= hw + G && Math.abs(v) <= hh + G) return "label";
    }
    return null;
  }

  /** Is a label box free? Samples a grid of points every `step` px inside it. */
  free(cx: number, cy: number, hw: number, hh: number, ang = 0.0, within: Polygon | null = null): Reason | null {
    if (within !== null && !within.containsBox(cx, cy, hw, hh, ang, this.P.within_margin)) return "outside";
    const step = this.P.step;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const nu = Math.max(2, Math.trunc((2 * hw) / step) + 1);
    const nv = Math.max(2, Math.trunc((2 * hh) / step) + 1);
    for (let i = 0; i < nu; i++) {
      const u = -hw + (2 * hw * i) / (nu - 1);
      for (let j = 0; j < nv; j++) {
        const v = -hh + (2 * hh * j) / (nv - 1);
        const why = this.hit(cx + u * c - v * s, cy + u * s + v * c);
        if (why) return why;
      }
    }
    return null;
  }
}

/** Chord direction around point k (span px each way), folded into (-90°, 90°] so text is never upside down. */
function tangent(pts: Pt[], k: number, span: number): number {
  const walk = (step: number): Pt => {
    let i = k;
    let acc = 0.0;
    while (i + step >= 0 && i + step < pts.length && acc < span) {
      acc += dist(pts[i]!, pts[i + step]!);
      i += step;
    }
    return pts[i]!;
  };
  const a = walk(-1);
  const b = walk(1);
  let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  if (ang > Math.PI / 2) ang -= Math.PI;
  if (ang <= -Math.PI / 2) ang += Math.PI;
  return ang;
}

function resample(pts: Pt[], step: number): Pt[] {
  const out: Pt[] = [pts[0]!];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    const L = dist(p, q);
    const n = floorDivInt(L, step);
    for (let k = 1; k <= n; k++) {
      const t = (k * step) / L;
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
    const last = out[out.length - 1]!;
    if (last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  return out;
}

/** int(s) in Python for a path part: optional sign and digits, surrounding whitespace allowed. */
function pyIntIndex(s: string): number | null {
  return /^\s*[-+]?\d+\s*$/.test(s) ? parseInt(s, 10) : null;
}

/** Follow "towns/{name}" or "toll_xy/{index}" through the label file. */
function lookup(meta: unknown, path: string, lb: Label, names: string[] | undefined): unknown {
  let cur: unknown = meta;
  for (let part of path.split("/")) {
    part = part.replaceAll("{name}", lb.name);
    if (part.includes("{index}")) {
      const idx = names?.indexOf(lb.name) ?? -1;
      if (idx < 0) return null;
      part = part.replaceAll("{index}", String(idx));
    }
    if (Array.isArray(cur)) {
      const i = pyIntIndex(part);
      if (i === null) return null;
      const j = i < 0 ? cur.length + i : i;
      if (j < 0 || j >= cur.length) return null;
      cur = cur[j];
    } else if (cur !== null && typeof cur === "object") {
      if (!Object.hasOwn(cur, part)) return null;
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }
  return cur;
}

/** obj[key] for an own key only, so names like "constructor" do not reach Object.prototype. */
function own<T>(obj: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

function ruleMatches(rule: { kinds?: string[]; names?: string[] }, lb: Label): boolean {
  if (rule.kinds !== undefined && !rule.kinds.includes(lb.kind)) return false;
  if (rule.names !== undefined && !rule.names.includes(lb.name)) return false;
  return true;
}

function anchorOf(lb: Label, meta: LabelDoc, P: PlaceConfig): { at: Pt; r: number } | null {
  for (const rule of P.anchors) {
    if (!ruleMatches(rule, lb)) continue;
    const v = rule.field !== undefined ? lb[rule.field] : lookup(meta, rule.xy ?? "", lb, rule.names);
    if (v === null || v === undefined) continue;
    const xy = v as number[];
    return { at: [xy[0]!, xy[1]!], r: rule.r };
  }
  return null;
}

/** "{field}" in a within id template, from the label's own fields; null when a field is missing. */
function fillFields(tpl: string, lb: Label): string | null {
  let missing = false;
  const out = tpl.replace(/\{([\p{L}\p{N}_]+)\}/gu, (_, f: string) => {
    if (!Object.hasOwn(lb, f)) {
      missing = true;
      return "";
    }
    return pyStr(lb[f]);
  });
  return missing ? null : out;
}

function withinId(lb: Label, P: PlaceConfig): string | null {
  if (Object.hasOwn(lb, "within")) return truthy(lb.within) ? String(lb.within) : null;
  for (const rule of P.within) {
    if (!ruleMatches(rule, lb)) continue;
    const id = fillFields(rule.id, lb);
    if (id !== null) return id;
  }
  return null;
}

type Cand = { cost: number; x: number; y: number; ang: number; how: How };

function sortCandidates(cands: Cand[]): Cand[] {
  const keyed = cands.map((c) => ({ c, k0: pyRound(c.cost, 6), k1: pyRound(c.x, 3), k2: pyRound(c.y, 3) }));
  keyed.sort((a, b) => a.k0 - b.k0 || a.k1 - b.k1 || a.k2 - b.k2);
  return keyed.map((e) => e.c);
}

function cloneDoc(doc: LabelDoc): LabelDoc {
  return structuredClone(doc);
}

/** Place every label of `doc` on the map `svg`. Pure: the inputs are not modified. */
export function placeLabels(svg: string, doc: LabelDoc, cfg: Config, opts: PlaceOptions = {}): PlaceResult {
  const P = placeOptions(cfg);
  const width = opts.width ?? P.width;
  const decimals = opts.decimals === undefined ? 1 : opts.decimals;
  const meta = cloneDoc(doc);
  const W = meta.width;
  const H = meta.height;
  const obst = parseSvg(svg, { areaIds: P.area_ids, rectMax: P.rect_max, textCharEm: P.text_char_em, textDescent: P.text_descent });
  const world = new World(obst, W, H, P);
  const labels = meta.labels;

  const lineOf = (lb: Label): Pt[][] | null => {
    const pid = (truthy(lb.line) ? lb.line : undefined) ?? own(P.lines, lb.name);
    if (!truthy(pid)) return null;
    const g = obst.geoms.get(String(pid));
    if (g === undefined) throw new Error(`no element with id="${pid}" in the SVG (label "${lb.name}")`);
    return g
      .filter(({ pts }) => pts.length > 1)
      .map(({ pts, closed }) => {
        const first = pts[0]!;
        const last = pts[pts.length - 1]!;
        return closed && (last[0] !== first[0] || last[1] !== first[1]) ? [...pts, first] : pts;
      });
  };

  const polys = new Map<string, Polygon>();
  const withinOf = (lb: Label): Polygon | null => {
    const pid = withinId(lb, P);
    if (!pid) return null;
    let poly = polys.get(pid);
    if (poly === undefined) {
      const g: Ring[] | undefined = obst.geoms.get(pid);
      if (g === undefined) throw new Error(`within: no polygon with id="${pid}" in the SVG (label "${lb.name}")`);
      poly = new Polygon(g, P.cell);
      polys.set(pid, poly);
    }
    return poly;
  };

  const lineIds = new Map<string, Pt[][]>();
  for (const lb of labels) {
    const pl = lineOf(lb);
    if (pl !== null) lineIds.set(lb.name, pl);
  }
  const anchors = new Map<string, { at: Pt; r: number }>();
  for (const lb of labels) {
    const an = anchorOf(lb, meta, P);
    if (an !== null) anchors.set(lb.name, an);
  }

  const center = (lb: Label, hw: number): [number, number] => {
    let x = lb.x;
    const y = lb.y;
    if (lb.anchor === "start") x += hw;
    else if (lb.anchor === "end") x -= hw;
    return [x, y];
  };
  const isFixed = (lb: Label) => truthy(lb.fixed) || P.fixed_kinds.includes(lb.kind);
  const skipped = (lb: Label) => truthy(lb[`skip${width}`]);

  if (P.fixed_as_obstacles) {
    for (const lb of labels) {
      if (isFixed(lb) && !skipped(lb)) {
        const [hw, hh] = halfSize(lb, width, W, cfg, P);
        const [cx, cy] = center(lb, hw);
        world.placed.push({ cx, cy, hw, hh, ang: radians(lb.angle ?? 0) });
      }
    }
  }

  const pri = P.priority;
  const order = labels
    .map((lb, i) => ({ lb, i }))
    .filter(({ lb }) => !isFixed(lb))
    .map(({ lb, i }) => ({ i, p: pri.includes(lb.kind) ? pri.indexOf(lb.kind) : 99 }))
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .map((e) => e.i);

  const { point: PP, line: PL, area: PA } = P;
  const placements: Placement[] = [];
  const failed: Placement[] = [];
  const clip = (v: number) => Math.max(-1.0, Math.min(1.0, v));

  for (const i of order) {
    const lb = labels[i]!;
    if (skipped(lb)) continue;
    const [hw, hh] = halfSize(lb, width, W, cfg, P);
    const [x0, y0] = center(lb, hw);
    const poly = withinOf(lb);
    const ang0 = radians(lb.angle ?? 0);
    let cands: Cand[] = [];
    const anchor = anchors.get(lb.name);
    const line = lineIds.get(lb.name);
    if (anchor !== undefined) {
      const [px, py] = anchor.at;
      const r = anchor.r;
      const pref = [...PP.dirs];
      const degs = [...pref];
      for (let d = 0; d < 360; d += PP.dir_step) if (!pref.includes(d)) degs.push(d);
      degs.forEach((deg, j) => {
        const th = radians(deg);
        const c = Math.cos(th);
        const s = Math.sin(th);
        for (let g = PP.gap_min; g <= PP.gap_max; g++) {
          const x = px + c * (r + g) + hw * clip(2 * c);
          const y = py + s * (r + g) + hh * clip(2 * s);
          const edge = hypot(Math.max(Math.abs(px - x) - hw, 0), Math.max(Math.abs(py - y) - hh, 0));
          cands.push({ cost: pyRound(edge) * 1000 + j, x, y, ang: 0.0, how: { kind: "point", dir: deg, gap: g } });
        }
      });
    } else if (line !== undefined) {
      for (const pts of line) {
        const rs = resample(pts, PL.resample);
        rs.forEach((p, k) => {
          if (dist(p, [x0, y0]) > PL.max_dist) return;
          const ang = tangent(rs, k, PL.tangent_span);
          for (const extra of PL.offsets) {
            const off = hh + PL.clearance + P.margin + 1 + extra;
            for (const side of [1, -1]) {
              const x = p[0] - Math.sin(ang) * off * side;
              const y = p[1] + Math.cos(ang) * off * side;
              cands.push({ cost: dist([x, y], [x0, y0]) + extra * PL.offset_cost, x, y, ang, how: { kind: "line" } });
            }
          }
        });
      }
    } else {
      const rad = PA.radius;
      const lim = own(rad, lb.kind) ?? own(rad, "*") ?? 60;
      for (let rr = 0; rr <= lim; rr += PA.ring_step) {
        const n = Math.max(1, Math.trunc((2 * Math.PI * rr) / PA.arc_step));
        for (let t = 0; t < n; t++) {
          const th = (2 * Math.PI * t) / n;
          cands.push({ cost: rr + t * 1e-6, x: x0 + rr * Math.cos(th), y: y0 + rr * Math.sin(th), ang: ang0, how: { kind: "area" } });
        }
      }
    }
    cands = sortCandidates(cands);
    if (anchor !== undefined) cands.push({ cost: 1e9, x: x0, y: y0, ang: ang0, how: { kind: "original" } });
    const why0 = world.free(x0, y0, hw, hh, ang0, poly);

    const owns = (x: number, y: number): boolean => {
      if (anchor === undefined) return true;
      const bd = (p: Pt) => hypot(Math.max(Math.abs(p[0] - x) - hw, 0), Math.max(Math.abs(p[1] - y) - hh, 0));
      const mine = bd(anchor.at);
      let nearest = Infinity;
      for (const [name, a] of anchors) if (name !== lb.name) nearest = Math.min(nearest, bd(a.at));
      return nearest === Infinity || mine < P.own_ratio * nearest;
    };

    let chosen: Cand | null = null;
    for (const c of cands) {
      if (owns(c.x, c.y) && !world.free(c.x, c.y, hw, hh, c.ang, poly)) {
        chosen = c;
        break;
      }
    }
    let failure: Placement["failure"];
    if (chosen === null) {
      const why: Partial<Record<Reason | "free", number>> = {};
      const checked = cands.slice(0, 400);
      for (const c of checked) {
        const k = world.free(c.x, c.y, hw, hh, c.ang, poly) ?? "free";
        why[k] = (why[k] ?? 0) + 1;
      }
      failure = { checked: checked.length, why };
      chosen = { cost: 0, x: x0, y: y0, ang: ang0, how: { kind: "original" } };
    }
    const { x, y, ang, how } = chosen;
    const placement: Placement = { index: i, name: lb.name, x, y, angle: ang, hw, hh, how, why0, moved: dist([x, y], [x0, y0]) };
    if (failure) {
      placement.failure = failure;
      failed.push(placement);
    }
    placements.push(placement);

    const hadAngle = truthy(lb.angle);
    lb.x = decimals === null ? x : pyRound(x, decimals);
    lb.y = decimals === null ? y : pyRound(y, decimals);
    delete lb.anchor;
    if (line !== undefined || hadAngle) lb.angle = decimals === null ? degrees(ang) : pyRound(degrees(ang), decimals);
    world.placed.push({ cx: x, cy: y, hw, hh, ang });
  }
  return { doc: meta, placements, failed, warnings: obst.warnings, width };
}
