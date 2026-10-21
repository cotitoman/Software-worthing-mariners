import { $, $$, esc, toNum, toast, money, openModal } from "./util.js";

/* ===================== Economía =====================
   Presupuesto por temporada → áreas → gastos (descuentan del área y del total),
   ingresos, contratos/sueldos (de la plantilla) y reformas del estadio. */

const DEFAULT_AREAS = ["Fichajes", "Salarios", "Infraestructura", "Cantera", "Scouting", "Staff técnico", "Otros"];
const INCOME_CATS = ["Entradas / abonos", "Patrocinios", "Derechos TV / EFL", "Ventas de jugadores", "Merchandising", "Premios", "Otros"];

// Precios orientativos (EUR) para un estadio de nivel League Two. Son estimaciones, no presupuestos de obra.
const WORKS = [
  { id: "stand",   name: "Grada nueva",                 unit: "1.000 asientos",  seats: 1000, cost: 2800000, months: 10 },
  { id: "roof",    name: "Cubrir grada existente",      unit: "1.000 asientos",  seats: 0,    cost: 900000,  months: 5 },
  { id: "vip",     name: "Palcos VIP / hospitality",    unit: "bloque de 10 palcos (+120 plazas)", seats: 120, cost: 1500000, months: 6 },
  { id: "safe",    name: "Zona de pie segura (safe standing)", unit: "1.000 plazas", seats: 1000, cost: 1200000, months: 5 },
  { id: "access",  name: "Accesibilidad (rampas, plazas PMR)", unit: "paquete", seats: 40, cost: 300000, months: 3 },
  { id: "led",     name: "Iluminación LED",             unit: "paquete",         seats: 0,    cost: 700000,  months: 3 },
  { id: "pitch",   name: "Césped híbrido",              unit: "campo",           seats: 0,    cost: 500000,  months: 2 },
  { id: "heat",    name: "Calefacción del césped",      unit: "campo",           seats: 0,    cost: 900000,  months: 3 },
  { id: "screen",  name: "Pantalla gigante y megafonía", unit: "paquete",        seats: 0,    cost: 400000,  months: 2 },
  { id: "train",   name: "Centro de entrenamiento",     unit: "proyecto",        seats: 0,    cost: 3000000, months: 12 },
];
const STATUS = { planificado: "Planificado", en_obra: "En obra", completado: "Completado" };

const F = {
  sb: null, user: null, el: null, tab: "resumen",
  seasons: [], areas: [], expenses: [], income: [], players: [], projects: [], capacity: 5000, noSql: false,
  seasonId: null,
};

export async function mountFinance(el, { sb, user }) {
  F.sb = sb; F.user = user; F.el = el;
  await load();
  render();
}

async function load() {
  const t = (n) => F.sb.from(n).select("*");
  const [s, a, e, i, p, pr, cs] = await Promise.all([
    t("gm_fin_seasons"), t("gm_fin_areas"), t("gm_fin_expenses"), t("gm_fin_income"),
    t("gm_players"), t("gm_stadium_projects"), t("gm_club_settings"),
  ]);
  F.noSql = !!(s.error || a.error || e.error || i.error || pr.error || cs.error);
  F.seasons = (s.data || []).sort((x, y) => y.name.localeCompare(x.name));
  F.areas = (a.data || []).sort((x, y) => x.sort - y.sort || x.name.localeCompare(y.name));
  F.expenses = (e.data || []).sort((x, y) => y.spent_on.localeCompare(x.spent_on) || y.created_at.localeCompare(x.created_at));
  F.income = (i.data || []).sort((x, y) => y.received_on.localeCompare(x.received_on));
  F.players = p.data || [];
  F.projects = (pr.data || []).sort((x, y) => y.created_at.localeCompare(x.created_at));
  F.capacity = cs.data?.[0]?.stadium_capacity ?? 5000;
  if (!F.seasons.find((x) => x.id === F.seasonId)) F.seasonId = F.seasons[0]?.id || null;
}
async function reload() { await load(); render(); }

