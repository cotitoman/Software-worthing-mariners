import { $, $$, esc, POSITIONS, normPos, toNum, toast, money, per, openModal } from "./util.js";
import { mountImport } from "./importers.js";
import { renderSeason, renderLeague, seasonList } from "./seasons.js";

export const ATTRS = [
  ["pace", "RIT"], ["shooting", "TIR"], ["passing", "PAS"],
  ["dribbling", "REG"], ["defending", "DEF"], ["physical", "FIS"],
];
const ROLES = {
  titular:  { label: "Titular",          range: [70, 100] },
  rotacion: { label: "Rotación",         range: [35, 70] },
  suplente: { label: "Suplente",         range: [5, 35] },
  juvenil:  { label: "Juvenil / reserva", range: [0, 20] },
};
const COLORS = ["#19c3c3", "#f5b041", "#ec7063"];

const S = {
  sb: null, user: null, el: null,
  players: [], matches: [], seasonStats: [], table: [], season: "", noSeasonSql: false, minSeason: "",
  tab: "jugadores", sortK: "overall", sortD: -1, q: "", pos: "",
  cmp: ["", "", ""], chart: null,
};

export async function mountSquad(el, { sb, user }) {
  S.sb = sb; S.user = user; S.el = el;
  await load();
  render();
}

async function load() {
  const [p, m, ss, lt] = await Promise.all([
    S.sb.from("gm_player_stats").select("*"),
    S.sb.from("gm_matches").select("*").order("played_on", { ascending: false }),
    S.sb.from("gm_season_stats").select("*"),
    S.sb.from("gm_league_table").select("*"),
  ]);
  S.noSeasonSql = !!(ss.error || lt.error);
  S.seasonStats = ss.data || [];
  S.table = lt.data || [];
  if (!S.season || !seasonList(S).includes(S.season)) S.season = seasonList(S)[0] || defaultSeason();
  if (p.error) toast(p.error.message, "err");
  if (m.error) toast(m.error.message, "err");
  S.players = p.data || [];
  S.matches = m.data || [];
}

function defaultSeason() {
  const y = new Date().getFullYear();
  return `${y}/${String((y + 1) % 100).padStart(2, "0")}`;
}

async function reload() {
  await load();
  render();
}

const teamMatches = () => Math.max(S.matches.length, ...S.players.map((p) => p.apps || 0), 0);

const ctx = () => ({ sb: S.sb, user: S.user, players: S.players, seasonStats: S.seasonStats, table: S.table,
  get season() { return S.season; }, set season(v) { S.season = v; }, noSeasonSql: S.noSeasonSql, reload });

/* ======================= Estructura ======================= */
function render() {
  const tabs = [["jugadores", "Jugadores"], ["temporada", "Temporada"], ["liga", "Clasificación"], ["partidos", "Partidos (opcional)"], ["minutos", "Minutos"], ["comparar", "Comparar"], ["importar", "Importar datos"]];
  S.el.innerHTML = `
    <div class="subtabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${S.tab === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <div id="pane"></div>`;
  $$("[data-t]", S.el).forEach((b) => b.addEventListener("click", () => { S.tab = b.dataset.t; render(); }));
  const pane = $("#pane", S.el);
  if (S.tab === "jugadores") renderPlayers(pane);
  else if (S.tab === "temporada") renderSeason(pane, ctx());
  else if (S.tab === "liga") renderLeague(pane, ctx());
  else if (S.tab === "partidos") renderMatches(pane);
  else if (S.tab === "minutos") renderMinutes(pane);
  else if (S.tab === "comparar") renderCompare(pane);
  else mountImport(pane, { sb: S.sb, user: S.user, getPlayers: () => S.players, reload });
}

