// A copy of a map for a browser to draw the way Commons does: every font-family is replaced by the font Commons
// would use for it, so the page can supply that font. Only for showing; the copy is not meant to be saved.

import { resolveFont } from "./fonts.js";
import { walkSvg } from "./svg.js";
import { langMatches } from "./textgroups.js";

export type CommonsFace = {
  family: "Noto Sans" | "Noto Serif" | "Liberation Sans" | "Liberation Serif" | "DejaVu Sans" | "DejaVu Serif";
  weight: 400 | 700;
  style: "normal" | "italic";
  /** File name of the font in the page's fonts folder. */
  file: string;
};

const FILES: Record<CommonsFace["family"], (bold: boolean, italic: boolean) => string> = {
  "Noto Sans": (b, i) => `NotoSans-${b ? (i ? "BoldItalic" : "Bold") : i ? "Italic" : "Regular"}.woff2`,
  "Noto Serif": (b, i) => `NotoSerif-${b ? (i ? "BoldItalic" : "Bold") : i ? "Italic" : "Regular"}.woff2`,
  "Liberation Sans": (b, i) => `LiberationSans-${b ? (i ? "BoldItalic" : "Bold") : i ? "Italic" : "Regular"}.ttf`,
  "Liberation Serif": (b, i) => `LiberationSerif-${b ? (i ? "BoldItalic" : "Bold") : i ? "Italic" : "Regular"}.ttf`,
  // DejaVu Sans and Serif come without italics in Debian's fonts-dejavu-core; the browser slants them.
  "DejaVu Sans": (b) => (b ? "DejaVuSans-Bold.woff2" : "DejaVuSans.woff2"),
  "DejaVu Serif": (b) => (b ? "DejaVuSerif-Bold.woff2" : "DejaVuSerif.woff2"),
};

const BOLD = /font-weight\s*[:=]\s*["']?\s*(?:bold|bolder|[6-9]00)\b/i;
const ITALIC = /font-style\s*[:=]\s*["']?\s*(?:italic|oblique)\b/i;

/**
 * Replace each font-family with the font Commons draws it in (Arial becomes Liberation Sans, sans-serif Noto Sans),
 * give the root the default family librsvg uses, and list the font files needed. CJK families are left alone.
 */
export function commonsFonts(svg: string): { svg: string; faces: CommonsFace[] } {
  const used = new Set<CommonsFace["family"]>();
  const swap = (value: string): string => {
    const f = resolveFont(value.replace(/&quot;|&apos;|&#3[49];/g, "'"));
    if (f.primary === "cjk" || f.primary === "WenQuanYi Zen Hei") return value;
    used.add(f.primary);
    return f.primary;
  };
  let out = svg
    .replace(/(\sfont-family\s*=\s*)(?:"([^"]*)"|'([^']*)')/g, (_, pre: string, d?: string, s?: string) =>
      d !== undefined ? `${pre}"${swap(d)}"` : `${pre}'${swap(s!)}'`,
    )
    .replace(/(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')/g, (_, pre: string, d?: string, s?: string) => {
      const q = d !== undefined ? '"' : "'";
      const v = d ?? s!;
      return `${pre}${q}${v.replace(/(font-family\s*:\s*)([^;]+)/g, (_m: string, p: string, f: string) => p + swap(f))}${q}`;
    })
    .replace(/(<(?:[\w.-]+:)?style\b[^>]*>)([\s\S]*?)(<\/(?:[\w.-]+:)?style\s*>)/g, (_, open: string, css: string, close: string) =>
      open + css.replace(/(font-family\s*:\s*)([^;}]+)/g, (_m: string, p: string, f: string) => p + swap(f)) + close,
    );
  for (const el of walkSvg(out)) {
    if (el.local !== "svg") continue;
    if (!el.attrs.has("font-family")) {
      const at = out.slice(el.start, el.tagEnd).search(/\s|\/?>/) + el.start;
      out = `${out.slice(0, at)} font-family="Liberation Serif"${out.slice(at)}`;
      used.add("Liberation Serif");
    }
    break;
  }
  const weights: (400 | 700)[] = BOLD.test(svg) ? [400, 700] : [400];
  const styles: ("normal" | "italic")[] = ITALIC.test(svg) ? ["normal", "italic"] : ["normal"];
  const faces: CommonsFace[] = [];
  for (const family of used) {
    for (const weight of weights) {
      for (const style of styles) faces.push({ family, weight, style, file: FILES[family](weight === 700, style === "italic") });
    }
  }
  return { svg: out, faces };
}

/** Put a <style> with these @font-face rules at the start of the root <svg>. `src` gives each face's URL. */
export function withFontFaces(svg: string, faces: readonly CommonsFace[], src: (face: CommonsFace) => string): string {
  if (faces.length === 0) return svg;
  const css = faces
    .map((f) => `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-style:${f.style};src:url(${src(f)})}`)
    .join("");
  for (const el of walkSvg(svg)) {
    if (el.local !== "svg") continue;
    const prefix = /^<([\w.-]+:)?svg/.exec(svg.slice(el.start))?.[1] ?? "";
    return `${svg.slice(0, el.tagEnd)}<${prefix}style>${css}</${prefix}style>${svg.slice(el.tagEnd)}`;
  }
  return svg;
}

const SYSTEM_LANGUAGE = /\ssystemLanguage\s*=\s*(?:"[^"]*"|'[^']*')/;

/**
 * A copy that a browser draws in the language Commons draws it in for `lang`, whatever the browser's own language.
 * In each <switch>, the version drawn is the first child whose systemLanguage matches, else the first child; that
 * child loses its systemLanguage and the children before it get one that matches no language. A systemLanguage
 * outside a <switch> is dropped: Commons draws such elements (a browser would hide them in another language).
 */
export function pinLanguage(svg: string, lang: string): string {
  const switches = new Map<number, { start: number; tagEnd: number; lang: string | undefined }[]>();
  const edits: { start: number; tagEnd: number; tag: string }[] = [];
  for (const el of walkSvg(svg)) {
    if (el.alt === null || el.alt.at !== el.start || el.switchAt === null) {
      if (el.attrs.has("systemLanguage")) {
        edits.push({ start: el.start, tagEnd: el.tagEnd, tag: svg.slice(el.start, el.tagEnd).replace(SYSTEM_LANGUAGE, "") });
      }
      continue;
    }
    switches.set(el.switchAt, [...(switches.get(el.switchAt) ?? []), { start: el.start, tagEnd: el.tagEnd, lang: el.alt.lang }]);
  }
  for (const kids of switches.values()) {
    const drawn = Math.max(0, kids.findIndex((k) => langMatches(k.lang, lang)));
    kids.slice(0, drawn + 1).forEach((k, i) => {
      const tag = svg.slice(k.start, k.tagEnd);
      const out = i === drawn ? tag.replace(SYSTEM_LANGUAGE, "") : tag.replace(SYSTEM_LANGUAGE, ' systemLanguage="x-none"');
      if (out !== tag) edits.push({ start: k.start, tagEnd: k.tagEnd, tag: out });
    });
  }
  edits.sort((p, q) => q.start - p.start);
  let out = svg;
  for (const e of edits) out = out.slice(0, e.start) + e.tag + out.slice(e.tagEnd);
  return out;
}
