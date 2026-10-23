import { $, $$, esc, POSITIONS, toNum, toast, money } from "./util.js";

/* ===================== Motor de recomendaciones =====================
   Sistema de puntuación por REGLAS, transparente y configurable. No usa inteligencia artificial externa.
   Solo usa datos que tú cargaste en el software. Lo que falta se marca como "sin datos" y no se inventa.
   Ayuda a decidir: nunca ficha, vende ni cambia contratos por su cuenta. */

const GROUP = { GK: "POR", CB: "DEF", LB: "DEF", RB: "DEF", LWB: "DEF", RWB: "DEF", CDM: "MED", CM: "MED", CAM: "MED", LM: "MED", RM: "MED", LW: "DEL", RW: "DEL", CF: "DEL", ST: "DEL" };
const COMPAT = { LB: ["LWB"], LWB: ["LB"], RB: ["RWB"], RWB: ["RB"], LM: ["LW"], LW: ["LM"], RM: ["RW"], RW: ["RM"], CF: ["ST"], ST: ["CF"], CAM: ["CM"], CDM: ["CM"], CM: ["CAM", "CDM"], CB: [], GK: [] };
const ATTR_W = {
  CB: { defending: 0.5, physical: 0.35, pace: 0.15 },
  LB: { pace: 0.3, defending: 0.3, passing: 0.2, physical: 0.2 }, RB: { pace: 0.3, defending: 0.3, passing: 0.2, physical: 0.2 },
  LWB: { pace: 0.3, defending: 0.3, passing: 0.2, physical: 0.2 }, RWB: { pace: 0.3, defending: 0.3, passing: 0.2, physical: 0.2 },
  CDM: { defending: 0.4, passing: 0.3, physical: 0.3 }, CM: { passing: 0.4, dribbling: 0.2, defending: 0.2, physical: 0.2 },
  CAM: { passing: 0.35, dribbling: 0.3, shooting: 0.25, pace: 0.1 },
  LM: { pace: 0.35, dribbling: 0.35, passing: 0.15, shooting: 0.15 }, RM: { pace: 0.35, dribbling: 0.35, passing: 0.15, shooting: 0.15 },
  LW: { pace: 0.35, dribbling: 0.35, passing: 0.15, shooting: 0.15 }, RW: { pace: 0.35, dribbling: 0.35, passing: 0.15, shooting: 0.15 },
  ST: { shooting: 0.45, pace: 0.25, physical: 0.15, dribbling: 0.15 }, CF: { shooting: 0.45, pace: 0.25, physical: 0.15, dribbling: 0.15 },
};
const ATTR_LABEL = { pace: "RIT", shooting: "TIR", passing: "PAS", dribbling: "REG", defending: "DEF", physical: "FIS" };
const CRITERIA = [
  ["tactical", "Adecuación táctica", "Posición exacta o compatible y perfil de atributos para ese puesto."],
  ["quality", "Calidad actual", "OVR frente a la mediana de tus jugadores en esa posición."],
  ["potential", "Potencial", "Potencial registrado en tu base (si existe)."],
  ["cost", "Coste", "Valor de mercado de tu base frente a tu presupuesto de fichajes (no es un precio de traspaso)."],
  ["age", "Edad", "Dentro de la ventana de edad que configures."],
  ["salary", "Salario", "Sueldo de tu base frente al margen salarial de tu plan."],
  ["availability", "Disponibilidad", "Estimada por la duración del contrato; no está confirmada."],
  ["need", "Necesidad de la posición", "Déficit frente a lo deseado en tu plan y prioridades."],
];
const DEFAULTS = { weights: { tactical: 3, quality: 3, potential: 1.5, cost: 2, age: 1, salary: 1.5, availability: 1, need: 2 }, ageMin: 18, ageMax: 29, topN: 3, minCoverage: 70 };

const R = { sb: null, user: null, el: null, tab: "fichajes", cfg: JSON.parse(JSON.stringify(DEFAULTS)), season: "", noSql: false,
  players: [], status: new Map(), plans: [], scouts: [], profiles: [], ratings: [], loans: [], stats: [], seasonsFin: [] };

const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const eur = (n) => "€" + Math.round(Number(n || 0)).toLocaleString("es-CL");
const endYear = (s) => { const m = /^(\d{4})/.exec(s || ""); return m ? Number(m[1]) + 1 : null; };
const stOf = (id) => R.status.get(id) || {};
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const plan = () => R.plans.find((p) => p.season === R.season) || null;
const M = (label, value) => ({ label, value, kind: "manual" });   // dato que tú introdujiste
const C = (label, value) => ({ label, value, kind: "calc" });     // dato calculado por el motor

