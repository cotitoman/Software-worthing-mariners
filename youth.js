import { $, $$, esc, POSITIONS, normPos, toNum, toast, money, openModal } from "./util.js";

/* ===================== Cantera y cesiones =====================
   Un jugador de cantera es un jugador de la plantilla con rol "juvenil" + un perfil.
   Promocionarlo solo cambia su rol: no se crea ningún duplicado. Todo se introduce a mano. */

const GROUP = { GK: "POR", CB: "DEF", LB: "DEF", RB: "DEF", LWB: "DEF", RWB: "DEF", CDM: "MED", CM: "MED", CAM: "MED", LM: "MED", RM: "MED", LW: "DEL", RW: "DEL", CF: "DEL", ST: "DEL" };
const READY = { 1: "Lejos del primer equipo", 2: "Necesita desarrollo", 3: "Cerca", 4: "Casi listo", 5: "Listo para subir" };
const GOAL_KIND = { atributo: "Mejorar atributos", cesion: "Ganar experiencia (cesión)", posicion: "Posición alternativa", primer_equipo: "Incorporarse al primer equipo", otro: "Otro" };
const GOAL_ST = { pendiente: "Pendiente", en_curso: "En curso", logrado: "Logrado", descartado: "Descartado" };
const LOAN_ST = { activa: "Activa", finalizada: "Finalizada", cancelada: "Cancelada" };
const RATING_KEYS = [["technical", "Técnica"], ["tactical", "Táctica"], ["physical", "Física"], ["mental", "Mental"]];
const RC = ["#19c3c3", "#f5b041", "#ec7063", "#7fb3ff"];

const Y = { sb: null, user: null, el: null, tab: "cantera", chart: null, noSql: false,
  players: [], status: new Map(), profiles: [], ratings: [], reports: [], goals: [], loans: [], lreports: [], seasonStats: [],
  f: { q: "", pos: "", ageMax: "", potMin: "", level: "" }, goalF: "" };

