// What the user typed, as a Commons file title.

/** "File:Foo bar.svg" from a file name, a File: title, or a link to the file on Commons, upload or a wiki. */
export function fileTitle(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return null;
    }
    const parts = u.pathname.split("/");
    if (u.hash.startsWith("#/media/")) s = u.hash.slice("#/media/".length);
    else if (/^(upload|thumb)\.wikimedia\.org$/.test(u.hostname)) {
      // /wikipedia/commons/a/ab/Name.svg, or /wikipedia/commons/thumb/a/ab/Name.svg/1280px-Name.svg.png
      const i = parts.indexOf("thumb");
      s = (i >= 0 ? parts[i + 3] : parts[parts.length - 1]) ?? "";
    } else if (u.pathname.startsWith("/wiki/")) s = u.pathname.slice("/wiki/".length);
    else s = u.searchParams.get("title") ?? "";
    try {
      s = decodeURIComponent(s);
    } catch {
      return null;
    }
  }
  s = s.replace(/_/g, " ").replace(/^\s*(file|image)\s*:\s*/i, "").trim();
  return s ? `File:${s}` : null;
}
