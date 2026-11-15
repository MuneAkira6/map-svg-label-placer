#!/usr/bin/env python3
"""Run the Python reference (reference/python/map_place_labels.py) on one fixture and dump what the
TypeScript port must reproduce: every label's chosen position (not rounded), how it was found, why the
original position was rejected, the "could not place" list, and a summary of the obstacles read from the SVG.

The reference file is not modified. Two things are patched from outside:
  - the module-level name `round`, so that the final `round(x, 1)` on x, y and angle is skipped;
  - `World.placed`, to record each placement in order.

Usage: python3 -I -X utf8 reference/oracle.py fixtures/<case>/config.json [--width N] > fixtures/<case>/expected.json
"""
import ast
import builtins
import contextlib
import io
import json
import math
import os
import platform
import re
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "python"))
import map_place_labels as mpl  # noqa: E402


def no_round_1(x, n=None):
    if n == 1:
        return x
    return builtins.round(x) if n is None else builtins.round(x, n)


class Recorder(list):
    pass


class RecordingWorld(mpl.World):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.placed = Recorder()
        RecordingWorld.last = self


captured = {}
_parse_svg = mpl.parse_svg


def parse_svg(svg, P):
    obst = _parse_svg(svg, P)
    captured["obst"] = obst
    return obst


def summary(obst):
    def flat(v):
        if isinstance(v, (int, float)):
            yield float(v)
        else:
            for x in v:
                yield from flat(x)
    out = {}
    for k in ("segs", "rects", "oboxes", "circles"):
        vals = list(flat(obst[k]))
        out[k] = {"count": len(obst[k]), "sum": math.fsum(vals), "abs_sum": math.fsum(abs(x) for x in vals)}
    geoms = obst["geoms"]
    out["geoms"] = {gid: {"rings": len(g), "points": sum(len(p) for p, _ in g),
                          "closed": sum(1 for _, c in g if c),
                          "sum": math.fsum(c for p, _ in g for pt in p for c in pt)}
                    for gid, g in sorted(geoms.items())}
    return out


LINE_RE = re.compile(r"^(?P<name>.+)：原位置(?:压(?P<why0>.+?)|不压) → (?P<how>.+)，移动 (?P<moved>\d+)$")
FAIL_RE = re.compile(r"^放不下：(?P<name>.+?)（原位置压(?P<why0>.+?)；前 (?P<n>\d+) 个候选：(?P<why>\{.*\})）$")


def main():
    args = sys.argv[1:]
    config = args[0]
    extra = args[1:]
    mpl.round = no_round_1
    mpl.World = RecordingWorld
    mpl.parse_svg = parse_svg
    with tempfile.TemporaryDirectory() as tmp:
        out_path = os.path.join(tmp, "placed.json")
        sys.argv = ["map_place_labels.py", config, "--out", out_path, *extra]
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            mpl.main()
        with open(out_path, encoding="utf-8") as f:
            placed_doc = json.load(f)
    report = stdout.getvalue().splitlines()
    regular, failed = [], []
    for line in report[:-1]:
        m = FAIL_RE.match(line)
        if m:
            failed.append({"name": m["name"], "why0": None if m["why0"] == "None" else m["why0"],
                           "checked": int(m["n"]), "why": ast.literal_eval(m["why"])})
            continue
        m = LINE_RE.match(line)
        if not m:
            raise SystemExit(f"oracle: cannot parse report line: {line}")
        regular.append(m)
    placed = list(RecordingWorld.last.placed)[-len(regular):] if regular else []
    placements = []
    for m, ((x, y), hw, hh, ang) in zip(regular, placed):
        placements.append({"name": m["name"], "x": x, "y": y, "angle": ang, "hw": hw, "hh": hh,
                           "how": m["how"], "why0": m["why0"], "moved": int(m["moved"])})
    warnings = [w[len("提示："):] for w in stderr.getvalue().splitlines() if w.startswith("提示：")]
    json.dump({"python": platform.python_version(), "args": extra, "placements": placements, "failed": failed,
               "warnings": warnings, "summary_line": report[-1].split("→")[0].rstrip(), "labels": placed_doc["labels"],
               "obstacles": summary(captured["obst"])},
              sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
