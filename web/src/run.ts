import type { CheckReply, CheckRequest } from "./worker.js";

let worker: Worker | null = null;
let next = 0;
const waiting = new Map<number, (r: CheckReply) => void>();

function start(): Worker {
  const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  w.addEventListener("message", (e: MessageEvent<CheckReply>) => {
    waiting.get(e.data.id)?.(e.data);
    waiting.delete(e.data.id);
  });
  w.addEventListener("error", (e) => {
    for (const [id, done] of waiting) done({ id, ok: false, error: e.message || "The checker stopped." });
    waiting.clear();
    worker = null;
  });
  return w;
}

/** Check a map in the worker. */
export function runCheck(svg: string, lang: string): Promise<CheckReply> {
  worker ??= start();
  const id = ++next;
  return new Promise((done) => {
    waiting.set(id, done);
    worker!.postMessage({ id, svg, lang } satisfies CheckRequest);
  });
}
