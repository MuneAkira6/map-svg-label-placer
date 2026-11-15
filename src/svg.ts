// Read obstacles out of an SVG: stroked lines, solid boxes, circles and the SVG's own text.
//
// A regex tokenizer instead of DOMParser: it runs the same in Node and in a Web Worker (neither has
// DOMParser), and it keeps the source offsets that rewriting <text> positions in place will need.
// Ported from parse_svg() in reference/python/map_place_labels.py.

import { IDENT, apply, isIdent, matAngle, matMul, matScale, parseTransform, NUM_SRC, numbersIn } from "./geometry.js";
import type { Mat, Pt, Ring } from "./geometry.js";
import { pathSubpaths } from "./path.js";
import { pyLen } from "./py.js";

export type Seg = { x1: number; y1: number; x2: number; y2: number; hw: number };
/** Axis-aligned box: x0, y0, x1, y1 */
export type Rect = [number, number, number, number];
/** Rotated box: centre, half width, half height, angle (radians) */
export type OBox = [number, number, number, number, number];
export type Circle = [number, number, number];

export type Obstacles = {
  segs: Seg[];
  rects: Rect[];
  oboxes: OBox[];
  circles: Circle[];
  /** Geometry of every path, line, polyline, polygon and rect with an id, transformed, drawn or not. */
  geoms: Map<string, Ring[]>;
  warnings: string[];
};

export type SvgReadOptions = {
  /** Ids of filled areas that labels may cover (built-up areas, lakes). */
  areaIds: readonly string[];
  /** Rects smaller than this in both directions are solid obstacles; larger ones count only by their outline. */
  rectMax: number;
  /** Width of one character of the SVG's own text, in em. */
  textCharEm: number;
  /** How far below the baseline the SVG's own text reaches, in px. */
  textDescent: number;
};

const TAG_RE = new RegExp(
  String.raw`<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>` +
    String.raw`|<(\/?)([A-Za-z][\p{L}\p{N}_:.\-]*)((?:\s+[^\s=>\/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>`,
  "gu",
);
const ATTR_RE = /([^\s=>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu;
const NUM_AT_START = new RegExp(String.raw`^\s*(${NUM_SRC})`);
const NON_RENDER = new Set([
  "defs", "clipPath", "mask", "symbol", "pattern", "marker", "linearGradient", "radialGradient",
  "filter", "title", "desc", "metadata", "style", "script",
]);
const INHERIT = [
  "stroke", "stroke-width", "fill", "font-size", "text-anchor", "visibility",
  "font-family", "font-weight", "font-style", "letter-spacing",
] as const;

/** Python str.strip() whitespace. */
const PY_WS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const STRIP_RE = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, "g");
export function pyStrip(s: string): string {
  return s.replace(STRIP_RE, "");
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: "\u00a0", deg: "°", middot: "·", ndash: "–", mdash: "—", minus: "−", times: "×", copy: "©", prime: "′", Prime: "″",
};
// Python's html.unescape maps these C1 code points to Windows-1252 characters.
const CP1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
  0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
  0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178, 0x0d: 0x000d, 0x81: 0x81, 0x8d: 0x8d, 0x8f: 0x8f, 0x90: 0x90, 0x9d: 0x9d,
};
/** html._invalid_codepoints: control characters and non-characters, which Python drops. */
function invalidCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1 && cp <= 0x8) || cp === 0xb || (cp >= 0xe && cp <= 0x1f) || (cp >= 0x7f && cp <= 0x9f) ||
    (cp >= 0xfdd0 && cp <= 0xfdef) || (cp & 0xfffe) === 0xfffe
  );
}
const ENTITY_RE =/&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[A-Za-z][A-Za-z0-9]{0,31};)/g;

/**
 * Character references and the XML entities. Python's html.unescape also knows every HTML5 named entity;
 * only the few that appear in maps are listed here (HTML names are not valid XML without a DTD anyway).
 */
export function unescapeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(ENTITY_RE, (whole, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const digits = body.slice(hex ? 2 : 1).replace(/;$/, "");
      const cp = parseInt(digits, hex ? 16 : 10);
      if (cp in CP1252) return String.fromCodePoint(CP1252[cp]!);
      if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "\u{fffd}";
      if (invalidCodePoint(cp)) return "";
      return String.fromCodePoint(cp);
    }
    const v = NAMED[body.slice(0, -1)];
    return v ?? whole;
  });
}

/** Leading number of an attribute value ("12px" -> 12), or the default. */
export function num(s: string | undefined, dflt: number): number;
export function num(s: string | undefined, dflt?: number): number | undefined;
export function num(s: string | undefined, dflt?: number): number | undefined {
  const m = NUM_AT_START.exec(s ?? "");
  return m ? Number(m[1]) : dflt;
}

