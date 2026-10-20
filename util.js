export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export const POSITIONS = ["GK", "CB", "LB", "RB", "LWB", "RWB", "CDM", "CM", "CAM", "LM", "RM", "LW", "RW", "CF", "ST"];

const POS_ALIAS = {
  POR: "GK", PT: "GK", DFC: "CB", DF: "CB", LI: "LB", LD: "RB", CAI: "LWB", CAD: "RWB",
  MCD: "CDM", MC: "CM", MCO: "CAM", MP: "CAM", MI: "LM", MD: "RM", EI: "LW", ED: "RW",
  SD: "CF", DC: "ST", DEL: "ST",
};

export function isPos(t) {
  const u = String(t || "").trim().toUpperCase();
  return POSITIONS.includes(u) || u in POS_ALIAS;
}
export function normPos(p) {
  const u = String(p || "").trim().toUpperCase();
  if (!u) return null;
  return POSITIONS.includes(u) ? u : POS_ALIAS[u] || u;
}

// Acepta "1.200.000", "1,5M", "€800K", "72", etc.
export function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[€$£\s]/g, "");
  let mult = 1;
  if (/k$/i.test(s)) { mult = 1e3; s = s.slice(0, -1); }
  else if (/m$/i.test(s)) { mult = 1e6; s = s.slice(0, -1); }
  // Puntos como separador de miles: "1.200.000" o "38.000" (grupos de 3 dígitos)
  if (!mult || mult === 1) { if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); }
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, "");
  s = s.replace(",", ".");
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n * mult;
}

export function toast(msg, kind = "ok") {
  const box = document.getElementById("toasts");
  const d = document.createElement("div");
  d.className = "toast" + (kind === "err" ? " err" : "");
  d.textContent = msg;
  box.appendChild(d);
  setTimeout(() => d.remove(), kind === "err" ? 6000 : 3000);
}

export function money(n) {
  if (n === null || n === undefined) return "–";
  const v = Number(n);
  if (v >= 1e6) return "€" + (v / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (v >= 1e3) return "€" + Math.round(v / 1e3) + "K";
  return "€" + v;
}

export function per(a, b) {
  return b > 0 ? (a / b).toFixed(2) : "–";
}

export function openModal(html, { wide = false } = {}) {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal ${wide ? "wide" : ""}">${html}</div>`;
  bg.addEventListener("mousedown", (e) => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  return { el: bg.firstElementChild, close };
}
