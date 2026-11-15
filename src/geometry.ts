// Affine transforms, distances and the polygon test used by `within`.
// Ported from reference/python/map_place_labels.py; expressions keep Python's evaluation order so that
// results match to the last bit where the operations are exact.

import { floorDivInt, hypot, radians } from "./py.js";

export type Pt = readonly [number, number];
/** SVG matrix(a b c d e f) */
export type Mat = readonly [number, number, number, number, number, number];

export const IDENT: Mat = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

export function isIdent(m: Mat): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

export function matMul(m: Mat, n: Mat): Mat {
  const [a, b, c, d, e, f] = m;
  const [A, B, C, D, E, F] = n;
  return [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
}

export const NUM_SRC = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const NUM_G = new RegExp(NUM_SRC, "g");
const TRANSFORM_RE = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;

export function numbersIn(s: string): number[] {
  return Array.from(s.matchAll(NUM_G), (m) => Number(m[0]));
}

function arg(v: number[], i: number, name: string): number {
  const x = v[i];
  if (x === undefined) throw new Error(`transform ${name}() needs at least ${i + 1} number(s)`);
  return x;
}

/** The transform attribute as one matrix. Unknown functions are skipped, as in the Python version. */
export function parseTransform(s: string | undefined): Mat {
  let m = IDENT;
  for (const [, name, args] of (s ?? "").matchAll(TRANSFORM_RE)) {
    const v = numbersIn(args!);
    let t: Mat;
    if (name === "matrix" && v.length === 6) {
      t = v as unknown as Mat;
    } else if (name === "translate") {
      t = [1.0, 0.0, 0.0, 1.0, arg(v, 0, name), v.length > 1 ? v[1]! : 0.0];
    } else if (name === "scale") {
      const sx = arg(v, 0, name);
      t = [sx, 0.0, 0.0, v.length > 1 ? v[1]! : sx, 0.0, 0.0];
    } else if (name === "rotate") {
      const r = radians(arg(v, 0, name));
      t = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0.0, 0.0];
      if (v.length === 3) {
        t = matMul(matMul([1.0, 0.0, 0.0, 1.0, v[1]!, v[2]!], t), [1.0, 0.0, 0.0, 1.0, -v[1]!, -v[2]!]);
      }
    } else if (name === "skewX") {
      t = [1.0, 0.0, Math.tan(radians(arg(v, 0, name))), 1.0, 0.0, 0.0];
    } else if (name === "skewY") {
      t = [1.0, Math.tan(radians(arg(v, 0, name))), 0.0, 1.0, 0.0, 0.0];
    } else {
      continue;
    }
    m = matMul(m, t);
  }
  return m;
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  if (isIdent(m)) return [x, y];
  const [a, b, c, d, e, f] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}

/** Uniform scale of a matrix: sqrt(|det|). */
export function matScale(m: Mat): number {
  return isIdent(m) ? 1.0 : Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

export function matAngle(m: Mat): number {
  return isIdent(m) ? 0.0 : Math.atan2(m[1], m[0]);
}

/** Distance from (px, py) to segment ab. */
export function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const L = dx * dx + dy * dy;
  const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L));
  return hypot(px - x1 - t * dx, py - y1 - t * dy);
}

/** Does a segment (in box-local coordinates) meet [-bu, bu] x [-bv, bv]? Liang-Barsky clipping. */
export function segHitsBox(u1: number, v1: number, u2: number, v2: number, bu: number, bv: number): boolean {
  const du = u2 - u1;
  const dv = v2 - v1;
  let t0 = 0.0;
  let t1 = 1.0;
  const pq: [number, number][] = [
    [-du, u1 + bu],
    [du, bu - u1],
    [-dv, v1 + bv],
    [dv, bv - v1],
  ];
  for (const [p, q] of pq) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        t0 = Math.max(t0, t);
      } else {
        if (t < t0) return false;
        t1 = Math.min(t1, t);
      }
    }
  }
  return true;
}

