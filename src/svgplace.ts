// Move the <text> elements already in an SVG map (how most maps on Wikimedia Commons carry their names).
// Texts are sized with the fonts Commons renders with, placed by the same engine as label files, and written
// back by changing only their x and y values.

import type { AnchorRule, Config, Label, LabelDoc } from "./config.js";
import { apply, matAngle, matScale } from "./geometry.js";
import { placeLabels, type Placement } from "./place.js";
import { degrees, truthy } from "./py.js";
import { num, walkSvg } from "./svg.js";
import { moveTexts, readTexts, type SvgText } from "./svgtext.js";
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
};

export type TextGroup = {
  /** The texts that move together: one, or the language versions inside one <switch>. */
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

function rootSize(svg: string): [number, number] {
  for (const el of walkSvg(svg)) {
    if (el.local !== "svg") continue;
    const vb = (el.attrs.get("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb.every(Number.isFinite)) return [vb[2]!, vb[3]!];
    return [num(el.attrs.get("width"), 0), num(el.attrs.get("height"), 0)];
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

export function placeSvgTexts(svg: string, cfg: Config & { svg_text?: SvgTextConfig } = {}): SvgPlaceResult {
  const tc = cfg.svg_text ?? {};
  const [W, H] = rootSize(svg);
  const warnings: string[] = [];
  const boxOf = new Map<SvgText, Box>();
  const texts = readTexts(svg).filter((t) => {
    if (t.hidden || !t.content) return false;
    const { box } = layoutText(t);
    if (box) boxOf.set(t, box);
    return box !== null;
  });

  // One group per text, or per <switch> of language versions.
  const bySwitch = new Map<number, SvgText[]>();
  const groupsOf: SvgText[][] = [];
  for (const t of texts) {
    if (t.switchAt === null) groupsOf.push([t]);
    else {
      let g = bySwitch.get(t.switchAt);
      if (!g) {
        g = [];
        bySwitch.set(t.switchAt, g);
        groupsOf.push(g);
      }
      g.push(t);
    }
  }

  const seen = new Map<string, number>();
  const groups: TextGroup[] = groupsOf.map((ts) => {
    const rep = ts.find((t) => t.lang === undefined) ?? ts[0]!;
    let [l, t, r, b] = boxOf.get(rep)!;
    for (const o of ts) {
      if (o === rep) continue;
      const [l2, t2, r2, b2] = boxOf.get(o)!;
      [l, t, r, b] = [Math.min(l, l2), Math.min(t, t2), Math.max(r, r2), Math.max(b, b2)];
    }
    const sc = matScale(rep.m);
    const [cx, cy] = apply(rep.m, (l + r) / 2, (t + b) / 2);
    const angle = degrees(matAngle(rep.m));
    const key = (o: SvgText) => [o.id, o.content].filter((k): k is string => k !== undefined);
    const lookup = <T>(table: Record<string, T> | undefined) => {
      for (const o of ts) for (const k of key(o)) if (table && Object.hasOwn(table, k)) return table[k];
      return undefined;
    };
    let reason: string | undefined;
    if (ts.some((o) => o.onPath)) reason = "laid out along a textPath";
    else if (ts.some((o) => o.vertical)) reason = "vertical text";
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