async function load() {
  const t = (n) => R.sb.from(n).select("*");
  const [pl, ps, st, pn, sc, pr, ra, lo, cs] = await Promise.all([t("gm_players"), t("gm_player_stats"), t("gm_player_status"), t("gm_squad_plans"), t("gm_scouts"), t("gm_youth_profiles"), t("gm_youth_ratings"), t("gm_loans"), t("gm_reco_settings")]);
  R.noSql = !!(cs.error || pn.error);
  const statsById = new Map((ps.data || []).map((p) => [p.id, p]));
  R.players = (pl.data || []).map((p) => ({ ...p, apps: statsById.get(p.id)?.apps ?? null, minutes: statsById.get(p.id)?.minutes ?? null }));
  R.hasStats = !ps.error;
  R.status = new Map((st.data || []).map((s) => [s.player_id, s]));
  R.plans = (pn.data || []).sort((a, b) => b.season.localeCompare(a.season));
  R.scouts = sc.data || []; R.profiles = pr.data || []; R.ratings = ra.data || []; R.loans = lo.data || [];
  const saved = cs.data?.[0]?.settings;
  if (saved && saved.weights) R.cfg = { ...JSON.parse(JSON.stringify(DEFAULTS)), ...saved, weights: { ...DEFAULTS.weights, ...saved.weights } };
  if (!R.season || !R.plans.some((p) => p.season === R.season)) R.season = R.plans[0]?.season || "";
}

export async function mountRecommend(el, { sb, user }) {
  R.sb = sb; R.user = user; R.el = el;
  el.innerHTML = `<p class="muted">Analizando tus datos…</p>`;
  await load(); render();
}

const firstTeam = () => R.players.filter((p) => !stOf(p.id).left_club && p.squad_role !== "juvenil");

function render() {
  if (R.noSql) { R.el.innerHTML = `<div class="card"><b>Falta un paso en Supabase.</b> Ejecuta <code>supabase/schema_planificacion.sql</code> y <code>supabase/schema_recomendaciones.sql</code> en el SQL Editor y recarga la página.</div>`; return; }
  const tabs = [["fichajes", "Fichajes"], ["plantilla", "Plantilla"], ["config", "Configuración"]];
  R.el.innerHTML = `<div class="subtabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${R.tab === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="card muted" style="font-size:.85rem">Sistema de puntuación por reglas, sin inteligencia artificial externa. Usa solo los datos que cargaste; lo que falta se indica como <b>sin datos</b>. Las recomendaciones ayudan a decidir: nada se ejecuta automáticamente.
      Etiquetas: <span class="tag-m">introducido</span> = dato tuyo · <span class="tag-c">calculado</span> = lo calcula el motor.</div>
    ${R.tab !== "config" ? `<div class="toolbar"><label style="margin:0">Plan de temporada</label><select id="rs">${R.plans.length ? R.plans.map((p) => `<option ${p.season === R.season ? "selected" : ""}>${esc(p.season)}</option>`).join("") : `<option value="">(sin plan)</option>`}</select></div>` : ""}
    <div id="pane"></div>`;
  $$("[data-t]", R.el).forEach((b) => b.addEventListener("click", () => { R.tab = b.dataset.t; render(); }));
  $("#rs", R.el)?.addEventListener("change", (e) => { R.season = e.target.value; render(); });
  ({ fichajes: renderSignings, plantilla: renderSquadRecos, config: renderConfig })[R.tab]($("#pane", R.el));
}

/* ======================= Núcleo de datos ======================= */
function context() {
  const ft = firstTeam(), pl = plan(), des = pl && Object.keys(pl.desired || {}).length ? pl.desired : null;
  const cnt = {}; ft.forEach((p) => { if (p.position) cnt[p.position] = (cnt[p.position] || 0) + 1; });
  const bill = ft.reduce((t, p) => t + Number(p.wage_eur || 0), 0);
  const needs = des ? POSITIONS.map((pos) => ({ pos, have: cnt[pos] || 0, want: des[pos] || 0, deficit: (des[pos] || 0) - (cnt[pos] || 0), priority: (pl.priorities || []).includes(pos) })).filter((n) => n.deficit > 0 || n.priority) : null;
  return { ft, pl, des, cnt, bill, needs, ey: endYear(R.season), budget: pl?.transfer_budget ?? null,
    wageMargin: pl?.wage_budget != null ? pl.wage_budget - bill : null };
}

