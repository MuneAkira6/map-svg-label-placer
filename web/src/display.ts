// A map drawn by the browser the way Commons draws it: the font-family values swapped for the fonts Commons uses,
// and those fonts put into the file. An SVG shown in <img> may not load anything, so the fonts go in as data: URLs.
import { commonsFonts, pinLanguage, withFontFaces } from "../../src/index.js";

const loaded = new Map<string, Promise<string>>();

function fontData(file: string): Promise<string> {
  let p = loaded.get(file);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}fonts/${file}`)
      .then((r) => {
        if (!r.ok) throw new Error(`font ${file}: HTTP ${r.status}`);
        return r.blob();
      })
      .then((b) => new Promise<string>((ok, fail) => {
        const fr = new FileReader();
        fr.onload = () => ok(String(fr.result));
        fr.onerror = () => fail(fr.error);
        fr.readAsDataURL(b);
      }));
    p.catch(() => loaded.delete(file));
    loaded.set(file, p);
  }
  return p;
}

/**
 * A blob: URL of the map with Commons' fonts in it, for an <img>, showing the language version Commons draws for
 * `lang` (not the browser's own). Revoke it when done.
 */
export async function drawable(svg: string, lang: string): Promise<string> {
  const { svg: swapped, faces } = commonsFonts(pinLanguage(svg, lang));
  const data = new Map(await Promise.all(faces.map(async (f) => [f.file, await fontData(f.file)] as const)));
  const out = withFontFaces(swapped, faces, (f) => data.get(f.file)!);
  return URL.createObjectURL(new Blob([out], { type: "image/svg+xml" }));
}
