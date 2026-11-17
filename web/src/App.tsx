import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent } from "react";
import type { Quad, SvgCheck, SvgViewport } from "../../src/index.js";
import { decodeSvg, download, largerPng, lookUp, STEPS, type CommonsFile, type Picture } from "./commons.js";
import { drawable } from "./display.js";
import { commonsPage, EXAMPLES, type Example } from "./examples.js";
import { at, fitFrame } from "./fit.js";
import { runCheck } from "./run.js";
import { fileTitle } from "./title.js";
import type { Moved } from "./worker.js";

const REPO = "https://github.com/MuneAkira6/map-svg-label-placer";
type Kind = "moved" | "core" | "edge" | "overlap" | "clipped" | "masked" | "unshown" | "skipped";

const LISTS: { kind: Kind; title: string; color: string; note: string }[] = [
  { kind: "moved", title: "Moved", color: "#1A7F37", note: "Moved off the line. Only their x and y changed." },
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
  source: "commons" | "file" | "example";
  name: string;
  file?: CommonsFile;
  example?: Example;
  picture: Picture;
  check: SvgCheck;
  viewport: SvgViewport;
  ms: number;
};

/** The lists in the panel, and the outlines on the map (one per name, in the colour of its worst problem). */
function itemsOf(check: SvgCheck, moved?: ReadonlySet<number>): { items: Item[]; shapes: Shape[]; clear: Shape[] } {
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
    if (moved?.has(i) && !l.skipped) kinds.unshift(["moved"]);
    const shape = `l${i}`;
    for (const [kind, detail] of kinds) items.push({ key: `${kind}-${i}`, kind, name: l.name, detail, quads, shape });
    const worst = kinds.find(([k]) => k !== "skipped" && k !== "masked" && k !== "moved")?.[0] ?? kinds.find(([k]) => k === "moved")?.[0];
    if (worst) shapes.push({ key: shape, color: COLOR[worst], quads, name: l.name, minor: worst === "moved" });
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

const crossed = (check: SvgCheck) => check.labels.filter((l) => !l.skipped && l.line === "core" && !l.masked).length;

/** "Some map-placed.svg" for "File:Some map.svg". */
const placedName = (name: string) => `${name.replace(/^File:/i, "").replace(/\.svg$/i, "")}-placed.svg`;

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
  const [moved, setMoved] = useState<(Moved & { before: Picture; after: Picture; download: string }) | null>(null);
  const [view, setView] = useState<"before" | "after">("after");
  const [moving, setMoving] = useState(false);
  const svgText = useRef<{ key: string; text: string } | null>(null);
  const runId = useRef(0);
  const blobs = useRef<string[]>([]);

  const show = useCallback((r: Result) => {
    // Let go of the pictures and downloads of the map shown before.
    for (const u of blobs.current) if (u !== r.picture.url) URL.revokeObjectURL(u);
    blobs.current = r.picture.url.startsWith("blob:") ? [r.picture.url] : [];
    setResult(r);
    setMoved(null);
    setView("after");
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
        const url = await drawable(text);
        if (id !== runId.current) return URL.revokeObjectURL(url);
        const { width, height } = reply.viewport;
        show({ source: "file", name: file.name, picture: { url, width, height }, check: reply.check, viewport: reply.viewport, ms: reply.ms });
        history.replaceState(null, "", location.pathname);
      } catch (e) {
        if (id === runId.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (id === runId.current) setBusy(null);
      }
    },
    [show],
  );

  const loadExample = useCallback(
    async (ex: Example) => {
      const id = ++runId.current;
      setError(null);
      try {
        setBusy("Loading the example…");
        const res = await fetch(`${import.meta.env.BASE_URL}examples/${ex.file}`);
        if (!res.ok) throw new Error(`Could not load the example (HTTP ${res.status}).`);
        const text = await res.text();
        if (id !== runId.current) return;
        svgText.current = { key: `example:${ex.slug}`, text };
        const language = ex.lang ?? "en";
        setLang(language);
        setBusy("Checking the names…");
        const reply = await runCheck(text, language);
        if (id !== runId.current) return;
        if (!reply.ok) throw new Error(`Could not read the SVG: ${reply.error}`);
        const url = await drawable(text);
        if (id !== runId.current) return URL.revokeObjectURL(url);
        const { width, height } = reply.viewport;
        show({ source: "example", example: ex, name: ex.title, picture: { url, width, height }, check: reply.check, viewport: reply.viewport, ms: reply.ms });
        history.replaceState(null, "", `?example=${ex.slug}`);
      } catch (e) {
        if (id === runId.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (id === runId.current) setBusy(null);
      }
    },
    [show],
  );

  // A link with ?file= checks that file straight away; otherwise an example is shown.
  useEffect(() => {
    if (params.get("file")) void checkCommons(params.get("file")!, params.get("lang") ?? "en");
    else void loadExample(EXAMPLES.find((e) => e.slug === params.get("example")) ?? EXAMPLES[0]!);
  }, [params, checkCommons, loadExample]);

  const moveNames = async () => {
    if (!result || !svgText.current) return;
    const id = runId.current;
    const text = svgText.current.text;
    setMoving(true);
    setError(null);
    try {
      const reply = await runCheck(text, lang, true);
      if (id !== runId.current) return;
      if (!reply.ok || !reply.moved) throw new Error(`Could not move the names: ${reply.ok ? "no result" : reply.error}`);
      const { width, height } = result.viewport;
      // Commons' PNG cannot show the moved names, so both versions are drawn by the browser.
      const before = result.source === "commons" ? { url: await drawable(text), width, height } : result.picture;
      const after = { url: await drawable(reply.moved.svg), width, height };
      const dl = URL.createObjectURL(new Blob([reply.moved.svg], { type: "image/svg+xml" }));
      if (id !== runId.current) return;
      blobs.current.push(after.url, dl, ...(before === result.picture ? [] : [before.url]));
      setMoved({ ...reply.moved, before, after, download: dl });
      setView("after");
      setSelected(null);
      setSharper(null);
    } catch (e) {
      if (id === runId.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMoving(false);
    }
  };

  const recheckLanguage = async (language: string) => {
    if (!result || language === lang) return;
    setLang(language);
    if (result.source === "commons") await checkCommons(result.name, language);
    else if (result.source === "example") await loadExample({ ...result.example!, lang: language });
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

  // What is shown: the map as it was, or with the names moved.
  const after = view === "after" && moved !== null;
  const shownCheck = result ? (after ? moved!.check : result.check) : null;
  const movedIdx = useMemo(() => (moved ? new Set(moved.labels) : undefined), [moved]);
  const { items, shapes, clear } = useMemo(
    () => (shownCheck ? itemsOf(shownCheck, after ? movedIdx : undefined) : { items: [], shapes: [], clear: [] }),
    [shownCheck, after, movedIdx],
  );
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
  const pic = result ? (after ? moved!.after : moved ? moved.before : result.picture) : undefined;
  const fitScale = pic ? Math.min((room.w - 2) / pic.width, (room.h - 2) / pic.height) : 1;
  const scale = fitScale * zoom;
  const fit = useMemo(
    () => (result && pic ? fitFrame(result.check.frame, pic.width, pic.height, result.viewport.preserveAspectRatio) : null),
    [result, pic],
  );
  const points = (q: Quad) => q.map((p) => at(fit!, p).join(",")).join(" ");

  // Zooming in past Commons' 1280 px rendering: ask for the next standard width.
  useEffect(() => {
    if (!result || result.source !== "commons" || moved || !pic) return;
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
  }, [result, moved, pic, scale, sharper, lang]);

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
  const named = shownCheck ? shownCheck.labels.length : 0;
  const credit = result?.example
    ? { author: result.example.author, license: result.example.license, licenseUrl: result.example.licenseUrl }
    : result?.file
      ? { author: result.file.artist, license: result.file.license, licenseUrl: result.file.licenseUrl }
      : null;

  return (
    <>
      <header className="top">
        <h1>SVG map labels</h1>
        <nav>
          <a href={`${REPO}#checking-a-map`}>About</a>
          <a href={REPO}>Source</a>
        </nav>
      </header>
      <main className="main">
        <section className="mapside" style={pic ? ({ "--aspect": pic.height / pic.width } as CSSProperties) : undefined}>
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
            <span className="muted" title={result?.source === "commons" && !moved ? "Of the 1280 px PNG" : "Of the SVG's own size"}>
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
                <img src={sharper?.url ?? pic.url} alt={result.source === "commons" && !moved ? "The map as Commons draws it" : "The map as your browser draws it, in the fonts Commons uses"} draggable={false} onError={() => setSharper(null)} />
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
          <p className="intro">
            Finds the names on an SVG map that have a line through them, as Wikimedia Commons draws the map, and moves those it can off the line.
          </p>
          <nav className="examples" aria-label="Examples">
            <span className="muted">Examples:</span>
            {EXAMPLES.map((ex) => (
              <a
                key={ex.slug}
                href={`?example=${ex.slug}`}
                aria-current={result?.example?.slug === ex.slug ? "true" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  void loadExample(ex);
                }}
              >
                {ex.label}
              </a>
            ))}
          </nav>
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
            </div>
          </form>

          {busy && <p className="status">{busy}</p>}
          {error && <p className="error">{error}</p>}

          {result && (
            <>
              <div className="about-file">
                <h2>
                  {result.source === "commons" ? (
                    <a href={result.file!.page}>{result.name}</a>
                  ) : result.source === "example" ? (
                    <a href={commonsPage(result.name)}>{result.name}</a>
                  ) : (
                    result.name
                  )}
                </h2>
                {result.source === "file" ? (
                  <p className="muted">Drawn by your browser in the fonts Commons uses, except Chinese, Japanese and Korean text. The file stays on your computer.</p>
                ) : (
                  <p className="muted">
                    {result.source === "example" ? "Example from Wikimedia Commons, copied on 16 November 2026. " : ""}
                    {credit?.author ? `Author: ${credit.author}.` : "Author: see the file page."}
                    {credit?.license && (
                      <>
                        {" Licence: "}
                        {credit.licenseUrl ? <a href={credit.licenseUrl}>{credit.license}</a> : credit.license}.
                      </>
                    )}{" "}
                    {result.source === "commons" && !moved ? "The picture is Commons' own rendering." : "Drawn by your browser in the fonts Commons uses, except Chinese, Japanese and Korean text."}
                  </p>
                )}
                <p>
                  {named} {named === 1 ? "name" : "names"}, checked in {Math.max(1, Math.round(result.ms))} ms.{" "}
                  {crossed(result.check) === 0 && counts.edge === 0 ? "No line shows through any of them." : null}
                </p>
                {moved ? (
                  <div className="move">
                    <div className="seg" role="group" aria-label="Show the map">
                      <button type="button" aria-pressed={view === "before"} onClick={() => setView("before")}>
                        Before
                      </button>
                      <button type="button" aria-pressed={view === "after"} onClick={() => setView("after")}>
                        After
                      </button>
                    </div>
                    <p>
                      Names with a line through them: {crossed(result.check)} → {crossed(moved.check)}.{" "}
                      {[
                        `${moved.moves.length} moved`,
                        ...(["full", "letter", "split", "size"] as const).flatMap((why) => {
                          const n = moved.stuck.filter((x) => x.why === why).length;
                          if (!n) return [];
                          if (why === "full") return [`${n} had no free place nearby`];
                          if (why === "letter") return [`${n} single ${n === 1 ? "letter" : "letters"} left alone`];
                          if (why === "split") return [`${n} ${n === 1 ? "half of a split name" : "halves of split names"} left alone`];
                          return [`${n} could not be measured`];
                        }),
                      ].join(", ")}
                      , in {Math.max(1, Math.round(moved.ms))} ms.
                    </p>
                    <p>
                      <a className="button primary" href={moved.download} download={placedName(result.name)}>
                        Download the SVG
                      </a>{" "}
                      <span className="muted">
                        Only the x and y of the moved names differ.{result.source !== "file" && " The file keeps the map's licence."}
                      </span>
                    </p>
                  </div>
                ) : crossed(result.check) > 0 ? (
                  <p>
                    <button type="button" className="primary" onClick={() => void moveNames()} disabled={moving || busy !== null}>
                      {moving ? "Moving…" : "Move these names"}
                    </button>{" "}
                    <span className="muted">off the lines through them</span>
                  </p>
                ) : null}
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
              Of 40 names in "Line through the letters", picked at random from 360 Commons maps and judged without knowing the
              result, 32 had a visible line through or touching the letters, 7 did not and 1 was unclear. In 4 of the 7
              the line crossed the box but missed the letters.
            </p>
            <h2>How names are moved</h2>
            <p>
              Only the names in "Line through the letters" move. Each goes to the nearest place within two letter heights
              where no line comes within a pixel of it. A name stays in the area it is in and keeps off other names and
              points. A name with a point next to it (a dot, square, triangle or star) stays nearer to that point than to
              any other, and its gap to that point grows by half a letter height at most. Only its x and y change. Single letters
              stay, as they are mostly the spaced-out letters of an area's name, and so does either half of a name written as
              two texts end to end.
            </p>
            <p>
              Over the same maps, 664 names moved (5% of all names), by a median of 13 px at the map's nominal size, and
              the names with a line through them went from 3,522 to 2,859. No map got more names on top of each other or
              cut off. In a blind check of 40 moved names picked at random, with old and new places shuffled, 39 had no
              line on the letters after the move and 1 had a line too thin for the check to count. Of the same 40, 28
              still read as naming the same thing and 12 less clearly; none read wrongly. Look over the moved names before
              you use the file.
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
