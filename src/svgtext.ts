// The <text> elements already in an SVG: read them with their source positions, and move them by rewriting
// only the numbers in their x and y attributes (and those of their <tspan>s). Every other byte stays as it was.

import type { Mat } from "./geometry.js";
import { num, walkSvg } from "./svg.js";

/** A span of the source holding the value of an x or y attribute. */
export type CoordSpan = { axis: "x" | "y"; start: number; end: number; values: number[] };

export type SvgText = {
  /** Order among the <text> elements of the document. */
  index: number;
  id: string | undefined;
  /** Text content, tags removed, entities decoded, trimmed. */
  content: string;
  /** Source offsets: start of "<text", end of the start tag, start of "</text>". */
  start: number;
  tagEnd: number;
  textEnd: number;
  /** First x and y of the text element (0 when absent). */
  x: number;
  y: number;
  /** From the text's coordinates to the root's, including its own transform. */
  m: Mat;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  anchor: "start" | "middle" | "end";
  /** Not drawn: hidden, or inside <defs> and the like. */
  hidden: boolean;
  /** Ids of the ancestors, outermost first (e.g. a "legend" group). */
  ancestors: string[];
  /** Offset of the enclosing <switch>; texts sharing it are language versions of one label. */
  switchAt: number | null;
  /** systemLanguage of the text, if any. */
  lang: string | undefined;
  /** Every x / y value that moves with the text: its own and its <tspan>s'. */
  coords: CoordSpan[];
};

const ATTR_IDX_RE = /([^\s=>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/dgu;
const TSPAN_RE = /<tspan\b[^>]*>/gu;
const LIST_NUM_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

function coordSpans(svg: string, from: number, to: number): CoordSpan[] {
  const out: CoordSpan[] = [];
  for (const m of svg.slice(from, to).matchAll(ATTR_IDX_RE)) {
    if (m[1] !== "x" && m[1] !== "y") continue;
    const g = m.indices![2] ?? m.indices![3]!;
    const value = (m[2] ?? m[3])!;
    out.push({
      axis: m[1] as "x" | "y",
      start: from + g[0],
      end: from + g[1],
      values: Array.from(value.matchAll(LIST_NUM_RE), (v) => Number(v[0])),
    });
  }
  return out;
}

export function readTexts(svg: string): SvgText[] {
  const texts: SvgText[] = [];
  for (const el of walkSvg(svg)) {
    if (el.local !== "text") continue;
    const coords = coordSpans(svg, el.start, el.tagEnd);
    for (const t of el.textEnd > el.tagEnd ? svg.slice(el.tagEnd, el.textEnd).matchAll(TSPAN_RE) : []) {
      const s = el.tagEnd + t.index;
      coords.push(...coordSpans(svg, s, s + t[0].length));
    }
    const anchor = el.inh.get("text-anchor");
    texts.push({
      index: texts.length,
      id: el.attrs.get("id"),
      content: el.content,
      start: el.start,
      tagEnd: el.tagEnd,
      textEnd: el.textEnd,
      x: num(el.attrs.get("x"), 0.0),
      y: num(el.attrs.get("y"), 0.0),
      m: el.m,
      fontSize: num(el.inh.get("font-size"), 16.0),
      fontFamily: el.inh.get("font-family") ?? "",
      fontWeight: el.inh.get("font-weight") ?? "normal",
      anchor: anchor === "middle" || anchor === "end" ? anchor : "start",
      hidden: el.hidden || el.nonrender,
      ancestors: el.ancestors,
      switchAt: el.switchAt,
      lang: el.attrs.get("systemLanguage"),
      coords,
    });
  }
  return texts;
}

/** A number as short as possible with at most `decimals` decimals ("12.5", "-3", never "-0"). */
export function shortNumber(v: number, decimals: number): string {
  const s = v.toFixed(decimals).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

/** Move in root coordinates -> move in the text's own coordinates (inverse of the linear part of m). */
export function toLocal(m: Mat, dx: number, dy: number): [number, number] {
  const [a, b, c, d] = m;
  const det = a * d - b * c;
  if (det === 0) throw new Error("cannot move a text whose transform is singular");
  return [(d * dx - c * dy) / det, (-b * dx + a * dy) / det];
}

/**
 * Move texts by (dx, dy) in root coordinates. Only the x / y attribute values of the moved texts and their
 * <tspan>s change. A text with no x (or y) anywhere, on itself or a tspan, gets one after its tag name.
 */
export function moveTexts(svg: string, moves: ReadonlyMap<SvgText, readonly [number, number]>, decimals = 2): string {
  const edits: { start: number; end: number; text: string }[] = [];
  for (const [t, [dx, dy]] of moves) {
    if (dx === 0 && dy === 0) continue;
    const [lx, ly] = toLocal(t.m, dx, dy);
    for (const c of t.coords) {
      const d = c.axis === "x" ? lx : ly;
      edits.push({ start: c.start, end: c.end, text: c.values.map((v) => shortNumber(v + d, decimals)).join(" ") });
    }
    const nameEnd = t.start + /^<[^\s>/]+/.exec(svg.slice(t.start, t.tagEnd))![0].length;
    for (const [axis, d] of [["x", lx], ["y", ly]] as const) {
      if (!t.coords.some((c) => c.axis === axis)) {
        edits.push({ start: nameEnd, end: nameEnd, text: ` ${axis}="${shortNumber(d, decimals)}"` });
      }
    }
  }
  edits.sort((p, q) => q.start - p.start || q.end - p.end);
  let out = svg;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}