/** Key of a grid cell. Numeric while the cell index fits in 16 bits (coordinates up to ~±780k at cell 24). */
export function cellKey(gx: number, gy: number): number | string {
  return gx >= -32768 && gx < 32768 && gy >= -32768 && gy < 32768 ? (gx + 32768) * 65536 + (gy + 32768) : `${gx},${gy}`;
}

export function pushCell<T>(grid: Map<number | string, T[]>, key: number | string, v: T): void {
  const list = grid.get(key);
  if (list) list.push(v);
  else grid.set(key, [v]);
}

export type Ring = { pts: Pt[]; closed: boolean };

/** Polygon for the `within` constraint (even-odd rule; several rings = outer ring plus holes). */
export class Polygon {
  readonly edges: [Pt, Pt][] = [];
  private readonly grid = new Map<number | string, number[]>();
  private readonly rows = new Map<number, number[]>();

  constructor(
    rings: readonly Ring[],
    private readonly cell: number,
  ) {
    for (const { pts } of rings) {
      if (pts.length < 3) continue;
      const first = pts[0]!;
      const last = pts[pts.length - 1]!;
      const ring = last[0] !== first[0] || last[1] !== first[1] ? [...pts, first] : pts;
      for (let i = 0; i + 1 < ring.length; i++) {
        const p = ring[i]!;
        const q = ring[i + 1]!;
        const k = this.edges.length;
        this.edges.push([p, q]);
        const gx0 = floorDivInt(Math.min(p[0], q[0]), cell);
        const gx1 = floorDivInt(Math.max(p[0], q[0]), cell);
        const gy0 = floorDivInt(Math.min(p[1], q[1]), cell);
        const gy1 = floorDivInt(Math.max(p[1], q[1]), cell);
        for (let gx = gx0; gx <= gx1; gx++) {
          for (let gy = gy0; gy <= gy1; gy++) pushCell(this.grid, cellKey(gx, gy), k);
        }
        for (let gy = gy0; gy <= gy1; gy++) {
          const row = this.rows.get(gy);
          if (row) row.push(k);
          else this.rows.set(gy, [k]);
        }
      }
    }
    if (this.edges.length === 0) throw new Error("within: the polygon has no closed ring");
  }

  containsPoint(px: number, py: number): boolean {
    let inside = false;
    for (const k of this.rows.get(floorDivInt(py, this.cell)) ?? []) {
      const [[x1, y1], [x2, y2]] = this.edges[k]!;
      if (y1 > py !== y2 > py && x1 + ((py - y1) * (x2 - x1)) / (y2 - y1) > px) inside = !inside;
    }
    return inside;
  }

  /** Is the whole box (centre, half sizes, angle) inside, at least `margin` from every edge? */
  containsBox(cx: number, cy: number, hw: number, hh: number, ang: number, margin: number): boolean {
    if (!this.containsPoint(cx, cy)) return false;
    const bu = hw + margin;
    const bv = hh + margin;
    const R = hypot(bu, bv);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const seen = new Set<number>();
    const gx0 = floorDivInt(cx - R, this.cell);
    const gx1 = floorDivInt(cx + R, this.cell);
    const gy0 = floorDivInt(cy - R, this.cell);
    const gy1 = floorDivInt(cy + R, this.cell);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        for (const k of this.grid.get(cellKey(gx, gy)) ?? []) {
          if (seen.has(k)) continue;
          seen.add(k);
          const [[x1, y1], [x2, y2]] = this.edges[k]!;
          const u1 = (x1 - cx) * c + (y1 - cy) * s;
          const v1 = -(x1 - cx) * s + (y1 - cy) * c;
          const u2 = (x2 - cx) * c + (y2 - cy) * s;
          const v2 = -(x2 - cx) * s + (y2 - cy) * c;
          if (segHitsBox(u1, v1, u2, v2, bu, bv)) return false;
        }
      }
    }
    return true;
  }
}
