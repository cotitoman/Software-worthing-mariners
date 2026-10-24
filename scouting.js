import { activePlayers } from "./players.js";

import { $, $$, esc, POSITIONS, normPos, toNum, toast, money, openModal } from "./util.js";

/* ===================== Scouting =====================
   Base de jugadores (FC 27 y vida real) que cargas por CSV/Excel, con filtros avanzados,
   búsqueda por similitud, gráficos scatter y radar, y comparación con tu plantilla. */

const ATTRS = [["pace", "RIT"], ["shooting", "TIR"], ["passing", "PAS"], ["dribbling", "REG"], ["defending", "DEF"], ["physical", "FIS"]];
const GROUP = { GK: "POR", CB: "DEF", LB: "DEF", RB: "DEF", LWB: "DEF", RWB: "DEF", CDM: "MED", CM: "MED", CAM: "MED", LM: "MED", RM: "MED", LW: "DEL", RW: "DEL", CF: "DEL", ST: "DEL" };
const GCOL = { POR: "#f5b041", DEF: "#19c3c3", MED: "#7fb3ff", DEL: "#ec7063", "": "#9db3d1" };
const COLORS = ["#19c3c3", "#f5b041", "#ec7063"];

/* Atributos detallados de la base FC 27 (agrupados como en el juego) */
const DETAIL = [
  ["Ataque", [["attacking_crossing", "Centros"], ["attacking_finishing", "Definición"], ["attacking_heading_accuracy", "Cabezazo"], ["attacking_short_passing", "Pase corto"], ["attacking_volleys", "Voleas"]]],
  ["Habilidad", [["skill_dribbling", "Regate (det.)"], ["skill_curve", "Efecto"], ["skill_fk_accuracy", "Tiros libres"], ["skill_long_passing", "Pase largo"], ["skill_ball_control", "Control"]]],
  ["Movimiento", [["movement_acceleration", "Aceleración"], ["movement_sprint_speed", "Velocidad punta"], ["movement_agility", "Agilidad"], ["movement_reactions", "Reacciones"], ["movement_balance", "Equilibrio"]]],
  ["Potencia", [["power_shot_power", "Fuerza de tiro"], ["power_jumping", "Salto"], ["power_stamina", "Resistencia"], ["power_strength", "Fuerza"], ["power_long_shots", "Tiros lejanos"]]],
  ["Mentalidad", [["mentality_aggression", "Agresividad"], ["mentality_interceptions", "Intercepciones"], ["mentality_positioning", "Colocación"], ["mentality_vision", "Visión"], ["mentality_penalties", "Penaltis"], ["mentality_composure", "Compostura"]]],
  ["Defensa (det.)", [["defending_awareness", "Conciencia defensiva"], ["defending_standing_tackle", "Entrada de pie"], ["defending_sliding_tackle", "Entrada deslizante"]]],
  ["Portero", [["goalkeeping_diving", "Estirada"], ["goalkeeping_handling", "Blocaje"], ["goalkeeping_kicking", "Saque"], ["goalkeeping_positioning", "Colocación POR"], ["goalkeeping_reflexes", "Reflejos"]]],
];
const DETAIL_KEYS = DETAIL.flatMap(([, a]) => a.map(([k]) => k));
const DETAIL_LABEL = Object.fromEntries(DETAIL.flatMap(([g, a]) => a.map(([k, l]) => [k, l])));
const EXTRA_NUM = [["skill_moves", "Filigranas ★"], ["weak_foot", "Pie malo ★"], ["height_cm", "Altura (cm)"], ["weight_kg", "Peso (kg)"]];
const RADARS = { main: ["Principales (6)", ATTRS], ...Object.fromEntries(DETAIL.map(([g, a]) => [g, [g, a]])) };
// Métricas disponibles para ejes y percentiles: [clave, etiqueta, función]
const METRICS = [
  ["overall", "OVR"], ["potential", "Potencial"], ["age", "Edad"], ["value_eur", "Valor (€)"], ["wage_eur", "Sueldo (€)"],
  ...ATTRS,
  ["g90", "Goles/90"], ["a90", "Asist./90"], ["xg90", "xG/90"], ["xa90", "xA/90"], ["minutes", "Minutos"], ["goals", "Goles"], ["assists", "Asistencias"],
  ...EXTRA_NUM, ...DETAIL.flatMap(([g, a]) => a.map(([k, l]) => [k, `${l} (${g})`])),
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
  /* Formato base FC 27 */
  ext_id: ["player_id", "playerid", "id_jugador", "sofifa_id"], common_name: ["common_name", "nombre_comun", "nombre comun"], first_name: ["first_name", "nombre_pila", "firstname"], last_name: ["last_name", "apellido", "apellidos", "lastname"],
  alt_positions: ["alternate_positions", "alt_positions", "posiciones_alternativas", "posiciones alternativas"], gender: ["gender", "genero", "género", "sexo"],
  skill_moves: ["skill_moves", "filigranas", "skills"], weak_foot: ["weak_foot", "pie_malo", "pie malo"], weight_kg: ["weight_kg", "weight", "peso"],
  birthdate: ["birthdate", "birth_date", "dob", "fecha_nacimiento", "fecha de nacimiento"], playstyles: ["playstyles", "play_styles", "estilos_de_juego", "estilos de juego"],
  edition: ["edition", "edicion", "edición"], snapshot_date: ["snapshot_date", "snapshot", "fecha_datos", "fecha_snapshot"],
  ...Object.fromEntries(DETAIL_KEYS.map((k) => [k, [k]])),
};
ALIASES.overall.push("overall_rating"); ALIASES.foot.push("preferred_foot"); ALIASES.physical.push("physicality"); ALIASES.name.push("full_name");
const TEXT = new Set(["name", "club", "league", "nationality", "position", "foot", "source", "notes", "ext_id", "common_name", "first_name", "last_name", "alt_positions", "gender", "playstyles", "edition"]);
const DATES = new Set(["birthdate", "snapshot_date"]);
/* Columnas reales de gm_scouts que escribe la importación */
const DB_COLS = ["source", "name", "club", "league", "nationality", "position", "age", "overall", "potential", "value_eur", "wage_eur", "contract_until", "foot", "height_cm",
  "pace", "shooting", "passing", "dribbling", "defending", "physical", "apps", "minutes", "goals", "assists", "xg", "xa", "notes", "shortlist",
  "ext_id", "common_name", "first_name", "last_name", "alt_positions", "gender", "skill_moves", "weak_foot", "weight_kg", "birthdate", "playstyles", "edition", "snapshot_date", ...DETAIL_KEYS];
