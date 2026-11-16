// SVG path data -> polylines. Curves become 8-segment polylines; arcs become a straight line to the end point
// (with a warning), as in the Python version.
//
// Bad path data is read up to the last complete segment, which is what the SVG spec asks of renderers and what
// librsvg draws. The Python version raises instead.

import { NUM_SRC, type Pt, type Ring } from "./geometry.js";

const PATH_TOK = new RegExp(`[\\s,]*(?:([MmLlHhVvCcSsQqTtAaZz])|(${NUM_SRC}))`, "y");
const ONLY_SEPARATORS = /^[\s,]*$/;
const CURVE_STEPS = 8;

type Tok = { cmd: string; num: number };

/** A segment is cut short or a character is not path data: stop reading, keep what was read. */
class BadPath extends Error {}

/** d -> subpaths in user units (not transformed). */
export function pathSubpaths(d: string | undefined, warn: (msg: string) => void): Ring[] {
  const src = d ?? "";
  const toks: Tok[] = [];
  PATH_TOK.lastIndex = 0;
  let end = 0;
  for (let m = PATH_TOK.exec(src); m; m = PATH_TOK.exec(src)) {
    toks.push({ cmd: m[1] ?? "", num: m[2] ? Number(m[2]) : NaN });
    end = PATH_TOK.lastIndex;
  }
  let bad = !ONLY_SEPARATORS.test(src.slice(end));
  const subs: Ring[] = [];
  let pts: Pt[] | null = null;
  let cx = 0.0;
  let cy = 0.0;
  let sx = 0.0;
  let sy = 0.0;
  let cmd: string | null = null;
  let ctrl: Pt | null = null;
  let ctrlKind: "C" | "Q" | null = null;
  let i = 0;
  const n = toks.length;

  const take = (k: number): number[] => {
    if (i + k > n) throw new BadPath();
    const v: number[] = [];
    for (let j = i; j < i + k; j++) {
      const t = toks[j]!;
      if (t.cmd) throw new BadPath();
      v.push(t.num);
    }
    i += k;
    return v;
  };
  const newSub = (x: number, y: number): Pt[] => {
    const p: Pt[] = [[x, y]];
    subs.push({ pts: p, closed: false });
    return p;
  };

  try {
    while (i < n) {
      const tok = toks[i]!;
      if (tok.cmd) {
        cmd = tok.cmd;
        i += 1;
        if (cmd === "Z" || cmd === "z") {
          if (pts !== null) subs[subs.length - 1]!.closed = true;
          cx = sx;
          cy = sy;
          pts = null;
          ctrl = null;
          ctrlKind = null;
          continue;
        }
      }
      if (cmd === null || (subs.length === 0 && cmd !== "M" && cmd !== "m")) throw new BadPath();
      const rel: boolean = cmd === cmd.toLowerCase();
      const C: string = cmd.toUpperCase();
      const ox = rel ? cx : 0.0;
      const oy = rel ? cy : 0.0;
      if (C === "M") {
        const [x, y] = take(2) as [number, number];
        cx = sx = x + ox;
        cy = sy = y + oy;
        pts = newSub(cx, cy);
        cmd = rel ? "l" : "L";
        ctrl = null;
        ctrlKind = null;
        continue;
      }
      if (pts === null) pts = newSub(cx, cy);
      if (C === "L") {
        const [x, y] = take(2) as [number, number];
        cx = x + ox;
        cy = y + oy;
        pts.push([cx, cy]);
        ctrlKind = null;
      } else if (C === "H") {
        cx = take(1)[0]! + ox;
        pts.push([cx, cy]);
        ctrlKind = null;
      } else if (C === "V") {
        cy = take(1)[0]! + oy;
        pts.push([cx, cy]);
        ctrlKind = null;
      } else if (C === "C" || C === "S") {
        let x1: number, y1: number, x2: number, y2: number, x: number, y: number;
        if (C === "C") {
          [x1, y1, x2, y2, x, y] = take(6) as [number, number, number, number, number, number];
          x1 = x1 + ox;
          y1 = y1 + oy;
        } else {
          [x2, y2, x, y] = take(4) as [number, number, number, number];
          [x1, y1] = ctrlKind === "C" ? [2 * cx - ctrl![0], 2 * cy - ctrl![1]] : [cx, cy];
        }
        x2 = x2 + ox;
        y2 = y2 + oy;
        x = x + ox;
        y = y + oy;
        for (let k = 1; k <= CURVE_STEPS; k++) {
          const t = k / CURVE_STEPS;
          const u = 1 - t;
          pts.push([
            u ** 3 * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x,
            u ** 3 * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y,
          ]);
        }
        cx = x;
        cy = y;
        ctrl = [x2, y2];
        ctrlKind = "C";
      } else if (C === "Q" || C === "T") {
        let x1: number, y1: number, x: number, y: number;
        if (C === "Q") {
          [x1, y1, x, y] = take(4) as [number, number, number, number];
          x1 = x1 + ox;
          y1 = y1 + oy;
        } else {
          [x, y] = take(2) as [number, number];
          [x1, y1] = ctrlKind === "Q" ? [2 * cx - ctrl![0], 2 * cy - ctrl![1]] : [cx, cy];
        }
        x = x + ox;
        y = y + oy;
        for (let k = 1; k <= CURVE_STEPS; k++) {
          const t = k / CURVE_STEPS;
          const u = 1 - t;
          pts.push([u * u * cx + 2 * u * t * x1 + t * t * x, u * u * cy + 2 * u * t * y1 + t * t * y]);
        }
        cx = x;
        cy = y;
        ctrl = [x1, y1];
        ctrlKind = "Q";
      } else if (C === "A") {
        const v = take(7);
        cx = v[5]! + ox;
        cy = v[6]! + oy;
        pts.push([cx, cy]);
        ctrlKind = null;
        warn("path has an arc (A); approximated by a straight line");
      }
    }
  } catch (e) {
    if (!(e instanceof BadPath)) throw e;
    bad = true;
  }
  if (bad) warn(`path data has an error; read up to it: ${src.slice(0, 60)}…`);
  return subs;
}
