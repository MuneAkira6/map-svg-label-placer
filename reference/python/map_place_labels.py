#!/usr/bin/env python3
"""标签自动避让（通用；references/maps.md §4.3、§4.4）：字不压任何线，用脚本系统地放，不用肉眼挪。

画图脚本出 SVG 和标签 JSON 之后、map_labels.py 之前跑。按条目里实际的显示宽度算每个标签的字框（字号表和
map_labels.py 共用），和 SVG 里所有描边的线（path、line、polyline、polygon）、矩形、圆、SVG 自带的文字、
已经放好的标签逐点比较；压了就在候选位置里换一个，全部放不下的报出来，由人决定删字、缩字还是换符号。
确定性：同样的输入，输出逐字节相同。不联网、只用标准库。

候选位置（maps.md §4.4）：
  - 点状注记（有锚点的：驻地、车站、收费站……）：离自己的点最近优先——每 dir_step 度一个方向、离符号
    gap_min～gap_max 每 1 一档，代价＝字框边到点的距离（取整）；一样近时按 dirs 的顺序（默认 右、右上、右下、
    左、左上、左下、上、下）。字框到自己的点的距离要小于到任何别的锚点的距离 × own_ratio，免得认错点。
    全都不行才退回原位置（报「放不下」）。
  - 线状注记（lines 里有的：铁路、河、运河……）：沿自己那条线滑，顺着线的走向旋转，放在线的一侧，离原位置越近越好。
  - 面状注记（其余的：主体名、邻区名、湖名、乡镇名……）：在原位置附近由近到远找空地（半径上限按 kind）。
    可选约束 within：整个字框落在 SVG 里某个多边形（按 id 取）之内，离边界至少 within_margin（区划图的乡镇名）。
放的顺序按 priority（重要的先放：县驻地、车站等点状地物 → 主体名 → 街道、乡镇 → 线名、水名 → 邻区名）。

用法（仓库根目录；S=.claude/skills/wikipedia-editing/scripts）：
  python3 -I -X utf8 $S/map_place_labels.py <配置.json> [--labels <标签.json>] [--svg <图.svg>]
                                            [--out <输出.json>] [--width 360] [--report <报告.txt>]
  - 配置和 map_labels.py 共用一个文件（本脚本读 labels、svg、styles、text 和 place 段）；相对路径相对于配置文件。
  - 不给 --out 时看配置的 place.out；都没有就覆盖标签 JSON（画图脚本每次重出未避让的标签，再跑本脚本）。
  - 输出：同样格式的标签 JSON，x、y 改成避让后的字框中心（去掉 anchor），线名写入 angle；每个标签一行报告，
    放不下的以「放不下：」开头，最后一行是放不下的个数。

配置的 place 段（括号里是默认值；最小示例见 examples/map_labels_example.json）：
  "width": 360                 按哪一档显示宽度的字号表算字框（--width 优先）
  "margin": 3.0                字框和线的边之间至少留的距离（SVG 像素）
  "gap_label": 8.0             字和字之间至少留的距离（免得两个地名读成一行）
  "own_ratio": 0.6             点状注记的归属检查（见上）
  "step": 2.5, "cell": 24.0    字框内取样点的间距；线段空间索引的格子
  "frame_pad": 4.0             离图幅边至少这么多
  "line_height": 1.1           字框高＝字号 × line_height
  "rect_max": 400.0            宽、高都小于它的 <rect> 当实心障碍（编号牌、图例框、比例尺）；更大的当底色、图幅框
                               （有描边的话只算四条边）
  "area_ids": []               这些 id 的元素是面（例：建成区），字可以压
  "fixed_kinds": ["legend"]    这些 kind 不挪（图例文字）；标签里写 "fixed": true 也一样
  "fixed_as_obstacles": true   不挪的标签算不算障碍（图例框本身已经是障碍时可以 false）
  "priority": ["seat", …]      kind 的先后；不在表里的排最后，同一 kind 按标签 JSON 里的顺序
  "lines": {"某某铁路": "rail-0"}       线名 → SVG 里那条线的 path id；标签里写 "line": "<id>" 也行
  "anchors": [                 点状注记的锚点从哪里取（按顺序匹配第一条）：
     {"kinds": ["town"], "xy": "towns/{name}", "r": 7.0},       从标签 JSON 顶层按路径取（{name}＝标签名）
     {"kinds": ["toll"], "names": ["甲", "乙"], "xy": "toll_xy/{index}", "r": 3.3},   {index}＝在 names 里的序号
     {"kinds": ["poi"], "field": "point", "r": 4.0}]            或者从标签自己的字段取 [x, y]
                               r＝符号半径（SVG 像素），候选位置从符号边外算起
  "point": {"dirs": [0, 315, 45, 180, 225, 135, 270, 90], "dir_step": 5, "gap_min": 2, "gap_max": 40}
                               角度：0＝右、90＝下（SVG 的 y 向下）
  "line": {"max_dist": 420, "resample": 5.0, "tangent_span": 40.0, "offsets": [0, 6, 12], "offset_cost": 3,
           "clearance": 2.6}   沿线候选：离原位置多远以内、重采样间距、算走向的弦长、离线的几档额外距离和代价；
                               clearance≈线的半宽（字框离线中心＝半高＋clearance＋margin＋1＋额外距离）
  "area": {"radius": {"*": 60}, "ring_step": 6, "arc_step": 6}   面状注记的搜索半径（按 kind，"*"＝其余）
  "within": [{"kinds": ["unit"], "id": "r{rid}"}]   面状约束：多边形 id，{字段} 用标签的字段替换；
                               标签里写 "within": "<id>"（或 false 关掉）优先
  "within_margin": null        字框离多边形边界至少多远（null＝等于 margin）
  "text_char_em": 0.6, "text_descent": 2.0   SVG 自带文字（编号、比例尺数字）的字框：每字 0.6em，基线下 2px
  "svg_parse": "default"       "legacy"＝照搬泗阳县交通图 v2 的 place_labels_v2.py 的读法（只为回归；有已知
                               毛病，见下）
  "out": null                  输出路径（见上）

SVG 读法（default）：按元素读属性和 style="…"，继承 <g> 的 stroke、stroke-width、fill、display、font-size、
text-anchor 和 transform（矩阵全支持；旋转的矩形和文字按旋转的框算）；path 支持 M L H V C S Q T A Z（绝对和相对，
曲线按 8 段折线，弧线按直线近似并提示），Z 补闭合边；<defs>、<clipPath>、<mask>、<symbol> 里的不算；
display="none"、visibility="hidden" 的不算。<use>、<image> 不处理（提示）。
legacy 读法的已知毛病（2026-11-01 通用化时发现）：<rect> 的 width 会被 stroke-width 的值覆盖（正则 \\bwidth
在「stroke-width」的连字符后也算词边界），有描边的矩形只剩一条竖线宽；旋转的矩形按「长边/2＋1」的圆算；
闭合路径不补闭合边；<text> 的 text-anchor="end" 按 start 算。
"""
import argparse
import html
import json
import math
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import map_labels as ml  # noqa: E402

