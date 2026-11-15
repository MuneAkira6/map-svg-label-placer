// Label file -> {{Image label}} wikitext for Chinese Wikipedia, plus a local mock page that lays the labels out
// with the template's CSS formula. Ported from reference/python/map_labels.py.
//
// Template:Image label (zh rev 94636791) puts the label box at left = x·scale − 6px, top = y·scale − 8px.
// The −6 and −8 do not scale, so coordinates depend on the display width. With thumb=yes the image sits
// 5px further right and down inside the thumbnail frame, so those outputs add `thumb_offset` (default 5).

import { styleOf, textSize, type Config, type Label, type LabelDoc, type Style } from "./config.js";
import { floatRepr, formatF, formatG, htmlEscape, pyRound, truthy } from "./py.js";

export type WikitextOutput = {
  name?: string;
  /** Display width in the article, px. */
  width: number;
  /** font-size of {{Image label begin}}, px. */
  font_size: number;
  float?: string;
  thumb?: boolean;
  /** true: use wikitext.caption; a string: this caption. */
  caption?: boolean | string;
  /** Write width and scale as {{{<param>|<width>}}} (for a template). */
  width_param?: string;
  /** Parameters of {{Image label begin}} in order; {file} {width} {font_size} {alt} {caption} are substituted. */
  begin?: [string, string][];
  before?: string;
  end?: string;
  after?: string;
  /** File names, relative to the output directory. */
  out?: string;
  mock?: string;
};

export type WikitextConfig = {
  /** Commons file name without "File:". */
  file: string;
  alt?: string;
  caption?: string;
  thumb_offset?: number;
  /** Decimals of x and y (0 = integers). */
  decimals?: number;
  outputs: WikitextOutput[];
  mock_all?: { out: string; order?: string[] };
};

export type MockOptions = {
  /** Heading above each mock image. */
  heading?: (width: number) => string;
};

export const PAGE_HEAD =
  "<!doctype html><html lang='zh-CN'><meta charset='utf-8'><body style='margin:0;background:#fff;font-family:sans-serif'>";
export const PAGE_TAIL = "</body></html>";

/** str() of a JSON value. JSON.parse loses the 3 / 3.0 distinction, so a whole float prints without ".0". */
const pyText = (v: unknown) => String(v);

function labelBox(lb: Label, width: number, wSvg: number, cfg: Config) {
  const s = width / wSvg;
  const style = styleOf(cfg, width, lb);
  const [w, h] = textSize(lb, style, cfg);
  const cx = lb.x * s;
  const cy = lb.y * s;
  const left = lb.anchor === "start" ? cx : lb.anchor === "end" ? cx - w : cx - w / 2;
  const top = cy - h / 2;
  return { left, top, w, h, s, style };
}

function linkTarget(lb: Label, cfg: Config): string | null {
  if (Object.hasOwn(lb, "link")) return truthy(lb.link) ? String(lb.link) : null;
  const nolink = (cfg.nolink_kinds as string[] | undefined) ?? ["legend"];
  if (nolink.includes(lb.kind)) return null;
  const links = (cfg.links as Record<string, string> | undefined) ?? {};
  return Object.hasOwn(links, lb.name) ? links[lb.name]! : null;
}

/** The angle written by the placer is always a Python float, so it prints as "10.0", not "10". */
function angleText(a: unknown): string {
  return typeof a === "number" ? floatRepr(a) : String(a);
}

function labelText(lb: Label, style: Style, cfg: Config): string {
  const [, bold, italic, color, ls] = style;
  let st = `color:${color};`;
  if (truthy(ls)) st += `letter-spacing:${pyText(ls)}em;`;
  if (truthy(lb.angle)) st += `display:inline-block;transform:rotate(${angleText(lb.angle)}deg);`;
  let t = truthy(lb.vertical) ? [...lb.name].join("<br />") : lb.name;
  if (truthy(bold)) t = `'''${t}'''`;
  if (truthy(italic)) t = `''${t}''`;
  t = `<span style="${st}">${t}</span>`;
  const target = linkTarget(lb, cfg);
  if (target) t = `[[${target}|${t}]]`;
  return t;
}

function beginParams(out: WikitextOutput, wt: WikitextConfig, widthExpr: string): [string, string][] {
  const cap = out.caption;
  const caption = cap === true ? (wt.caption ?? "") : truthy(cap) ? String(cap) : "";
  const subs: [string, string][] = [
    ["{file}", wt.file],
    ["{width}", widthExpr],
    ["{font_size}", formatG(out.font_size)],
    ["{alt}", wt.alt ?? ""],
    ["{caption}", caption],
  ];
  if (out.begin !== undefined) {
    return out.begin.map(([k, v]) => [k, subs.reduce((acc, [a, b]) => acc.replaceAll(a, b), v)]);
  }
  const items: [string, string][] = [
    ["image", wt.file],
    ["width", widthExpr],
    ["font-size", `${formatG(out.font_size)}px`],
  ];
  if (truthy(out.float)) items.push(["float", String(out.float)]);
  if (truthy(out.thumb)) items.push(["thumb", "yes"]);
  if (caption) items.push(["caption", caption]);
  if (truthy(wt.alt)) items.push(["alt", wt.alt!]);
  return items;
}

export type OutputResult = {
  name: string;
  /** The wikitext block to paste into the article. */
  block: string;
  /** Mock page fragment (one image with its labels). */
  chunk: string;
  count: number;
  /** Labels whose box falls outside the image (rotated labels are not checked). */
  outside: { name: string; left: number; top: number; w: number; h: number }[];
  width: number;
  height: number;
};