/** Attributes of one element, with style="…" declarations overriding them. */
export function elementAttrs(attrText: string): Map<string, string> {
  const a = new Map<string, string>();
  for (const m of attrText.matchAll(ATTR_RE)) {
    a.set(m[1]!, unescapeEntities((m[2] ?? "") || (m[3] ?? "")));
  }
  for (const decl of (a.get("style") ?? "").split(";")) {
    const i = decl.indexOf(":");
    if (i >= 0) a.set(pyStrip(decl.slice(0, i)), pyStrip(decl.slice(i + 1)));
  }
  return a;
}

type Ctx = {
  tag: string | null;
  m: Mat;
  inh: Map<string, string>;
  hidden: boolean;
  nonrender: boolean;
  ids: string[];
  switchAt: number | null;
};

/** One start tag, with what it inherits from its ancestors. */
export type SvgElement = {
  /** Tag name without namespace prefix. */
  local: string;
  /** Own attributes, style="…" declarations applied, entities decoded. */
  attrs: Map<string, string>;
  /** From the element's own coordinates to the root's, including its own transform. */
  m: Mat;
  /** The same without the element's own transform. */
  parentM: Mat;
  /** Inherited presentation attributes (stroke, fill, font-size, text-anchor, …). */
  inh: Map<string, string>;
  hidden: boolean;
  /** Inside <defs>, <clipPath>, <mask>, <symbol>, … */
  nonrender: boolean;
  /** Offsets of the start tag in the source string. */
  start: number;
  tagEnd: number;
  /** Ids of the ancestors, outermost first. */
  ancestors: string[];
  /** Offset of the nearest enclosing <switch>, if any. */
  switchAt: number | null;
  /** For <text>: offset of its "</text>" (tagEnd if none), and its content trimmed and unescaped. */
  textEnd: number;
  content: string;
};

/**
 * Every start tag in document order. Elements inside a <text> are not visited (the text is read as a whole).
 * Closing tags pop the context only when they match the innermost open element, as in the Python version.
 */
export function* walkSvg(svg: string): Generator<SvgElement> {
  const stack: Ctx[] = [{ tag: null, m: IDENT, inh: new Map(), hidden: false, nonrender: false, ids: [], switchAt: null }];
  let pos = 0;
  for (const mt of svg.matchAll(TAG_RE)) {
    const tag = mt[2];
    if (mt.index < pos || tag === undefined) continue;
    const closing = mt[1];
    const attrText = mt[3] ?? "";
    const selfclose = mt[4];
    const local = tag.split(":").pop()!;
    if (closing) {
      if (stack.length > 1 && stack[stack.length - 1]!.tag === local) stack.pop();
      continue;
    }
    const parent = stack[stack.length - 1]!;
    const a = elementAttrs(attrText);
    const m = a.has("transform") ? matMul(parent.m, parseTransform(a.get("transform"))) : parent.m;
    const inh = new Map(parent.inh);
    for (const k of INHERIT) {
      const v = a.get(k);
      if (v !== undefined) inh.set(k, v);
    }
    const vis = inh.get("visibility");
    const hidden = parent.hidden || a.get("display") === "none" || vis === "hidden" || vis === "collapse";
    const nonrender = parent.nonrender || NON_RENDER.has(local);
    const id = a.get("id");
    const ids = id === undefined ? parent.ids : [...parent.ids, id];
    const switchAt = local === "switch" ? mt.index : parent.switchAt;
    if (!selfclose && local !== "text") stack.push({ tag: local, m, inh, hidden, nonrender, ids, switchAt });
    const tagEnd = mt.index + mt[0].length;
    let textEnd = tagEnd;
    let content = "";
    if (local === "text") {
      if (!selfclose) {
        textEnd = svg.indexOf("</text>", tagEnd);
        if (textEnd < 0) textEnd = tagEnd;
        content = pyStrip(unescapeEntities(svg.slice(tagEnd, textEnd).replace(/<[^>]*>/g, "")));
      }
      pos = textEnd;
    }
    yield {
      local, attrs: a, m, parentM: parent.m, inh, hidden, nonrender, start: mt.index, tagEnd,
      ancestors: parent.ids, switchAt: parent.switchAt, textEnd, content,
    };
  }
}