const norm = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const LOOK = {};
for (const [f, names] of Object.entries(ALIASES)) for (const n of names) if (!(norm(n) in LOOK)) LOOK[norm(n)] = f;

const S = {
  sb: null, user: null, el: null, tab: "buscar",
  scouts: [], squad: [], tableLimit: 100,
  f: { q: "", source: "", pos: [], ageMin: "", ageMax: "", ovrMin: "", ovrMax: "", potMin: "", valueMax: "", wageMax: "", contractMax: "", nation: "", club: "", foot: "", attr: {}, short: false, better: false, ref: "", sameGroup: true,
    gender: "", edition: "", snapshot: "", styles: "", altPos: false, smMin: "", wfMin: "", hMin: "", hMax: "", wMin: "", wMax: "", range: {} },
  extra: [], radar: "main",
  sortK: "overall", sortD: -1, cmp: [], chart: null, ax: "age", ay: "overall", noSql: false,
};

/* ---------- Datos ---------- */
const derive = (p) => {
  const m = p.minutes > 0 ? p.minutes / 90 : null;
  return { ...p, _alt: p.alt_positions ? p.alt_positions.split(",").map((x) => x.trim()).filter(Boolean) : [], _styles: p.playstyles ? norm(p.playstyles).split(/[,;|+]+/).map((x) => x.trim()).filter(Boolean) : [], g90: m ? p.goals / m : null, a90: m ? p.assists / m : null, xg90: m && p.xg != null ? Number(p.xg) / m : null, xa90: m && p.xa != null ? Number(p.xa) / m : null };
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
  const [sc, sq] = await Promise.all([fetchAll("gm_scouts"), activePlayers(S.sb)]);
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
  const dd = DETAIL_KEYS.filter((k) => a[k] != null && b[k] != null);
  if (dd.length >= 10) { const m = dd.reduce((t, k) => t + Math.abs(a[k] - b[k]), 0) / dd.length; return Math.max(0, 100 - 2 * m); }
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
  const A = { ageMin: num(f.ageMin), ageMax: num(f.ageMax), ovrMin: num(f.ovrMin), ovrMax: num(f.ovrMax), potMin: num(f.potMin), valueMax: num(f.valueMax), wageMax: num(f.wageMax), contractMax: num(f.contractMax),
    smMin: num(f.smMin), wfMin: num(f.wfMin), hMin: num(f.hMin), hMax: num(f.hMax), wMin: num(f.wMin), wMax: num(f.wMax) };
  const styles = norm(f.styles).split(/[,;|+]+/).map((x) => x.trim()).filter(Boolean);
  const rg = Object.entries(f.range).map(([k, [lo, hi]]) => [k, num(lo), num(hi)]).filter(([, lo, hi]) => lo != null || hi != null);
  let rows = S.scouts.filter((p) => {
    if (f.source && p.source !== f.source) return false;
    if (q && !norm([p.name, p.common_name, p.first_name, p.last_name, p.club, p.league].filter(Boolean).join(" ")).includes(q)) return false;
    if (f.pos.length && !f.pos.includes(p.position) && !(f.altPos && p._alt?.some((x) => f.pos.includes(x)))) return false;
    if (f.gender && p.gender !== f.gender) return false;
    if (f.edition && p.edition !== f.edition) return false;
    if (f.snapshot && String(p.snapshot_date || "").slice(0, 10) !== f.snapshot) return false;
    if (styles.length && !styles.every((t) => p._styles.some((x) => x.includes(t)))) return false;
    if (A.smMin != null && !(p.skill_moves >= A.smMin)) return false;
    if (A.wfMin != null && !(p.weak_foot >= A.wfMin)) return false;
    if (A.hMin != null && !(p.height_cm >= A.hMin)) return false;
    if (A.hMax != null && !(p.height_cm <= A.hMax)) return false;
    if (A.wMin != null && !(p.weight_kg >= A.wMin)) return false;
    if (A.wMax != null && !(p.weight_kg <= A.wMax)) return false;
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
    for (const [k, lo, hi] of rg) { if (p[k] == null) return false; if (lo != null && p[k] < lo) return false; if (hi != null && p[k] > hi) return false; }
    if (f.short && !p.shortlist) return false;
    if (best && !(p.overall > (best[p.position] ?? -1))) return false;
    if (ref && f.sameGroup && gOf(p) !== gOf(ref)) return false;
    return true;
  });
  if (ref) rows = rows.map((p) => ({ ...p, sim: similarity(ref, p) })).filter((p) => p.sim != null);
  return rows;
}

