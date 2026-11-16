// Move the <text> elements already in an SVG map (how most maps on Wikimedia Commons carry their names).
// Texts are sized with the fonts Commons renders with, placed by the same engine as label files, and written
// back by changing only their x and y values.

import type { AnchorRule, Config, Label, LabelDoc } from "./config.js";
import { apply, matAngle, matScale } from "./geometry.js";
import { placeLabels, type Placement } from "./place.js";
import { degrees, truthy } from "./py.js";
import { num, walkSvg } from "./svg.js";
import { moveTexts, readTexts, type SvgText } from "./svgtext.js";
import { groupTexts } from "./textgroups.js";
import { layoutText, type Box } from "./textlayout.js";

export type SvgTextConfig = {
  /** Ids of texts, or of groups around them, that stay where they are (legend, scale bar, title). */
  fixed?: string[];
  /** If given, only texts with these ids, or inside groups with these ids, move. */
  move?: string[];
  /** Kind of a text (for priority, search radius and within rules), by text id or content. Default "text". */
  kinds?: Record<string, string>;
  /** The point symbol a text names, by text id or content: id of a circle, ellipse, rect or path. */
  points?: Record<string, string>;
  /** Radius of those point symbols, px (default 4). */
  point_r?: number;
  /** Decimals of the rewritten x and y (default 2). */
  decimals?: number;
  /** Language the map is drawn in, which picks the version shown in a <switch> (default "en", as Commons). */
  lang?: string;
};

export type TextGroup = {
  /** The texts that move together: one, its language versions in a <switch>, the lines of one name. */
  texts: SvgText[];
  fixed: boolean;
  /** Why a text cannot move, when fixed for a reason other than the config. */
  reason?: string;
  label: Label;
  hw: number;
  hh: number;
};

export type SvgPlaceResult = {
  svg: string;
  groups: TextGroup[];
  placements: Placement[];
  failed: Placement[];
  warnings: string[];
};