export function parseSvg(svg: string, opts: SvgReadOptions): Obstacles {
  const segs: Seg[] = [];
  const rects: Rect[] = [];
  const oboxes: OBox[] = [];
  const circles: Circle[] = [];
  const geoms = new Map<string, Ring[]>();
  const warnings: string[] = [];
  const warn = (msg: string) => {
    if (!warnings.includes(msg)) warnings.push(msg);
  };
  const areaIds = new Set(opts.areaIds);

  for (const el of walkSvg(svg)) {
    const { local, attrs: a, m, inh, hidden, nonrender } = el;
    const active = !hidden && !nonrender;
    const stroke = inh.get("stroke") ?? "none";
    const stroked = !["none", "transparent", ""].includes(stroke);
    const sw = num(inh.get("stroke-width"), 1.0) * matScale(m);
    const filled = !["none", "transparent", ""].includes(inh.get("fill") ?? "black");
    const id = a.get("id");

    let sub: Ring[] | null = null;
    if (local === "path") {
      sub = pathSubpaths(a.get("d") ?? "", warn);
    } else if (local === "line") {
      const p1: Pt = [num(a.get("x1"), 0.0), num(a.get("y1"), 0.0)];
      const p2: Pt = [num(a.get("x2"), 0.0), num(a.get("y2"), 0.0)];
      sub = [{ pts: [p1, p2], closed: false }];
    } else if (local === "polyline" || local === "polygon") {
      const v = numbersIn(a.get("points") ?? "");
      const pts: Pt[] = [];
      for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i]!, v[i + 1]!]);
      sub = [{ pts, closed: local === "polygon" }];
    }
    if (sub !== null) {
      sub = sub.map(({ pts, closed }) => ({ pts: pts.map(([x, y]) => apply(m, x, y)), closed }));
      if (id !== undefined) geoms.set(id, sub);
      if (active && stroked && !(id !== undefined && areaIds.has(id))) {
        for (const { pts, closed } of sub) {
          const first = pts[0];
          const last = pts[pts.length - 1];
          const ring =
            closed && pts.length > 2 && (last![0] !== first![0] || last![1] !== first![1]) ? [...pts, first!] : pts;
          for (let i = 0; i + 1 < ring.length; i++) {
            const p = ring[i]!;
            const q = ring[i + 1]!;
            segs.push({ x1: p[0], y1: p[1], x2: q[0], y2: q[1], hw: sw / 2 });
          }
        }
      }
      continue;
    }
    if (local === "rect") {
      if (((a.get("width") ?? "") + (a.get("height") ?? "")).includes("%")) continue; // width="100%": background
      const x = num(a.get("x"), 0.0);
      const y = num(a.get("y"), 0.0);
      const w = num(a.get("width"), 0.0);
      const h = num(a.get("height"), 0.0);
      const corners = ([[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as const).map(([px, py]) => apply(m, px, py));
      if (id !== undefined) geoms.set(id, [{ pts: corners, closed: true }]);
      if (!active || !(filled || stroked) || (id !== undefined && areaIds.has(id))) continue;
      const sc = matScale(m);
      const pad = stroked ? sw / 2 : 0.0;
      if (w * sc < opts.rectMax && h * sc < opts.rectMax) {
        if (m[1] === 0 && m[2] === 0 && m[0] > 0 && m[3] > 0) {
          const [x0, y0] = corners[0]!;
          const [x1, y1] = corners[2]!;
          rects.push([x0 - pad, y0 - pad, x1 + pad, y1 + pad]);
        } else {
          const [ccx, ccy] = apply(m, x + w / 2, y + h / 2);
          oboxes.push([ccx, ccy, (w * sc) / 2 + pad, (h * sc) / 2 + pad, matAngle(m)]);
        }
      } else if (stroked) {
        const ring = [...corners, corners[0]!];
        for (let i = 0; i + 1 < ring.length; i++) {
          const p = ring[i]!;
          const q = ring[i + 1]!;
          segs.push({ x1: p[0], y1: p[1], x2: q[0], y2: q[1], hw: sw / 2 });
        }
      }
      continue;
    }
    if (local === "circle" || local === "ellipse") {
      if (!active || !(filled || stroked)) continue;
      const r = local === "circle" ? num(a.get("r"), 0.0) : Math.max(num(a.get("rx"), 0.0), num(a.get("ry"), 0.0));
      const [ccx, ccy] = apply(m, num(a.get("cx"), 0.0), num(a.get("cy"), 0.0));
      circles.push([ccx, ccy, r * matScale(m) + (stroked ? sw / 2 : 0.0)]);
      continue;
    }
    if (local === "text") {
      const content = el.content;
      if (!active || !content) continue;
      const fs = num(inh.get("font-size"), 16.0);
      const tx = num(a.get("x"), 0.0);
      const ty = num(a.get("y"), 0.0);
      const w = pyLen(content) * fs * opts.textCharEm;
      const anchor = inh.get("text-anchor") ?? "start";
      const x0 = anchor === "middle" ? tx - w / 2 : anchor === "end" ? tx - w : tx;
      const y0 = ty - fs;
      const y1 = ty + opts.textDescent;
      if (isIdent(m)) {
        rects.push([x0, y0, x0 + w, y1]);
      } else {
        const sc = matScale(m);
        const [ccx, ccy] = apply(m, x0 + w / 2, (y0 + y1) / 2);
        oboxes.push([ccx, ccy, (w * sc) / 2, ((y1 - y0) * sc) / 2, matAngle(m)]);
      }
      continue;
    }
    if ((local === "use" || local === "image") && active) {
      warn(`<${local}> is not read (lines and text inside it are not obstacles)`);
    }
  }
  return { segs, rects, oboxes, circles, geoms, warnings };
}
