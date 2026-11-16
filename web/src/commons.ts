// The file on Wikimedia Commons: where its SVG and Commons' PNG of it are, and who made it.
// Anonymous requests only. The API takes origin=* for CORS; browsers can't set User-Agent, so the
// API-User-Agent header says who is calling (mediawiki.org API:Etiquette).

const API = "https://commons.wikimedia.org/w/api.php";
const AGENT = "map-svg-label-placer-check/0.3 (https://github.com/MuneAkira6/map-svg-label-placer)";

/** Thumbnail widths Wikimedia renders; other widths are refused (mediawiki.org "Common thumbnail sizes"). */
export const STEPS = [1280, 1920, 3840] as const;

export type Picture = { url: string; width: number; height: number };

export type CommonsFile = {
  /** "File:Name.svg" */
  title: string;
  /** The file description page. */
  page: string;
  svgUrl: string;
  bytes: number;
  png: Picture;
  artist?: string;
  license?: string;
  licenseUrl?: string;
};

type ImageInfo = {
  url: string;
  descriptionurl: string;
  size: number;
  mime: string;
  thumburl?: string;
  thumbwidth?: number;
  thumbheight?: number;
  extmetadata?: Record<string, { value: string } | undefined>;
};

async function query(params: Record<string, string>): Promise<{ title: string; missing?: boolean; invalid?: boolean; imageinfo?: ImageInfo[] } | undefined> {
  const q = new URLSearchParams({ action: "query", format: "json", formatversion: "2", origin: "*", redirects: "1", ...params });
  const res = await fetch(`${API}?${q}`, { headers: { "Api-User-Agent": AGENT } });
  if (!res.ok) throw new Error(`Commons returned HTTP ${res.status}. Try again later.`);
  const data = await res.json();
  if (data.error) throw new Error(`Commons: ${data.error.info}`);
  return data.query?.pages?.[0];
}

/** Commons' rendering of the file at one of its standard widths, in a language (Commons' default is English). */
const pngParams = (lang: string, width: number): Record<string, string> => ({
  iiurlwidth: String(width),
  ...(lang && lang !== "en" ? { iiurlparam: `lang${lang}-${width}px` } : {}),
});

/** Text of an extmetadata value, which is HTML. */
function plain(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const text = new DOMParser().parseFromString(html, "text/html").body.textContent?.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 200) : undefined;
}

export async function lookUp(title: string, lang: string): Promise<CommonsFile> {
  const page = await query({
    titles: title,
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl",
    iiextmetadatalanguage: "en",
    ...pngParams(lang, STEPS[0]),
  });
  const info = page?.imageinfo?.[0];
  if (!page || page.missing || page.invalid || !info) throw new Error(`There is no file called “${title.slice(5)}” on Wikimedia Commons.`);
  if (info.mime !== "image/svg+xml") throw new Error(`${page.title} is not an SVG file.`);
  if (!info.thumburl) throw new Error(`Commons returned no PNG of ${page.title}.`);
  const meta = info.extmetadata ?? {};
  return {
    title: page.title,
    page: info.descriptionurl,
    svgUrl: info.url,
    bytes: info.size,
    png: { url: info.thumburl, width: info.thumbwidth ?? STEPS[0], height: info.thumbheight ?? 0 },
    artist: plain(meta.Artist?.value),
    license: plain(meta.LicenseShortName?.value),
    licenseUrl: meta.LicenseUrl?.value,
  };
}

/** A sharper rendering for zooming in. */
export async function largerPng(title: string, lang: string, width: number): Promise<Picture | null> {
  const info = (await query({ titles: title, prop: "imageinfo", iiprop: "url", ...pngParams(lang, width) }))?.imageinfo?.[0];
  return info?.thumburl ? { url: info.thumburl, width: info.thumbwidth ?? width, height: info.thumbheight ?? 0 } : null;
}

/** The SVG as text, in the encoding its XML declaration names (UTF-8 when it names none). */
export function decodeSvg(bytes: ArrayBuffer): string {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 200));
  const label = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head)?.[1];
  try {
    return new TextDecoder(label ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export async function download(url: string, onProgress: (got: number) => void): Promise<string> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Could not download the SVG (HTTP ${res.status}).`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(got);
  }
  const all = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return decodeSvg(all.buffer);
}
