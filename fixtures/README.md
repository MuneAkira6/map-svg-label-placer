# Test fixtures

Each folder holds one map: `config.json`, the label file and the SVG it names, and `expected.json`, which is
what the Python reference (`reference/python/map_place_labels.py`) produces for it. Regenerate with
`npm run oracle -- fixtures/<name>/config.json > fixtures/<name>/expected.json`.

| Folder | What it is |
|---|---|
| `jia-county` | A made-up county (the example shipped with the Python script). |
| `svg-features` | A made-up map that exercises every branch of the SVG reader. |
| `siyang-transport` | Transport map of Siyang County, Jiangsu ([File:泗阳县交通.svg](https://commons.wikimedia.org/wiki/File:%E6%B3%97%E9%98%B3%E5%8E%BF%E4%BA%A4%E9%80%9A.svg)). |
| `siyang-water` | Rivers and lakes of Siyang County ([File:泗阳县水系图.svg](https://commons.wikimedia.org/wiki/File:%E6%B3%97%E9%98%B3%E5%8E%BF%E6%B0%B4%E7%B3%BB%E5%9B%BE.svg)). |
| `zhongxing-a`, `zhongxing-b`, `zhongxing-b-roads` | Three drafts of the map of the area around Zhongxing Subdistrict ([File:泗阳县众兴街道一带.svg](https://commons.wikimedia.org/wiki/File:%E6%B3%97%E9%98%B3%E5%8E%BF%E4%BC%97%E5%85%B4%E8%A1%97%E9%81%93%E4%B8%80%E5%B8%A6.svg)). |

The real maps were drawn for Chinese Wikipedia articles. Changes from the originals: the config keys
`svg_parse` (only `"legacy"` was used, which the port does not support) and `out` were removed, and file paths
were made local.

## Licence of the real maps

The code in this repository is MIT. The files in `siyang-*` and `zhongxing-*` are not:

- Map data © OpenStreetMap contributors, available under the
  [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
  (see <https://www.openstreetmap.org/copyright>).
- Some boundaries in the Zhongxing maps follow the Jiangsu standard map 《泗阳县地图—政区版》
  (审图号 苏N（2025）67号); only their positions were used.
- The SVGs and label files themselves are released under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), as on Wikimedia Commons.