/** The map frame in user units: min-x, min-y, width, height of the viewBox (or 0, 0, width, height). */
export function rootFrame(svg: string): [number, number, number, number] {
  for (const el of walkSvg(svg)) {
    if (el.local !== "svg") continue;
    const vb = (el.attrs.get("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb.every(Number.isFinite)) return [vb[0]!, vb[1]!, vb[2]!, vb[3]!];
    return [0, 0, num(el.attrs.get("width"), 0), num(el.attrs.get("height"), 0)];
  }
  throw new Error("no <svg> element");
}

/** Centre of the element with this id (circle, ellipse, rect, or the mean of a path's points), root coordinates. */
function symbolCentre(svg: string, id: string): [number, number] | null {
  for (const el of walkSvg(svg)) {
    if (el.attrs.get("id") !== id) continue;
    const a = el.attrs;
    if (el.local === "circle" || el.local === "ellipse") return apply(el.m, num(a.get("cx"), 0), num(a.get("cy"), 0));
    if (el.local === "rect") {
      return apply(el.m, num(a.get("x"), 0) + num(a.get("width"), 0) / 2, num(a.get("y"), 0) + num(a.get("height"), 0) / 2);
    }
    if (el.local === "use") return apply(el.m, num(a.get("x"), 0), num(a.get("y"), 0));
    return null;
  }
  return null;
}

const inAny = (t: SvgText, ids: readonly string[] | undefined) =>
  ids !== undefined && ((t.id !== undefined && ids.includes(t.id)) || t.ancestors.some((a) => ids.includes(a)));

export type SvgLabels = {
  /** The map frame: min-x, min-y, width and height of the viewBox. */
  frame: [number, number, number, number];
  /** Every <text> of the document, drawn or not. */
  texts: SvgText[];
  /** The labels: texts grouped, sized and positioned in root coordinates. */
  groups: TextGroup[];
  warnings: string[];
};

/** Read the texts of an SVG map as labels: laid out, measured with Commons' fonts, grouped. */
export function readSvgLabels(svg: string, tc: SvgTextConfig = {}): SvgLabels {
  const frame = rootFrame(svg);
  const warnings: string[] = [];
  const boxOf = new Map<SvgText, Box>();
  const all = readTexts(svg);
  const texts = all.filter((t) => {
    if (t.hidden || !t.content) return false;
    const { box } = layoutText(t);
    if (box) boxOf.set(t, box);
    return box !== null;
  });

  const grouped = groupTexts(texts, boxOf, tc.lang);
  warnings.push(...grouped.warnings);

  const seen = new Map<string, number>();
  const groups: TextGroup[] = grouped.units.map(({ texts: ts, box, reason }) => {
    const rep = ts[0]!;
    const [l, t, r, b] = box;
    const sc = matScale(rep.m);
    const [cx, cy] = apply(rep.m, (l + r) / 2, (t + b) / 2);
    const angle = degrees(matAngle(rep.m));
    const key = (o: SvgText) => [o.id, o.content].filter((k): k is string => k !== undefined);
    const lookup = <T>(table: Record<string, T> | undefined) => {
      for (const o of ts) for (const k of key(o)) if (table && Object.hasOwn(table, k)) return table[k];
      return undefined;
    };
    const fixed = reason !== undefined || ts.some((o) => inAny(o, tc.fixed)) || (tc.move !== undefined && !ts.some((o) => inAny(o, tc.move)));
    const n = seen.get(rep.content) ?? 0;
    seen.set(rep.content, n + 1);
    const label: Label = { name: n ? `${rep.content}#${n + 1}` : rep.content, kind: lookup(tc.kinds) ?? "text", x: cx, y: cy };
    if (angle) label.angle = angle;
    if (fixed) label.fixed = true;
    const pointId = lookup(tc.points);
    if (pointId !== undefined && !fixed) {
      const c = symbolCentre(svg, pointId);
      if (c === null) warnings.push(`no circle, ellipse, rect or <use> with id="${pointId}" (text "${rep.content}")`);
      else if (angle) warnings.push(`"${rep.content}" is rotated, so it is placed as an area name, not next to its point`);
      else label.point = c;
    }
    return { texts: ts, fixed, reason, label, hw: ((r - l) / 2) * sc, hh: ((b - t) / 2) * sc };
  });
  return { frame, texts: all, groups, warnings };
}

export function placeSvgTexts(svg: string, cfg: Config & { svg_text?: SvgTextConfig } = {}): SvgPlaceResult {
  const tc = cfg.svg_text ?? {};
  const { frame, texts, groups, warnings } = readSvgLabels(svg, tc);
  const [X0, Y0, W, H] = frame;

  const place = cfg.place ?? {};
  if (place.lines && Object.keys(place.lines).length > 0) {
    warnings.push("place.lines is ignored for SVG texts: names along lines need a rotation, which is not written yet");
  }
  const anchors: AnchorRule[] = [...(place.anchors ?? []), { field: "point", r: tc.point_r ?? 4 }];
  const runCfg: Config = { ...cfg, place: { ...place, lines: {}, anchors, fixed_kinds: [] } };
  const doc: LabelDoc = { width: W, height: H, labels: groups.map((g) => g.label) };
  const res = placeLabels(svg, doc, runCfg, {
    decimals: null,
    sizeOf: (_, i) => [groups[i]!.hw, groups[i]!.hh],
    skipTextAt: new Set(texts.map((t) => t.start)),
    origin: [X0, Y0],
  });

  const moves = new Map<SvgText, readonly [number, number]>();
  for (const p of res.placements) {
    const g = groups[p.index]!;
    const dx = p.x - g.label.x;
    const dy = p.y - g.label.y;
    if (truthy(dx) || truthy(dy)) for (const t of g.texts) moves.set(t, [dx, dy]);
  }
  return {
    svg: moveTexts(svg, moves, tc.decimals ?? 2),
    groups,
    placements: res.placements,
    failed: res.failed,
    warnings: [...warnings, ...res.warnings],
  };
}
