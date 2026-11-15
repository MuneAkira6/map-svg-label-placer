#!/usr/bin/env python3
"""Run the Python reference end to end on one fixture (map_place_labels.py, then map_labels.py) in a temporary
copy, and dump every file map_labels.py writes ({{Image label}} blocks and mock pages) plus its console lines.

Usage: python3 -I -X utf8 reference/oracle_wikitext.py fixtures/<case> > fixtures/<case>/expected_wikitext.json
"""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "python"))
import map_labels  # noqa: E402
import map_place_labels  # noqa: E402


def main():
    case = os.path.abspath(sys.argv[1])
    with tempfile.TemporaryDirectory() as tmp:
        work = os.path.join(tmp, "case")
        shutil.copytree(case, work)
        before = {os.path.relpath(os.path.join(d, f), work) for d, _, fs in os.walk(work) for f in fs}
        cfg = os.path.join(work, "config.json")
        placed = os.path.join(work, "placed.json")
        with contextlib.redirect_stdout(io.StringIO()):
            sys.argv = ["map_place_labels.py", cfg, "--out", placed]
            map_place_labels.main()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            sys.argv = ["map_labels.py", cfg, "--labels", placed, "--outdir", work]
            map_labels.main()
        files = {}
        for d, _, fs in os.walk(work):
            for f in fs:
                rel = os.path.relpath(os.path.join(d, f), work)
                if rel not in before and rel != "placed.json":
                    with open(os.path.join(d, f), encoding="utf-8") as fh:
                        files[rel.replace(os.sep, "/")] = fh.read()
    json.dump({"files": dict(sorted(files.items())), "console": out.getvalue().splitlines()},
              sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
