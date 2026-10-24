/* Geometría y dibujo SVG de las anotaciones del editor de vídeo.
   Todas las coordenadas se guardan normalizadas (0..1) respecto al fotograma del vídeo;
   el lienzo SVG usa un viewBox de 1000 × (1000/proporción), así que no se deforman al cambiar de tamaño. */

export const TOOLS = [
  ["select", "Seleccionar", "↖"], ["arrow", "Flecha", "→"], ["line", "Línea", "／"], ["curve", "Curva", "⌒"], ["run", "Desmarque / carrera", "⇢"],
  ["circle", "Círculo", "◯"], ["ellipse", "Elipse", "⬭"], ["rect", "Rectángulo", "▭"],
  ["zone_press", "Zona de presión", "▨"], ["zone_space", "Espacio libre", "◌"], ["polyline", "Línea defensiva", "⌇"], ["pen", "Lápiz", "✎"],
  ["text", "Texto", "T"], ["number", "Número", "①"], ["label", "Etiqueta de jugador", "▤"],
];
export const TOOL_LABEL = Object.fromEntries(TOOLS.map(([id, l]) => [id, l]));
export const PTS_TYPES = new Set(["arrow", "line", "curve", "run", "polyline", "pen"]);
export const BOX_TYPES = new Set(["circle", "ellipse", "rect", "zone_press", "zone_space"]);
export const POINT_TYPES = new Set(["text", "number", "label"]);
export const COLORS = ["#f5b041", "#ec7063", "#2ecc71", "#19c3c3", "#7fb3ff", "#ffffff", "#111111", "#c39bd3"];

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }));

/* ---------- creación a partir de un arrastre ---------- */
export function createAnn(type, p0, p1, g, base) {
  const a = { id: uuid(), type, color: base.color, width: base.width, t_start: base.t_start, t_end: base.t_end, data: {} };
  if (type === "arrow" || type === "line" || type === "run") a.data.pts = [p0, p1];
  else if (type === "curve") {
    const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2, dx = (p1[0] - p0[0]) * g.W, dy = (p1[1] - p0[1]) * g.H, L = Math.hypot(dx, dy) || 1;
    a.data.pts = [p0, [clamp(mx - (dy / L) * 0.12 * 0.6), clamp(my + (dx / L) * 0.12 * 0.6 * (g.W / g.H))], p1];
  } else if (type === "circle") {
    const r = Math.hypot((p1[0] - p0[0]) * g.W, (p1[1] - p0[1]) * g.H);
    a.data = { x: p0[0] - r / g.W, y: p0[1] - r / g.H, w: (2 * r) / g.W, h: (2 * r) / g.H, fill: !!base.fill };
  } else if (BOX_TYPES.has(type)) {
    a.data = { x: Math.min(p0[0], p1[0]), y: Math.min(p0[1], p1[1]), w: Math.abs(p1[0] - p0[0]), h: Math.abs(p1[1] - p0[1]), fill: type.startsWith("zone") ? true : !!base.fill };
    if (type === "zone_press") a.data.text = "Presión"; if (type === "zone_space") a.data.text = "Espacio";
  } else if (type === "text") a.data = { x: p0[0], y: p0[1], text: "Texto", size: 34 };
  else if (type === "label") a.data = { x: p0[0], y: p0[1], text: "Jugador", size: 28 };
  else if (type === "number") a.data = { x: p0[0], y: p0[1], n: base.n || 1, size: 30 };
  return a;
}

/* ---------- visibilidad ---------- */
export const isVisible = (a, t) => !a.data.hidden && t >= a.t_start - 0.001 && t <= a.t_end + 0.001;