const season = () => F.seasons.find((s) => s.id === F.seasonId);
const sAreas = () => F.areas.filter((a) => a.season_id === F.seasonId);
const sExp = () => F.expenses.filter((x) => x.season_id === F.seasonId);
const sInc = () => F.income.filter((x) => x.season_id === F.seasonId);
const sum = (arr, k = "amount") => arr.reduce((t, r) => t + Number(r[k] || 0), 0);
const eur = (n) => "€" + Math.round(Number(n || 0)).toLocaleString("es-CL");
const today = () => new Date().toISOString().slice(0, 10);
const fail = (error) => { if (error) { toast(error.message, "err"); return true; } return false; };

function totals() {
  const s = season();
  const spent = sum(sExp()), income = sum(sInc());
  const alloc = sum(sAreas(), "allocated");
  return { total: Number(s?.total_budget || 0), spent, income, alloc, left: Number(s?.total_budget || 0) - spent, unassigned: Number(s?.total_budget || 0) - alloc };
}

/* ======================= Estructura ======================= */
function render() {
  if (F.noSql) {
    F.el.innerHTML = `<div class="card"><b>Falta un paso en Supabase.</b> Ejecuta <code>supabase/schema_economia.sql</code> en el SQL Editor y recarga la página.</div>`;
    return;
  }
  const tabs = [["resumen", "Presupuesto"], ["gastos", "Gastos"], ["ingresos", "Ingresos"], ["contratos", "Contratos y sueldos"], ["estadio", "Estadio"]];
  F.el.innerHTML = `
    <div class="subtabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${F.tab === k ? "on" : ""}">${l}</button>`).join("")}</div>
    ${F.tab !== "contratos" && F.tab !== "estadio" ? seasonBar() : ""}
    <div id="pane"></div>`;
  $$("[data-t]", F.el).forEach((b) => b.addEventListener("click", () => { F.tab = b.dataset.t; render(); }));
  $("#fs", F.el)?.addEventListener("change", (e) => { F.seasonId = e.target.value; render(); });
  $("#fs-new", F.el)?.addEventListener("click", seasonForm);
  const pane = $("#pane", F.el);
  const needSeason = ["resumen", "gastos", "ingresos"].includes(F.tab);
  if (needSeason && !season()) {
    pane.innerHTML = `<div class="card">Crea tu primera temporada con su presupuesto total para empezar a anotar.</div>`;
    return;
  }
  ({ resumen: renderSummary, gastos: renderExpenses, ingresos: renderIncome, contratos: renderContracts, estadio: renderStadium })[F.tab](pane);
}

function seasonBar() {
  return `<div class="toolbar"><label style="margin:0">Temporada</label>
    <select id="fs">${F.seasons.map((s) => `<option value="${s.id}" ${s.id === F.seasonId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
    <button class="btn ghost sm" id="fs-new">+ Nueva temporada</button></div>`;
}

function seasonForm() {
  const y = new Date().getFullYear();
  const m = openModal(`<h2>Nueva temporada <button class="btn ghost sm" data-close>Cerrar</button></h2>
    <form id="f"><div class="row">
      <div><label>Nombre</label><input name="name" required value="${y}/${String((y + 1) % 100).padStart(2, "0")}"></div>
      <div><label>Presupuesto total (€)</label><input name="budget" required placeholder="ej. 2.500.000 o 2,5M"></div>
    </div>
    <label style="color:inherit"><input type="checkbox" name="areas" checked style="width:auto"> Crear áreas por defecto (${DEFAULT_AREAS.join(", ")})</label>
    <div class="actions"><button class="btn">Crear</button></div></form>`);
  $("#f", m.el).addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const budget = toNum(fd.get("budget"));
    if (budget === null || budget < 0) return toast("Presupuesto inválido.", "err");
    const { data, error } = await F.sb.from("gm_fin_seasons").insert({ name: String(fd.get("name")).trim(), total_budget: budget }).select().single();
    if (error) return toast(error.code === "23505" ? "Ya existe esa temporada." : error.message, "err");
    if (fd.get("areas")) {
      const { error: e2 } = await F.sb.from("gm_fin_areas").insert(DEFAULT_AREAS.map((n, i) => ({ season_id: data.id, name: n, sort: i })));
      if (fail(e2)) return;
    }
    F.seasonId = data.id;
    m.close(); toast("Temporada creada"); reload();
  });
}