DEFAULT_PLACE = {
    "width": 360, "margin": 3.0, "step": 2.5, "cell": 24.0, "gap_label": 8.0, "own_ratio": 0.6,
    "frame_pad": 4.0, "line_height": 1.1, "rect_max": 400.0, "area_ids": [],
    "fixed_kinds": ["legend"], "fixed_as_obstacles": True, "priority": [], "lines": {}, "anchors": [],
    "point": {}, "line": {}, "area": {}, "within": [], "within_margin": None,
    "text_char_em": 0.6, "text_descent": 2.0, "svg_parse": "default", "out": None,
}
DEFAULT_POINT = {"dirs": [0, 315, 45, 180, 225, 135, 270, 90], "dir_step": 5, "gap_min": 2, "gap_max": 40}
DEFAULT_LINE = {"max_dist": 420, "resample": 5.0, "tangent_span": 40.0, "offsets": [0.0, 6.0, 12.0],
                "offset_cost": 3, "clearance": 2.6}
DEFAULT_AREA = {"radius": {"*": 60}, "ring_step": 6, "arc_step": 6}
DIR_NAMES = {0: "右", 315: "右上", 45: "右下", 180: "左", 225: "左上", 135: "左下", 270: "上", 90: "下"}


def place_opts(cfg):
    P = {**DEFAULT_PLACE, **cfg.get("place", {})}
    P["point"] = {**DEFAULT_POINT, **P["point"]}
    P["line"] = {**DEFAULT_LINE, **P["line"]}
    P["area"] = {**DEFAULT_AREA, **P["area"]}
    if P["within_margin"] is None:
        P["within_margin"] = P["margin"]
    return P


# ---------- SVG：legacy 读法（照搬 泗阳县 交通图v2/place_labels_v2.py，只为回归） ----------

def parse_svg_legacy(svg, P):
    segs, rects, circles = [], [], []
    for m in re.finditer(r"<path\b([^>]*)>", svg):
        a = m.group(1)
        st = re.search(r'\bstroke="([^"]+)"', a)
        if not st or st.group(1) == "none" or any(f'id="{i}"' in a for i in P["area_ids"]):
            continue
        d = re.search(r'\bd="([^"]*)"', a)
        if not d:
            continue
        hw = float(re.search(r'stroke-width="([^"]+)"', a).group(1)) / 2 if "stroke-width" in a else 0.5
        for sub in re.split(r"(?=M)", d.group(1)):
            pts = [tuple(map(float, p.split(","))) for p in re.findall(r"-?[\d.]+,-?[\d.]+", sub)]
            for p, q in zip(pts, pts[1:]):
                segs.append((p, q, hw))
    for m in re.finditer(r"<rect\b([^>]*)>", svg):
        a = m.group(1)
        g = {"x": 0.0, "y": 0.0, **{k: float(v) for k, v in re.findall(r'\b(x|y|width|height)="(-?[\d.]+)"', a)}}
        tr = re.search(r'translate\((-?[\d.]+),(-?[\d.]+)\)', a)
        if tr:
            circles.append((float(tr.group(1)), float(tr.group(2)), max(g["width"], g["height"]) / 2 + 1))
        elif g.get("width", 0) < P["rect_max"] and g.get("height", 0) < P["rect_max"]:
            rects.append((g["x"], g["y"], g["x"] + g["width"], g["y"] + g["height"]))
    for m in re.finditer(r"<circle\b([^>]*)>", svg):
        g = {k: float(v) for k, v in re.findall(r'\b(cx|cy|r|stroke-width)="(-?[\d.]+)"', m.group(1))}
        circles.append((g["cx"], g["cy"], g["r"] + g.get("stroke-width", 0) / 2))
    for m in re.finditer(r"<text\b([^>]*)>([^<]*)</text>", svg):
        g = {k: float(v) for k, v in re.findall(r'\b(x|y|font-size)="(-?[\d.]+)"', m.group(1))}
        w = len(m.group(2)) * g["font-size"] * P["text_char_em"]
        x0 = g["x"] - w / 2 if 'text-anchor="middle"' in m.group(1) else g["x"]
        rects.append((x0, g["y"] - g["font-size"], x0 + w, g["y"] + P["text_descent"]))
    return {"segs": segs, "rects": rects, "oboxes": [], "circles": circles}