/* ======================= Buscar ======================= */
const distinct = (k) => [...new Set(S.scouts.map((p) => (k === "snapshot_date" ? String(p[k] || "").slice(0, 10) : p[k])).filter(Boolean))].sort();
const optList = (vals, cur, all) => `<option value="">${all}</option>${vals.map((v) => `<option ${cur === v ? "selected" : ""}>${esc(v)}</option>`).join("")}`;
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
    <label style="display:inline-flex;gap:.25rem;margin:0;color:inherit"><input type="checkbox" id="altpos" style="width:auto" ${f.altPos ? "checked" : ""}>Incluir jugadores que también juegan en esas posiciones (posiciones alternativas)</label>
    <label>Atributos mínimos</label>
    <div class="row">${ATTRS.map(([k, l]) => `<div><label>${l} ≥</label><input data-a="${k}" type="number" min="0" max="99" value="${esc(f.attr[k] ?? "")}"></div>`).join("")}</div>
    <details ${S.f.styles || S.f.gender || S.f.edition || S.f.snapshot || [f.smMin, f.wfMin, f.hMin, f.hMax, f.wMin, f.wMax].some(Boolean) ? "open" : ""}><summary><b>Ficha FC 27</b> · género, edición, estilos de juego, filigranas, pie malo, físico</summary><div class="row">
      <div><label>Género</label><select id="gender">${optList(distinct("gender"), f.gender, "Todos")}</select></div>
      <div><label>Edición</label><select id="edition">${optList(distinct("edition"), f.edition, "Todas")}</select></div>
      <div><label>Fecha de los datos</label><select id="snapshot">${optList(distinct("snapshot_date"), f.snapshot, "Todas")}</select></div>
      <div><label>Estilos de juego (separa con coma)</label><input id="styles" value="${esc(f.styles)}" placeholder="p. ej. Finesse Shot, Rapid"></div>
      ${[["smMin", "Filigranas ≥ (1-5)"], ["wfMin", "Pie malo ≥ (1-5)"], ["hMin", "Altura mín. (cm)"], ["hMax", "Altura máx. (cm)"], ["wMin", "Peso mín. (kg)"], ["wMax", "Peso máx. (kg)"]]
        .map(([k, l]) => `<div><label>${l}</label><input data-n="${k}" value="${esc(f[k])}"></div>`).join("")}</div></details>
    <details ${Object.values(f.attr).some((v) => v !== "" && v != null) && DETAIL_KEYS.some((k) => f.attr[k]) || Object.keys(f.range).length ? "open" : ""}><summary><b>Atributos detallados</b> · mínimo (y máximo opcional) de cada atributo</summary>
      ${DETAIL.map(([g, a]) => `<label>${g}</label><div class="row">${a.map(([k, l]) => `<div><label>${l}</label><div style="display:flex;gap:.25rem"><input data-a="${k}" type="number" min="0" max="99" placeholder="mín" value="${esc(f.attr[k] ?? "")}"><input data-r="${k}" type="number" min="0" max="99" placeholder="máx" value="${esc(f.range[k]?.[1] ?? "")}"></div></div>`).join("")}</div>`).join("")}</details>
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
  bind("[data-n]", (x) => (f[x.dataset.n] = x.value));
  bind("#gender", (x) => (f.gender = x.value)); bind("#edition", (x) => (f.edition = x.value)); bind("#snapshot", (x) => (f.snapshot = x.value)); bind("#styles", (x) => (f.styles = x.value));
  bind("[data-r]", (x) => { const k = x.dataset.r; f.range[k] = [f.attr[k] ?? "", x.value]; if (f.range[k][1] === "") delete f.range[k]; });
  $("#altpos", pane).addEventListener("change", (e) => { f.altPos = e.target.checked; upd(); }); bind("[data-a]", (x) => { f.attr[x.dataset.a] = x.value; if (f.range[x.dataset.a]) f.range[x.dataset.a][0] = x.value; });
  bind("[data-pos]", (x) => { f.pos = $$("[data-pos]:checked", pane).map((c) => c.dataset.pos); });
  $("#short", pane).addEventListener("change", (e) => { f.short = e.target.checked; upd(); });
  $("#better", pane).addEventListener("change", (e) => { f.better = e.target.checked; upd(); });
  $("#sg", pane).addEventListener("change", (e) => { f.sameGroup = e.target.checked; upd(); });
  $("#ref", pane).addEventListener("change", (e) => { f.ref = e.target.value; if (f.ref) { S.sortK = "sim"; S.sortD = -1; } else if (S.sortK === "sim") { S.sortK = "overall"; } renderSearch(pane); });
  $("#reset", pane).addEventListener("click", () => {
    Object.assign(f, { q: "", source: "", pos: [], ageMin: "", ageMax: "", ovrMin: "", ovrMax: "", potMin: "", valueMax: "", wageMax: "", contractMax: "", nation: "", club: "", foot: "", attr: {}, short: false, better: false, ref: "", sameGroup: true, gender: "", edition: "", snapshot: "", styles: "", altPos: false, smMin: "", wfMin: "", hMin: "", hMax: "", wMin: "", wMax: "", range: {} });
    if (S.sortK === "sim") S.sortK = "overall";
    renderSearch(pane);
  });
  upd();
}