/* ======================= Presupuesto ======================= */
function renderSummary(pane) {
  const T = totals(), s = season();
  const pct = T.total ? Math.min(100, (T.spent / T.total) * 100) : 0;
  const areas = sAreas().map((a) => ({ a, spent: sum(sExp().filter((x) => x.area_id === a.id)) }));
  pane.innerHTML = `
    <div class="g6">
      ${[["Presupuesto total", eur(T.total)], ["Gastado", eur(T.spent)], ["Restante general", eur(T.left)], ["Ingresos", eur(T.income)],
         ["Balance (ingresos − gastos)", eur(T.income - T.spent)], ["Sin asignar a áreas", eur(T.unassigned)]]
        .map(([l, v], i) => `<div class="stat"><b class="${(i === 2 && T.left < 0) || (i === 5 && T.unassigned < 0) ? "flag-bad" : ""}">${v}</b><span>${l}</span></div>`).join("")}
    </div>
    <div class="card" style="margin-top:1rem"><div class="bar"><i class="${pct > 90 ? "bad" : pct > 75 ? "warn" : ""}" style="width:${pct}%"></i></div>
      <span class="muted">${pct.toFixed(0)}% del presupuesto gastado</span>
      <button class="btn ghost sm" id="eb" style="float:right">Cambiar presupuesto total</button></div>
    <h3 style="margin:1rem 0 .4rem">Áreas</h3>
    <div class="tw"><table><thead><tr><th>Área</th><th class="num">Asignado (€)</th><th class="num">Gastado</th><th class="num">Restante</th><th>Uso</th><th></th></tr></thead>
    <tbody>${areas.map(({ a, spent }) => {
      const left = a.allocated - spent, p = a.allocated ? Math.min(100, (spent / a.allocated) * 100) : spent ? 100 : 0;
      return `<tr data-a="${a.id}"><td><b>${esc(a.name)}</b></td>
        <td><input class="al" type="number" min="0" value="${a.allocated}" style="width:130px"></td>
        <td class="num">${eur(spent)}</td><td class="num ${left < 0 ? "flag-bad" : ""}">${eur(left)}</td>
        <td><div class="bar"><i class="${p > 100 || left < 0 ? "bad" : p > 85 ? "warn" : ""}" style="width:${p}%"></i></div></td>
        <td><button class="btn ghost sm" data-del="${a.id}">Quitar</button></td></tr>`;
    }).join("")}</tbody></table></div>
    <div class="actions"><button class="btn ghost" id="aa">+ Área</button><button class="btn" id="sa">Guardar asignaciones</button></div>`;

  $("#eb", pane).addEventListener("click", async () => {
    const v = toNum(prompt("Nuevo presupuesto total (€):", s.total_budget));
    if (v === null || v < 0) return;
    if (fail((await F.sb.from("gm_fin_seasons").update({ total_budget: v }).eq("id", s.id)).error)) return;
    reload();
  });
  $("#aa", pane).addEventListener("click", async () => {
    const n = (prompt("Nombre del área:") || "").trim();
    if (!n) return;
    const { error } = await F.sb.from("gm_fin_areas").insert({ season_id: s.id, name: n, sort: sAreas().length });
    if (error) return toast(error.code === "23505" ? "Ya existe esa área." : error.message, "err");
    reload();
  });
  $$("[data-del]", pane).forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("¿Quitar esta área?")) return;
    const { error } = await F.sb.from("gm_fin_areas").delete().eq("id", b.dataset.del);
    if (error) return toast(error.code === "23503" ? "El área tiene gastos; bórralos primero." : error.message, "err");
    reload();
  }));
  $("#sa", pane).addEventListener("click", async (e) => {
    const rows = $$("tbody tr", pane).map((tr) => ({ id: tr.dataset.a, v: Number($(".al", tr).value) || 0 }));
    const total = rows.reduce((t, r) => t + r.v, 0);
    if (total > T.total && !confirm(`Asignaste ${eur(total)}, más que el total (${eur(T.total)}). ¿Guardar igualmente?`)) return;
    e.target.disabled = true;
    const res = await Promise.all(rows.map((r) => F.sb.from("gm_fin_areas").update({ allocated: r.v }).eq("id", r.id)));
    if (res.some((r) => fail(r.error))) { e.target.disabled = false; return; }
    toast("Asignaciones guardadas"); reload();
  });
}