def polyline_legacy(svg, pid):
    m = re.search(r'<path id="%s" d="([^"]+)"' % re.escape(pid), svg)
    if not m:
        raise SystemExit(f"SVG 里找不到 <path id=\"{pid}\" d=…>")
    out = []
    for sub in re.split(r"(?=M)", m.group(1)):
        pts = [tuple(map(float, p.split(","))) for p in re.findall(r"-?[\d.]+,-?[\d.]+", sub)]
        if len(pts) > 1:
            out.append(pts)
    return out


# ---------- SVG：default 读法 ----------

TAG_RE = re.compile(r"<!--.*?-->|<!\[CDATA\[.*?\]\]>|<\?.*?\?>|<!DOCTYPE[^>]*>"
                    r"|<(/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=>/]+\s*=\s*(?:\"[^\"]*\"|'[^']*'))*)\s*(/?)>", re.S)
ATTR_RE = re.compile(r"([^\s=>/]+)\s*=\s*(?:\"([^\"]*)\"|'([^']*)')")
NUM = r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?"
PATH_TOK = re.compile(r"([MmLlHhVvCcSsQqTtAaZz])|(" + NUM + ")")
NON_RENDER = {"defs", "clipPath", "mask", "symbol", "pattern", "marker", "linearGradient", "radialGradient",
              "filter", "title", "desc", "metadata", "style", "script"}
INHERIT = ("stroke", "stroke-width", "fill", "font-size", "text-anchor", "visibility")
IDENT = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
CURVE_STEPS = 8


def num(s, default=None):
    m = re.match(r"\s*(" + NUM + ")", s or "")
    return float(m.group(1)) if m else default


def mat_mul(m, n):
    a, b, c, d, e, f = m
    A, B, C, D, E, F = n
    return (a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f)


def parse_transform(s):
    m = IDENT
    for name, args in re.findall(r"(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)", s or ""):
        v = [float(x) for x in re.findall(NUM, args)]
        if name == "matrix" and len(v) == 6:
            t = tuple(v)
        elif name == "translate":
            t = (1.0, 0.0, 0.0, 1.0, v[0], v[1] if len(v) > 1 else 0.0)
        elif name == "scale":
            t = (v[0], 0.0, 0.0, v[1] if len(v) > 1 else v[0], 0.0, 0.0)
        elif name == "rotate":
            r = math.radians(v[0])
            t = (math.cos(r), math.sin(r), -math.sin(r), math.cos(r), 0.0, 0.0)
            if len(v) == 3:
                t = mat_mul(mat_mul((1.0, 0.0, 0.0, 1.0, v[1], v[2]), t), (1.0, 0.0, 0.0, 1.0, -v[1], -v[2]))
        elif name == "skewX":
            t = (1.0, 0.0, math.tan(math.radians(v[0])), 1.0, 0.0, 0.0)
        elif name == "skewY":
            t = (1.0, math.tan(math.radians(v[0])), 0.0, 1.0, 0.0, 0.0)
        else:
            continue
        m = mat_mul(m, t)
    return m


def apply(m, x, y):
    if m == IDENT:
        return x, y
    a, b, c, d, e, f = m
    return a * x + c * y + e, b * x + d * y + f


def mat_scale(m):
    return math.sqrt(abs(m[0] * m[3] - m[1] * m[2])) if m != IDENT else 1.0


def mat_angle(m):
    return math.atan2(m[1], m[0]) if m != IDENT else 0.0