const TXTCOLS = [["league", "Liga"], ["nationality", "Nacionalidad"], ["foot", "Pie"], ["alt_positions", "Pos. alternativas"], ["gender", "Género"], ["birthdate", "Nacimiento"], ["edition", "Edición"], ["snapshot_date", "Datos de"], ["playstyles", "Estilos de juego"]];
const COLLABEL = Object.fromEntries([...TXTCOLS, ...EXTRA_NUM, ...Object.entries(DETAIL_LABEL)]);
const TEXTKEYS = new Set(["name", "club", "position", "_src", ...TXTCOLS.map(([k]) => k)]);
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
    ["value_eur", "Valor"], ["wage_eur", "Sueldo"], ["contract_until", "Contrato"], ...ATTRS, ["g90", "G/90"], ["a90", "A/90"], ...S.extra.map((k) => [k, COLLABEL[k] || k]), ["_src", "Fuente"]];
  const shown = rows.slice(0, S.tableLimit);
  const fmt = (p, key) => {
    const v = p[key];
    if (v == null) return "–";
    if (key === "value_eur" || key === "wage_eur") return money(v);
    if (key === "g90" || key === "a90") return Number(v).toFixed(2);
    if (key === "sim") return Math.round(v) + "%";
    if (key === "birthdate" || key === "snapshot_date") return esc(String(v).slice(0, 10));
    return esc(v);
  };
  const picker = `<details><summary>Columnas extra de la tabla (${S.extra.length})</summary>
    <div class="toolbar">${[["Ficha", [...TXTCOLS, ...EXTRA_NUM]], ...DETAIL].map(([g, a]) => `<span><b class="muted">${g}</b> ${a.map(([k, l]) => `<label style="display:inline-flex;gap:.2rem;margin:0 .5rem 0 0;color:inherit"><input type="checkbox" data-col="${k}" style="width:auto" ${S.extra.includes(k) ? "checked" : ""}>${l}</label>`).join("")}</span>`).join("<br>")}</div></details>`;
  box.innerHTML = `<div class="toolbar"><b>${rows.length}</b> <span class="muted">jugadores encontrados${S.scouts.length ? "" : " — importa tu base en la pestaña Importar"}</span></div>${picker}
    <div class="tw"><table><thead><tr><th></th>${cols.map(([c, l]) => `<th class="s" data-k="${c}">${l}${S.sortK === c ? (S.sortD > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}<th></th></tr></thead>
    <tbody>${shown.map((p) => `<tr data-id="${p.id}"><td><button class="btn ghost sm" data-star="${p.id}" title="Lista de seguimiento">${p.shortlist ? "★" : "☆"}</button></td>
      ${cols.map(([c]) => c === "name" ? `<td><b>${esc(p.name)}</b></td>` : c === "position" ? `<td><span class="pos">${esc(p.position || "–")}</span></td>` : `<td class="${c === "overall" ? "ovr" : ""}">${fmt(p, c)}</td>`).join("")}
      <td><button class="btn ghost sm" data-cmp="${p.id}">⚖</button></td></tr>`).join("")}</tbody></table></div>
    ${rows.length > shown.length ? `<div class="actions"><button class="btn ghost" id="more">Mostrar más (${rows.length - shown.length})</button></div>` : ""}`;
  $$("[data-col]", box).forEach((c) => c.addEventListener("change", () => { S.extra = $$("[data-col]:checked", box).map((x) => x.dataset.col); results(box); box.querySelector("details").open = true; }));
  $$("th.s", box).forEach((th) => th.addEventListener("click", () => {
    const c = th.dataset.k;
    if (S.sortK === c) S.sortD *= -1; else { S.sortK = c; S.sortD = TEXTKEYS.has(c) ? 1 : -1; }
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
  const rdSet = RADARS[S.radar] || RADARS.main, rdAttrs = rdSet[1];
  body.innerHTML = `<div class="grid g2"><div class="card"><label>Radar de</label><select id="rdsel">${Object.entries(RADARS).map(([k, [l]]) => `<option value="${k}" ${S.radar === k ? "selected" : ""}>${l}</option>`).join("")}</select><canvas id="rd" height="260"></canvas></div>
    <div class="tw"><table style="min-width:0"><thead><tr><th>Métrica</th>${ps.map((p, i) => `<th style="color:${COLORS[i]}">${esc(p.name)}<br><span class="muted">${esc(p._src)} · ${esc(p.position || "–")}</span></th>`).join("")}</tr></thead>
    <tbody>${[["club", "Club"], ["league", "Liga"], ["nationality", "Nacionalidad"], ["foot", "Pie"], ["alt_positions", "Pos. alternativas"], ["playstyles", "Estilos de juego"], ["edition", "Edición"]]
      .filter(([k]) => ps.some((p) => p[k])).map(([k, l]) => `<tr><td class="muted">${l}</td>${ps.map((p) => `<td>${esc(p[k] || "–")}</td>`).join("")}</tr>`).join("")}
    ${rows.map(([k, l]) => {
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
    data: { labels: rdAttrs.map((a) => a[1]), datasets: ps.map((p, i) => ({ label: p.name, data: rdAttrs.map(([k]) => p[k] ?? 0), borderColor: COLORS[i], backgroundColor: COLORS[i] + "33", pointBackgroundColor: COLORS[i] })) },
    options: { scales: { r: { min: 0, max: 100, angleLines: { color: "#23497f" }, grid: { color: "#23497f" }, pointLabels: { color: "#fff" }, ticks: { display: false } } }, plugins: { legend: { labels: { color: "#fff" } } } },
  });
  $("#rdsel", body).addEventListener("change", (e) => { S.radar = e.target.value; renderCompare(pane); });
}

/* ======================= Importar ======================= */
const FC27_HEADERS = "player_id,common_name,first_name,last_name,overall_rating,position,alternate_positions,club,league,nationality,gender,preferred_foot,skill_moves,weak_foot,height_cm,weight_kg,birthdate,playstyles,pace,shooting,passing,dribbling,defending,physicality,attacking_crossing,attacking_finishing,attacking_heading_accuracy,attacking_short_passing,attacking_volleys,skill_dribbling,skill_curve,skill_fk_accuracy,skill_long_passing,skill_ball_control,movement_acceleration,movement_sprint_speed,movement_agility,movement_reactions,movement_balance,power_shot_power,power_jumping,power_stamina,power_strength,power_long_shots,mentality_aggression,mentality_interceptions,mentality_positioning,mentality_vision,mentality_penalties,mentality_composure,defending_awareness,defending_standing_tackle,defending_sliding_tackle,goalkeeping_diving,goalkeeping_handling,goalkeeping_kicking,goalkeeping_positioning,goalkeeping_reflexes,edition,snapshot_date".split(",");
const NOT_INT = new Set(["value_eur", "wage_eur", "xg", "xa"]);
function parseDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
  const t = String(v).trim();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  let y, mo, d;
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) { [d, mo, y] = [+m[1], +m[2], +m[3]]; if (mo > 12 && d <= 12) [d, mo] = [mo, d]; }
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const ageAt = (birth, ref) => { const b = new Date(birth), r = ref ? new Date(ref) : new Date(); let a = r.getFullYear() - b.getFullYear(); if (r.getMonth() < b.getMonth() || (r.getMonth() === b.getMonth() && r.getDate() < b.getDate())) a--; return a >= 14 && a <= 55 ? a : null; };
/* Qué columnas del archivo se reconocen y cuáles no */
function detect(headers) {
  const map = {}, unknown = [];
  for (const h of headers) { const f = LOOK[norm(h)]; if (f) map[h] = f; else if (String(h).trim()) unknown.push(h); }
  const found = new Set(Object.values(map));
  const missing = FC27_HEADERS.filter((h) => !found.has(LOOK[norm(h)]));
  return { map, unknown, missing };
}
function normalize(raw, defSource) {
  const o = {};
  for (const [k, v] of Object.entries(raw)) {
    const f = LOOK[norm(k)];
    if (!f || v === "" || v == null) continue;
    if (DATES.has(f)) { const d = parseDate(v); if (d) o[f] = d; }
    else if (TEXT.has(f)) { const t = String(v).trim(); if (t) o[f] = t; }
    else { const n = toNum(v); if (n !== null) o[f] = NOT_INT.has(f) ? n : Math.round(n); }
  }
  if (!o.name) o.name = o.common_name || [o.first_name, o.last_name].filter(Boolean).join(" ");
  if (!o.name) return null;
  if (o.position) o.position = normPos(o.position);
  if (o.alt_positions) o.alt_positions = [...new Set(o.alt_positions.split(/[,;|/\s]+/).map(normPos).filter((x) => x && x !== o.position))].join(",") || undefined;
  if (!o.alt_positions) delete o.alt_positions;
  if (o.gender) { const g = norm(o.gender); o.gender = /^(f|w|mujer|fem)/.test(g) ? "Femenino" : /^(m|h|male|hombre|masc)/.test(g) ? "Masculino" : o.gender; }
  if (o.age == null && o.birthdate) { const a = ageAt(o.birthdate, o.snapshot_date); if (a != null) o.age = a; }
  const s = norm(o.source || "");
  o.source = /real|vida/.test(s) ? "real" : /fc|ea|game|juego/.test(s) ? "fc27" : defSource;
  if (o.foot) { const x = norm(o.foot); o.foot = /^(r|d|right|der)/.test(x) ? "Derecho" : /^(l|i|left|izq)/.test(x) ? "Izquierdo" : /both|amb/.test(x) ? "Ambos" : o.foot; }
  for (const k of [...ATTRS.map((a) => a[0]), ...DETAIL_KEYS, "overall", "potential", "skill_moves", "weak_foot"]) if (o[k] != null && (o[k] < 0 || o[k] > 150)) delete o[k];
  return o;
}
function renderImport(pane) {
  pane.innerHTML = `<div class="grid g2">
    <div class="card"><h3>Cargar jugadores a la base</h3>
      <p class="muted">Sube un CSV/JSON o pega celdas de Excel/Sheets (con fila de títulos). Columnas reconocidas: nombre, club, liga, nacionalidad, posición, edad, OVR, potencial, valor, sueldo, contrato, pie, altura,
      RIT/TIR/PAS/REG/DEF/FIS y, para la vida real, PJ, minutos, goles, asistencias, xG, xA.
      <b>Base FC 27:</b> también reconoce las 60 columnas (player_id, common_name, first_name, last_name, overall_rating, alternate_positions, gender, preferred_foot, skill_moves, weak_foot, weight_kg, birthdate, playstyles, atributos detallados, edition, snapshot_date…); la edad se calcula desde birthdate.
      Si el jugador ya existe (mismo player_id y edición, o misma fuente, nombre y club) se actualiza sin perder tu lista de seguimiento. Requiere haber ejecutado <code>supabase/schema_scouting_fc27.sql</code>.</p>
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
  const headers = [...new Set(raw.flatMap((r) => Object.keys(r)))];
  const det = detect(headers);
  const isFc = ["player_id", "overall_rating"].every((h) => headers.some((x) => norm(x) === h));
  const rows = raw.map((r) => normalize(r, isFc && !headers.some((x) => norm(x) === "source") ? "fc27" : def)).filter(Boolean);
  if (!rows.length) return toast("No encontré jugadores. Revisa que exista una columna de nombre (common_name o first_name/last_name).", "err");
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const rv = $("#rv", pane);
  const nFc = FC27_HEADERS.length - det.missing.length;
  rv.innerHTML = `<div class="card"><h3>Vista previa: ${rows.length} jugadores</h3>
    <p><b>${Object.keys(det.map).length}</b> columnas de tu archivo reconocidas${isFc ? ` · formato FC 27 detectado (<b>${nFc}</b> de ${FC27_HEADERS.length} columnas esperadas; fuente = FC 27)` : ""}.</p>
    ${det.missing.length && isFc ? `<p class="muted">No vienen en tu archivo: ${det.missing.map(esc).join(", ")}.</p>` : ""}
    ${det.unknown.length ? `<p class="muted">Ignoradas (no reconocidas): ${det.unknown.map(esc).join(", ")}.</p>` : ""}
    <details><summary>Cómo se interpretó cada columna</summary><div class="tw" style="max-height:220px"><table><thead><tr><th>Columna del archivo</th><th>Campo</th></tr></thead>
      <tbody>${Object.entries(det.map).map(([h, f]) => `<tr><td>${esc(h)}</td><td>${esc(COLLABEL[f] || f)}</td></tr>`).join("")}</tbody></table></div></details>
    <div class="tw" style="max-height:300px"><table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
    <tbody>${rows.slice(0, 15).map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="actions"><button class="btn" id="go">Importar ${rows.length} jugadores</button> <span id="prog" class="muted"></span></div></div>`;
  $("#go", rv).addEventListener("click", async (e) => {
    const btn = e.target, prog = $("#prog", rv);
    btn.disabled = true;
    const key = (p) => p.ext_id ? [p.source, "id", p.ext_id, p.edition || ""].join("|") : [p.source, norm(p.name), norm(p.club || ""), p.edition || ""].join("|");
    const ex = new Map(S.scouts.map((p) => [key(p), p]));
    const ins = [], upd = [], seen = new Set();
    for (const r of rows) {
      const k = key(r);
      if (seen.has(k)) continue;
      seen.add(k);
      const old = ex.get(k);
      if (old) upd.push({ id: old.id, user_id: S.user.id, ...Object.fromEntries(DB_COLS.map((c) => [c, r[c] ?? old[c] ?? null])), shortlist: old.shortlist ?? false });
      else ins.push({ user_id: S.user.id, ...Object.fromEntries(DB_COLS.map((c) => [c, r[c] ?? null])), shortlist: false });
    }
    const total = ins.length + upd.length;
    let done = 0, bad = 0;
    const fail = (error) => { bad++; toast(/column|schema cache/i.test(error.message) ? "Falta ejecutar supabase/schema_scouting_fc27.sql en Supabase (columnas nuevas). Detalle: " + error.message : error.message, "err"); };
    for (let i = 0; i < ins.length && !bad; i += 500) {
      const { error } = await S.sb.from("gm_scouts").insert(ins.slice(i, i + 500));
      if (error) fail(error); else { done += Math.min(500, ins.length - i); prog.textContent = `Guardando… ${done}/${total}`; }
    }
    for (let i = 0; i < upd.length && !bad; i += 500) {
      const { error } = await S.sb.from("gm_scouts").upsert(upd.slice(i, i + 500), { onConflict: "id" });
      if (error) fail(error); else { done += Math.min(500, upd.length - i); prog.textContent = `Guardando… ${done}/${total}`; }
    }
    if (!bad) toast(`Importado: ${ins.length} nuevos, ${upd.length} actualizados`);
    await reload();
  });
}
