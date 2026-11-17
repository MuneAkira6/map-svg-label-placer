#!/usr/bin/env node
// What fixSvgLabels does to the regression maps (regress/commons-sample.tsv): how many names it moves and how
// far, why the others stay, and what the check finds before and after. The numbers in the README come from here.
//
//   npm run build
//   node scripts/fix_stats.mjs [--moves moves.jsonl] [--maps maps.jsonl] [--only <part of a title>] [--jobs N]
//
// Each map runs in its own worker thread and is given up after 60 s. Names are those the check judges (not
// skipped); the problems are counted among those with no halo or plate. Distances are in px at the size MediaWiki gives the map.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = process.env.COMMONS_CACHE ?? join(homedir(), ".cache", "map-svg-label-placer", "commons");
const TIMEOUT = 60_000;

/** Names the check judges (not skipped), and how many of those with no halo or plate have each problem. */
function counts(check) {
  const judged = check.labels.filter((l) => !l.skipped);
  const n = (f) => judged.filter((l) => !l.masked && f(l)).length;
  return { names: judged.length, core: n((l) => l.line === "core"), edge: n((l) => l.line === "edge"), overlap: n((l) => l.overlaps.length > 0), clipped: n((l) => l.clipped) };
}

if (!isMainThread) {
  const lib = await import(pathToFileURL(join(ROOT, "dist", "index.js")).href);
  const svg = readFileSync(workerData.path, "utf8");
  const t0 = performance.now();
  const res = lib.fixSvgLabels(svg);
  const ms = performance.now() - t0;
  const k = res.unitsPerPx;
  const stuck = { full: 0, letter: 0, size: 0, split: 0 };
  for (const s of res.stuck) stuck[s.why]++;
  const after = lib.checkSvgLabels(res.svg);
  // Moved names found again by their <text> elements: a moved name can join another as its second line.
  const movedTexts = new Set(res.moves.flatMap((m) => m.texts));
  const groupsAfter = lib.readSvgLabels(res.svg).groups;
  const stillCrossed = after.labels.filter((l) => !l.skipped && !l.masked && l.line === "core" && groupsAfter[l.index].texts.some((t) => movedTexts.has(t.index))).length;
  const joined = res.before.labels.length - after.labels.length;
  parentPort.postMessage({
    before: counts(res.before),
    after: counts(after),
    stuck,
    stillCrossed,
    joined,
    ms,
    unitsPerPx: k,
    moves: res.moves.map((m) => ({ index: m.index, name: m.name, dx: m.dx / k, dy: m.dy / k, px: Math.hypot(m.dx, m.dy) / k, texts: m.texts })),
  });
} else {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const rows = readFileSync(join(ROOT, "regress", "commons-sample.tsv"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .slice(1)
    .map((l) => {
      const [title, sha1] = l.split("\t");
      return { title, sha1, path: join(CACHE, `${sha1}.svg`) };
    })
    .filter((r) => existsSync(r.path) && (!opt("--only") || r.title.includes(opt("--only"))));
  const jobs = Number(opt("--jobs") ?? Math.max(1, Math.floor(availableParallelism() / 2)));

  const runOne = (r) =>
    new Promise((ok) => {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { path: r.path } });
      const timer = setTimeout(() => {
        w.terminate();
        ok({ title: r.title, sha1: r.sha1, error: `timeout after ${TIMEOUT / 1000} s` });
      }, TIMEOUT);
      w.once("message", (m) => {
        clearTimeout(timer);
        w.terminate();
        ok({ title: r.title, sha1: r.sha1, ...m });
      });
      w.once("error", (e) => {
        clearTimeout(timer);
        ok({ title: r.title, sha1: r.sha1, error: String(e.message).slice(0, 200) });
      });
    });

  const out = new Array(rows.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: jobs }, async () => {
      while (next < rows.length) {
        const i = next++;
        out[i] = await runOne(rows[i]);
      }
    }),
  );

  const ok = out.filter((o) => !o.error);
  const named = ok.filter((o) => o.before.names > 0);
  const sum = (f) => named.reduce((s, o) => s + f(o), 0);
  const moves = named.flatMap((o) => o.moves.map((m) => ({ title: o.title, sha1: o.sha1, ...m })));
  const px = moves.map((m) => m.px).sort((p, q) => p - q);
  const pct = (a, q) => (a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : NaN);
  const ms = ok.map((o) => o.ms).sort((p, q) => p - q);
  const worse = (k) => named.filter((o) => o.after[k] > o.before[k]).length;
  const f1 = (v) => v.toFixed(1);

  console.log(`${rows.length} maps, ${out.length - ok.length} not finished${out.some((o) => o.error) ? ": " + out.filter((o) => o.error).map((o) => `${o.title} (${o.error})`).join("; ") : ""}`);
  console.log(`${named.length} maps with names, ${sum((o) => o.before.names)} names`);
  console.log(`line through the letters: ${sum((o) => o.before.core)} -> ${sum((o) => o.after.core)}; across the edge: ${sum((o) => o.before.edge)} -> ${sum((o) => o.after.edge)}`);
  console.log(`covering another name: ${sum((o) => o.before.overlap)} -> ${sum((o) => o.after.overlap)} (${worse("overlap")} maps more); off the edge: ${sum((o) => o.before.clipped)} -> ${sum((o) => o.after.clipped)} (${worse("clipped")} maps more)`);
  console.log(`moved ${moves.length} (${sum((o) => o.stillCrossed)} of them still with a line through the letters): median ${f1(pct(px, 0.5))} px, 90% within ${f1(pct(px, 0.9))} px, longest ${f1(px[px.length - 1] ?? NaN)} px`);
  console.log(`moved names that ended up read as a line of another name: ${sum((o) => o.joined)}`);
  console.log(`stayed: ${sum((o) => o.stuck.full)} no free place, ${sum((o) => o.stuck.letter)} single letters, ${sum((o) => o.stuck.size)} not measured, ${sum((o) => o.stuck.split)} half of a name written as two texts`);
  console.log(`time per map: median ${(pct(ms, 0.5) / 1000).toFixed(2)} s, longest ${((ms[ms.length - 1] ?? 0) / 1000).toFixed(1)} s`);

  if (opt("--moves")) writeFileSync(opt("--moves"), moves.map((m) => JSON.stringify(m)).join("\n") + "\n");
  if (opt("--maps")) writeFileSync(opt("--maps"), out.map(({ moves: _, ...o }) => JSON.stringify(o)).join("\n") + "\n");
}
