#!/usr/bin/env python3
"""标签 JSON → `{{Image label}}` wikitext ＋ 本地模拟页（通用；references/maps.md §4.1、§4.2、§6 第 2 步）。

自制地图的 SVG 里不放中文，地名用 `{{Image label}}` 叠在图上。本脚本把「标签 JSON」（画图脚本输出、
`map_place_labels.py` 避让过的）按配置里的字号表、链接表、显示宽度换算成模板参数，每个输出档写一个
wikitext 块和一个模拟页（照模板的 CSS 公式摆字，用 Chrome 无头截图验收，maps.md §6 第 2 步）。
不联网、只用标准库；同样的输入，输出逐字节相同。

`Template:Image label`（zh rev 94636791）：标签框左上角 left = x·scale − 6px、top = y·scale − 8px，
−6、−8 不随 scale 缩放，所以坐标按条目里实际的显示宽度算（maps.md §4.2）。
`thumb=yes` 时 zh 把图放进缩略图框，图片相对标签原点右移、下移 5px（框内边距 4＋图片边框 1，
2026-11-01 实测），这一档的坐标统一补 `thumb_offset`（默认 5）。

用法（仓库根目录；S=.claude/skills/wikipedia-editing/scripts）：
  python3 -I -X utf8 $S/map_labels.py <配置.json> [--labels <标签.json>] [--svg <图.svg>] [--outdir <目录>]
                                      [--only <输出名>]…
  - 配置里的相对路径相对于配置文件所在目录；命令行参数优先。
  - 输出写到 --outdir；不给时写到标签 JSON 所在目录。模拟页的 <img src> 按输出目录到 SVG 的相对路径写。
  - --only：只出某几个输出档（按 outputs[].name）。

标签 JSON（画图脚本写，map_place_labels.py 原样读写）：
  {"width": <SVG 宽>, "height": <SVG 高>, "labels": [
     {"name": "某某镇", "kind": "town", "x": 301.7, "y": 413.2,   # SVG 像素：标签中心
      "anchor": "start" | "end",     # 可选：x 是左端（start）或右端（end）的中点；避让后会去掉
      "angle": 23.7,                 # 可选：顺时针旋转的度数（沿线的线名）
      "vertical": true,              # 可选：竖排（逐字 <br />）
      "link": "目标条目" | false,     # 可选：覆盖配置的 links 表
      "skip360": true},              # 可选：显示宽度 360 的输出档不出这个标签
     …], …其他字段（锚点坐标等）随意}

配置（JSON；和 map_place_labels.py 共用一个文件，这里只列本脚本读的键；最小示例见 examples/map_labels_example.json）：
  "labels": "labels.json",           标签 JSON
  "svg": "map.svg",                  SVG（模拟页的底图）
  "styles": {"360": {"<kind>": [字号px, 粗体, 斜体, "颜色", 字距em], …}, "600": {…}}
                                     按显示宽度的字号表（maps.md §3.2、§4.5）；每个用到的 kind 都要有
  "text": {"bold_factor": 1.02}      估字宽：每字 1em ×(1＋字距)，粗体再 ×bold_factor（maps.md §4.2）
  "links": {"标签名": "链接目标"}      有的才加内链（规矩见 maps.md §4.2、editing-basics.md §9.1）
  "nolink_kinds": ["legend"]         这些 kind 不加链接（图例文字）
  "wikitext": {
    "file": "某某县交通.svg",          Commons 文件名（不带 File:）
    "alt": "…", "caption": "…",
    "thumb_offset": 5,               thumb=yes 时补的像素（maps.md §4.2）
    "decimals": 1,                   x、y 保留几位小数（0＝整数）
    "outputs": [                     每个输出档一项
      {"name": "360", "width": 360, "font_size": 11,       显示宽度、`{{Image label begin}}` 的基础字号
       "float": "right", "thumb": true, "caption": true,  caption: true＝用上面的 caption；也可以直接写字符串
       "width_param": "1",           可选：模板写法，width 和 scale 写成 {{{1|360}}}（给 Template:<县>行政区划图 用）
       "begin": [["image", "{file}"], ["width", "{width}"], …],
                                     可选：`{{Image label begin}}` 的参数和顺序；值里的 {file} {width} {font_size}
                                     {alt} {caption} 会被替换。不写时按 image、width、font-size、float、thumb、
                                     caption、alt 的顺序，只出有值的
       "before": "", "end": "\\n", "after": "",
                                     块＝before＋begin＋各行＋"\\n{{Image label end}}"＋end＋after
                                     （例：600 档包居中表格；模板档 end 写 <noinclude> 分类）
       "out": "block_360.wikitext", "mock": "mock_360.html"},
      …],
    "mock_all": {"out": "mock.html", "order": ["360", "600"]}   可选：几档并排的模拟页
  }

检查：每个输出档报告字框出图幅的标签（不含旋转的）。字压线、字叠字由 map_place_labels.py 查。
"""
import argparse
import html
import json
import os
import pathlib