def path_subpaths(d, warn):
    """path 的 d → [[点列, 是否闭合], …]（未变换的坐标）。曲线按 CURVE_STEPS 段折线；弧线按直线近似。"""
    toks = PATH_TOK.findall(d or "")
    subs, pts = [], None
    cx = cy = sx = sy = 0.0
    cmd, ctrl, ctrl_kind = None, None, None
    i, n = 0, len(toks)

    def take(k):
        nonlocal i
        if i + k > n or any(toks[j][0] for j in range(i, i + k)):
            raise SystemExit(f"path 数据不完整：{d[:80]}…")
        v = [float(toks[j][1]) for j in range(i, i + k)]
        i += k
        return v

    def new_sub(x, y):
        nonlocal pts
        pts = [(x, y)]
        subs.append([pts, False])

    while i < n:
        if toks[i][0]:
            cmd = toks[i][0]
            i += 1
            if cmd in "Zz":
                if pts is not None:
                    subs[-1][1] = True
                cx, cy, pts, ctrl, ctrl_kind = sx, sy, None, None, None
                continue
        if cmd is None:
            raise SystemExit(f"path 不以 M 开头：{d[:80]}…")
        rel, C = cmd.islower(), cmd.upper()
        ox, oy = (cx, cy) if rel else (0.0, 0.0)
        if C == "M":
            x, y = take(2)
            cx, cy = sx, sy = x + ox, y + oy
            new_sub(cx, cy)
            cmd, ctrl, ctrl_kind = ("l" if rel else "L"), None, None
            continue
        if pts is None:
            new_sub(cx, cy)
        if C == "L":
            x, y = take(2)
            cx, cy = x + ox, y + oy
            pts.append((cx, cy))
            ctrl_kind = None
        elif C == "H":
            cx = take(1)[0] + ox
            pts.append((cx, cy))
            ctrl_kind = None
        elif C == "V":
            cy = take(1)[0] + oy
            pts.append((cx, cy))
            ctrl_kind = None
        elif C in "CS":
            if C == "C":
                x1, y1, x2, y2, x, y = take(6)
                x1, y1 = x1 + ox, y1 + oy
            else:
                x2, y2, x, y = take(4)
                x1, y1 = (2 * cx - ctrl[0], 2 * cy - ctrl[1]) if ctrl_kind == "C" else (cx, cy)
            x2, y2, x, y = x2 + ox, y2 + oy, x + ox, y + oy
            for k in range(1, CURVE_STEPS + 1):
                t = k / CURVE_STEPS
                u = 1 - t
                pts.append((u ** 3 * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x,
                            u ** 3 * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y))
            cx, cy, ctrl, ctrl_kind = x, y, (x2, y2), "C"
        elif C in "QT":
            if C == "Q":
                x1, y1, x, y = take(4)
                x1, y1 = x1 + ox, y1 + oy
            else:
                x, y = take(2)
                x1, y1 = (2 * cx - ctrl[0], 2 * cy - ctrl[1]) if ctrl_kind == "Q" else (cx, cy)
            x, y = x + ox, y + oy
            for k in range(1, CURVE_STEPS + 1):
                t = k / CURVE_STEPS
                u = 1 - t
                pts.append((u * u * cx + 2 * u * t * x1 + t * t * x, u * u * cy + 2 * u * t * y1 + t * t * y))
            cx, cy, ctrl, ctrl_kind = x, y, (x1, y1), "Q"
        elif C == "A":
            _, _, _, _, _, x, y = take(7)
            cx, cy = x + ox, y + oy
            pts.append((cx, cy))
            ctrl_kind = None
            warn("path 里有弧线（A），按直线近似")
        else:
            raise SystemExit(f"不认识的 path 命令 {cmd}")
    return subs


def element_attrs(attr_text):
    a = {k: (v1 if v1 or not v2 else v2) for k, v1, v2 in ATTR_RE.findall(attr_text or "")}
    a = {k: html.unescape(v) for k, v in a.items()}
    for decl in a.get("style", "").split(";"):
        if ":" in decl:
            k, v = decl.split(":", 1)
            a[k.strip()] = v.strip()
    return a