/* ---------- puntuación de un candidato ---------- */
function scoreCandidate(c, need, ctx) {
  const W = R.cfg.weights, parts = {};
  const pos = need.pos, exact = c.position === pos, compat = (COMPAT[pos] || []).includes(c.position);
  if (!exact && !compat) return null;
  // Adecuación táctica
  const posFit = exact ? 100 : 70, aw = ATTR_W[pos];
  let attrScore = null;
  if (aw && Object.keys(aw).every((k) => c[k] != null)) attrScore = Object.entries(aw).reduce((t, [k, w]) => t + clamp(((c[k] - 40) / 45) * 100) * w, 0);
  parts.tactical = { score: attrScore == null ? posFit : posFit * 0.4 + attrScore * 0.6, known: true,
    note: exact ? "Posición exacta" : `Posición compatible (${c.position})`, extra: attrScore == null && aw ? "perfil de atributos no disponible: solo se evalúa la posición" : null };
  // Calidad
  const peers = ctx.ft.filter((p) => p.position === pos && p.overall != null).map((p) => p.overall);
  const groupPeers = ctx.ft.filter((p) => GROUP[p.position] === GROUP[pos] && p.overall != null).map((p) => p.overall);
  const ref = peers.length ? median(peers) : median(groupPeers), best = peers.length ? Math.max(...peers) : null;
  parts.quality = ref == null || c.overall == null ? { score: null, known: false, note: "sin OVR propio o del jugador para comparar" }
    : { score: clamp(50 + (c.overall - ref) * 6), known: true, note: `OVR ${c.overall} vs mediana propia ${ref}${peers.length ? "" : " (de su grupo de posición)"}`, ref, best };
  // Potencial
  parts.potential = c.potential == null ? { score: null, known: false, note: "sin potencial registrado" } : { score: clamp(((c.potential - 55) / 30) * 100), known: true, note: `Potencial ${c.potential}` };
  // Coste
  parts.cost = ctx.budget == null || c.value_eur == null ? { score: null, known: false, note: ctx.budget == null ? "presupuesto de fichajes no definido en el plan" : "sin valor de mercado en tu base" }
    : { score: clamp(100 * (1 - Number(c.value_eur) / ctx.budget)), known: true, over: Number(c.value_eur) > ctx.budget, note: `Valor ${eur(c.value_eur)} vs presupuesto ${eur(ctx.budget)}` };
  // Edad
  parts.age = c.age == null ? { score: null, known: false, note: "sin edad registrada" }
    : { score: clamp(100 - 8 * Math.max(0, R.cfg.ageMin - c.age, c.age - R.cfg.ageMax)), known: true, note: `${c.age} años (ventana ${R.cfg.ageMin}-${R.cfg.ageMax})` };
  // Salario
  parts.salary = ctx.wageMargin == null || c.wage_eur == null ? { score: null, known: false, note: ctx.wageMargin == null ? "presupuesto salarial no definido en el plan" : "sin sueldo en tu base" }
    : { score: ctx.wageMargin <= 0 ? 0 : clamp(100 * (1 - Number(c.wage_eur) / ctx.wageMargin)), known: true, over: Number(c.wage_eur) > ctx.wageMargin, note: `Sueldo ${eur(c.wage_eur)} vs margen ${eur(ctx.wageMargin)}` };
  // Disponibilidad (estimada)
  parts.availability = c.contract_until == null || ctx.ey == null ? { score: null, known: false, note: "sin año de contrato" }
    : { score: c.contract_until <= ctx.ey ? 100 : c.contract_until === ctx.ey + 1 ? 70 : 40, known: true, note: `Contrato hasta ${c.contract_until} (estimación, no confirmada)` };
  // Necesidad
  parts.need = { score: clamp(need.deficit >= 2 ? 90 : need.deficit === 1 ? 70 : 20) + (need.priority ? 10 : 0), known: true, note: need.deficit > 0 ? `Faltan ${need.deficit} en ${pos}${need.priority ? " (prioritaria)" : ""}` : `Posición prioritaria sin déficit` };
  parts.need.score = clamp(parts.need.score);
  let tot = 0, known = 0, all = 0;
  for (const [k] of CRITERIA) { const w = Number(W[k] || 0); all += w; if (parts[k].known && parts[k].score != null) { tot += w * parts[k].score; known += w; } }
  if (!known) return null;
  return { cand: c, total: tot / known, coverage: all ? (known / all) * 100 : 0, parts };
}

