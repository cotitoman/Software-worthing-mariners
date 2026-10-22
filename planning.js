import { $, $$, esc, POSITIONS, toNum, toast, money, openModal } from "./util.js";

/* ===================== Planificación de plantilla y simulador =====================
   Los números salen de tu plantilla, contratos y presupuesto. Nada se aplica a los datos reales
   hasta que confirmas una simulación. */

const GROUP = { GK: "POR", CB: "DEF", LB: "DEF", RB: "DEF", LWB: "DEF", RWB: "DEF", CDM: "MED", CM: "MED", CAM: "MED", LM: "MED", RM: "MED", LW: "DEL", RW: "DEL", CF: "DEL", ST: "DEL" };
const ROLES = { titular: "Titular", rotacion: "Rotación", suplente: "Suplente", juvenil: "Juvenil / reserva" };
const AVAIL = { disponible: "Disponible", lesionado: "Lesionado", sancionado: "Sancionado" };
const FORMATIONS = {
  "4-4-2": { LB: 1, CB: 2, RB: 1, LM: 1, CM: 2, RM: 1, ST: 2 },
  "4-3-3": { LB: 1, CB: 2, RB: 1, CDM: 1, CM: 2, LW: 1, RW: 1, ST: 1 },
  "4-2-3-1": { LB: 1, CB: 2, RB: 1, CDM: 2, LM: 1, CAM: 1, RM: 1, ST: 1 },
  "4-1-4-1": { LB: 1, CB: 2, RB: 1, CDM: 1, LM: 1, CM: 2, RM: 1, ST: 1 },
  "4-5-1": { LB: 1, CB: 2, RB: 1, LM: 1, CM: 3, RM: 1, ST: 1 },
  "4-1-2-1-2": { LB: 1, CB: 2, RB: 1, CDM: 1, CM: 2, CAM: 1, ST: 2 },
  "3-5-2": { CB: 3, LWB: 1, RWB: 1, CM: 3, ST: 2 },
  "3-4-3": { CB: 3, LM: 1, CM: 2, RM: 1, LW: 1, RW: 1, ST: 1 },
  "5-3-2": { LWB: 1, CB: 3, RWB: 1, CM: 3, ST: 2 },
  "5-4-1": { LWB: 1, CB: 3, RWB: 1, LM: 1, CM: 2, RM: 1, ST: 1 },
};
const SIZE_MIN = 20, SIZE_MAX = 25; // orientativo; ajusta a las reglas de tu competición

const P = { sb: null, user: null, el: null, tab: "vista", season: "", players: [], status: new Map(), plans: [], sims: [], finSeasons: [], finAreas: [], scouts: [], noSql: false };

const eur = (n) => "€" + Math.round(Number(n || 0)).toLocaleString("es-CL");
const fail = (error) => { if (error) { toast(error.message, "err"); return true; } return false; };
const endYear = (s) => { const m = /^(\d{4})/.exec(s || ""); return m ? Number(m[1]) + 1 : null; };
const plan = () => P.plans.find((p) => p.season === P.season) || null;
const stOf = (id) => P.status.get(id) || { availability: "disponible", transferable: false, left_club: null };
const active = () => P.players.filter((p) => !stOf(p.id).left_club);
const suggest = (f) => { const d = { GK: 2 }; for (const [pos, n] of Object.entries(FORMATIONS[f] || FORMATIONS["4-4-2"])) d[pos] = n + 1; return d; };
const desired = () => { const p = plan(); return p && Object.keys(p.desired || {}).length ? p.desired : suggest(p?.formation || "4-4-2"); };

/* ---------- carga ---------- */
async function load() {
  const t = (n) => P.sb.from(n).select("*");
  const [pl, st, pn, sm, fs, fa, sc] = await Promise.all([t("gm_players"), t("gm_player_status"), t("gm_squad_plans"), t("gm_squad_sims"), t("gm_fin_seasons"), t("gm_fin_areas"), t("gm_scouts")]);
  P.noSql = !!(st.error || pn.error || sm.error);
  P.players = (pl.data || []).sort((a, b) => a.name.localeCompare(b.name));
  P.status = new Map((st.data || []).map((s) => [s.player_id, s]));
  P.plans = pn.data || [];
  P.sims = (sm.data || []).sort((a, b) => b.created_at.localeCompare(a.created_at));
  P.finSeasons = fs.data || []; P.finAreas = fa.data || [];
  P.scouts = sc.data || [];
  const seasons = seasonList();
  if (!P.season || !seasons.includes(P.season)) P.season = seasons[0];
}
function seasonList() {
  const y = new Date().getFullYear();
  const set = new Set([...P.plans.map((p) => p.season), ...P.finSeasons.map((s) => s.name), P.season].filter(Boolean));
  if (!set.size) set.add(`${y}/${String((y + 1) % 100).padStart(2, "0")}`);
  return [...set].sort().reverse();
}
async function reload() { await load(); render(); }