def parse_svg(svg, P):
    """default 读法：返回障碍物（segs、rects、oboxes、circles）和按 id 的几何（geoms：id → [[点列, 闭合], …]，已变换）。"""
    segs, rects, oboxes, circles, geoms = [], [], [], [], {}
    warned = set()

    def warn(msg):
        if msg not in warned:
            warned.add(msg)
            print("提示：" + msg, file=sys.stderr)

    stack = [{"tag": None, "m": IDENT, "inh": {}, "hidden": False, "nonrender": False}]
    pos = 0
    for mt in TAG_RE.finditer(svg):
        if mt.start() < pos or mt.group(2) is None:
            continue
        closing, tag, attr_text, selfclose = mt.group(1), mt.group(2), mt.group(3), mt.group(4)
        local = tag.split(":")[-1]
        if closing:
            if len(stack) > 1 and stack[-1]["tag"] == local:
                stack.pop()
            continue
        parent = stack[-1]
        a = element_attrs(attr_text)
        m = mat_mul(parent["m"], parse_transform(a["transform"])) if "transform" in a else parent["m"]
        inh = {**parent["inh"], **{k: a[k] for k in INHERIT if k in a}}
        hidden = parent["hidden"] or a.get("display") == "none" or inh.get("visibility") in ("hidden", "collapse")
        nonrender = parent["nonrender"] or local in NON_RENDER
        ctx = {"tag": local, "m": m, "inh": inh, "hidden": hidden, "nonrender": nonrender}
        if not selfclose and local != "text":
            stack.append(ctx)
        active = not hidden and not nonrender
        stroke = inh.get("stroke", "none")
        stroked = stroke not in ("none", "transparent", "")
        sw = num(inh.get("stroke-width"), 1.0) * mat_scale(m)
        filled = inh.get("fill", "black") not in ("none", "transparent", "")
        sub = None
        if local == "path":
            sub = path_subpaths(a.get("d", ""), warn)
        elif local == "line":
            sub = [[[(num(a.get("x1"), 0.0), num(a.get("y1"), 0.0)), (num(a.get("x2"), 0.0), num(a.get("y2"), 0.0))], False]]
        elif local in ("polyline", "polygon"):
            v = [float(x) for x in re.findall(NUM, a.get("points", ""))]
            sub = [[list(zip(v[0::2], v[1::2])), local == "polygon"]]
        if sub is not None:
            sub = [[[apply(m, x, y) for x, y in pts], closed] for pts, closed in sub]
            if "id" in a:
                geoms[a["id"]] = sub
            if active and stroked and a.get("id") not in P["area_ids"]:
                for pts, closed in sub:
                    ring = pts + [pts[0]] if closed and len(pts) > 2 and pts[-1] != pts[0] else pts
                    for p, q in zip(ring, ring[1:]):
                        segs.append((p, q, sw / 2))
            continue
        if local == "rect":
            if "%" in a.get("width", "") + a.get("height", ""):   # width="100%" 之类：底色
                continue
            x, y, w, h = (num(a.get(k), 0.0) for k in ("x", "y", "width", "height"))
            corners = [apply(m, *c) for c in ((x, y), (x + w, y), (x + w, y + h), (x, y + h))]
            if "id" in a:
                geoms[a["id"]] = [[corners, True]]
            if not active or not (filled or stroked) or a.get("id") in P["area_ids"]:
                continue
            sc = mat_scale(m)
            pad = sw / 2 if stroked else 0.0
            if w * sc < P["rect_max"] and h * sc < P["rect_max"]:
                if m[1] == 0 and m[2] == 0 and m[0] > 0 and m[3] > 0:
                    (x0, y0), (x1, y1) = corners[0], corners[2]
                    rects.append((x0 - pad, y0 - pad, x1 + pad, y1 + pad))
                else:
                    ccx, ccy = apply(m, x + w / 2, y + h / 2)
                    oboxes.append((ccx, ccy, w * sc / 2 + pad, h * sc / 2 + pad, mat_angle(m)))
            elif stroked:
                ring = corners + [corners[0]]
                for p, q in zip(ring, ring[1:]):
                    segs.append((p, q, sw / 2))
            continue
        if local in ("circle", "ellipse"):
            if not active or not (filled or stroked):
                continue
            r = num(a.get("r"), 0.0) if local == "circle" else max(num(a.get("rx"), 0.0), num(a.get("ry"), 0.0))
            ccx, ccy = apply(m, num(a.get("cx"), 0.0), num(a.get("cy"), 0.0))
            circles.append((ccx, ccy, r * mat_scale(m) + (sw / 2 if stroked else 0.0)))
            continue
        if local == "text":
            end = svg.find("</text>", mt.end()) if not selfclose else mt.end()
            if end < 0:
                end = mt.end()
            content = html.unescape(re.sub(r"<[^>]*>", "", svg[mt.end():end])).strip() if not selfclose else ""
            pos = end
            if not active or not content:
                continue
            fs = num(inh.get("font-size"), 16.0)
            tx, ty = num(a.get("x"), 0.0), num(a.get("y"), 0.0)
            w = len(content) * fs * P["text_char_em"]
            anchor = inh.get("text-anchor", "start")
            x0 = tx - w / 2 if anchor == "middle" else (tx - w if anchor == "end" else tx)
            y0, y1 = ty - fs, ty + P["text_descent"]
            if m == IDENT:
                rects.append((x0, y0, x0 + w, y1))
            else:
                sc = mat_scale(m)
                ccx, ccy = apply(m, x0 + w / 2, (y0 + y1) / 2)
                oboxes.append((ccx, ccy, w * sc / 2, (y1 - y0) * sc / 2, mat_angle(m)))
            continue
        if local in ("use", "image") and active:
            warn(f"<{local}> 不处理（里面的线、字不算障碍）")
    return {"segs": segs, "rects": rects, "oboxes": oboxes, "circles": circles, "geoms": geoms}


# ---------- 几何 ----------

def seg_dist(px, py, a, b):
    (x1, y1), (x2, y2) = a, b
    dx, dy = x2 - x1, y2 - y1
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / L))
    return math.hypot(px - x1 - t * dx, py - y1 - t * dy)


def seg_hits_box(u1, v1, u2, v2, bu, bv):
    """线段（字框局部坐标）和 [-bu,bu]×[-bv,bv] 相交吗（Liang–Barsky）。"""
    du, dv = u2 - u1, v2 - v1
    t0, t1 = 0.0, 1.0
    for p, q in ((-du, u1 + bu), (du, bu - u1), (-dv, v1 + bv), (dv, bv - v1)):
        if p == 0:
            if q < 0:
                return False
        else:
            t = q / p
            if p < 0:
                if t > t1:
                    return False
                t0 = max(t0, t)
            else:
                if t < t0:
                    return False
                t1 = min(t1, t)
    return True