const fail = (error) => { if (error) { toast(error.message, "err"); return true; } return false; };
const today = () => new Date().toISOString().slice(0, 10);
const ageOf = (dob) => { if (!dob) return null; const d = new Date(dob), n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--; return a; };
const daysTo = (d) => (d ? Math.round((new Date(d + "T00:00:00") - new Date(today() + "T00:00:00")) / 86400000) : null);
const eur = (n) => "€" + Math.round(Number(n || 0)).toLocaleString("es-CL");
const stOf = (id) => Y.status.get(id) || {};
const pl = (id) => Y.players.find((p) => p.id === id);
const avgR = (r) => { const v = RATING_KEYS.map(([k]) => r[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const latestRating = (pid) => Y.ratings.filter((r) => r.player_id === pid).sort((a, b) => b.rated_on.localeCompare(a.rated_on) || b.created_at.localeCompare(a.created_at))[0] || null;
const level = (v) => (v == null ? null : v < 50 ? "Inicial" : v < 65 ? "En desarrollo" : v < 75 ? "Avanzado" : "Muy avanzado");

async function load() {
  const t = (n) => Y.sb.from(n).select("*");
  const [p, st, pr, ra, re, go, lo, lr, ss] = await Promise.all([t("gm_players"), t("gm_player_status"), t("gm_youth_profiles"), t("gm_youth_ratings"), t("gm_youth_reports"), t("gm_dev_goals"), t("gm_loans"), t("gm_loan_reports"), t("gm_season_stats")]);
  Y.noSql = !!(pr.error || ra.error || re.error || go.error || lo.error || lr.error || st.error);
  Y.players = (p.data || []).sort((a, b) => a.name.localeCompare(b.name));
  Y.status = new Map((st.data || []).map((s) => [s.player_id, s]));
  Y.profiles = pr.data || []; Y.ratings = ra.data || []; Y.reports = re.data || []; Y.goals = go.data || [];
  Y.loans = lo.data || []; Y.lreports = lr.data || []; Y.seasonStats = ss.data || [];
}
async function reload() { await load(); render(); }

export async function mountYouth(el, { sb, user }) {
  Y.sb = sb; Y.user = user; Y.el = el;
  el.innerHTML = `<p class="muted">Cargando cantera y cesiones…</p>`;
  await load(); render();
}

function render() {
  if (Y.chart) { Y.chart.destroy(); Y.chart = null; }
  if (Y.noSql) { Y.el.innerHTML = `<div class="card"><b>Falta un paso en Supabase.</b> Ejecuta <code>supabase/schema_planificacion.sql</code> y luego <code>supabase/schema_cantera.sql</code> en el SQL Editor, y recarga la página.</div>`; return; }
  const tabs = [["cantera", "Cantera"], ["cesiones", "Cesiones"], ["plan", "Plan de desarrollo"]];
  Y.el.innerHTML = `<div class="subtabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${Y.tab === k ? "on" : ""}">${l}</button>`).join("")}</div><div id="pane"></div>`;
  $$("[data-t]", Y.el).forEach((b) => b.addEventListener("click", () => { Y.tab = b.dataset.t; render(); }));
  ({ cantera: renderYouth, cesiones: renderLoans, plan: renderGoals })[Y.tab]($("#pane", Y.el));
}

/* ======================= Cantera ======================= */
function youthRows() {
  return Y.profiles.map((pr) => ({ pr, p: pl(pr.player_id) })).filter((x) => x.p).map(({ pr, p }) => {
    const lr = latestRating(p.id), avg = lr ? avgR(lr) : null;
    return { pr, p, lr, avg, age: ageOf(pr.birth_date) ?? p.age, lvl: level(avg), promoted: !!pr.promoted_on };
  });
}

function renderYouth(pane) {
  const f = Y.f, q = f.q.toLowerCase();
  const all = youthRows();
  const rows = all.filter((r) => (!q || r.p.name.toLowerCase().includes(q)) && (!f.pos || r.p.position === f.pos) && (f.ageMax === "" || (r.age != null && r.age <= Number(f.ageMax)))
    && (f.potMin === "" || (r.pr.potential_est != null && r.pr.potential_est >= Number(f.potMin))) && (!f.level || r.lvl === f.level));
  const noProfile = Y.players.filter((p) => p.squad_role === "juvenil" && !Y.profiles.some((x) => x.player_id === p.id) && !stOf(p.id).left_club);
  pane.innerHTML = `<div class="toolbar"><input id="q" placeholder="Buscar…" value="${esc(f.q)}">
    <select id="pos"><option value="">Posición</option>${POSITIONS.map((p) => `<option ${f.pos === p ? "selected" : ""}>${p}</option>`).join("")}</select>
    <input id="age" type="number" placeholder="Edad máx." value="${esc(f.ageMax)}" style="max-width:100px"><input id="pot" type="number" placeholder="Pot. est. mín." value="${esc(f.potMin)}" style="max-width:120px">
    <select id="lvl"><option value="">Nivel de desarrollo</option>${["Inicial", "En desarrollo", "Avanzado", "Muy avanzado"].map((l) => `<option ${f.level === l ? "selected" : ""}>${l}</option>`).join("")}</select>
    <button class="btn" id="ny">+ Jugador de cantera</button><span class="muted">${rows.length} de ${all.length}</span></div>
    ${noProfile.length ? `<div class="card flag-warn">Jugadores con rol juvenil sin perfil de cantera: ${noProfile.map((p) => `<a href="#" data-mk="${p.id}">${esc(p.name)}</a>`).join(", ")} (clic para crear el perfil).</div>` : ""}
    ${all.length ? "" : `<div class="card muted">Aún no hay jugadores de cantera. Añade uno o crea el perfil de un jugador juvenil existente.</div>`}
    <div class="tw"><table><thead><tr><th>Jugador</th><th>Pos</th><th class="num">Edad</th><th>Equipo</th><th class="num">OVR actual</th><th class="num">Val. entrenadores</th><th>Nivel</th><th class="num">Potencial (est.)</th><th>Preparación</th><th>Estado</th></tr></thead>
    <tbody>${rows.map((r) => `<tr class="click" data-id="${r.p.id}"><td><b>${esc(r.p.name)}</b></td><td><span class="pos">${esc(r.p.position || "–")}</span></td><td class="num">${r.age ?? ""}</td><td>${esc(r.pr.youth_team || "")}</td>
      <td class="num ovr">${r.p.overall ?? ""}</td><td class="num">${r.avg == null ? "–" : r.avg.toFixed(0)}</td><td>${r.lvl || "–"}</td><td class="num">${r.pr.potential_est ?? "–"}</td>
      <td>${r.pr.readiness ? r.pr.readiness + "/5" : "–"}</td><td>${r.promoted ? `<span class="badge">Promocionado ${r.pr.promoted_on}</span>` : stOf(r.p.id).left_club === "cedido" ? `<span class="badge">Cedido</span>` : ""}</td></tr>`).join("")}</tbody></table></div>
    <p class="muted">“OVR actual” es el rendimiento actual del jugador. “Potencial (est.)” es una estimación tuya, no un dato confirmado. “Val. entrenadores” es la media de la última valoración técnica, táctica, física y mental.</p>`;
  const rerender = () => renderYouth(pane);
  $("#q", pane).addEventListener("input", (e) => { f.q = e.target.value; rerender(); $("#q", pane).focus(); });
  [["pos", "pos"], ["age", "ageMax"], ["pot", "potMin"], ["lvl", "level"]].forEach(([id, k]) => $("#" + id, pane).addEventListener("change", (e) => { f[k] = e.target.value; rerender(); }));
  $("#ny", pane).addEventListener("click", () => youthForm(null));
  $$("[data-mk]", pane).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); youthForm(null, a.dataset.mk); }));
  $$("tr.click", pane).forEach((tr) => tr.addEventListener("click", () => youthProfile(tr.dataset.id)));
}

function youthForm(pr, existingPlayerId = null) {
  const p = pr ? pl(pr.player_id) : existingPlayerId ? pl(existingPlayerId) : null;
  const m = openModal(`<h2>${pr ? "Editar perfil de cantera" : "Nuevo jugador de cantera"} <button class="btn ghost sm" data-close>Cerrar</button></h2>
    <form id="f"><div class="row">
      <div style="flex:2"><label>Nombre *</label><input name="name" required value="${esc(p?.name || "")}" ${p ? "disabled" : ""}></div>
      <div><label>Posición</label><select name="pos"><option value=""></option>${POSITIONS.map((x) => `<option ${p?.position === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      <div><label>Pierna dominante</label><select name="foot"><option value=""></option>${["Derecho", "Izquierdo", "Ambos"].map((x) => `<option ${p?.foot === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
    </div><div class="row">
      <div><label>Fecha de nacimiento</label><input type="date" name="dob" value="${esc(pr?.birth_date || "")}"></div>
      <div><label>Equipo juvenil</label><input name="team" value="${esc(pr?.youth_team || "")}" placeholder="Sub-18, Sub-21…"></div>
      <div><label>OVR actual</label><input type="number" name="ovr" min="1" max="99" value="${p?.overall ?? ""}"></div>
      <div><label>Potencial estimado (est.)</label><input type="number" name="pot" min="1" max="99" value="${pr?.potential_est ?? ""}"></div>
      <div><label>Preparación (1-5)</label><input type="number" name="rd" min="1" max="5" value="${pr?.readiness ?? ""}"></div>
    </div><label>Notas</label><textarea name="notes" rows="2">${esc(pr?.notes || "")}</textarea>
    <div class="actions">${pr ? `<button type="button" class="btn danger" id="del">Quitar de la cantera</button>` : ""}<button class="btn">Guardar</button></div></form>`, { wide: true });
  $("#f", m.el).addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target), n = (k) => (fd.get(k) === "" ? null : Number(fd.get(k)));
    const dob = fd.get("dob") || null;
    let pid = p?.id;
    const pp = { position: normPos(fd.get("pos")) || null, foot: fd.get("foot") || null, overall: n("ovr"), squad_role: pr?.promoted_on ? undefined : "juvenil" };
    if (dob) pp.age = ageOf(dob);
    Object.keys(pp).forEach((k) => pp[k] === undefined && delete pp[k]);
    if (!pid) {
      const name = String(fd.get("name")).trim();
      const { data, error } = await Y.sb.from("gm_players").insert({ name, ...pp }).select().single();
      if (error) return toast(error.code === "23505" ? "Ya existe un jugador con ese nombre." : error.message, "err");
      pid = data.id;
    } else if (fail((await Y.sb.from("gm_players").update(pp).eq("id", pid)).error)) return;
    const row = { user_id: Y.user.id, player_id: pid, birth_date: dob, youth_team: String(fd.get("team")).trim() || null, potential_est: n("pot"), readiness: n("rd"), notes: String(fd.get("notes")).trim() || null };
    if (fail((await Y.sb.from("gm_youth_profiles").upsert(row, { onConflict: "player_id" })).error)) return;
    m.close(); toast("Guardado"); await reload(); youthProfile(pid);
  });
  $("#del", m.el)?.addEventListener("click", async () => {
    if (!confirm("¿Quitar el perfil de cantera? El jugador y sus estadísticas se conservan.")) return;
    if (fail((await Y.sb.from("gm_youth_profiles").delete().eq("id", pr.id)).error)) return;
    m.close(); reload();
  });
}

function youthProfile(pid) {
  const pr = Y.profiles.find((x) => x.player_id === pid), p = pl(pid); if (!pr || !p) return;
  const rts = Y.ratings.filter((r) => r.player_id === pid).sort((a, b) => a.rated_on.localeCompare(b.rated_on));
  const reps = Y.reports.filter((r) => r.player_id === pid).sort((a, b) => b.report_date.localeCompare(a.report_date));
  const seas = Y.seasonStats.filter((s) => s.player_id === pid).sort((a, b) => b.season.localeCompare(a.season));
  const goals = Y.goals.filter((g) => g.player_id === pid);
  const last = rts[rts.length - 1], avg = last ? avgR(last) : null;
  const peers = Y.players.filter((x) => x.id !== pid && x.squad_role !== "juvenil" && !stOf(x.id).left_club && GROUP[x.position] === GROUP[p.position] && x.overall != null).map((x) => x.overall).sort((a, b) => a - b);
  const med = peers.length >= 3 ? peers[Math.floor(peers.length / 2)] : null;
  const age = ageOf(pr.birth_date) ?? p.age;
  const m = openModal(`<h2>${esc(p.name)} <button class="btn ghost sm" data-close>Cerrar</button></h2>
    <div><span class="pos">${esc(p.position || "–")}</span> · ${age != null ? age + " años" : "edad s/d"} · ${esc(pr.youth_team || "sin equipo")} · pie ${esc(p.foot || "s/d")}${pr.promoted_on ? ` · <span class="badge">Promocionado el ${pr.promoted_on}</span>` : ""}</div>
    <div class="g6" style="margin-top:.6rem">${[["OVR actual", p.overall ?? "–"], ["Potencial (est.)", pr.potential_est ?? "–"], ["Val. entrenadores", avg == null ? "–" : avg.toFixed(0)], ["Nivel", level(avg) || "–"], ["Preparación", pr.readiness ? pr.readiness + "/5" : "–"]]
      .map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("")}</div>
    <div class="card" style="margin-top:.8rem"><b>Preparación para el primer equipo:</b> ${pr.readiness ? READY[pr.readiness] : "sin evaluar"}.
      ${med != null && avg != null ? `<div class="muted">Dato de apoyo: valoración media ${avg.toFixed(0)} frente a una mediana de OVR del primer equipo en ${GROUP[p.position]} de ${med} (${peers.length} jugadores). Es una referencia, no una decisión.</div>` : `<div class="muted">Faltan datos para comparar con el primer equipo (valoraciones del jugador o al menos 3 compañeros de su grupo con OVR).</div>`}
      ${pr.notes ? `<p>${esc(pr.notes)}</p>` : ""}</div>
    <div class="grid g2"><div class="card"><h3>Evolución de valoraciones</h3>${rts.length >= 1 ? `<canvas id="rc" height="200"></canvas>` : `<p class="muted">Sin valoraciones.</p>`}<button class="btn sm" id="ar">+ Valoración</button></div>
      <div class="card"><h3>Informes de entrenadores</h3>${reps.map((r) => `<p><b>${r.report_date}</b>${r.author ? " · " + esc(r.author) : ""}<br>${esc(r.body)}</p>`).join("") || `<p class="muted">Sin informes.</p>`}<button class="btn sm" id="arp">+ Informe</button></div></div>
    <div class="card"><h3>Estadísticas registradas</h3>${seas.length ? `<table style="min-width:0"><tr><th>Temp.</th><th class="num">PJ</th><th class="num">Min</th><th class="num">G</th><th class="num">A</th><th class="num">PI</th><th class="num">Nota</th></tr>${seas.map((s) => `<tr><td>${esc(s.season)}</td><td class="num">${s.apps}</td><td class="num">${s.minutes}</td><td class="num">${s.goals}</td><td class="num">${s.assists}</td><td class="num">${s.clean_sheets}</td><td class="num">${s.avg_rating ?? "–"}</td></tr>`).join("")}</table>` : `<p class="muted">Sin estadísticas. Anótalas en Plantilla → Temporada (los juveniles aparecen en esa tabla).</p>`}</div>
    <div class="card"><h3>Objetivos de desarrollo</h3>${goals.map((g) => `<div>• <b>${esc(g.title)}</b> <span class="muted">(${GOAL_KIND[g.kind]}${g.target_date ? " · hasta " + g.target_date : ""}) — ${GOAL_ST[g.status]}</span></div>`).join("") || `<p class="muted">Sin objetivos. Crea uno en la pestaña Plan de desarrollo.</p>`}</div>
    <div class="actions"><button class="btn ghost" id="ed">Editar perfil</button>${pr.promoted_on ? "" : `<button class="btn" id="pro">Promocionar al primer equipo</button>`}</div>`, { wide: true });
  if (rts.length) {
    new Chart($("#rc", m.el), { type: "line",
      data: { labels: rts.map((r) => r.rated_on), datasets: RATING_KEYS.map(([k, l], i) => ({ label: l, data: rts.map((r) => r[k]), borderColor: RC[i], backgroundColor: RC[i], tension: 0.25, spanGaps: true })) },
      options: { scales: { y: { min: 0, max: 100, ticks: { color: "#9db3d1" }, grid: { color: "#23497f" } }, x: { ticks: { color: "#9db3d1" } } }, plugins: { legend: { labels: { color: "#fff" } } } } });
  }
  $("#ed", m.el).addEventListener("click", () => { m.close(); youthForm(pr); });
  $("#ar", m.el).addEventListener("click", () => { m.close(); ratingForm(pid); });
  $("#arp", m.el).addEventListener("click", () => { m.close(); reportForm(pid); });
  $("#pro", m.el)?.addEventListener("click", () => promote(pr, p, m));
}

function ratingForm(pid) {
  const last = latestRating(pid);
  const m = openModal(`<h2>Nueva valoración <button class="btn ghost sm" data-close>Cerrar</button></h2><form id="f"><div class="row">
    <div><label>Fecha</label><input type="date" name="d" value="${today()}" required></div>
    ${RATING_KEYS.map(([k, l]) => `<div><label>${l} (0-100)</label><input type="number" min="0" max="100" name="${k}" value="${last?.[k] ?? ""}"></div>`).join("")}</div>
    <div class="actions"><button class="btn">Guardar</button></div></form>`);
  $("#f", m.el).addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const row = { player_id: pid, rated_on: fd.get("d") }; RATING_KEYS.forEach(([k]) => { row[k] = fd.get(k) === "" ? null : Number(fd.get(k)); });
    if (RATING_KEYS.every(([k]) => row[k] == null)) return toast("Introduce al menos una valoración.", "err");
    if (fail((await Y.sb.from("gm_youth_ratings").insert(row)).error)) return;
    m.close(); await reload(); youthProfile(pid);
  });
}
function reportForm(pid) {
  const m = openModal(`<h2>Nuevo informe <button class="btn ghost sm" data-close>Cerrar</button></h2><form id="f"><div class="row">
    <div><label>Fecha</label><input type="date" name="d" value="${today()}" required></div><div><label>Autor</label><input name="a"></div></div>
    <label>Informe *</label><textarea name="b" rows="5" required></textarea><div class="actions"><button class="btn">Guardar</button></div></form>`);
  $("#f", m.el).addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    if (fail((await Y.sb.from("gm_youth_reports").insert({ player_id: pid, report_date: fd.get("d"), author: String(fd.get("a")).trim() || null, body: String(fd.get("b")).trim() })).error)) return;
    m.close(); await reload(); youthProfile(pid);
  });
}
function promote(pr, p, parent) {
  const m = openModal(`<h2>Promocionar a ${esc(p.name)} <button class="btn ghost sm" data-close>Cerrar</button></h2>
    <p>Pasará al primer equipo con el mismo registro (estadísticas, valoraciones e informes se conservan). No se crea ningún duplicado.</p>
    <label>Rol en el primer equipo</label><select id="r"><option value="rotacion">Rotación</option><option value="suplente">Suplente</option><option value="titular">Titular</option></select>
    <div class="actions"><button class="btn" id="go">Confirmar promoción</button></div>`);
  $("#go", m.el).addEventListener("click", async () => {
    if (fail((await Y.sb.from("gm_players").update({ squad_role: $("#r", m.el).value }).eq("id", p.id)).error)) return;
    if (fail((await Y.sb.from("gm_youth_profiles").update({ promoted_on: today(), readiness: 5 }).eq("id", pr.id)).error)) return;
    m.close(); parent.close(); toast("Jugador promocionado"); await reload(); youthProfile(p.id);
  });
}

/* ======================= Cesiones ======================= */
function renderLoans(pane) {
  const loans = Y.loans.map((l) => ({ l, p: pl(l.player_id) })).filter((x) => x.p);
  const act = loans.filter((x) => x.l.status === "activa");
  const orphan = Y.players.filter((p) => stOf(p.id).left_club === "cedido" && !Y.loans.some((l) => l.player_id === p.id && l.status === "activa"));
  const alerts = [];
  act.forEach(({ l, p }) => {
    const e = daysTo(l.end_date), r = daysTo(l.next_review), lastRep = Y.lreports.filter((x) => x.loan_id === l.id).sort((a, b) => b.report_date.localeCompare(a.report_date))[0];
    if (e != null) alerts.push(e < 0 ? { k: "bad", t: `${p.name}: la cesión en ${l.dest_club} terminó hace ${-e} días y sigue activa` } : e <= 30 ? { k: "warn", t: `${p.name}: la cesión en ${l.dest_club} termina en ${e} días` } : null);
    if (r != null && r <= 0) alerts.push({ k: "warn", t: `${p.name}: revisión pendiente (${l.next_review})` });
    if (!lastRep || daysTo(lastRep.report_date) < -60) alerts.push({ k: "warn", t: `${p.name}: sin informe del club receptor en los últimos 60 días` });
  });
  const clean = alerts.filter(Boolean);
  const saved = act.reduce((t, { l, p }) => t + Number(p.wage_eur || 0) * (1 - l.our_wage_pct / 100), 0);
  pane.innerHTML = `<div class="toolbar"><button class="btn" id="nl">+ Nueva cesión</button></div>
    <div class="g6">${[["Cedidos activos", act.length], ["Ahorro salarial anual", eur(saved)], ["Alertas", clean.length], ["Cesiones pasadas", loans.length - act.length]].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("")}</div>
    ${orphan.length ? `<div class="card flag-warn" style="margin-top:1rem">Jugadores marcados como cedidos sin ficha de cesión: ${orphan.map((p) => `<a href="#" data-orph="${p.id}">${esc(p.name)}</a>`).join(", ")} (clic para completar).</div>` : ""}
    ${clean.length ? `<div class="card" style="margin-top:1rem"><h3>Alertas</h3>${clean.map((a) => `<div class="${a.k === "bad" ? "flag-bad" : "flag-warn"}">• ${esc(a.t)}</div>`).join("")}</div>` : ""}
    <h3 style="margin:1rem 0 .4rem">Seguimiento de cedidos</h3>${loans.length ? "" : `<div class="card muted">No hay cesiones registradas.</div>`}
    <div class="tw"><table><thead><tr><th>Jugador</th><th>Club</th><th>División</th><th>Periodo</th><th class="num">Paga el club receptor</th><th class="num">PJ</th><th class="num">Min</th><th class="num">G/A</th><th>Próx. revisión</th><th>Estado</th></tr></thead>
    <tbody>${loans.sort((a, b) => (a.l.status === "activa" ? 0 : 1) - (b.l.status === "activa" ? 0 : 1) || (a.l.end_date || "").localeCompare(b.l.end_date || "")).map(({ l, p }) => `<tr class="click" data-id="${l.id}"><td><b>${esc(p.name)}</b></td><td>${esc(l.dest_club)}${l.buy_option ? " ★" : ""}</td><td>${esc(l.division || "")}</td>
      <td>${l.start_date || "?"} → ${l.end_date || "?"}</td><td class="num">${100 - l.our_wage_pct}%</td><td class="num">${l.apps ?? "–"}</td><td class="num">${l.minutes ?? "–"}</td><td class="num">${l.goals ?? "–"}/${l.assists ?? "–"}</td>
      <td>${l.next_review || ""}</td><td>${LOAN_ST[l.status]}</td></tr>`).join("")}</tbody></table></div><p class="muted">★ = tiene opción de compra. Las estadísticas de cada cesión las introduces tú.</p>`;
  $("#nl", pane).addEventListener("click", () => loanForm(null));
  $$("tr.click", pane).forEach((tr) => tr.addEventListener("click", () => loanForm(Y.loans.find((x) => x.id === tr.dataset.id))));
  $$("[data-orph]", pane).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); loanForm(null, a.dataset.orph); }));
}

function loanForm(loan, pid = null) {
  const cand = Y.players.filter((p) => !stOf(p.id).left_club || stOf(p.id).left_club === "cedido");
  const v = (k) => esc(loan?.[k] ?? "");
  const reps = loan ? Y.lreports.filter((r) => r.loan_id === loan.id).sort((a, b) => b.report_date.localeCompare(a.report_date)) : [];
  const m = openModal(`<h2>${loan ? "Cesión: " + esc(pl(loan.player_id)?.name || "") : "Nueva cesión"} <button class="btn ghost sm" data-close>Cerrar</button></h2>
    <form id="f"><div class="row">
      <div><label>Jugador *</label><select name="pid" ${loan ? "disabled" : ""}>${cand.map((p) => `<option value="${p.id}" ${(loan?.player_id || pid) === p.id ? "selected" : ""}>${esc(p.name)} (${esc(p.position || "–")})</option>`).join("")}</select></div>
      <div><label>Club de destino *</label><input name="club" required value="${v("dest_club")}"></div>
      <div><label>División</label><input name="div" value="${v("division")}" placeholder="ej. National League"></div>
      <div><label>Nivel competitivo</label><input name="lvl" value="${v("level")}" placeholder="ej. semiprofesional"></div>
    </div><div class="row">
      <div><label>Inicio</label><input type="date" name="sd" value="${v("start_date")}"></div><div><label>Fin</label><input type="date" name="ed" value="${v("end_date")}"></div>
      <div><label>Regreso previsto</label><input type="date" name="er" value="${v("expected_return")}"></div><div><label>Próxima revisión</label><input type="date" name="nr" value="${v("next_review")}"></div>
    </div><div class="row">
      <div><label>% del sueldo que seguimos pagando</label><input type="number" name="pct" min="0" max="100" value="${loan?.our_wage_pct ?? 100}"></div>
      <div><label>Tasa de cesión (€)</label><input name="fee" value="${v("loan_fee")}"></div>
      <div><label>Precio opción de compra (€)</label><input name="bp" value="${v("buy_price")}"></div>
      <div><label style="margin-top:1.3rem;color:inherit"><input type="checkbox" name="bo" style="width:auto" ${loan?.buy_option ? "checked" : ""}> Opción de compra</label>
        <label style="color:inherit"><input type="checkbox" name="bq" style="width:auto" ${loan?.buy_obligation ? "checked" : ""}> Obligación de compra</label></div>
    </div><label>Condiciones económicas y otras</label><textarea name="cond" rows="2">${v("conditions")}</textarea>
    <h3 style="margin-top:.8rem">Rendimiento (manual, cuando haya datos)</h3><div class="row">
      ${[["apps", "PJ"], ["starts", "Titular"], ["minutes", "Minutos"], ["goals", "Goles"], ["assists", "Asist."]].map(([k, l]) => `<div><label>${l}</label><input type="number" min="0" name="${k}" value="${v(k)}"></div>`).join("")}
      <div><label>Nota media</label><input type="number" step="0.1" min="0" max="10" name="rt" value="${v("avg_rating")}"></div></div>
    <div class="row"><div><label>Estado</label><select name="st">${Object.entries(LOAN_ST).map(([k, l]) => `<option value="${k}" ${(loan?.status || "activa") === k ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
    <label>Notas</label><textarea name="notes" rows="2">${v("notes")}</textarea>
    ${loan ? `<h3>Informes del club receptor</h3>${reps.map((r) => `<p><b>${r.report_date}</b><br>${esc(r.body)}</p>`).join("") || `<p class="muted">Sin informes.</p>`}<button type="button" class="btn ghost sm" id="arp">+ Informe</button>` : ""}
    <div class="actions">${loan ? `<button type="button" class="btn danger" id="del">Eliminar ficha</button>` : ""}<button class="btn">Guardar</button></div></form>`, { wide: true });
  const f = $("#f", m.el);
  $("#del", m.el)?.addEventListener("click", async () => {
    if (!confirm("¿Eliminar la ficha de cesión? El jugador no se borra.")) return;
    if (fail((await Y.sb.from("gm_loans").delete().eq("id", loan.id)).error)) return;
    m.close(); reload();
  });
  $("#arp", m.el)?.addEventListener("click", () => {
    const t = (prompt("Informe del club receptor:") || "").trim(); if (!t) return;
    Y.sb.from("gm_loan_reports").insert({ loan_id: loan.id, report_date: today(), body: t }).then(async ({ error }) => { if (fail(error)) return; m.close(); await reload(); loanForm(Y.loans.find((x) => x.id === loan.id)); });
  });
  f.addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = new FormData(f), n = (k) => (fd.get(k) === "" || fd.get(k) == null ? null : Number(fd.get(k))), d = (k) => fd.get(k) || null;
    const player = loan?.player_id || fd.get("pid");
    if (d("sd") && d("ed") && d("ed") < d("sd")) return toast("La fecha de fin es anterior al inicio.", "err");
    const row = { dest_club: String(fd.get("club")).trim(), division: String(fd.get("div")).trim() || null, level: String(fd.get("lvl")).trim() || null,
      start_date: d("sd"), end_date: d("ed"), expected_return: d("er"), next_review: d("nr"), our_wage_pct: Math.min(100, Math.max(0, n("pct") ?? 100)),
      loan_fee: toNum(fd.get("fee")), buy_price: toNum(fd.get("bp")), buy_option: !!fd.get("bo"), buy_obligation: !!fd.get("bq"), conditions: String(fd.get("cond")).trim() || null,
      apps: n("apps"), starts: n("starts"), minutes: n("minutes"), goals: n("goals"), assists: n("assists"), avg_rating: n("rt"), status: fd.get("st"), notes: String(fd.get("notes")).trim() || null };
    row.actual_return = row.status !== "activa" ? loan?.actual_return || d("ed") || today() : null;
    const { error } = loan ? await Y.sb.from("gm_loans").update(row).eq("id", loan.id) : await Y.sb.from("gm_loans").insert({ player_id: player, ...row });
    if (fail(error)) return;
    const cur = stOf(player);
    const base = { user_id: Y.user.id, player_id: player, availability: cur.availability || "disponible", transferable: !!cur.transferable, note: cur.note || null, available_until: cur.available_until || null };
    if (row.status === "activa") await Y.sb.from("gm_player_status").upsert({ ...base, left_club: "cedido", left_on: cur.left_on || row.start_date || today() }, { onConflict: "player_id" });
    else if (cur.left_club === "cedido" && confirm("La cesión ya no está activa. ¿El jugador vuelve a la plantilla activa?")) await Y.sb.from("gm_player_status").upsert({ ...base, left_club: null, left_on: null }, { onConflict: "player_id" });
    m.close(); toast("Cesión guardada"); reload();
  });
}

/* ======================= Plan de desarrollo ======================= */
function renderGoals(pane) {
  const goals = Y.goals.filter((g) => !Y.goalF || g.status === Y.goalF).sort((a, b) => (a.target_date || "9").localeCompare(b.target_date || "9"));
  pane.innerHTML = `<div class="toolbar"><button class="btn" id="ng">+ Objetivo</button>
    <select id="gf"><option value="">Todos los estados</option>${Object.entries(GOAL_ST).map(([k, l]) => `<option value="${k}" ${Y.goalF === k ? "selected" : ""}>${l}</option>`).join("")}</select><span class="muted">${goals.length} objetivos</span></div>
    ${Y.goals.length ? "" : `<div class="card muted">Sin objetivos. Ejemplos: mejorar el físico, ganar minutos en una cesión, entrenar en otra posición o prepararse para el primer equipo.</div>`}
    <div class="tw"><table><thead><tr><th>Jugador</th><th>Tipo</th><th>Objetivo</th><th>Fecha límite</th><th>Estado</th><th></th></tr></thead><tbody>
    ${goals.map((g) => { const p = pl(g.player_id), late = g.target_date && daysTo(g.target_date) < 0 && ["pendiente", "en_curso"].includes(g.status);
      return `<tr><td><b>${esc(p?.name || "?")}</b></td><td>${GOAL_KIND[g.kind]}</td><td>${esc(g.title)}${g.detail ? `<div class="muted">${esc(g.detail)}</div>` : ""}</td>
        <td class="${late ? "flag-bad" : ""}">${g.target_date || ""}${late ? " (vencido)" : ""}</td>
        <td><select data-st="${g.id}">${Object.entries(GOAL_ST).map(([k, l]) => `<option value="${k}" ${g.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
        <td><button class="btn ghost sm" data-del="${g.id}">Borrar</button></td></tr>`; }).join("")}</tbody></table></div>`;
  $("#gf", pane).addEventListener("change", (e) => { Y.goalF = e.target.value; renderGoals(pane); });
  $("#ng", pane).addEventListener("click", () => {
    const m = openModal(`<h2>Nuevo objetivo <button class="btn ghost sm" data-close>Cerrar</button></h2><form id="f"><div class="row">
      <div><label>Jugador *</label><select name="p">${Y.players.filter((p) => !stOf(p.id).left_club || stOf(p.id).left_club === "cedido").map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></div>
      <div><label>Tipo</label><select name="k">${Object.entries(GOAL_KIND).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div>
      <div><label>Fecha límite</label><input type="date" name="d"></div></div>
      <label>Objetivo *</label><input name="t" required placeholder="ej. Subir físico de 55 a 65"><label>Detalle</label><textarea name="x" rows="2"></textarea>
      <div class="actions"><button class="btn">Guardar</button></div></form>`);
    $("#f", m.el).addEventListener("submit", async (e) => {
      e.preventDefault(); const fd = new FormData(e.target);
      if (fail((await Y.sb.from("gm_dev_goals").insert({ player_id: fd.get("p"), kind: fd.get("k"), title: String(fd.get("t")).trim(), detail: String(fd.get("x")).trim() || null, target_date: fd.get("d") || null })).error)) return;
      m.close(); reload();
    });
  });
  $$("[data-st]", pane).forEach((s) => s.addEventListener("change", async () => { if (fail((await Y.sb.from("gm_dev_goals").update({ status: s.value }).eq("id", s.dataset.st)).error)) return; Y.goals.find((g) => g.id === s.dataset.st).status = s.value; renderGoals(pane); }));
  $$("[data-del]", pane).forEach((b) => b.addEventListener("click", async () => { if (!confirm("¿Borrar el objetivo?")) return; if (fail((await Y.sb.from("gm_dev_goals").delete().eq("id", b.dataset.del)).error)) return; reload(); }));
}
