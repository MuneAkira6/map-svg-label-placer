#!/usr/bin/env node
// map-svg-label-placer <config.json> [--labels <file>] [--svg <file>] [--out <file>] [--width <px>] [--report <file>]
// Same config file and options as reference/python/map_place_labels.py. Relative paths in the config are
// relative to the config file. Without --out (or place.out in the config) the label file is overwritten.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Config, LabelDoc } from "./config.js";
import { placeLabels, type How, type Placement } from "./place.js";
import { pyRound } from "./py.js";

const USAGE = "usage: map-svg-label-placer <config.json> [--labels FILE] [--svg FILE] [--out FILE] [--width PX] [--report FILE]";
const DIRS: Record<number, string> = { 0: "right", 315: "upper right", 45: "lower right", 180: "left", 225: "upper left", 135: "lower left", 270: "above", 90: "below" };

function howText(h: How): string {
  switch (h.kind) {
    case "point":
      return `${DIRS[h.dir] ?? `${h.dir}°`} +${h.gap}`;
    case "line":
      return "along its line";
    case "area":
      return "nearby";
    case "original":
      return "original position";
  }
}

function reportLines(p: Placement): string[] {
  const lines: string[] = [];
  if (p.failure) {
    const why = Object.entries(p.failure.why).map(([k, v]) => `${k} ${v}`).join(", ");
    lines.push(`cannot place: ${p.name} (original position hits ${p.why0 ?? "nothing"}; first ${p.failure.checked} candidates: ${why})`);
  }
  lines.push(`${p.name}: original position ${p.why0 ? `hits ${p.why0}` : "is free"} -> ${howText(p.how)}, moved ${pyRound(p.moved)}`);
  return lines;
}

function main(argv: string[]): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        labels: { type: "string" },
        svg: { type: "string" },
        out: { type: "string" },
        width: { type: "string" },
        report: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    console.error(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  const { values: a, positionals } = parsed;
  if (a.help || positionals.length !== 1) {
    console.error(USAGE);
    return a.help ? 0 : 2;
  }
  const configPath = resolve(positionals[0]!);
  const cfg: Config = JSON.parse(readFileSync(configPath, "utf8"));
  const rel = (p: string) => (isAbsolute(p) ? p : join(dirname(configPath), p));
  const labelsPath = a.labels ?? rel(String(cfg.labels));
  const svgPath = a.svg ?? rel(String(cfg.svg));
  const placeOut = cfg.place?.out;
  const outPath = a.out ?? (placeOut ? rel(placeOut) : labelsPath);
  const width = a.width === undefined ? undefined : Number.parseInt(a.width, 10);
  if (width !== undefined && !Number.isFinite(width)) {
    console.error(`--width must be an integer\n${USAGE}`);
    return 2;
  }
  const doc: LabelDoc = JSON.parse(readFileSync(labelsPath, "utf8"));
  const svg = readFileSync(svgPath, "utf8");

  const res = placeLabels(svg, doc, cfg, { width });
  for (const w of res.warnings) console.error(`warning: ${w}`);
  writeFileSync(outPath, `${JSON.stringify(res.doc, null, 1)}\n`, "utf8");
  const report = res.placements.flatMap(reportLines);
  report.push(`${res.failed.length} could not be placed (display width ${res.width}px) -> ${outPath}`);
  const text = report.join("\n");
  console.log(text);
  if (a.report) writeFileSync(a.report, `${text}\n`, "utf8");
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  console.error(`error: ${(e as Error).message}`);
  process.exitCode = 1;
}
