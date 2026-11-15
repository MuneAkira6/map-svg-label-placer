#!/usr/bin/env python3
"""Test vectors for src/py.ts: CPython's round(), //, math.hypot, math.dist, radians, degrees.

Usage: python3 -I reference/py_vectors.py > test/py_vectors.json
"""
import json
import math
import random
import sys

rng = random.Random(20261115)
xs = [0.125, 2.5, 3.5, -2.5, 0.0625, 1.0005, 2.675, 0.5, -0.5, 1e-7, 123456.789, -0.04, 300.0625, 7.0, 0.0]
xs += [k / 16 + j for k in range(16) for j in (0, 1, 271)]
xs += [rng.uniform(-1000, 1000) for _ in range(300)]
xs += [round(rng.uniform(0, 600), 4) for _ in range(200)]
xs += [round(rng.uniform(0, 600), 1) + 0.05 for _ in range(100)]
rounds = [[x, n, round(x, n) if n is not None else round(x)] for x in xs for n in (None, 1, 3, 6)]
divs = []
for a, b in [(1.0, 0.1), (0.3, 0.1), (-1.0, 0.1), (7.5, 2.5), (-7.5, 2.5), (5.0, -2.0), (0.0, 3.0), (-0.0, 3.0)]:
    divs.append([a, b, a // b])
for _ in range(400):
    b = rng.choice([24.0, 5.0, 2.5, 6.0, 0.1, 3.3])
    a = rng.choice([rng.uniform(-500, 2000), b * rng.randint(-50, 80), b * rng.randint(0, 80) - 1e-13])
    divs.append([a, b, a // b])
hyp = []
for _ in range(500):
    x, y = rng.uniform(-800, 800), rng.uniform(-800, 800)
    if rng.random() < 0.2:
        x = float(rng.randint(-50, 50))
    hyp.append([x, y, math.hypot(x, y)])
hyp += [[3.0, 4.0, 5.0], [0.0, 0.0, 0.0], [1e-310, 2e-310, math.hypot(1e-310, 2e-310)], [1e300, 1e300, math.hypot(1e300, 1e300)]]
dists = []
for _ in range(300):
    p = (rng.uniform(0, 600), rng.uniform(0, 400))
    q = (rng.uniform(0, 600), rng.uniform(0, 400))
    dists.append([p, q, math.dist(p, q)])
angles = [[d, math.radians(d), math.degrees(math.radians(d))] for d in list(range(-360, 361, 5)) + [rng.uniform(-180, 180) for _ in range(100)]]
fmt_xs = xs + [1234567.0, 123456.5, 0.0001234, 0.00001234, -0.0, 1e21, 999999.5, 9999995.0, 0.5, 2.675, 1e-300, 123.456789]
fmt_xs += [round(rng.uniform(-50, 2000), 1) for _ in range(200)] + [rng.uniform(-1, 1) * 10 ** rng.randint(-8, 8) for _ in range(200)]
fmts = [[x, format(x, "g"), format(x, ".2f"), format(x, ".0f"), repr(x)] for x in fmt_xs]
json.dump({"format": fmts, "round": rounds, "floordiv": divs, "hypot": hyp, "dist": dists, "angles": angles}, sys.stdout)
