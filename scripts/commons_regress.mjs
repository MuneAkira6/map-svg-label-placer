#!/usr/bin/env node
// Regression run over 360 real maps from Wikimedia Commons (list: regress/commons-sample.tsv).
// The maps are not in this repository: `fetch` downloads them once, `run` reads every one with the built
// library and compares what it finds with regress/commons-expected.jsonl.
//
//   npm run build
//   node scripts/commons_regress.mjs fetch          # ~360 MB, about 15 minutes at one request a second
//   node scripts/commons_regress.mjs run [--update]
//
// Files go to $COMMONS_CACHE (default ~/.cache/map-svg-label-placer/commons), named by their SHA-1.
// Requests follow the Wikimedia robot policy: a descriptive User-Agent (put your own contact in $COMMONS_UA),
// one request at a time, at least a second apart, maxlag on the API, and a full stop on HTTP 429 or 5xx.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIST = join(ROOT, "regress", "commons-sample.tsv");
const EXPECTED = join(ROOT, "regress", "commons-expected.jsonl");
const CACHE = process.env.COMMONS_CACHE ?? join(homedir(), ".cache", "map-svg-label-placer", "commons");
const API = "https://commons.wikimedia.org/w/api.php";
const UA = process.env.COMMONS_UA ?? "map-svg-label-placer-regress/0.2 (https://github.com/MuneAkira6/map-svg-label-placer)";

const rows = readFileSync(LIST, "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .slice(1)
  .map((l) => {
    const [title, sha1, bytes] = l.split("\t");
    return { title, sha1, bytes: Number(bytes) };
  });
const pathOf = (r) => join(CACHE, `${r.sha1}.svg`);
const sha1 = (buf) => createHash("sha1").update(buf).digest("hex");

let last = 0;
async function get(url) {
  const wait = last + 1000 - Date.now();
  if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
  last = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (res.status === 429 || res.status >= 500) {
    throw new Error(`HTTP ${res.status} from ${new URL(url).host}: stopping. Try again later.`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res;
}

async function api(params) {
  const q = new URLSearchParams({ format: "json", formatversion: "2", maxlag: "5", ...params });
  for (;;) {
    const data = await (await get(`${API}?${q}`)).json();
    if (data.error?.code !== "maxlag") return data;
    await new Promise((ok) => setTimeout(ok, 5000));
  }
}

/** URL of the version of a file with this SHA-1 (the current one, or an older one from the file history). */
async function versionUrl(title, want, current) {
  if (current?.sha1 === want) return current.url;
  const data = await api({ action: "query", titles: title, prop: "imageinfo", iiprop: "sha1|url", iilimit: "50" });
  const info = data.query?.pages?.[0]?.imageinfo ?? [];
  return info.find((v) => v.sha1 === want)?.url;
}

async function fetchAll() {
  mkdirSync(CACHE, { recursive: true });
  const todo = rows.filter((r) => !existsSync(pathOf(r)) || sha1(readFileSync(pathOf(r))) !== r.sha1);
  console.log(`${rows.length - todo.length} files already in ${CACHE}, ${todo.length} to fetch`);
  const current = new Map();
  for (let i = 0; i < todo.length; i += 50) {
    const titles = todo.slice(i, i + 50).map((r) => r.title).join("|");
    const data = await api({ action: "query", titles, prop: "imageinfo", iiprop: "sha1|url" });
    const norm = new Map((data.query?.normalized ?? []).map((n) => [n.to, n.from]));
    for (const p of data.query?.pages ?? []) current.set(norm.get(p.title) ?? p.title, p.imageinfo?.[0]);
  }
  let missing = 0;
  for (const [i, r] of todo.entries()) {
    const url = await versionUrl(r.title, r.sha1, current.get(r.title));
    if (!url) {
      console.log(`not on Commons any more (deleted, or the version is gone): ${r.title}`);
      missing++;
      continue;
    }
    const body = Buffer.from(await (await get(url)).arrayBuffer());
    if (sha1(body) !== r.sha1) throw new Error(`SHA-1 mismatch for ${r.title}`);
    writeFileSync(pathOf(r), body);
    if ((i + 1) % 20 === 0) console.log(`${i + 1}/${todo.length}`);
  }
  console.log(`done; ${missing} could not be fetched`);
}

/** What the library reads from one map. Coordinates are rounded so that only real changes show up. */
function read(lib, svg) {
  const labels = lib.readSvgLabels(svg);
  const obst = lib.parseSvg(svg, { areaIds: [], rectMax: 50, textCharEm: 0.6, textDescent: 2, skipTextAt: new Set(labels.texts.map((t) => t.start)) });
  const fixed = {};
  for (const g of labels.groups) if (g.reason) fixed[g.reason] = (fixed[g.reason] ?? 0) + 1;
  const r1 = (v) => Math.round(v * 10) / 10;
  const boxes = labels.groups.map((g) => [g.label.name, r1(g.label.x), r1(g.label.y), r1(g.hw), r1(g.hh), r1(g.label.angle ?? 0)]);
  return {
    texts: labels.texts.filter((t) => !t.hidden && t.content).length,
    labels: labels.groups.length,
    joined: labels.groups.filter((g) => g.texts.length > 1).length,
    fixed,
    lines: obst.segs.length,
    circles: obst.circles.length,
    warnings: labels.warnings.length + obst.warnings.length,
    boxes: createHash("sha1").update(JSON.stringify(boxes)).digest("hex").slice(0, 12),
  };
}

async function run(update) {
  const lib = await import(pathToFileURL(join(ROOT, "dist", "index.js")).href);
  const expected = new Map();
  if (existsSync(EXPECTED)) {
    for (const l of readFileSync(EXPECTED, "utf8").split("\n")) if (l) expected.set(JSON.parse(l).title, JSON.parse(l));
  }
  const out = [];
  let same = 0;
  let changed = 0;
  let missing = 0;
  const t0 = Date.now();
  for (const r of rows) {
    if (!existsSync(pathOf(r))) {
      missing++;
      continue;
    }
    let got;
    try {
      got = { title: r.title, ...read(lib, readFileSync(pathOf(r), "utf8")) };
    } catch (e) {
      got = { title: r.title, error: String(e.message).slice(0, 200) };
    }
    out.push(got);
    const want = expected.get(r.title);
    const diff = want ? Object.keys({ ...want, ...got }).filter((k) => JSON.stringify(want[k]) !== JSON.stringify(got[k])) : ["(new)"];
    if (diff.length === 0) same++;
    else {
      changed++;
      if (!update) console.log(`${r.title}: ${diff.map((k) => `${k} ${JSON.stringify(want?.[k])} -> ${JSON.stringify(got[k])}`).join(", ")}`);
    }
  }
  const total = (k) => out.reduce((s, o) => s + (o[k] ?? 0), 0);
  console.log(
    `${out.length} maps read in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${out.filter((o) => o.error).length} errors; ` +
      `${total("texts")} texts -> ${total("labels")} labels; ${same} as expected, ${changed} changed, ${missing} not fetched`,
  );
  if (update) {
    writeFileSync(EXPECTED, out.map((o) => JSON.stringify(o)).join("\n") + "\n");
    console.log(`wrote ${EXPECTED}`);
  } else if (changed) process.exitCode = 1;
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "fetch") await fetchAll();
else if (cmd === "run") await run(args.includes("--update"));
else console.log("usage: commons_regress.mjs fetch | run [--update]");
