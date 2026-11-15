// The config file and label file formats of the Python scripts, with the same defaults.
// See the docstrings of reference/python/map_place_labels.py and map_labels.py.

import { pyLen, truthy } from "./py.js";

/** [font size px, bold, italic, colour, letter spacing em] at one display width. */
export type Style = [number, unknown, unknown, string, number];

export type AnchorRule = {
  kinds?: string[];
  names?: string[];
  /** Path into the label file, e.g. "towns/{name}" or "toll_xy/{index}". */
  xy?: string;
  /** Or a field of the label itself holding [x, y]. */
  field?: string;
  /** Radius of the point symbol, in SVG px. */
  r: number;
};

export type WithinRule = { kinds?: string[]; names?: string[]; id: string };

export type PlaceConfig = {
  width: number;
  margin: number;
  step: number;
  cell: number;
  gap_label: number;
  own_ratio: number;
  frame_pad: number;
  line_height: number;
  rect_max: number;
  area_ids: string[];
  fixed_kinds: string[];
  fixed_as_obstacles: boolean;
  priority: string[];
  lines: Record<string, string>;
  anchors: AnchorRule[];
  point: { dirs: number[]; dir_step: number; gap_min: number; gap_max: number };
  line: { max_dist: number; resample: number; tangent_span: number; offsets: number[]; offset_cost: number; clearance: number };
  area: { radius: Record<string, number>; ring_step: number; arc_step: number };
  within: WithinRule[];
  within_margin: number;
  text_char_em: number;
  text_descent: number;
  svg_parse: string;
};

export type Config = {
  styles?: Record<string, Record<string, Style>>;
  text?: { bold_factor?: number };
  place?: Partial<Omit<PlaceConfig, "point" | "line" | "area" | "within_margin">> & {
    point?: Partial<PlaceConfig["point"]>;
    line?: Partial<PlaceConfig["line"]>;
    area?: Partial<PlaceConfig["area"]>;
    within_margin?: number | null;
  };
  [key: string]: unknown;
};

export type Label = {
  name: string;
  kind: string;
  /** Centre of the label in SVG px (or its left / right end with anchor "start" / "end"). */
  x: number;
  y: number;
  anchor?: "start" | "end";
  /** Clockwise rotation in degrees. */
  angle?: number;
  vertical?: boolean;
  fixed?: boolean;
  /** Id of the SVG path this label names (a river, a railway). */
  line?: string;
  /** Id of the polygon the label must stay inside, or false to switch a config rule off. */
  within?: string | false;
  [key: string]: unknown;
};

export type LabelDoc = { width: number; height: number; labels: Label[]; [key: string]: unknown };

const DEFAULT_POINT: PlaceConfig["point"] = { dirs: [0, 315, 45, 180, 225, 135, 270, 90], dir_step: 5, gap_min: 2, gap_max: 40 };
const DEFAULT_LINE: PlaceConfig["line"] = {
  max_dist: 420, resample: 5.0, tangent_span: 40.0, offsets: [0.0, 6.0, 12.0], offset_cost: 3, clearance: 2.6,
};
const DEFAULT_AREA: PlaceConfig["area"] = { radius: { "*": 60 }, ring_step: 6, arc_step: 6 };

export function placeOptions(cfg: Config): PlaceConfig {
  const p = cfg.place ?? {};
  const P = {
    width: 360, margin: 3.0, step: 2.5, cell: 24.0, gap_label: 8.0, own_ratio: 0.6, frame_pad: 4.0, line_height: 1.1,
    rect_max: 400.0, area_ids: [], fixed_kinds: ["legend"], fixed_as_obstacles: true, priority: [], lines: {}, anchors: [],
    within: [], within_margin: null as number | null, text_char_em: 0.6, text_descent: 2.0, svg_parse: "default",
    ...p,
    point: { ...DEFAULT_POINT, ...p.point },
    line: { ...DEFAULT_LINE, ...p.line },
    area: { ...DEFAULT_AREA, ...p.area },
  };
  if (P.within_margin === null || P.within_margin === undefined) P.within_margin = P.margin;
  if (P.svg_parse !== "default") throw new Error(`svg_parse "${P.svg_parse}" is not supported (only "default")`);
  return P as PlaceConfig;
}

export function styleOf(cfg: Config, width: number, lb: Label): Style {
  const table = cfg.styles?.[String(width)];
  if (table === undefined) {
    throw new Error(`config "styles" has no table for display width ${width} (have: ${Object.keys(cfg.styles ?? {}).sort().join(", ")})`);
  }
  const st = table[lb.kind];
  if (st === undefined) throw new Error(`style table ${width} has no kind "${lb.kind}" (label "${lb.name}")`);
  return st;
}

/** Width and height of a label in display px: 1 em per character × (1 + letter spacing), bold × bold_factor. */
export function textSize(lb: Label, style: Style, cfg: Config): [number, number] {
  const [size, bold, , , ls] = style;
  const bf = cfg.text?.bold_factor ?? 1.02;
  const n = pyLen(lb.name);
  if (truthy(lb.vertical)) return [size * (truthy(bold) ? bf : 1.0), n * size * (1 + ls)];
  return [n * size * (1 + ls) * (truthy(bold) ? bf : 1.0), size];
}

/** Half width and half height of a label's box in SVG px. */
export function halfSize(lb: Label, width: number, wSvg: number, cfg: Config, P: PlaceConfig): [number, number] {
  const [w, h] = textSize(lb, styleOf(cfg, width, lb), cfg);
  const s = width / wSvg;
  if (truthy(lb.vertical)) return [(w * P.line_height) / s / 2, h / s / 2];
  return [w / s / 2, (h * P.line_height) / s / 2];
}