/* ---------- dibujo ---------- */
const P = (pt, g) => [pt[0] * g.W, pt[1] * g.H];
function head(from, to, w, color) {
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0]), s = 12 + w * 2.6, sp = 0.45;
  const a = [to[0] - s * Math.cos(ang - sp), to[1] - s * Math.sin(ang - sp)], b = [to[0] - s * Math.cos(ang + sp), to[1] - s * Math.sin(ang + sp)];
  return `<polygon points="${to[0]},${to[1]} ${a[0]},${a[1]} ${b[0]},${b[1]}" fill="${color}"/>`;
}
const smooth = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

export function shapeSVG(a, g, o = {}) {
  const c = a.color, w = a.width, d = a.data, op = o.ghost ? 0.22 : 1;
  const st = `stroke="${c}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  let s = "";
  if (PTS_TYPES.has(a.type)) {
    const pts = d.pts.map((p) => P(p, g));
    if (a.type === "arrow") s = `<line x1="${pts[0][0]}" y1="${pts[0][1]}" x2="${pts[1][0]}" y2="${pts[1][1]}" ${st}/>${head(pts[0], pts[1], w, c)}`;
    else if (a.type === "line") s = `<line x1="${pts[0][0]}" y1="${pts[0][1]}" x2="${pts[1][0]}" y2="${pts[1][1]}" ${st}/>`;
    else if (a.type === "run") s = `<line x1="${pts[0][0]}" y1="${pts[0][1]}" x2="${pts[1][0]}" y2="${pts[1][1]}" ${st} stroke-dasharray="${w * 2.5} ${w * 2}"/>${head(pts[0], pts[1], w, c)}`;
    else if (a.type === "curve") s = `<path d="M${pts[0][0]},${pts[0][1]} Q${pts[1][0]},${pts[1][1]} ${pts[2][0]},${pts[2][1]}" ${st}/>${head(pts[1], pts[2], w, c)}`;
    else if (a.type === "polyline") s = `<path d="${smooth(pts)}" stroke="${c}" stroke-width="${w * 1.4}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="${w * 1.6}" fill="${c}"/>`).join("")}`;
    else s = `<path d="${smooth(pts)}" ${st}/>`;
  } else if (BOX_TYPES.has(a.type)) {
    const x = d.x * g.W, y = d.y * g.H, bw = d.w * g.W, bh = d.h * g.H;
    const fill = d.fill ? `fill="${c}" fill-opacity="${a.type === "zone_press" ? 0.28 : 0.2}"` : 'fill="none"';
    const dash = a.type === "zone_space" ? `stroke-dasharray="${w * 2.5} ${w * 1.8}"` : a.type === "zone_press" ? `stroke-dasharray="${w * 1.2} ${w * 1.2}"` : "";
    if (a.type === "rect" || a.type === "zone_press") s = `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="${a.type === "rect" ? 2 : 6}" ${fill} stroke="${c}" stroke-width="${w}" ${dash}/>`;
    else s = `<ellipse cx="${x + bw / 2}" cy="${y + bh / 2}" rx="${bw / 2}" ry="${bh / 2}" ${fill} stroke="${c}" stroke-width="${w}" ${dash}/>`;
    if (d.text && a.type.startsWith("zone")) s += `<text x="${x + bw / 2}" y="${y + bh / 2}" text-anchor="middle" dominant-baseline="middle" font-size="26" font-weight="800" fill="#fff" stroke="#000" stroke-width="5" paint-order="stroke">${esc(d.text)}</text>`;
  } else if (a.type === "text") {
    s = `<text x="${d.x * g.W}" y="${d.y * g.H}" font-size="${d.size}" font-weight="800" fill="${c}" stroke="#000" stroke-width="${d.size / 6}" paint-order="stroke" dominant-baseline="middle">${esc(d.text)}</text>`;
  } else if (a.type === "label") {
    const tw = Math.max(40, String(d.text).length * d.size * 0.58 + 20), th = d.size + 14, x = d.x * g.W, y = d.y * g.H;
    s = `<rect x="${x - tw / 2}" y="${y - th / 2}" width="${tw}" height="${th}" rx="7" fill="${c}"/><text x="${x}" y="${y}" font-size="${d.size}" font-weight="800" fill="${lum(c) > 0.55 ? "#111" : "#fff"}" text-anchor="middle" dominant-baseline="middle">${esc(d.text)}</text>`;
  } else if (a.type === "number") {
    const r = d.size * 0.75, x = d.x * g.W, y = d.y * g.H;
    s = `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" stroke="#000" stroke-opacity=".5" stroke-width="2"/><text x="${x}" y="${y}" font-size="${d.size}" font-weight="900" fill="${lum(c) > 0.55 ? "#111" : "#fff"}" text-anchor="middle" dominant-baseline="central">${esc(d.n)}</text>`;
  }
  return `<g data-id="${a.id}" opacity="${op}">${s}</g>`;
}
function lum(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return 0.5; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; }