/* ======================= Jugadores ======================= */
function renderPlayers(pane) {
  const cols = [
    ["shirt_number", "#", 1], ["name", "Nombre"], ["position", "Pos"], ["age", "Edad", 1], ["overall", "OVR", 1],
    ["apps", "PJ", 1], ["minutes", "Min", 1], ["goals", "G", 1], ["assists", "A", 1], ["clean_sheets", "PI", 1],
    ["gpg", "G/P", 1], ["apg", "A/P", 1], ["contract_until", "Contrato", 1], ["wage_eur", "Sueldo", 1],
  ];
  let rows = S.players.map((p) => ({ ...p, gpg: p.apps ? p.goals / p.apps : -1, apg: p.apps ? p.assists / p.apps : -1 }));
  const q = S.q.toLowerCase();
  rows = rows.filter((p) => (!q || p.name.toLowerCase().includes(q)) && (!S.pos || p.position === S.pos));
  rows.sort((a, b) => {
    const x = a[S.sortK], y = b[S.sortK];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * S.sortD;
  });

  pane.innerHTML = `
    <div class="toolbar">
      <input id="q" placeholder="Buscar jugador…" value="${esc(S.q)}">
      <select id="pf"><option value="">Todas las posiciones</option>${POSITIONS.map((p) => `<option ${S.pos === p ? "selected" : ""}>${p}</option>`).join("")}</select>
      <button class="btn" id="add">+ Jugador</button>
      <span class="muted">${rows.length} de ${S.players.length} jugadores</span>
    </div>
    ${S.players.length === 0 ? `<div class="card muted">Todavía no hay jugadores. Añade uno a mano o usa <b>Importar datos</b> para traer tu plantilla del FC 27.</div>` : ""}
    <div class="tw"><table>
      <thead><tr>${cols.map(([k, l, n]) => `<th class="s ${n ? "num" : ""}" data-k="${k}">${l}${S.sortK === k ? (S.sortD > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((p) => `<tr class="click" data-id="${p.id}">
        <td class="num">${p.shirt_number ?? ""}</td><td><b>${esc(p.name)}</b></td>
        <td><span class="pos">${esc(p.position || "–")}</span></td>
        <td class="num">${p.age ?? ""}</td><td class="num ovr">${p.overall ?? ""}</td>
        <td class="num">${p.apps}</td><td class="num">${p.minutes}</td>
        <td class="num">${p.goals}</td><td class="num">${p.assists}</td><td class="num">${p.clean_sheets}</td>
        <td class="num">${per(p.goals, p.apps)}</td><td class="num">${per(p.assists, p.apps)}</td>
        <td class="num">${p.contract_until ?? ""}</td><td class="num">${money(p.wage_eur)}</td></tr>`).join("")}
      </tbody></table></div>`;

  $("#q", pane).addEventListener("input", (e) => { S.q = e.target.value; renderPlayers(pane); $("#q", pane).focus(); });
  $("#pf", pane).addEventListener("change", (e) => { S.pos = e.target.value; renderPlayers(pane); });
  $("#add", pane).addEventListener("click", () => playerForm());
  $$("th.s", pane).forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.k;
    if (S.sortK === k) S.sortD *= -1; else { S.sortK = k; S.sortD = k === "name" || k === "position" ? 1 : -1; }
    renderPlayers(pane);
  }));
  $$("tr.click", pane).forEach((tr) => tr.addEventListener("click", () => profile(tr.dataset.id)));
}

/* ---------- Perfil ---------- */
async function profile(id) {
  const p = S.players.find((x) => x.id === id);
  if (!p) return;
  const { data: pm } = await S.sb.from("gm_player_matches")
    .select("*, gm_matches(played_on, opponent, goals_for, goals_against, is_home)").eq("player_id", id);
  const last = (pm || []).sort((a, b) => (b.gm_matches?.played_on || "").localeCompare(a.gm_matches?.played_on || "")).slice(0, 8);
  const m = openModal(`
    <h2>${esc(p.name)} <button class="btn ghost sm" data-close>Cerrar</button></h2>
    <div class="profile-head">
      ${p.photo_url ? `<img class="photo" src="${esc(p.photo_url)}" alt="">` : `<div class="photo"></div>`}
      <div>
        <div><span class="pos">${esc(p.position || "–")}</span> ${p.shirt_number ? "#" + p.shirt_number : ""} · ${esc(p.nationality || "")} ${p.age ? "· " + p.age + " años" : ""}</div>
        <div class="muted">${ROLES[p.squad_role]?.label || ""} · Contrato ${p.contract_until ?? "–"} · Sueldo ${money(p.wage_eur)} · Valor ${money(p.value_eur)}</div>
        <div><span class="ovr" style="font-size:1.6rem">${p.overall ?? "–"}</span> <span class="muted">OVR · pot. ${p.potential ?? "–"}</span></div>
      </div>
    </div>
    <div class="g6">
      ${[["PJ", p.apps], ["Minutos", p.minutes], ["Goles", p.goals], ["Asist.", p.assists], ["P. imbatidas", p.clean_sheets],
         ["Goles/PJ", per(p.goals, p.apps)], ["Asist./PJ", per(p.assists, p.apps)], ["Nota media", p.avg_rating ?? "–"]]
        .map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("")}
    </div>
    ${S.seasonStats.some((r) => r.player_id === p.id) ? `<div class="card" style="margin-top:1rem"><h3>Por temporada</h3><div class="tw"><table style="min-width:0">
      <tr><th>Temp.</th><th class="num">PJ</th><th class="num">Min</th><th class="num">G</th><th class="num">A</th><th class="num">PI</th><th class="num">Nota</th></tr>
      ${S.seasonStats.filter((r) => r.player_id === p.id).sort((a, b) => b.season.localeCompare(a.season)).map((r) => `<tr><td>${esc(r.season)}</td><td class="num">${r.apps}</td><td class="num">${r.minutes}</td><td class="num">${r.goals}</td><td class="num">${r.assists}</td><td class="num">${r.clean_sheets}</td><td class="num">${r.avg_rating ?? "–"}</td></tr>`).join("")}
      </table></div></div>` : ""}
    <div class="grid g2" style="margin-top:1rem">
      <div class="card"><canvas id="rc" height="220"></canvas></div>
      <div class="card"><h3>Últimos partidos</h3>${last.length ? `<table style="min-width:0">${last.map((r) => `<tr>
        <td>${r.gm_matches?.played_on || ""}</td><td>${esc(r.gm_matches?.opponent || "")}</td>
        <td>${r.gm_matches ? r.gm_matches.goals_for + "-" + r.gm_matches.goals_against : ""}</td>
        <td>${r.minutes}'</td><td>${r.goals}G ${r.assists}A</td></tr>`).join("")}</table>` : `<p class="muted">Sin partidos registrados.</p>`}</div>
    </div>
    <div class="actions"><button class="btn ghost" id="ed">Editar</button></div>`, { wide: true });
  drawRadar($("#rc", m.el), [p]);
  $("#ed", m.el).addEventListener("click", () => { m.close(); playerForm(p); });
}

/* ---------- Formulario ---------- */
function playerForm(p = null) {
  const v = (k) => esc(p?.[k] ?? "");
  const m = openModal(`
    <h2>${p ? "Editar jugador" : "Nuevo jugador"} <button class="btn ghost sm" data-close>Cerrar</button></h2>
    <form id="pf">
      <div class="row">
        <div><label>Nombre *</label><input name="name" required value="${v("name")}"></div>
        <div><label>Posición</label><select name="position"><option value=""></option>${POSITIONS.map((x) => `<option ${p?.position === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
        <div><label>Nacionalidad</label><input name="nationality" value="${v("nationality")}"></div>
      </div>
      <div class="row">
        ${[["age", "Edad"], ["shirt_number", "Dorsal"], ["overall", "OVR"], ["potential", "Potencial"], ["height_cm", "Altura (cm)"]]
          .map(([k, l]) => `<div><label>${l}</label><input name="${k}" type="number" value="${v(k)}"></div>`).join("")}
      </div>
      <div class="row">
        <div><label>Rol en la plantilla</label><select name="squad_role">${Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${(p?.squad_role || "rotacion") === k ? "selected" : ""}>${r.label}</option>`).join("")}</select></div>
        <div><label>Pie</label><select name="foot"><option value=""></option>${["Derecho", "Izquierdo", "Ambos"].map((x) => `<option ${p?.foot === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
        <div><label>Contrato hasta (año)</label><input name="contract_until" type="number" value="${v("contract_until")}"></div>
      </div>
      <div class="row">
        <div><label>Sueldo anual (€)</label><input name="wage_eur" type="number" value="${v("wage_eur")}"></div>
        <div><label>Valor de mercado (€)</label><input name="value_eur" type="number" value="${v("value_eur")}"></div>
        <div><label>URL de la foto</label><input name="photo_url" value="${v("photo_url")}"></div>
      </div>
      <label>Atributos principales (0–99)</label>
      <div class="row">${ATTRS.map(([k, l]) => `<div><label>${l}</label><input name="${k}" type="number" min="0" max="99" value="${v(k)}"></div>`).join("")}</div>
      <label>Estadísticas acumuladas previas (de antes de usar esta app)</label>
      <div class="row">${[["base_apps", "PJ"], ["base_minutes", "Minutos"], ["base_goals", "Goles"], ["base_assists", "Asist."], ["base_clean_sheets", "P. imbatidas"]]
        .map(([k, l]) => `<div><label>${l}</label><input name="${k}" type="number" min="0" value="${p?.[k] ?? 0}"></div>`).join("")}</div>
      <div class="actions">
        ${p ? `<button type="button" class="btn danger" id="del">Eliminar</button>` : ""}
        <button class="btn">Guardar</button>
      </div>
    </form>`, { wide: true });

  $("#pf", m.el).addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const obj = {};
    const numeric = new Set(["age", "shirt_number", "overall", "potential", "height_cm", "contract_until", "wage_eur", "value_eur",
      ...ATTRS.map((a) => a[0]), "base_apps", "base_minutes", "base_goals", "base_assists", "base_clean_sheets"]);
    for (const [k, val] of fd.entries()) {
      if (numeric.has(k)) obj[k] = toNum(val);
      else obj[k] = String(val).trim() || null;
    }
    obj.name = String(obj.name || "").trim();
    obj.position = normPos(obj.position);
    obj.squad_role = obj.squad_role || "rotacion";
    for (const k of ["base_apps", "base_minutes", "base_goals", "base_assists", "base_clean_sheets"]) obj[k] = obj[k] ?? 0;
    const q = p ? S.sb.from("gm_players").update(obj).eq("id", p.id) : S.sb.from("gm_players").insert(obj);
    const { error } = await q;
    if (error) return toast(error.code === "23505" ? "Ya existe un jugador con ese nombre." : error.message, "err");
    m.close();
    toast("Jugador guardado");
    reload();
  });
  if (p) $("#del", m.el).addEventListener("click", async () => {
    if (!confirm(`¿Eliminar a ${p.name}? También se borran sus estadísticas de partidos.`)) return;
    const { error } = await S.sb.from("gm_players").delete().eq("id", p.id);
    if (error) return toast(error.message, "err");
    m.close(); toast("Jugador eliminado"); reload();
  });
}

/* ======================= Partidos ======================= */
function renderMatches(pane) {
  pane.innerHTML = `
    <div class="toolbar"><button class="btn" id="nm">+ Registrar partido</button><span class="muted">${S.matches.length} partidos</span></div>
    ${S.matches.length === 0 ? `<div class="card muted">Aún no hay partidos. Al registrar uno indicas minutos, goles y asistencias de cada jugador y las estadísticas se actualizan solas.</div>` : ""}
    <div class="tw"><table><thead><tr><th>Fecha</th><th>Rival</th><th>Competición</th><th>L/V</th><th class="num">Resultado</th><th></th></tr></thead>
    <tbody>${S.matches.map((m) => {
      const r = m.goals_for > m.goals_against ? "flag-ok" : m.goals_for < m.goals_against ? "flag-bad" : "flag-warn";
      return `<tr><td>${m.played_on}</td><td><b>${esc(m.opponent)}</b></td><td>${esc(m.competition || "")}</td>
        <td>${m.is_home ? "Local" : "Visita"}</td><td class="num ${r}"><b>${m.goals_for} - ${m.goals_against}</b></td>
        <td><button class="btn ghost sm" data-del="${m.id}">Borrar</button></td></tr>`;
    }).join("")}</tbody></table></div>`;
  $("#nm", pane).addEventListener("click", matchForm);
  $$("[data-del]", pane).forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("¿Borrar este partido y sus estadísticas?")) return;
    const { error } = await S.sb.from("gm_matches").delete().eq("id", b.dataset.del);
    if (error) return toast(error.message, "err");
    reload();
  }));
}

