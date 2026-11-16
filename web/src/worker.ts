// Reads and checks the map off the main thread: a map with tens of thousands of paths takes a second or two.
import { checkSvgLabels, svgViewport, type SvgCheck, type SvgViewport } from "../../src/index.js";

export type CheckRequest = { id: number; svg: string; lang: string };
export type CheckReply =
  | { id: number; ok: true; check: SvgCheck; viewport: SvgViewport; ms: number }
  | { id: number; ok: false; error: string };

const post = (m: CheckReply) => (globalThis as unknown as { postMessage(m: CheckReply): void }).postMessage(m);

addEventListener("message", (e: MessageEvent<CheckRequest>) => {
  const { id, svg, lang } = e.data;
  const t0 = performance.now();
  try {
    const viewport = svgViewport(svg);
    const check = checkSvgLabels(svg, { lang });
    post({ id, ok: true, check, viewport, ms: performance.now() - t0 });
  } catch (err) {
    post({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