DEFAULT_TEXT = {"bold_factor": 1.02}
DEFAULT_WIKITEXT = {"thumb_offset": 5, "decimals": 1}
PAGE_HEAD = ("<!doctype html><html lang='zh-CN'><meta charset='utf-8'>"
             "<body style='margin:0;background:#fff;font-family:sans-serif'>")
PAGE_TAIL = "</body></html>"


# ---------- 配置 ----------

def load_config(path):
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
    cfg["_dir"] = os.path.dirname(os.path.abspath(path))
    return cfg


def resolve(cfg, p):
    """配置里的相对路径相对于配置文件所在目录。"""
    return p if os.path.isabs(p) else os.path.join(cfg["_dir"], p)


def text_opts(cfg):
    return {**DEFAULT_TEXT, **cfg.get("text", {})}


def style_table(cfg, width):
    st = cfg.get("styles", {}).get(str(width))
    if st is None:
        raise SystemExit(f"配置的 styles 里没有显示宽度 {width} 的字号表（现有：{sorted(cfg.get('styles', {}))}）")
    return st


def style_of(cfg, width, lb):
    st = style_table(cfg, width)
    if lb["kind"] not in st:
        raise SystemExit(f"字号表 {width} 里没有 kind「{lb['kind']}」（标签「{lb['name']}」）")
    size, bold, italic, color, ls = st[lb["kind"]]
    return size, bold, italic, color, ls


def text_size(lb, style, cfg):
    """字框的宽、高（显示像素）：每字 1em ×(1＋字距)，粗体 ×bold_factor；竖排时宽一字、高 n 字。"""
    size, bold, italic, color, ls = style
    bf = text_opts(cfg)["bold_factor"]
    n = len(lb["name"])
    if lb.get("vertical"):
        return size * (bf if bold else 1.0), n * size * (1 + ls)
    return n * size * (1 + ls) * (bf if bold else 1.0), size


def label_box(lb, width, w_svg, cfg):
    """标签在显示宽度 width 下的字框：left、top、宽、高（显示像素）和比例 s。x、y 是中心（anchor 见上）。"""
    s = width / w_svg
    style = style_of(cfg, width, lb)
    w, h = text_size(lb, style, cfg)
    cx, cy = lb["x"] * s, lb["y"] * s
    if lb.get("anchor") == "start":
        left = cx
    elif lb.get("anchor") == "end":
        left = cx - w
    else:
        left = cx - w / 2
    top = cy - h / 2
    return left, top, w, h, s, style


# ---------- wikitext ----------

def link_target(lb, cfg):
    if "link" in lb:
        return lb["link"] or None
    if lb["kind"] in cfg.get("nolink_kinds", ["legend"]):
        return None
    return cfg.get("links", {}).get(lb["name"])


def label_text(lb, style, cfg):
    size, bold, italic, color, ls = style
    st = f"color:{color};"
    if ls:
        st += f"letter-spacing:{ls}em;"
    if lb.get("angle"):
        st += f"display:inline-block;transform:rotate({lb['angle']}deg);"
    t = "<br />".join(lb["name"]) if lb.get("vertical") else lb["name"]
    if bold:
        t = f"'''{t}'''"
    if italic:
        t = f"''{t}''"
    t = f'<span style="{st}">{t}</span>'
    target = link_target(lb, cfg)
    if target:
        t = f"[[{target}|{t}]]"
    return t


def begin_params(out, wt, width_expr):
    cap = out.get("caption")
    caption = wt.get("caption", "") if cap is True else (cap or "")
    subs = {"{file}": wt["file"], "{width}": width_expr, "{font_size}": f"{out['font_size']:g}",
            "{alt}": wt.get("alt", ""), "{caption}": caption}
    if "begin" in out:
        items = []
        for k, v in out["begin"]:
            for a, b in subs.items():
                v = v.replace(a, b)
            items.append((k, v))
        return items
    items = [("image", wt["file"]), ("width", width_expr), ("font-size", f"{out['font_size']:g}px")]
    if out.get("float"):
        items.append(("float", out["float"]))
    if out.get("thumb"):
        items.append(("thumb", "yes"))
    if caption:
        items.append(("caption", caption))
    if wt.get("alt"):
        items.append(("alt", wt["alt"]))
    return items