function matchForm() {
  if (!S.players.length) return toast("Primero añade jugadores a la plantilla.", "err");
  const today = new Date().toISOString().slice(0, 10);
  const players = [...S.players].sort((a, b) => (b.overall || 0) - (a.overall || 0));
  const m = openModal(`
    <h2>Registrar partido <button class="btn ghost sm" data-close>Cerrar</button></h2>
    <form id="mf">
      <div class="row">
        <div><label>Fecha</label><input type="date" name="played_on" value="${today}" required></div>
        <div><label>Rival *</label><input name="opponent" required></div>
        <div><label>Competición</label><input name="competition" value="EFL League Two"></div>
        <div><label>Condición</label><select name="is_home"><option value="1">Local</option><option value="0">Visita</option></select></div>
      </div>
      <div class="row">
        <div><label>Goles del Worthing</label><input type="number" name="goals_for" min="0" value="0" required></div>
        <div><label>Goles del rival</label><input type="number" name="goals_against" min="0" value="0" required></div>
      </div>
      <p class="muted">Marca a quienes jugaron. La portería imbatida se marca sola si el rival no anotó y el jugador (GK/defensa) jugó 60' o más; puedes cambiarla.</p>
      <div class="tw"><table><thead><tr><th>Jugó</th><th>Jugador</th><th>Pos</th><th>Titular</th><th>Min</th><th>G</th><th>A</th><th>P.I.</th><th>Nota</th></tr></thead>
      <tbody>${players.map((p) => `<tr data-p="${p.id}" data-def="${["GK", "CB", "LB", "RB", "LWB", "RWB"].includes(p.position) ? 1 : 0}">
        <td><input type="checkbox" class="pl"></td><td>${esc(p.name)}</td><td><span class="pos">${esc(p.position || "–")}</span></td>
        <td><input type="checkbox" class="st"></td>
        <td><input type="number" class="mi" min="0" max="130" value="0" style="width:64px"></td>
        <td><input type="number" class="go" min="0" value="0" style="width:56px"></td>
        <td><input type="number" class="as" min="0" value="0" style="width:56px"></td>
        <td><input type="checkbox" class="cs"></td>
        <td><input type="number" class="ra" min="1" max="10" step="0.1" style="width:64px"></td></tr>`).join("")}</tbody></table></div>
      <div class="actions"><button class="btn">Guardar partido</button></div>
    </form>`, { wide: true });

  const form = $("#mf", m.el);
  const ga = () => Number(form.goals_against.value) || 0;
  const autoCS = (tr) => {
    const eligible = tr.dataset.def === "1" && ga() === 0 && Number($(".mi", tr).value) >= 60;
    $(".cs", tr).checked = eligible;
  };
  $$("tbody tr", form).forEach((tr) => {
    $(".pl", tr).addEventListener("change", () => {
      if ($(".pl", tr).checked && Number($(".mi", tr).value) === 0) $(".mi", tr).value = $(".st", tr).checked ? 90 : 20;
      autoCS(tr);
    });
    $(".st", tr).addEventListener("change", () => {
      if ($(".st", tr).checked) { $(".pl", tr).checked = true; if (Number($(".mi", tr).value) < 45) $(".mi", tr).value = 90; }
      autoCS(tr);
    });
    $(".mi", tr).addEventListener("input", () => { if (Number($(".mi", tr).value) > 0) $(".pl", tr).checked = true; autoCS(tr); });
  });
  form.goals_against.addEventListener("input", () => $$("tbody tr", form).forEach(autoCS));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const match = {
      played_on: fd.get("played_on"), opponent: String(fd.get("opponent")).trim(),
      competition: String(fd.get("competition")).trim() || null,
      is_home: fd.get("is_home") === "1",
      goals_for: Number(fd.get("goals_for")) || 0, goals_against: Number(fd.get("goals_against")) || 0,
    };
    const lines = $$("tbody tr", form).filter((tr) => $(".pl", tr).checked && Number($(".mi", tr).value) > 0).map((tr) => ({
      player_id: tr.dataset.p, started: $(".st", tr).checked, minutes: Number($(".mi", tr).value),
      goals: Number($(".go", tr).value) || 0, assists: Number($(".as", tr).value) || 0,
      clean_sheet: $(".cs", tr).checked, rating: $(".ra", tr).value ? Number($(".ra", tr).value) : null,
    }));
    if (lines.some((l) => l.minutes > 130)) return toast("Hay minutos fuera de rango.", "err");
    if (lines.reduce((s, l) => s + l.goals, 0) > match.goals_for) toast("Aviso: los goles de los jugadores superan los del equipo (puede haber goles en contra).");
    const { data, error } = await S.sb.from("gm_matches").insert(match).select().single();
    if (error) return toast(error.message, "err");
    if (lines.length) {
      const { error: e2 } = await S.sb.from("gm_player_matches").insert(lines.map((l) => ({ ...l, match_id: data.id })));
      if (e2) { await S.sb.from("gm_matches").delete().eq("id", data.id); return toast(e2.message, "err"); }
    }
    m.close(); toast("Partido registrado"); reload();
  });
}

