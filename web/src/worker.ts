// Reads, checks and moves the names off the main thread: a map with tens of thousands of paths takes a second or two.
import { checkSvgLabels, fixSvgLabels, readSvgLabels, svgViewport, type FixMove, type FixResult, type SvgCheck, type SvgViewport } from "../../src/index.js";

/** `labels`: the moved names among the labels of the new check. */
export type Moved = { svg: string; moves: FixMove[]; stuck: FixResult["stuck"]; check: SvgCheck; labels: number[]; ms: number };

export type CheckRequest = { id: number; svg: string; lang: string; move: boolean };
export type CheckReply =
  | { id: number; ok: true; check: SvgCheck; viewport: SvgViewport; ms: number; moved?: Moved }
  | { id: number; ok: false; error: string };

const post = (m: CheckReply) => (globalThis as unknown as { postMessage(m: CheckReply): void }).postMessage(m);

addEventListener("message", (e: MessageEvent<CheckRequest>) => {
  const { id, svg, lang, move } = e.data;
  const t0 = performance.now();
  try {
    const viewport = svgViewport(svg);
    if (!move) {
      post({ id, ok: true, check: checkSvgLabels(svg, { lang }), viewport, ms: performance.now() - t0 });
      return;
    }
    // Move the names, then check the result the same way.
    const fix = fixSvgLabels(svg, { lang });
    const ms = performance.now() - t0;
    // Only x and y changed, so each <text> keeps its place in the document: find the moved ones by that.
    const texts = new Set(fix.moves.flatMap((m) => m.texts));
    const labels = readSvgLabels(fix.svg, { lang })
      .groups.map((g, i) => (g.texts.some((t) => texts.has(t.index)) ? i : -1))
      .filter((i) => i >= 0);
    const moved: Moved = { svg: fix.svg, moves: fix.moves, stuck: fix.stuck, check: checkSvgLabels(fix.svg, { lang }), labels, ms };
    post({ id, ok: true, check: fix.before, viewport, ms, moved });
  } catch (err) {
    post({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