export async function mountPlanning(el, { sb, user }) {
  P.sb = sb; P.user = user; P.el = el;
  el.innerHTML = `<p class="muted">Cargando planificación…</p>`;
  await load(); render();
}

function render() {
  if (P.noSql) { P.el.innerHTML = `<div class="card"><b>Falta un paso en Supabase.</b> Ejecuta <code>supabase/schema_planificacion.sql</code> en el SQL Editor y recarga la página.</div>`; return; }
  const tabs = [["vista", "Vista de plantilla"], ["plan", "Plan de temporada"], ["sim", "Simulador"]];
  P.el.innerHTML = `<div class="subtabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${P.tab === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="toolbar"><label style="margin:0">Temporada</label>
      <select id="ps">${seasonList().map((s) => `<option ${s === P.season ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
      <button class="btn ghost sm" id="psn">+ Nueva temporada</button></div><div id="pane"></div>`;
  $$("[data-t]", P.el).forEach((b) => b.addEventListener("click", () => { P.tab = b.dataset.t; render(); }));
  $("#ps", P.el).addEventListener("change", (e) => { P.season = e.target.value; render(); });
  $("#psn", P.el).addEventListener("click", () => { const n = (prompt("Nombre de la temporada (ej. 2027/28):") || "").trim(); if (n) { P.season = n; render(); } });
  ({ vista: renderView, plan: renderPlan, sim: renderSims })[P.tab]($("#pane", P.el));
}

/* ---------- análisis común ---------- */
function countByPos(list) { const c = {}; list.forEach((p) => { if (p.position) c[p.position] = (c[p.position] || 0) + 1; }); return c; }
function alertsFor(list, des, { budget, wage } = {}) {
  const out = [], c = countByPos(list), pr = plan()?.priorities || [], ey = endYear(P.season);
  for (const pos of POSITIONS) {
    const d = des[pos] || 0, n = c[pos] || 0;
    if (n < d) out.push({ k: pr.includes(pos) ? "bad" : "warn", t: `Faltan ${d - n} en ${pos} (tienes ${n}, deseado ${d})${pr.includes(pos) ? " — posición prioritaria" : ""}` });
    else if (n - d >= 2) out.push({ k: "warn", t: `Exceso en ${pos}: ${n} jugadores para ${d} deseados` });
  }
  if ((c.GK || 0) < 2) out.push({ k: "bad", t: `Solo ${c.GK || 0} portero(s): se recomiendan al menos 2` });
  if (list.length < SIZE_MIN) out.push({ k: "warn", t: `Plantilla de ${list.length}: por debajo de ${SIZE_MIN} (orientativo)` });
  if (list.length > SIZE_MAX) out.push({ k: "warn", t: `Plantilla de ${list.length}: por encima de ${SIZE_MAX} (orientativo; revisa el límite de tu competición)` });
  if (budget != null && budget < 0) out.push({ k: "bad", t: `El presupuesto de fichajes quedaría en ${eur(budget)}` });
  if (wage != null && wage < 0) out.push({ k: "bad", t: `La masa salarial superaría el presupuesto salarial por ${eur(-wage)}` });
  return out;
}

/* ======================= Vista de plantilla ======================= */
function renderView(pane) {
  const act = active(), out = P.players.filter((p) => stOf(p.id).left_club);
  const des = desired(), c = countByPos(act), pl = plan();
  const wageBill = act.reduce((t, p) => t + Number(p.wage_eur || 0), 0), ey = endYear(P.season);
  const ages = act.filter((p) => p.age != null), ovr = act.filter((p) => p.overall != null);
  const avg = (a, k) => (a.length ? (a.reduce((t, p) => t + Number(p[k]), 0) / a.length).toFixed(1) : "–");
  const expiring = act.filter((p) => p.contract_until != null && ey != null && p.contract_until <= ey);
  const unavailable = act.filter((p) => stOf(p.id).availability !== "disponible");
  const alerts = alertsFor(act, des);
  expiring.forEach((p) => alerts.push({ k: (pl?.essentials || []).includes(p.id) ? "bad" : "warn", t: `${p.name}: contrato hasta ${p.contract_until}${(pl?.essentials || []).includes(p.id) ? " — imprescindible, conviene renovar" : ""}` }));
  unavailable.forEach((p) => alerts.push({ k: "warn", t: `${p.name}: ${AVAIL[stOf(p.id).availability].toLowerCase()}${stOf(p.id).available_until ? " hasta " + stOf(p.id).available_until : ""}` }));

  const groups = ["POR", "DEF", "MED", "DEL"];
  pane.innerHTML = `
    <div class="g6">${[["Jugadores", act.length], ["Edad media", avg(ages, "age")], ["OVR medio", avg(ovr, "overall")], ["Masa salarial", eur(wageBill)],
      ["Contratos que vencen", expiring.length], ["No disponibles", unavailable.length]].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("")}</div>
    <div class="grid g2" style="margin-top:1rem">
      <div class="card"><h3>Posiciones: tengo vs deseado</h3>
        <p class="muted">${pl && Object.keys(pl.desired || {}).length ? "Deseado definido en el Plan de " + esc(P.season) + "." : "Aún no definiste el deseado: se usa una sugerencia para " + esc(pl?.formation || "4-4-2") + " (titulares + 1 suplente por puesto)."}</p>
        <div class="tw"><table style="min-width:0"><thead><tr><th>Pos</th><th class="num">Tengo</th><th class="num">Disp.</th><th class="num">Deseado</th><th>Estado</th></tr></thead><tbody>
        ${groups.map((g) => { const ps = POSITIONS.filter((x) => GROUP[x] === g);
          return `<tr><td colspan="5" class="muted"><b>${g}</b> — ${ps.reduce((t, x) => t + (c[x] || 0), 0)} / ${ps.reduce((t, x) => t + (des[x] || 0), 0)}</td></tr>` + ps.map((pos) => {
            const n = c[pos] || 0, d = des[pos] || 0, disp = act.filter((p) => p.position === pos && stOf(p.id).availability === "disponible").length;
            if (!n && !d) return "";
            return `<tr><td><span class="pos">${pos}</span>${(pl?.priorities || []).includes(pos) ? " ★" : ""}</td><td class="num">${n}</td><td class="num">${disp}</td><td class="num">${d}</td>
              <td class="${n < d ? "flag-bad" : n - d >= 2 ? "flag-warn" : "flag-ok"}">${n < d ? "Falta " + (d - n) : n - d >= 2 ? "Exceso" : "OK"}</td></tr>`; }).join(""); }).join("")}
        </tbody></table></div><p class="muted">Se cuenta por posición principal del jugador; un jugador polivalente solo cubre su posición registrada.</p></div>
      <div class="card"><h3>Alertas y necesidades</h3>${alerts.length ? alerts.map((a) => `<div class="${a.k === "bad" ? "flag-bad" : "flag-warn"}">• ${esc(a.t)}</div>`).join("") : `<p class="flag-ok">Sin alertas.</p>`}</div>
    </div>
    <div class="tw"><table><thead><tr><th>Jugador</th><th>Pos</th><th>Rol</th><th class="num">Edad</th><th class="num">OVR</th><th class="num">POT</th><th class="num">Sueldo</th><th class="num">Contrato</th><th>Disponibilidad</th><th>Hasta</th><th>Transferible</th><th>Plan ${esc(P.season)}</th></tr></thead>
    <tbody>${act.sort((a, b) => (b.overall || 0) - (a.overall || 0)).map((p) => { const s = stOf(p.id);
      const tag = (pl?.essentials || []).includes(p.id) ? "Imprescindible" : (pl?.to_sell || []).includes(p.id) ? "Vender / ceder" : "";
      return `<tr data-id="${p.id}"><td><b>${esc(p.name)}</b></td><td><span class="pos">${esc(p.position || "–")}</span></td>
        <td><select data-role>${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${(p.squad_role || "rotacion") === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
        <td class="num">${p.age ?? ""}</td><td class="num ovr">${p.overall ?? ""}</td><td class="num">${p.potential ?? ""}</td><td class="num">${money(p.wage_eur)}</td>
        <td class="num ${ey != null && p.contract_until != null && p.contract_until <= ey ? "flag-warn" : ""}">${p.contract_until ?? ""}</td>
        <td><select data-av>${Object.entries(AVAIL).map(([k, l]) => `<option value="${k}" ${s.availability === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
        <td><input type="date" data-until value="${s.available_until || ""}" style="width:140px" ${s.availability === "disponible" ? "disabled" : ""}></td>
        <td><input type="checkbox" data-tr ${s.transferable ? "checked" : ""} style="width:auto"></td><td>${tag ? `<span class="badge">${tag}</span>` : ""}</td></tr>`; }).join("")}</tbody></table></div>
    ${act.length ? "" : `<div class="card muted">No hay jugadores activos.</div>`}
    ${out.length ? `<h3 style="margin:1rem 0 .4rem">Fuera del club</h3><div class="tw"><table style="min-width:0"><tbody>${out.map((p) => `<tr><td>${esc(p.name)}</td><td>${stOf(p.id).left_club}</td><td>${stOf(p.id).left_on || ""}</td>
      <td><button class="btn ghost sm" data-back="${p.id}">Reincorporar</button></td></tr>`).join("")}</tbody></table></div>` : ""}`;

  const saveStatus = async (id, patch) => {
    const cur = stOf(id);
    const row = { user_id: P.user.id, player_id: id, availability: cur.availability, available_until: cur.available_until || null, transferable: cur.transferable, left_club: cur.left_club || null, left_on: cur.left_on || null, note: cur.note || null, ...patch };
    const { error } = await P.sb.from("gm_player_status").upsert(row, { onConflict: "player_id" });
    if (fail(error)) return false;
    P.status.set(id, { ...cur, ...row }); return true;
  };
  $$("tr[data-id]", pane).forEach((tr) => {
    const id = tr.dataset.id;
    $("[data-role]", tr).addEventListener("change", async (e) => { if (fail((await P.sb.from("gm_players").update({ squad_role: e.target.value }).eq("id", id)).error)) return; P.players.find((p) => p.id === id).squad_role = e.target.value; });
    $("[data-av]", tr).addEventListener("change", async (e) => { if (await saveStatus(id, { availability: e.target.value, available_until: e.target.value === "disponible" ? null : stOf(id).available_until })) renderView(pane); });
    $("[data-until]", tr).addEventListener("change", (e) => saveStatus(id, { available_until: e.target.value || null }));
    $("[data-tr]", tr).addEventListener("change", (e) => saveStatus(id, { transferable: e.target.checked }));
  });
  $$("[data-back]", pane).forEach((b) => b.addEventListener("click", async () => { if (await saveStatus(b.dataset.back, { left_club: null, left_on: null })) renderView(pane); }));
}

/* ======================= Plan de temporada ======================= */
function renderPlan(pane) {
  const pl = plan() || { formation: "4-4-2", system: "", desired: {}, essentials: [], to_sell: [], priorities: [], transfer_budget: null, wage_budget: null, notes: "" };
  const des = Object.keys(pl.desired || {}).length ? pl.desired : suggest(pl.formation || "4-4-2");
  const act = active(), fin = P.finSeasons.find((s) => s.name === P.season);
  const areas = fin ? P.finAreas.filter((a) => a.season_id === fin.id) : [];
  const wageBill = act.reduce((t, p) => t + Number(p.wage_eur || 0), 0);
  pane.innerHTML = `<form id="f">
    <div class="row">
      <div><label>Formación preferida</label><select name="formation">${Object.keys(FORMATIONS).map((f) => `<option ${pl.formation === f ? "selected" : ""}>${f}</option>`).join("")}</select></div>
      <div style="flex:2"><label>Sistema táctico</label><input name="system" value="${esc(pl.system || "")}" placeholder="ej. presión alta, salida desde atrás, juego directo"></div>
    </div>
    <div class="card"><h3>Jugadores deseados por posición</h3>
      <div class="toolbar"><button type="button" class="btn ghost sm" id="sug">Sugerir según la formación</button><span class="muted">Total deseado: <b id="dtot"></b></span></div>
      <div class="row">${POSITIONS.map((pos) => `<div style="min-width:70px"><label>${pos} ${(pl.priorities || []).includes(pos) ? "★" : ""}</label><input type="number" min="0" max="9" data-d="${pos}" value="${des[pos] ?? 0}"></div>`).join("")}</div>
      <label>Posiciones prioritarias para reforzar</label>
      <div class="toolbar">${POSITIONS.map((pos) => `<label style="display:inline-flex;gap:.25rem;margin:0;color:inherit"><input type="checkbox" data-pr="${pos}" style="width:auto" ${(pl.priorities || []).includes(pos) ? "checked" : ""}>${pos}</label>`).join("")}</div></div>
    <div class="grid g2">
      <div class="card"><h3>Imprescindibles</h3><div style="max-height:260px;overflow:auto">${act.map((p) => `<label style="display:flex;gap:.4rem;margin:.1rem 0;color:inherit"><input type="checkbox" data-es="${p.id}" style="width:auto" ${(pl.essentials || []).includes(p.id) ? "checked" : ""}>${esc(p.name)} <span class="muted">${esc(p.position || "")}</span></label>`).join("") || `<span class="muted">Sin jugadores.</span>`}</div></div>
      <div class="card"><h3>Disponibles para vender o ceder</h3><div style="max-height:260px;overflow:auto">${act.map((p) => `<label style="display:flex;gap:.4rem;margin:.1rem 0;color:inherit"><input type="checkbox" data-sl="${p.id}" style="width:auto" ${(pl.to_sell || []).includes(p.id) ? "checked" : ""}>${esc(p.name)} <span class="muted">${esc(p.position || "")}</span></label>`).join("") || `<span class="muted">Sin jugadores.</span>`}</div></div>
    </div>
    <div class="card"><h3>Presupuesto estimado</h3><div class="row">
      <div><label>Fichajes (€)</label><input name="tb" value="${pl.transfer_budget ?? ""}"></div>
      <div><label>Masa salarial máxima (€/año)</label><input name="wb" value="${pl.wage_budget ?? ""}"></div></div>
      <p class="muted">Masa salarial actual: <b>${eur(wageBill)}</b>${pl.wage_budget ? ` · margen: <b>${eur(pl.wage_budget - wageBill)}</b>` : ""}.
      ${fin ? `En Economía (${esc(P.season)}): ${areas.map((a) => `${esc(a.name)} ${eur(a.allocated)}`).join(" · ") || "sin áreas"}.` : "No hay temporada con este nombre en Economía."}</p></div>
    <label>Notas</label><textarea name="notes" rows="3">${esc(pl.notes || "")}</textarea>
    <div class="actions"><button class="btn">Guardar plan de ${esc(P.season)}</button></div></form>`;
  const tot = () => { $("#dtot", pane).textContent = $$("[data-d]", pane).reduce((t, i) => t + (Number(i.value) || 0), 0); };
  tot();
  $$("[data-d]", pane).forEach((i) => i.addEventListener("input", tot));
  $("#sug", pane).addEventListener("click", () => { const s = suggest($("[name=formation]", pane).value); $$("[data-d]", pane).forEach((i) => { i.value = s[i.dataset.d] ?? 0; }); tot(); });
  $("#f", pane).addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const d = {}; $$("[data-d]", pane).forEach((i) => { if (Number(i.value) > 0) d[i.dataset.d] = Number(i.value); });
    const ids = (attr) => $$(`[${attr}]:checked`, pane).map((i) => i.getAttribute(attr));
    const row = { user_id: P.user.id, season: P.season, formation: fd.get("formation"), system: String(fd.get("system")).trim() || null, desired: d,
      essentials: ids("data-es"), to_sell: ids("data-sl"), priorities: ids("data-pr"), transfer_budget: toNum(fd.get("tb")), wage_budget: toNum(fd.get("wb")),
      notes: String(fd.get("notes")).trim() || null, updated_at: new Date().toISOString() };
    const both = row.essentials.filter((x) => row.to_sell.includes(x));
    if (both.length) return toast("Un jugador no puede ser imprescindible y estar en venta a la vez.", "err");
    if (fail((await P.sb.from("gm_squad_plans").upsert(row, { onConflict: "user_id,season" })).error)) return;
    toast("Plan guardado"); reload();
  });
}

/* ======================= Simulador ======================= */
function project(ops) {
  const des = desired(), pl = plan();
  let list = active().map((p) => ({ id: p.id, name: p.name, position: p.position, age: p.age, overall: p.overall, wage: Number(p.wage_eur || 0) }));
  const before = list.map((p) => ({ ...p }));
  let net = 0, retained = 0, income = 0, spend = 0;
  for (const o of ops) {
    if (o.type === "sell" || o.type === "loan_out") {
      const p = list.find((x) => x.id === o.player_id); if (!p) continue;
      list = list.filter((x) => x.id !== o.player_id);
      if (o.type === "loan_out") retained += p.wage * (1 - (o.pct || 0) / 100); // el club receptor paga pct% del sueldo
      income += Number(o.fee || 0);
    } else if (o.type === "buy" || o.type === "loan_in") {
      const share = o.type === "loan_in" ? (o.pct ?? 100) / 100 : 1;
      list.push({ id: o.id, name: o.name, position: o.position, age: o.age, overall: o.overall, wage: Number(o.wage || 0) * share, isNew: true });
      spend += Number(o.fee || 0);
    }
  }
  net = income - spend;
  const wageBefore = before.reduce((t, p) => t + p.wage, 0), wageAfter = list.reduce((t, p) => t + p.wage, 0) + retained;
  const budgetLeft = pl?.transfer_budget != null ? pl.transfer_budget + net : null;
  const wageLeft = pl?.wage_budget != null ? pl.wage_budget - wageAfter : null;
  return { before, after: list, des, income, spend, net, wageBefore, wageAfter, budgetLeft, wageLeft };
}
const avgOf = (l, k) => { const a = l.filter((p) => p[k] != null); return a.length ? (a.reduce((t, p) => t + Number(p[k]), 0) / a.length).toFixed(1) : "–"; };

function renderSims(pane) {
  const list = P.sims.filter((s) => s.season === P.season);
  pane.innerHTML = `<div class="toolbar"><button class="btn" id="ns">+ Nueva simulación</button><span class="muted">${list.length} simulaciones en ${esc(P.season)}</span></div>
    <p class="muted">Prueba ventas, cesiones y fichajes sin tocar tus datos. Solo se aplican cuando pulsas <b>Aplicar</b> y confirmas.</p>
    ${list.length ? "" : `<div class="card muted">Aún no hay simulaciones.</div>`}
    <div class="grid g2">${list.map((s) => { const pr = project(s.ops || []);
      return `<div class="card"><div style="display:flex;justify-content:space-between"><h3>${esc(s.name)}</h3>${s.applied_at ? `<span class="badge">Aplicada</span>` : ""}</div>
        <p class="muted">${(s.ops || []).length} operaciones · plantilla ${pr.before.length} → <b>${pr.after.length}</b> · fichajes ${pr.net >= 0 ? "+" : ""}${eur(pr.net)} · masa salarial ${eur(pr.wageBefore)} → <b>${eur(pr.wageAfter)}</b></p>
        <div class="toolbar"><button class="btn sm" data-ed="${s.id}">${s.applied_at ? "Ver" : "Editar"}</button><button class="btn ghost sm" data-dup="${s.id}">Duplicar</button>
        ${s.applied_at ? "" : `<button class="btn ghost sm" data-ap="${s.id}">Aplicar…</button>`}<button class="btn ghost sm" data-del="${s.id}">Descartar</button></div></div>`; }).join("")}</div>`;
  $("#ns", pane).addEventListener("click", () => simForm(null));
  $$("[data-ed]", pane).forEach((b) => b.addEventListener("click", () => simForm(P.sims.find((s) => s.id === b.dataset.ed))));
  $$("[data-ap]", pane).forEach((b) => b.addEventListener("click", () => applySim(P.sims.find((s) => s.id === b.dataset.ap))));
  $$("[data-dup]", pane).forEach((b) => b.addEventListener("click", async () => {
    const s = P.sims.find((x) => x.id === b.dataset.dup);
    if (fail((await P.sb.from("gm_squad_sims").insert({ season: s.season, name: s.name + " (copia)", ops: s.ops, notes: s.notes })).error)) return;
    toast("Duplicada"); reload();
  }));
  $$("[data-del]", pane).forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("¿Descartar esta simulación?")) return;
    if (fail((await P.sb.from("gm_squad_sims").delete().eq("id", b.dataset.del)).error)) return;
    reload();
  }));
}

