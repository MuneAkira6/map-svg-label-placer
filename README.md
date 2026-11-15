# map-svg-label-placer

Moves the place names on an SVG map so that no name covers a line, a symbol or another name.
You give it the map and a list of labels at rough positions. It returns the positions it chose, plus the
labels it could not fit, so you can decide what to shorten or drop.

I first wrote this in Python for the maps in some Chinese Wikipedia articles, where the names are laid over the
SVG with `{{Image label}}`. This TypeScript port also runs in a browser.

## Why not an existing library

- [vega-label](https://github.com/vega/vega/tree/main/packages/vega-label) avoids other marks, but only inside a Vega chart.
- [d3fc-label-layout](https://github.com/d3fc/d3fc/tree/master/packages/d3fc-label-layout) moves labels away from each other, not away from lines.
- [polylabel](https://github.com/mapbox/polylabel) finds one good point inside a polygon.

I did not find one that reads an arbitrary SVG map and treats the names of points, lines and areas differently.

## Usage

```sh
npm run build
node dist/cli.js fixtures/jia-county/config.json --out placed.json
```

```ts
import { placeLabels } from "map-svg-label-placer";

const { doc, failed } = placeLabels(svgText, labelFile, config);
```

The config and label files use the format of the Python script, which is documented (in Chinese) at the top of
[`reference/python/map_place_labels.py`](reference/python/map_place_labels.py).
[`fixtures/jia-county/config.json`](fixtures/jia-county/config.json) is a small example.

## How it works

1. Read the SVG: every stroked path, line, polyline and polygon becomes line segments, and small rects, circles and
   the SVG's own text become solid obstacles. Transforms and inherited styles are applied; anything in `<defs>` or
   hidden is skipped. The segments go into a uniform grid.
2. Estimate each label's box at one em per character, with the font size from a style table for the map's
   display width.
3. Place the labels one by one, most important first. Each kind has its own candidate positions:
   - names of points (towns, stations): around the symbol, nearest first. Ties are broken in the order right, upper right,
     lower right, left, and so on. The label must be less than 0.6 times as far from its own point as from any
     other point.
   - names of lines (rivers, railways): along the line on either side, rotated to follow it.
   - names of areas: rings around the given position, optionally kept inside a polygon of the SVG.
4. Take the first candidate whose box, sampled every 2.5 px, keeps a margin from every line, obstacle and
   placed label. If there is none, leave the label where it was and report it.

On a given JavaScript engine, the same input always gives the same output.

## Matching the Python version

The tests run both versions on seven maps (two made up, five drawn for Wikipedia) and compare every chosen
position. All choices agree; 229 of the 237 numbers (x, y, angle) are bit-identical and the rest differ by less than 1e-12.

Candidates are sorted and the first free one wins, so one unit
in the last place of a sort key or a distance can change the result. I had to reproduce Python where JavaScript
differs:

- `round(x, 3)` rounds the exact binary value, ties to even. `toFixed` disagreed on 25 of 1,989 test values.
- `a // b` for floats: `1 // 0.1` is 9, but `Math.floor(1 / 0.1)` is 10.
- `math.hypot`: `Math.hypot` disagreed on 165 of 504 values. I ported CPython's algorithm, which uses only
  `+ - * /` and `sqrt`, so it also gives the same result in every browser.
- `len("𠀀")` is 1; `"𠀀".length` is 2. Some rare characters in Chinese place names are outside the BMP.

## Limitations

- The search is greedy: a label placed early can take the only spot a later one had.
- Text width is estimated (1 em per character for labels, 0.6 em for the SVG's own text), not measured with the font.
- Arcs are treated as straight lines, and arc flags written without spaces (`a5 5 0 015 5`) are misread.
- `<use>` and `<image>` are ignored.
- `sin`, `cos` and `atan2` come from the JavaScript engine and may differ in the last bit between engines.

Next: moving the `<text>` already in an SVG, as in many maps on Wikimedia Commons.

## Licence

MIT. The real maps in [`fixtures/`](fixtures/README.md) are CC BY-SA 4.0 and contain OpenStreetMap data (ODbL).