/* ======================= Minutos ======================= */
function renderMinutes(pane) {
  const seasons = seasonList(S).filter((s) => S.seasonStats.some((r) => r.season === s));
  if (S.minSeason && !seasons.includes(S.minSeason)) S.minSeason = "";
  const ms = S.minSeason;
  const sMin = new Map(S.seasonStats.filter((r) => r.season === ms).map((r) => [r.player_id, r]));
  const sApps = Math.max(0, ...[...sMin.values()].map((r) => r.apps));
  const tm = ms ? (S.table.find((r) => r.season === ms && r.is_mine)?.played || sApps) : teamMatches();
  const avail = tm * 90;
  const rows = S.players.map((p0) => {
    const p = ms ? { ...p0, minutes: sMin.get(p0.id)?.minutes || 0 } : p0;
    const pct = avail ? Math.min(100, (p.minutes / avail) * 100) : 0;
    const [lo, hi] = ROLES[p.squad_role || "rotacion"].range;
    let flag = ["flag-ok", "En rango"], cls = "";
    if (avail >= 270) {
      if (pct > hi) { flag = ["flag-bad", "Sobrecargado"]; cls = pct > hi + 15 ? "bad" : "warn"; }
      else if (pct < lo) { flag = ["flag-warn", "Poco uso"]; cls = "warn"; }
    } else flag = ["muted", "Pocos datos"];
    return { p, pct, lo, hi, flag, cls };
  }).sort((a, b) => b.p.minutes - a.p.minutes);
  const alerts = rows.filter((r) => r.flag[0] === "flag-bad" || r.flag[0] === "flag-warn");

  pane.innerHTML = `
    <div class="toolbar"><label style="margin:0">Ver</label><select id="ms"><option value="">Total acumulado</option>${seasons.map((s) => `<option ${s === ms ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
    <div class="card"><b>${tm}</b> partidos · <b>${avail}</b> minutos disponibles por jugador.
      Cada rol tiene un rango objetivo de % de minutos; ajusta el rol de cada jugador aquí abajo.
      ${alerts.length ? `<div style="margin-top:.5rem">${alerts.slice(0, 6).map((r) => `<div class="${r.flag[0]}">• ${esc(r.p.name)}: ${r.flag[1].toLowerCase()} (${r.pct.toFixed(0)}% — objetivo ${r.lo}–${r.hi}%)</div>`).join("")}</div>` : ""}
    </div>
    <div class="tw"><table><thead><tr><th>Jugador</th><th>Pos</th><th>Rol</th><th class="num">Min</th><th>% de minutos</th><th>Objetivo</th><th>Estado</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td><b>${esc(r.p.name)}</b></td><td><span class="pos">${esc(r.p.position || "–")}</span></td>
      <td><select data-role="${r.p.id}">${Object.entries(ROLES).map(([k, x]) => `<option value="${k}" ${(r.p.squad_role || "rotacion") === k ? "selected" : ""}>${x.label}</option>`).join("")}</select></td>
      <td class="num">${r.p.minutes}</td>
      <td><div class="bar"><i class="${r.cls}" style="width:${r.pct}%"></i></div> <span class="muted">${r.pct.toFixed(0)}%</span></td>
      <td>${r.lo}–${r.hi}%</td><td class="${r.flag[0]}">${r.flag[1]}</td></tr>`).join("")}</tbody></table></div>`;
  $("#ms", pane).addEventListener("change", (e) => { S.minSeason = e.target.value; renderMinutes(pane); });
  $$("[data-role]", pane).forEach((sel) => sel.addEventListener("change", async () => {
    const { error } = await S.sb.from("gm_players").update({ squad_role: sel.value }).eq("id", sel.dataset.role);
    if (error) return toast(error.message, "err");
    reload();
  }));
}

/* ======================= Comparar ======================= */
function drawRadar(canvas, players) {
  if (S.chart) { S.chart.destroy(); S.chart = null; }
  if (!canvas || typeof Chart === "undefined") return;
  S.chart = new Chart(canvas, {
    type: "radar",
    data: {
      labels: ATTRS.map((a) => a[1]),
      datasets: players.map((p, i) => ({
        label: p.name, data: ATTRS.map(([k]) => p[k] ?? 0),
        borderColor: COLORS[i], backgroundColor: COLORS[i] + "33", pointBackgroundColor: COLORS[i],
      })),
    },
    options: {
      scales: { r: { min: 0, max: 100, angleLines: { color: "#23497f" }, grid: { color: "#23497f" },
        pointLabels: { color: "#fff" }, ticks: { display: false } } },
      plugins: { legend: { labels: { color: "#fff" } } },
    },
  });
}

function renderCompare(pane) {
  const opts = (sel) => `<option value="">—</option>` + S.players.map((p) => `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${esc(p.name)} (${esc(p.position || "–")})</option>`).join("");
  pane.innerHTML = `
    <div class="toolbar">${[0, 1, 2].map((i) => `<select data-c="${i}" style="max-width:220px">${opts(S.cmp[i])}</select>`).join("")}</div>
    <div id="cmpbody"></div>`;
  $$("[data-c]", pane).forEach((s) => s.addEventListener("change", () => { S.cmp[s.dataset.c] = s.value; fillCompare(pane); }));
  fillCompare(pane);
}

function fillCompare(pane) {
  const ps = S.cmp.map((id) => S.players.find((p) => p.id === id)).filter(Boolean);
  const body = $("#cmpbody", pane);
  if (ps.length < 2) {
    if (S.chart) { S.chart.destroy(); S.chart = null; }
    body.innerHTML = `<div class="card muted">Elige al menos 2 jugadores para compararlos.</div>`;
    return;
  }
  const metrics = [
    ["OVR", (p) => p.overall], ["Potencial", (p) => p.potential], ["Edad", (p) => p.age, true],
    ["Partidos", (p) => p.apps], ["Minutos", (p) => p.minutes], ["Goles", (p) => p.goals], ["Asistencias", (p) => p.assists],
    ["Porterías imbatidas", (p) => p.clean_sheets], ["Goles / partido", (p) => (p.apps ? p.goals / p.apps : null), false, 2],
    ["Asist. / partido", (p) => (p.apps ? p.assists / p.apps : null), false, 2], ["Nota media", (p) => p.avg_rating],
    ["Valor", (p) => p.value_eur, false, 0, money], ["Sueldo", (p) => p.wage_eur, true, 0, money],
    ...ATTRS.map(([k, l]) => [l, (p) => p[k]]),
  ];
  body.innerHTML = `<div class="grid g2">
    <div class="card"><canvas id="rc2" height="260"></canvas></div>
    <div class="tw"><table style="min-width:0"><thead><tr><th>Métrica</th>${ps.map((p, i) => `<th style="color:${COLORS[i]}">${esc(p.name)}</th>`).join("")}</tr></thead>
    <tbody>${metrics.map(([l, f, lowerBetter, dec = 0, fmt]) => {
      const vals = ps.map(f);
      const valid = vals.filter((v) => v != null);
      const best = valid.length > 1 ? (lowerBetter ? Math.min(...valid) : Math.max(...valid)) : null;
      return `<tr><td class="muted">${l}</td>${vals.map((v) => `<td class="${v != null && v === best ? "best" : ""}">${v == null ? "–" : fmt ? fmt(v) : Number(v).toFixed(dec)}</td>`).join("")}</tr>`;
    }).join("")}</tbody></table></div></div>`;
  drawRadar($("#rc2", body), ps);
}
