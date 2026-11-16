// The part of CSS that SVG maps on Commons actually use: <style> rules with simple selectors (.class, text,
// #id, text.class, lists of these), declarations in style="…", the font shorthand, and font-size units.
// In a sample of 358 Commons maps, 39 had a <style>; their selectors were all of this kind.

export type Decl = { prop: string; value: string; important: boolean };

/** A compound selector: optional type, then any number of classes and ids. */
type Simple = { type: string | null; ids: string[]; classes: string[] };
type Rule = { sel: Simple; specificity: number; order: number; decls: Decl[] };

export type StyleSheet = {
  rules: Rule[];
  /** Selectors with combinators, pseudo-classes or attributes, which are not applied. */
  skipped: string[];
};

const STYLE_RE = /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/g;
const NAME = String.raw`(?:[\p{L}\p{N}_-]|\\.)+`;
const SIMPLE_RE = new RegExp(String.raw`^(\*|[A-Za-z][\w-]*)?((?:[.#]${NAME})*)$`, "u");
const PART_RE = new RegExp(String.raw`([.#])(${NAME})`, "gu");

const unescapeCss = (s: string) => s.replace(/\\(.)/g, "$1");

/** Split on `sep` outside quotes and parentheses. */
export function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** "a: b; c: d !important" -> declarations, in order. */
export function parseDecls(body: string): Decl[] {
  const out: Decl[] = [];
  for (const part of splitTopLevel(body, ";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    let value = part.slice(i + 1).trim();
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, "").trim();
    if (prop) out.push({ prop, value, important });
  }
  return out;
}

/** Index of the "}" closing the block opened at `open`, or the end of the text. */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return i;
  }
  return css.length;
}

function parseCss(css: string, rules: Rule[], skipped: string[]): void {
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) return;
    const head = css.slice(i, open).trim();
    if (head.startsWith("@")) {
      // @font-face, @media, @keyframes, …: not applied. A statement at-rule (@import …;) ends at ";".
      const semi = css.indexOf(";", i);
      i = semi >= 0 && semi < open ? semi + 1 : blockEnd(css, open) + 1;
      continue;
    }
    const close = css.indexOf("}", open);
    const end = close < 0 ? css.length : close;
    const decls = parseDecls(css.slice(open + 1, end));
    for (const raw of head.split(",")) {
      const sel = raw.trim();
      if (!sel) continue;
      const m = SIMPLE_RE.exec(sel);
      if (!m) {
        if (!skipped.includes(sel)) skipped.push(sel);
        continue;
      }
      const ids: string[] = [];
      const classes: string[] = [];
      for (const p of (m[2] ?? "").matchAll(PART_RE)) (p[1] === "#" ? ids : classes).push(unescapeCss(p[2]!));
      const type = m[1] && m[1] !== "*" ? m[1] : null;
      rules.push({
        sel: { type, ids, classes },
        specificity: ids.length * 10000 + classes.length * 100 + (type ? 1 : 0),
        order: rules.length,
        decls,
      });
    }
    i = end + 1;
  }
}

let cached: { svg: string; sheet: StyleSheet } | null = null;

/** Every <style> element of the document (type text/css or none), in document order. */
export function readStyleSheet(svg: string, unescape: (s: string) => string): StyleSheet {
  if (cached?.svg === svg) return cached.sheet;
  const rules: Rule[] = [];
  const skipped: string[] = [];
  if (svg.includes("<style")) {
    for (const m of svg.matchAll(STYLE_RE)) {
      const type = /\btype\s*=\s*["']([^"']*)["']/.exec(m[1] ?? "")?.[1];
      if (type && type.trim().toLowerCase() !== "text/css") continue;
      let css = m[2] ?? "";
      css = css.includes("<![CDATA[")
        ? css.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        : unescape(css);
      css = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--|-->/g, "");
      parseCss(css, rules, skipped);
    }
  }
  const sheet = { rules, skipped };
  cached = { svg, sheet };
  return sheet;
}

/** Declarations of the rules matching an element, in cascade order (normal ones, then !important ones). */
export function matchingDecls(sheet: StyleSheet, local: string, id: string | undefined, cls: string | undefined): Decl[] {
  if (sheet.rules.length === 0) return [];
  const classes = cls ? cls.split(/\s+/).filter(Boolean) : [];
  const hits = sheet.rules.filter(
    ({ sel }) =>
      (sel.type === null || sel.type === local) &&
      sel.ids.every((x) => x === id) &&
      sel.classes.every((c) => classes.includes(c)),
  );
  if (hits.length === 0) return [];
  hits.sort((p, q) => p.specificity - q.specificity || p.order - q.order);
  const decls = hits.flatMap((r) => r.decls);
  return [...decls.filter((d) => !d.important), ...decls.filter((d) => d.important)];
}

const FONT_SIZE_RE = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*([a-zA-Z%]*)$/;
// CSS absolute sizes (medium = 16px), as librsvg resolves them.
const SIZE_KEYWORDS: Record<string, number> = {
  "xx-small": 9, "x-small": 10, small: 13, medium: 16, large: 18, "x-large": 24, "xx-large": 32,
};

/** A length in px. em, ex and % are relative to `fontSize`. Undefined when it is not a length. */
export function lengthPx(value: string | undefined, fontSize: number): number | undefined {
  const m = FONT_SIZE_RE.exec((value ?? "").trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  switch (m[2]!.toLowerCase()) {
    case "": case "px": return n;
    case "pt": return (n * 4) / 3;
    case "pc": return n * 16;
    case "in": return n * 96;
    case "cm": return (n * 96) / 2.54;
    case "mm": return (n * 96) / 25.4;
    case "em": case "rem": return n * fontSize;
    case "ex": return (n * fontSize) / 2;
    case "%": return (n * fontSize) / 100;
    default: return undefined;
  }
}

/** Computed font-size in px, given the parent's. */
export function fontSizePx(value: string | undefined, parent: number): number {
  if (value === undefined) return parent;
  const v = value.trim().toLowerCase();
  if (v in SIZE_KEYWORDS) return SIZE_KEYWORDS[v]!;
  if (v === "larger") return parent * 1.2;
  if (v === "smaller") return parent / 1.2;
  const px = lengthPx(v, parent);
  return px === undefined || px < 0 ? parent : px;
}

const WEIGHTS = new Set(["bold", "bolder", "lighter", "100", "200", "300", "400", "500", "600", "700", "800", "900"]);
const STYLES = new Set(["italic", "oblique"]);
const FONT_SIZE_TOKEN = /^(?:[-+]?(?:\d+\.?\d*|\.\d+)[a-zA-Z%]*|xx-small|x-small|small|medium|large|x-large|xx-large|larger|smaller)(?:\/\S+)?$/;

/** The font shorthand ("bold 12px Arial, sans-serif") -> font-style, font-weight, font-size, font-family. */
export function expandFont(value: string): [string, string][] | null {
  const tokens = value.trim().split(/\s+/);
  const out: [string, string][] = [["font-style", "normal"], ["font-weight", "normal"]];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!.toLowerCase();
    if (FONT_SIZE_TOKEN.test(t)) {
      const family = tokens.slice(i + 1).join(" ");
      if (!family) return null;
      out.push(["font-size", tokens[i]!.split("/")[0]!], ["font-family", family]);
      return out;
    }
    if (WEIGHTS.has(t)) out[1] = ["font-weight", t];
    else if (STYLES.has(t)) out[0] = ["font-style", t];
  }
  return null;
}
