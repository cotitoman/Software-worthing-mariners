import { $, $$, esc, POSITIONS, normPos, toNum, toast, money, openModal } from "./util.js";

/* ===================== Scouting =====================
   Base de jugadores (FC 27 y vida real) que cargas por CSV/Excel, con filtros avanzados,
   búsqueda por similitud, gráficos scatter y radar, y comparación con tu plantilla. */

const ATTRS = [["pace", "RIT"], ["shooting", "TIR"], ["passing", "PAS"], ["dribbling", "REG"], ["defending", "DEF"], ["physical", "FIS"]];
const GROUP = { GK: "POR", CB: "DEF", LB: "DEF", RB: "DEF", LWB: "DEF", RWB: "DEF", CDM: "MED", CM: "MED", CAM: "MED", LM: "MED", RM: "MED", LW: "DEL", RW: "DEL", CF: "DEL", ST: "DEL" };
const GCOL = { POR: "#f5b041", DEF: "#19c3c3", MED: "#7fb3ff", DEL: "#ec7063", "": "#9db3d1" };
const COLORS = ["#19c3c3", "#f5b041", "#ec7063"];

// Métricas disponibles para ejes y percentiles: [clave, etiqueta, función]
const METRICS = [
  ["overall", "OVR"], ["potential", "Potencial"], ["age", "Edad"], ["value_eur", "Valor (€)"], ["wage_eur", "Sueldo (€)"],
  ...ATTRS,
  ["g90", "Goles/90"], ["a90", "Asist./90"], ["xg90", "xG/90"], ["xa90", "xA/90"], ["minutes", "Minutos"], ["goals", "Goles"], ["assists", "Asistencias"],
];
const LOWER_BETTER = new Set(["age", "wage_eur", "value_eur"]);

/* Columnas aceptadas al importar (español/inglés) */
const ALIASES = {
  name: ["name", "nombre", "player", "jugador", "player name"],
  club: ["club", "team", "equipo"], league: ["league", "liga", "competition", "competicion", "competición"],
  nationality: ["nationality", "nacionalidad", "nation", "pais", "país"],
  position: ["position", "pos", "posicion", "posición"],
  age: ["age", "edad"], overall: ["overall", "ovr", "ova", "media", "valoracion", "valoración"], potential: ["potential", "pot", "potencial"],
  value_eur: ["value", "value_eur", "valor", "market value"], wage_eur: ["wage", "wage_eur", "sueldo", "salario", "salary"],
  contract_until: ["contract_until", "contract", "contrato", "contract end", "contract expiry"],
  foot: ["foot", "pie", "preferred foot"], height_cm: ["height", "height_cm", "altura"],
  pace: ["pace", "pac", "ritmo", "rit"], shooting: ["shooting", "sho", "tiro", "tir"], passing: ["passing", "pas", "pase"],
  dribbling: ["dribbling", "dri", "regate", "reg"], defending: ["defending", "def", "defensa"], physical: ["physical", "phy", "fisico", "físico", "fis"],
  apps: ["apps", "games", "matches", "pj", "partidos", "appearances"], minutes: ["minutes", "min", "minutos"],
  goals: ["goals", "goles", "gls"], assists: ["assists", "asistencias", "ast"], xg: ["xg", "expected goals"], xa: ["xa", "xag", "expected assists"],
  source: ["source", "fuente", "tipo"], notes: ["notes", "notas"],
};
const TEXT = new Set(["name", "club", "league", "nationality", "position", "foot", "source", "notes"]);
const norm = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const LOOK = {};
for (const [f, names] of Object.entries(ALIASES)) for (const n of names) if (!(norm(n) in LOOK)) LOOK[norm(n)] = f;

const S = {
  sb: null, user: null, el: null, tab: "buscar",
  scouts: [], squad: [], tableLimit: 100,
  f: { q: "", source: "", pos: [], ageMin: "", ageMax: "", ovrMin: "", ovrMax: "", potMin: "", valueMax: "", wageMax: "", contractMax: "", nation: "", club: "", foot: "", attr: {}, short: false, better: false, ref: "", sameGroup: true },
  sortK: "overall", sortD: -1, cmp: [], chart: null, ax: "age", ay: "overall", noSql: false,
};