function candidatesFor(need, ctx) {
  const names = new Set(R.players.map((p) => p.name.toLowerCase()));
  return R.scouts.filter((s) => s.position && !names.has(s.name.toLowerCase()) && s.overall != null)
    .map((s) => scoreCandidate(s, need, ctx)).filter(Boolean).sort((a, b) => b.total - a.total);
}

/* ======================= Fichajes ======================= */
function renderSignings(pane) {
  const ctx = context();
  if (!ctx.pl || !ctx.des) { pane.innerHTML = `<div class="card">Información insuficiente: define en <b>Planificación → Plan de temporada</b> los jugadores deseados por posición (y, si quieres, prioridades y presupuesto). Sin eso no puedo detectar necesidades.</div>`; return; }
  const needs = ctx.needs;
  if (!needs.length) { pane.innerHTML = `<div class="card flag-ok">No se detectan posiciones con déficit ni prioridades en el plan de ${esc(R.season)}.</div>`; return; }
  if (!R.scouts.length) { pane.innerHTML = `<div class="card">Se detectan necesidades (${needs.map((n) => n.pos).join(", ")}), pero tu base de Scouting está vacía: no hay candidatos que evaluar. Importa jugadores en Scouting → Importar.</div>`; return; }
  pane.innerHTML = `${ctx.budget == null ? `<div class="card flag-warn">El plan no tiene presupuesto de fichajes: la puntuación de coste queda “sin datos” y no se tiene en cuenta.</div>` : ""}
    ${needs.sort((a, b) => (b.priority - a.priority) || (b.deficit - a.deficit)).map((n) => {
      const list = candidatesFor(n, ctx);
      const good = list.filter((x) => x.coverage >= R.cfg.minCoverage), weak = list.filter((x) => x.coverage < R.cfg.minCoverage);
      const top = good.slice(0, R.cfg.topN);
      return `<div class="card"><h3><span class="pos">${n.pos}</span> ${n.deficit > 0 ? `Faltan ${n.deficit}` : "Prioritaria"} <span class="muted" style="font-size:.85rem">· tienes ${n.have}, deseado ${n.want}${n.priority ? " · ★ prioridad" : ""}</span></h3>
        ${top.length ? top.map((x, i) => candCard(x, i, top, ctx, n)).join("") : `<p class="muted">${list.length ? "Hay candidatos, pero con información insuficiente (cobertura de datos menor a " + R.cfg.minCoverage + "%)." : "Sin candidatos en tu base para esta posición (posición exacta o compatible con OVR cargado)."}</p>`}
        ${weak.length ? `<details><summary class="muted" style="cursor:pointer">${weak.length} candidatos con información insuficiente</summary>${weak.slice(0, 5).map((x) => `<div>• ${esc(x.cand.name)} — ${x.total.toFixed(0)} pts, cobertura ${x.coverage.toFixed(0)}%</div>`).join("")}</details>` : ""}</div>`;
    }).join("")}`;
  $$("[data-toggle]", pane).forEach((b) => b.addEventListener("click", () => { const d = $(`#${b.dataset.toggle}`, pane); d.hidden = !d.hidden; }));
}

