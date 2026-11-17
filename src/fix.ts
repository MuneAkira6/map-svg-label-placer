// Move the names that checkSvgLabels finds with a line through their letters, and only those, to the nearest
// place where the same check passes. Only the x and y of the texts change.

import { checkScene, type OBox, type SvgCheck } from "./check.js";
import { svgViewport } from "./svgplace.js";
import { moveTexts, type SvgText } from "./svgtext.js";

export type FixOptions = {
  /** Language the map is drawn in, which picks the version shown in a <switch> (default "en", as Commons). */
  lang?: string;
  /** How far a name may move, in multiples of its height (default 2). */
  reach?: number;
  /** Decimals of the rewritten x and y (default 2). */
  decimals?: number;
};

export type FixMove = {
  /** Index in the check's labels. */
  index: number;
  name: string;
  /** How far the name moved, in root coordinates. */
  dx: number;
  dy: number;
  /** The <text> elements moved (their order in the document): its lines, language versions and copies. */
  texts: number[];
};

export type FixResult = {
  /** The map with the names moved; every other byte is unchanged. */
  svg: string;
  /** The check of the original map. */
  before: SvgCheck;
  moves: FixMove[];
  /**
   * Names with a line through them that stay: no free place within reach ("full"), a single letter, which is
   * mostly one of the spaced-out letters of an area's name ("letter"), a name that cannot be measured ("size"),
   * or one half of a name written as two texts side by side ("split").
   */
  stuck: { index: number; name: string; why: "full" | "letter" | "size" | "split" }[];
  /** Root units per pixel at the size MediaWiki gives the map. */
  unitsPerPx: number;
};