/* ---------- Datos ---------- */
const derive = (p) => {
  const m = p.minutes > 0 ? p.minutes / 90 : null;
  return { ...p, g90: m ? p.goals / m : null, a90: m ? p.assists / m : null, xg90: m && p.xg != null ? Number(p.xg) / m : null, xa90: m && p.xa != null ? Number(p.xa) / m : null };
};
async function fetchAll(table) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await S.sb.from(table).select("*").range(from, from + 999);
    if (error) return { error };
    out.push(...data);
    if (data.length < 1000) break;
  }
  return { data: out };
}
async function load() {
  const [sc, sq] = await Promise.all([fetchAll("gm_scouts"), S.sb.from("gm_players").select("*")]);
  S.noSql = !!sc.error;
  S.scouts = (sc.data || []).map((p) => derive({ ...p, _src: p.source === "real" ? "Vida real" : "FC 27" }));
  S.squad = (sq.data || []).map((p) => derive({ ...p, source: "squad", _src: "Mi plantilla", club: "Worthing Mariners", apps: null, minutes: null, goals: null, assists: null }));
}
async function reload() { await load(); render(); }
const all = () => [...S.squad, ...S.scouts];
const gOf = (p) => GROUP[p.position] || "";
const byId = (id) => all().find((p) => p.id === id);

export async function mountScouting(el, { sb, user }) {
  S.sb = sb; S.user = user; S.el = el;
  await load();
  render();
}