/* ---------- selección, asas y movimiento ---------- */
export function handles(a, g) {
  const d = a.data;
  if (PTS_TYPES.has(a.type) && a.type !== "pen") return d.pts.map((p, i) => ({ id: "p" + i, x: p[0], y: p[1] }));
  if (BOX_TYPES.has(a.type)) return [{ id: "nw", x: d.x, y: d.y }, { id: "ne", x: d.x + d.w, y: d.y }, { id: "sw", x: d.x, y: d.y + d.h }, { id: "se", x: d.x + d.w, y: d.y + d.h }];
  return [];
}
export function moveAnn(a, dx, dy) {
  const d = a.data;
  if (d.pts) d.pts = d.pts.map(([x, y]) => [clamp(x + dx), clamp(y + dy)]);
  else if ("w" in d) { d.x = clamp(d.x + dx, -d.w + 0.01, 1 - 0.01); d.y = clamp(d.y + dy, -d.h + 0.01, 1 - 0.01); }
  else { d.x = clamp(d.x + dx); d.y = clamp(d.y + dy); }
}
export function setHandle(a, hid, x, y) {
  const d = a.data; x = clamp(x); y = clamp(y);
  if (hid[0] === "p") { d.pts[+hid.slice(1)] = [x, y]; return; }
  const x2 = hid.includes("e") ? d.x : d.x + d.w, y2 = hid.includes("s") ? d.y : d.y + d.h; // esquina opuesta fija
  d.x = Math.min(x, x2); d.y = Math.min(y, y2); d.w = Math.abs(x - x2); d.h = Math.abs(y - y2);
}
const segDist = (p, a, b) => { const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy; let t = L ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy)); };
export function hit(a, nx, ny, g, tol = 14) {
  const p = [nx * g.W, ny * g.H], d = a.data, r = tol + a.width / 2;
  if (PTS_TYPES.has(a.type)) {
    let pts = d.pts.map((q) => P(q, g));
    if (a.type === "curve") { const [p0, c, p1] = pts; pts = Array.from({ length: 25 }, (_, i) => { const t = i / 24; return [(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]]; }); }
    for (let i = 0; i < pts.length - 1; i++) if (segDist(p, pts[i], pts[i + 1]) <= r) return true;
    return false;
  }
  if (BOX_TYPES.has(a.type)) return p[0] >= d.x * g.W - r && p[0] <= (d.x + d.w) * g.W + r && p[1] >= d.y * g.H - r && p[1] <= (d.y + d.h) * g.H + r;
  const x = d.x * g.W, y = d.y * g.H;
  if (a.type === "number") return Math.hypot(p[0] - x, p[1] - y) <= d.size * 0.75 + tol;
  const tw = Math.max(40, String(d.text).length * d.size * 0.58 + 20);
  return a.type === "label" ? Math.abs(p[0] - x) <= tw / 2 + tol && Math.abs(p[1] - y) <= d.size / 2 + 7 + tol : p[0] >= x - tol && p[0] <= x + tw + tol && Math.abs(p[1] - y) <= d.size / 2 + tol;
}
export const cloneAnn = (a) => JSON.parse(JSON.stringify(a));
