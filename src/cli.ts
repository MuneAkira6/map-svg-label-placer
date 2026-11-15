#!/usr/bin/env node
// map-svg-label-placer place <config.json> [--labels FILE] [--svg FILE] [--out FILE] [--width PX] [--report FILE]
// map-svg-label-placer wikitext <config.json> [--labels FILE] [--svg FILE] [--outdir DIR] [--only NAME]...
//
// The same config file and options as reference/python/map_place_labels.py and map_labels.py. Relative paths
// in the config are relative to the config file. `place` overwrites the label file unless --out (or place.out
// in the config) is given.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import type { Config, LabelDoc } from "./config.js";
import { placeLabels, type How, type Placement } from "./place.js";
import { formatF, pyRound } from "./py.js";
import { wikitextFiles } from "./wikitext.js";

const USAGE = `usage:
  map-svg-label-placer place <config.json> [--labels FILE] [--svg FILE] [--out FILE] [--width PX] [--report FILE]
  map-svg-label-placer wikitext <config.json> [--labels FILE] [--svg FILE] [--outdir DIR] [--only NAME]...`;
const DIRS: Record<number, string> = {
  0: "right", 315: "upper right", 45: "lower right", 180: "left", 225: "upper left", 135: "lower left", 270: "above", 90: "below",
};

class UsageError extends Error {}

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

function load(configArg: string) {
  const configPath = resolve(configArg);
  const cfg: Config = JSON.parse(readFileSync(configPath, "utf8"));
  const rel = (p: string) => (isAbsolute(p) ? p : join(dirname(configPath), p));
  return { cfg, rel };
}

function write(path: string, text: string): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, text, "utf8");
}

function place(args: string[]): void {
  const { values: a, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      labels: { type: "string" },
      svg: { type: "string" },
      out: { type: "string" },
      width: { type: "string" },
      report: { type: "string" },
    },
  });
  if (positionals.length !== 1) throw new UsageError("place takes one config file");
  const { cfg, rel } = load(positionals[0]!);
  const labelsPath = a.labels ?? rel(String(cfg.labels));
  const placeOut = cfg.place?.out;
  const outPath = a.out ?? (placeOut ? rel(placeOut) : labelsPath);
  let width: number | undefined;
  if (a.width !== undefined) {
    width = Number.parseInt(a.width, 10);
    if (!Number.isFinite(width)) throw new UsageError("--width must be an integer");
  }
  const doc: LabelDoc = JSON.parse(readFileSync(labelsPath, "utf8"));
  const svg = readFileSync(a.svg ?? rel(String(cfg.svg)), "utf8");

  const res = placeLabels(svg, doc, cfg, { width });
  for (const w of res.warnings) console.error(`warning: ${w}`);
  write(outPath, `${JSON.stringify(res.doc, null, 1)}\n`);
  const report = res.placements.flatMap(reportLines);
  report.push(`${res.failed.length} could not be placed (display width ${res.width}px) -> ${outPath}`);
  const text = report.join("\n");
  console.log(text);
  if (a.report) write(a.report, `${text}\n`);
}

function wikitext(args: string[]): void {
  const { values: a, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      labels: { type: "string" },
      svg: { type: "string" },
      outdir: { type: "string" },
      only: { type: "string", multiple: true },
    },
  });
  if (positionals.length !== 1) throw new UsageError("wikitext takes one config file");
  const { cfg, rel } = load(positionals[0]!);
  const labelsPath = a.labels ?? rel(String(cfg.labels));
  const doc: LabelDoc = JSON.parse(readFileSync(labelsPath, "utf8"));
  const outdir = a.outdir ?? dirname(resolve(labelsPath));
  const svgPath = a.svg ?? rel(String(cfg.svg ?? ""));
  const svgSrc = relative(resolve(outdir), resolve(svgPath)).split(sep).join("/");
  const { files, outputs } = wikitextFiles(doc, cfg, svgSrc, a.only);
  for (const [name, text] of files) write(join(outdir, name), text);
  const outNames = new Map((cfg.wikitext as { outputs: { name?: string; width: number; out?: string }[] }).outputs.map((o) => [o.name ?? String(o.width), o.out]));
  for (const r of outputs) {
    console.log(`${r.name}: ${r.count} labels -> ${outNames.get(r.name) ?? "(no file)"}; outside the image: ${r.outside.length}`);
    for (const o of r.outside) {
      console.log(`  outside: ${o.name} (from ${formatF(o.left, 0)},${formatF(o.top, 0)}, ${formatF(o.w, 0)} x ${formatF(o.h, 0)}; image ${r.width} x ${r.height})`);
    }
  }
}

function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  try {
    if (cmd === "place") place(rest);
    else if (cmd === "wikitext") wikitext(rest);
    else if (cmd === "-h" || cmd === "--help") {
      console.log(USAGE);
      return 0;
    } else throw new UsageError(cmd ? `unknown command "${cmd}"` : "missing command");
    return 0;
  } catch (e) {
    const usage = e instanceof UsageError || (e as { code?: string }).code?.startsWith("ERR_PARSE_ARGS");
    console.error(`error: ${(e as Error).message}${usage ? `\n${USAGE}` : ""}`);
    return usage ? 2 : 1;
  }
}

process.exitCode = main(process.argv.slice(2));
