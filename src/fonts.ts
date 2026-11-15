// Text width as Wikimedia Commons will render it: librsvg 2.60 + Pango + fontconfig on Debian trixie.
// Advance widths come from the same font files (src/fonts/metrics.json, made by scripts/font_metrics.py).
// Kerning is not applied; Pango does apply it, so Latin text can come out a little narrower than measured here.

import metrics from "./fonts/metrics.json" with { type: "json" };

type Face = {
  unitsPerEm: number;
  capHeight: number | null;
  descent: number | null;
  ideoTop: number | null;
  ideoBottom: number | null;
  runs: [number, number[]][];
  ideo: { advance: number; ranges: [number, number, number][]; exceptions: Record<string, number> } | null;
};
type FontName = keyof typeof metrics.fonts;

class FaceMetrics {
  private readonly adv = new Map<number, number>();
  constructor(readonly face: Face) {
    for (const [start, widths] of face.runs) widths.forEach((w, i) => this.adv.set(start + i, w));
  }
  /** Advance in em, or undefined when the font has no glyph for cp. */
  advance(cp: number): number | undefined {
    const a = this.adv.get(cp);
    if (a !== undefined) return a / this.face.unitsPerEm;
    const id = this.face.ideo;
    if (id && id.ranges.some(([lo, hi]) => cp >= lo && cp <= hi)) return (id.exceptions[cp] ?? id.advance) / this.face.unitsPerEm;
    return undefined;
  }
}

const faces = new Map<string, FaceMetrics>();
function faceOf(name: FontName, bold: boolean): FaceMetrics {
  const key = `${name}/${bold}`;
  let f = faces.get(key);
  if (!f) {
    const fam = metrics.fonts[name] as { regular: Face; bold: Face | null };
    f = new FaceMetrics((bold && fam.bold) || fam.regular);
    faces.set(key, f);
  }
  return f;
}

/** Family names as Commons resolves them (fontconfig aliases on Debian trixie, checked against Commons PNGs). */
const FAMILIES: Record<string, FontName> = {
  "sans-serif": "Noto Sans", "noto sans": "Noto Sans", fantasy: "Noto Sans", "system-ui": "Noto Sans",
  serif: "Noto Serif", "noto serif": "Noto Serif",
  "liberation sans": "Liberation Sans", arial: "Liberation Sans", arimo: "Liberation Sans",
  // Helvetica renders in Nimbus Sans, which has Helvetica's (and so Arial's) widths.
  helvetica: "Liberation Sans", "nimbus sans": "Liberation Sans", "nimbus sans l": "Liberation Sans",
  "liberation serif": "Liberation Serif", "times new roman": "Liberation Serif", times: "Liberation Serif", tinos: "Liberation Serif",
  "dejavu sans": "DejaVu Sans", "bitstream vera sans": "DejaVu Sans", "dejavu serif": "DejaVu Serif",
  "wenquanyi zen hei": "WenQuanYi Zen Hei", "wqy zen hei": "WenQuanYi Zen Hei", "文泉驛正黑": "WenQuanYi Zen Hei", "文泉驿正黑": "WenQuanYi Zen Hei",
};
/** CJK families on Commons whose ideographs are 1 em; other characters are taken from Noto Sans. */
const CJK_FAMILIES = /^(noto sans cjk|noto serif cjk|source han|ar pl |ipa|takao|vl gothic)/;

export function parseFontFamily(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim().replace(/^(['"])(.*)\1$/, "$2").trim().toLowerCase())
    .filter(Boolean);
}

export type ResolvedFont = { primary: FontName | "cjk"; name: string };

/** The font Commons uses for a font-family value. No value: librsvg's default "Times New Roman". */
export function resolveFont(fontFamily: string): ResolvedFont {
  const list = parseFontFamily(fontFamily);
  if (list.length === 0) return { primary: "Liberation Serif", name: "Liberation Serif" };
  for (const f of list) {
    if (FAMILIES[f]) return { primary: FAMILIES[f], name: FAMILIES[f] };
    if (CJK_FAMILIES.test(f)) return { primary: "cjk", name: f };
  }
  return { primary: "Noto Sans", name: "Noto Sans" };
}

export type TextStyle = {
  fontFamily: string;
  /** px */
  fontSize: number;
  fontWeight?: string;
  /** px, added after every character */
  letterSpacing?: number;
};

export type TextMetrics = {
  /** Advance width, px */
  width: number;
  /** Extent above and below the baseline, px (cap height or ideograph top; descender or ideograph bottom). */
  ascent: number;
  descent: number;
  /** Fonts the characters came from. */
  fonts: string[];
};

function isBold(weight: string | undefined): boolean {
  if (!weight) return false;
  if (weight === "bold" || weight === "bolder") return true;
  const n = Number(weight);
  return Number.isFinite(n) && n >= 600;
}

const isWide = (cp: number) => cp >= 0x2e80;

/** Width and vertical extent of one line of text. */
export function measureText(text: string, style: TextStyle): TextMetrics {
  const bold = isBold(style.fontWeight);
  const { primary } = resolveFont(style.fontFamily);
  const chain: FaceMetrics[] = [];
  const names: FontName[] = [];
  const add = (n: FontName) => {
    if (!names.includes(n)) {
      names.push(n);
      chain.push(faceOf(n, bold));
    }
  };
  if (primary === "cjk") {
    add("WenQuanYi Zen Hei");
    add("Noto Sans");
  } else {
    add(primary);
    add("Noto Sans");
    add("WenQuanYi Zen Hei");
  }
  let em = 0;
  let ascent = 0;
  let descent = 0;
  const used = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    let a: number | undefined;
    let i = 0;
    for (; i < chain.length; i++) {
      a = chain[i]!.advance(cp);
      if (a !== undefined) break;
    }
    if (a === undefined) {
      em += isWide(cp) ? 1 : 0.6;
      continue;
    }
    em += a;
    const face = chain[i]!.face;
    used.add(names[i]!);
    const wide = isWide(cp) && face.ideoTop !== null;
    const top = (wide ? face.ideoTop : face.capHeight) ?? face.unitsPerEm * 0.8;
    const bottom = (wide ? face.ideoBottom : face.descent) ?? face.unitsPerEm * 0.2;
    ascent = Math.max(ascent, top / face.unitsPerEm);
    descent = Math.max(descent, bottom / face.unitsPerEm);
  }
  const n = [...text].length;
  return {
    width: em * style.fontSize + n * (style.letterSpacing ?? 0),
    ascent: ascent * style.fontSize,
    descent: descent * style.fontSize,
    fonts: [...used],
  };
}