function candCard(x, i, top, ctx, need) {
  const c = x.cand, p = x.parts, id = "d" + need.pos + i;
  const pros = [], risks = [];
  if (p.quality.known && p.quality.best != null && c.overall > p.quality.best) pros.push(`Su OVR (${c.overall}) supera al mejor que tienes en ${need.pos} (${p.quality.best})`);
  else if (p.quality.known && p.quality.score >= 60) pros.push(`Nivel por encima de la mediana propia (${p.quality.note})`);
  if (p.tactical.score >= 80) pros.push("Buen encaje de perfil para el puesto");
  if (p.potential.known && p.potential.score >= 70) pros.push(`Potencial alto (${c.potential})`);
  if (p.cost.known && !p.cost.over && p.cost.score >= 60) pros.push("Valor de mercado cómodo para tu presupuesto");
  if (p.age.known && p.age.score === 100) pros.push("Edad dentro de tu ventana");
  if (p.availability.known && p.availability.score === 100) pros.push("Contrato corto: posible oportunidad (no confirmada)");
  if (p.quality.known && p.quality.score < 50) risks.push("No mejora claramente el nivel que ya tienes en esa posición");
  if (p.cost.over) risks.push("Su valor de mercado supera tu presupuesto de fichajes");
  if (p.salary.over) risks.push("Su sueldo supera el margen salarial del plan");
  if (p.age.known && p.age.score < 100) risks.push(`Fuera de tu ventana de edad (${c.age})`);
  if (p.tactical.extra) risks.push("Perfil de atributos incompleto");
  if (c.source === "real") risks.push("Dato de vida real: confirma su equivalente en FC 27 antes de decidir");
  const missing = CRITERIA.filter(([k]) => !p[k].known).map(([, l]) => l);
  if (missing.length) risks.push("Sin datos de: " + missing.join(", "));
  const loanHint = (p.cost.over || p.salary.over) && (c.age == null || c.age <= 24);
  const alts = top.filter((o) => o !== x);
  const cheap = top.filter((o) => o !== x && o.cand.value_eur != null && x.cand.value_eur != null && o.cand.value_eur < x.cand.value_eur && o.total >= x.total - 8).sort((a, b) => a.cand.value_eur - b.cand.value_eur)[0];
  const attrs = Object.keys(ATTR_LABEL).filter((k) => c[k] != null).map((k) => `${ATTR_LABEL[k]} ${c[k]}`).join(" · ");
  return `<div style="border-top:1px solid var(--line);padding:.6rem 0"><div style="display:flex;justify-content:space-between;gap:1rem;align-items:center">
      <div><b>${i + 1}. ${esc(c.name)}</b> <span class="pos">${esc(c.position)}</span> <span class="muted">${esc(c.club || "")} · ${c.age ?? "?"} años · OVR ${c.overall} ${c.potential ? "· POT " + c.potential : ""} · ${c.source === "real" ? "vida real" : "FC 27"}</span></div>
      <div style="text-align:right"><span class="ovr" style="font-size:1.4rem">${x.total.toFixed(0)}</span><span class="muted"> / 100</span><div class="muted" style="font-size:.75rem">cobertura de datos ${x.coverage.toFixed(0)}%</div></div></div>
    <div class="bar"><i class="${x.total < 50 ? "warn" : ""}" style="width:${x.total}%"></i></div>
    <div style="margin-top:.3rem"><b>Motivo:</b> ${esc(p.need.note)}; ${esc(p.tactical.note.toLowerCase())}${p.quality.known ? "; " + esc(p.quality.note) : ""}.</div>
    ${pros.length ? `<div class="flag-ok">+ ${pros.map(esc).join(" · ")}</div>` : ""}${risks.length ? `<div class="flag-warn">⚠ ${risks.map(esc).join(" · ")}</div>` : ""}
    ${loanHint ? `<div class="muted">Valora una <b>cesión</b>: por coste o sueldo puede no encajar en un fichaje, y es joven. No sé si su club aceptaría.</div>` : ""}
    ${cheap ? `<div class="muted">Alternativa más económica de valor comparable: <b>${esc(cheap.cand.name)}</b> (${cheap.total.toFixed(0)} pts, valor ${eur(cheap.cand.value_eur)}).</div>` : ""}
    <button class="btn ghost sm" data-toggle="${id}" style="margin-top:.3rem">Ver datos y puntuación</button>
    <div id="${id}" hidden style="margin-top:.4rem"><div class="tw"><table style="min-width:0"><thead><tr><th>Criterio</th><th class="num">Peso</th><th class="num">Puntos</th><th>Dato</th></tr></thead><tbody>
      ${CRITERIA.map(([k, l]) => `<tr><td>${l}</td><td class="num">${R.cfg.weights[k]}</td><td class="num">${p[k].known ? p[k].score.toFixed(0) : "–"}</td><td class="${p[k].known ? "" : "muted"}">${esc(p[k].known ? p[k].note : "Sin datos: " + p[k].note)}${p[k].extra ? ` <span class="muted">(${esc(p[k].extra)})</span>` : ""}</td></tr>`).join("")}</tbody></table></div>
      <div class="muted" style="margin-top:.3rem">Datos del jugador: ${[`<span class="tag-m">introducido</span> ${attrs || "sin atributos"}`, c.value_eur != null ? `<span class="tag-m">introducido</span> valor ${eur(c.value_eur)}` : "", c.wage_eur != null ? `<span class="tag-m">introducido</span> sueldo ${eur(c.wage_eur)}` : "", `<span class="tag-c">calculado</span> puntuación ${x.total.toFixed(1)} (media ponderada de los criterios con datos)`].filter(Boolean).join(" · ")}</div>
      ${alts.length ? `<div class="muted">Otras alternativas: ${alts.map((o) => `${esc(o.cand.name)} (${o.total.toFixed(0)})`).join(", ")}</div>` : ""}</div></div>`;
}

