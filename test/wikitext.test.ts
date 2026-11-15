// {{Image label}} blocks and mock pages must match what reference/python/map_labels.py writes, byte for byte
// (fixtures/*/expected_wikitext.json, from reference/oracle_wikitext.py).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Config, LabelDoc } from "../src/config.js";
import { placeLabels } from "../src/place.js";
import { wikitextFiles } from "../src/wikitext.js";

const ROOT = new URL("../fixtures/", import.meta.url);
const read = (dir: string, f: string) => readFileSync(new URL(`${dir}/${f}`, ROOT), "utf8");
const cases = readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/expected_wikitext.json`, ROOT)))
  .map((d) => d.name);

describe.each(cases)("%s", (name) => {
  it("writes the same {{Image label}} blocks and mock pages", () => {
    const cfg: Config = JSON.parse(read(name, "config.json"));
    const placed = placeLabels(read(name, String(cfg.svg)), JSON.parse(read(name, String(cfg.labels))) as LabelDoc, cfg);
    const { files, outputs } = wikitextFiles(placed.doc, cfg, String(cfg.svg), undefined, { heading: (w) => `显示宽度 ${w}px` });
    const exp: { files: Record<string, string>; console: string[] } = JSON.parse(read(name, "expected_wikitext.json"));
    expect([...files.keys()].sort()).toEqual(Object.keys(exp.files).sort());
    for (const [file, text] of files) expect(text, file).toBe(exp.files[file]);
    const outside = outputs.flatMap((o) => o.outside.map((x) => x.name));
    expect(outside).toEqual(exp.console.filter((l) => l.startsWith("  出图幅：")).map((l) => l.slice(6).split("（")[0]));
  });
});
