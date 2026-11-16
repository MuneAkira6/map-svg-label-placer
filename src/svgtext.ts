// The <text> elements already in an SVG: read them with their source positions, and move them by rewriting
// only the numbers in their x and y attributes (and those of their <tspan>s). Every other byte stays as it was.
//
// Each text is also read character by character, the way a renderer lays it out: font settings of every
// <tspan> (from attributes, style="…" and <style> rules), x, y, dx and dy lists, and xml:space.

import { fontSizePx, lengthPx, readStyleSheet, type StyleSheet } from "./css.js";
import type { Mat } from "./geometry.js";
import { TAG_RE, elementAttrs, inherit, num, unescapeEntities, walkSvg, type SvgElement } from "./svg.js";

/** A span of the source holding the value of an x or y attribute. */
export type CoordSpan = { axis: "x" | "y"; start: number; end: number; values: number[] };

export type Anchor = "start" | "middle" | "end";

/** Computed font settings of one character. */
export type CharStyle = {
  /** px */
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  /** px */
  letterSpacing: number;
  anchor: Anchor;
};

/** One character as laid out: absolute x / y where the SVG gives one, and the dx / dy before it. */
export type TextChar = { ch: string; style: CharStyle; x?: number; y?: number; dx: number; dy: number };

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
  /** letter-spacing as written ("normal", "2px", "0.1em"), if any. */
  letterSpacing: string | undefined;
  /** Has a <textPath>: in a browser it is laid out along the path; librsvg (Commons) does not draw it. */
  onPath: boolean;
  anchor: Anchor;
  /** writing-mode is top to bottom (tb, tb-rl, vertical-rl, …). */
  vertical: boolean;
  /** The characters that are drawn, after xml:space handling, with their positions and fonts. */
  chars: TextChar[];
  /** Not drawn: hidden, or inside <defs> and the like. */
  hidden: boolean;
  /** Ids of the ancestors, outermost first (e.g. a "legend" group). */
  ancestors: string[];
  /** Offset of the enclosing <switch>, if any. */
  switchAt: number | null;
  /** The child of that <switch> holding the text: the text itself, or a group of texts in one language. */
  altAt: number | null;
  /** systemLanguage of the text, or of the <switch> child holding it. */
  lang: string | undefined;
  /** Every x / y value that moves with the text: its own and its <tspan>s'. */
  coords: CoordSpan[];
};

const VERTICAL = new Set(["tb", "tb-rl", "tb-lr", "vertical-rl", "vertical-lr"]);
/**
 * Elements inside <text> whose characters librsvg draws (children_to_chunks in rsvg/src/text.rs); the content
 * of any other element is not drawn. That includes <textPath>, which librsvg does not support (T11420).
 */
const TEXT_CONTENT = new Set(["tspan", "a"]);

function anchorOf(v: string | undefined): Anchor {
  const a = v?.trim();
  return a === "middle" || a === "end" ? a : "start";
}

function styleOf(inh: ReadonlyMap<string, string>, fontSize: number): CharStyle {
  const ls = inh.get("letter-spacing");
  return {
    fontSize,
    fontFamily: inh.get("font-family") ?? "",
    fontWeight: inh.get("font-weight") ?? "normal",
    letterSpacing: !ls || ls.trim() === "normal" ? 0 : lengthPx(ls, fontSize) ?? num(ls, 0),
    anchor: anchorOf(inh.get("text-anchor")),
  };
}

/** One element inside <text>, and how many characters it has consumed from its position lists. */
type Frame = {
  xs: number[];
  ys: number[];
  dxs: number[];
  dys: number[];
  n: number;
  inh: Map<string, string>;
  fontSize: number;
  style: CharStyle;
  preserve: boolean;
  drawn: boolean;
  /** This frame and its ancestors, outermost first. */
  path: Frame[];
};

function lengths(v: string | undefined, fontSize: number): number[] {
  if (!v) return [];
  const out: number[] = [];
  for (const part of v.trim().split(/[\s,]+/)) {
    const px = lengthPx(part, fontSize);
    if (px === undefined) break;
    out.push(px);
  }
  return out;
}

function frameOf(a: ReadonlyMap<string, string>, inh: Map<string, string>, fontSize: number, parent: Frame | null, drawn: boolean): Frame {
  const f: Frame = {
    xs: lengths(a.get("x"), fontSize),
    ys: lengths(a.get("y"), fontSize),
    dxs: lengths(a.get("dx"), fontSize),
    dys: lengths(a.get("dy"), fontSize),
    n: 0,
    inh,
    fontSize,
    style: styleOf(inh, fontSize),
    preserve: (inh.get("xml:space") ?? "").trim() === "preserve",
    drawn,
    path: [],
  };
  f.path = parent ? [...parent.path, f] : [f];
  return f;
}