/* ======================= Recomendaciones de plantilla ======================= */
function squadRecos() {
  const ctx = context(), out = [], ft = ctx.ft, pl = ctx.pl, ey = ctx.ey;
  const teamGames = Math.max(0, ...R.players.map((p) => p.apps || 0)), avail = teamGames * 90;
  const need = (t, sev) => ({ sev, ...t });
  // 1. Profundidad
  if (ctx.des) {
    for (const n of POSITIONS.map((pos) => ({ pos, have: ctx.cnt[pos] || 0, want: ctx.des[pos] || 0 })).filter((n) => n.have < n.want)) {
      out.push(need({ type: "Profundidad", title: `Falta profundidad en ${n.pos}`, why: `Tienes ${n.have} jugador(es) en ${n.pos} y tu plan pide ${n.want}.`,
        data: [M("Deseado (plan)", n.want), C("Tienes", n.have), C("Déficit", n.want - n.have)], pros: ["Cubrirlo evita improvisar jugadores fuera de posición"],
        risks: ["Un jugador polivalente de otra posición no se cuenta como cobertura"], score: Math.min(100, 55 + 20 * (n.want - n.have) + ((pl?.priorities || []).includes(n.pos) ? 15 : 0)), alt: "Mira la pestaña Fichajes para candidatos." }, (n.want - n.have >= 2 || (pl?.priorities || []).includes(n.pos)) ? "bad" : "warn"));
    }
  } else out.push(need({ type: "Profundidad", title: "No se puede evaluar la profundidad", why: "Información insuficiente: no hay jugadores deseados por posición en el plan.", data: [], pros: [], risks: ["Define el plan en Planificación"], score: null }, "info"));
  // 2. Minutos
  if (avail >= 270) {
    const mins = ft.filter((p) => p.minutes != null).map((p) => ({ p, pct: (p.minutes / avail) * 100 }));
    const medOvr = median(ft.map((p) => p.overall).filter((x) => x != null));
    for (const { p, pct } of mins) {
      const key = (pl?.essentials || []).includes(p.id);
      if ((p.squad_role === "titular" || (p.overall != null && medOvr != null && p.overall > medOvr + 3)) && pct < 45)
        out.push(need({ type: "Minutos", title: `${p.name} necesita más minutos`, why: `Juega el ${pct.toFixed(0)}% de los minutos posibles y su rol/nivel apunta a más protagonismo.`,
          data: [M("Rol", p.squad_role || "s/d"), M("OVR", p.overall ?? "s/d"), C("% de minutos", pct.toFixed(0) + "%"), C("Partidos del equipo", teamGames)], pros: ["Rentabilizas a un jugador de nivel"], risks: ["Los minutos son los que anotaste; si faltan partidos, el % se infravalora"], score: clamp(80 - pct) }, "warn"));
      else if (p.age != null && p.age <= 22 && p.potential != null && p.overall != null && p.potential - p.overall >= 5 && pct < 20 && !key)
        out.push(need({ type: "Cesión", title: `${p.name}: candidato a cesión para ganar minutos`, why: `${p.age} años, potencial ${p.potential} vs OVR ${p.overall}, y solo ${pct.toFixed(0)}% de los minutos.`,
          data: [M("Edad", p.age), M("OVR", p.overall), M("Potencial", p.potential), C("% de minutos", pct.toFixed(0) + "%")], pros: ["Puede ganar experiencia competitiva", "Libera plaza y parte del sueldo si el otro club lo asume"], risks: ["Pierdes disponibilidad inmediata", "El potencial es un dato tuyo, no confirmado"], score: clamp(70 - pct) }, "info"));
    }
  } else out.push(need({ type: "Minutos", title: "No se pueden evaluar los minutos", why: "Información insuficiente: registra estadísticas de temporada (Plantilla → Temporada) para al menos unos partidos.", data: [], pros: [], risks: [], score: null }, "info"));
  // 3. Cantera
  const rt = (id) => R.ratings.filter((r) => r.player_id === id).sort((a, b) => b.rated_on.localeCompare(a.rated_on))[0];
  for (const pr of R.profiles.filter((x) => !x.promoted_on)) {
    const p = R.players.find((x) => x.id === pr.player_id); if (!p || stOf(p.id).left_club) continue;
    const r = rt(p.id), avg = r ? [r.technical, r.tactical, r.physical, r.mental].filter((v) => v != null) : [], a = avg.length ? avg.reduce((s, v) => s + v, 0) / avg.length : null;
    const grp = ft.filter((q) => GROUP[q.position] === GROUP[p.position] && q.overall != null).map((q) => q.overall), med = grp.length >= 3 ? median(grp) : null;
    if ((pr.readiness || 0) >= 4 || (a != null && med != null && a >= med - 3))
      out.push(need({ type: "Cantera", title: `${p.name} podría promocionar al primer equipo`, why: `${pr.readiness >= 4 ? "Lo valoraste " + pr.readiness + "/5 en preparación. " : ""}${a != null && med != null ? `Su valoración media (${a.toFixed(0)}) está cerca o por encima de la mediana del primer equipo en su grupo (${med}).` : ""}`,
        data: [M("Preparación (1-5)", pr.readiness ?? "s/d"), M("Valoración entrenadores", a == null ? "s/d" : a.toFixed(0)), C("Mediana OVR del grupo", med ?? "s/d")], pros: ["Cubre profundidad con un jugador de la casa", "Sin coste de fichaje"], risks: ["La valoración de cantera y el OVR del primer equipo no son la misma escala", "Depende de si hay hueco en su posición"], score: clamp(60 + (pr.readiness || 3) * 6) }, "ok"));
  }
  // 4. Contratos
  if (ey != null) for (const p of ft.filter((q) => q.contract_until != null && q.contract_until <= ey)) {
    const key = (pl?.essentials || []).includes(p.id);
    out.push(need({ type: "Contrato", title: `${p.name}: contrato hasta ${p.contract_until}`, why: key ? "Es imprescindible en tu plan y su contrato termina esta temporada." : "Su contrato termina al final de la temporada del plan.",
      data: [M("Contrato hasta", p.contract_until), M("Sueldo", p.wage_eur != null ? eur(p.wage_eur) : "s/d"), M("OVR", p.overall ?? "s/d")], pros: ["Decidir ahora da margen de negociación"], risks: ["Puedes perderlo gratis si no renuevas ni vendes"], score: key ? 90 : 60 }, key ? "bad" : "warn"));
  }
  // 5. Consecuencias de vender
  for (const id of pl?.to_sell || []) {
    const p = ft.find((x) => x.id === id); if (!p || !p.position || !ctx.des) continue;
    const after = (ctx.cnt[p.position] || 0) - 1, want = ctx.des[p.position] || 0;
    out.push(need({ type: "Venta", title: `Vender o ceder a ${p.name}`, why: after < want ? `Dejaría ${after} en ${p.position}, por debajo de los ${want} deseados.` : `Tu cobertura en ${p.position} seguiría cumpliendo el plan (${after} de ${want}).`,
      data: [M("Sueldo que se libera", p.wage_eur != null ? eur(p.wage_eur) : "s/d"), C("Cobertura tras la salida", `${after}/${want}`)], pros: p.wage_eur ? ["Libera masa salarial"] : [], risks: after < want ? ["Habría que reforzar la posición (ver Fichajes)"] : [], score: after < want ? 70 : 40 }, after < want ? "warn" : "info"));
  }
  return out;
}