/* ======================= Gastos ======================= */
function renderExpenses(pane) {
  const list = sExp();
  const aName = (id) => F.areas.find((a) => a.id === id)?.name || "–";
  pane.innerHTML = `
    <div class="toolbar"><button class="btn" id="ne">+ Anotar gasto</button><span class="muted">${list.length} gastos · ${eur(sum(list))}</span></div>
    ${list.length ? "" : `<div class="card muted">Sin gastos todavía. Cada gasto descuenta de su área y del presupuesto general.</div>`}
    <div class="tw"><table><thead><tr><th>Fecha</th><th>Área</th><th>Descripción</th><th class="num">Monto</th><th></th></tr></thead>
    <tbody>${list.map((x) => `<tr><td>${x.spent_on}</td><td>${esc(aName(x.area_id))}</td><td>${esc(x.description || "")}</td>
      <td class="num">${eur(x.amount)}</td><td><button class="btn ghost sm" data-del="${x.id}">Borrar</button></td></tr>`).join("")}</tbody></table></div>`;
  $("#ne", pane).addEventListener("click", expenseForm);
  $$("[data-del]", pane).forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("¿Borrar este gasto?")) return;
    if (fail((await F.sb.from("gm_fin_expenses").delete().eq("id", b.dataset.del)).error)) return;
    reload();
  }));
}

function expenseForm(pre = {}) {
  const areas = sAreas();
  if (!areas.length) return toast("Crea primero un área en Presupuesto.", "err");
  const spentBy = (id) => sum(sExp().filter((x) => x.area_id === id));
  const m = openModal(`<h2>Anotar gasto <button class="btn ghost sm" data-close>Cerrar</button></h2>
    <form id="f"><div class="row">
      <div><label>Área</label><select name="area">${areas.map((a) => `<option value="${a.id}" ${pre.area_id === a.id ? "selected" : ""}>${esc(a.name)} (quedan ${eur(a.allocated - spentBy(a.id))})</option>`).join("")}</select></div>
      <div><label>Monto (€)</label><input name="amount" required value="${pre.amount ?? ""}" placeholder="ej. 150.000"></div>
      <div><label>Fecha</label><input type="date" name="date" value="${today()}" required></div>
    </div><label>Descripción</label><input name="desc" value="${esc(pre.description || "")}" placeholder="Fichaje de…, obras, etc.">
    <div class="actions"><button class="btn">Guardar</button></div></form>`);
  $("#f", m.el).addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const amount = toNum(fd.get("amount")), a = areas.find((x) => x.id === fd.get("area"));
    if (!amount || amount <= 0) return toast("Monto inválido.", "err");
    const left = a.allocated - spentBy(a.id);
    if (amount > left && !confirm(`Este gasto supera lo que queda en "${a.name}" (${eur(left)}). ¿Anotarlo igual?`)) return;
    const { error } = await F.sb.from("gm_fin_expenses").insert({ season_id: F.seasonId, area_id: a.id, amount, description: String(fd.get("desc")).trim() || null, spent_on: fd.get("date") });
    if (fail(error)) return;
    m.close(); toast("Gasto anotado"); reload();
  });
}