function opLabel(o) {
  const t = { sell: "Venta", loan_out: "Cesión (sale)", buy: "Fichaje", loan_in: "Cesión (llega)" }[o.type];
  const bits = [];
  if (o.position) bits.push(o.position);
  if (o.fee) bits.push((o.type === "sell" || o.type === "loan_out" ? "ingreso " : "coste ") + eur(o.fee));
  if (o.wage && (o.type === "buy" || o.type === "loan_in")) bits.push("sueldo " + eur(o.wage));
  if (o.pct != null && (o.type === "loan_out" || o.type === "loan_in")) bits.push(o.type === "loan_out" ? `otro club paga ${o.pct}%` : `pagamos ${o.pct}%`);
  return `<b>${t}</b>: ${esc(o.name)} <span class="muted">${bits.join(" · ")}</span>`;
}

function simForm(sim) {
  const readOnly = !!sim?.applied_at;
  const ops = JSON.parse(JSON.stringify(sim?.ops || []));
  const act = active();
  const m = openModal(`<h2>${sim ? (readOnly ? "Simulación aplicada" : "Editar simulación") : "Nueva simulación"} — ${esc(P.season)} <button class="btn ghost sm" data-close>Cerrar</button></h2>
    <div class="row"><div style="flex:2"><label>Nombre</label><input id="nm" value="${esc(sim?.name || "")}" placeholder="ej. Vender al delantero y fichar un extremo" ${readOnly ? "disabled" : ""}></div></div>
    ${readOnly ? "" : `<div class="card"><h3 style="font-size:1rem">Añadir operación</h3><div class="row">
      <div><label>Tipo</label><select id="ot"><option value="sell">Vender jugador</option><option value="loan_out">Ceder jugador</option><option value="buy">Fichar jugador</option><option value="loan_in">Cesión entrante</option></select></div>
      <div id="o-pl"><label>Jugador de la plantilla</label><select id="op">${act.map((p) => `<option value="${p.id}">${esc(p.name)} (${esc(p.position || "–")}, ${money(p.wage_eur)})</option>`).join("")}</select></div>
      <div id="o-sc" hidden><label>Prellenar desde scouting</label><select id="osc"><option value="">— manual —</option>${P.scouts.filter((s) => s.shortlist).map((s) => `<option value="${s.id}">★ ${esc(s.name)}</option>`).join("")}${P.scouts.filter((s) => !s.shortlist).slice(0, 300).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select></div></div>
      <div class="row" id="o-in" hidden>
        <div><label>Nombre</label><input id="on"></div><div><label>Posición</label><select id="opo"><option value=""></option>${POSITIONS.map((p) => `<option>${p}</option>`).join("")}</select></div>
        <div><label>Edad</label><input id="oa" type="number" min="14" max="45"></div><div><label>OVR</label><input id="oo" type="number" min="1" max="99"></div>
        <div><label>Sueldo anual (€)</label><input id="ow"></div></div>
      <div class="row"><div><label id="fl">Ingreso por la operación (€)</label><input id="of" placeholder="0"></div>
        <div id="o-pc" hidden><label id="pcl">% del sueldo que paga el otro club</label><input id="opc" type="number" min="0" max="100" value="0"></div></div>
      <button class="btn sm" id="oadd" type="button">Añadir a la simulación</button></div>`}
    <div id="opsl"></div><div id="proj"></div>
    <label>Notas</label><textarea id="sn" rows="2" ${readOnly ? "disabled" : ""}>${esc(sim?.notes || "")}</textarea>
    <div class="actions">${readOnly ? "" : `<button class="btn" id="save">Guardar simulación</button>`}</div>`, { wide: true });

  const typ = () => $("#ot", m.el)?.value;
  const syncType = () => {
    if (readOnly) return;
    const t = typ(), out = t === "sell" || t === "loan_out";
    $("#o-pl", m.el).hidden = !out; $("#o-sc", m.el).hidden = out; $("#o-in", m.el).hidden = out;
    $("#o-pc", m.el).hidden = !(t === "loan_out" || t === "loan_in");
    $("#fl", m.el).textContent = out ? "Ingreso por la operación (€)" : "Coste de la operación (€)";
    $("#pcl", m.el).textContent = t === "loan_out" ? "% del sueldo que paga el otro club" : "% del sueldo que pagamos nosotros";
    if (t === "loan_in" && Number($("#opc", m.el).value) === 0) $("#opc", m.el).value = 100;
    if (t === "loan_out" && Number($("#opc", m.el).value) === 100) $("#opc", m.el).value = 0;
  };
  const draw = () => {
    $("#opsl", m.el).innerHTML = ops.length ? `<h3 style="margin-top:1rem">Operaciones</h3>` + ops.map((o, i) => `<div style="margin:.2rem 0">${opLabel(o)} ${readOnly ? "" : `<button class="btn ghost sm" data-rm="${i}" type="button">✕</button>`}</div>`).join("") : `<p class="muted">Sin operaciones.</p>`;
    $$("[data-rm]", m.el).forEach((b) => b.addEventListener("click", () => { ops.splice(Number(b.dataset.rm), 1); draw(); }));
    projection(m, ops);
  };
  if (!readOnly) {
    $("#ot", m.el).addEventListener("change", syncType);
    $("#osc", m.el).addEventListener("change", (e) => {
      const s = P.scouts.find((x) => x.id === e.target.value); if (!s) return;
      $("#on", m.el).value = s.name; $("#opo", m.el).value = s.position || ""; $("#oa", m.el).value = s.age ?? ""; $("#oo", m.el).value = s.overall ?? ""; $("#ow", m.el).value = s.wage_eur ?? ""; $("#of", m.el).value = s.value_eur ?? "";
      toast("Datos copiados del scouting; revisa el sueldo y el coste (son los que figuran en tu base).");
    });
    $("#oadd", m.el).addEventListener("click", () => {
      const t = typ(), fee = toNum($("#of", m.el).value) || 0, pct = Math.min(100, Math.max(0, Number($("#opc", m.el).value) || 0));
      if (t === "sell" || t === "loan_out") {
        const p = act.find((x) => x.id === $("#op", m.el).value); if (!p) return toast("Elige un jugador.", "err");
        if (ops.some((o) => o.player_id === p.id)) return toast("Ese jugador ya está en la simulación.", "err");
        ops.push({ id: "o" + Date.now(), type: t, player_id: p.id, name: p.name, position: p.position, fee, pct: t === "loan_out" ? pct : undefined });
      } else {
        const name = $("#on", m.el).value.trim(); if (!name) return toast("Escribe el nombre del jugador.", "err");
        ops.push({ id: "o" + Date.now(), type: t, name, position: $("#opo", m.el).value || null, age: Number($("#oa", m.el).value) || null, overall: Number($("#oo", m.el).value) || null,
          wage: toNum($("#ow", m.el).value) || 0, fee, pct: t === "loan_in" ? pct : undefined });
        ["on", "oa", "oo", "ow", "of"].forEach((i) => { $("#" + i, m.el).value = ""; });
      }
      draw();
    });
    $("#save", m.el).addEventListener("click", async () => {
      const name = $("#nm", m.el).value.trim(); if (!name) return toast("Ponle un nombre.", "err");
      const row = { season: P.season, name, ops, notes: $("#sn", m.el).value.trim() || null, updated_at: new Date().toISOString() };
      const { error } = sim ? await P.sb.from("gm_squad_sims").update(row).eq("id", sim.id) : await P.sb.from("gm_squad_sims").insert(row);
      if (fail(error)) return;
      m.close(); toast("Simulación guardada"); reload();
    });
    syncType();
  }
  draw();
}

function projection(m, ops) {
  const r = project(ops), cb = countByPos(r.before), ca = countByPos(r.after);
  const rows = POSITIONS.filter((p) => cb[p] || ca[p] || r.des[p]);
  const al = alertsFor(r.after, r.des, { budget: r.budgetLeft, wage: r.wageLeft });
  $("#proj", m.el).innerHTML = `<h3 style="margin-top:1rem">Plantilla actual vs proyectada</h3>
    <div class="g6">${[["Jugadores", `${r.before.length} → ${r.after.length}`], ["Edad media", `${avgOf(r.before, "age")} → ${avgOf(r.after, "age")}`], ["OVR medio", `${avgOf(r.before, "overall")} → ${avgOf(r.after, "overall")}`],
      ["Masa salarial", `${eur(r.wageBefore)} → ${eur(r.wageAfter)}`], ["Ingresos", eur(r.income)], ["Gastos", eur(r.spend)],
      ["Presupuesto fichajes", r.budgetLeft == null ? "sin definir" : eur(r.budgetLeft)]].map(([l, v]) => `<div class="stat"><b style="font-size:.95rem">${v}</b><span>${l}</span></div>`).join("")}</div>
    <div class="tw" style="margin-top:.6rem"><table style="min-width:0"><thead><tr><th>Pos</th><th class="num">Ahora</th><th class="num">Después</th><th class="num">Deseado</th><th>Cobertura</th></tr></thead><tbody>
    ${rows.map((p) => { const d = r.des[p] || 0, a = ca[p] || 0; return `<tr><td><span class="pos">${p}</span></td><td class="num">${cb[p] || 0}</td><td class="num"><b>${a}</b></td><td class="num">${d}</td>
      <td class="${a < d ? "flag-bad" : a - d >= 2 ? "flag-warn" : "flag-ok"}">${a < d ? "Falta " + (d - a) : a - d >= 2 ? "Exceso" : "OK"}</td></tr>`; }).join("")}</tbody></table></div>
    <div style="margin-top:.6rem">${al.length ? al.map((a) => `<div class="${a.k === "bad" ? "flag-bad" : "flag-warn"}">• ${esc(a.t)}</div>`).join("") : `<span class="flag-ok">Sin alertas en la plantilla proyectada.</span>`}</div>
    <p class="muted">Los sueldos y costes de fichajes son los que tú introduces; no se estiman precios.</p>`;
}

/* ---------- Aplicar ---------- */
function applySim(sim) {
  const ops = sim.ops || [];
  if (!ops.length) return toast("La simulación no tiene operaciones.", "err");
  const fin = P.finSeasons.find((s) => s.name === sim.season), areas = fin ? P.finAreas.filter((a) => a.season_id === fin.id) : [];
  const m = openModal(`<h2>Aplicar “${esc(sim.name)}” <button class="btn ghost sm" data-close>Cerrar</button></h2>
    <p>Esto <b>modificará tus datos reales</b>:</p>
    ${ops.map((o) => `<div>• ${opLabel(o)}</div>`).join("")}
    <ul class="muted"><li>Fichajes y cesiones entrantes: se crean como jugadores nuevos en tu plantilla (sin inventar contrato).</li>
      <li>Ventas y cesiones salientes: el jugador sale de las listas activas pero <b>no se borra</b>; puedes reincorporarlo desde Vista de plantilla.</li></ul>
    ${fin && areas.length ? `<label style="color:inherit"><input type="checkbox" id="fe" checked style="width:auto"> Registrar costes e ingresos en Economía (${esc(fin.name)})</label>
      <label>Área para los costes</label><select id="fa">${areas.map((a) => `<option value="${a.id}" ${/fichaj/i.test(a.name) ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>` : `<p class="muted">No hay temporada “${esc(sim.season)}” con áreas en Economía: no se registrarán movimientos económicos.</p>`}
    <div class="actions"><button class="btn danger" id="go">Confirmar y aplicar</button></div>`);
  $("#go", m.el).addEventListener("click", async (e) => {
    e.target.disabled = true;
    const withFin = !!$("#fe", m.el)?.checked, area = $("#fa", m.el)?.value, today = new Date().toISOString().slice(0, 10);
    let errs = 0;
    const run = async (p) => { const { error } = await p; if (error) { errs++; toast(error.message, "err"); } return !error; };
    for (const o of ops) {
      if (o.type === "sell" || o.type === "loan_out") {
        const cur = stOf(o.player_id);
        const ok = await run(P.sb.from("gm_player_status").upsert({ user_id: P.user.id, player_id: o.player_id, availability: cur.availability, transferable: cur.transferable, left_club: o.type === "sell" ? "vendido" : "cedido", left_on: today, note: cur.note || null }, { onConflict: "player_id" }));
        if (ok && withFin && o.fee > 0) await run(P.sb.from("gm_fin_income").insert({ season_id: fin.id, category: o.type === "sell" ? "Ventas de jugadores" : "Cesiones", amount: o.fee, description: `${o.type === "sell" ? "Venta" : "Cesión"}: ${o.name}`, received_on: today }));
      } else {
        const wage = (o.wage || 0) * (o.type === "loan_in" ? (o.pct ?? 100) / 100 : 1);
        const ok = await run(P.sb.from("gm_players").insert({ name: o.name, position: o.position, age: o.age, overall: o.overall, wage_eur: wage || null, squad_role: "rotacion" }));
        if (ok && withFin && o.fee > 0) await run(P.sb.from("gm_fin_expenses").insert({ season_id: fin.id, area_id: area, amount: o.fee, description: `${o.type === "buy" ? "Fichaje" : "Cesión entrante"}: ${o.name}`, spent_on: today }));
      }
    }
    if (!errs) await run(P.sb.from("gm_squad_sims").update({ applied_at: new Date().toISOString() }).eq("id", sim.id));
    m.close();
    toast(errs ? "Se aplicó con errores: revisa los avisos (la simulación sigue sin marcar como aplicada)." : "Simulación aplicada", errs ? "err" : "ok");
    reload();
  });
}
