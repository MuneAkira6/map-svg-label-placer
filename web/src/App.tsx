import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import type { Quad, SvgCheck, SvgViewport } from "../../src/index.js";
import { decodeSvg, download, largerPng, lookUp, STEPS, type CommonsFile, type Picture } from "./commons.js";
import { at, fitFrame } from "./fit.js";
import { runCheck } from "./run.js";
import { fileTitle } from "./title.js";

const REPO = "https://github.com/MuneAkira6/map-svg-label-placer";
const EXAMPLES = ["File:Battle of hastings1.svg", "File:China-Manchukuo-map.svg"];

type Kind = "core" | "edge" | "overlap" | "clipped" | "masked" | "unshown" | "skipped";

const LISTS: { kind: Kind; title: string; color: string; note: string }[] = [
  { kind: "core", title: "Line through the letters", color: "#CC35A5", note: "A line crosses the middle of the letters." },
  { kind: "edge", title: "Line across the box", color: "#3A7DDC", note: "A line crosses the name's box, but not the middle of the letters." },
  { kind: "overlap", title: "Names on top of each other", color: "#D3AA00", note: "Two names overlap by more than a tenth of the smaller one." },
  { kind: "clipped", title: "Cut off at the edge", color: "#166689", note: "Part of the name is outside the picture." },
  {
    kind: "masked",
    title: "Line hidden by a halo or plate",
    color: "#8C8C8C",
    note: "A line crosses the name, but an outline around the letters (a halo) or a filled shape under them (a plate) hides it.",
  },
  {
    kind: "unshown",
    title: "Text Commons does not draw",
    color: "#444444",
    note: "librsvg, which Commons uses, does not draw flowed text (flowRoot) or text along a path (textPath).",
  },
  { kind: "skipped", title: "Not checked", color: "#8C8C8C", note: "" },
];
const COLOR = Object.fromEntries(LISTS.map((l) => [l.kind, l.color])) as Record<Kind, string>;

type Item = { key: string; kind: Kind; name: string; detail?: string; quads: Quad[]; shape: string };
type Shape = { key: string; color: string; quads: Quad[]; name: string; dashed?: boolean; minor?: boolean };

type Result = {
  source: "commons" | "file";
  name: string;
  file?: CommonsFile;
  picture: Picture;
  check: SvgCheck;
  viewport: SvgViewport;
  ms: number;
};

/** The lists in the panel, and the outlines on the map (one per name, in the colour of its worst problem). */
function itemsOf(check: SvgCheck): { items: Item[]; shapes: Shape[]; clear: Shape[] } {
  const items: Item[] = [];
  const shapes: Shape[] = [];
  const clear: Shape[] = [];
  const byIndex = new Map(check.labels.map((l) => [l.index, l.name]));
  check.labels.forEach((l, i) => {
    const quads = l.boxes.map((b) => b.corners);
    const kinds: [Kind, string?][] = [];
    if (l.skipped) kinds.push(["skipped", l.skipped]);
    else {
      if (l.line && !l.masked) kinds.push([l.line]);
      if (l.line && l.masked) kinds.push(["masked", l.masked]);
      if (l.overlaps.length) kinds.push(["overlap", `with ${l.overlaps.map((j) => byIndex.get(j) ?? "?").join(", ")}`]);
      if (l.clipped) kinds.push(["clipped"]);
    }
    const shape = `l${i}`;
    for (const [kind, detail] of kinds) items.push({ key: `${kind}-${i}`, kind, name: l.name, detail, quads, shape });
    const worst = kinds.find(([k]) => k !== "skipped" && k !== "masked")?.[0];
    if (worst) shapes.push({ key: shape, color: COLOR[worst], quads, name: l.name });
    else if (kinds.some(([k]) => k === "masked")) shapes.push({ key: shape, color: COLOR.masked, quads, name: l.name, minor: true });
    else if (!l.skipped) clear.push({ key: shape, color: "#8C8C8C", quads, name: l.name });
  });
  check.unshown.forEach((u, j) => {
    const quads = u.corners ? [u.corners] : [];
    const shape = `u${j}`;
    items.push({ key: `unshown-${j}`, kind: "unshown", name: u.text, detail: u.kind, quads, shape });
    if (u.corners) shapes.push({ key: shape, color: COLOR.unshown, quads, name: u.text, dashed: true });
  });
  return { items, shapes, clear };
}

const kb = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);