/** One output: the {{Image label}} block and the mock fragment. `svgSrc` is the <img src> of the mock page. */
export function buildOutput(doc: LabelDoc, cfg: Config, out: WikitextOutput, svgSrc: string, opts: MockOptions = {}): OutputResult {
  const wt = { thumb_offset: 5, decimals: 1, ...(cfg.wikitext as WikitextConfig) };
  const { width, font_size: baseFs } = out;
  const wSvg = doc.width;
  const widthExpr = truthy(out.width_param) ? `{{{${out.width_param}|${width}}}}` : String(width);
  const off = truthy(out.thumb) ? wt.thumb_offset : 0;
  const dec = wt.decimals;
  const hDisp = pyRound((doc.height * width) / wSvg);
  const lines: string[] = [];
  const mock: string[] = [];
  const outside: OutputResult["outside"] = [];
  for (const lb of doc.labels) {
    if (truthy(lb[`skip${width}`])) continue;
    const { left, top, w, h, s, style } = labelBox(lb, width, wSvg, cfg);
    const [size, bold, italic, color, ls] = style;
    const x = dec ? pyRound((left + 6 + off) / s, dec) : pyRound((left + 6 + off) / s);
    const y = dec ? pyRound((top + 8 + off) / s, dec) : pyRound((top + 8 + off) / s);
    const t = labelText(lb, style, cfg);
    const extra = size !== baseFs ? `|font-size=${formatG(size)}px` : "";
    lines.push(`{{Image label|x=${formatG(x)}|y=${formatG(y)}|scale=${widthExpr}/${pyText(wSvg)}${extra}|text=${t}}}`);
    const rl = x * s - 6 - off;
    const rt = y * s - 8 - off;
    if (!truthy(lb.angle) && (rl < 0 || rt < 0 || rl + w > width || rt + h > hDisp)) {
      outside.push({ name: lb.name, left: rl, top: rt, w, h });
    }
    const st =
      `color:${color};font-weight:${truthy(bold) ? "bold" : "normal"};font-style:${truthy(italic) ? "italic" : "normal"};` +
      (truthy(ls) ? `letter-spacing:${pyText(ls)}em;` : "") +
      (truthy(lb.angle) ? `display:inline-block;transform:rotate(${angleText(lb.angle)}deg);` : "");
    const shown = truthy(lb.vertical) ? [...lb.name].map(htmlEscape).join("<br>") : htmlEscape(lb.name);
    mock.push(
      `<div style="position:absolute;left:${formatF(rl, 2)}px;top:${formatF(rt, 2)}px;font-size:${formatG(size)}px;white-space:nowrap">` +
        `<span style="${st}">${shown}</span></div>`,
    );
  }
  const params = beginParams(out, wt, widthExpr).map(([k, v]) => `|${k}=${v}`).join("");
  const block =
    (out.before ?? "") + "{{Image label begin" + params + "}}\n" + lines.join("\n") + "\n{{Image label end}}" +
    (out.end ?? "\n") + (out.after ?? "");
  const caption = htmlEscape(wt.caption ?? "");
  const heading = (opts.heading ?? ((wd: number) => `display width ${wd}px`))(width);
  const chunk =
    `<div style="display:inline-block;vertical-align:top;margin:10px">` +
    `<div style="font:12px sans-serif;margin-bottom:4px">${heading}</div>` +
    `<div><div style="position:relative;width:${width}px;height:${hDisp}px;line-height:1;` +
    `text-align:center;font-size:${formatG(baseFs)}px">` +
    `<img src="${htmlEscape(svgSrc)}" width="${width}" height="${hDisp}" style="display:block">` +
    mock.join("") + "</div></div>" +
    `<div style="width:${width}px;font-size:12px;font-family:sans-serif;margin-top:4px">${caption}</div></div>`;
  return { name: out.name ?? String(width), block, chunk, count: lines.length, outside, width, height: hDisp };
}

/** Every file the config asks for: blocks, mock pages and the side-by-side mock. Keys are relative paths. */
export function wikitextFiles(
  doc: LabelDoc,
  cfg: Config,
  svgSrc: string,
  only?: readonly string[],
  opts: MockOptions = {},
): { files: Map<string, string>; outputs: OutputResult[] } {
  const wt = cfg.wikitext as WikitextConfig | undefined;
  if (wt === undefined) throw new Error('config has no "wikitext" section');
  let outs = wt.outputs;
  if (only && only.length > 0) outs = outs.filter((o) => only.includes(o.name ?? String(o.width)));
  const files = new Map<string, string>();
  const chunks = new Map<string, string>();
  const outputs: OutputResult[] = [];
  for (const out of outs) {
    const r = buildOutput(doc, cfg, out, svgSrc, opts);
    chunks.set(r.name, r.chunk);
    outputs.push(r);
    if (out.out) files.set(out.out, r.block);
    if (out.mock) files.set(out.mock, PAGE_HEAD + r.chunk + PAGE_TAIL);
  }
  if (wt.mock_all && !(only && only.length > 0)) {
    const order = wt.mock_all.order ?? [...chunks.keys()];
    files.set(wt.mock_all.out, PAGE_HEAD + order.filter((k) => chunks.has(k)).map((k) => chunks.get(k)).join("") + PAGE_TAIL);
  }
  return { files, outputs };
}

