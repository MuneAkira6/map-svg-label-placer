// Where the characters of a <text> end up, measured with the fonts Commons renders with.
// Characters are grouped into text chunks (a new chunk starts at every absolute x or y, e.g. every line of a
// multi-line label); text-anchor shifts each chunk by its own advance.

import { measureText } from "./fonts.js";
import type { SvgText, TextChar } from "./svgtext.js";

/** [left, top, right, bottom] in the text's own coordinates. */
export type Box = [number, number, number, number];

export type TextLayout = {
  /** Union of the chunk boxes, or null when nothing is drawn. */
  box: Box | null;
  /** One box per text chunk (per line, for a label of several lines). */
  chunks: Box[];
};

const isWide = (ch: string) => ch.codePointAt(0)! >= 0x2e80;

function measure(c: TextChar) {
  const s = c.style;
  return measureText(c.ch, { fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, letterSpacing: s.letterSpacing });
}

type Item = { x: number; y: number; adv: number; up: number; down: number };
type Chunk = { anchor: SvgText["anchor"]; start: number; end: number; items: Item[] };

export function layoutText(t: Pick<SvgText, "chars" | "vertical">): TextLayout {
  const vertical = t.vertical;
  const chunks: Chunk[] = [];
  let px = 0;
  let py = 0;
  let cur: Chunk | null = null;
  for (const c of t.chars) {
    if (c.x !== undefined) px = c.x;
    if (c.y !== undefined) py = c.y;
    if (cur === null || c.x !== undefined || c.y !== undefined) {
      cur = { anchor: c.style.anchor, start: vertical ? py : px, end: 0, items: [] };
      chunks.push(cur);
    }
    px += c.dx;
    py += c.dy;
    const m = measure(c);
    if (vertical) {
      // Top to bottom, as librsvg draws it: ideographs upright (1 em each), other characters turned sideways.
      const adv = isWide(c.ch) ? c.style.fontSize + c.style.letterSpacing : m.width;
      const half = c.style.fontSize / 2;
      cur.items.push({ x: px - half, y: py, adv: c.style.fontSize, up: 0, down: adv });
      py += adv;
    } else {
      cur.items.push({ x: px, y: py, adv: m.width, up: m.ascent, down: m.descent });
      px += m.width;
    }
    cur.end = vertical ? py : px;
  }

  const boxes: Box[] = [];
  for (const ch of chunks) {
    const len = ch.end - ch.start;
    const shift = ch.anchor === "middle" ? -len / 2 : ch.anchor === "end" ? -len : 0;
    let b: Box | null = null;
    for (const it of ch.items) {
      const [l, tp, r, bt]: Box = vertical
        ? [it.x, it.y + shift, it.x + it.adv, it.y + it.down + shift]
        : [it.x + shift, it.y - it.up, it.x + it.adv + shift, it.y + it.down];
      b = b ? [Math.min(b[0], l), Math.min(b[1], tp), Math.max(b[2], r), Math.max(b[3], bt)] : [l, tp, r, bt];
    }
    if (b) boxes.push(b);
  }
  let box: Box | null = null;
  for (const b of boxes) {
    box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : [...b];
  }
  return { box, chunks: boxes };
}