function renderSquadRecos(pane) {
  const recs = squadRecos();
  const sev = { bad: 0, warn: 1, ok: 2, info: 3 };
  recs.sort((a, b) => sev[a.sev] - sev[b.sev] || (b.score ?? -1) - (a.score ?? -1));
  pane.innerHTML = `${R.hasStats ? "" : `<div class="card flag-warn">No se pudo leer gm_player_stats; los minutos no se evaluarán.</div>`}
    ${recs.length ? recs.map((r) => `<div class="card"><div style="display:flex;justify-content:space-between;gap:1rem"><div><span class="badge">${r.type}</span> <b class="${r.sev === "bad" ? "flag-bad" : r.sev === "warn" ? "flag-warn" : r.sev === "ok" ? "flag-ok" : ""}">${esc(r.title)}</b></div>
        ${r.score != null ? `<div><span class="ovr">${r.score.toFixed(0)}</span><span class="muted"> / 100</span></div>` : `<span class="muted">sin puntuar</span>`}</div>
      <p style="margin:.3rem 0"><b>Motivo:</b> ${esc(r.why)}</p>
      ${r.data.length ? `<div class="muted">Datos: ${r.data.map((d) => `<span class="tag-${d.kind === "manual" ? "m" : "c"}">${d.kind === "manual" ? "introducido" : "calculado"}</span> ${esc(d.label)}: ${esc(d.value)}`).join(" · ")}</div>` : ""}
      ${r.pros.length ? `<div class="flag-ok">+ ${r.pros.map(esc).join(" · ")}</div>` : ""}${r.risks.length ? `<div class="flag-warn">⚠ ${r.risks.map(esc).join(" · ")}</div>` : ""}
      ${r.alt ? `<div class="muted">${esc(r.alt)}</div>` : ""}</div>`).join("") : `<div class="card flag-ok">Sin recomendaciones: con los datos actuales no se detecta nada relevante.</div>`}`;
}