/* ======================= Ingresos ======================= */
function renderIncome(pane) {
  const list = sInc();
  const byCat = {};
  list.forEach((x) => { byCat[x.category] = (byCat[x.category] || 0) + Number(x.amount); });
  pane.innerHTML = `
    <div class="toolbar"><button class="btn" id="ni">+ Anotar ingreso</button><span class="muted">${list.length} ingresos · ${eur(sum(list))}</span></div>
    ${Object.keys(byCat).length ? `<div class="card">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<span style="margin-right:1rem"><b>${esc(c)}</b> ${eur(v)}</span>`).join("")}</div>` : `<div class="card muted">Sin ingresos todavía.</div>`}
    <div class="tw"><table><thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th class="num">Monto</th><th></th></tr></thead>
    <tbody>${list.map((x) => `<tr><td>${x.received_on}</td><td>${esc(x.category)}</td><td>${esc(x.description || "")}</td><td class="num">${eur(x.amount)}</td>
      <td><button class="btn ghost sm" data-del="${x.id}">Borrar</button></td></tr>`).join("")}</tbody></table></div>`;
  $("#ni", pane).addEventListener("click", () => {
    const m = openModal(`<h2>Anotar ingreso <button class="btn ghost sm" data-close>Cerrar</button></h2>
      <form id="f"><div class="row">
        <div><label>Categoría</label><input name="cat" list="cats" required value="${INCOME_CATS[0]}"><datalist id="cats">${INCOME_CATS.map((c) => `<option>${c}</option>`).join("")}</datalist></div>
        <div><label>Monto (€)</label><input name="amount" required></div>
        <div><label>Fecha</label><input type="date" name="date" value="${today()}" required></div>
      </div><label>Descripción</label><input name="desc">
      <div class="actions"><button class="btn">Guardar</button></div></form>`);
    $("#f", m.el).addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target), amount = toNum(fd.get("amount"));
      if (!amount || amount <= 0) return toast("Monto inválido.", "err");
      const { error } = await F.sb.from("gm_fin_income").insert({ season_id: F.seasonId, category: String(fd.get("cat")).trim(), amount, description: String(fd.get("desc")).trim() || null, received_on: fd.get("date") });
      if (fail(error)) return;
      m.close(); toast("Ingreso anotado"); reload();
    });
  });
  $$("[data-del]", pane).forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("¿Borrar este ingreso?")) return;
    if (fail((await F.sb.from("gm_fin_income").delete().eq("id", b.dataset.del)).error)) return;
    reload();
  }));
}

/* ======================= Contratos y sueldos ======================= */
function renderContracts(pane) {
  const ps = [...F.players].sort((a, b) => Number(b.wage_eur || 0) - Number(a.wage_eur || 0));
  const bill = sum(ps, "wage_eur");
  const year = new Date().getFullYear();
  const exp = ps.filter((p) => p.contract_until && p.contract_until <= year + 1);
  const salArea = F.areas.find((a) => a.season_id === F.seasonId && /salari|sueld/i.test(a.name));
  pane.innerHTML = `
    <div class="g6">
      ${[["Masa salarial anual", eur(bill)], ["Por semana", eur(bill / 52)], ["Jugadores", ps.length], ["Sueldo medio", eur(ps.length ? bill / ps.length : 0)],
         ["Contratos que vencen", exp.length], ["Área Salarios", salArea ? `${eur(salArea.allocated)} (${salArea.allocated ? Math.round((bill / salArea.allocated) * 100) : 0}%)` : "–"]]
        .map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("")}
    </div>
    ${exp.length ? `<div class="card flag-warn" style="margin-top:1rem">Vencen pronto: ${exp.map((p) => `${esc(p.name)} (${p.contract_until})`).join(", ")}</div>` : ""}
    <p class="muted" style="margin-top:1rem">Edita sueldo anual y año de fin de contrato directamente; se guarda al salir de la casilla.</p>
    <div class="tw"><table><thead><tr><th>Jugador</th><th>Pos</th><th class="num">OVR</th><th class="num">Sueldo anual (€)</th><th class="num">Por semana</th><th class="num">Contrato hasta</th><th class="num">Valor</th></tr></thead>
    <tbody>${ps.map((p) => `<tr data-id="${p.id}"><td><b>${esc(p.name)}</b></td><td><span class="pos">${esc(p.position || "–")}</span></td><td class="num">${p.overall ?? ""}</td>
      <td><input class="ed" data-k="wage_eur" type="number" min="0" value="${p.wage_eur ?? ""}" style="width:120px"></td>
      <td class="num">${p.wage_eur ? eur(p.wage_eur / 52) : "–"}</td>
      <td><input class="ed" data-k="contract_until" type="number" min="2000" max="2100" value="${p.contract_until ?? ""}" style="width:90px"></td>
      <td class="num">${money(p.value_eur)}</td></tr>`).join("")}</tbody></table></div>
    ${ps.length ? "" : `<div class="card muted">Aún no hay jugadores. Impórtalos en Plantilla.</div>`}`;
  $$(".ed", pane).forEach((inp) => inp.addEventListener("change", async () => {
    const id = inp.closest("tr").dataset.id;
    const v = inp.value === "" ? null : Number(inp.value);
    if (fail((await F.sb.from("gm_players").update({ [inp.dataset.k]: v }).eq("id", id)).error)) return;
    toast("Guardado");
    await load(); renderContracts(pane);
  }));
}

/* ======================= Estadio ======================= */
function renderStadium(pane) {
  const done = F.projects.filter((p) => p.status === "completado");
  const planned = F.projects.filter((p) => p.status !== "completado");
  const future = F.capacity + sum(planned, "capacity_added");
  const cost = sum(planned, "total_cost");
  pane.innerHTML = `
    <div class="g6">
      ${[["Capacidad actual", F.capacity.toLocaleString("es-CL")], ["Con obras pendientes", future.toLocaleString("es-CL")],
         ["Coste obras pendientes", eur(cost)], ["Obras completadas", done.length]]
        .map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("")}
    </div>
    <div class="toolbar" style="margin-top:1rem"><button class="btn" id="np">+ Nueva reforma</button><button class="btn ghost" id="cap">Ajustar capacidad actual</button></div>
    <div class="tw"><table><thead><tr><th>Reforma</th><th class="num">Cant.</th><th class="num">Capacidad +</th><th class="num">Coste</th><th class="num">Meses</th><th>Estado</th><th></th></tr></thead>
    <tbody>${F.projects.map((p) => `<tr data-id="${p.id}"><td><b>${esc(p.name)}</b></td><td class="num">${p.quantity}</td><td class="num">${p.capacity_added ? "+" + p.capacity_added.toLocaleString("es-CL") : "–"}</td>
      <td class="num">${eur(p.total_cost)}</td><td class="num">${p.months}</td>
      <td><select class="st">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${p.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
      <td><button class="btn ghost sm" data-del="${p.id}">Borrar</button></td></tr>`).join("")}</tbody></table></div>
    ${F.projects.length ? "" : `<div class="card muted">Sin reformas. Pulsa "Nueva reforma" para ver el catálogo con precios orientativos.</div>`}
    <p class="muted">Precios orientativos para un estadio de League Two; las obras reales varían según permisos, terreno y contratistas. La capacidad se suma al marcar una reforma como completada.</p>`;

  $("#cap", pane).addEventListener("click", async () => {
    const v = toNum(prompt("Capacidad actual del estadio:", F.capacity));
    if (v === null || v < 0) return;
    if (await saveCapacity(Math.round(v))) reload();
  });
  $("#np", pane).addEventListener("click", projectForm);
  $$("[data-del]", pane).forEach((b) => b.addEventListener("click", async () => {
    const p = F.projects.find((x) => x.id === b.dataset.del);
    if (!confirm(`¿Borrar "${p.name}"?` + (p.status === "completado" ? " Se restará su capacidad." : ""))) return;
    if (p.status === "completado" && !(await saveCapacity(Math.max(0, F.capacity - p.capacity_added)))) return;
    if (fail((await F.sb.from("gm_stadium_projects").delete().eq("id", p.id)).error)) return;
    reload();
  }));
  $$(".st", pane).forEach((sel) => sel.addEventListener("change", async () => {
    const p = F.projects.find((x) => x.id === sel.closest("tr").dataset.id);
    const was = p.status === "completado", now = sel.value === "completado";
    if (was !== now && !(await saveCapacity(Math.max(0, F.capacity + (now ? 1 : -1) * p.capacity_added)))) return;
    if (fail((await F.sb.from("gm_stadium_projects").update({ status: sel.value }).eq("id", p.id)).error)) return;
    reload();
  }));
}

async function saveCapacity(v) {
  const { error } = await F.sb.from("gm_club_settings").upsert({ user_id: F.user.id, stadium_capacity: v, updated_at: new Date().toISOString() });
  return !fail(error);
}

function projectForm() {
  const m = openModal(`<h2>Nueva reforma <button class="btn ghost sm" data-close>Cerrar</button></h2>
    <form id="f"><div class="row">
      <div><label>Obra</label><select name="w">${WORKS.map((w) => `<option value="${w.id}">${w.name}</option>`).join("")}</select></div>
      <div><label>Cantidad</label><input name="q" type="number" min="1" step="1" value="1"></div>
    </div>
    <div class="card" id="prev"></div>
    ${season() && sAreas().length ? `<label style="color:inherit"><input type="checkbox" name="pay" style="width:auto"> Anotar el coste como gasto en
      <select name="area" style="width:auto">${sAreas().map((a) => `<option value="${a.id}" ${/infra/i.test(a.name) ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select> (${esc(season().name)})</label>` : ""}
    <div class="actions"><button class="btn">Crear reforma</button></div></form>`);
  const f = $("#f", m.el);
  const calc = () => {
    const w = WORKS.find((x) => x.id === f.w.value), q = Math.max(1, Number(f.q.value) || 1);
    $("#prev", m.el).innerHTML = `<b>${esc(w.name)}</b> × ${q} (${esc(w.unit)})<br>Coste estimado: <b>${eur(w.cost * q)}</b> · Duración: ~${w.months} meses
      · Capacidad: <b>${w.seats ? "+" + (w.seats * q).toLocaleString("es-CL") : "sin cambio"}</b> → ${(F.capacity + w.seats * q).toLocaleString("es-CL")} plazas`;
    return { w, q };
  };
  f.addEventListener("input", calc); calc();
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { w, q } = calc();
    const row = { name: w.name, kind: w.id, quantity: q, capacity_added: w.seats * q, base_cost: w.cost, total_cost: w.cost * q, months: w.months };
    if (fail((await F.sb.from("gm_stadium_projects").insert(row)).error)) return;
    if (f.pay?.checked) {
      if (fail((await F.sb.from("gm_fin_expenses").insert({ season_id: F.seasonId, area_id: f.area.value, amount: row.total_cost, description: "Estadio: " + w.name + " ×" + q, spent_on: today() })).error)) return;
    }
    m.close(); toast("Reforma creada"); reload();
  });
}
