// Where a point of the map lands in the picture: the viewBox fitted into the picture as preserveAspectRatio says
// (SVG 1.1, 7.8). Both the boxes on the PNG and the scroll to a selected name use this.

export type Fit = { sx: number; sy: number; tx: number; ty: number };

export function fitFrame(frame: readonly [number, number, number, number], w: number, h: number, par: string): Fit {
  const [vx, vy, vw, vh] = frame;
  const words = par.trim().split(/\s+/).filter((t) => t !== "defer");
  const align = words[0] ?? "xMidYMid";
  let sx = vw > 0 ? w / vw : 1;
  let sy = vh > 0 ? h / vh : 1;
  if (align !== "none") sx = sy = words[1] === "slice" ? Math.max(sx, sy) : Math.min(sx, sy);
  let tx = -vx * sx;
  let ty = -vy * sy;
  if (align !== "none") {
    const place = (where: string, room: number) => (where === "Mid" ? room / 2 : where === "Max" ? room : 0);
    tx += place(align.slice(1, 4), w - vw * sx);
    ty += place(align.slice(5, 8), h - vh * sy);
  }
  return { sx, sy, tx, ty };
}

export const at = (f: Fit, [x, y]: readonly [number, number]): [number, number] => [x * f.sx + f.tx, y * f.sy + f.ty];