class Polygon:
    """within 约束用的多边形（奇偶规则，多个环＝外环加洞）。"""

    def __init__(self, rings, cell):
        self.cell = cell
        self.edges, self.grid, self.rows = [], {}, {}
        for pts, _ in rings:
            if len(pts) < 3:
                continue
            ring = pts + [pts[0]] if pts[-1] != pts[0] else pts
            for p, q in zip(ring, ring[1:]):
                k = len(self.edges)
                self.edges.append((p, q))
                for gx in range(int(min(p[0], q[0]) // cell), int(max(p[0], q[0]) // cell) + 1):
                    for gy in range(int(min(p[1], q[1]) // cell), int(max(p[1], q[1]) // cell) + 1):
                        self.grid.setdefault((gx, gy), []).append(k)
                for gy in range(int(min(p[1], q[1]) // cell), int(max(p[1], q[1]) // cell) + 1):
                    self.rows.setdefault(gy, []).append(k)
        if not self.edges:
            raise SystemExit("within 的多边形没有闭合的环")

    def contains_point(self, px, py):
        inside = False
        for k in self.rows.get(int(py // self.cell), ()):
            (x1, y1), (x2, y2) = self.edges[k]
            if (y1 > py) != (y2 > py) and x1 + (py - y1) * (x2 - x1) / (y2 - y1) > px:
                inside = not inside
        return inside

    def contains_box(self, cx, cy, hw, hh, ang, margin):
        if not self.contains_point(cx, cy):
            return False
        bu, bv = hw + margin, hh + margin
        R = math.hypot(bu, bv)
        c, s = math.cos(ang), math.sin(ang)
        seen = set()
        for gx in range(int((cx - R) // self.cell), int((cx + R) // self.cell) + 1):
            for gy in range(int((cy - R) // self.cell), int((cy + R) // self.cell) + 1):
                for k in self.grid.get((gx, gy), ()):
                    if k in seen:
                        continue
                    seen.add(k)
                    (x1, y1), (x2, y2) = self.edges[k]
                    u1, v1 = (x1 - cx) * c + (y1 - cy) * s, -(x1 - cx) * s + (y1 - cy) * c
                    u2, v2 = (x2 - cx) * c + (y2 - cy) * s, -(x2 - cx) * s + (y2 - cy) * c
                    if seg_hits_box(u1, v1, u2, v2, bu, bv):
                        return False
        return True


class World:
    def __init__(self, obst, W, H, P):
        self.segs, self.rects = obst["segs"], list(obst["rects"])
        self.oboxes, self.circles = list(obst["oboxes"]), list(obst["circles"])
        self.W, self.H, self.P = W, H, P
        self.M, self.cell, self.pad = P["margin"], P["cell"], P["frame_pad"]
        self.grid = {}
        for i, (a, b, hw) in enumerate(self.segs):
            r = hw + self.M
            for gx in range(int((min(a[0], b[0]) - r) // self.cell), int((max(a[0], b[0]) + r) // self.cell) + 1):
                for gy in range(int((min(a[1], b[1]) - r) // self.cell), int((max(a[1], b[1]) + r) // self.cell) + 1):
                    self.grid.setdefault((gx, gy), []).append(i)
        self.placed = []   # 已放好的标签：(中心, 半宽, 半高, 角度)

    def hit(self, px, py):
        M = self.M
        if not (self.pad <= px <= self.W - self.pad and self.pad <= py <= self.H - self.pad):
            return "出图幅"
        for i in self.grid.get((int(px // self.cell), int(py // self.cell)), ()):
            a, b, hw = self.segs[i]
            if seg_dist(px, py, a, b) < hw + M:
                return "线"
        for x0, y0, x1, y1 in self.rects:
            if x0 - M <= px <= x1 + M and y0 - M <= py <= y1 + M:
                return "框"
        for cx, cy, hw, hh, ang in self.oboxes:
            c, s = math.cos(ang), math.sin(ang)
            u, v = (px - cx) * c + (py - cy) * s, -(px - cx) * s + (py - cy) * c
            if abs(u) <= hw + M and abs(v) <= hh + M:
                return "框"
        for cx, cy, r in self.circles:
            if math.hypot(px - cx, py - cy) < r + M:
                return "点"
        G = self.P["gap_label"]
        for (cx, cy), hw, hh, ang in self.placed:
            c, s = math.cos(-ang), math.sin(-ang)
            u, v = (px - cx) * c - (py - cy) * s, (px - cx) * s + (py - cy) * c
            if abs(u) <= hw + G and abs(v) <= hh + G:
                return "字"
        return None

    def free(self, cx, cy, hw, hh, ang=0.0, within=None):
        if within is not None and not within.contains_box(cx, cy, hw, hh, ang, self.P["within_margin"]):
            return "界外"
        step = self.P["step"]
        c, s = math.cos(ang), math.sin(ang)
        nu, nv = max(2, int(2 * hw / step) + 1), max(2, int(2 * hh / step) + 1)
        for i in range(nu):
            u = -hw + 2 * hw * i / (nu - 1)
            for j in range(nv):
                v = -hh + 2 * hh * j / (nv - 1)
                why = self.hit(cx + u * c - v * s, cy + u * s + v * c)
                if why:
                    return why
        return None


def half_size(lb, width, w_svg, cfg, P):
    """字框的半宽、半高（SVG 像素）：宽按 map_labels.text_size，高 × line_height。"""
    style = ml.style_of(cfg, width, lb)
    w, h = ml.text_size(lb, style, cfg)
    s = width / w_svg
    if lb.get("vertical"):
        return w * P["line_height"] / s / 2, h / s / 2
    return w / s / 2, h * P["line_height"] / s / 2


def tangent(pts, k, span):
    """折线上第 k 点附近、前后各走 span 的弦方向（折到 ±90° 以内，字不倒着写）。"""
    def walk(step):
        i, acc = k, 0.0
        while 0 <= i + step < len(pts) and acc < span:
            acc += math.dist(pts[i], pts[i + step])
            i += step
        return pts[i]
    a, b = walk(-1), walk(1)
    ang = math.atan2(b[1] - a[1], b[0] - a[0])
    if ang > math.pi / 2:
        ang -= math.pi
    if ang <= -math.pi / 2:
        ang += math.pi
    return ang


def resample(pts, step):
    out = [pts[0]]
    for p, q in zip(pts, pts[1:]):
        L = math.dist(p, q)
        n = int(L // step)
        for i in range(1, n + 1):
            t = i * step / L
            out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
        if out[-1] != q:
            out.append(q)
    return out


def lookup(meta, path, lb, rule):
    cur = meta
    try:
        for part in path.split("/"):
            part = part.replace("{name}", lb["name"])
            if "{index}" in part:
                part = part.replace("{index}", str(rule["names"].index(lb["name"])))
            cur = cur[int(part)] if isinstance(cur, list) else cur[part]
    except (KeyError, IndexError, ValueError, TypeError):
        return None
    return cur


def anchor_of(lb, meta, rules):
    for rule in rules:
        if "kinds" in rule and lb["kind"] not in rule["kinds"]:
            continue
        if "names" in rule and lb["name"] not in rule["names"]:
            continue
        v = lb.get(rule["field"]) if "field" in rule else lookup(meta, rule["xy"], lb, rule)
        if v is None:
            continue
        return tuple(v[:2]), rule["r"]
    return None


def fill_fields(tpl, lb):
    def rep(m):
        if m.group(1) not in lb:
            raise KeyError(m.group(1))
        return str(lb[m.group(1)])
    return re.sub(r"\{(\w+)\}", rep, tpl)


def within_id(lb, rules):
    if "within" in lb:
        return lb["within"] or None
    for rule in rules:
        if "kinds" in rule and lb["kind"] not in rule["kinds"]:
            continue
        if "names" in rule and lb["name"] not in rule["names"]:
            continue
        try:
            return fill_fields(rule["id"], lb)
        except KeyError:
            continue
    return None


def main():
    ap = argparse.ArgumentParser(description="标签自动避让（用法见脚本开头）")
    ap.add_argument("config")
    ap.add_argument("--labels")
    ap.add_argument("--svg")
    ap.add_argument("--out")
    ap.add_argument("--width", type=int)
    ap.add_argument("--report")
    a = ap.parse_args()
    cfg = ml.load_config(a.config)
    P = place_opts(cfg)
    width = a.width or P["width"]
    labels_path = a.labels or ml.resolve(cfg, cfg["labels"])
    svg_path = a.svg or ml.resolve(cfg, cfg["svg"])
    out_path = a.out or (ml.resolve(cfg, P["out"]) if P["out"] else labels_path)
    with open(labels_path, encoding="utf-8") as f:
        meta = json.load(f)
    with open(svg_path, encoding="utf-8") as f:
        svg = f.read()
    W, H = meta["width"], meta["height"]
    legacy = P["svg_parse"] == "legacy"
    obst = parse_svg_legacy(svg, P) if legacy else parse_svg(svg, P)
    world = World(obst, W, H, P)
    labels = meta["labels"]

    def line_of(lb):
        pid = lb.get("line") or P["lines"].get(lb["name"])
        if not pid:
            return None
        if legacy:
            return polyline_legacy(svg, pid)
        if pid not in obst["geoms"]:
            raise SystemExit(f"SVG 里找不到 id=\"{pid}\" 的线（标签「{lb['name']}」）")
        return [pts + [pts[0]] if closed and pts[-1] != pts[0] else pts
                for pts, closed in obst["geoms"][pid] if len(pts) > 1]

    polys = {}

    def within_of(lb):
        pid = within_id(lb, P["within"])
        if not pid:
            return None
        if pid not in polys:
            if legacy or pid not in obst["geoms"]:
                raise SystemExit(f"within：SVG 里找不到 id=\"{pid}\" 的多边形（标签「{lb['name']}」；legacy 读法不支持 within）")
            polys[pid] = Polygon(obst["geoms"][pid], P["cell"])
        return polys[pid]

    line_ids = {}
    for lb in labels:
        pl = line_of(lb)
        if pl is not None:
            line_ids[lb["name"]] = pl
    anchors = {}
    for lb in labels:
        an = anchor_of(lb, meta, P["anchors"])
        if an is not None:
            anchors[lb["name"]] = an

    def center(lb, hw):
        x, y = lb["x"], lb["y"]
        if lb.get("anchor") == "start":
            x += hw
        elif lb.get("anchor") == "end":
            x -= hw
        return x, y

    def is_fixed(lb):
        return lb.get("fixed") or lb["kind"] in P["fixed_kinds"]

    if P["fixed_as_obstacles"]:
        for lb in labels:
            if is_fixed(lb) and not lb.get(f"skip{width}"):
                hw, hh = half_size(lb, width, W, cfg, P)
                world.placed.append((center(lb, hw), hw, hh, math.radians(lb.get("angle", 0))))

    pri = P["priority"]
    order = sorted((i for i, lb in enumerate(labels) if not is_fixed(lb)),
                   key=lambda i: (pri.index(labels[i]["kind"]) if labels[i]["kind"] in pri else 99, i))
    PP, PL, PA = P["point"], P["line"], P["area"]
    margin, own_ratio = P["margin"], P["own_ratio"]
    report, failed = [], 0
    for i in order:
        lb = labels[i]
        if lb.get(f"skip{width}"):
            continue
        hw, hh = half_size(lb, width, W, cfg, P)
        x0, y0 = center(lb, hw)
        poly = within_of(lb)
        cands = []   # (代价, x, y, 角度弧度, 名称)
        if lb["name"] in anchors:
            (px, py), r = anchors[lb["name"]]
            pref = list(PP["dirs"])
            degs = pref + [d for d in range(0, 360, PP["dir_step"]) if d not in pref]
            clip = lambda v: max(-1.0, min(1.0, v))   # noqa: E731
            for j, deg in enumerate(degs):
                th = math.radians(deg)
                c, s_ = math.cos(th), math.sin(th)
                for g in range(PP["gap_min"], PP["gap_max"] + 1):
                    x = px + c * (r + g) + hw * clip(2 * c)
                    y = py + s_ * (r + g) + hh * clip(2 * s_)
                    edge = math.hypot(max(abs(px - x) - hw, 0), max(abs(py - y) - hh, 0))
                    cands.append((round(edge) * 1000 + j, x, y, 0.0, DIR_NAMES.get(deg, f"{deg:g}°") + f"·{g:g}"))
        elif lb["name"] in line_ids:
            for pts in line_ids[lb["name"]]:
                rs = resample(pts, PL["resample"])
                for k, p in enumerate(rs):
                    dist = math.dist(p, (x0, y0))
                    if dist > PL["max_dist"]:
                        continue
                    ang = tangent(rs, k, PL["tangent_span"])
                    for extra in PL["offsets"]:
                        off = hh + PL["clearance"] + margin + 1 + extra
                        for side in (1, -1):
                            x = p[0] - math.sin(ang) * off * side
                            y = p[1] + math.cos(ang) * off * side
                            cands.append((math.dist((x, y), (x0, y0)) + extra * PL["offset_cost"], x, y, ang, "沿线"))
        else:
            ang = math.radians(lb.get("angle", 0))
            rad = PA["radius"]
            lim = rad.get(lb["kind"], rad.get("*", 60))
            for rr in range(0, lim + 1, PA["ring_step"]):
                n = max(1, int(2 * math.pi * rr / PA["arc_step"]))
                for t in range(n):
                    th = 2 * math.pi * t / n
                    cands.append((rr + t * 1e-6, x0 + rr * math.cos(th), y0 + rr * math.sin(th), ang, "附近"))
        cands.sort(key=lambda c: (round(c[0], 6), round(c[1], 3), round(c[2], 3)))
        if lb["name"] in anchors:   # 点状注记：候选都不行时才退回原位置
            cands.append((1e9, x0, y0, math.radians(lb.get("angle", 0)), "原位"))
        chosen, why0 = None, world.free(x0, y0, hw, hh, math.radians(lb.get("angle", 0)), poly)

        def owns(x, y):
            if lb["name"] not in anchors:
                return True

            def bd(p):   # 点到字框的距离
                return math.hypot(max(abs(p[0] - x) - hw, 0), max(abs(p[1] - y) - hh, 0))
            mine = bd(anchors[lb["name"]][0])
            others = [bd(a_) for n_, (a_, r_) in anchors.items() if n_ != lb["name"]]
            return not others or mine < own_ratio * min(others)

        for cost, x, y, ang, nm in cands:
            if owns(x, y) and not world.free(x, y, hw, hh, ang, poly):
                chosen = (x, y, ang, nm)
                break
        if chosen is None:
            why = Counter(world.free(x, y, hw, hh, ang, poly) for _, x, y, ang, _ in cands[:400])
            report.append(f"放不下：{lb['name']}（原位置压{why0}；前 {min(400, len(cands))} 个候选：{dict(why)}）")
            failed += 1
            chosen = (x0, y0, math.radians(lb.get("angle", 0)), "原位")
        x, y, ang, nm = chosen
        moved = math.dist((x, y), (x0, y0))
        report.append(f"{lb['name']}：原位置{'压' + why0 if why0 else '不压'} → {nm}，移动 {moved:.0f}")
        lb["x"], lb["y"] = round(x, 1), round(y, 1)
        lb.pop("anchor", None)
        if lb["name"] in line_ids or lb.get("angle"):
            lb["angle"] = round(math.degrees(ang), 1)
        world.placed.append(((x, y), hw, hh, ang))
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    report.append(f"放不下 {failed} 个（显示宽度 {width}px，SVG 读法 {P['svg_parse']}）→ {out_path}")
    text = "\n".join(report)
    print(text)
    if a.report:
        with open(a.report, "w", encoding="utf-8") as f:
            f.write(text + "\n")


if __name__ == "__main__":
    main()