/** Do two rotated boxes overlap? (Separating axis test.) */
function overlap(a: OBox, b: OBox): boolean {
  for (const t of [a.ang, a.ang + Math.PI / 2, b.ang, b.ang + Math.PI / 2]) {
    const c = Math.cos(t);
    const s = Math.sin(t);
    const span = (o: OBox): [number, number] => {
      const oc = Math.cos(o.ang);
      const os = Math.sin(o.ang);
      const r = Math.abs(o.hw * (oc * c + os * s)) + Math.abs(o.hh * (oc * s - os * c));
      const m = o.cx * c + o.cy * s;
      return [m - r, m + r];
    };
    const [a0, a1] = span(a);
    const [b0, b1] = span(b);
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}

/** Gap between a box and a point, 0 inside. */
function gapTo(b: OBox, x: number, y: number): number {
  const c = Math.cos(b.ang);
  const s = Math.sin(b.ang);
  const u = Math.abs((x - b.cx) * c + (y - b.cy) * s) - b.hw;
  const v = Math.abs(-(x - b.cx) * s + (y - b.cy) * c) - b.hh;
  return Math.hypot(Math.max(u, 0), Math.max(v, 0));
}

export function fixSvgLabels(svg: string, opts: FixOptions = {}): FixResult {
  const { check, groups, lines, shows, paint, boxesOf, points, copies } = checkScene(svg, { lang: opts.lang });
  const [X0, Y0, W, H] = check.frame;
  const view = svgViewport(svg);
  const k = Math.max(W / view.width, H / view.height);
  const boxes: OBox[][] = boxesOf.map((bs) => bs.map(({ cx, cy, hw, hh, ang }) => ({ cx, cy, hw, hh, ang })));
  const todo = check.labels.filter((l) => !l.skipped && !groups[l.index]!.fixed && l.line === "core" && !l.masked && boxes[l.index]!.length);

  const moves: FixMove[] = [];
  const stuck: FixResult["stuck"] = [];
  for (const lb of todo) {
    const own = boxes[lb.index]!;
    const mine = new Set([lb.index, ...(copies.get(lb.index) ?? [])]);
    if ([...lb.name.replace(/\s/g, "")].length < 2) {
      stuck.push({ index: lb.index, name: lb.name, why: "letter" });
      continue;
    }
    const h = Math.max(...own.map((b) => 2 * b.hh));
    // A name with no height (letters the font tables do not cover, as Arabic) cannot be placed.
    if (!(h > 0)) {
      stuck.push({ index: lb.index, name: lb.name, why: "size" });
      continue;
    }
    // One half of a name written as two texts end to end on one line (ラバト and ・アモン, say) stays with the other:
    // texts next to each other in the file, of one size, on one baseline, less than 0.15 letter heights apart.
    if (own.length === 1) {
      const b = own[0]!;
      const at = groups[lb.index]!.drawn[0]!.index;
      const c = Math.cos(b.ang);
      const s = Math.sin(b.ang);
      const half = check.labels.some((o) => {
        const q = boxes[o.index]![0];
        const t = groups[o.index]!.drawn[0];
        if (mine.has(o.index) || boxes[o.index]!.length !== 1 || !q || !t || Math.abs(t.index - at) !== 1) return false;
        if (Math.abs(Math.sin(q.ang - b.ang)) > 0.02 || Math.cos(q.ang - b.ang) < 0 || Math.min(q.hh, b.hh) / Math.max(q.hh, b.hh) < 0.95) return false;
        const along = (q.cx - b.cx) * c + (q.cy - b.cy) * s;
        const across = -(q.cx - b.cx) * s + (q.cy - b.cy) * c;
        return Math.abs(across) <= 0.1 * h && Math.abs(Math.abs(along) - q.hw - b.hw) <= 0.15 * h;
      });
      if (half) {
        stuck.push({ index: lb.index, name: lb.name, why: "split" });
        continue;
      }
    }
    const reach = (opts.reach ?? 2) * h;
    const rad = (b: OBox) => Math.hypot(b.hw, b.hh);
    const [ox, oy] = [own.reduce((s, b) => s + b.cx, 0) / own.length, own.reduce((s, b) => s + b.cy, 0) / own.length];
    const span = Math.max(...own.map((b) => Math.hypot(b.cx - ox, b.cy - oy) + rad(b))) + reach + h;
    const others = boxes.flatMap((bs, i) => (mine.has(i) ? [] : bs.filter((b) => Math.hypot(b.cx - ox, b.cy - oy) <= span + rad(b))));
    const gap = 0.15 * h;
    const margin = k;
    const centre = (dx: number, dy: number): [number, number] => [
      own.reduce((s, b) => s + b.cx, 0) / own.length + dx,
      own.reduce((s, b) => s + b.cy, 0) / own.length + dy,
    ];
    // The area the name is in (the last shape drawn under its middle), which it must not leave.
    const area = paint.topAt(...centre(0, 0));
    // Point symbols: small closed shapes, at most two letter heights across and not long and thin. One within a
    // letter height of the name is taken to be the one it names: it must stay the nearest symbol to the name, and
    // the gap between them may grow by half a letter height at most (and never past a letter height, or past
    // the gap there was).
    const symbols = points.filter((p) => p.r <= h && p.long <= 2.5);
    const dist = (bs: OBox[], s: { x: number; y: number; r: number }) => Math.min(...bs.map((b) => gapTo(b, s.x, s.y))) - s.r;
    const near = symbols.map((s) => ({ s, d: dist(own, s) })).filter((e) => e.d <= h).sort((p, q) => p.d - q.d)[0];
    const keep = near ? Math.min(near.d + h / 2, Math.max(near.d, h)) : 0;

    // Free: no line within a pixel of the box, cheap tests first.
    const free = (dx: number, dy: number): boolean => {
      const moved = own.map((b) => ({ ...b, cx: b.cx + dx, cy: b.cy + dy }));
      for (const b of moved) {
        const c = Math.cos(b.ang);
        const s = Math.sin(b.ang);
        const ex = Math.abs(b.hw * c) + Math.abs(b.hh * s);
        const ey = Math.abs(b.hw * s) + Math.abs(b.hh * c);
        if (b.cx - ex < X0 || b.cx + ex > X0 + W || b.cy - ey < Y0 || b.cy + ey > Y0 + H) return false;
      }
      if (near) {
        const d = dist(moved, near.s);
        if (d > keep || symbols.some((p) => p !== near.s && dist(moved, p) < d)) return false;
      }
      for (const b of moved) {
        const big = { ...b, hw: b.hw + gap, hh: b.hh + gap };
        if (others.some((o) => overlap(big, o)) || symbols.some((p) => gapTo(big, p.x, p.y) < p.r)) return false;
      }
      if (paint.topAt(...centre(dx, dy)) !== area) return false;
      return !moved.some((b) => lines.hits({ ...b, hw: b.hw + margin, hh: b.hh + margin }, 1, 1, shows));
    };

    // Rings around the name, nearest first, a quarter of its height apart; flatter than round, as text is wide.
    const step = h / 4;
    let best: [number, number] | null = null;
    search: for (let r = step; r <= reach + 1e-9; r += step) {
      const n = Math.max(8, Math.ceil((2 * Math.PI * r) / step));
      for (let t = 0; t < n; t++) {
        const th = (2 * Math.PI * t) / n;
        const dx = r * Math.cos(th);
        const dy = r * Math.sin(th) * 0.75;
        if (free(dx, dy)) {
          best = [dx, dy];
          break search;
        }
      }
    }
    if (best === null) {
      stuck.push({ index: lb.index, name: lb.name, why: "full" });
      continue;
    }
    const [dx, dy] = best;
    for (const i of mine) {
      for (const b of boxes[i]!) {
        b.cx += dx;
        b.cy += dy;
      }
    }
    const texts = [...mine].flatMap((i) => groups[i]!.texts.map((t) => t.index)).sort((p, q) => p - q);
    moves.push({ index: lb.index, name: lb.name, dx, dy, texts });
  }

  const byText = new Map<SvgText, readonly [number, number]>();
  for (const m of moves) {
    for (const i of [m.index, ...(copies.get(m.index) ?? [])]) for (const t of groups[i]!.texts) byText.set(t, [m.dx, m.dy]);
  }
  return { svg: moveTexts(svg, byText, opts.decimals ?? 2), before: check, moves, stuck, unitsPerPx: k };
}