def build(meta, cfg, out, svg_src):
    """一个输出档：返回 (wikitext 块, 模拟页片段, 警告列表)。"""
    wt = {**DEFAULT_WIKITEXT, **cfg["wikitext"]}
    width, base_fs = out["width"], out["font_size"]
    w_svg = meta["width"]
    width_expr = f"{{{{{{{out['width_param']}|{width}}}}}}}" if out.get("width_param") else str(width)
    off = wt["thumb_offset"] if out.get("thumb") else 0
    dec = wt["decimals"]
    h_disp = round(meta["height"] * width / w_svg)
    lines, mock, warns = [], [], []
    for lb in meta["labels"]:
        if lb.get(f"skip{width}"):
            continue
        left, top, w, h, s, style = label_box(lb, width, w_svg, cfg)
        size, bold, italic, color, ls = style
        x = round((left + 6 + off) / s, dec) if dec else round((left + 6 + off) / s)
        y = round((top + 8 + off) / s, dec) if dec else round((top + 8 + off) / s)
        t = label_text(lb, style, cfg)
        extra = f"|font-size={size:g}px" if size != base_fs else ""
        lines.append(f"{{{{Image label|x={x:g}|y={y:g}|scale={width_expr}/{w_svg}{extra}|text={t}}}}}")
        # 模拟页：标签相对图片的实际位置（thumb 档图片右下移 off，所以减回来）
        rl, rt = x * s - 6 - off, y * s - 8 - off
        if not lb.get("angle") and (rl < 0 or rt < 0 or rl + w > width or rt + h > h_disp):
            warns.append(f"出图幅：{lb['name']}（{rl:.0f},{rt:.0f} 起，宽 {w:.0f}、高 {h:.0f}；图 {width}×{h_disp}）")
        st = (f"color:{color};font-weight:{'bold' if bold else 'normal'};font-style:{'italic' if italic else 'normal'};"
              + (f"letter-spacing:{ls}em;" if ls else "")
              + (f"display:inline-block;transform:rotate({lb['angle']}deg);" if lb.get("angle") else ""))
        shown = "<br>".join(html.escape(c) for c in lb["name"]) if lb.get("vertical") else html.escape(lb["name"])
        mock.append(f'<div style="position:absolute;left:{rl:.2f}px;top:{rt:.2f}px;font-size:{size:g}px;white-space:nowrap">'
                    f'<span style="{st}">{shown}</span></div>')
    params = "".join(f"|{k}={v}" for k, v in begin_params(out, wt, width_expr))
    block = (out.get("before", "") + "{{Image label begin" + params + "}}\n" + "\n".join(lines)
             + "\n{{Image label end}}" + out.get("end", "\n") + out.get("after", ""))
    caption = html.escape(wt.get("caption", ""))
    chunk = (f'<div style="display:inline-block;vertical-align:top;margin:10px">'
             f'<div style="font:12px sans-serif;margin-bottom:4px">显示宽度 {width}px</div>'
             f'<div><div style="position:relative;width:{width}px;height:{h_disp}px;line-height:1;'
             f'text-align:center;font-size:{base_fs:g}px">'
             f'<img src="{html.escape(svg_src)}" width="{width}" height="{h_disp}" style="display:block">'
             + "".join(mock) + "</div></div>"
             f'<div style="width:{width}px;font-size:12px;font-family:sans-serif;margin-top:4px">{caption}</div></div>')
    return block, chunk, warns


def write(path, text):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def main():
    ap = argparse.ArgumentParser(description="标签 JSON → {{Image label}} wikitext＋模拟页（用法见脚本开头）")
    ap.add_argument("config")
    ap.add_argument("--labels", help="标签 JSON（覆盖配置的 labels）")
    ap.add_argument("--svg", help="SVG（覆盖配置的 svg；只用于模拟页）")
    ap.add_argument("--outdir", help="输出目录（默认：标签 JSON 所在目录）")
    ap.add_argument("--only", action="append", help="只出这个输出档（outputs[].name，可多次）")
    a = ap.parse_args()
    cfg = load_config(a.config)
    labels_path = a.labels or resolve(cfg, cfg["labels"])
    with open(labels_path, encoding="utf-8") as f:
        meta = json.load(f)
    outdir = a.outdir or os.path.dirname(os.path.abspath(labels_path))
    svg_path = a.svg or resolve(cfg, cfg.get("svg", ""))
    try:
        svg_src = os.path.relpath(os.path.abspath(svg_path), os.path.abspath(outdir)).replace(os.sep, "/")
    except ValueError:   # Windows：不在同一个盘
        svg_src = pathlib.Path(os.path.abspath(svg_path)).as_uri()
    outs = cfg["wikitext"]["outputs"]
    if a.only:
        outs = [o for o in outs if o.get("name", str(o["width"])) in a.only]
    chunks = {}
    for out in outs:
        name = out.get("name", str(out["width"]))
        block, chunk, warns = build(meta, cfg, out, svg_src)
        chunks[name] = chunk
        if out.get("out"):
            write(os.path.join(outdir, out["out"]), block)
        if out.get("mock"):
            write(os.path.join(outdir, out["mock"]), PAGE_HEAD + chunk + PAGE_TAIL)
        n = block.count("{{Image label|")
        print(f"{name}：{n} 个标签 → {out.get('out', '（不写文件）')}" + ("" if warns else "；出图幅 0"))
        for w in warns:
            print("  " + w)
    ma = cfg["wikitext"].get("mock_all")
    if ma and not a.only:
        order = ma.get("order") or list(chunks)
        write(os.path.join(outdir, ma["out"]), PAGE_HEAD + "".join(chunks[k] for k in order if k in chunks) + PAGE_TAIL)


if __name__ == "__main__":
    main()