/** The drawn characters of a <text>, positioned as SVG 1.1 §10.4–10.5 describe. */
function readChars(svg: string, el: SvgElement, sheet: StyleSheet): TextChar[] {
  const raw: { ch: string; frame: Frame }[] = [];
  const root = frameOf(el.attrs, el.inh, el.fontSize, null, true);
  const stack: { local: string; frame: Frame }[] = [{ local: "text", frame: root }];
  const pushText = (s: string) => {
    const frame = stack[stack.length - 1]!.frame;
    if (frame.drawn) for (const ch of s) raw.push({ ch, frame });
  };
  let last = el.tagEnd;
  const inner = svg.slice(el.tagEnd, el.textEnd);
  for (const mt of inner.matchAll(TAG_RE)) {
    pushText(unescapeEntities(inner.slice(last - el.tagEnd, mt.index)));
    last = el.tagEnd + mt.index + mt[0].length;
    if (mt[0].startsWith("<![CDATA[")) {
      pushText(mt[0].slice(9, -3));
      continue;
    }
    const tag = mt[2];
    if (tag === undefined) continue;
    const local = tag.split(":").pop()!;
    if (mt[1]) {
      if (stack.length > 1 && stack[stack.length - 1]!.local === local) stack.pop();
      continue;
    }
    if (mt[4]) continue; // <tspan/>: no characters
    const parent = stack[stack.length - 1]!.frame;
    const a = elementAttrs(mt[3] ?? "", local, sheet);
    const inh = inherit(parent.inh, a);
    const drawn = parent.drawn && TEXT_CONTENT.has(local) && a.get("display") !== "none";
    stack.push({ local, frame: frameOf(a, inh, fontSizePx(a.get("font-size"), parent.fontSize), parent, drawn) });
  }
  pushText(unescapeEntities(inner.slice(last - el.tagEnd)));

  // xml:space="default": newlines removed, tabs made spaces, leading, trailing and repeated spaces dropped.
  const kept: { ch: string; frame: Frame }[] = [];
  for (const { ch, frame } of raw) {
    if (frame.preserve) {
      kept.push({ ch: ch === "\n" || ch === "\r" || ch === "\t" ? " " : ch, frame });
      continue;
    }
    if (ch === "\n" || ch === "\r") continue;
    const c = ch === "\t" ? " " : ch;
    if (c === " " && (kept.length === 0 || kept[kept.length - 1]!.ch === " ")) continue;
    kept.push({ ch: c, frame });
  }
  while (kept.length && kept[kept.length - 1]!.ch === " " && !kept[kept.length - 1]!.frame.preserve) kept.pop();

  // Position lists: the innermost element that still has a value for this character gives it.
  return kept.map(({ ch, frame }) => {
    const pick = (list: "xs" | "ys" | "dxs" | "dys") => {
      for (let k = frame.path.length - 1; k >= 0; k--) {
        const f = frame.path[k]!;
        if (f.n < f[list].length) return f[list][f.n];
      }
      return undefined;
    };
    const c: TextChar = { ch, style: frame.style, dx: pick("dxs") ?? 0, dy: pick("dys") ?? 0 };
    const x = pick("xs");
    const y = pick("ys");
    if (x !== undefined) c.x = x;
    if (y !== undefined) c.y = y;
    for (const f of frame.path) f.n++;
    return c;
  });
}

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
  const sheet = readStyleSheet(svg, unescapeEntities);
  for (const el of walkSvg(svg)) {
    if (el.local !== "text") continue;
    const coords = coordSpans(svg, el.start, el.tagEnd);
    for (const t of el.textEnd > el.tagEnd ? svg.slice(el.tagEnd, el.textEnd).matchAll(TSPAN_RE) : []) {
      const s = el.tagEnd + t.index;
      coords.push(...coordSpans(svg, s, s + t[0].length));
    }
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
      fontSize: el.fontSize,
      fontFamily: el.inh.get("font-family") ?? "",
      fontWeight: el.inh.get("font-weight") ?? "normal",
      letterSpacing: el.inh.get("letter-spacing"),
      onPath: /<textPath\b/.test(svg.slice(el.tagEnd, el.textEnd)),
      anchor: anchorOf(el.inh.get("text-anchor")),
      vertical: VERTICAL.has((el.inh.get("writing-mode") ?? "").trim()),
      chars: readChars(svg, el, sheet),
      hidden: el.hidden || el.nonrender,
      ancestors: el.ancestors,
      switchAt: el.switchAt,
      altAt: el.alt?.at ?? null,
      lang: el.attrs.get("systemLanguage") ?? el.alt?.lang,
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
