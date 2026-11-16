// Which <text> elements make up one label on the map:
// - the language versions of a name inside a <switch> (only the one drawn for the render language is seen);
// - the lines of a name written as separate <text> elements, one under the other;
// - the letters of a word set one <text> per letter (along a curve, usually): these stay where they are.

import { apply, type Mat } from "./geometry.js";
import type { SvgText } from "./svgtext.js";
import type { Box } from "./textlayout.js";

export type TextUnit = {
  /** The texts that move together. The first is the one drawn in the render language. */
  texts: SvgText[];
  /** Union of their boxes, in the coordinates of texts[0]. */
  box: Box;
  /** Set when the unit cannot move. */
  reason?: string;
};

export type GroupResult = { units: TextUnit[]; warnings: string[] };

/** A systemLanguage value matches the render language exactly or as a prefix ("en" matches "en-GB"). */
export function langMatches(value: string | undefined, lang: string): boolean {
  if (value === undefined) return true;
  const want = lang.toLowerCase();
  return value.split(",").some((v) => {
    const l = v.trim().toLowerCase();
    return l === want || l.startsWith(`${want}-`);
  });
}

function invert(m: Mat): Mat {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** A box of `from` (in its coordinates) as an axis-aligned box in the coordinates of `to`. */
function boxIn(to: SvgText, from: SvgText, b: Box): Box {
  if (to.m.every((v, i) => v === from.m[i])) return b;
  const inv = invert(to.m);
  const pts = ([[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]] as const).map(([x, y]) => {
    const [rx, ry] = apply(from.m, x, y);
    return apply(inv, rx, ry);
  });
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const union = (p: Box, q: Box): Box => [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[2], q[2]), Math.max(p[3], q[3])];
const angleOf = (m: Mat) => Math.atan2(m[1], m[0]);
const scaleOf = (m: Mat) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
const fontSize = (t: SvgText) => t.chars.reduce((mx, c) => Math.max(mx, c.style.fontSize), 0) || t.fontSize;
const letters = (t: SvgText) => [...t.chars.map((c) => c.ch).join("").replace(/\s+/g, "")].length;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Id without its language suffix ("T_sea01-ca" -> "T_sea01"); a fallback layer may carry one too ("-en"). */
function stem(t: SvgText): string | undefined {
  if (t.id === undefined) return undefined;
  const suffix = t.lang ? escapeRe(t.lang) : "[a-z]{2,3}(?:-[a-z]{2,4})?";
  return t.id.replace(new RegExp(`[-_.]${suffix}$`, "i"), "");
}

/** Where a text starts on the page: its first character's position. */
function startPoint(t: SvgText): [number, number] {
  const c = t.chars[0];
  return apply(t.m, c?.x ?? t.x, c?.y ?? t.y);
}

/** Language versions: one list per label, the drawn version first. Versions that cannot be matched are dropped. */
function byLanguage(texts: SvgText[], lang: string, warnings: string[]): SvgText[][] {
  const out: SvgText[][] = [];
  const switches = new Map<number, SvgText[]>();
  for (const t of texts) {
    if (t.switchAt === null) out.push([t]);
    else {
      let list = switches.get(t.switchAt);
      if (!list) {
        list = [];
        switches.set(t.switchAt, list);
        out.push(list); // placeholder, filled below
      }
      list.push(t);
    }
  }
  let dropped = 0;
  const result: SvgText[][] = [];
  for (const g of out) {
    const sw = g[0]!.switchAt;
    if (sw === null || switches.get(sw) !== g) {
      result.push(g);
      continue;
    }
    // The children of the <switch>, in order; the first whose systemLanguage matches is drawn.
    const alts = new Map<number, SvgText[]>();
    for (const t of g) {
      const k = t.altAt ?? t.start;
      alts.set(k, [...(alts.get(k) ?? []), t]);
    }
    const order = [...alts.keys()].sort((p, q) => p - q);
    const drawnAt = order.find((k) => langMatches(alts.get(k)![0]!.lang, lang)) ?? order[0]!;
    const direct = order.every((k) => alts.get(k)!.length === 1 && alts.get(k)![0]!.start === k);
    if (direct) {
      // <switch><text systemLanguage="de">…</text><text>…</text></switch>: one label.
      const drawn = alts.get(drawnAt)![0]!;
      result.push([drawn, ...g.filter((t) => t !== drawn)]);
      continue;
    }
    // <switch><g systemLanguage="de">many texts</g><g>many texts</g></switch>: match the versions across the
    // layers by id without the language suffix, else by where they start, else by order when the layers are alike.
    const drawn = alts.get(drawnAt)!;
    const units = drawn.map((t) => [t]);
    const byStem = new Map<string, number>();
    drawn.forEach((t, i) => {
      const st = stem(t);
      if (st !== undefined) byStem.set(st, i);
    });
    const starts = drawn.map(startPoint);
    const near = (t: SvgText) => {
      const [x, y] = startPoint(t);
      let best: number | undefined;
      let bestD = 1.5 * fontSize(t) * scaleOf(t.m);
      starts.forEach(([sx, sy], i) => {
        const d = Math.hypot(sx - x, sy - y);
        if (d <= bestD) [best, bestD] = [i, d];
      });
      return best;
    };
    for (const k of order) {
      if (k === drawnAt) continue;
      const layer = alts.get(k)!;
      layer.forEach((t, i) => {
        const st = stem(t);
        const j = (st !== undefined ? byStem.get(st) : undefined) ?? near(t) ?? (layer.length === drawn.length ? i : undefined);
        if (j === undefined) dropped++;
        else units[j]!.push(t);
      });
    }
    result.push(...units);
  }
  if (dropped) warnings.push(`${dropped} texts in other language layers of a <switch> could not be matched to a drawn text; they are not moved`);
  return result;
}

/**
 * Group the texts of a document (in document order, with their boxes) into labels.
 * `lang` is the language the SVG is drawn in; Commons draws thumbnails in English unless asked otherwise.
 */
export function groupTexts(texts: SvgText[], boxOf: ReadonlyMap<SvgText, Box>, lang = "en"): GroupResult {
  const warnings: string[] = [];
  const units: TextUnit[] = byLanguage(texts, lang, warnings).map((ts) => {
    const rep = ts[0]!;
    let box = boxOf.get(rep)!;
    for (const o of ts.slice(1)) box = union(box, boxIn(rep, o, boxOf.get(o)!));
    const unit: TextUnit = { texts: ts, box };
    if (ts.some((o) => o.onPath)) unit.reason = "laid out along a textPath";
    else if (ts.some((o) => o.vertical)) unit.reason = "vertical text";
    return unit;
  });

  // Root-coordinate centre and size of each unit's drawn text, for the neighbour tests below.
  const geo = units.map((u) => {
    const rep = u.texts[0]!;
    const [l, t, r, b] = u.box;
    const sc = scaleOf(rep.m);
    return { rep, centre: apply(rep.m, (l + r) / 2, (t + b) / 2), fs: fontSize(rep) * sc, angle: angleOf(rep.m), n: letters(rep) };
  });
  const sameAngle = (i: number, j: number) => Math.abs(Math.sin(geo[i]!.angle - geo[j]!.angle)) < 0.02 && Math.cos(geo[i]!.angle - geo[j]!.angle) > 0;

  // Letters of one word: two or more neighbouring texts of one or two letters, close together, same size.
  const inWord = new Array<boolean>(units.length).fill(false);
  for (let i = 0; i + 1 < units.length; i++) {
    const a = geo[i]!;
    const b = geo[i + 1]!;
    if (a.n < 1 || a.n > 2 || b.n < 1 || b.n > 2 || units[i]!.reason || units[i + 1]!.reason) continue;
    const fs = Math.max(a.fs, b.fs);
    if (Math.min(a.fs, b.fs) / fs < 0.9) continue;
    if (Math.hypot(a.centre[0] - b.centre[0], a.centre[1] - b.centre[1]) <= 2.5 * fs) inWord[i] = inWord[i + 1] = true;
  }
  units.forEach((u, i) => {
    if (inWord[i]) u.reason = "one letter of a word set letter by letter";
  });

  // Lines of one name: neighbouring texts, same angle, one under the other at about a line's distance,
  // aligned on the left, centre or right.
  const merged: TextUnit[] = [];
  let prev: number | null = null;
  units.forEach((u, i) => {
    const last = merged[merged.length - 1];
    if (prev !== null && last && !last.reason && !u.reason && sameAngle(prev, i)) {
      const a = last.texts[0]!;
      const A = last.box;
      const B = boxIn(a, u.texts[0]!, u.box);
      const scale = scaleOf(u.texts[0]!.m) / scaleOf(a.m);
      const fsA = fontSize(a);
      const fsB = fontSize(u.texts[0]!) * scale;
      const fs = Math.max(fsA, fsB);
      const [upper, lower] = B[1] >= A[1] ? [A, B] : [B, A];
      const gap = lower[1] - upper[3];
      const overlap = Math.min(A[2], B[2]) - Math.max(A[0], B[0]);
      const aligned =
        Math.abs(A[0] - B[0]) < 0.6 * fs || Math.abs(A[2] - B[2]) < 0.6 * fs || Math.abs(A[0] + A[2] - B[0] - B[2]) / 2 < 0.6 * fs;
      if (
        Math.min(fsA, fsB) / fs >= 0.6 &&
        gap >= -0.25 * fs && gap <= 0.8 * fs &&
        overlap >= 0.5 * Math.min(A[2] - A[0], B[2] - B[0]) &&
        aligned
      ) {
        last.texts.push(...u.texts);
        last.box = union(A, B);
        prev = i;
        return;
      }
    }
    merged.push({ ...u, texts: [...u.texts] });
    prev = i;
  });
  return { units: merged, warnings };
}