/* ======================= Configuración ======================= */
function renderConfig(pane) {
  const c = R.cfg;
  pane.innerHTML = `<div class="grid g2"><div class="card"><h3>Ponderaciones (0 = ignorar, 10 = máxima importancia)</h3>
      ${CRITERIA.map(([k, l, d]) => `<label>${l}: <b id="v-${k}">${c.weights[k]}</b></label><input type="range" min="0" max="10" step="0.5" data-w="${k}" value="${c.weights[k]}"><div class="muted" style="font-size:.78rem">${d}</div>`).join("")}</div>
    <div class="card"><h3>Criterios</h3><div class="row">
      <div><label>Edad ideal mínima</label><input type="number" id="amin" value="${c.ageMin}" min="14" max="45"></div><div><label>Edad ideal máxima</label><input type="number" id="amax" value="${c.ageMax}" min="14" max="45"></div></div>
      <div class="row"><div><label>Candidatos por posición</label><input type="number" id="topn" value="${c.topN}" min="1" max="10"></div>
      <div><label>Cobertura mínima de datos (%)</label><input type="number" id="cov" value="${c.minCoverage}" min="0" max="100"></div></div>
      <p class="muted">Por debajo de la cobertura mínima, un candidato se marca como “información insuficiente” y no se recomienda.</p>
      <h3 style="margin-top:1rem">Cómo se calcula</h3><p class="muted">Cada criterio da de 0 a 100 puntos. La puntuación final es la media ponderada <b>solo de los criterios con datos</b>; los criterios sin datos no suman ni restan, y se indican en los riesgos.
      La cobertura de datos es el porcentaje del peso total que tiene datos. Nada se estima: el valor de mercado y el sueldo son los que figuran en tu base de Scouting.</p></div></div>
    <div class="actions"><button class="btn ghost" id="rs">Restablecer</button><button class="btn" id="sv">Guardar configuración</button></div>`;
  $$("[data-w]", pane).forEach((i) => i.addEventListener("input", () => { $("#v-" + i.dataset.w, pane).textContent = i.value; }));
  $("#rs", pane).addEventListener("click", () => { R.cfg = JSON.parse(JSON.stringify(DEFAULTS)); renderConfig(pane); });
  $("#sv", pane).addEventListener("click", async () => {
    const w = {}; $$("[data-w]", pane).forEach((i) => { w[i.dataset.w] = Number(i.value); });
    if (!Object.values(w).some((v) => v > 0)) return toast("Al menos un criterio debe tener peso.", "err");
    const amin = Number($("#amin", pane).value), amax = Number($("#amax", pane).value);
    if (amin > amax) return toast("La edad mínima no puede superar a la máxima.", "err");
    R.cfg = { weights: w, ageMin: amin, ageMax: amax, topN: Math.max(1, Number($("#topn", pane).value) || 3), minCoverage: clamp(Number($("#cov", pane).value) || 0) };
    const { error } = await R.sb.from("gm_reco_settings").upsert({ user_id: R.user.id, settings: R.cfg, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) return toast(error.message, "err");
    toast("Configuración guardada");
  });
}