/* ======================= Estructura ======================= */
function render() {
  if (S.chart) { S.chart.destroy(); S.chart = null; }
  const tabs = [["buscar", "Buscar"], ["graficos", "Gráficos"], ["comparar", `Comparar (${S.cmp.length})`], ["importar", "Importar"]];
  S.el.innerHTML = `<div class="subtabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${S.tab === k ? "on" : ""}">${l}</button>`).join("")}</div><div id="pane"></div>`;
  $$("[data-t]", S.el).forEach((b) => b.addEventListener("click", () => { S.tab = b.dataset.t; render(); }));
  const pane = $("#pane", S.el);
  if (S.noSql) { pane.innerHTML = `<div class="card"><b>Falta un paso en Supabase.</b> Ejecuta <code>supabase/schema_scouting.sql</code> en el SQL Editor y recarga la página.</div>`; return; }
  ({ buscar: renderSearch, graficos: renderCharts, comparar: renderCompare, importar: renderImport })[S.tab](pane);
}

/* ======================= Filtros ======================= */
const num = (v) => (v === "" || v == null ? null : toNum(v));
function similarity(a, b) {
  const d = ATTRS.filter(([k]) => a[k] != null && b[k] != null).map(([k]) => Math.abs(a[k] - b[k]));
  return d.length >= 3 ? Math.max(0, 100 - 2 * (d.reduce((s, x) => s + x, 0) / d.length)) : null;
}
function bestSquadByPos() {
  const m = {};
  for (const p of S.squad) if (p.position && p.overall != null) m[p.position] = Math.max(m[p.position] ?? 0, p.overall);
  return m;
}
function filtered() {
  const f = S.f, q = norm(f.q), best = f.better ? bestSquadByPos() : null, ref = f.ref ? byId(f.ref) : null;
  const A = { ageMin: num(f.ageMin), ageMax: num(f.ageMax), ovrMin: num(f.ovrMin), ovrMax: num(f.ovrMax), potMin: num(f.potMin), valueMax: num(f.valueMax), wageMax: num(f.wageMax), contractMax: num(f.contractMax) };
  let rows = S.scouts.filter((p) => {
    if (f.source && p.source !== f.source) return false;
    if (q && !norm(p.name + " " + (p.club || "")).includes(q)) return false;
    if (f.pos.length && !f.pos.includes(p.position)) return false;
    if (A.ageMin != null && !(p.age >= A.ageMin)) return false;
    if (A.ageMax != null && !(p.age <= A.ageMax)) return false;
    if (A.ovrMin != null && !(p.overall >= A.ovrMin)) return false;
    if (A.ovrMax != null && !(p.overall <= A.ovrMax)) return false;
    if (A.potMin != null && !(p.potential >= A.potMin)) return false;
    if (A.valueMax != null && !(p.value_eur <= A.valueMax)) return false;
    if (A.wageMax != null && !(p.wage_eur <= A.wageMax)) return false;
    if (A.contractMax != null && !(p.contract_until <= A.contractMax)) return false;
    if (f.nation && !norm(p.nationality).includes(norm(f.nation))) return false;
    if (f.club && !norm((p.club || "") + " " + (p.league || "")).includes(norm(f.club))) return false;
    if (f.foot && p.foot !== f.foot) return false;
    for (const [k, v] of Object.entries(f.attr)) if (v !== "" && !(p[k] >= Number(v))) return false;
    if (f.short && !p.shortlist) return false;
    if (best && !(p.overall > (best[p.position] ?? -1))) return false;
    if (ref && f.sameGroup && gOf(p) !== gOf(ref)) return false;
    return true;
  });
  if (ref) rows = rows.map((p) => ({ ...p, sim: similarity(ref, p) })).filter((p) => p.sim != null);
  return rows;
}

/* ======================= Buscar ======================= */
function renderSearch(pane) {
  const f = S.f;
  const refOpts = `<option value="">— ninguno —</option><optgroup label="Mi plantilla">${S.squad.map((p) => `<option value="${p.id}" ${f.ref === p.id ? "selected" : ""}>${esc(p.name)} (${esc(p.position || "–")})</option>`).join("")}</optgroup>
    <optgroup label="Lista de seguimiento">${S.scouts.filter((p) => p.shortlist).map((p) => `<option value="${p.id}" ${f.ref === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</optgroup>`;
  pane.innerHTML = `
    <div class="card"><div class="row">
      <div><label>Nombre o club</label><input id="q" value="${esc(f.q)}"></div>
      <div><label>Fuente</label><select id="source"><option value="">Todas</option><option value="fc27" ${f.source === "fc27" ? "selected" : ""}>FC 27</option><option value="real" ${f.source === "real" ? "selected" : ""}>Vida real</option></select></div>
      <div><label>Nacionalidad</label><input id="nation" value="${esc(f.nation)}"></div>
      <div><label>Club / liga</label><input id="club" value="${esc(f.club)}"></div>
    </div>
    <label>Posiciones</label>
    <div class="toolbar">${POSITIONS.map((p) => `<label style="display:inline-flex;gap:.25rem;margin:0;color:inherit"><input type="checkbox" data-pos="${p}" style="width:auto" ${f.pos.includes(p) ? "checked" : ""}>${p}</label>`).join("")}</div>
    <div class="row">
      ${[["ageMin", "Edad mín."], ["ageMax", "Edad máx."], ["ovrMin", "OVR mín."], ["ovrMax", "OVR máx."], ["potMin", "Potencial mín."], ["valueMax", "Valor máx. (€)"], ["wageMax", "Sueldo máx. (€)"], ["contractMax", "Contrato hasta (máx. año)"]]
        .map(([k, l]) => `<div><label>${l}</label><input data-n="${k}" value="${esc(f[k])}"></div>`).join("")}
      <div><label>Pie</label><select id="foot"><option value="">Cualquiera</option>${["Derecho", "Izquierdo", "Ambos"].map((x) => `<option ${f.foot === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
    </div>
    <label>Atributos mínimos</label>
    <div class="row">${ATTRS.map(([k, l]) => `<div><label>${l} ≥</label><input data-a="${k}" type="number" min="0" max="99" value="${esc(f.attr[k] ?? "")}"></div>`).join("")}</div>
    <div class="row">
      <div><label>Parecido a… (similitud de atributos)</label><select id="ref">${refOpts}</select></div>
      <div><label style="margin-top:1.4rem;color:inherit"><input type="checkbox" id="sg" style="width:auto" ${f.sameGroup ? "checked" : ""}> Solo mismo grupo de posición</label></div>
    </div>
    <div class="toolbar">
      <label style="margin:0;color:inherit"><input type="checkbox" id="short" style="width:auto" ${f.short ? "checked" : ""}> Solo lista de seguimiento ★</label>
      <label style="margin:0;color:inherit"><input type="checkbox" id="better" style="width:auto" ${f.better ? "checked" : ""}> Mejoran mi plantilla (OVR mayor que mi mejor en su posición)</label>
      <button class="btn ghost sm" id="reset">Limpiar filtros</button>
    </div></div>
    <div id="res"></div>`;

  const upd = () => results($("#res", pane));
  const bind = (sel, fn) => $$(sel, pane).forEach((x) => x.addEventListener("input", () => { fn(x); upd(); }));
  bind("#q", (x) => (f.q = x.value)); bind("#nation", (x) => (f.nation = x.value)); bind("#club", (x) => (f.club = x.value));
  bind("#source", (x) => (f.source = x.value)); bind("#foot", (x) => (f.foot = x.value));
  bind("[data-n]", (x) => (f[x.dataset.n] = x.value)); bind("[data-a]", (x) => (f.attr[x.dataset.a] = x.value));
  bind("[data-pos]", (x) => { f.pos = $$("[data-pos]:checked", pane).map((c) => c.dataset.pos); });
  $("#short", pane).addEventListener("change", (e) => { f.short = e.target.checked; upd(); });
  $("#better", pane).addEventListener("change", (e) => { f.better = e.target.checked; upd(); });
  $("#sg", pane).addEventListener("change", (e) => { f.sameGroup = e.target.checked; upd(); });
  $("#ref", pane).addEventListener("change", (e) => { f.ref = e.target.value; if (f.ref) { S.sortK = "sim"; S.sortD = -1; } else if (S.sortK === "sim") { S.sortK = "overall"; } renderSearch(pane); });
  $("#reset", pane).addEventListener("click", () => {
    Object.assign(f, { q: "", source: "", pos: [], ageMin: "", ageMax: "", ovrMin: "", ovrMax: "", potMin: "", valueMax: "", wageMax: "", contractMax: "", nation: "", club: "", foot: "", attr: {}, short: false, better: false, ref: "", sameGroup: true });
    if (S.sortK === "sim") S.sortK = "overall";
    renderSearch(pane);
  });
  upd();
}

function results(box) {
  const rows = filtered();
  const k = S.sortK;
  rows.sort((a, b) => {
    const x = a[k], y = b[k];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * S.sortD;
  });
  const hasRef = !!S.f.ref;
  const cols = [["name", "Nombre"], ...(hasRef ? [["sim", "Similitud"]] : []), ["position", "Pos"], ["age", "Edad"], ["overall", "OVR"], ["potential", "POT"], ["club", "Club"],
    ["value_eur", "Valor"], ["wage_eur", "Sueldo"], ["contract_until", "Contrato"], ...ATTRS, ["g90", "G/90"], ["a90", "A/90"], ["_src", "Fuente"]];
  const shown = rows.slice(0, S.tableLimit);
  const fmt = (p, key) => {
    const v = p[key];
    if (v == null) return "–";
    if (key === "value_eur" || key === "wage_eur") return money(v);
    if (key === "g90" || key === "a90") return Number(v).toFixed(2);
    if (key === "sim") return Math.round(v) + "%";
    return esc(v);
  };
  box.innerHTML = `<div class="toolbar"><b>${rows.length}</b> <span class="muted">jugadores encontrados${S.scouts.length ? "" : " — importa tu base en la pestaña Importar"}</span></div>
    <div class="tw"><table><thead><tr><th></th>${cols.map(([c, l]) => `<th class="s" data-k="${c}">${l}${S.sortK === c ? (S.sortD > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}<th></th></tr></thead>
    <tbody>${shown.map((p) => `<tr data-id="${p.id}"><td><button class="btn ghost sm" data-star="${p.id}" title="Lista de seguimiento">${p.shortlist ? "★" : "☆"}</button></td>
      ${cols.map(([c]) => c === "name" ? `<td><b>${esc(p.name)}</b></td>` : c === "position" ? `<td><span class="pos">${esc(p.position || "–")}</span></td>` : `<td class="${c === "overall" ? "ovr" : ""}">${fmt(p, c)}</td>`).join("")}
      <td><button class="btn ghost sm" data-cmp="${p.id}">⚖</button></td></tr>`).join("")}</tbody></table></div>
    ${rows.length > shown.length ? `<div class="actions"><button class="btn ghost" id="more">Mostrar más (${rows.length - shown.length})</button></div>` : ""}`;
  $$("th.s", box).forEach((th) => th.addEventListener("click", () => {
    const c = th.dataset.k;
    if (S.sortK === c) S.sortD *= -1; else { S.sortK = c; S.sortD = ["name", "club", "position", "_src"].includes(c) ? 1 : -1; }
    results(box);
  }));
  $$("[data-star]", box).forEach((b) => b.addEventListener("click", async () => {
    const p = byId(b.dataset.star), v = !p.shortlist;
    const { error } = await S.sb.from("gm_scouts").update({ shortlist: v }).eq("id", p.id);
    if (error) return toast(error.message, "err");
    p.shortlist = v; b.textContent = v ? "★" : "☆";
  }));
  $$("[data-cmp]", box).forEach((b) => b.addEventListener("click", () => { addCompare(b.dataset.cmp); toast("Añadido a Comparar"); render_tabcount(); }));
  $("#more", box)?.addEventListener("click", () => { S.tableLimit += 200; results(box); });
}
function render_tabcount() { const b = $('[data-t="comparar"]', S.el); if (b) b.textContent = `Comparar (${S.cmp.length})`; }
function addCompare(id) {
  if (!S.cmp.includes(id)) S.cmp.push(id);
  if (S.cmp.length > 3) S.cmp.shift();
}

/* ======================= Gráficos ======================= */
function renderCharts(pane) {
  const opt = (sel) => METRICS.map(([k, l]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${l}</option>`).join("");
  pane.innerHTML = `
    <div class="toolbar"><label style="margin:0">Eje X</label><select id="ax">${opt(S.ax)}</select>
      <label style="margin:0">Eje Y</label><select id="ay">${opt(S.ay)}</select>
      <label style="margin:0;color:inherit"><input type="checkbox" id="insq" style="width:auto" checked> Incluir mi plantilla</label></div>
    <p class="muted">Usa los filtros de la pestaña Buscar para decidir qué jugadores se dibujan. Clic en un punto para añadirlo a Comparar. Color: portero, defensa, medio, delantero (mi plantilla con borde blanco).</p>
    <div class="card"><canvas id="sc" height="150"></canvas></div>`;
  const draw = () => {
    if (S.chart) S.chart.destroy();
    S.ax = $("#ax", pane).value; S.ay = $("#ay", pane).value;
    const rows = [...filtered(), ...($("#insq", pane).checked ? S.squad : [])].filter((p) => p[S.ax] != null && p[S.ay] != null).slice(0, 3000);
    const lab = (k) => METRICS.find((m) => m[0] === k)[1];
    S.chart = new Chart($("#sc", pane), {
      type: "scatter",
      data: { datasets: Object.keys(GCOL).map((g) => ({
        label: g || "Sin pos.", data: rows.filter((p) => gOf(p) === g).map((p) => ({ x: Number(p[S.ax]), y: Number(p[S.ay]), p })),
        backgroundColor: GCOL[g] + "cc", borderColor: (c) => (c.raw?.p?.source === "squad" ? "#fff" : "transparent"), borderWidth: 2,
        pointRadius: (c) => (c.raw?.p?.source === "squad" ? 7 : 4),
      })) },
      options: {
        onClick: (_, els, chart) => { if (els.length) { const p = chart.data.datasets[els[0].datasetIndex].data[els[0].index].p; addCompare(p.id); toast(p.name + " añadido a Comparar"); render_tabcount(); } },
        scales: { x: { title: { display: true, text: lab(S.ax), color: "#fff" }, ticks: { color: "#9db3d1" }, grid: { color: "#23497f" } },
                  y: { title: { display: true, text: lab(S.ay), color: "#fff" }, ticks: { color: "#9db3d1" }, grid: { color: "#23497f" } } },
        plugins: { legend: { labels: { color: "#fff" } },
          tooltip: { callbacks: { label: (c) => `${c.raw.p.name} (${c.raw.p.position || "–"}, ${c.raw.p.club || ""}) — ${c.raw.x}, ${c.raw.y}` } } },
      },
    });
  };
  $$("#ax,#ay,#insq", pane).forEach((x) => x.addEventListener("change", draw));
  draw();
}

/* ======================= Comparar ======================= */
function pctile(p, key) {
  const g = gOf(p), v = p[key];
  if (v == null) return null;
  const pool = S.scouts.filter((x) => gOf(x) === g && x[key] != null);
  if (pool.length < 10) return null;
  const below = pool.filter((x) => (LOWER_BETTER.has(key) ? x[key] > v : x[key] < v)).length;
  return Math.round((below / pool.length) * 100);
}
function renderCompare(pane) {
  const ps = S.cmp.map(byId).filter(Boolean);
  const squadOpts = `<option value="">+ añadir de mi plantilla…</option>` + S.squad.map((p) => `<option value="${p.id}">${esc(p.name)} (${esc(p.position || "–")})</option>`).join("");
  pane.innerHTML = `<div class="toolbar"><select id="addsq" style="max-width:260px">${squadOpts}</select>
    ${ps.map((p, i) => `<span class="btn ghost sm" style="cursor:default;color:${COLORS[i]}">${esc(p.name)} <a href="#" data-rm="${p.id}" style="color:inherit">✕</a></span>`).join("")}
    ${ps.length ? `<button class="btn ghost sm" id="clr">Vaciar</button>` : ""}</div>
    <div id="body"></div>`;
  $("#addsq", pane).addEventListener("change", (e) => { if (e.target.value) { addCompare(e.target.value); renderCompare(pane); render_tabcount(); } });
  $$("[data-rm]", pane).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); S.cmp = S.cmp.filter((x) => x !== a.dataset.rm); renderCompare(pane); render_tabcount(); }));
  $("#clr", pane)?.addEventListener("click", () => { S.cmp = []; renderCompare(pane); render_tabcount(); });
  const body = $("#body", pane);
  if (ps.length < 2) { body.innerHTML = `<div class="card muted">Elige 2 o 3 jugadores con el botón ⚖ de la búsqueda, un clic en el gráfico, o desde tu plantilla.</div>`; return; }
  const rows = METRICS.filter(([k]) => ps.some((p) => p[k] != null));
  body.innerHTML = `<div class="grid g2"><div class="card"><canvas id="rd" height="260"></canvas></div>
    <div class="tw"><table style="min-width:0"><thead><tr><th>Métrica</th>${ps.map((p, i) => `<th style="color:${COLORS[i]}">${esc(p.name)}<br><span class="muted">${esc(p._src)} · ${esc(p.position || "–")}</span></th>`).join("")}</tr></thead>
    <tbody>${rows.map(([k, l]) => {
      const vals = ps.map((p) => p[k]), valid = vals.filter((v) => v != null);
      const best = valid.length > 1 ? (LOWER_BETTER.has(k) ? Math.min(...valid) : Math.max(...valid)) : null;
      return `<tr><td class="muted">${l}</td>${ps.map((p, i) => {
        const v = vals[i], pc = pctile(p, k);
        const t = v == null ? "–" : k === "value_eur" || k === "wage_eur" ? money(v) : ["g90", "a90", "xg90", "xa90"].includes(k) ? Number(v).toFixed(2) : v;
        return `<td class="${v != null && v === best ? "best" : ""}">${t}${pc != null ? ` <span class="muted">P${pc}</span>` : ""}</td>`;
      }).join("")}</tr>`;
    }).join("")}</tbody></table>
    <p class="muted">P = percentil dentro de tu base de scouting, entre jugadores de su mismo grupo de posición (P90 = mejor que el 90%). Requiere al menos 10 jugadores del grupo.</p></div></div>`;
  S.chart = new Chart($("#rd", body), {
    type: "radar",
    data: { labels: ATTRS.map((a) => a[1]), datasets: ps.map((p, i) => ({ label: p.name, data: ATTRS.map(([k]) => p[k] ?? 0), borderColor: COLORS[i], backgroundColor: COLORS[i] + "33", pointBackgroundColor: COLORS[i] })) },
    options: { scales: { r: { min: 0, max: 100, angleLines: { color: "#23497f" }, grid: { color: "#23497f" }, pointLabels: { color: "#fff" }, ticks: { display: false } } }, plugins: { legend: { labels: { color: "#fff" } } } },
  });
}

/* ======================= Importar ======================= */
function normalize(raw, defSource) {
  const o = {};
  for (const [k, v] of Object.entries(raw)) {
    const f = LOOK[norm(k)];
    if (!f || v === "" || v == null) continue;
    if (TEXT.has(f)) o[f] = String(v).trim();
    else { const n = toNum(v); if (n !== null) o[f] = n; }
  }
  if (!o.name) return null;
  if (o.position) o.position = normPos(o.position);
  const s = norm(o.source || "");
  o.source = /real|vida/.test(s) ? "real" : /fc|ea|game|juego/.test(s) ? "fc27" : defSource;
  if (o.foot) { const x = norm(o.foot); o.foot = /^(r|d|right|der)/.test(x) ? "Derecho" : /^(l|i|left|izq)/.test(x) ? "Izquierdo" : /both|amb/.test(x) ? "Ambos" : o.foot; }
  return o;
}
function renderImport(pane) {
  pane.innerHTML = `<div class="grid g2">
    <div class="card"><h3>Cargar jugadores a la base</h3>
      <p class="muted">Sube un CSV/JSON o pega celdas de Excel/Sheets (con fila de títulos). Columnas reconocidas: nombre, club, liga, nacionalidad, posición, edad, OVR, potencial, valor, sueldo, contrato, pie, altura,
      RIT/TIR/PAS/REG/DEF/FIS y, para la vida real, PJ, minutos, goles, asistencias, xG, xA. Si ya existe (misma fuente, nombre y club) se actualiza.</p>
      <label>Fuente de estos datos</label><select id="src"><option value="fc27">FC 27</option><option value="real">Vida real</option></select>
      <div class="drop" style="margin-top:.5rem"><input type="file" id="file" accept=".csv,.json,.tsv,text/csv,application/json"></div>
      <textarea id="paste" rows="5" style="width:100%;margin-top:.5rem" placeholder="nombre&#9;club&#9;posicion&#9;edad&#9;ovr"></textarea>
      <button class="btn ghost sm" id="pgo">Revisar lo pegado</button>
      <pre class="hint">nombre,club,posicion,edad,ovr,pot,valor,rit,tir,pas,reg,def,fis
J. Smith,Gillingham,ST,22,66,74,450K,78,65,52,64,30,66</pre></div>
    <div class="card"><h3>Base actual</h3>
      <p><b>${S.scouts.length}</b> jugadores (${S.scouts.filter((p) => p.source === "fc27").length} FC 27 · ${S.scouts.filter((p) => p.source === "real").length} vida real) · ${S.scouts.filter((p) => p.shortlist).length} en seguimiento.</p>
      <button class="btn danger sm" id="wipe">Vaciar la base de scouting</button></div></div>
    <div id="rv"></div>`;
  $("#file", pane).addEventListener("change", async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const text = await file.text();
    try {
      const raw = /\.json$/i.test(file.name) ? (() => { const j = JSON.parse(text); return Array.isArray(j) ? j : j.players || []; })() : Papa.parse(text, { header: true, skipEmptyLines: true }).data;
      preview(raw, pane);
    } catch (err) { toast("No se pudo leer el archivo: " + err.message, "err"); }
  });
  $("#pgo", pane).addEventListener("click", () => {
    const t = $("#paste", pane).value.trim();
    if (!t) return toast("Pega primero las celdas.", "err");
    preview(Papa.parse(t, { header: true, skipEmptyLines: true }).data, pane);
  });
  $("#wipe", pane).addEventListener("click", async () => {
    if (!confirm("¿Borrar TODA la base de scouting (incluida la lista de seguimiento)? La plantilla no se toca.")) return;
    const { error } = await S.sb.from("gm_scouts").delete().eq("user_id", S.user.id);
    if (error) return toast(error.message, "err");
    toast("Base vaciada"); reload();
  });
}
function preview(raw, pane) {
  const def = $("#src", pane).value;
  const rows = raw.map((r) => normalize(r, def)).filter(Boolean);
  if (!rows.length) return toast("No encontré jugadores. Revisa que exista una columna de nombre.", "err");
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const rv = $("#rv", pane);
  rv.innerHTML = `<div class="card"><h3>Vista previa: ${rows.length} jugadores</h3>
    <div class="tw" style="max-height:300px"><table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
    <tbody>${rows.slice(0, 30).map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="actions"><button class="btn" id="go">Importar ${rows.length} jugadores</button></div></div>`;
  $("#go", rv).addEventListener("click", async (e) => {
    e.target.disabled = true;
    const key = (p) => [p.source, norm(p.name), norm(p.club || "")].join("|");
    const ex = new Map(S.scouts.map((p) => [key(p), p]));
    const ins = [], upd = [];
    const seen = new Set();
    for (const r of rows) {
      const k = key(r);
      if (seen.has(k)) continue;
      seen.add(k);
      const old = ex.get(k);
      if (old) upd.push({ id: old.id, patch: r }); else ins.push({ user_id: S.user.id, ...r });
    }
    let bad = 0;
    for (let i = 0; i < ins.length; i += 400) {
      const { error } = await S.sb.from("gm_scouts").insert(ins.slice(i, i + 400));
      if (error) { bad++; toast(error.message, "err"); break; }
    }
    for (let i = 0; i < upd.length; i += 20) {
      const res = await Promise.all(upd.slice(i, i + 20).map(({ id, patch }) => S.sb.from("gm_scouts").update(patch).eq("id", id)));
      const er = res.find((r) => r.error);
      if (er) { bad++; toast(er.error.message, "err"); break; }
    }
    if (!bad) toast(`Importado: ${ins.length} nuevos, ${upd.length} actualizados`);
    reload();
  });
}