export function App() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [input, setInput] = useState(params.get("file") ?? "");
  const [lang, setLang] = useState(params.get("lang") ?? "en");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showClear, setShowClear] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [sharper, setSharper] = useState<Picture | null>(null);
  const [dragging, setDragging] = useState(false);
  const svgText = useRef<{ key: string; text: string } | null>(null);
  const runId = useRef(0);
  const blobUrl = useRef<string | null>(null);

  const show = useCallback((r: Result) => {
    setResult(r);
    setSelected(null);
    setZoom(1);
    setSharper(null);
  }, []);

  const checkCommons = useCallback(
    async (raw: string, language: string) => {
      const title = fileTitle(raw);
      if (!title) {
        setError("Enter the name of an SVG file on Wikimedia Commons, or a link to it.");
        return;
      }
      const id = ++runId.current;
      setError(null);
      try {
        setBusy("Looking up the file on Commons…");
        const file = await lookUp(title, language);
        if (id !== runId.current) return;
        let text = svgText.current?.key === file.svgUrl ? svgText.current.text : null;
        if (text === null) {
          setBusy(`Downloading the SVG (${kb(file.bytes)})…`);
          text = await download(file.svgUrl, (got) => id === runId.current && setBusy(`Downloading the SVG (${kb(got)} of ${kb(file.bytes)})…`));
          svgText.current = { key: file.svgUrl, text };
        }
        if (id !== runId.current) return;
        setBusy("Checking the names…");
        const reply = await runCheck(text, language);
        if (id !== runId.current) return;
        if (!reply.ok) throw new Error(`Could not read the SVG: ${reply.error}`);
        show({ source: "commons", name: file.title, file, picture: file.png, check: reply.check, viewport: reply.viewport, ms: reply.ms });
        const q = new URLSearchParams({ file: file.title.slice(5) });
        if (language !== "en") q.set("lang", language);
        history.replaceState(null, "", `?${q}`);
      } catch (e) {
        if (id === runId.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (id === runId.current) setBusy(null);
      }
    },
    [show],
  );

  const checkLocal = useCallback(
    async (file: File, language: string) => {
      const id = ++runId.current;
      setError(null);
      try {
        setBusy("Checking the names…");
        const text = decodeSvg(await file.arrayBuffer());
        svgText.current = { key: `local:${file.name}:${file.size}:${file.lastModified}`, text };
        const reply = await runCheck(text, language);
        if (id !== runId.current) return;
        if (!reply.ok) throw new Error(`Could not read the SVG: ${reply.error}`);
        if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
        blobUrl.current = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
        const { width, height } = reply.viewport;
        show({ source: "file", name: file.name, picture: { url: blobUrl.current, width, height }, check: reply.check, viewport: reply.viewport, ms: reply.ms });
        history.replaceState(null, "", location.pathname);
      } catch (e) {
        if (id === runId.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (id === runId.current) setBusy(null);
      }
    },
    [show],
  );

  // A link with ?file= checks that file straight away.
  useEffect(() => {
    if (params.get("file")) void checkCommons(params.get("file")!, params.get("lang") ?? "en");
  }, [params, checkCommons]);

  const recheckLanguage = async (language: string) => {
    if (!result || language === lang) return;
    setLang(language);
    if (result.source === "commons") await checkCommons(result.name, language);
    else if (svgText.current) {
      const reply = await runCheck(svgText.current.text, language);
      if (reply.ok) show({ ...result, check: reply.check, viewport: reply.viewport, ms: reply.ms });
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void checkCommons(input, lang);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) void checkLocal(f, lang);
  };

  const { items, shapes, clear } = useMemo(() => (result ? itemsOf(result.check) : { items: [], shapes: [], clear: [] }), [result]);
  const sel = items.find((it) => it.key === selected) ?? null;

  // Map view: the picture fitted to the viewer, times the zoom.
  const viewer = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ w: 800, h: 600 });
  useLayoutEffect(() => {
    const el = viewer.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRoom({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [result]);
  const pic = result?.picture;
  const fitScale = pic ? Math.min((room.w - 2) / pic.width, (room.h - 2) / pic.height) : 1;
  const scale = fitScale * zoom;
  const fit = useMemo(
    () => (result ? fitFrame(result.check.frame, result.picture.width, result.picture.height, result.viewport.preserveAspectRatio) : null),
    [result],
  );
  const points = (q: Quad) => q.map((p) => at(fit!, p).join(",")).join(" ");

  // Zooming in past Commons' 1280 px rendering: ask for the next standard width.
  useEffect(() => {
    if (!result || result.source !== "commons" || !pic) return;
    const need = pic.width * scale * (window.devicePixelRatio || 1);
    const have = sharper?.width ?? pic.width;
    if (need <= have * 1.1) return;
    const step = STEPS.find((s) => s >= need) ?? STEPS[STEPS.length - 1]!;
    if (step <= have) return;
    let stale = false;
    const t = setTimeout(() => {
      void largerPng(result.name, lang, step).then((p) => {
        if (!stale && p) setSharper(p);
      });
    }, 400);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [result, pic, scale, sharper, lang]);

  // Selecting a name zooms in until it is a readable size and scrolls it to the middle.
  const scrollTo = useRef(false);
  const select = (it: Item) => {
    setSelected(it.key);
    if (!fit || !pic || it.quads.length === 0) return;
    const xs = it.quads.flat().map((p) => at(fit, p)[0]);
    const width = Math.max(...xs) - Math.min(...xs);
    setZoom((z) => Math.min(8, Math.max(z, 2, 140 / Math.max(1, width * fitScale))));
    scrollTo.current = true;
  };
  useLayoutEffect(() => {
    if (!scrollTo.current || !sel || !fit || !viewer.current) return;
    scrollTo.current = false;
    const pts = sel.quads.flat().map((p) => at(fit, p));
    if (pts.length === 0) return;
    const cx = (pts.reduce((s, p) => s + p[0], 0) / pts.length) * scale;
    const cy = (pts.reduce((s, p) => s + p[1], 0) / pts.length) * scale;
    viewer.current.scrollTo({ left: cx - room.w / 2, top: cy - room.h / 2 });
  }, [sel, scale, fit, room]);

  const zoomBy = (f: number) => {
    const el = viewer.current;
    const z = Math.min(8, Math.max(1, zoom * f));
    if (el) {
      // Keep the middle of the view where it is.
      const k = z / zoom;
      const mx = el.scrollLeft + room.w / 2;
      const my = el.scrollTop + room.h / 2;
      requestAnimationFrame(() => el.scrollTo({ left: mx * k - room.w / 2, top: my * k - room.h / 2 }));
    }
    setZoom(z);
  };

  const counts = Object.fromEntries(LISTS.map((l) => [l.kind, items.filter((it) => it.kind === l.kind).length])) as Record<Kind, number>;
  const named = result ? result.check.labels.length : 0;

  return (
    <>
      <header className="top">
        <h1>SVG map label check</h1>
        <nav>
          <a href={`${REPO}#checking-a-map`}>About</a>
          <a href={REPO}>Source</a>
        </nav>
      </header>
      <main className="main">
        <section className="mapside">
          <div className="tools" hidden={!result}>
            <button type="button" className="small" onClick={() => setZoom(1)} disabled={zoom === 1}>
              Fit
            </button>
            <button type="button" className="small" onClick={() => zoomBy(1 / 1.5)} disabled={zoom === 1} aria-label="Zoom out">
              −
            </button>
            <button type="button" className="small" onClick={() => zoomBy(1.5)} disabled={zoom >= 8} aria-label="Zoom in">
              +
            </button>
            <span className="muted" title={result?.source === "file" ? "Of the SVG's own size" : "Of the 1280 px PNG"}>
              {Math.round(scale * 100)}%
            </span>
            <label className="check">
              <input type="checkbox" checked={showClear} onChange={(e) => setShowClear(e.target.checked)} /> Outline the other names too
            </label>
          </div>
          <div
            ref={viewer}
            className={`viewer${dragging ? " dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            {result && pic && fit ? (
              <div className="map" style={{ width: pic.width * scale, height: pic.height * scale }}>
                <img src={sharper?.url ?? pic.url} alt={`The map as ${result.source === "commons" ? "Commons" : "your browser"} draws it`} draggable={false} onError={() => setSharper(null)} />
                <svg viewBox={`0 0 ${pic.width} ${pic.height}`} width={pic.width * scale} height={pic.height * scale}>
                  {showClear &&
                    clear.map((s) => (
                      <g key={s.key} className="shape faint">
                        {s.quads.map((q, k) => (
                          <polygon key={k} points={points(q)} stroke={s.color} />
                        ))}
                      </g>
                    ))}
                  {shapes.map((s) => (
                    <g
                      key={s.key}
                      className={s.minor ? "shape minor" : "shape"}
                      onClick={() => {
                        const it = items.find((i) => i.shape === s.key);
                        if (it) {
                          setSelected(it.key);
                          document.getElementById(`item-${it.key}`)?.scrollIntoView({ block: "nearest" });
                        }
                      }}
                    >
                      <title>{s.name}</title>
                      {s.quads.map((q, k) => (
                        <polygon key={k} points={points(q)} stroke={s.color} strokeDasharray={s.dashed ? "4 3" : undefined} />
                      ))}
                    </g>
                  ))}
                  {sel &&
                    sel.quads.map((q, k) => <polygon key={`sel${k}`} className="selected" points={points(q)} stroke={COLOR[sel.kind]} />)}
                </svg>
              </div>
            ) : (
              <div className="drop">
                <p>Drop an SVG map here</p>
                <p className="muted">or enter a Wikimedia Commons file name</p>
              </div>
            )}
          </div>
        </section>

        <aside className="panel">
          <form onSubmit={onSubmit}>
            <label htmlFor="file">Wikimedia Commons file</label>
            <div className="row">
              <input id="file" value={input} onChange={(e) => setInput(e.target.value)} placeholder="File:Example.svg, or a link to it" spellCheck={false} />
              <button type="submit" className="primary" disabled={busy !== null}>
                Check
              </button>
            </div>
            <div className="row small-row">
              <label htmlFor="lang">Language</label>
              <input
                id="lang"
                className="lang"
                defaultValue={lang}
                key={lang}
                onBlur={(e) => void recheckLanguage(e.target.value.trim() || "en")}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), (e.target as HTMLInputElement).blur())}
                spellCheck={false}
              />
              <span className="muted">for maps in several languages (default en)</span>
            </div>
            <div className="row small-row">
              <label className="button small">
                Open an SVG file…
                <input
                  type="file"
                  accept=".svg,image/svg+xml"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void checkLocal(f, lang);
                    e.target.value = "";
                  }}
                />
              </label>
              {!result && (
                <span className="muted">
                  Examples:{" "}
                  {EXAMPLES.map((t, i) => (
                    <span key={t}>
                      {i > 0 && ", "}
                      <a
                        href={`?file=${encodeURIComponent(t.slice(5))}`}
                        onClick={(e) => {
                          e.preventDefault();
                          setInput(t);
                          void checkCommons(t, lang);
                        }}
                      >
                        {t.slice(5)}
                      </a>
                    </span>
                  ))}
                </span>
              )}
            </div>
          </form>

          {busy && <p className="status">{busy}</p>}
          {error && <p className="error">{error}</p>}

          {result && (
            <>
              <div className="about-file">
                <h2>{result.source === "commons" ? <a href={result.file!.page}>{result.name}</a> : result.name}</h2>
                {result.source === "commons" ? (
                  <p className="muted">
                    {result.file!.artist ? `Author: ${result.file!.artist}.` : "Author: see the file page."}
                    {result.file!.license && (
                      <>
                        {" Licence: "}
                        {result.file!.licenseUrl ? <a href={result.file!.licenseUrl}>{result.file!.license}</a> : result.file!.license}.
                      </>
                    )}{" "}
                    The picture is Commons' own rendering.
                  </p>
                ) : (
                  <p className="muted">
                    Drawn by your browser, not by Commons, so the letters may not match the boxes. The file stays on your computer.
                  </p>
                )}
                <p>
                  {named} {named === 1 ? "name" : "names"}, checked in {Math.max(1, Math.round(result.ms))} ms.{" "}
                  {counts.core + counts.edge === 0 ? "No line shows through any of them." : null}
                </p>
              </div>

              {LISTS.filter((l) => counts[l.kind] > 0).map((l) => (
                <details key={l.kind} open={l.kind !== "skipped" && l.kind !== "masked"}>
                  <summary>
                    <span className="swatch" style={{ borderColor: l.color, borderStyle: l.kind === "unshown" ? "dashed" : "solid" }} />
                    {l.title} <span className="muted">{counts[l.kind]}</span>
                  </summary>
                  {l.note && <p className="note">{l.note}</p>}
                  <ul>
                    {items
                      .filter((it) => it.kind === l.kind)
                      .map((it) => (
                        <li key={it.key}>
                          <button
                            type="button"
                            id={`item-${it.key}`}
                            className={it.key === selected ? "item on" : "item"}
                            onClick={() => select(it)}
                            disabled={it.quads.length === 0}
                          >
                            {it.name || "(no text)"}
                            {it.detail && <span className="muted"> {it.detail}</span>}
                          </button>
                        </li>
                      ))}
                  </ul>
                </details>
              ))}

              {result.check.warnings.length > 0 && (
                <details>
                  <summary>
                    Notes on the file <span className="muted">{result.check.warnings.length}</span>
                  </summary>
                  <ul className="notes">
                    {result.check.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}

          <div className="method">
            <h2>What this checks</h2>
            <p>
              Each name is measured with the fonts Commons renders SVG files with, and every stroked line in the file is
              tested against each name's box. Lines thinner than 0.3 px on the 1280 px PNG are not counted, nor lines
              painted over by a shape drawn later or lying on a shape of their own colour.
            </p>
            <p>
              Of 40 names from the first list, picked at random from 360 Commons maps and judged without knowing the
              result, 32 had a visible line through or touching the letters, 7 did not and 1 was unclear. In 4 of the 7
              the line crossed the box but missed the letters.
            </p>
            <p>
              Nothing is uploaded. The page asks Commons for the file and its PNG; a file you open stays in your browser.
            </p>
          </div>
        </aside>
      </main>
    </>
  );
}
